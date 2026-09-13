package com.videoshare.auth;

import com.videoshare.common.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.Pattern;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.beans.factory.annotation.Value;

@RestController @RequestMapping("/api/v1/auth")
public class AuthExtrasController {
    private final StringRedisTemplate redis;private final Environment env;private final Map<String,Long> localLimits=new ConcurrentHashMap<>();
    @Value("${app.oauth.wechat-authorize-url:}") private String wechatAuthorizeUrl;
    @Value("${app.oauth.qq-authorize-url:}") private String qqAuthorizeUrl;
    public AuthExtrasController(StringRedisTemplate redis,Environment env){this.redis=redis;this.env=env;}
    @GetMapping("/captcha") public ApiResponse<Map<String,String>> captcha(){return ApiResponse.ok(Map.of("captchaId","cap_"+UUID.randomUUID(),"imageUrl","","question","3 + 5 = ?"));}
    @PostMapping("/sms-code") public ApiResponse<Map<String,Object>> send(@RequestBody SmsRequest body,HttpServletRequest request){if(body.phone()==null||!body.phone().matches("^1[3-9]\\d{9}$"))throw new ApiException(ErrorCode.VALIDATION,"手机号格式不正确");String key=body.phone()+":"+request.getRemoteAddr();long now=System.currentTimeMillis();Long previous=localLimits.put(key,now);if(previous!=null&&now-previous<60_000)throw new ApiException(ErrorCode.RATE_LIMITED,"请稍后再获取验证码");String code=env.matchesProfiles("prod")?String.format("%06d",new java.security.SecureRandom().nextInt(1_000_000)):"123456";try{redis.opsForValue().set("sms:code:"+body.phone(),code,Duration.ofMinutes(5));}catch(DataAccessException ex){if(env.matchesProfiles("prod"))throw new ApiException(ErrorCode.INTERNAL,"验证码服务暂时不可用");}Map<String,Object> result=new LinkedHashMap<>();result.put("sent",true);result.put("expiresIn",300);if(!env.matchesProfiles("prod"))result.put("mockCode",code);return ApiResponse.ok(result);}
    @GetMapping("/oauth/authorize-url") public ApiResponse<Map<String,String>> oauth(@RequestParam String provider){if(!Set.of("wechat","qq").contains(provider))throw new ApiException(ErrorCode.VALIDATION,"不支持的登录平台");String base="wechat".equals(provider)?wechatAuthorizeUrl:qqAuthorizeUrl;if(base==null||base.isBlank())throw new ApiException(ErrorCode.VALIDATION,"第三方登录尚未配置，请使用手机号或账号密码登录");String state="st_"+UUID.randomUUID();return ApiResponse.ok(Map.of("url",base+(base.contains("?")?"&":"?")+"state="+state,"state",state));}
    public record SmsRequest(@Pattern(regexp="^1[3-9]\\d{9}$")String phone,String captchaToken){}
}
