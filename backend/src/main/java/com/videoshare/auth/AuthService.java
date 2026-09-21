package com.videoshare.auth;

import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import com.videoshare.common.PermissionSets;
import com.videoshare.user.Role;
import com.videoshare.user.User;
import com.videoshare.user.UserRepository;
import com.videoshare.user.UserStatus;
import java.util.Map;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 注册、登录与令牌签发。
 *
 * <p>用户档案的六项统计从六条 SQL 收敛为一条带标量子查询的聚合语句，登录/注册/
 * 刷新令牌这些高频路径因此少五次数据库往返。权限列表改由 {@link PermissionSets}
 * 统一产出，不再与 ViewFactory 各存一份。</p>
 */
@Service
public class AuthService {

    /** 本地开发用的固定验证码，仅在 {@code app.auth.allow-fixed-sms-code=true} 时生效。 */
    private static final String DEV_FIXED_SMS_CODE = "123456";

    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final RefreshTokenService refresh;
    private final TokenDenylist denylist;
    private final StringRedisTemplate redis;
    private final AuthProperties props;
    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;
    private final boolean production;

    public AuthService(UserRepository users, PasswordEncoder encoder, JwtService jwt, RefreshTokenService refresh,
                       TokenDenylist denylist, StringRedisTemplate redis, AuthProperties props, JdbcTemplate jdbc,
                       NamedParameterJdbcTemplate named, Environment env) {
        this.users = users;
        this.encoder = encoder;
        this.jwt = jwt;
        this.refresh = refresh;
        this.denylist = denylist;
        this.redis = redis;
        this.props = props;
        this.jdbc = jdbc;
        this.named = named;
        this.production = env.matchesProfiles("prod");
    }

    @Transactional
    public AuthDtos.AuthData register(AuthDtos.RegisterRequest request) {
        if (users.existsByEmail(request.email()) || users.existsByUsername(request.username())) {
            throw new ApiException(ErrorCode.CONFLICT, "邮箱或用户名已被使用");
        }
        User user = new User();
        user.register(request.username(), request.email(), blankToNull(request.phone()),
                encoder.encode(request.password()), request.nickname());
        users.save(user);
        jdbc.update("INSERT INTO creator_profiles(user_id,auth_status,trust_score) VALUES (?,?,?)", user.getId(), "NONE", 0);
        return token(user);
    }

