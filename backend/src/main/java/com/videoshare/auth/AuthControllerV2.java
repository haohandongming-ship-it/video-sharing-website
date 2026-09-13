package com.videoshare.auth;

import com.videoshare.common.ApiResponse;
import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import com.videoshare.user.UserRepository;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.annotation.AuthenticationPrincipal;

@org.springframework.web.bind.annotation.RestController
@org.springframework.web.bind.annotation.RequestMapping("/api/v1/auth")
public class AuthControllerV2 {
    private static final String REFRESH_COOKIE = "video_refresh";
    private final AuthService auth; private final RefreshTokenService refresh; private final UserRepository users; private final AuthProperties properties;
    public AuthControllerV2(AuthService auth, RefreshTokenService refresh, UserRepository users, AuthProperties properties) { this.auth=auth; this.refresh=refresh; this.users=users; this.properties=properties; }
    @org.springframework.web.bind.annotation.PostMapping("/register")
    public ApiResponse<AuthDtos.AuthData> register(@Valid @org.springframework.web.bind.annotation.RequestBody AuthDtos.RegisterRequest request, HttpServletResponse response) { var data=auth.register(request); cookie(response,data.user().id()); return ApiResponse.ok(data); }
    @org.springframework.web.bind.annotation.PostMapping("/login")
    public ApiResponse<AuthDtos.AuthData> login(@Valid @org.springframework.web.bind.annotation.RequestBody AuthDtos.LoginRequest request, HttpServletResponse response) { var data=auth.login(request); cookie(response,data.user().id()); return ApiResponse.ok(data); }
    @org.springframework.web.bind.annotation.PostMapping("/refresh")
    public ApiResponse<AuthDtos.AuthData> refresh(@org.springframework.web.bind.annotation.CookieValue(name=REFRESH_COOKIE,required=false) String value, HttpServletResponse response) { var data=auth.refresh(value); cookie(response,data.user().id()); return ApiResponse.ok(data); }
    @org.springframework.web.bind.annotation.PostMapping("/logout")
    public ApiResponse<Void> logout(@AuthenticationPrincipal CurrentUser user, HttpServletResponse response) { if(user==null) throw new ApiException(ErrorCode.UNAUTHORIZED,"请先登录"); auth.logout(user); response.addHeader("Set-Cookie", expiredCookie()); return ApiResponse.ok(null); }
    private void cookie(HttpServletResponse response,long userId) { var user=users.findById(userId).orElseThrow(()->new ApiException(ErrorCode.TOKEN_INVALID,"登录状态已失效")); String value=refresh.issue(user); response.addHeader("Set-Cookie", ResponseCookie.from(REFRESH_COOKIE,value).httpOnly(true).secure(properties.secureCookie()).sameSite("Strict").path("/api/v1/auth").maxAge(properties.refreshTtlSeconds()).build().toString()); }
    private String expiredCookie() { return ResponseCookie.from(REFRESH_COOKIE,"").path("/api/v1/auth").maxAge(0).httpOnly(true).secure(properties.secureCookie()).sameSite("Strict").build().toString(); }
}
