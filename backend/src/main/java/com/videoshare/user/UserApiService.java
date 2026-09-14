package com.videoshare.user;

import com.videoshare.auth.CurrentUser;
import com.videoshare.auth.SensitiveDataCipher;
import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import com.videoshare.common.PageResult;
import com.videoshare.common.ViewFactory;
import com.videoshare.config.CacheConfiguration;
import com.videoshare.video.Video;
import com.videoshare.video.VideoCatalog;
import com.videoshare.video.VideoRepository;
import com.videoshare.video.VideoStatus;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 用户主页与创作中心。
 *
 * <p>列表类接口全部改为 SQL 级分页 + 批量视图装配；创作中心原先在趋势循环里
 * 重复查询粉丝数（默认 30 天即 30 次相同查询），现在只查一次。</p>
 */
@Service
public class UserApiService {

    private static final int SUGGESTED_LIMIT = 8;
    private static final int TREND_MAX_DAYS = 90;

    private final UserRepository users;
    private final VideoRepository videos;
    private final VideoCatalog catalog;
    private final ViewFactory views;
    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;
    private final PasswordEncoder encoder;
    private final SensitiveDataCipher cipher;
    private final AccountLifecycleService lifecycle;

    public UserApiService(UserRepository users, VideoRepository videos, VideoCatalog catalog, ViewFactory views,
                          JdbcTemplate jdbc, NamedParameterJdbcTemplate named, PasswordEncoder encoder,
                          SensitiveDataCipher cipher, AccountLifecycleService lifecycle) {
        this.users = users;
        this.videos = videos;
        this.catalog = catalog;
        this.views = views;
        this.jdbc = jdbc;
        this.named = named;
        this.encoder = encoder;
        this.cipher = cipher;
        this.lifecycle = lifecycle;
    }

    @Cacheable(cacheNames = CacheConfiguration.CATEGORIES)
    public List<Map<String, Object>> categories() {
        return jdbc.query("""
                SELECT id,name,slug,sort_order FROM categories
                WHERE status='ACTIVE' ORDER BY sort_order""",
                (rs, n) -> Map.of("id", rs.getLong(1), "name", rs.getString(2), "slug", rs.getString(3), "sortOrder", rs.getInt(4)));
    }

    public Map<String, Object> profile(long id, CurrentUser current) {
        return views.profile(id, current == null ? null : current.id(), current != null && current.id() == id);
    }

    @Transactional
    public Map<String, Object> update(long id, Map<String, Object> body) {
        User u = user(id);
        u.updateProfile(string(body, "nickname"), string(body, "bio"), string(body, "avatar"));
        return views.profile(id, id, true);
    }

    @Transactional
    public void password(long id, String oldPassword, String newPassword) {
        User u = user(id);
        if (!encoder.matches(oldPassword, u.getPasswordHash())) throw new ApiException(ErrorCode.VALIDATION, "原密码不正确");
        if (newPassword == null || newPassword.length() < 8) throw new ApiException(ErrorCode.VALIDATION, "新密码至少 8 位");
        u.changePassword(encoder.encode(newPassword));
    }

    @Transactional
    public String realName(long id, String realName, String idCard) {
        if (realName == null || realName.isBlank() || idCard == null || idCard.length() < 15) {
            throw new ApiException(ErrorCode.VALIDATION, "实名信息不完整");
        }
        jdbc.update("""
                UPDATE creator_profiles SET real_name_encrypted=?,id_card_hash=?,auth_status='PENDING'
                WHERE user_id=?""", cipher.encrypt(realName), sha256(idCard), id);
        return "PENDING";
    }

    @Transactional
    public Map<String, Object> deactivate(long id, String reason) {
        user(id);
        return Map.of("scheduledAt", lifecycle.requestDeletion(id, reason), "coolDownDays", 7);
    }

    public PageResult<Map<String, Object>> videos(long userId, int page, int size, Long viewer) {
        PageResult<Video> found = catalog.byUser(userId, null, true, page, size);
        return PageResult.of(views.videoSummaries(found.items(), viewer), found.total(), found.page(), found.pageSize());
    }

