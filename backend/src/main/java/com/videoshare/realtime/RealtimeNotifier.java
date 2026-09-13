package com.videoshare.realtime;

import com.videoshare.common.ViewFactory;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.SimpleJdbcInsert;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

@Service
public class RealtimeNotifier {
    private final JdbcTemplate jdbc;
    private final ViewFactory views;
    private final SimpMessagingTemplate messaging;

    public RealtimeNotifier(JdbcTemplate jdbc, ViewFactory views, SimpMessagingTemplate messaging) {
        this.jdbc = jdbc;
        this.views = views;
        this.messaging = messaging;
    }

    public void notify(long userId, Long actorId, String type, String title, String content, String targetType, Long targetId) {
        if (actorId != null && actorId == userId) return;
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("user_id", userId);
        values.put("actor_id", actorId);
        values.put("type", type);
        values.put("title", title);
        values.put("content", content);
        values.put("target_type", targetType);
        values.put("target_id", targetId);
        values.put("is_read", false);
        long id = new SimpleJdbcInsert(jdbc).withTableName("notifications").usingGeneratedKeyColumns("id").usingColumns("user_id","actor_id","type","title","content","target_type","target_id","is_read")
                .executeAndReturnKey(values).longValue();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("id", id);
        payload.put("type", type);
        payload.put("title", title);
        payload.put("content", content);
        payload.put("actor", actorId == null ? null : views.brief(actorId));
        payload.put("targetType", targetType);
        payload.put("targetId", targetId);
        payload.put("isRead", false);
        payload.put("createdAt", Instant.now());
        messaging.convertAndSendToUser(String.valueOf(userId), "/queue/notifications", payload);
    }
}
