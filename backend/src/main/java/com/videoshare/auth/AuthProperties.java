package com.videoshare.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
@ConfigurationProperties(prefix = "app.auth")
public record AuthProperties(String issuer, String audience, long accessTtlSeconds, long refreshTtlSeconds, boolean secureCookie) { }
