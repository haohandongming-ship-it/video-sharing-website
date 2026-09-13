package com.videoshare.auth;

import com.videoshare.common.*;
import com.videoshare.user.User;
import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import java.security.*;
import java.time.Instant;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
    private final AuthProperties props; private final KeyPair keys;
    public JwtService(AuthProperties props, Environment env) {
        this.props = props;
        try { KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048); this.keys = generator.generateKeyPair(); }
        catch (GeneralSecurityException e) { throw new IllegalStateException("无法初始化 RSA 签名密钥", e); }
    }
    public Token create(User user) {
        Instant now = Instant.now(); String jti = UUID.randomUUID().toString();
        String token = Jwts.builder().issuer(props.issuer()).audience().add(props.audience()).and().subject(user.getId().toString())
                .claim("role", user.getRole().name()).id(jti).issuedAt(Date.from(now)).expiration(Date.from(now.plusSeconds(props.accessTtlSeconds()))).signWith(keys.getPrivate(), Jwts.SIG.RS256).compact();
        return new Token(token, jti, now.plusSeconds(props.accessTtlSeconds()));
    }
    public Claims parse(String token) {
        try { return Jwts.parser().verifyWith((java.security.interfaces.RSAPublicKey) keys.getPublic()).requireIssuer(props.issuer()).requireAudience(props.audience()).build().parseSignedClaims(token).getPayload(); }
        catch (JwtException | IllegalArgumentException ex) { throw new ApiException(ErrorCode.TOKEN_INVALID, "登录状态已失效"); }
    }
    public record Token(String value, String jti, Instant expiresAt) { }
}
