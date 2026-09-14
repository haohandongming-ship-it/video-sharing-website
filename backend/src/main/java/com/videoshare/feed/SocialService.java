package com.videoshare.feed;

import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import com.videoshare.common.PageResult;
import com.videoshare.common.ViewFactory;
import com.videoshare.realtime.RealtimeNotifier;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
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
 * 社区动态、通知与私信。
 *
 * <p>信息流的每条动态原先要触发 5~8 次查询（作者、认证、粉丝数、媒体、话题、转发源），
 * 一页 10 条就是 60 多次往返。现在媒体、话题、转发源、作者全部按批装载；
 * 「关注」信息流与通知/会话列表同样改为一次查询取回全部旁路数据。</p>
 */
@Service
public class SocialService {

    private static final int MAX_CONTENT_LENGTH = 2000;
    private static final int MAX_COMMENT_LENGTH = 1000;

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;
    private final ViewFactory views;
    private final RealtimeNotifier notifier;

    public SocialService(JdbcTemplate jdbc, NamedParameterJdbcTemplate named, ViewFactory views, RealtimeNotifier notifier) {
        this.jdbc = jdbc;
        this.named = named;
        this.views = views;
        this.notifier = notifier;
    }

    // ------------------------------------------------------------------ 信息流

    public Map<String, Object> feeds(String type, String cursor, int size, Long viewer, Long onlyUser) {
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        int offset = parseCursor(cursor);
        Map<String, Object> params = new HashMap<>();
        StringBuilder where = new StringBuilder(" WHERE f.status='VISIBLE'");
        if (onlyUser != null) {
            where.append(" AND f.user_id = :onlyUser");
            params.put("onlyUser", onlyUser);
        }
        if ("following".equals(type)) {
            if (viewer == null) throw new ApiException(ErrorCode.UNAUTHORIZED, "请先登录");
            where.append(" AND f.user_id IN (SELECT followee_id FROM follows WHERE follower_id = :viewer)");
            params.put("viewer", viewer);
        }
        long total = count("SELECT COUNT(*) FROM feeds f" + where, params);
        Map<String, Object> pageParams = new HashMap<>(params);
        pageParams.put("limit", normalizedSize);
        pageParams.put("offset", (long) offset);
        // 并列键 f.id 保证信息流翻页稳定。
        String order = "hot".equals(type)
                ? "f.like_count DESC, f.created_at DESC, f.id DESC"
                : "f.created_at DESC, f.id DESC";
        List<FeedRow> rows = named.query("SELECT f.* FROM feeds f" + where + " ORDER BY " + order
                + " LIMIT :limit OFFSET :offset", pageParams, SocialService::feedRow);
        List<Map<String, Object>> items = renderFeeds(rows, viewer);
        int to = offset + items.size();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("total", total);
        result.put("nextCursor", to < total ? String.valueOf(to) : null);
        result.put("hasMore", to < total);
        return result;
    }

    public Map<String, Object> feed(long id, Long viewer) {
        List<FeedRow> rows = named.query("SELECT * FROM feeds WHERE id=:id AND status='VISIBLE'",
                Map.of("id", id), SocialService::feedRow);
        if (rows.isEmpty()) throw new ApiException(ErrorCode.NOT_FOUND, "动态不存在");
        return renderFeeds(rows, viewer).getFirst();
    }

    @Transactional
    public Map<String, Object> publish(long userId, Map<String, Object> body) {
        String content = Objects.toString(body.get("content"), "").replaceAll("<[^>]*>", "").trim();
        if (content.isBlank() || content.length() > MAX_CONTENT_LENGTH) {
            throw new ApiException(ErrorCode.VALIDATION, "动态内容应为 1-2000 字");
        }
        Long topicId = resolveTopic(Objects.toString(body.get("topicName"), "").trim());
        Long repost = body.get("repostOfId") instanceof Number n ? n.longValue() : null;
        if (repost != null) {
            Map<String, Object> original = feed(repost, userId);
            if (original.get("repostOf") instanceof Map<?, ?> root) repost = ((Number) root.get("id")).longValue();
            jdbc.update("UPDATE feeds SET repost_count=repost_count+1 WHERE id=?", repost);
        }
        KeyHolder keys = new GeneratedKeyHolder();
        named.update("""
                INSERT INTO feeds(user_id,content,type,repost_of_id,topic_id,status)
                VALUES(:userId,:content,:type,:repostOfId,:topicId,'VISIBLE')""",
                new MapSqlParameterSource()
                        .addValue("userId", userId)
                        .addValue("content", content)
                        .addValue("type", repost == null ? "ORIGINAL" : "REPOST")
                        .addValue("repostOfId", repost)
                        .addValue("topicId", topicId),
                keys, new String[]{"id"});
        long id = Objects.requireNonNull(keys.getKey()).longValue();
        saveMedia(id, body.get("media"));
        return feed(id, userId);
    }