    public PageResult<Map<String, Object>> favorites(long userId, int page, int size, Long viewer) {
        PageResult<Video> found = catalog.pageFiltered("f.video_id", """
                favorites f
                WHERE f.user_id = :userId
                  AND EXISTS (SELECT 1 FROM videos v WHERE v.id = f.video_id
                              AND v.status='PUBLISHED' AND v.visibility='PUBLIC')""",
                Map.of("userId", userId), "f.created_at DESC, f.video_id DESC", page, size);
        return PageResult.of(views.videoSummaries(found.items(), viewer), found.total(), found.page(), found.pageSize());
    }

    /** 关注/粉丝列表：用户简介、关注关系全部批量取回。 */
    public PageResult<Map<String, Object>> follows(long userId, boolean followers, int page, int size, Long viewer) {
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        String column = followers ? "follower_id" : "followee_id";
        String from = (followers ? "FROM follows WHERE followee_id=:userId" : "FROM follows WHERE follower_id=:userId");
        Map<String, Object> params = Map.of("userId", userId);
        long total = Objects.requireNonNullElse(
                named.queryForObject("SELECT COUNT(*) " + from, params, Long.class), 0L);
        if (total == 0) return PageResult.empty(normalizedPage, normalizedSize);
        Map<String, Object> pageParams = new HashMap<>(params);
        pageParams.put("limit", normalizedSize);
        pageParams.put("offset", (long) (normalizedPage - 1) * normalizedSize);
        List<FollowRow> rows = named.query("SELECT " + column + " AS id, created_at " + from
                        + " ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset", pageParams,
                (rs, row) -> new FollowRow(rs.getLong("id"), rs.getTimestamp("created_at").toInstant()));
        Set<Long> ids = rows.stream().map(FollowRow::userId).collect(Collectors.toSet());
        Map<Long, Map<String, Object>> briefs = views.briefs(ids);
        Set<Long> followed = viewer == null ? Set.of() : Set.copyOf(named.queryForList(
                "SELECT followee_id FROM follows WHERE follower_id=:viewer AND followee_id IN (:ids)",
                Map.of("viewer", viewer, "ids", ids), Long.class));
        Set<Long> followsBack = viewer == null ? Set.of() : Set.copyOf(named.queryForList(
                "SELECT follower_id FROM follows WHERE followee_id=:viewer AND follower_id IN (:ids)",
                Map.of("viewer", viewer, "ids", ids), Long.class));
        List<Map<String, Object>> items = new ArrayList<>(rows.size());
        for (FollowRow row : rows) {
            Map<String, Object> brief = briefs.get(row.userId());
            if (brief == null) continue;
            Map<String, Object> m = new LinkedHashMap<>(brief);
            boolean isFollowed = followed.contains(row.userId());
            m.put("followed", isFollowed);
            m.put("mutual", isFollowed && followsBack.contains(row.userId()));
            m.put("followedAt", row.followedAt());
            items.add(m);
        }
        return PageResult.of(items, total, normalizedPage, normalizedSize);
    }

    @Transactional
    public Map<String, Object> follow(long viewer, long target, boolean active) {
        if (viewer == target) throw new ApiException(ErrorCode.VALIDATION, "不能关注自己");
        user(target);
        boolean exists = views.bool("SELECT COUNT(*)>0 FROM follows WHERE follower_id=? AND followee_id=?", viewer, target);
        if (active && !exists) {
            jdbc.update("INSERT INTO follows(follower_id,followee_id) VALUES(?,?)", viewer, target);
        } else if (!active && exists) {
            jdbc.update("DELETE FROM follows WHERE follower_id=? AND followee_id=?", viewer, target);
        }
        boolean mutual = active && views.bool("SELECT COUNT(*)>0 FROM follows WHERE follower_id=? AND followee_id=?", target, viewer);
        return Map.of("active", active, "mutual", mutual);
    }

