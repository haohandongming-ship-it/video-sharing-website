package com.videoshare.interaction;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import com.videoshare.common.PageResult;
import com.videoshare.common.ViewFactory;
import com.videoshare.video.Video;
import com.videoshare.video.VideoCatalog;
import com.videoshare.video.VideoRepository;
import com.videoshare.video.VideoStatus;
import com.videoshare.video.VideoType;
import com.videoshare.video.Visibility;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 播放、互动与个人内容库。
 *
 * <p>关键改动：</p>
 * <ul>
 *   <li>相关视频/榜单/短视频/收藏/历史全部改为 SQL 级排序分页，不再 {@code findAll()} 扫全表；</li>
 *   <li>评论、标签等一对多数据改为批量装配，消除逐行查询；</li>
 *   <li>播放去重表换成 Caffeine 有界缓存（原先的 ConcurrentHashMap 只增不减，是内存泄漏）。</li>
 * </ul>
 */
@Service
public class InteractionService {
    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager entities;

    private static final Duration VIEW_DEDUP_WINDOW = Duration.ofHours(24);
    private static final long VIEW_DEDUP_MILLIS = VIEW_DEDUP_WINDOW.toMillis();
    private static final int RELATED_LIMIT = 12;
    private static final int RANKING_LIMIT = 50;
    private static final Duration NEWCOMER_TREND_WINDOW = Duration.ofDays(7);

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;
    private final VideoRepository videos;
    private final VideoCatalog catalog;
    private final ViewFactory views;

    /** 同一指纹 24 小时内只计一次播放；maximumSize 防止无限增长。 */
    private final Cache<String, Long> viewDedup = Caffeine.newBuilder()
            .maximumSize(500_000)
            .expireAfterWrite(VIEW_DEDUP_WINDOW)
            .build();

    public InteractionService(JdbcTemplate jdbc, NamedParameterJdbcTemplate named, VideoRepository videos,
                              VideoCatalog catalog, ViewFactory views) {
        this.jdbc = jdbc;
        this.named = named;
        this.videos = videos;
        this.catalog = catalog;
        this.views = views;
    }

    // ------------------------------------------------------------------ 播放

    public Map<String, Object> play(long id, Long viewer) {
        Video v = accessibleVideo(id, viewer);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("hlsUrl", nativeOrHls(v.getHlsUrl(), id));
        m.put("qualities", List.of("source"));
        m.put("expiresAt", Instant.now().plus(Duration.ofHours(2)));
        m.put("poster", Objects.requireNonNullElse(v.getCoverUrl(), "/favicon.svg"));
        return m;
    }

    public List<Map<String, Object>> related(long id, Long viewer) {
        Video source = accessibleVideo(id, viewer);
        return views.videoSummaries(catalog.related(id, source.getCategoryId(), RELATED_LIMIT), viewer);
    }

    @Transactional
    public Map<String, Object> view(long id, String fingerprint) {
        Video v = publicVideo(id);
        String key = id + ":" + fingerprint;
        long now = System.currentTimeMillis();
        Long previous = viewDedup.asMap().putIfAbsent(key, now);
        boolean counted = previous == null || now - previous > VIEW_DEDUP_MILLIS;
        if (!counted) return Map.of("counted", false, "views", v.getViewCount());
        viewDedup.put(key, now);
        jdbc.update("UPDATE videos SET view_count=view_count+1,updated_at=? WHERE id=?", Timestamp.from(Instant.now()), id);
        Long views = jdbc.queryForObject("SELECT view_count FROM videos WHERE id=?", Long.class, id);
        return Map.of("counted", true, "views", views == null ? v.getViewCount() + 1 : views);
    }

