package com.videoshare.auth;

import com.videoshare.common.*;
import com.videoshare.user.User;
import io.jsonwebtoken.*;
import java.security.*;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
    private final AuthProperties props; private final KeyPair keys;
    public JwtService(AuthProperties props, Environment env) {
        this.props = props;
        this.keys = loadKeys(props, env);
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

    private KeyPair loadKeys(AuthProperties properties, Environment env) {
        String privateKey = properties.privateKeyBase64();
        String publicKey = properties.publicKeyBase64();
        boolean configured = privateKey != null && !privateKey.isBlank() && publicKey != null && !publicKey.isBlank();
        boolean production = Arrays.asList(env.getActiveProfiles()).contains("prod");
        try {
            if (configured) {
                KeyFactory factory = KeyFactory.getInstance("RSA");
                Base64.Decoder decoder = Base64.getMimeDecoder();
                return new KeyPair(
                        factory.generatePublic(new X509EncodedKeySpec(decoder.decode(stripPem(publicKey)))),
                        factory.generatePrivate(new PKCS8EncodedKeySpec(decoder.decode(stripPem(privateKey)))));
            }
            if (production) {
                throw new IllegalStateException("生产环境必须配置 JWT_PRIVATE_KEY_BASE64 与 JWT_PUBLIC_KEY_BASE64");
            }
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new IllegalStateException("RSA 签名密钥格式无效", e);
        }
    }

    private String stripPem(String value) {
        return value.replaceAll("-----BEGIN [^-]+-----", "")
                .replaceAll("-----END [^-]+-----", "")
                .replaceAll("\\s", "");
    }
}