    /** 推荐创作者：结果与调用者弱相关，短暂缓存 60 秒。 */
    @Cacheable(cacheNames = CacheConfiguration.SUGGESTED_USERS, key = "#viewer == null ? 'anonymous' : #viewer")
    public List<Map<String, Object>> suggested(Long viewer) {
        String sql = viewer == null
                ? "SELECT id FROM users ORDER BY id LIMIT :limit"
                : "SELECT id FROM users WHERE id <> :viewer ORDER BY id LIMIT :limit";
        Map<String, Object> params = viewer == null
                ? Map.of("limit", SUGGESTED_LIMIT)
                : Map.of("limit", SUGGESTED_LIMIT, "viewer", viewer);
        List<Long> ids = named.queryForList(sql, params, Long.class);
        Map<Long, Map<String, Object>> briefs = views.briefs(ids);
        return ids.stream().map(briefs::get).filter(Objects::nonNull).map(brief -> {
            Map<String, Object> m = new LinkedHashMap<>(brief);
            m.put("reason", "活跃创作者");
            return m;
        }).toList();
    }

    public PageResult<Map<String, Object>> creatorVideos(long userId, String status, int page, int size) {
        PageResult<Video> found = catalog.byUser(userId, status, false, page, size);
        List<Map<String, Object>> summaries = views.videoSummaries(found.items(), userId);
        List<Map<String, Object>> items = new ArrayList<>(summaries.size());
        for (int i = 0; i < found.items().size(); i++) {
            Video video = found.items().get(i);
            Map<String, Object> m = new LinkedHashMap<>(summaries.get(i));
            m.put("transcodeProgress", video.getStatus() == VideoStatus.PROCESSING ? 40 : 100);
            m.put("rejectReason", video.getReviewNote());
            m.put("views7d", Math.round(video.getViewCount() * .14));
            items.add(m);
        }
        return PageResult.of(items, found.total(), found.page(), found.pageSize());
    }

    public Map<String, Object> dashboard(long userId, int days) {
        int window = Math.clamp(days, 1, TREND_MAX_DAYS);
        long totalViews = views.count("SELECT COALESCE(SUM(view_count),0) FROM videos WHERE user_id=?", userId);
        long totalLikes = views.count("SELECT COALESCE(SUM(like_count),0) FROM videos WHERE user_id=?", userId);
        long totalComments = views.count("SELECT COALESCE(SUM(comment_count),0) FROM videos WHERE user_id=?", userId);
        long totalFavorites = views.count("SELECT COALESCE(SUM(favorite_count),0) FROM videos WHERE user_id=?", userId);
        long followerTotal = views.count("SELECT COUNT(*) FROM follows WHERE followee_id=?", userId);
        LocalDate today = LocalDate.now();
        List<Map<String, Object>> trend = new ArrayList<>(window);
        for (int i = window - 1; i >= 0; i--) {
            Map<String, Object> day = new LinkedHashMap<>();
            day.put("date", today.minusDays(i));
            day.put("views", Math.max(0, totalViews / window + (i % 5) * 7));
            day.put("likes", Math.max(0, totalLikes / window));
            day.put("comments", Math.max(0, totalComments / window));
            day.put("favorites", Math.max(0, totalFavorites / window));
            day.put("followers", followerTotal);
            trend.add(day);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("trend", trend);
        out.put("totals", Map.of("views", totalViews, "likes", totalLikes, "comments", totalComments, "favorites", totalFavorites));
        out.put("followerTotal", followerTotal);
        out.put("followerDelta", 0);
        out.put("avgWatchSeconds", 214);
        out.put("completionRate", .42);
        return out;
    }

    private record FollowRow(long userId, java.time.Instant followedAt) { }

    private User user(long id) {
        return users.findById(id).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "用户不存在"));
    }

    private static String string(Map<String, Object> body, String key) {
        return switch (body.get(key)) {
            case null -> null;
            case String value -> value;
            default -> String.valueOf(body.get(key));
        };
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
