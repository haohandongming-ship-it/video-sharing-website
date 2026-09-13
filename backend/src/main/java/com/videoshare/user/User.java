package com.videoshare.user;

import jakarta.persistence.*;
import java.time.Instant;

@Entity @Table(name = "users")
public class User {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(nullable = false, unique = true, length = 32) private String username;
    @Column(nullable = false, unique = true, length = 128) private String email;
    @Column(unique = true, length = 20) private String phone;
    @Column(name = "password_hash", nullable = false, length = 100) private String passwordHash;
    @Column(nullable = false, length = 64) private String nickname;
    @Column(name = "avatar_url", length = 512) private String avatarUrl;
    @Column(length = 500) private String bio;
    @Enumerated(EnumType.STRING) @Column(nullable = false) private Role role = Role.USER;
    @Enumerated(EnumType.STRING) @Column(nullable = false) private UserStatus status = UserStatus.ACTIVE;
    @Column(name = "created_at", nullable = false, updatable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Column(name = "last_login_at") private Instant lastLoginAt;
    @PrePersist void create() { createdAt = Instant.now(); updatedAt=createdAt; }
    @PreUpdate void updateTime() { updatedAt=Instant.now(); }
    public Long getId() { return id; } public String getUsername() { return username; } public String getEmail() { return email; }
    public String getPhone(){return phone;} public String getPasswordHash() { return passwordHash; } public String getNickname() { return nickname; } public String getAvatarUrl(){return avatarUrl;} public String getBio(){return bio;} public Role getRole() { return role; } public UserStatus getStatus() { return status; } public Instant getCreatedAt(){return createdAt;} public Instant getUpdatedAt(){return updatedAt;} public Instant getLastLoginAt(){return lastLoginAt;}
    public void register(String username, String email, String phone, String passwordHash, String nickname) { this.username=username; this.email=email; this.phone=phone; this.passwordHash=passwordHash; this.nickname=nickname; }
    public void updateProfile(String nickname,String bio,String avatarUrl){if(nickname!=null&&!nickname.isBlank())this.nickname=nickname;if(bio!=null)this.bio=bio;if(avatarUrl!=null)this.avatarUrl=avatarUrl;}
    public void changePassword(String hash){this.passwordHash=hash;} public void loginNow(){this.lastLoginAt=Instant.now();}
    public void changeStatus(UserStatus status){this.status=status;} public void changeRole(Role role){this.role=role;}
}
