package com.videoshare.user;
import java.util.*; import org.springframework.data.jpa.repository.JpaRepository;
public interface UserRepository extends JpaRepository<User, Long> { Optional<User> findByEmail(String email); Optional<User> findByUsername(String username); Optional<User> findByPhone(String phone); boolean existsByEmail(String email); boolean existsByUsername(String username); }
