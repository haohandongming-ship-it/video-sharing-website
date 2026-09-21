package com.videoshare.auth;

import com.videoshare.user.Role;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Bearer 令牌认证过滤器。
 *
 * <p>「已注销令牌」的判定收敛在 {@link TokenDenylist}：非生产环境有本地降级黑名单，
 * 因此没有 Redis 时登出也真正生效；生产环境在无法确认吊销状态时 fail-closed
 * （该依赖抛出的运行时异常会落到下面的 catch，清空认证上下文后由授权层返回 401）。</p>
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtService jwtService;
    private final TokenDenylist denylist;

    public JwtAuthenticationFilter(JwtService jwtService, TokenDenylist denylist) {
        this.jwtService = jwtService;
        this.denylist = denylist;
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
                if (denylist.isRevoked(jti)) throw new IllegalArgumentException("revoked");
                CurrentUser principal = new CurrentUser(Long.parseLong(claims.getSubject()),
                        Role.valueOf(claims.get("role", String.class)), jti);
                var authentication = new UsernamePasswordAuthenticationToken(principal, null,
                        List.of(new SimpleGrantedAuthority("ROLE_" + principal.role().name())));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            } catch (RuntimeException ignored) {
                // 令牌无效、已吊销，或吊销状态无法确认（生产环境 fail-closed）——一律按未认证处理。
                SecurityContextHolder.clearContext();
            }
        }
        chain.doFilter(request, response);
    }
}
