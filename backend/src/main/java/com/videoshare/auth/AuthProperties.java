package com.videoshare.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
@ConfigurationProperties(prefix = "app.auth")
public record AuthProperties(
        String issuer,
        String audience,
        long accessTtlSeconds,
        long refreshTtlSeconds,
        boolean secureCookie,
        /**
         * 是否允许在 Redis 不可用时用固定验证码 {@code 123456} 通过短信校验。
         *
         * <p>这是纯粹的本地开发便利开关，**默认 false**。此前它由「非 prod profile」隐式开启，
         * 意味着任何忘记设置 profile 的部署都等于开放一个「用 123456 登录任意手机号」的后门。
         * 现在必须由 {@code AUTH_ALLOW_FIXED_SMS_CODE=true} 显式打开（仅 application-dev.yml 启用）。</p>
         */
        boolean allowFixedSmsCode,
        String privateKeyBase64,
        String publicKeyBase64) { }
