package com.videoshare.auth;

import com.videoshare.common.ErrorCode;
import com.videoshare.common.ErrorResponder;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 轻量 CSRF 防护：只对写操作要求 {@code X-Requested-With}，与 SameSite=Strict 的
 * 刷新令牌 Cookie 配合使用。</p>
 */
@Component
public class RequestedWithFilter extends OncePerRequestFilter {

    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS");
    private static final String HEADER = "X-Requested-With";
    private static final String REQUIRED_VALUE = "XMLHttpRequest";

    private final ErrorResponder errors;

    public RequestedWithFilter(ErrorResponder errors) {
        this.errors = errors;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (requiresHeader(request) && !REQUIRED_VALUE.equals(request.getHeader(HEADER))) {
            errors.write(response, 403, ErrorCode.FORBIDDEN, "请求来源校验失败");
            return;
        }
        chain.doFilter(request, response);
    }

    private static boolean requiresHeader(HttpServletRequest request) {
        return request.getRequestURI().startsWith("/api/") && !SAFE_METHODS.contains(request.getMethod());
    }
}
