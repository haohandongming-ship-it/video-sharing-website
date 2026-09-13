package com.videoshare.auth;

import jakarta.validation.constraints.*;
public final class AuthDtos {
    private AuthDtos() { }
    public record RegisterRequest(@NotBlank @Pattern(regexp="[A-Za-z0-9_]{3,32}") String username, @NotBlank @Email @Size(max=128) String email, @NotBlank @Size(min=8,max=72) String password, @NotBlank @Size(max=64) String nickname) { }
    public record LoginRequest(@NotBlank @Email String email, @NotBlank String password) { }
    public record AuthData(String accessToken, long expiresIn, UserData user) { }
    public record UserData(long id, String username, String nickname, String role) { }
}
