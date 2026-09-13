package com.videoshare.auth;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class RequestedWithFilter extends OncePerRequestFilter {
    private static final Set<String> SAFE=Set.of("GET","HEAD","OPTIONS");
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)throws ServletException,IOException{
        if(request.getRequestURI().startsWith("/api/")&&!SAFE.contains(request.getMethod())&&!"XMLHttpRequest".equals(request.getHeader("X-Requested-With"))){response.setStatus(403);response.setContentType("application/json;charset=UTF-8");response.getWriter().write("{\"code\":40301,\"message\":\"请求来源校验失败\",\"data\":null}");return;}chain.doFilter(request,response);
    }
}
