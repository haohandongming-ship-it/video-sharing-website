package com.videoshare.auth;

import com.videoshare.common.*;
import com.videoshare.user.UserRepository;
import jakarta.validation.Valid;
import jakarta.servlet.http.*;
import java.util.Map;
import java.util.Objects;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/auth")
public class AuthController {
    private final AuthService service;
    private final AuthProperties props;
    private final UserRepository users;
    private final LoginThrottle throttle;
    public AuthController(AuthService service, AuthProperties props, UserRepository users, LoginThrottle throttle) {
        this.service=service; this.props=props; this.users=users; this.throttle=throttle;
    }
    @PostMapping("/register")
    public ApiResponse<AuthDtos.AuthData> register(@Valid @RequestBody AuthDtos.RegisterRequest request, HttpServletResponse response) {
        var data=service.register(request); setFor(response,data); return ApiResponse.ok(data);
    }
    @PostMapping("/login")
    public ApiResponse<AuthDtos.AuthData> login(@Valid @RequestBody AuthDtos.LoginRequest request, HttpServletRequest http, HttpServletResponse response) {
        var data=throttle.execute(identity(request),throttle.resolve(http),()->service.login(request));
        setFor(response,data); return ApiResponse.ok(data);
    }
    @PostMapping("/refresh")
    public ApiResponse<AuthDtos.AuthData> refresh(@CookieValue(name="video_refresh",required=false) String refresh,HttpServletResponse response) {
        var data=service.refresh(refresh); setFor(response,data); return ApiResponse.ok(data);
    }
    @PostMapping("/password/reset")
    public ApiResponse<Map<String,Boolean>> reset(@Valid @RequestBody AuthDtos.ResetPasswordRequest request, HttpServletRequest http) {
        // 重置密码同样校验短信验证码：不设失败预算就等于开放 6 位验证码的暴力破解通道。
        throttle.execute("reset:"+Objects.toString(request.phone(),""),throttle.resolve(http),()->{ service.resetPassword(request); return null; });
        return ApiResponse.ok(Map.of("success",true));
    }
    @PostMapping("/logout")
    public ApiResponse<Map<String,Boolean>> logout(@AuthenticationPrincipal CurrentUser user,HttpServletResponse response) {
        cookie(response,"video_refresh","","/api/v1/auth",0);
        cookie(response,"video_media","","/api/v1/videos",0);
        if(user==null) throw new ApiException(ErrorCode.UNAUTHORIZED,"请先登录");
        service.logout(user); return ApiResponse.ok(Map.of("success",true));
    }
    /** 短信登录按手机号计数、密码登录按账号计数：两者认证的标识不同，混用会让预算被绕过。 */
    private String identity(AuthDtos.LoginRequest request) {
        boolean sms="SMS".equalsIgnoreCase(request.grantType());
        return (sms?"sms:":"account:")+Objects.toString(sms?request.phone():request.account(),"");
    }
    private void setFor(HttpServletResponse response,AuthDtos.AuthData data) {
        var user=users.findById(data.user().id()).orElseThrow(()->new ApiException(ErrorCode.TOKEN_INVALID,"登录状态已失效"));
        cookie(response,"video_refresh",service.refreshToken(user),"/api/v1/auth",props.refreshTtlSeconds());
        // Native video/Range requests cannot attach a Bearer header. Only source GET accepts this cookie.
        cookie(response,"video_media",data.accessToken(),"/api/v1/videos",props.accessTtlSeconds());
    }
    private void cookie(HttpServletResponse response,String name,String value,String path,long age) {
        response.addHeader("Set-Cookie",ResponseCookie.from(name,value).httpOnly(true).secure(props.secureCookie())
                .sameSite("Strict").path(path).maxAge(age).build().toString());
    }
}
