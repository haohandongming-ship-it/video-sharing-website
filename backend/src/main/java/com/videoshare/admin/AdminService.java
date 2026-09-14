package com.videoshare.admin;

import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import com.videoshare.common.PageResult;
import com.videoshare.common.ViewFactory;
import com.videoshare.user.Role;
import com.videoshare.user.User;
import com.videoshare.user.UserRepository;
import com.videoshare.user.UserStatus;
import com.videoshare.video.Video;
import com.videoshare.video.VideoCatalog;
import com.videoshare.video.VideoRepository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * 运营后台。
 *
 * <p>主要改动：</p>
 * <ul>
 *   <li>审核队列、举报、用户、视频、审计日志全部改为 SQL 过滤 + 分页，替代 {@code findAll()} 全表加载；</li>
 *   <li>概览的 14 天趋势从 42 条独立 count 收敛为 3 条分组聚合；</li>
 *   <li>把只在 H2 成立的 {@code DATEDIFF('SECOND',a,b)} 换成两者通用的 {@code TIMESTAMPDIFF(SECOND,a,b)}；</li>
 *   <li>Jackson 3（{@code tools.jackson}）替代 Jackson 2。</li>
 * </ul>
 */
@Service
public class AdminService {

    private static final int TREND_DAYS = 14;

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;
    private final UserRepository users;
    private final VideoRepository videos;
    private final VideoCatalog catalog;
    private final ViewFactory views;
    private final ObjectMapper json;

    public AdminService(JdbcTemplate jdbc, NamedParameterJdbcTemplate named, UserRepository users,
                        VideoRepository videos, VideoCatalog catalog, ViewFactory views, ObjectMapper json) {
        this.jdbc = jdbc;
        this.named = named;
        this.users = users;
        this.videos = videos;
        this.catalog = catalog;
        this.views = views;
        this.json = json;
    }

    // ------------------------------------------------------------------ 概览

    public Map<String, Object> overview() {
        LocalDate today = LocalDate.now();
        Timestamp startOfToday = Timestamp.valueOf(today.atStartOfDay());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("users", Map.of(
                "total", users.count(),
                "todayNew", count("SELECT COUNT(*) FROM users WHERE created_at>=?", startOfToday),
                "activeToday", count("SELECT COUNT(*) FROM users WHERE last_login_at>=?", startOfToday),
                "banned", count("SELECT COUNT(*) FROM users WHERE status='BANNED'")));
        out.put("videos", Map.of(
                "total", videos.count(),
                "todayNew", count("SELECT COUNT(*) FROM videos WHERE created_at>=?", startOfToday),
                "processing", count("SELECT COUNT(*) FROM videos WHERE status='PROCESSING'"),
                "reviewing", count("SELECT COUNT(*) FROM videos WHERE status='REVIEWING'")));
        out.put("interaction", Map.of(
                "commentsToday", count("SELECT COUNT(*) FROM comments WHERE created_at>=?", startOfToday),
                "likesToday", count("SELECT COUNT(*) FROM likes WHERE created_at>=?", startOfToday),
                "reportsPending", count("SELECT COUNT(*) FROM reports WHERE status='PENDING'")));
        Number avg = jdbc.queryForObject("""
                SELECT COALESCE(AVG(TIMESTAMPDIFF(SECOND, started_at, completed_at)),0)
                FROM transcode_tasks WHERE status='SUCCESS' AND completed_at IS NOT NULL""", Number.class);
        out.put("transcode", Map.of(
                "queued", count("SELECT COUNT(*) FROM transcode_tasks WHERE status='QUEUED'"),
                "running", count("SELECT COUNT(*) FROM transcode_tasks WHERE status='RUNNING'"),
                "failedToday", count("SELECT COUNT(*) FROM transcode_tasks WHERE status='FAILED' AND created_at>=?", startOfToday),
                "avgSeconds", avg == null ? 0 : avg.doubleValue()));
        out.put("trend", trend(today));
        out.put("categoryDistribution", jdbc.query("""
                SELECT c.name, COUNT(v.id) amount FROM categories c
                LEFT JOIN videos v ON v.category_id = c.id GROUP BY c.name""",
                (rs, n) -> Map.of("name", rs.getString(1), "value", rs.getLong(2))));
        return out;
    }

