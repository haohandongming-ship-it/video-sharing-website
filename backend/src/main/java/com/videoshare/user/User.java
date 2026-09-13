package com.videoshare.user;

import jakarta.persistence.*;
import java.time.Instant;

@Entity @Table(name = "users")
public class User {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @Column(nullable = false, unique = true, length = 32) private String username;
    @Column(nullable = false, unique = true, length = 128) private String email;
    @Column(name = "password_hash", nullable = false, length = 100) private String passwordHash;
    @Column(nullable = false, length = 64) private String nickname;
    @Enumerated(EnumType.STRING) @Column(nullable = false) private Role role = Role.USER;
    @Enumerated(EnumType.STRING) @Column(nullable = false) private UserStatus status = UserStatus.ACTIVE;
    @Column(name = "created_at", nullable = false, updatable = false) private Instant createdAt;
    @PrePersist void create() { createdAt = Instant.now(); }
    public Long getId() { return id; } public String getUsername() { return username; } public String getEmail() { return email; }
    public String getPasswordHash() { return passwordHash; } public String getNickname() { return nickname; } public Role getRole() { return role; } public UserStatus getStatus() { return status; }
    public void register(String username, String email, String passwordHash, String nickname) { this.username=username; this.email=email; this.passwordHash=passwordHash; this.nickname=nickname; }
}
