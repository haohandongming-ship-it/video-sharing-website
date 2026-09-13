package com.videoshare.auth;

import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.List;
public final class AuthDtos {
    private AuthDtos() { }
    public record RegisterRequest(@NotBlank @Pattern(regexp="[A-Za-z0-9_]{3,32}") String username, @NotBlank @Email @Size(max=128) String email, @NotBlank @Size(min=8,max=72) String password, @NotBlank @Size(max=64) String nickname, @Pattern(regexp="^$|^1[3-9]\\d{9}$") String phone, String smsCode, @AssertTrue boolean agreeTerms) { }
    public record LoginRequest(String account, String password, String phone, String code, String grantType) { }
    public record AuthData(String accessToken, long expiresIn, UserData user) { }
    public record UserData(long id,String username,String nickname,String avatar,String bio,boolean certified,long followerCount,String role,String status,List<String> permissions,long followingCount,long videoCount,long totalViews,long totalLikes,Instant createdAt,boolean followed,boolean mutual,boolean subscribed,String email,String phone,String realNameStatus) { }
}
