package com.videoshare.auth;

import com.videoshare.common.ErrorCode;
import com.videoshare.common.ErrorResponder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    /** BCrypt 强度：12 轮在登录延迟与抗暴力破解之间取平衡。 */
    private static final int BCRYPT_STRENGTH = 12;

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(BCRYPT_STRENGTH);
    }

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http, JwtAuthenticationFilter jwt, RequestedWithFilter requestedWith,
                                    ErrorResponder errors) throws Exception {
        return http
                .csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(handling -> handling.authenticationEntryPoint(
                        (request, response, ex) -> errors.write(response, 401, ErrorCode.UNAUTHORIZED, "请先登录")))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/error", "/actuator/health", "/v3/api-docs/**", "/swagger-ui/**",
                                "/swagger-ui.html", "/ws/**", "/api/v1/auth/**", "/api/v1/uploads/*/parts/*").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/videos/*/view").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/comments/*/replies", "/api/v1/categories",
                                "/api/v1/videos/**", "/api/v1/users/**", "/api/v1/feeds/**",
                                "/api/v1/notifications/unread-count", "/api/v1/transcode/**", "/api/v1/sse/**").permitAll()
                        .anyRequest().authenticated())
                .addFilterBefore(requestedWith, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(jwt, UsernamePasswordAuthenticationFilter.class)
                .build();
    }
}
