package com.videoshare.auth;

import org.springframework.context.annotation.*;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.http.HttpMethod;

@Configuration @EnableWebSecurity @EnableMethodSecurity
public class SecurityConfig {
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(12); }
    @Bean SecurityFilterChain filterChain(HttpSecurity http, JwtAuthenticationFilter jwt, RequestedWithFilter requestedWith) throws Exception {
        return http.csrf(csrf -> csrf.disable()).cors(Customizer.withDefaults()).sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .exceptionHandling(e -> e.authenticationEntryPoint((req,res,ex)->{res.setStatus(401);res.setContentType("application/json;charset=UTF-8");res.getWriter().write("{\"code\":40101,\"message\":\"请先登录\",\"data\":null}");}))
            .authorizeHttpRequests(a -> a.requestMatchers("/error","/actuator/health","/v3/api-docs/**","/swagger-ui/**","/swagger-ui.html","/ws/**","/api/v1/auth/**","/api/v1/uploads/*/parts/*").permitAll().requestMatchers(HttpMethod.POST,"/api/v1/videos/*/view").permitAll().requestMatchers(HttpMethod.GET,"/api/v1/comments/*/replies","/api/v1/categories","/api/v1/videos/**","/api/v1/users/**","/api/v1/feeds/**","/api/v1/notifications/unread-count","/api/v1/transcode/**","/api/v1/sse/**").permitAll().anyRequest().authenticated())
            .addFilterBefore(requestedWith, UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(jwt, UsernamePasswordAuthenticationFilter.class).build();
    }
}