    @Transactional
    public Map<String, Object> progress(long userId, long videoId, int seconds) {
        jdbc.queryForList("SELECT id FROM users WHERE id=? FOR UPDATE",userId);
        Video video=accessibleVideo(videoId, userId);
        int duration=video.getDuration();
        // 未转码完成的上传视频 duration 仍为 0：此时不能把进度压成 0，否则续播位置永远丢失。
        seconds=duration>0?Math.min(Math.max(0,seconds),duration):Math.max(0,seconds);
        boolean finished=duration>0 && seconds>=duration;
        Timestamp now = Timestamp.from(Instant.now());
        int updated = jdbc.update("UPDATE play_records SET progress=?,finished=?,updated_at=? WHERE user_id=? AND video_id=?",
                seconds, finished, now, userId, videoId);
        if (updated == 0) {
            jdbc.update("INSERT INTO play_records(user_id,video_id,progress,finished,updated_at) VALUES(?,?,?,?,?)",
                    userId, videoId, seconds, finished, now);
        }
        return Map.of("saved", true, "progress", seconds);
    }

    // ------------------------------------------------------------------ 榜单

    public List<Map<String, Object>> ranking(String type, String period, Long categoryId, Long viewer) {
        String metric = Objects.requireNonNullElse(type, "hot");
        String window = Objects.requireNonNullElse(period, "daily");
        List<VideoCatalog.RankedVideo> ranked = catalog.ranking(metric, window, categoryId, RANKING_LIMIT);
        List<Map<String, Object>> rendered = views.videoSummaries(ranked.stream().map(VideoCatalog.RankedVideo::video).toList(), viewer);
        Instant freshThreshold = Instant.now().minus(NEWCOMER_TREND_WINDOW);
        List<Map<String, Object>> out = new ArrayList<>(ranked.size());
        for (int i = 0; i < ranked.size(); i++) {
            VideoCatalog.RankedVideo row = ranked.get(i);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("rank", i + 1);
            m.put("video", rendered.get(i));
            m.put("score", Math.round(row.score() * 100d) / 100d);
            m.put("delta", 0);
            m.put("trend", publishedOrCreated(row.video()).isAfter(freshThreshold) ? "new" : "same");
            out.add(m);
        }
        return out;
    }

    public Map<String, Object> shorts(String cursor, int size, Long viewer) {
        PageResult.CursorSlice<Video> slice = catalog.shorts(parseCursor(cursor), size);
        List<Map<String, Object>> summaries = views.videoSummaries(slice.items(), viewer);
        List<Map<String, Object>> items = new ArrayList<>(summaries.size());
        for (int i = 0; i < slice.items().size(); i++) {
            Video video = slice.items().get(i);
            Map<String, Object> m = new LinkedHashMap<>(summaries.get(i));
            m.put("hlsUrl", nativeOrHls(video.getHlsUrl(), video.getId()));
            items.add(m);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("nextCursor", slice.nextCursor());
        result.put("hasMore", slice.hasMore());
        return result;
    }

    // ------------------------------------------------------------------ 个人内容库

    public PageResult<Map<String, Object>> history(long userId, int page, int size) {
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        String from = """
                FROM play_records pr JOIN videos v ON v.id = pr.video_id
                WHERE pr.user_id = :userId AND v.status='PUBLISHED' AND v.visibility='PUBLIC'""";
        Map<String, Object> params = Map.of("userId", userId);
        long total = Objects.requireNonNullElse(named.queryForObject("SELECT COUNT(*) " + from, params, Long.class), 0L);
        if (total == 0) return PageResult.empty(normalizedPage, normalizedSize);
        Map<String, Object> pageParams = new HashMap<>(params);
        pageParams.put("limit", normalizedSize);
        pageParams.put("offset", (long) (normalizedPage - 1) * normalizedSize);
        List<HistoryRow> rows = named.query("SELECT pr.video_id, pr.progress, pr.finished " + from
                        + " ORDER BY pr.updated_at DESC, pr.video_id DESC LIMIT :limit OFFSET :offset", pageParams,
                (rs, row) -> new HistoryRow(rs.getLong(1), rs.getInt(2), rs.getBoolean(3)));
        List<Video> loaded = catalog.loadOrdered(rows.stream().map(HistoryRow::videoId).toList());
        Map<Long, HistoryRow> byVideo = rows.stream()
                .collect(Collectors.toMap(HistoryRow::videoId, Function.identity(), (a, b) -> a));
        List<Map<String, Object>> summaries = views.videoSummaries(loaded, userId);
        List<Map<String, Object>> items = new ArrayList<>(loaded.size());
        for (int i = 0; i < loaded.size(); i++) {
            HistoryRow row = byVideo.get(loaded.get(i).getId());
            Map<String, Object> m = new LinkedHashMap<>(summaries.get(i));
            m.put("progress", row.progress());
            m.put("finished", row.finished());
            items.add(m);
        }
        return PageResult.of(items, total, normalizedPage, normalizedSize);
    }

    public Map<String, Object> favorites(long userId, int page, int size, Long folderId) {
        Map<String, Object> params = new HashMap<>();
        params.put("userId", userId);
        String folderFilter = "";
        if (folderId != null) {
            folderFilter = " AND f.folder_id = :folderId";
            params.put("folderId", folderId);
        }
        PageResult<Video> found = catalog.pageFiltered("f.video_id", """
                favorites f
                WHERE f.user_id = :userId%s
                  AND EXISTS (SELECT 1 FROM videos v WHERE v.id = f.video_id
                              AND v.status='PUBLISHED' AND v.visibility='PUBLIC')""".formatted(folderFilter),
                params, "f.created_at DESC, f.video_id DESC", page, size);
        Map<String, Object> result = new LinkedHashMap<>(Map.of(
                "items", views.videoSummaries(found.items(), userId),
                "total", found.total(),
                "page", found.page(),
                "pageSize", found.pageSize(),
                "hasMore", found.hasMore()));
        result.put("folders", jdbc.query("""
                SELECT f.id,f.name,COUNT(v.video_id) amount,f.system_type
                FROM folders f LEFT JOIN favorites v ON v.folder_id=f.id
                WHERE f.user_id=? GROUP BY f.id,f.name,f.system_type""",
                (rs, n) -> Map.of("id", rs.getLong(1), "name", rs.getString(2), "count", rs.getLong(3),
                        "isDefault", rs.getString(4) != null), userId));
        return result;
    }

    public List<Map<String, Object>> playlists(long userId) {
        return jdbc.query("""
                SELECT p.id,p.name,COUNT(pv.video_id) amount
                FROM playlists p LEFT JOIN playlist_videos pv ON pv.playlist_id=p.id
                WHERE p.user_id=? GROUP BY p.id,p.name ORDER BY p.id""", (rs, n) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", rs.getLong(1));
            m.put("name", rs.getString(2));
            m.put("count", rs.getLong(3));
            m.put("cover", "/favicon.svg");
            return m;
        }, userId);
    }

