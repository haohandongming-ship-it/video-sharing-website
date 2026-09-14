package com.videoshare.common;

import com.videoshare.user.Role;
import com.videoshare.user.User;
import com.videoshare.user.UserRepository;
import com.videoshare.video.Video;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 视图装配器：把数据库行转换成前端约定的 JSON 结构。
 *
 * <p>历史实现里 {@code videoSummary} 每渲染一条视频就要发 5~6 条 SQL（作者、作者认证、
 * 作者粉丝数、分区、点赞、收藏），一个 20 条的列表页因此产生约 120 次往返，是典型的
 * N+1 问题。列表场景现在统一走 {@link #videoSummaries(List, Long)}：先收集这批视频
 * 依赖的全部主键，再用固定数量的批量查询一次性取回。</p>
 *
 * <p>批量装载的固定开销被压到最低：作者资料与「认证 / 粉丝数」合并成一条带标量子查询的
 * 语句，点赞与点踩合并成一条带类型的语句。因此整页成本恒定在 6 条（列表）或 7 条
 * （详情，多一条标签），与页大小无关。</p>
 */
@Component
public class ViewFactory {

    /** 作者资料 + 认证状态 + 粉丝数：一条语句取回，避免三次往返。 */
    private static final String AUTHOR_SQL = """
            SELECT u.id, u.username, u.nickname, u.avatar_url, u.bio,
                   (SELECT COUNT(*) FROM creator_profiles cp
                     WHERE cp.user_id = u.id AND cp.auth_status = 'CERTIFIED') AS certified,
                   (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers
            FROM users u WHERE u.id IN (:ids)""";

    private static final String TAG_SQL = """
            SELECT vt.video_id, t.tag_name
            FROM video_tags vt JOIN tags t ON t.id = vt.tag_id
            WHERE vt.video_id IN (:ids)
            ORDER BY vt.video_id, t.id""";

    private final UserRepository users;
    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;

    public ViewFactory(UserRepository users, JdbcTemplate jdbc, NamedParameterJdbcTemplate named) {
        this.users = users;
        this.jdbc = jdbc;
        this.named = named;
    }

    // ---------------------------------------------------------------- 批量装配

    /** 批量渲染视频摘要；整页只产生固定次数的数据库往返。 */
    public List<Map<String, Object>> videoSummaries(List<Video> videos, Long viewer) {
        if (videos.isEmpty()) return List.of();
        return VideoViews.load(named, videos, viewer).renderAll(videos);
    }

    /** 批量渲染视频详情（额外装载标签）。 */
    public List<Map<String, Object>> videoDetails(List<Video> videos, Long viewer) {
        if (videos.isEmpty()) return List.of();
        return VideoViews.load(named, videos, viewer).renderDetails(videos);
    }

    /** 批量用户简介：评论、通知、会话列表一次渲染多个用户时使用。 */
    public Map<Long, Map<String, Object>> briefs(Collection<Long> userIds) {
        if (userIds == null || userIds.isEmpty()) return Map.of();
        Map<Long, Map<String, Object>> result = new HashMap<>();
        loadAuthors(named, Set.copyOf(userIds), result);
        return result;
    }

    // ---------------------------------------------------------------- 单条装配

    public Map<String, Object> brief(long userId) {
        User u = users.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "用户不存在"));
        Map<Long, Map<String, Object>> loaded = briefs(List.of(userId));
        return loaded.getOrDefault(userId, fallbackBrief(u));
    }

    private static Map<String, Object> fallbackBrief(User u) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", u.getId());
        m.put("username", u.getUsername());
        m.put("nickname", u.getNickname());
        m.put("avatar", u.getAvatarUrl());
        m.put("bio", u.getBio());
        m.put("certified", false);
        m.put("followerCount", 0L);
        return m;
    }

    /**
     * 用户主页视图。九项统计原先要发九条 SQL，现在合并成一条带标量子查询的聚合语句。
     */
    public Map<String, Object> profile(long userId, Long viewer, boolean own) {
        User u = users.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "用户不存在"));
        Map<String, Object> args = new HashMap<>();
        args.put("id", userId);
        args.put("viewer", viewer);
        Stats stats = named.queryForObject("""
                SELECT
                  (SELECT COUNT(*) FROM creator_profiles WHERE user_id=:id AND auth_status='CERTIFIED') AS certified,
                  (SELECT COUNT(*) FROM follows WHERE followee_id=:id) AS followers,
                  (SELECT COUNT(*) FROM follows WHERE follower_id=:id) AS following,
                  (SELECT COUNT(*) FROM videos WHERE user_id=:id AND status='PUBLISHED') AS videos,
                  (SELECT COALESCE(SUM(view_count),0) FROM videos WHERE user_id=:id) AS views,
                  (SELECT COALESCE(SUM(like_count),0) FROM videos WHERE user_id=:id) AS likes,
                  (SELECT COUNT(*) FROM follows WHERE follower_id=:viewer AND followee_id=:id) AS followed,
                  (SELECT COUNT(*) FROM follows WHERE follower_id=:id AND followee_id=:viewer) AS mutual,
                  (SELECT COUNT(*) FROM subscriptions WHERE user_id=:viewer AND target_type='USER' AND target_id=:id) AS subscribed
                """, args, (rs, row) -> new Stats(
                rs.getLong("certified") > 0, rs.getLong("followers"), rs.getLong("following"),
                rs.getLong("videos"), rs.getLong("views"), rs.getLong("likes"),
                rs.getLong("followed") > 0, rs.getLong("mutual") > 0, rs.getLong("subscribed") > 0));
        Objects.requireNonNull(stats, "aggregate query must return exactly one row");

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", u.getId());
        m.put("username", u.getUsername());
        m.put("nickname", u.getNickname());
        m.put("avatar", u.getAvatarUrl());
        m.put("bio", u.getBio());
        m.put("certified", stats.certified());
        m.put("followerCount", stats.followers());
        m.put("role", u.getRole().name());
        m.put("status", u.getStatus().name());
        m.put("permissions", permissions(u.getRole(), stats.certified()));
        m.put("followingCount", stats.following());
        m.put("videoCount", stats.videos());
        m.put("totalViews", stats.views());
        m.put("totalLikes", stats.likes());
        m.put("createdAt", u.getCreatedAt());
        boolean followed = viewer != null && stats.followed();
        m.put("followed", followed);
        m.put("mutual", followed && stats.mutual());
        m.put("subscribed", stats.subscribed());
        if (own) {
            m.put("email", u.getEmail());
            m.put("phone", maskPhone(u.getPhone()));
            m.put("realNameStatus", stats.certified() ? "CERTIFIED" : "NONE");
        }
        return m;
    }

    public Map<String, Object> category(long id) {
        List<Map<String, Object>> rows = jdbc.query(
                "SELECT id,name,slug,sort_order FROM categories WHERE id=?",
                (rs, n) -> categoryRow(rs.getLong("id"), rs.getString("name"), rs.getString("slug"), rs.getInt("sort_order")), id);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public Map<String, Object> videoSummary(Video v, Long viewer) {
        return videoSummaries(List.of(v), viewer).getFirst();
    }

    public Map<String, Object> videoDetail(Video v, Long viewer) {
        return videoDetails(List.of(v), viewer).getFirst();
    }

    // ---------------------------------------------------------------- 通用查询

    public boolean liked(long userId, String targetType, long targetId, String type) {
        return bool("SELECT COUNT(*)>0 FROM likes WHERE user_id=? AND target_type=? AND target_id=? AND type=?",
                userId, targetType, targetId, type);
    }

    public long count(String sql, Object... args) {
        Number n = jdbc.queryForObject(sql, Number.class, args);
        return n == null ? 0 : n.longValue();
    }

    public boolean bool(String sql, Object... args) {
        Boolean b = jdbc.queryForObject(sql, Boolean.class, args);
        return Boolean.TRUE.equals(b);
    }

    public List<String> permissions(Role role, boolean creator) {
        return PermissionSets.of(role, creator);
    }

    // ---------------------------------------------------------------- 内部实现

    private static void loadAuthors(NamedParameterJdbcTemplate named, Collection<Long> ids,
                                    Map<Long, Map<String, Object>> target) {
        if (ids.isEmpty()) return;
        named.query(AUTHOR_SQL, Map.of("ids", ids), (RowCallbackHandler) rs -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", rs.getLong("id"));
            m.put("username", rs.getString("username"));
            m.put("nickname", rs.getString("nickname"));
            m.put("avatar", rs.getString("avatar_url"));
            m.put("bio", rs.getString("bio"));
            m.put("certified", rs.getLong("certified") > 0);
            m.put("followerCount", rs.getLong("followers"));
            target.put(rs.getLong("id"), m);
        });
    }

    private static Map<String, Object> categoryRow(long id, String name, String slug, int sortOrder) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("name", name);
        m.put("slug", slug);
        m.put("sortOrder", sortOrder);
        return m;
    }

    private static String maskPhone(String value) {
        return value == null ? null : value.replaceAll("(\\d{3})\\d{4}(\\d{4})", "$1****$2");
    }

    private record Stats(boolean certified, long followers, long following, long videos, long views,
                         long likes, boolean followed, boolean mutual, boolean subscribed) { }

    /** 一次列表请求所需的全部旁路数据，由固定条数的批量查询装载。 */
    private static final class VideoViews {
        private final Map<Long, Map<String, Object>> authors;
        private final Map<Long, Map<String, Object>> categories;
        private final Set<Long> likedVideos;
        private final Set<Long> dislikedVideos;
        private final Set<Long> favoritedVideos;
        private final Set<Long> subscribedAuthors;
        private final Map<Long, List<String>> tags;

        private VideoViews(Map<Long, Map<String, Object>> authors, Map<Long, Map<String, Object>> categories,
                           Set<Long> likedVideos, Set<Long> dislikedVideos, Set<Long> favoritedVideos,
                           Set<Long> subscribedAuthors, Map<Long, List<String>> tags) {
            this.authors = authors;
            this.categories = categories;
            this.likedVideos = likedVideos;
            this.dislikedVideos = dislikedVideos;
            this.favoritedVideos = favoritedVideos;
            this.subscribedAuthors = subscribedAuthors;
            this.tags = tags;
        }

        static VideoViews load(NamedParameterJdbcTemplate named, List<Video> videos, Long viewer) {
            Set<Long> authorIds = collect(videos, Video::getUserId);
            Set<Long> categoryIds = collect(videos, Video::getCategoryId);
            Set<Long> videoIds = collect(videos, Video::getId);

            Map<Long, Map<String, Object>> authors = new HashMap<>();
            loadAuthors(named, authorIds, authors);

            Map<Long, Map<String, Object>> categories = new HashMap<>();
            if (!categoryIds.isEmpty()) {
                named.query("SELECT id,name,slug,sort_order FROM categories WHERE id IN (:ids)",
                        Map.of("ids", categoryIds), (RowCallbackHandler) rs -> categories.put(rs.getLong("id"),
                                categoryRow(rs.getLong("id"), rs.getString("name"), rs.getString("slug"), rs.getInt("sort_order"))));
            }

            Set<Long> liked = new HashSet<>();
            Set<Long> disliked = new HashSet<>();
            Set<Long> favorited = new HashSet<>();
            Set<Long> subscribed = new HashSet<>();
            if (viewer != null && !videoIds.isEmpty()) {
                // 点赞与点踩合并成一条语句，按 type 分派到两个集合。
                named.query("""
                        SELECT target_id, type FROM likes
                        WHERE user_id=:viewer AND target_type='VIDEO' AND target_id IN (:ids)""",
                        Map.of("viewer", viewer, "ids", videoIds), (RowCallbackHandler) rs -> {
                            if ("DISLIKE".equals(rs.getString("type"))) disliked.add(rs.getLong("target_id"));
                            else liked.add(rs.getLong("target_id"));
                        });
                named.query("SELECT video_id FROM favorites WHERE user_id=:viewer AND video_id IN (:ids)",
                        Map.of("viewer", viewer, "ids", videoIds),
                        (RowCallbackHandler) rs -> favorited.add(rs.getLong(1)));
                if (!authorIds.isEmpty()) {
                    named.query("""
                            SELECT target_id FROM subscriptions
                            WHERE user_id=:viewer AND target_type='USER' AND target_id IN (:ids)""",
                            Map.of("viewer", viewer, "ids", authorIds),
                            (RowCallbackHandler) rs -> subscribed.add(rs.getLong(1)));
                }
            }

            return new VideoViews(authors, categories, liked, disliked, favorited, subscribed, loadTags(named, videoIds));
        }

        /** 详情页标签同样批量取回，避免每条视频一条 SQL。 */
        private static Map<Long, List<String>> loadTags(NamedParameterJdbcTemplate named, Set<Long> videoIds) {
            if (videoIds.isEmpty()) return Map.of();
            Map<Long, List<String>> tags = new HashMap<>();
            named.query(TAG_SQL, Map.of("ids", videoIds), (RowCallbackHandler) rs -> tags
                    .computeIfAbsent(rs.getLong(1), key -> new ArrayList<>())
                    .add(rs.getString(2)));
            return tags;
        }

        List<Map<String, Object>> renderAll(List<Video> videos) {
            return videos.stream().map(this::summary).toList();
        }

        List<Map<String, Object>> renderDetails(List<Video> videos) {
            return videos.stream().map(this::detail).toList();
        }

        private Map<String, Object> summary(Video v) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", v.getId());
            m.put("videoType", v.getVideoType().name());
            m.put("title", v.getTitle());
            m.put("coverUrl", Objects.requireNonNullElse(v.getCoverUrl(), "/favicon.svg"));
            m.put("duration", v.getDuration());
            m.put("category", categories.get(v.getCategoryId()));
            m.put("author", authors.get(v.getUserId()));
            Map<String, Object> stats = new LinkedHashMap<>();
            stats.put("views", v.getViewCount());
            stats.put("likes", v.getLikeCount());
            stats.put("dislikes", v.getDislikeCount());
            stats.put("comments", v.getCommentCount());
            stats.put("favorites", v.getFavoriteCount());
            stats.put("shares", 0);
            m.put("stats", stats);
            m.put("publishedAt", Objects.requireNonNullElse(v.getPublishedAt(), v.getCreatedAt()));
            m.put("status", v.getStatus().name());
            m.put("visibility", v.getVisibility().name());
            m.put("recommendReason", "根据你的兴趣推荐");
            m.put("liked", likedVideos.contains(v.getId()));
            m.put("favorited", favoritedVideos.contains(v.getId()));
            return m;
        }

        private Map<String, Object> detail(Video v) {
            Map<String, Object> m = new LinkedHashMap<>(summary(v));
            m.put("description", Objects.requireNonNullElse(v.getDescription(), ""));
            m.put("tags", tags.getOrDefault(v.getId(), List.of()));
            m.put("qualities", List.of("source"));
            m.put("hlsUrl", hlsUrl(v));
            m.put("downloadEnabled", v.isDownloadEnabled());
            m.put("createdAt", v.getCreatedAt());
            m.put("updatedAt", v.getUpdatedAt());
            m.put("liked", likedVideos.contains(v.getId()));
            m.put("disliked", dislikedVideos.contains(v.getId()));
            m.put("favorited", favoritedVideos.contains(v.getId()));
            m.put("subscribed", subscribedAuthors.contains(v.getUserId()));
            m.put("reviewNote", v.getReviewNote());
            return m;
        }

        private static String hlsUrl(Video v) {
            String configured = v.getHlsUrl();
            return configured != null && !configured.startsWith("/demo/")
                    ? configured
                    : "/api/v1/videos/" + v.getId() + "/source";
        }

        private static Set<Long> collect(List<Video> videos, Function<Video, Long> extractor) {
            return videos.stream().map(extractor).filter(Objects::nonNull).collect(Collectors.toUnmodifiableSet());
        }
    }
}