    private Long resolveTopic(String topic) {
        if (topic.isBlank()) return null;
        List<Long> existing = named.queryForList("SELECT id FROM topics WHERE name=:name", Map.of("name", topic), Long.class);
        if (!existing.isEmpty()) return existing.getFirst();
        KeyHolder keys = new GeneratedKeyHolder();
        named.update("INSERT INTO topics(name,view_count) VALUES(:name,0)",
                new MapSqlParameterSource("name", topic), keys, new String[]{"id"});
        return Objects.requireNonNull(keys.getKey()).longValue();
    }

    private void saveMedia(long feedId, Object media) {
        if (!(media instanceof List<?> list)) return;
        int order = 0;
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> raw) || order >= 20) continue;
            Long videoId = raw.get("videoId") instanceof Number n ? n.longValue() : null;
            jdbc.update("""
                    INSERT INTO feed_media(feed_id,media_type,url,thumb_url,video_id,sort_order)
                    VALUES(?,?,?,?,?,?)""",
                    feedId, Objects.toString(raw.get("mediaType"), "IMAGE"), Objects.toString(raw.get("url"), ""),
                    raw.get("thumbUrl") == null ? null : Objects.toString(raw.get("thumbUrl")), videoId, order++);
        }
    }

    @Transactional
    public void remove(long userId, long id, boolean admin) {
        Map<String, Object> row = jdbc.queryForMap("SELECT user_id FROM feeds WHERE id=?", id);
        if (((Number) row.get("user_id")).longValue() != userId && !admin) {
            throw new ApiException(ErrorCode.FORBIDDEN, "不能删除他人的动态");
        }
        jdbc.update("UPDATE feeds SET status='DELETED' WHERE id=?", id);
    }

    @Transactional
    public Map<String, Object> like(long userId, long id, boolean active) {
        feed(id, userId);
        boolean exists = views.liked(userId, "FEED", id, "LIKE");
        if (active && !exists) {
            jdbc.update("INSERT INTO likes(user_id,target_type,target_id,type) VALUES(?,?,?,?)", userId, "FEED", id, "LIKE");
            Long owner = jdbc.queryForObject("SELECT user_id FROM feeds WHERE id=?", Long.class, id);
            notifier.notify(owner, userId, "LIKE", "动态获得点赞", "有人赞了你的动态", "FEED", id);
        } else if (!active && exists) {
            jdbc.update("DELETE FROM likes WHERE user_id=? AND target_type='FEED' AND target_id=?", userId, id);
        }
        long count = views.count("SELECT COUNT(*) FROM likes WHERE target_type='FEED' AND target_id=?", id);
        jdbc.update("UPDATE feeds SET like_count=? WHERE id=?", count, id);
        return Map.of("active", active, "count", count);
    }

    @Transactional
    public long repost(long userId, long id) {
        feed(id, userId);
        publish(userId, Map.of("content", "转发动态", "repostOfId", id));
        return views.count("SELECT repost_count FROM feeds WHERE id=?", id);
    }

    // ------------------------------------------------------------------ 动态评论

    public PageResult<Map<String, Object>> comments(long feedId, int page, int size, Long viewer) {
        feed(feedId, viewer);
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        Map<String, Object> params = Map.of("feedId", feedId);
        long total = count("SELECT COUNT(*) FROM feed_comments WHERE feed_id=:feedId AND status='VISIBLE'", params);
        if (total == 0) return PageResult.empty(normalizedPage, normalizedSize);
        Map<String, Object> pageParams = new HashMap<>(params);
        pageParams.put("limit", normalizedSize);
        pageParams.put("offset", (long) (normalizedPage - 1) * normalizedSize);
        List<FeedCommentRow> rows = named.query("""
                SELECT * FROM feed_comments WHERE feed_id=:feedId AND status='VISIBLE'
                ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset""",
                pageParams, (rs, row) -> new FeedCommentRow(rs.getLong("id"), rs.getLong("feed_id"), rs.getLong("user_id"),
                        rs.getString("content"), rs.getString("status"), rs.getTimestamp("created_at")));
        Map<Long, Map<String, Object>> authors = views.briefs(rows.stream().map(FeedCommentRow::userId).collect(Collectors.toSet()));
        List<Map<String, Object>> items = rows.stream().map(row -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", row.id());
            m.put("videoId", row.feedId());
            m.put("parentId", null);
            m.put("rootId", null);
            m.put("content", row.content());
            m.put("user", authors.get(row.userId()));
            m.put("likeCount", 0);
            m.put("replyCount", 0);
            m.put("liked", false);
            m.put("status", row.status());
            m.put("createdAt", row.createdAt() == null ? null : row.createdAt().toInstant());
            return m;
        }).toList();
        return PageResult.of(items, total, normalizedPage, normalizedSize);
    }

    @Transactional
    public Map<String, Object> comment(long userId, long feedId, String content) {
        feed(feedId, userId);
        String sanitized = sanitize(content);
        if (sanitized.isBlank() || sanitized.length() > MAX_COMMENT_LENGTH) {
            throw new ApiException(ErrorCode.VALIDATION, "评论长度应为 1-1000 字");
        }
        KeyHolder keys = new GeneratedKeyHolder();
        named.update("""
                INSERT INTO feed_comments(feed_id,user_id,content,status)
                VALUES(:feedId,:userId,:content,'VISIBLE')""",
                new MapSqlParameterSource().addValue("feedId", feedId).addValue("userId", userId).addValue("content", sanitized),
                keys, new String[]{"id"});
        long id = Objects.requireNonNull(keys.getKey()).longValue();
        jdbc.update("UPDATE feeds SET comment_count=comment_count+1 WHERE id=?", feedId);
        Long owner = jdbc.queryForObject("SELECT user_id FROM feeds WHERE id=?", Long.class, feedId);
        notifier.notify(owner, userId, "COMMENT", "动态收到评论", sanitized, "FEED", feedId);
        List<FeedCommentRow> rows = named.query("SELECT * FROM feed_comments WHERE id=:id", Map.of("id", id),
                (rs, row) -> new FeedCommentRow(rs.getLong("id"), rs.getLong("feed_id"), rs.getLong("user_id"),
                        rs.getString("content"), rs.getString("status"), rs.getTimestamp("created_at")));
        FeedCommentRow row = rows.getFirst();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", row.id());
        m.put("videoId", row.feedId());
        m.put("parentId", null);
        m.put("rootId", null);
        m.put("content", row.content());
        m.put("user", views.brief(userId));
        m.put("likeCount", 0);
        m.put("replyCount", 0);
        m.put("liked", false);
        m.put("status", row.status());
        m.put("createdAt", row.createdAt() == null ? null : row.createdAt().toInstant());
        return m;
    }

    // ------------------------------------------------------------------ 举报与通知

    @Transactional
    public Map<String, Object> report(long userId, Map<String, Object> body) {
        String reason = Objects.toString(body.get("reason"), "");
        if (reason.isBlank()) throw new ApiException(ErrorCode.VALIDATION, "请选择举报类型");
        long targetId = body.getOrDefault("targetId", 0) instanceof Number n ? n.longValue() : 0;
        KeyHolder keys = new GeneratedKeyHolder();
        named.update("""
                INSERT INTO reports(reporter_id,target_type,target_id,reason,description,evidence_urls,target_snapshot,priority,status)
                VALUES(:reporterId,:targetType,:targetId,:reason,:description,:evidenceUrls,:snapshot,:priority,'PENDING')""",
                new MapSqlParameterSource()
                        .addValue("reporterId", userId)
                        .addValue("targetType", Objects.toString(body.get("targetType"), "VIDEO"))
                        .addValue("targetId", targetId)
                        .addValue("reason", reason)
                        .addValue("description", Objects.toString(body.get("description"), ""))
                        .addValue("evidenceUrls", String.valueOf(body.getOrDefault("evidenceUrls", List.of())))
                        .addValue("snapshot", "提交时内容快照")
                        .addValue("priority", "ILLEGAL".equals(reason) ? 100 : 10),
                keys, new String[]{"id"});
        return Map.of("reportId", Objects.requireNonNull(keys.getKey()).longValue(), "status", "PENDING");
    }

    public Map<String, Object> notifications(long userId, String type, int page, int size) {
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        Map<String, Object> params = new HashMap<>();
        params.put("userId", userId);
        String filter = "";
        if (type != null && !"ALL".equals(type)) {
            filter = " AND type = :type";
            params.put("type", type);
        }
        long total = count("SELECT COUNT(*) FROM notifications WHERE user_id=:userId" + filter, params);
        Map<String, Object> pageParams = new HashMap<>(params);
        pageParams.put("limit", normalizedSize);
        pageParams.put("offset", (long) (normalizedPage - 1) * normalizedSize);
        List<NotificationRow> rows = named.query("SELECT * FROM notifications WHERE user_id=:userId" + filter
                        + " ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset", pageParams,
                (rs, row) -> new NotificationRow(rs.getLong("id"), rs.getString("type"), rs.getString("title"),
                        rs.getString("content"), nullable(rs, "actor_id"), rs.getString("target_type"),
                        nullable(rs, "target_id"), rs.getBoolean("is_read"), rs.getTimestamp("created_at")));
        Set<Long> actorIds = rows.stream().map(NotificationRow::actorId).filter(Objects::nonNull).collect(Collectors.toSet());
        Map<Long, Map<String, Object>> actors = views.briefs(actorIds);
        List<Map<String, Object>> items = new ArrayList<>(rows.size());
        for (NotificationRow row : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", row.id());
            m.put("type", row.type());
            m.put("title", row.title());
            m.put("content", row.content());
            m.put("actor", row.actorId() == null ? null : actors.get(row.actorId()));
            m.put("targetType", row.targetType());
            m.put("targetId", row.targetId());
            m.put("isRead", row.isRead());
            m.put("createdAt", row.createdAt() == null ? null : row.createdAt().toInstant());
            items.add(m);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("total", total);
        result.put("page", normalizedPage);
        result.put("pageSize", normalizedSize);
        result.put("hasMore", (long) normalizedPage * normalizedSize < total);
        result.put("unreadCount", views.count("SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=FALSE", userId));
        return result;
    }

    @Transactional
    public void readNotifications(long userId, List<?> ids) {
        if (ids == null || ids.isEmpty()) {
            jdbc.update("UPDATE notifications SET is_read=TRUE WHERE user_id=?", userId);
            return;
        }
        List<Long> targetIds = ids.stream().filter(Number.class::isInstance).map(id -> ((Number) id).longValue()).toList();
        if (targetIds.isEmpty()) return;
        named.update("UPDATE notifications SET is_read=TRUE WHERE user_id=:userId AND id IN (:ids)",
                Map.of("userId", userId, "ids", targetIds));
    }

    // ------------------------------------------------------------------ 私信

    /** 会话列表：对端资料、最后一条消息、未读数各一次批量查询。 */
    public List<Map<String, Object>> conversations(long userId) {
        List<ConversationRow> conversations = named.query("""
                SELECT * FROM conversations WHERE user_a_id=:userId OR user_b_id=:userId
                ORDER BY updated_at DESC, id DESC""", Map.of("userId", userId), (rs, row) -> new ConversationRow(
                rs.getLong("id"), rs.getLong("user_a_id"), rs.getLong("user_b_id"), rs.getTimestamp("updated_at")));
        if (conversations.isEmpty()) return List.of();
        List<Long> conversationIds = conversations.stream().map(ConversationRow::id).toList();
        Set<Long> peerIds = conversations.stream()
                .map(c -> c.userAId() == userId ? c.userBId() : c.userAId())
                .collect(Collectors.toSet());
        Map<Long, Map<String, Object>> peers = views.briefs(peerIds);
        Map<Long, String> lastMessages = new HashMap<>();
        named.query("""
                SELECT conversation_id, content FROM direct_messages
                WHERE id IN (SELECT MAX(id) FROM direct_messages WHERE conversation_id IN (:ids) GROUP BY conversation_id)""",
                Map.of("ids", conversationIds), (RowCallbackHandler) rs -> lastMessages.put(rs.getLong(1), rs.getString(2)));
        Map<Long, Long> unread = new HashMap<>();
        named.query("""
                SELECT conversation_id, COUNT(*) amount FROM direct_messages
                WHERE conversation_id IN (:ids) AND sender_id<>:userId AND is_read=FALSE
                GROUP BY conversation_id""",
                Map.of("ids", conversationIds, "userId", userId),
                (RowCallbackHandler) rs -> unread.put(rs.getLong(1), rs.getLong(2)));
        List<Map<String, Object>> result = new ArrayList<>(conversations.size());
        for (ConversationRow c : conversations) {
            long peer = c.userAId() == userId ? c.userBId() : c.userAId();
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", c.id());
            m.put("peer", peers.get(peer));
            m.put("lastMessage", lastMessages.getOrDefault(c.id(), ""));
            m.put("lastMessageAt", c.updatedAt() == null ? null : c.updatedAt().toInstant());
            m.put("unreadCount", unread.getOrDefault(c.id(), 0L));
            result.add(m);
        }
        return result;
    }

    @Transactional
    public List<Map<String, Object>> messages(long userId, long conversationId) {
        ownConversation(userId, conversationId);
        jdbc.update("UPDATE direct_messages SET is_read=TRUE WHERE conversation_id=? AND sender_id<>?", conversationId, userId);
        return named.query("SELECT * FROM direct_messages WHERE conversation_id=:id ORDER BY created_at, id",
                Map.of("id", conversationId), (rs, row) -> message(rs, userId));
    }

    @Transactional
    public Map<String, Object> sendMessage(long userId, long conversationId, Map<String, Object> body) {
        ownConversation(userId, conversationId);
        String content = Objects.toString(body.get("content"), "").trim();
        if (content.isBlank()) throw new ApiException(ErrorCode.VALIDATION, "消息不能为空");
        Map<String, Object> attachment = attachment(body.get("attachment"));
        KeyHolder keys = new GeneratedKeyHolder();
        named.update("""
                INSERT INTO direct_messages(conversation_id,sender_id,content,attachment_type,attachment_url,attachment_video_id,is_read)
                VALUES(:conversationId,:senderId,:content,:type,:url,:videoId,false)""",
                new MapSqlParameterSource()
                        .addValue("conversationId", conversationId)
                        .addValue("senderId", userId)
                        .addValue("content", content)
                        .addValue("type", attachment == null ? null : attachment.get("type"))
                        .addValue("url", attachment == null ? null : attachment.get("url"))
                        .addValue("videoId", attachment == null ? null : attachment.get("videoId")),
                keys, new String[]{"id"});
        long id = Objects.requireNonNull(keys.getKey()).longValue();
        jdbc.update("UPDATE conversations SET updated_at=? WHERE id=?", Timestamp.from(Instant.now()), conversationId);
        Map<String, Object> conversation = jdbc.queryForMap("SELECT user_a_id,user_b_id FROM conversations WHERE id=?", conversationId);
        long userA = ((Number) conversation.get("user_a_id")).longValue();
        long userB = ((Number) conversation.get("user_b_id")).longValue();
        long peer = userA == userId ? userB : userA;
        notifier.notify(peer, userId, "SYSTEM", "收到新私信",
                content.length() > 80 ? content.substring(0, 80) + "…" : content, "USER", userId);
        return named.query("SELECT * FROM direct_messages WHERE id=:id", Map.of("id", id),
                (rs, row) -> message(rs, userId)).getFirst();
    }

    // ------------------------------------------------------------------ 渲染

    /** 批量渲染动态：作者、媒体、话题、转发源各一次查询。 */
    private List<Map<String, Object>> renderFeeds(List<FeedRow> rows, Long viewer) {
        if (rows.isEmpty()) return List.of();
        Set<Long> authorIds = rows.stream().map(FeedRow::userId).collect(Collectors.toSet());
        Map<Long, Map<String, Object>> authors = views.briefs(authorIds);
        Set<Long> feedIds = rows.stream().map(FeedRow::id).collect(Collectors.toSet());
        Map<Long, List<Map<String, Object>>> media = loadMedia(feedIds);
        Map<Long, Map<String, Object>> topics = loadTopics(rows);
        Map<Long, FeedRow> repostSources = loadRepostSources(rows);

        Set<Long> likedFeeds = viewer == null ? Set.of() : Set.copyOf(named.queryForList("""
                SELECT target_id FROM likes
                WHERE user_id=:viewer AND target_type='FEED' AND type='LIKE' AND target_id IN (:ids)""",
                Map.of("viewer", viewer, "ids", feedIds), Long.class));
        Set<Long> previewAuthors = repostSources.values().stream().map(FeedRow::userId).collect(Collectors.toSet());
        Map<Long, Map<String, Object>> allAuthors = previewAuthors.isEmpty()
                ? authors
                : mergeAuthors(authors, views.briefs(previewAuthors));
        Map<Long, List<Map<String, Object>>> previewMedia = repostSources.isEmpty()
                ? Map.of()
                : loadMedia(repostSources.keySet());
        Map<Long, Map<String, Object>> previewTopics = repostSources.isEmpty() ? Map.of() : loadTopics(List.copyOf(repostSources.values()));

        List<Map<String, Object>> items = new ArrayList<>(rows.size());
        for (FeedRow row : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", row.id());
            m.put("type", row.type());
            m.put("content", row.content());
            m.put("user", allAuthors.get(row.userId()));
            m.put("media", media.getOrDefault(row.id(), List.of()));
            m.put("topic", row.topicId() == null ? null : topics.get(row.topicId()));
            m.put("mentions", List.of());
            m.put("repostOf", row.repostOfId() == null ? null
                    : renderPreview(repostSources.get(row.repostOfId()), allAuthors, previewMedia, previewTopics));
            m.put("stats", Map.of("likes", row.likeCount(), "comments", row.commentCount(), "reposts", row.repostCount()));
            m.put("liked", likedFeeds.contains(row.id()));
            m.put("createdAt", row.createdAt() == null ? null : row.createdAt().toInstant());
            m.put("isOwner", viewer != null && viewer == row.userId());
            items.add(m);
        }
        return items;
    }

    private Map<String, Object> renderPreview(FeedRow row, Map<Long, Map<String, Object>> authors,
                                              Map<Long, List<Map<String, Object>>> media,
                                              Map<Long, Map<String, Object>> topics) {
        if (row == null) return null;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", row.id());
        m.put("type", row.type());
        m.put("content", row.content());
        m.put("user", authors.get(row.userId()));
        m.put("media", media.getOrDefault(row.id(), List.of()));
        m.put("topic", row.topicId() == null ? null : topics.get(row.topicId()));
        m.put("mentions", List.of());
        m.put("repostOf", null);
        m.put("stats", Map.of("likes", row.likeCount(), "comments", row.commentCount(), "reposts", row.repostCount()));
        m.put("liked", false);
        m.put("createdAt", row.createdAt() == null ? null : row.createdAt().toInstant());
        m.put("isOwner", false);
        return m;
    }

    private static Map<Long, Map<String, Object>> mergeAuthors(Map<Long, Map<String, Object>> first,
                                                               Map<Long, Map<String, Object>> second) {
        Map<Long, Map<String, Object>> merged = new HashMap<>(first);
        merged.putAll(second);
        return merged;
    }

    private Map<Long, List<Map<String, Object>>> loadMedia(Set<Long> feedIds) {
        if (feedIds.isEmpty()) return Map.of();
        Map<Long, List<Map<String, Object>>> media = new HashMap<>();
        named.query("SELECT * FROM feed_media WHERE feed_id IN (:ids) ORDER BY feed_id, sort_order",
                Map.of("ids", feedIds), (RowCallbackHandler) rs -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("mediaType", rs.getString("media_type"));
                    m.put("url", rs.getString("url"));
                    m.put("thumbUrl", rs.getString("thumb_url"));
                    m.put("videoId", nullable(rs, "video_id"));
                    m.put("sortOrder", rs.getInt("sort_order"));
                    media.computeIfAbsent(rs.getLong("feed_id"), key -> new ArrayList<>()).add(m);
                });
        return media;
    }

    private Map<Long, Map<String, Object>> loadTopics(List<FeedRow> rows) {
        Set<Long> topicIds = rows.stream().map(FeedRow::topicId).filter(Objects::nonNull).collect(Collectors.toSet());
        if (topicIds.isEmpty()) return Map.of();
        Map<Long, Map<String, Object>> topics = new HashMap<>();
        named.query("SELECT id,name FROM topics WHERE id IN (:ids)", Map.of("ids", topicIds),
                (RowCallbackHandler) rs -> topics.put(rs.getLong(1), Map.of("id", rs.getLong(1), "name", rs.getString(2))));
        return topics;
    }

    private Map<Long, FeedRow> loadRepostSources(List<FeedRow> rows) {
        Set<Long> repostIds = rows.stream().map(FeedRow::repostOfId).filter(Objects::nonNull).collect(Collectors.toSet());
        if (repostIds.isEmpty()) return Map.of();
        Map<Long, FeedRow> sources = new HashMap<>();
        named.query("SELECT * FROM feeds WHERE id IN (:ids) AND status='VISIBLE'", Map.of("ids", repostIds),
                (rs, row) -> sources.put(rs.getLong("id"), feedRow(rs, row)));
        return sources;
    }

    private static FeedRow feedRow(ResultSet rs, int rowNum) throws SQLException {
        return new FeedRow(rs.getLong("id"), rs.getLong("user_id"), rs.getString("type"), rs.getString("content"),
                nullable(rs, "repost_of_id"), nullable(rs, "topic_id"), rs.getLong("like_count"),
                rs.getLong("comment_count"), rs.getLong("repost_count"), rs.getTimestamp("created_at"));
    }

    private Map<String, Object> message(ResultSet rs, long viewer) throws SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", rs.getLong("id"));
        m.put("conversationId", rs.getLong("conversation_id"));
        m.put("senderId", rs.getLong("sender_id"));
        m.put("content", rs.getString("content"));
        String type = rs.getString("attachment_type");
        if (type == null) {
            m.put("attachment", null);
        } else {
            Map<String, Object> a = new LinkedHashMap<>();
            a.put("type", type);
            a.put("url", rs.getString("attachment_url"));
            a.put("videoId", nullable(rs, "attachment_video_id"));
            m.put("attachment", a);
        }
        m.put("createdAt", instant(rs, "created_at"));
        m.put("mine", rs.getLong("sender_id") == viewer);
        return m;
    }

    private Map<String, Object> attachment(Object value) {
        if (!(value instanceof Map<?, ?> raw)) return null;
        String type = Objects.toString(raw.get("type"), "");
        String url = Objects.toString(raw.get("url"), "").trim();
        if (!Set.of("IMAGE", "VIDEO").contains(type) || url.isBlank() || url.length() > 512
                || !(url.startsWith("https://") || url.startsWith("http://") || url.startsWith("/"))) {
            throw new ApiException(ErrorCode.VALIDATION, "附件类型或地址无效");
        }
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("type", type);
        a.put("url", url);
        if (raw.get("videoId") instanceof Number n) a.put("videoId", n.longValue());
        return a;
    }

    private void ownConversation(long userId, long id) {
        if (!views.bool("SELECT COUNT(*)>0 FROM conversations WHERE id=? AND (user_a_id=? OR user_b_id=?)", id, userId, userId)) {
            throw new ApiException(ErrorCode.FORBIDDEN, "无权访问该会话");
        }
    }

    private long count(String sql, Map<String, Object> params) {
        Long value = named.queryForObject(sql, params, Long.class);
        return value == null ? 0L : value;
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

    private static Long nullable(ResultSet rs, String name) throws SQLException {
        long value = rs.getLong(name);
        return rs.wasNull() ? null : value;
    }

    private static Instant instant(ResultSet rs, String name) throws SQLException {
        Timestamp value = rs.getTimestamp(name);
        return value == null ? null : value.toInstant();
    }

    private record FeedRow(long id, long userId, String type, String content, Long repostOfId, Long topicId,
                           long likeCount, long commentCount, long repostCount, Timestamp createdAt) { }

    private record FeedCommentRow(long id, long feedId, long userId, String content, String status, Timestamp createdAt) { }

    private record NotificationRow(long id, String type, String title, String content, Long actorId,
                                   String targetType, Long targetId, boolean isRead, Timestamp createdAt) { }

    private record ConversationRow(long id, long userAId, long userBId, Timestamp updatedAt) { }
}