    public List<Map<String, Object>> playlistVideos(long userId, long playlistId) {
        ensurePlaylistOwner(userId, playlistId);
        List<Long> ids = named.queryForList("""
                SELECT pv.video_id FROM playlist_videos pv JOIN videos v ON v.id = pv.video_id
                WHERE pv.playlist_id = :playlistId
                ORDER BY pv.sort_order, pv.added_at, pv.video_id""", Map.of("playlistId", playlistId), Long.class);
        return views.videoSummaries(catalog.loadOrdered(ids), userId);
    }

    @Transactional
    public Map<String, Object> createPlaylist(long userId, String name, String description) {
        if (name == null || name.isBlank() || name.length() > 100) {
            throw new ApiException(ErrorCode.VALIDATION, "播放列表名称应为 1-100 字");
        }
        String trimmed = name.trim();
        KeyHolder keys = new GeneratedKeyHolder();
        named.update("INSERT INTO playlists(user_id,name,description) VALUES(:userId,:name,:description)",
                new MapSqlParameterSource()
                        .addValue("userId", userId)
                        .addValue("name", trimmed)
                        .addValue("description", description),
                keys, new String[]{"id"});
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", Objects.requireNonNull(keys.getKey()).longValue());
        result.put("name", trimmed);
        result.put("count", 0);
        result.put("cover", "/favicon.svg");
        return result;
    }

    @Transactional
    public void addPlaylistVideo(long userId, long playlistId, long videoId) {
        ensurePlaylistOwner(userId, playlistId);
        accessibleVideo(videoId, userId);
        if (views.bool("SELECT COUNT(*)>0 FROM playlist_videos WHERE playlist_id=? AND video_id=?", playlistId, videoId)) return;
        Integer order = jdbc.queryForObject(
                "SELECT COALESCE(MAX(sort_order),-1)+1 FROM playlist_videos WHERE playlist_id=?", Integer.class, playlistId);
        jdbc.update("INSERT INTO playlist_videos(playlist_id,video_id,sort_order) VALUES(?,?,?)",
                playlistId, videoId, order == null ? 0 : order);
    }

