package com.videoshare.auth;

import com.videoshare.common.*; import com.videoshare.user.*; import java.time.Duration;
import org.springframework.data.redis.core.StringRedisTemplate; import org.springframework.security.crypto.password.PasswordEncoder; import org.springframework.stereotype.Service; import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
    private final UserRepository users; private final PasswordEncoder encoder; private final JwtService jwt; private final RefreshTokenService refresh; private final StringRedisTemplate redis; private final AuthProperties props;
    public AuthService(UserRepository users,PasswordEncoder encoder,JwtService jwt,RefreshTokenService refresh,StringRedisTemplate redis,AuthProperties props){this.users=users;this.encoder=encoder;this.jwt=jwt;this.refresh=refresh;this.redis=redis;this.props=props;}
    @Transactional public AuthDtos.AuthData register(AuthDtos.RegisterRequest request) { if(users.existsByEmail(request.email())||users.existsByUsername(request.username())) throw new ApiException(ErrorCode.CONFLICT,"邮箱或用户名已被使用"); User user=new User(); user.register(request.username(),request.email(),encoder.encode(request.password()),request.nickname()); users.save(user); return token(user); }
    public AuthDtos.AuthData login(AuthDtos.LoginRequest request) { User user=users.findByEmail(request.email()).orElseThrow(()->new ApiException(ErrorCode.UNAUTHORIZED,"邮箱或密码错误")); if(user.getStatus()!=UserStatus.ACTIVE||!encoder.matches(request.password(),user.getPasswordHash())) throw new ApiException(ErrorCode.UNAUTHORIZED,"邮箱或密码错误"); return token(user); }
    public AuthDtos.AuthData refresh(String token) { long userId=refresh.consume(token); User user=users.findById(userId).orElseThrow(()->new ApiException(ErrorCode.TOKEN_INVALID,"登录状态已失效")); return token(user); }
    public void logout(CurrentUser user) { redis.opsForValue().set("auth:jti:denylist:"+user.jti(),"1",Duration.ofSeconds(props.accessTtlSeconds())); refresh.revokeAll(user.id()); }
    public String refreshToken(User user) { return refresh.issue(user); }
    private AuthDtos.AuthData token(User user) { JwtService.Token token=jwt.create(user); return new AuthDtos.AuthData(token.value(),props.accessTtlSeconds(),new AuthDtos.UserData(user.getId(),user.getUsername(),user.getNickname(),user.getRole().name())); }
}
