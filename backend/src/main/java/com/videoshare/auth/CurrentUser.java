package com.videoshare.auth;
import com.videoshare.user.Role;
public record CurrentUser(long id, Role role, String jti) { }