    @Transactional
    public void removePlaylistVideo(long userId, long playlistId, long videoId) {
        ensurePlaylistOwner(userId, playlistId);
        jdbc.update("DELETE FROM playlist_videos WHERE playlist_id=? AND video_id=?", playlistId, videoId);
    }

    @Transactional
    public void deletePlaylist(long userId, long playlistId) {
        ensurePlaylistOwner(userId, playlistId);
        jdbc.update("DELETE FROM playlist_videos WHERE playlist_id=?", playlistId);
        jdbc.update("DELETE FROM playlists WHERE id=?", playlistId);
    }

    // ------------------------------------------------------------------ 互动

    @Transactional
    public Map<String, Object> reaction(long userId, long videoId, String type, boolean active) {
        jdbc.queryForList("SELECT id FROM videos WHERE id=? FOR UPDATE", videoId);
        Video v = accessibleVideo(videoId, userId);
        boolean existed = views.liked(userId, "VIDEO", videoId, type);
        if (active && !existed) {
            jdbc.update("DELETE FROM likes WHERE user_id=? AND target_type='VIDEO' AND target_id=?", userId, videoId);
            jdbc.update("INSERT INTO likes(user_id,target_type,target_id,type) VALUES(?,?,?,?)", userId, "VIDEO", videoId, type);
        } else if (!active && existed) {
            jdbc.update("DELETE FROM likes WHERE user_id=? AND target_type='VIDEO' AND target_id=?", userId, videoId);
        }
        ReactionCounts counts = reactionCounts(videoId);
        jdbc.update("UPDATE videos SET like_count=?,dislike_count=? WHERE id=?",counts.likes(),counts.dislikes(),videoId);
        entities.refresh(v);
        return Map.of("active", active, "count", "LIKE".equals(type) ? counts.likes() : counts.dislikes());
    }

    @Transactional
    public Map<String, Object> favorite(long userId, long videoId, boolean active, Long folderId) {
        jdbc.queryForList("SELECT id FROM videos WHERE id=? FOR UPDATE", videoId);
        Video v = accessibleVideo(videoId, userId);
        if (active && folderId != null && !views.bool("SELECT COUNT(*)>0 FROM folders WHERE id=? AND user_id=?", folderId, userId)) {
            throw new ApiException(ErrorCode.FORBIDDEN, "无权使用该收藏夹");
        }
        boolean exists = views.bool("SELECT COUNT(*)>0 FROM favorites WHERE user_id=? AND video_id=?", userId, videoId);
        if (active && !exists) {
            jdbc.update("INSERT INTO favorites(user_id,video_id,folder_id) VALUES(?,?,?)", userId, videoId, folderId);
        } else if (!active && exists) {
            jdbc.update("DELETE FROM favorites WHERE user_id=? AND video_id=?", userId, videoId);
        }
        long count = views.count("SELECT COUNT(*) FROM favorites WHERE video_id=?", videoId);
        jdbc.update("UPDATE videos SET favorite_count=? WHERE id=?",count,videoId);
        entities.refresh(v);
        return Map.of("active", active, "count", count);
    }

    @Transactional
    public Map<String, Object> subscribe(long userId, long videoId, boolean active) {
        jdbc.queryForList("SELECT id FROM users WHERE id=? FOR UPDATE",userId);
        Video v = accessibleVideo(videoId, userId);
        if(v.getUserId()==userId) throw new ApiException(ErrorCode.VALIDATION,"不能关注自己");
        boolean exists = views.bool("SELECT COUNT(*)>0 FROM subscriptions WHERE user_id=? AND target_type='USER' AND target_id=?",
                userId, v.getUserId());
        if (active && !exists) {
            jdbc.update("INSERT INTO subscriptions(user_id,target_type,target_id) VALUES(?,?,?)", userId, "USER", v.getUserId());
        } else if (!active && exists) {
            jdbc.update("DELETE FROM subscriptions WHERE user_id=? AND target_type='USER' AND target_id=?", userId, v.getUserId());
        }
        return Map.of("active", active);
    }

