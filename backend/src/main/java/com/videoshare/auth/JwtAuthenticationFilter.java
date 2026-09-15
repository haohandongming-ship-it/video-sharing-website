package com.videoshare.auth;

import com.videoshare.user.Role;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Bearer 令牌认证过滤器。
 *
 * <p>「已注销令牌」黑名单存在 Redis 里。压测发现：当 Redis 不可用时，每个带令牌的请求
 * 都要先走一次必然失败的连接尝试，开发/CI 环境没有 Redis 时所有需登录接口都被拖慢。
 * 这里加一个 5 秒的失败熔断——一旦连接失败，短时间内直接跳过该检查，不再反复打已经
 * 不可用的依赖；生产环境仍然保持 fail-closed 语义（首个失败即抛出）。</p>
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String DENYLIST_PREFIX = "auth:jti:denylist:";
    private static final long REDIS_BREAKER_MILLIS = 5_000L;

    private final JwtService jwtService;
    private final StringRedisTemplate redis;
    private final boolean production;

    /** 熔断到期时间戳；早于当前时间即视为「可以再试一次」。 */
    private final AtomicLong redisRetryAfter = new AtomicLong(0L);

    public JwtAuthenticationFilter(JwtService jwtService, StringRedisTemplate redis, Environment env) {
        this.jwtService = jwtService;
        this.redis = redis;
        this.production = env.matchesProfiles("prod");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header == null && "GET".equals(request.getMethod())
                && request.getRequestURI().matches("/api/v1/videos/\\d+/source") && request.getCookies() != null) {
            for (var cookie : request.getCookies()) {
                if ("video_media".equals(cookie.getName())) { header = "Bearer " + cookie.getValue(); break; }
            }
        }
        if (header != null && header.startsWith("Bearer ")) {
            try {
                var claims = jwtService.parse(header.substring(7));
                String jti = claims.getId();
                if (isRevoked(jti)) throw new IllegalArgumentException("revoked");
                CurrentUser principal = new CurrentUser(Long.parseLong(claims.getSubject()),
                        Role.valueOf(claims.get("role", String.class)), jti);
                var authentication = new UsernamePasswordAuthenticationToken(principal, null,
                        List.of(new SimpleGrantedAuthority("ROLE_" + principal.role().name())));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            } catch (RuntimeException ignored) {
                SecurityContextHolder.clearContext();
            }
        }
        chain.doFilter(request, response);
    }

    private boolean isRevoked(String jti) {
        long now = System.currentTimeMillis();
        if (now < redisRetryAfter.get()) {
            if (production) throw new IllegalStateException("Token revocation service unavailable");
            return false;
        }
        try {
            boolean revoked = Boolean.TRUE.equals(redis.hasKey(DENYLIST_PREFIX + jti));
            redisRetryAfter.set(0L);
            return revoked;
        } catch (DataAccessException ex) {
            redisRetryAfter.set(now + REDIS_BREAKER_MILLIS);
            if (production) throw ex;
            return false;
        }
    }
}
