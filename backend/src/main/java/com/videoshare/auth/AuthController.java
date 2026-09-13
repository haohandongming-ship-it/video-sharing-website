package com.videoshare.auth;

import com.videoshare.common.*; import com.videoshare.user.UserRepository; import jakarta.validation.Valid; import jakarta.servlet.http.*; import org.springframework.http.ResponseCookie; import org.springframework.security.core.annotation.AuthenticationPrincipal; import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/auth")
public class AuthController {
    private static final String REFRESH_COOKIE="video_refresh"; private final AuthService service; private final AuthProperties props; private final UserRepository users;
    public AuthController(AuthService service,AuthProperties props,UserRepository users){this.service=service;this.props=props;this.users=users;}
    @PostMapping("/register") public ApiResponse<AuthDtos.AuthData> register(@Valid @RequestBody AuthDtos.RegisterRequest request,HttpServletResponse response){var data=service.register(request); setFor(response,data.user().id()); return ApiResponse.ok(data);}
    @PostMapping("/login") public ApiResponse<AuthDtos.AuthData> login(@Valid @RequestBody AuthDtos.LoginRequest request,HttpServletResponse response){var data=service.login(request); setFor(response,data.user().id()); return ApiResponse.ok(data);}
    @PostMapping("/refresh") public ApiResponse<AuthDtos.AuthData> refresh(@CookieValue(name=REFRESH_COOKIE,required=false) String refresh,HttpServletResponse response){var data=service.refresh(refresh); setFor(response,data.user().id()); return ApiResponse.ok(data);}
    @PostMapping("/logout") public ApiResponse<java.util.Map<String,Boolean>> logout(@AuthenticationPrincipal CurrentUser user,HttpServletResponse response){if(user==null) throw new ApiException(ErrorCode.UNAUTHORIZED,"请先登录");service.logout(user); response.addHeader("Set-Cookie",ResponseCookie.from(REFRESH_COOKIE,"").path("/api/v1/auth").maxAge(0).httpOnly(true).secure(props.secureCookie()).sameSite("Strict").build().toString()); return ApiResponse.ok(java.util.Map.of("success",true));}
    private void setFor(HttpServletResponse response,long userId){var user=users.findById(userId).orElseThrow(()->new ApiException(ErrorCode.TOKEN_INVALID,"登录状态已失效"));set(response,service.refreshToken(user));}
    private void set(HttpServletResponse response,String refresh){response.addHeader("Set-Cookie",ResponseCookie.from(REFRESH_COOKIE,refresh).httpOnly(true).secure(props.secureCookie()).sameSite("Strict").path("/api/v1/auth").maxAge(props.refreshTtlSeconds()).build().toString());}
}