    @Transactional
    public Map<String, Object> download(long userId, long videoId) {
        Video v = accessibleVideo(videoId, userId);
        if (!v.isDownloadEnabled()) throw new ApiException(ErrorCode.FORBIDDEN, "作者未开放下载");
        jdbc.update("INSERT INTO download_records(user_id,video_id,quality) VALUES(?,?,?)", userId, videoId, "source");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("url", "/api/v1/videos/" + videoId + "/source?download=1");
        result.put("expiresIn", 600);
        result.put("quality", "source");
        result.put("fileName", v.getTitle() + ".mp4");
        return result;
    }

    // ------------------------------------------------------------------ 评论

    public PageResult<Map<String, Object>> comments(long videoId, String sort, int page, int size, Long viewer) {
        accessibleVideo(videoId, viewer);
        // 并列键 id 保证翻页稳定：缺少它时同一时间戳的评论可能跨页重复或遗漏。
        String order = "hot".equals(sort)
                ? "like_count DESC, created_at DESC, id DESC"
                : "created_at DESC, id DESC";
        return pageComments("video_id=:videoId AND parent_id IS NULL AND status='VISIBLE'",
                Map.of("videoId", videoId), order, page, size, viewer);
    }

    public PageResult<Map<String, Object>> replies(long commentId, int page, int size, Long viewer) {
        commentById(commentId, viewer);
        return pageComments("(parent_id=:commentId OR root_id=:commentId) AND status='VISIBLE'",
                Map.of("commentId", commentId), "created_at, id", page, size, viewer);
    }

    private PageResult<Map<String, Object>> pageComments(String where, Map<String, Object> params, String orderBy,
                                                         int page, int size, Long viewer) {
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        long total = Objects.requireNonNullElse(
                named.queryForObject("SELECT COUNT(*) FROM comments WHERE " + where, params, Long.class), 0L);
        if (total == 0) return PageResult.empty(normalizedPage, normalizedSize);
        Map<String, Object> pageParams = new HashMap<>(params);
        pageParams.put("limit", normalizedSize);
        pageParams.put("offset", (long) (normalizedPage - 1) * normalizedSize);
        List<CommentRow> rows = named.query("SELECT * FROM comments WHERE " + where
                        + " ORDER BY " + orderBy + " LIMIT :limit OFFSET :offset",
                pageParams, InteractionService::commentRow);
        return PageResult.of(renderComments(rows, viewer), total, normalizedPage, normalizedSize);
    }

    @Transactional
    public Map<String, Object> addComment(long userId, long videoId, Long parentId, String content) {
        String sanitized = sanitize(content);
        if (sanitized.isBlank() || sanitized.length() > 1000) {
            throw new ApiException(ErrorCode.VALIDATION, "评论长度应为 1-1000 字");
        }
        jdbc.queryForList("SELECT id FROM videos WHERE id=? FOR UPDATE",videoId);
        Video v = accessibleVideo(videoId, userId);
        Long rootId = null;
        if (parentId != null) {
            Map<String, Object> parent = commentById(parentId, userId);
            if (((Number) parent.get("videoId")).longValue() != videoId) {
                throw new ApiException(ErrorCode.VALIDATION, "回复与视频不匹配");
            }
            Object parentRoot = parent.get("rootId");
            rootId = parentRoot == null ? parentId : ((Number) parentRoot).longValue();
        }
        KeyHolder keys = new GeneratedKeyHolder();
        named.update("""
                INSERT INTO comments(video_id,user_id,parent_id,root_id,content,status)
                VALUES(:videoId,:userId,:parentId,:rootId,:content,'VISIBLE')""",
                new MapSqlParameterSource()
                        .addValue("videoId", videoId)
                        .addValue("userId", userId)
                        .addValue("parentId", parentId)
                        .addValue("rootId", rootId)
                        .addValue("content", sanitized),
                keys, new String[]{"id"});
        long commentId = Objects.requireNonNull(keys.getKey()).longValue();
        if (rootId != null) jdbc.update("UPDATE comments SET reply_count=reply_count+1 WHERE id=?", rootId);
        long total = views.count("SELECT COUNT(*) FROM comments WHERE video_id=? AND status='VISIBLE'", videoId);
        jdbc.update("UPDATE videos SET comment_count=? WHERE id=?",total,videoId);
        entities.refresh(v);
        return commentById(commentId, userId);
    }

