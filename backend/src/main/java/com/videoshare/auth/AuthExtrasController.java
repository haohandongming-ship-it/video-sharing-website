package com.videoshare.auth;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.videoshare.common.ApiException;
import com.videoshare.common.ApiResponse;
import com.videoshare.common.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.Pattern;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 验证码、图形验证码与第三方登录入口。
 *
 * <p>限流表改为 60 秒过期的有界 Caffeine 缓存（原先的 ConcurrentHashMap 永不清理），
 * {@link SecureRandom} 提为常量字段（原先每次发送验证码都重新实例化）。</p>
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthExtrasController {

    private static final Duration SMS_CODE_TTL = Duration.ofMinutes(5);
    private static final Duration SMS_RATE_LIMIT = Duration.ofSeconds(60);
    private static final String PHONE_PATTERN = "^1[3-9]\\d{9}$";
    private static final Set<String> OAUTH_PROVIDERS = Set.of("wechat", "qq");

    private final StringRedisTemplate redis;
    private final boolean production;
    private final SecureRandom random = new SecureRandom();
    private final Cache<String, Long> smsRateLimit = Caffeine.newBuilder()
            .maximumSize(100_000)
            .expireAfterWrite(SMS_RATE_LIMIT)
            .build();

    @Value("${app.oauth.wechat-authorize-url:}")
    private String wechatAuthorizeUrl;

    @Value("${app.oauth.qq-authorize-url:}")
    private String qqAuthorizeUrl;

    public AuthExtrasController(StringRedisTemplate redis, Environment env) {
        this.redis = redis;
        this.production = env.matchesProfiles("prod");
    }

    @GetMapping("/captcha")
    public ApiResponse<Map<String, String>> captcha() {
        return ApiResponse.ok(Map.of("captchaId", "cap_" + UUID.randomUUID(), "imageUrl", "", "question", "3 + 5 = ?"));
    }

    @PostMapping("/sms-code")
    public ApiResponse<Map<String, Object>> send(@RequestBody SmsRequest body, HttpServletRequest request) {
        if (body.phone() == null || !body.phone().matches(PHONE_PATTERN)) {
            throw new ApiException(ErrorCode.VALIDATION, "手机号格式不正确");
        }
        String rateKey = body.phone() + ":" + request.getRemoteAddr();
        long now = System.currentTimeMillis();
        Long previous = smsRateLimit.asMap().putIfAbsent(rateKey, now);
        if (previous != null && now - previous < SMS_RATE_LIMIT.toMillis()) {
            throw new ApiException(ErrorCode.RATE_LIMITED, "请稍后再获取验证码");
        }
        smsRateLimit.put(rateKey, now);
        String code = production ? String.format("%06d", random.nextInt(1_000_000)) : "123456";
        try {
            redis.opsForValue().set("sms:code:" + body.phone(), code, SMS_CODE_TTL);
        } catch (DataAccessException ex) {
            if (production) throw new ApiException(ErrorCode.INTERNAL, "验证码服务暂时不可用");
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sent", true);
        result.put("expiresIn", SMS_CODE_TTL.toSeconds());
        if (!production) result.put("mockCode", code);
        return ApiResponse.ok(result);
    }

    @GetMapping("/oauth/authorize-url")
    public ApiResponse<Map<String, String>> oauth(@RequestParam String provider) {
        if (!OAUTH_PROVIDERS.contains(provider)) throw new ApiException(ErrorCode.VALIDATION, "不支持的登录平台");
        String base = "wechat".equals(provider) ? wechatAuthorizeUrl : qqAuthorizeUrl;
        if (base == null || base.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION, "第三方登录尚未配置，请使用手机号或账号密码登录");
        }
        String state = "st_" + UUID.randomUUID();
        return ApiResponse.ok(Map.of("url", base + (base.contains("?") ? "&" : "?") + "state=" + state, "state", state));
    }

    public record SmsRequest(@Pattern(regexp = PHONE_PATTERN) String phone, String captchaToken) { }
}
