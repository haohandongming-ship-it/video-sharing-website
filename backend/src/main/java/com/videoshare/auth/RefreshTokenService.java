package com.videoshare.auth;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import com.videoshare.user.User;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * 刷新令牌。
 *
 * <p>令牌仅以 SHA-256 摘要落库/落缓存，并维护「已使用」标记来检测重放：一旦发现
 * 复用，立即吊销该用户全部会话。</p>
 *
 * <p>本地降级存储从无界 {@code ConcurrentHashMap} 换成按刷新有效期过期的有界
 * Caffeine 缓存，避免长期运行时内存随登录次数持续增长。</p>
 */
@Service
public class RefreshTokenService {

    private static final int SECRET_BYTES = 32;

    private final StringRedisTemplate redis;
    private final AuthProperties props;
    private final boolean production;
    private final SecureRandom random = new SecureRandom();

    /** Redis 不可用时的本地降级存储（仅非生产环境启用）。 */
    private final Cache<String, String> fallback;
    private final Cache<Long, Set<String>> fallbackIndex;

    public RefreshTokenService(StringRedisTemplate redis, AuthProperties props, Environment env) {
        this.redis = redis;
        this.props = props;
        this.production = env.matchesProfiles("prod");
        Duration ttl = Duration.ofSeconds(props.refreshTtlSeconds());
        this.fallback = Caffeine.newBuilder().maximumSize(100_000).expireAfterWrite(ttl).build();
        this.fallbackIndex = Caffeine.newBuilder().maximumSize(100_000).expireAfterWrite(ttl).build();
    }

    public String issue(User user) {
        String id = UUID.randomUUID().toString();
        byte[] bytes = new byte[SECRET_BYTES];
        random.nextBytes(bytes);
        String secret = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        if (!production) {
            fallback.put(key(user.getId(), id), sha256(secret));
            fallbackIndex.asMap()
                    .computeIfAbsent(user.getId(), ignored -> java.util.concurrent.ConcurrentHashMap.newKeySet())
                    .add(id);
        }
        try {
            Duration ttl = Duration.ofSeconds(props.refreshTtlSeconds());
            redis.opsForValue().set(key(user.getId(), id), sha256(secret), ttl);
            redis.opsForSet().add(index(user.getId()), id);
            redis.expire(index(user.getId()), ttl);
        } catch (DataAccessException ex) {
            if (production) throw unavailable();
        }
        return user.getId() + "." + id + "." + secret;
    }

    public long consume(String token) {
        String[] parts = token == null ? new String[0] : token.split("\\.", 3);
        if (parts.length != 3) throw new ApiException(ErrorCode.TOKEN_INVALID, "登录状态已失效");
        long userId;
        try {
            userId = Long.parseLong(parts[0]);
        } catch (NumberFormatException ex) {
            throw new ApiException(ErrorCode.TOKEN_INVALID, "登录状态已失效");
        }
        String usedKey = "auth:refresh:used:" + parts[1];
        if (get(usedKey) != null) {
            revokeAll(userId);
            throw new ApiException(ErrorCode.TOKEN_INVALID, "检测到令牌复用，请重新登录");
        }
        String key = key(userId, parts[1]);
        String stored = get(key);
        if (stored == null || !sha256(parts[2]).equals(stored)) {
            throw new ApiException(ErrorCode.TOKEN_INVALID, "登录状态已失效");
        }
        if (!production) {
            fallback.invalidate(key);
            Set<String> local = fallbackIndex.getIfPresent(userId);
            if (local != null) local.remove(parts[1]);
            fallback.put(usedKey, Long.toString(userId));
        }
        try {
            redis.delete(key);
            redis.opsForSet().remove(index(userId), parts[1]);
            redis.opsForValue().set(usedKey, Long.toString(userId), Duration.ofSeconds(props.refreshTtlSeconds()));
        } catch (DataAccessException ex) {
            if (production) throw unavailable();
        }
        return userId;
    }

    public void revokeAll(long userId) {
        Set<String> local = fallbackIndex.asMap().remove(userId);
        if (local != null) for (String id : local) fallback.invalidate(key(userId, id));
        try {
            Set<String> ids = redis.opsForSet().members(index(userId));
            if (ids != null) for (String id : ids) redis.delete(key(userId, id));
            redis.delete(index(userId));
        } catch (DataAccessException ex) {
            if (production) throw unavailable();
        }
    }

    private String get(String key) {
        try {
            String value = redis.opsForValue().get(key);
            return value != null ? value : fallback.getIfPresent(key);
        } catch (DataAccessException ex) {
            if (production) throw unavailable();
            return fallback.getIfPresent(key);
        }
    }

    private ApiException unavailable() {
        return new ApiException(ErrorCode.INTERNAL, "认证会话服务暂时不可用");
    }

    private static String key(long userId, String id) {
        return "auth:refresh:" + userId + ":" + id;
    }

    private static String index(long userId) {
        return "auth:refresh:index:" + userId;
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