    @Transactional
    public Map<String, Object> likeComment(long userId, long id, boolean active) {
        jdbc.queryForList("SELECT id FROM comments WHERE id=? FOR UPDATE",id);
        commentById(id, userId);
        boolean existed = views.liked(userId, "COMMENT", id, "LIKE");
        if (active && !existed) {
            jdbc.update("INSERT INTO likes(user_id,target_type,target_id,type) VALUES(?,?,?,?)", userId, "COMMENT", id, "LIKE");
        } else if (!active && existed) {
            jdbc.update("DELETE FROM likes WHERE user_id=? AND target_type='COMMENT' AND target_id=?", userId, id);
        }
        long count = views.count("SELECT COUNT(*) FROM likes WHERE target_type='COMMENT' AND target_id=?", id);
        jdbc.update("UPDATE comments SET like_count=? WHERE id=?", count, id);
        return Map.of("active", active, "count", count);
    }

    @Transactional
    public void deleteComment(long userId, long id, boolean admin) {
        Map<String, Object> row = commentById(id, userId);
        long authorId = ((Number) ((Map<?, ?>) row.get("user")).get("id")).longValue();
        if (authorId != userId && !admin) throw new ApiException(ErrorCode.FORBIDDEN, "不能删除他人的评论");
        long videoId = ((Number) row.get("videoId")).longValue();
        jdbc.queryForList("SELECT id FROM videos WHERE id=? FOR UPDATE",videoId);
        jdbc.update("UPDATE comments SET status='DELETED',content='该评论已删除' WHERE id=?", id);
        Object rootId = row.get("rootId");
        if (rootId != null) {
            jdbc.update("UPDATE comments SET reply_count=CASE WHEN reply_count>0 THEN reply_count-1 ELSE 0 END WHERE id=?", ((Number) rootId).longValue());
        } else {
            jdbc.update("UPDATE comments SET status='DELETED' WHERE root_id=?", id);
        }
        long total = views.count("SELECT COUNT(*) FROM comments WHERE video_id=? AND status='VISIBLE'", videoId);
        Video v = accessibleVideo(videoId, userId);
        jdbc.update("UPDATE videos SET comment_count=? WHERE id=?",total,videoId);
        entities.refresh(v);
    }

    public Map<String, Object> commentById(long id, Long viewer) {
        List<CommentRow> rows = named.query("SELECT * FROM comments WHERE id=:id", Map.of("id", id),
                InteractionService::commentRow);
        if (rows.isEmpty() || !"VISIBLE".equals(rows.getFirst().status())) {
            throw new ApiException(ErrorCode.NOT_FOUND, "评论不存在");
        }
        accessibleVideo(rows.getFirst().videoId(), viewer);
        return renderComments(rows, viewer).getFirst();
    }

