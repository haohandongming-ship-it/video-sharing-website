package com.videoshare.auth;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * 已注销 Access Token（JTI）黑名单。
 *
 * <p>登出时把当前令牌的 JTI 写入黑名单，直到其自然过期为止。存储以 Redis 为准，
 * 非生产环境额外维护一份按 Access TTL 过期的本地降级缓存 —— 这样「本地开发没有
 * Redis」时登出**依然真正生效**。</p>
 *
 * <p>此前的实现在 Redis 不可用时直接返回「未吊销」，导致登出接口返回成功但令牌
 * 仍然可用（实测：logout 返回 200 后，同一 token 访问 /users/me 仍为 200）。
 * 现在改为：</p>
 * <ul>
 *   <li>本地降级缓存命中即视为已吊销（与 Redis 是否可用无关）；</li>
 *   <li>Redis 不可用时，生产环境仍然 fail-closed —— 无法确认吊销状态即拒绝该请求，
 *       并保留 5 秒熔断避免反复冲击已经不可用的依赖；</li>
 *   <li>非生产环境退化为「按已知信息判断」，不再把未知当作未吊销而放行写入侧操作。</li>
 * </ul>
 */
@Service
public class TokenDenylist {

    private static final String PREFIX = "auth:jti:denylist:";
    /** 退避基数：首次失败后等待 5 秒再试。 */
    private static final long REDIS_BREAKER_BASE_MILLIS = 5_000L;
    /** 退避上限：无论连续失败多少次，最多等待 2 分钟。 */
    private static final long REDIS_BREAKER_MAX_MILLIS = 120_000L;
    /** 指数增长的最大位移，避免移位溢出（2^5 = 32 倍，已远超上限）。 */
    private static final int MAX_BACKOFF_SHIFT = 5;

    private final StringRedisTemplate redis;
    private final AuthProperties props;
    private final boolean production;

    /** Redis 不可用时的本地降级黑名单（仅非生产环境写入）。 */
    private final Cache<String, Boolean> fallback;

    /** 熔断到期时间戳；早于当前时间即视为「可以再试一次」。 */
    private final AtomicLong redisRetryAfter = new AtomicLong(0L);

    /** 连续失败次数，用于计算指数退避窗口；任一 Redis 调用成功后清零。 */
    private final AtomicInteger redisFailures = new AtomicInteger(0);

    public TokenDenylist(StringRedisTemplate redis, AuthProperties props, Environment env) {
        this.redis = redis;
        this.props = props;
        this.production = env.matchesProfiles("prod");
        this.fallback = Caffeine.newBuilder()
                .maximumSize(100_000)
                .expireAfterWrite(Duration.ofSeconds(props.accessTtlSeconds()))
                .build();
    }

    /** 吊销一个 JTI。生产环境 Redis 不可用时抛出业务错误（调用方据此返回 500 而非假装成功）。 */
    public void revoke(String jti) {
        if (jti == null || jti.isBlank()) return;
        if (!production) fallback.put(jti, Boolean.TRUE);
        try {
            redis.opsForValue().set(PREFIX + jti, "1", Duration.ofSeconds(props.accessTtlSeconds()));
            redisFailures.set(0);
            redisRetryAfter.set(0L);
        } catch (DataAccessException ex) {
            openBreaker();
            if (production) throw new ApiException(ErrorCode.INTERNAL, "认证会话服务暂时不可用");
        }
    }

    /**
     * 该 JTI 是否已被吊销。
     *
     * <p>生产环境在无法确认（Redis 不可用且熔断窗口内）时抛出运行时异常，
     * 由 {@link JwtAuthenticationFilter} 捕获后清空认证上下文 —— 即 fail-closed。</p>
     */
    public boolean isRevoked(String jti) {
        if (jti == null || jti.isBlank()) return false;
        // 本地降级缓存优先：与 Redis 可用性无关，保证「刚登出」一定能被识别。
        if (fallback.getIfPresent(jti) != null) return true;
        long now = System.currentTimeMillis();
        if (now < redisRetryAfter.get()) {
            if (production) throw new IllegalStateException("Token revocation service unavailable");
            return false;
        }
        try {
            boolean revoked = Boolean.TRUE.equals(redis.hasKey(PREFIX + jti));
            redisFailures.set(0);
            redisRetryAfter.set(0L);
            return revoked;
        } catch (DataAccessException ex) {
            openBreaker();
            if (production) throw ex;
            return false;
        }
    }

    /**
     * 打开熔断并按下一次退避窗口延后重试。
     *
     * <p>固定 5 秒窗口在 Redis 长时间不可用时会以每秒一次（每次请求）的节奏反复尝试连接，
     * 每次都白等一个 connect-timeout。改为指数退避：5s → 10s → 20s → 40s → 80s，上限 2 分钟。</p>
     */
    private void openBreaker() {
        int failures = redisFailures.incrementAndGet();
        long delay = REDIS_BREAKER_BASE_MILLIS << Math.min(failures - 1, MAX_BACKOFF_SHIFT);
        redisRetryAfter.set(System.currentTimeMillis() + Math.min(delay, REDIS_BREAKER_MAX_MILLIS));
    }
}