    /** 14 天趋势：三条分组聚合替代原先每天三条 count（共 42 次往返）。 */
    private List<Map<String, Object>> trend(LocalDate today) {
        Timestamp from = Timestamp.valueOf(today.minusDays(TREND_DAYS - 1L).atStartOfDay());
        // 别名不能叫 day：DAY 是 SQL 的区间关键字，H2 会把它解析成 INTERVAL 限定符。
        Map<LocalDate, Long> uploads = dailySeries(
                "SELECT CAST(created_at AS DATE) stat_day, COUNT(*) amount FROM videos WHERE created_at>=:from GROUP BY CAST(created_at AS DATE)", from);
        Map<LocalDate, Long> viewsByDay = dailySeries(
                "SELECT CAST(updated_at AS DATE) stat_day, COALESCE(SUM(view_count),0) amount FROM videos WHERE updated_at>=:from GROUP BY CAST(updated_at AS DATE)", from);
        Map<LocalDate, Long> newUsers = dailySeries(
                "SELECT CAST(created_at AS DATE) stat_day, COUNT(*) amount FROM users WHERE created_at>=:from GROUP BY CAST(created_at AS DATE)", from);
        List<Map<String, Object>> trend = new ArrayList<>(TREND_DAYS);
        for (int i = TREND_DAYS - 1; i >= 0; i--) {
            LocalDate day = today.minusDays(i);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("date", day);
            row.put("uploads", uploads.getOrDefault(day, 0L));
            row.put("views", viewsByDay.getOrDefault(day, 0L));
            row.put("newUsers", newUsers.getOrDefault(day, 0L));
            trend.add(row);
        }
        return trend;
    }

    private Map<LocalDate, Long> dailySeries(String sql, Timestamp from) {
        Map<LocalDate, Long> series = new HashMap<>();
        named.query(sql, Map.of("from", from), (RowCallbackHandler) rs -> {
            java.sql.Date day = rs.getDate(1);
            if (day != null) series.put(day.toLocalDate(), rs.getLong("amount"));
        });
        return series;
    }

    // ------------------------------------------------------------------ 审核

    public PageResult<Map<String, Object>> reviews(String status, String risk, int page, int size) {
        Map<String, Object> params = new HashMap<>();
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        appendFilter(where, params, "r.status", "status", status);
        appendFilter(where, params, "r.risk_level", "risk", risk);
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        long total = count("SELECT COUNT(*) FROM video_reviews r" + where, params);
        if (total == 0) return PageResult.empty(normalizedPage, normalizedSize);
        Map<String, Object> pageParams = new HashMap<>(params);
        pageParams.put("limit", normalizedSize);
        pageParams.put("offset", (long) (normalizedPage - 1) * normalizedSize);
        List<ReviewRow> rows = named.query("""
                SELECT r.id, r.video_id, r.machine_result, r.risk_level, r.status,
                       r.reviewer_id, r.review_note, r.submitted_at,
                       (SELECT COUNT(*) FROM reports rp WHERE rp.target_type='VIDEO' AND rp.target_id=r.video_id) AS report_count
                FROM video_reviews r%s
                ORDER BY r.submitted_at DESC, r.id DESC LIMIT :limit OFFSET :offset""".formatted(where),
                pageParams, (rs, row) -> new ReviewRow(rs.getLong("id"), rs.getLong("video_id"),
                        rs.getString("machine_result"), rs.getString("risk_level"), rs.getString("status"),
                        nullable(rs, "reviewer_id"), rs.getString("review_note"), rs.getTimestamp("submitted_at"),
                        rs.getLong("report_count")));
        Map<Long, Map<String, Object>> rendered = renderVideos(rows.stream().map(ReviewRow::videoId).toList());
        List<Map<String, Object>> items = new ArrayList<>(rows.size());
        for (ReviewRow row : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", row.id());
            m.put("video", rendered.get(row.videoId()));
            m.put("machineResult", row.machineResult());
            m.put("machineLabels", List.of());
            m.put("riskLevel", row.riskLevel());
            m.put("reportCount", row.reportCount());
            m.put("submittedAt", row.submittedAt() == null ? null : row.submittedAt().toInstant());
            m.put("status", row.status());
            m.put("reviewerId", row.reviewerId());
            m.put("reviewNote", row.reviewNote());
            items.add(m);
        }
        return PageResult.of(items, total, normalizedPage, normalizedSize);
    }