    /**
     * 批量渲染评论：作者、视频作者、viewer 点赞状态各一次查询，
     * 替代原先每条评论 2~3 次往返的 N+1。
     */
    private List<Map<String, Object>> renderComments(List<CommentRow> rows, Long viewer) {
        if (rows.isEmpty()) return List.of();
        Map<Long, Map<String, Object>> authors = views.briefs(rows.stream().map(CommentRow::userId).collect(Collectors.toSet()));
        Map<Long, Long> videoAuthors = new HashMap<>();
        named.query("SELECT id,user_id FROM videos WHERE id IN (:ids)",
                Map.of("ids", rows.stream().map(CommentRow::videoId).collect(Collectors.toSet())),
                (RowCallbackHandler) rs -> videoAuthors.put(rs.getLong(1), rs.getLong(2)));
        Set<Long> liked = viewer == null ? Set.of() : Set.copyOf(named.queryForList("""
                SELECT target_id FROM likes
                WHERE user_id=:viewer AND target_type='COMMENT' AND type='LIKE' AND target_id IN (:ids)""",
                Map.of("viewer", viewer, "ids", rows.stream().map(CommentRow::id).collect(Collectors.toSet())), Long.class));
        return rows.stream().map(row -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", row.id());
            m.put("videoId", row.videoId());
            m.put("parentId", row.parentId());
            m.put("rootId", row.rootId());
            m.put("content", row.content());
            m.put("user", authors.get(row.userId()));
            m.put("likeCount", row.likeCount());
            m.put("replyCount", row.replyCount());
            m.put("liked", liked.contains(row.id()));
            m.put("status", row.status());
            m.put("createdAt", row.createdAt());
            m.put("isVideoAuthor", Objects.equals(videoAuthors.get(row.videoId()), row.userId()));
            return m;
        }).toList();
    }

    // ------------------------------------------------------------------ 内部

    private static CommentRow commentRow(ResultSet rs, int rowNum) throws SQLException {
        long likeCount = rs.getLong("like_count");
        long replyCount = rs.getLong("reply_count");
        Timestamp created = rs.getTimestamp("created_at");
        return new CommentRow(rs.getLong("id"), rs.getLong("video_id"), nullableLong(rs, "parent_id"),
                nullableLong(rs, "root_id"), rs.getString("content"), rs.getLong("user_id"),
                likeCount, replyCount, rs.getString("status"), created == null ? Instant.now() : created.toInstant());
    }

    private record CommentRow(long id, long videoId, Long parentId, Long rootId, String content, long userId,
                              long likeCount, long replyCount, String status, Instant createdAt) { }

    private record HistoryRow(long videoId, int progress, boolean finished) { }

    private record ReactionCounts(long likes, long dislikes) { }

    private ReactionCounts reactionCounts(long videoId) {
        ReactionCounts counts = named.queryForObject("""
                SELECT COALESCE(SUM(CASE WHEN type='LIKE' THEN 1 ELSE 0 END),0) AS likes,
                       COALESCE(SUM(CASE WHEN type='DISLIKE' THEN 1 ELSE 0 END),0) AS dislikes
                FROM likes WHERE target_type='VIDEO' AND target_id=:id""",
                Map.of("id", videoId), (rs, row) -> new ReactionCounts(rs.getLong("likes"), rs.getLong("dislikes")));
        return counts == null ? new ReactionCounts(0, 0) : counts;
    }

    private void ensurePlaylistOwner(long userId, long playlistId) {
        if (!views.bool("SELECT COUNT(*)>0 FROM playlists WHERE id=? AND user_id=?", playlistId, userId)) {
            throw new ApiException(ErrorCode.FORBIDDEN, "无权访问该播放列表");
        }
    }

    private Video publicVideo(long id) {
        return accessibleVideo(id, null);
    }

    private Video accessibleVideo(long id, Long viewer) {
        Video v = videos.findById(id).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "视频不存在"));
        boolean owner = viewer != null && (viewer.equals(v.getUserId())
                || views.bool("SELECT COUNT(*)>0 FROM users WHERE id=? AND role IN ('ADMIN','MODERATOR')", viewer));
        if (v.getStatus() == VideoStatus.DELETED
                || (!owner && (v.getStatus() != VideoStatus.PUBLISHED || v.getVisibility() == Visibility.PRIVATE))) {
            throw new ApiException(ErrorCode.NOT_FOUND, "视频不存在");
        }
        return v;
    }

    private Instant publishedOrCreated(Video v) {
        return Objects.requireNonNullElse(v.getPublishedAt(), v.getCreatedAt());
    }

    private String nativeOrHls(String configured, long id) {
        return configured != null && !configured.isBlank() && !configured.startsWith("/demo/")
                ? configured
                : "/api/v1/videos/" + id + "/source";
    }

    private int parseCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) return 0;
        try {
            return Math.max(0, Integer.parseInt(cursor));
        } catch (NumberFormatException ex) {
            return 0;
        }
    }

    private static String sanitize(String text) {
        return text == null ? "" : text.replaceAll("<[^>]*>", "").trim();
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }
}