    @Transactional
    public void resetPassword(AuthDtos.ResetPasswordRequest request) {
        if (!validSms(request.phone(), request.code())) throw new ApiException(ErrorCode.SMS_INVALID, "验证码错误或已失效");
        User user = users.findByPhone(request.phone())
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "该手机号尚未注册"));
        user.changePassword(encoder.encode(request.password()));
        users.save(user);
        refresh.revokeAll(user.getId());
        try {
            redis.delete("sms:code:" + request.phone());
        } catch (DataAccessException ex) {
            if (production) throw new ApiException(ErrorCode.INTERNAL, "验证码服务暂时不可用");
        }
    }

    @Transactional
    public AuthDtos.AuthData login(AuthDtos.LoginRequest request) {
        User user;
        if ("SMS".equalsIgnoreCase(request.grantType())) {
            if (request.phone() == null || request.code() == null || !validSms(request.phone(), request.code())) {
                throw new ApiException(ErrorCode.SMS_INVALID, "验证码错误或已失效");
            }
            user = users.findByPhone(request.phone())
                    .orElseThrow(() -> new ApiException(ErrorCode.BAD_CREDENTIALS, "手机号尚未注册"));
        } else {
            if (request.account() == null || request.password() == null) {
                throw new ApiException(ErrorCode.VALIDATION, "请输入账号和密码");
            }
            user = users.findByEmail(request.account())
                    .or(() -> users.findByUsername(request.account()))
                    .orElseThrow(() -> new ApiException(ErrorCode.BAD_CREDENTIALS, "账号或密码错误"));
            if (!encoder.matches(request.password(), user.getPasswordHash())) {
                throw new ApiException(ErrorCode.BAD_CREDENTIALS, "账号或密码错误");
            }
        }
        if (user.getStatus() != UserStatus.ACTIVE) throw new ApiException(ErrorCode.FORBIDDEN, "账号当前不可用");
        user.loginNow();
        return token(user);
    }

    public AuthDtos.AuthData refresh(String token) {
        long userId = refresh.consume(token);
        User user = users.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.TOKEN_INVALID, "登录状态已失效"));
        return token(user);
    }

    public void logout(CurrentUser user) {
        // 吊销交给 TokenDenylist：非生产环境有本地降级黑名单，没有 Redis 时登出同样生效；
        // 生产环境 Redis 不可用会抛出业务错误，而不是返回「成功」却留下可用的令牌。
        denylist.revoke(user.jti());
        refresh.revokeAll(user.id());
    }

    public String refreshToken(User user) {
        return refresh.issue(user);
    }

    public AuthDtos.UserData profile(User user) {
        ProfileStats stats = named.queryForObject("""
                SELECT
                  (SELECT COUNT(*) FROM creator_profiles WHERE user_id=:id AND auth_status='CERTIFIED') AS certified,
                  (SELECT COUNT(*) FROM follows WHERE followee_id=:id) AS followers,
                  (SELECT COUNT(*) FROM follows WHERE follower_id=:id) AS following,
                  (SELECT COUNT(*) FROM videos WHERE user_id=:id AND status<>'DELETED') AS videos,
                  (SELECT COALESCE(SUM(view_count),0) FROM videos WHERE user_id=:id) AS views,
                  (SELECT COALESCE(SUM(like_count),0) FROM videos WHERE user_id=:id) AS likes
                """, Map.of("id", user.getId()), (rs, row) -> new ProfileStats(
                rs.getLong("certified") > 0, rs.getLong("followers"), rs.getLong("following"),
                rs.getLong("videos"), rs.getLong("views"), rs.getLong("likes")));
        boolean certified = stats != null && stats.certified();
        long followers = stats == null ? 0 : stats.followers();
        long following = stats == null ? 0 : stats.following();
        long videos = stats == null ? 0 : stats.videos();
        long views = stats == null ? 0 : stats.views();
        long likes = stats == null ? 0 : stats.likes();
        return new AuthDtos.UserData(user.getId(), user.getUsername(), user.getNickname(), user.getAvatarUrl(),
                user.getBio(), certified, followers, user.getRole().name(), user.getStatus().name(),
                PermissionSets.of(user.getRole(), certified), following, videos, views, likes, user.getCreatedAt(),
                false, false, false, user.getEmail(), maskPhone(user.getPhone()), certified ? "CERTIFIED" : "NONE");
    }

    private AuthDtos.AuthData token(User user) {
        JwtService.Token token = jwt.create(user);
        return new AuthDtos.AuthData(token.value(), props.accessTtlSeconds(), profile(user));
    }

    /**
     * 校验短信验证码。
     *
     * <p>Redis 不可用时的降级行为由显式开关 {@code app.auth.allow-fixed-sms-code} 决定，
     * 而**不再**由「当前不是 prod」隐式决定：此前任何未设置 profile 的部署都会静默接受
     * 固定验证码 {@value #DEV_FIXED_SMS_CODE}，等于开放「用该码登录任意已注册手机号」的后门。
     * 现在默认 fail-closed，只有本地开发显式打开才走固定码。</p>
     */
    private boolean validSms(String phone, String code) {
        if (code == null || code.isBlank()) return false;
        try {
            String value = redis.opsForValue().get("sms:code:" + phone);
            return code.equals(value);
        } catch (DataAccessException ex) {
            if (!props.allowFixedSmsCode()) {
                throw new ApiException(ErrorCode.INTERNAL, "验证码服务暂时不可用");
            }
            return DEV_FIXED_SMS_CODE.equals(code);
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static String maskPhone(String value) {
        return value == null ? null : value.replaceAll("(\\d{3})\\d{4}(\\d{4})", "$1****$2");
    }

    private record ProfileStats(boolean certified, long followers, long following, long videos, long views, long likes) { }
}
