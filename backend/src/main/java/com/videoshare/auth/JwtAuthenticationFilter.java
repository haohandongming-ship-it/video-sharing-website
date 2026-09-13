package com.videoshare.auth;

import jakarta.servlet.*; import jakarta.servlet.http.*;
import java.io.IOException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.dao.DataAccessException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.core.env.Environment;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    private final JwtService jwtService; private final StringRedisTemplate redis; private final boolean production;
    public JwtAuthenticationFilter(JwtService jwtService, StringRedisTemplate redis, Environment env) { this.jwtService=jwtService; this.redis=redis; this.production=env.matchesProfiles("prod"); }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        String header=request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            try {
                var claims=jwtService.parse(header.substring(7)); String jti=claims.getId();
                try { if (Boolean.TRUE.equals(redis.hasKey("auth:jti:denylist:"+jti))) throw new IllegalArgumentException("revoked"); } catch(DataAccessException ex) { if(production)throw ex; }
                CurrentUser principal=new CurrentUser(Long.parseLong(claims.getSubject()), com.videoshare.user.Role.valueOf(claims.get("role", String.class)), jti);
                var authentication=new UsernamePasswordAuthenticationToken(principal, null, java.util.List.of(new SimpleGrantedAuthority("ROLE_"+principal.role().name())));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            } catch (RuntimeException ignored) { SecurityContextHolder.clearContext(); }
        }
        chain.doFilter(request,response);
    }
}
