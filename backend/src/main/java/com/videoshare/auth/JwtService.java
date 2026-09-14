package com.videoshare.auth;

import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import com.videoshare.user.User;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

/**
 * RSA 签名令牌的签发与校验。
 *
 * <p>密钥只在启动时解析一次；PEM 头尾的正则预编译为常量，避免每次解析密钥都
 * 重新编译 Pattern。生产环境强制要求显式配置密钥，禁止回落到随机生成的密钥对。</p>
 */
@Service
public class JwtService {

    private static final Pattern PEM_HEADER = Pattern.compile("-----BEGIN [^-]+-----");
    private static final Pattern PEM_FOOTER = Pattern.compile("-----END [^-]+-----");
    private static final Pattern WHITESPACE = Pattern.compile("\\s");
    private static final int RSA_KEY_SIZE = 2048;

    private final AuthProperties props;
    private final KeyPair keys;

    public JwtService(AuthProperties props, Environment env) {
        this.props = props;
        this.keys = loadKeys(props, env);
    }

    public Token create(User user) {
        Instant now = Instant.now();
        Instant expiresAt = now.plusSeconds(props.accessTtlSeconds());
        String jti = UUID.randomUUID().toString();
        String value = Jwts.builder()
                .issuer(props.issuer())
                .audience().add(props.audience()).and()
                .subject(user.getId().toString())
                .claim("role", user.getRole().name())
                .id(jti)
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiresAt))
                .signWith(keys.getPrivate(), Jwts.SIG.RS256)
                .compact();
        return new Token(value, jti, expiresAt);
    }

    public Claims parse(String token) {
        try {
            return Jwts.parser()
                    .verifyWith((RSAPublicKey) keys.getPublic())
                    .requireIssuer(props.issuer())
                    .requireAudience(props.audience())
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
        } catch (JwtException | IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.TOKEN_INVALID, "登录状态已失效");
        }
    }

    public record Token(String value, String jti, Instant expiresAt) { }

    private static KeyPair loadKeys(AuthProperties properties, Environment env) {
        String privateKey = properties.privateKeyBase64();
        String publicKey = properties.publicKeyBase64();
        boolean configured = privateKey != null && !privateKey.isBlank() && publicKey != null && !publicKey.isBlank();
        try {
            if (configured) {
                KeyFactory factory = KeyFactory.getInstance("RSA");
                Base64.Decoder decoder = Base64.getMimeDecoder();
                return new KeyPair(
                        factory.generatePublic(new X509EncodedKeySpec(decoder.decode(stripPem(publicKey)))),
                        factory.generatePrivate(new PKCS8EncodedKeySpec(decoder.decode(stripPem(privateKey)))));
            }
            if (env.matchesProfiles("prod")) {
                throw new IllegalStateException("生产环境必须配置 JWT_PRIVATE_KEY_BASE64 与 JWT_PUBLIC_KEY_BASE64");
            }
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(RSA_KEY_SIZE);
            return generator.generateKeyPair();
        } catch (GeneralSecurityException | IllegalArgumentException ex) {
            throw new IllegalStateException("RSA 签名密钥格式无效", ex);
        }
    }

    private static String stripPem(String value) {
        return WHITESPACE.matcher(PEM_FOOTER.matcher(PEM_HEADER.matcher(value).replaceAll("")).replaceAll("")).replaceAll("");
    }
}
