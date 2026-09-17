package com.videoshare.video;

import com.videoshare.auth.CurrentUser;
import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import com.videoshare.common.ViewFactory;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 弹幕。
 *
 * <p>{@code danmaku} 表在 V4 迁移里就已建好（含时间轴索引与 status），但一直没有服务端实现，
 * 前端仅有「开启/关闭弹幕」的快捷键文案，功能等于不存在。这里补上时间线读取与发送。
 */
@Service
public class DanmakuService {

    private static final int MAX_CONTENT_LENGTH = 200;
    private static final int MAX_BATCH = 500;

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;
    private final VideoService videos;
    private final ViewFactory views;

    public DanmakuService(JdbcTemplate jdbc, NamedParameterJdbcTemplate named, VideoService videos, ViewFactory views) {
        this.jdbc = jdbc;
        this.named = named;
        this.videos = videos;
        this.views = views;
    }

    /** 按时间轴取一条视频的弹幕；只返回可见弹幕，按时间升序。 */
    public List<Map<String, Object>> timeline(long videoId, CurrentUser current) {
        // 复用视频可见性校验：不可播放的视频不应泄露弹幕
        videos.playable(videoId, current);
        List<DanmakuRow> rows = jdbc.query("""
                SELECT id,user_id,time_offset_ms,content,color,position,created_at
                FROM danmaku WHERE video_id=? AND status='VISIBLE'
                ORDER BY time_offset_ms ASC, id ASC LIMIT ?""",
                (rs, n) -> new DanmakuRow(rs.getLong("id"), rs.getLong("user_id"), rs.getInt("time_offset_ms"),
                        rs.getString("content"), rs.getString("color"), rs.getString("position")),
                videoId, MAX_BATCH);
        if (rows.isEmpty()) return List.of();
        Set<Long> userIds = rows.stream().map(DanmakuRow::userId).collect(java.util.stream.Collectors.toSet());
        Map<Long, Map<String, Object>> authors = views.briefs(userIds);
        List<Map<String, Object>> items = new ArrayList<>(rows.size());
        for (DanmakuRow row : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", row.id());
            m.put("timeMs", row.timeOffsetMs());
            m.put("content", row.content());
            m.put("color", row.color());
            m.put("position", row.position());
            m.put("user", authors.get(row.userId()));
            items.add(m);
        }
        return items;
    }

    @Transactional
    public Map<String, Object> send(long videoId, CurrentUser current, Map<String, Object> body) {
        if (current == null) throw new ApiException(ErrorCode.UNAUTHORIZED, "请先登录");
        videos.playable(videoId, current);
        String content = Objects.toString(body.get("content"), "").trim();
        if (content.isEmpty()) throw new ApiException(ErrorCode.VALIDATION, "弹幕内容不能为空");
        if (content.length() > MAX_CONTENT_LENGTH) {
            throw new ApiException(ErrorCode.VALIDATION, "弹幕不能超过 " + MAX_CONTENT_LENGTH + " 字");
        }
        long timeMs = body.get("timeMs") instanceof Number n ? Math.max(0, n.longValue()) : 0L;
        String color = normalizeColor(Objects.toString(body.get("color"), "#FFFFFF"));
        String position = normalizePosition(Objects.toString(body.get("position"), "SCROLL"));
        jdbc.update("""
                INSERT INTO danmaku(video_id,user_id,time_offset_ms,content,color,position,status)
                VALUES(?,?,?,?,?,?,'VISIBLE')""",
                videoId, current.id(), timeMs, content, color, position);
        Long id = jdbc.queryForObject("SELECT MAX(id) FROM danmaku WHERE video_id=? AND user_id=?",
                Long.class, videoId, current.id());
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("timeMs", timeMs);
        m.put("content", content);
        m.put("color", color);
        m.put("position", position);
        m.put("user", views.brief(current.id()));
        return m;
    }

    /** 只接受 #RGB / #RRGGBB，避免把任意字符串写进颜色列并被前端当作样式使用。 */
    private static String normalizeColor(String color) {        String value = color == null ? "" : color.trim();
        return value.matches("#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})") ? value.toUpperCase(java.util.Locale.ROOT) : "#FFFFFF";
    }

    private static String normalizePosition(String position) {
        String value = position == null ? "" : position.trim().toUpperCase(java.util.Locale.ROOT);
        return Set.of("SCROLL", "TOP", "BOTTOM").contains(value) ? value : "SCROLL";
    }

    private record DanmakuRow(long id, long userId, int timeOffsetMs, String content, String color, String position) { }
}