    @Transactional
    public Map<String, Object> decide(long operator, long taskId, String decision, String note) {
        List<Map<String, Object>> tasks = jdbc.queryForList("SELECT video_id FROM video_reviews WHERE id=?", taskId);
        if (tasks.isEmpty()) throw new ApiException(ErrorCode.NOT_FOUND, "审核任务不存在");
        boolean approve = "APPROVE".equals(decision);
        String status = approve ? "APPROVED" : "REJECTED";
        jdbc.update("UPDATE video_reviews SET status=?,reviewer_id=?,review_note=?,reviewed_at=? WHERE id=?",
                status, operator, note, Timestamp.from(Instant.now()), taskId);
        long videoId = ((Number) tasks.getFirst().get("video_id")).longValue();
        Video v = videos.findById(videoId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "视频不存在"));
        v.review(approve, note);
        audit(operator, "REVIEW_" + decision, "VIDEO", videoId, Map.of("note", Objects.toString(note, "")));
        return Map.of("success", true, "status", status);
    }

    // ------------------------------------------------------------------ 举报

    public PageResult<Map<String, Object>> reports(String status, String reason, int page, int size) {
        Map<String, Object> params = new HashMap<>();
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        appendFilter(where, params, "status", "status", status);
        appendFilter(where, params, "reason", "reason", reason);
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        long total = count("SELECT COUNT(*) FROM reports" + where, params);
        if (total == 0) return PageResult.empty(normalizedPage, normalizedSize);
        Map<String, Object> pageParams = new HashMap<>(params);
        pageParams.put("limit", normalizedSize);
        pageParams.put("offset", (long) (normalizedPage - 1) * normalizedSize);
        List<ReportRow> rows = named.query("SELECT * FROM reports" + where
                        + " ORDER BY priority DESC, created_at DESC, id DESC LIMIT :limit OFFSET :offset", pageParams,
                (rs, row) -> new ReportRow(rs.getLong("id"), rs.getString("target_type"), rs.getLong("target_id"),
                        rs.getString("target_snapshot"), rs.getString("reason"), rs.getString("description"),
                        rs.getLong("reporter_id"), rs.getString("status"), rs.getInt("priority"),
                        nullable(rs, "handler_id"), rs.getTimestamp("handled_at"), rs.getTimestamp("created_at")));
        Set<Long> reporterIds = rows.stream().map(ReportRow::reporterId).collect(Collectors.toSet());
        Map<Long, Map<String, Object>> reporters = views.briefs(reporterIds);
        List<Map<String, Object>> items = new ArrayList<>(rows.size());
        for (ReportRow row : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", row.id());
            m.put("targetType", row.targetType());
            m.put("targetId", row.targetId());
            m.put("targetTitle", "被举报内容 #" + row.targetId());
            m.put("targetSnapshot", Objects.requireNonNullElse(row.targetSnapshot(), ""));
            m.put("reason", row.reason());
            m.put("description", Objects.requireNonNullElse(row.description(), ""));
            m.put("evidenceUrls", List.of());
            m.put("reporter", reporters.get(row.reporterId()));
            m.put("status", row.status());
            m.put("priority", row.priority());
            m.put("handlerId", row.handlerId());
            m.put("handledAt", row.handledAt() == null ? null : row.handledAt().toInstant());
            m.put("createdAt", row.createdAt() == null ? null : row.createdAt().toInstant());
            items.add(m);
        }
        return PageResult.of(items, total, normalizedPage, normalizedSize);
    }

    @Transactional
    public Map<String, Object> handleReport(long operator, long id, String status, String note) {
        int updated = jdbc.update("UPDATE reports SET status=?,handler_id=?,handled_at=?,handle_note=? WHERE id=?",
                status, operator, Timestamp.from(Instant.now()), note, id);
        if (updated == 0) throw new ApiException(ErrorCode.NOT_FOUND, "举报不存在");
        audit(operator, "REPORT_" + status, "REPORT", id, Map.of("note", Objects.toString(note, "")));
        return Map.of("success", true, "status", status);
    }

    // ------------------------------------------------------------------ 用户

    public PageResult<Map<String, Object>> users(String keyword, String role, String status, int page, int size) {
        Map<String, Object> params = new HashMap<>();
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        if (keyword != null && !keyword.isBlank()) {
            where.append(" AND (LOWER(u.username) LIKE :keyword OR LOWER(u.nickname) LIKE :keyword OR LOWER(u.email) LIKE :keyword)");
            params.put("keyword", "%" + keyword.trim().toLowerCase(java.util.Locale.ROOT) + "%");
        }
        appendFilter(where, params, "u.role", "role", role);
        appendFilter(where, params, "u.status", "userStatus", status);
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        long total = count("SELECT COUNT(*) FROM users u" + where, params);
        if (total == 0) return PageResult.empty(normalizedPage, normalizedSize);
        Map<String, Object> pageParams = new HashMap<>(params);
        pageParams.put("limit", normalizedSize);
        pageParams.put("offset", (long) (normalizedPage - 1) * normalizedSize);
        List<Map<String, Object>> items = named.query("""
                SELECT u.id,u.username,u.nickname,u.avatar_url,u.email,u.phone,u.role,u.status,u.created_at,u.last_login_at,
                       (SELECT COUNT(*) FROM creator_profiles cp WHERE cp.user_id=u.id AND cp.auth_status='CERTIFIED') AS certified,
                       (SELECT COUNT(*) FROM videos v WHERE v.user_id=u.id) AS video_count
                FROM users u%s ORDER BY u.id LIMIT :limit OFFSET :offset""".formatted(where),
                pageParams, (rs, row) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("username", rs.getString("username"));
                    m.put("nickname", rs.getString("nickname"));
                    m.put("avatar", rs.getString("avatar_url"));
                    m.put("email", rs.getString("email"));
                    m.put("phone", rs.getString("phone"));
                    m.put("role", rs.getString("role"));
                    m.put("status", rs.getString("status"));
                    m.put("certified", rs.getLong("certified") > 0);
                    m.put("videoCount", rs.getLong("video_count"));
                    m.put("createdAt", instant(rs, "created_at"));
                    m.put("lastLoginAt", instant(rs, "last_login_at"));
                    return m;
                });
        return PageResult.of(items, total, normalizedPage, normalizedSize);
    }

    @Transactional
    public Map<String, Object> status(long operator, long id, UserStatus status, String reason) {
        User u = user(id);
        u.changeStatus(status);
        audit(operator, "USER_STATUS", "USER", id, Map.of("status", status.name(), "reason", Objects.toString(reason, "")));
        return Map.of("success", true, "status", status.name());
    }

    @Transactional
    public Map<String, Object> role(long operator, long id, Role role) {
        User u = user(id);
        u.changeRole(role);
        audit(operator, "ROLE_ASSIGN", "USER", id, Map.of("role", role.name()));
        return Map.of("success", true, "role", role.name());
    }

    // ------------------------------------------------------------------ 内容与审计

    public PageResult<Map<String, Object>> videos(String status, int page, int size) {
        Map<String, Object> params = new HashMap<>();
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        appendFilter(where, params, "v.status", "status", status);
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        long total = count("SELECT COUNT(*) FROM videos v" + where, params);
        if (total == 0) return PageResult.empty(normalizedPage, normalizedSize);
        Map<String, Object> pageParams = new HashMap<>(params);
        pageParams.put("limit", normalizedSize);
        pageParams.put("offset", (long) (normalizedPage - 1) * normalizedSize);
        List<Long> ids = named.queryForList("SELECT v.id FROM videos v" + where
                + " ORDER BY v.id LIMIT :limit OFFSET :offset", pageParams, Long.class);
        return PageResult.of(views.videoSummaries(catalog.loadOrdered(ids), null), total, normalizedPage, normalizedSize);
    }

    public PageResult<Map<String, Object>> auditLogs(int page, int size) {
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        long total = count("SELECT COUNT(*) FROM admin_audit_log", Map.of());
        if (total == 0) return PageResult.empty(normalizedPage, normalizedSize);
        List<AuditRow> rows = named.query("""
                SELECT * FROM admin_audit_log ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset""",
                Map.of("limit", normalizedSize, "offset", (long) (normalizedPage - 1) * normalizedSize),
                (rs, row) -> new AuditRow(rs.getLong("id"), rs.getLong("operator_id"), rs.getString("action"),
                        rs.getString("target_type"), rs.getLong("target_id"), rs.getString("detail"),
                        rs.getTimestamp("created_at")));
        Map<Long, Map<String, Object>> operators = views.briefs(rows.stream().map(AuditRow::operatorId).collect(Collectors.toSet()));
        List<Map<String, Object>> items = new ArrayList<>(rows.size());
        for (AuditRow row : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", row.id());
            m.put("operator", operators.get(row.operatorId()));
            m.put("action", row.action());
            m.put("targetType", row.targetType());
            m.put("targetId", row.targetId());
            m.put("detail", parseDetail(row.detail()));
            m.put("createdAt", row.createdAt() == null ? null : row.createdAt().toInstant());
            items.add(m);
        }
        return PageResult.of(items, total, normalizedPage, normalizedSize);
    }

    private Map<String, Object> parseDetail(String detail) {
        if (detail == null || detail.isBlank()) return Map.of();
        try {
            return json.readValue(detail, new TypeReference<Map<String, Object>>() { });
        } catch (RuntimeException ex) {
            return Map.of();
        }
    }

    // ------------------------------------------------------------------ 平台设置

    public Map<String, Object> settings() {
        List<String> rows = jdbc.query("SELECT setting_value FROM platform_settings WHERE setting_key='platform'",
                (rs, n) -> rs.getString(1));
        if (rows.isEmpty()) return defaults();
        Map<String, Object> parsed = parseDetail(rows.getFirst());
        return parsed.isEmpty() ? defaults() : parsed;
    }

    @Transactional
    public Map<String, Object> settings(long operator, Map<String, Object> value) {
        String text;
        try {
            text = json.writeValueAsString(value);
        } catch (RuntimeException ex) {
            throw new ApiException(ErrorCode.VALIDATION, "设置格式错误");
        }
        int updated = jdbc.update("UPDATE platform_settings SET setting_value=?,updated_by=?,updated_at=? WHERE setting_key='platform'",
                text, operator, Timestamp.from(Instant.now()));
        if (updated == 0) {
            jdbc.update("INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES(?,?,?)", "platform", text, operator);
        }
        audit(operator, "SETTINGS_UPDATE", "PLATFORM", 0, Map.of("changed", true));
        return value;
    }

    private Map<String, Object> defaults() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("review", Map.of("newUserForceReview", true, "newUserWindowHours", 24, "highTrustSampleRate", .1, "autoReportThreshold", 3));
        m.put("upload", Map.of("longMaxSizeGB", 8, "shortMaxSizeMB", 500, "longMaxDurationHours", 4, "shortMaxDurationSeconds", 180,
                "allowedExtensions", List.of("mp4", "mov", "webm", "m4v")));
        m.put("recommend", Map.of("personalizationEnabled", true, "hotFallback", true));
        m.put("minor", Map.of("teenagerModeEnabled", true, "dailyLimitMinutes", 40, "nightBlockStart", "22:00", "nightBlockEnd", "06:00"));
        return m;
    }

    private void audit(long operator, String action, String type, long target, Map<String, Object> detail) {
        try {
            jdbc.update("INSERT INTO admin_audit_log(operator_id,action,target_type,target_id,detail) VALUES(?,?,?,?,?)",
                    operator, action, type, target, json.writeValueAsString(detail));
        } catch (RuntimeException ignored) {
            // 审计写入失败不应影响主流程。
        }
    }

    // ------------------------------------------------------------------ 工具

    private Map<Long, Map<String, Object>> renderVideos(List<Long> videoIds) {
        List<Video> loaded = catalog.loadOrdered(videoIds);
        List<Map<String, Object>> rendered = views.videoSummaries(loaded, null);
        Map<Long, Map<String, Object>> byId = new HashMap<>(loaded.size());
        for (int i = 0; i < loaded.size(); i++) byId.put(loaded.get(i).getId(), rendered.get(i));
        return byId;
    }

    private static void appendFilter(StringBuilder where, Map<String, Object> params, String column, String name, String value) {
        if (value == null || value.isBlank() || "ALL".equalsIgnoreCase(value)) return;
        where.append(" AND ").append(column).append(" = :").append(name);
        params.put(name, value);
    }

    private long count(String sql, Map<String, Object> params) {
        Long value = named.queryForObject(sql, params, Long.class);
        return value == null ? 0L : value;
    }

    private long count(String sql, Object... args) {
        Number value = jdbc.queryForObject(sql, Number.class, args);
        return value == null ? 0 : value.longValue();
    }

    private User user(long id) {
        return users.findById(id).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "用户不存在"));
    }

    private static Long nullable(ResultSet rs, String name) throws SQLException {
        long value = rs.getLong(name);
        return rs.wasNull() ? null : value;
    }

    private static Instant instant(ResultSet rs, String name) throws SQLException {
        Timestamp value = rs.getTimestamp(name);
        return value == null ? null : value.toInstant();
    }

    private record ReviewRow(long id, long videoId, String machineResult, String riskLevel, String status,
                             Long reviewerId, String reviewNote, Timestamp submittedAt, long reportCount) { }

    private record ReportRow(long id, String targetType, long targetId, String targetSnapshot, String reason,
                             String description, long reporterId, String status, int priority,
                             Long handlerId, Timestamp handledAt, Timestamp createdAt) { }

    private record AuditRow(long id, long operatorId, String action, String targetType, long targetId,
                            String detail, Timestamp createdAt) { }
}
