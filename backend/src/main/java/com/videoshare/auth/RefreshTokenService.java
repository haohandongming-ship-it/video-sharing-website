package com.videoshare.auth;

import com.videoshare.common.*;
import com.videoshare.user.User;
import java.nio.charset.StandardCharsets; import java.security.*; import java.time.Duration; import java.util.*;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.dao.DataAccessException;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

@Service
public class RefreshTokenService {
    private final StringRedisTemplate redis; private final AuthProperties props; private final boolean production; private final SecureRandom random = new SecureRandom(); private final Map<String,String> fallback=new java.util.concurrent.ConcurrentHashMap<>(); private final Map<Long,Set<String>> fallbackIndex=new java.util.concurrent.ConcurrentHashMap<>();
    public RefreshTokenService(StringRedisTemplate redis, AuthProperties props, Environment env) { this.redis=redis; this.props=props; this.production=env.matchesProfiles("prod"); }
    public String issue(User user) {
        String id=UUID.randomUUID().toString(); byte[] bytes=new byte[32]; random.nextBytes(bytes); String secret=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        if(!production){fallback.put(key(user.getId(),id),sha256(secret)); fallbackIndex.computeIfAbsent(user.getId(),ignored->java.util.concurrent.ConcurrentHashMap.newKeySet()).add(id);}
        try { redis.opsForValue().set(key(user.getId(),id), sha256(secret), Duration.ofSeconds(props.refreshTtlSeconds())); redis.opsForSet().add(index(user.getId()), id); redis.expire(index(user.getId()), Duration.ofSeconds(props.refreshTtlSeconds())); } catch(DataAccessException ex) { if(production)throw unavailable(); }
        return user.getId()+"."+id+"."+secret;
    }
    public long consume(String token) {
        String[] parts=token == null ? new String[0] : token.split("\\.",3);
        if(parts.length!=3) throw new ApiException(ErrorCode.TOKEN_INVALID,"登录状态已失效");
        long uid;
        try { uid=Long.parseLong(parts[0]); } catch(NumberFormatException ex) { throw new ApiException(ErrorCode.TOKEN_INVALID,"登录状态已失效"); }
        String used=get("auth:refresh:used:"+parts[1]);
        if (used != null) { revokeAll(uid); throw new ApiException(ErrorCode.TOKEN_INVALID,"检测到令牌复用，请重新登录"); }
        String key=key(uid,parts[1]);
        String value=get(key);
        if(value==null || !sha256(parts[2]).equals(value)) throw new ApiException(ErrorCode.TOKEN_INVALID,"登录状态已失效");
        if(!production){fallback.remove(key); Set<String> local=fallbackIndex.get(uid);if(local!=null)local.remove(parts[1]); fallback.put("auth:refresh:used:"+parts[1],Long.toString(uid));}
        try { redis.delete(key); redis.opsForSet().remove(index(uid),parts[1]); redis.opsForValue().set("auth:refresh:used:"+parts[1],Long.toString(uid),Duration.ofSeconds(props.refreshTtlSeconds())); } catch(DataAccessException ex) { if(production)throw unavailable(); }
        return uid;
    }
    public void revokeAll(long userId) { Set<String> local=fallbackIndex.remove(userId);if(local!=null)for(String id:local)fallback.remove(key(userId,id));try{Set<String> ids=redis.opsForSet().members(index(userId)); if(ids!=null) for(String id:ids) redis.delete(key(userId,id)); redis.delete(index(userId));}catch(DataAccessException ex){if(production)throw unavailable();} }
    private String get(String key){try{String value=redis.opsForValue().get(key);return value!=null?value:fallback.get(key);}catch(DataAccessException ex){if(production)throw unavailable();return fallback.get(key);}}
    private ApiException unavailable(){return new ApiException(ErrorCode.INTERNAL,"认证会话服务暂时不可用");}
    private String key(long userId,String id){ return "auth:refresh:"+userId+":"+id; } private String index(long userId){return "auth:refresh:index:"+userId;}
    private String sha256(String value) { try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); } catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);} }
}
