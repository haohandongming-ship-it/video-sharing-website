package com.videoshare.auth;

import com.videoshare.common.*;
import com.videoshare.user.User;
import java.nio.charset.StandardCharsets; import java.security.*; import java.time.Duration; import java.util.*;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class RefreshTokenService {
    private final StringRedisTemplate redis; private final AuthProperties props; private final SecureRandom random = new SecureRandom();
    public RefreshTokenService(StringRedisTemplate redis, AuthProperties props) { this.redis=redis; this.props=props; }
    public String issue(User user) {
        String id=UUID.randomUUID().toString(); byte[] bytes=new byte[32]; random.nextBytes(bytes); String secret=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        redis.opsForValue().set(key(user.getId(),id), sha256(secret), Duration.ofSeconds(props.refreshTtlSeconds()));
        redis.opsForSet().add(index(user.getId()), id); redis.expire(index(user.getId()), Duration.ofSeconds(props.refreshTtlSeconds()));
        return id+"."+secret;
    }
    public long consume(String token) {
        String[] parts=token == null ? new String[0] : token.split("\\.",2); if(parts.length!=2) throw new ApiException(ErrorCode.TOKEN_INVALID,"登录状态已失效");
        String used=redis.opsForValue().get("auth:refresh:used:"+parts[0]);
        if (used != null) { revokeAll(Long.parseLong(used)); throw new ApiException(ErrorCode.TOKEN_INVALID,"检测到令牌复用，请重新登录"); }
        var connection=redis.getConnectionFactory().getConnection();
        try {
            byte[] keyBytes=connection.keyCommands().keys(("auth:refresh:*").getBytes(StandardCharsets.UTF_8)).stream().filter(k -> new String(k,StandardCharsets.UTF_8).endsWith(":"+parts[0])).findFirst().orElse(null);
            if(keyBytes==null) throw new ApiException(ErrorCode.TOKEN_INVALID,"登录状态已失效");
            String value=redis.opsForValue().get(new String(keyBytes,StandardCharsets.UTF_8));
            if(!sha256(parts[1]).equals(value)) throw new ApiException(ErrorCode.TOKEN_INVALID,"登录状态已失效");
            long uid=Long.parseLong(new String(keyBytes,StandardCharsets.UTF_8).split(":")[2]); redis.delete(new String(keyBytes,StandardCharsets.UTF_8)); redis.opsForSet().remove(index(uid),parts[0]);
            redis.opsForValue().set("auth:refresh:used:"+parts[0],Long.toString(uid),Duration.ofSeconds(props.refreshTtlSeconds())); return uid;
        } finally { connection.close(); }
    }
    public void revokeAll(long userId) { Set<String> ids=redis.opsForSet().members(index(userId)); if(ids!=null) for(String id:ids) redis.delete(key(userId,id)); redis.delete(index(userId)); }
    private String key(long userId,String id){ return "auth:refresh:"+userId+":"+id; } private String index(long userId){return "auth:refresh:index:"+userId;}
    private String sha256(String value) { try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); } catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);} }
}
