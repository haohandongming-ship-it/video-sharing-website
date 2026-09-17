package com.videoshare.auth;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class SensitiveDataCipher {
    private static final int IV_LENGTH = 12;
    private final SecretKey key;
    private final SecureRandom random = new SecureRandom();

    public SensitiveDataCipher(@Value("${app.security.data-key-base64:}") String encodedKey, Environment env) {
        boolean production = Arrays.asList(env.getActiveProfiles()).contains("prod");
        try {
            if (encodedKey != null && !encodedKey.isBlank()) {
                byte[] raw = Base64.getDecoder().decode(encodedKey);
                if (raw.length != 32) throw new IllegalArgumentException("数据加密密钥必须为 32 字节");
                this.key = new SecretKeySpec(raw, "AES");
            } else if (production) {
                throw new IllegalStateException("生产环境必须配置 DATA_ENCRYPTION_KEY_BASE64");
            } else {
                KeyGenerator generator = KeyGenerator.getInstance("AES");
                generator.init(256);
                this.key = generator.generateKey();
            }
        } catch (GeneralSecurityException | IllegalArgumentException ex) {
            throw new IllegalStateException("无法初始化敏感数据加密密钥", ex);
        }
    }

    public String encrypt(String plaintext) {
        try {
            byte[] iv = new byte[IV_LENGTH];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] payload = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, payload, 0, iv.length);
            System.arraycopy(encrypted, 0, payload, iv.length, encrypted.length);
            return Base64.getEncoder().encodeToString(payload);
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException("敏感数据加密失败", ex);
        }
    }

    /**
     * 解密（实名审核需要读到原值）。
     * 输入为 {@link #encrypt} 产出的「IV + 密文」Base64；格式不合法或密钥不匹配时抛异常，
     * 由调用方决定如何兜底——审核队列不应因为单条脏数据整体失败。
     */
    public String decrypt(String encoded) {
        if (encoded == null || encoded.isBlank()) return null;
        try {
            byte[] payload = Base64.getDecoder().decode(encoded);
            if (payload.length <= IV_LENGTH) throw new IllegalArgumentException("密文长度不足");
            byte[] iv = new byte[IV_LENGTH];
            System.arraycopy(payload, 0, iv, 0, IV_LENGTH);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] plain = cipher.doFinal(payload, IV_LENGTH, payload.length - IV_LENGTH);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException ex) {
            throw new IllegalStateException("敏感数据解密失败", ex);
        }
    }
}
