package com.videoshare.video;

import com.videoshare.common.PageResult;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 视频目录查询。
 *
 * <p>此前列表接口的做法是 {@code videos.findAll()} 把整表读进内存，再在 Java 里过滤、
 * 排序、截断。数据量一上来，内存、GC 和延迟都会随表大小线性恶化。这里把过滤条件、
 * 排序表达式和分页全部下推到 SQL，只把当前页的主键带回，再用一次 {@code IN} 查询
 * 装载实体：无论表多大，单次请求的工作量都只和页大小有关。</p>
 *
 * <p>排序表达式只用 H2(MySQL 模式) 与 MySQL 都支持的函数（LN/EXP/GREATEST/ABS/
 * TIMESTAMPDIFF），因此开发库与生产库行为一致。</p>
 */
@Component
public class VideoCatalog {

    /** 列表排序策略；请求参数到枚举的映射集中在 {@link #sortOf(String)}。 */
    public enum Sort {
        LATEST, VIEWS, HOT, RECOMMEND
    }

    /** 目录过滤条件，null 表示不过滤。 */
    public record Filter(String keyword, VideoType videoType, Long categoryId, String duration, String dateRange) {
        public static Filter of(String keyword, VideoType videoType, Long categoryId, String duration, String dateRange) {
            return new Filter(keyword, videoType, categoryId, duration, dateRange);
        }
    }

    private static final String VISIBLE = "v.status='PUBLISHED' AND v.visibility='PUBLIC'";
    /**
     * 排序/过滤键。V6 迁移已把 PUBLISHED 视频的 NULL published_at 回填为 created_at，
     * 因此这里直接用列本身：{@code COALESCE(...)} 是表达式，会让排序索引完全失效。
     */
    private static final String PUBLISHED_AT = "v.published_at";
    /** 打分表达式保留回退，避免异常数据算出 NULL 分数；它不参与索引。 */
    private static final String EFFECTIVE_AT = "COALESCE(v.published_at, v.created_at)";
    private static final String AGE_HOURS = "GREATEST(0, TIMESTAMPDIFF(HOUR, " + EFFECTIVE_AT + ", CURRENT_TIMESTAMP))";
    private static final String ENGAGEMENT =
            "(0.35*LN(1+v.view_count)+0.95*LN(1+v.like_count)+1.25*LN(1+v.comment_count)+1.05*LN(1+v.favorite_count))";
    private static final String HOT_SCORE = ENGAGEMENT + "*(0.55+0.45*EXP(-" + AGE_HOURS + "/72.0))";
    private static final String RECOMMEND_SCORE = ENGAGEMENT + "*(0.35+0.65*EXP(-" + AGE_HOURS + "/240.0))";
    private static final String NEWCOMER_WINDOW_DAYS = "30";

    private final NamedParameterJdbcTemplate named;
    private final VideoRepository videos;

    public VideoCatalog(NamedParameterJdbcTemplate named, VideoRepository videos) {
        this.named = named;
        this.videos = videos;
    }

    public static Sort sortOf(String value) {
        return switch (Objects.requireNonNullElse(value, "recommend").toLowerCase(Locale.ROOT)) {
            case "latest", "newest" -> Sort.LATEST;
            case "views", "play" -> Sort.VIEWS;
            case "hot" -> Sort.HOT;
            default -> Sort.RECOMMEND;
        };
    }

    // ------------------------------------------------------------ 目录分页

    public PageResult<Video> page(Filter filter, Sort sort, int page, int size) {
        Map<String, Object> params = new HashMap<>();
        String where = " WHERE " + VISIBLE + buildFilters(filter, params);
        String orderBy = switch (sort) {
            case LATEST -> PUBLISHED_AT + " DESC, v.id DESC";
            case VIEWS -> "v.view_count DESC, " + PUBLISHED_AT + " DESC, v.id DESC";
            case HOT -> HOT_SCORE + " DESC, v.id DESC";
            case RECOMMEND -> RECOMMEND_SCORE + " DESC, v.id DESC";
        };
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        long total = Objects.requireNonNullElse(
                named.queryForObject("SELECT COUNT(*) FROM videos v" + where, params, Long.class), 0L);
        if (total == 0) return PageResult.empty(normalizedPage, normalizedSize);
        params.put("limit", normalizedSize);
        params.put("offset", (long) (normalizedPage - 1) * normalizedSize);
        List<Long> ids = named.queryForList(
                "SELECT v.id FROM videos v" + where + " ORDER BY " + orderBy + " LIMIT :limit OFFSET :offset",
                params, Long.class);
        return PageResult.of(loadOrdered(ids), total, normalizedPage, normalizedSize);
    }

    // ------------------------------------------------------------ 相关推荐

    /** 同分区优先、其次按播放量的相关视频；全部由 SQL 完成排序。 */
    public List<Video> related(long videoId, Long categoryId, int limit) {
        Map<String, Object> params = new HashMap<>();
        params.put("id", videoId);
        params.put("limit", Math.clamp(limit, 1, PageResult.MAX_PAGE_SIZE));
        params.put("category", categoryId);
        return loadOrdered(named.queryForList("""
                SELECT v.id FROM videos v
                WHERE %s AND v.id <> :id
                ORDER BY CASE WHEN v.category_id = :category THEN 0 ELSE 1 END, v.view_count DESC, v.id DESC
                LIMIT :limit
                """.formatted(VISIBLE), params, Long.class));
    }

    // ------------------------------------------------------------ 排行榜

    /** 榜单条目：视频实体 + 由 SQL 计算出的排序分数。 */
    public record RankedVideo(Video video, double score) { }

    /**
     * 榜单：把原先 Java 侧的 rankingScore 等价改写为 SQL 表达式，只取前 limit 条。
     *
     * @param metric hot / trend / views / likes / comments / favorites / newcomer
     * @param window daily / weekly / monthly / all
     */
    public List<RankedVideo> ranking(String metric, String window, Long categoryId, int limit) {
        String period = Objects.requireNonNullElse(window, "daily");
        Map<String, Object> params = new HashMap<>();
        params.put("limit", Math.clamp(limit, 1, PageResult.MAX_PAGE_SIZE));
        StringBuilder where = new StringBuilder(" WHERE ").append(VISIBLE);
        if (categoryId != null) {
            where.append(" AND v.category_id = :category");
            params.put("category", categoryId);
        }
        if ("newcomer".equals(metric)) {
            where.append(" AND ").append(PUBLISHED_AT).append(" >= :newcomerSince");
            params.put("newcomerSince", Timestamp.from(Instant.now().minus(Duration.ofDays(Long.parseLong(NEWCOMER_WINDOW_DAYS)))));
        }
        Instant since = switch (period) {
            case "weekly" -> Instant.now().minus(Duration.ofDays(7));
            case "monthly" -> Instant.now().minus(Duration.ofDays(30));
            case "all" -> Instant.EPOCH;
            default -> Instant.now().minus(Duration.ofDays(1));
        };
        params.put("since", Timestamp.from(since));
        String score = rankingScoreExpression(metric);
        List<ScoredId> rows = named.query(
                "SELECT v.id, " + score + " AS score FROM videos v" + where
                        + " ORDER BY score DESC, v.id DESC LIMIT :limit",
                params, (rs, row) -> new ScoredId(rs.getLong("id"), rs.getDouble("score")));
        Map<Long, Video> byId = videos.findAllById(rows.stream().map(ScoredId::id).toList()).stream()
                .collect(Collectors.toMap(Video::getId, Function.identity(), (a, b) -> a));
        return rows.stream()
                .map(row -> byId.get(row.id()) == null ? null : new RankedVideo(byId.get(row.id()), row.score()))
                .filter(Objects::nonNull)
                .toList();
    }

    private record ScoredId(long id, double score) { }

    private static String rankingScoreExpression(String metric) {
        String base = switch (Objects.requireNonNullElse(metric, "hot")) {
            case "views" -> "LN(1+v.view_count)";
            case "likes" -> "LN(1+v.like_count)";
            case "comments" -> "LN(1+v.comment_count)";
            case "favorites" -> "LN(1+v.favorite_count)";
            case "trend" -> "0.28*LN(1+v.view_count)+1.35*LN(1+v.like_count)+1.6*LN(1+v.comment_count)+1.45*LN(1+v.favorite_count)";
            default -> "0.38*LN(1+v.view_count)+1.1*LN(1+v.like_count)+1.35*LN(1+v.comment_count)+1.15*LN(1+v.favorite_count)";
        };
        // 趋势榜对新内容更敏感（24/√age），其余榜单按窗口给固定加成或时间衰减。
        String recency = "trend".equals(metric)
                ? "CASE WHEN " + PUBLISHED_AT + " >= :since"
                        + " THEN GREATEST(1.0, 24.0/SQRT(GREATEST(1, TIMESTAMPDIFF(HOUR, " + PUBLISHED_AT + ", CURRENT_TIMESTAMP))))"
                        + " ELSE GREATEST(0.25, 1.0/(1.0 + TIMESTAMPDIFF(HOUR, " + PUBLISHED_AT + ", CURRENT_TIMESTAMP)/240.0)) END"
                : "CASE WHEN " + PUBLISHED_AT + " >= :since"
                        + " THEN 1.2"
                        + " ELSE GREATEST(0.35, 1.0/(1.0 + ABS(TIMESTAMPDIFF(HOUR, " + PUBLISHED_AT + ", :since))/240.0)) END";
        return "(" + base + ")*(" + recency + ")";
    }

    // ------------------------------------------------------------ 短视频流

    /** 短视频按游标（偏移量）分页，附带精确的 nextCursor 与 hasMore。 */
    public PageResult.CursorSlice<Video> shorts(int offset, int size) {
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        Map<String, Object> params = Map.of("limit", normalizedSize + 1, "offset", (long) Math.max(0, offset));
        List<Long> ids = named.queryForList("""
                SELECT v.id FROM videos v
                WHERE %s AND v.video_type = 'SHORT'
                ORDER BY %s DESC, v.id DESC
                LIMIT :limit OFFSET :offset
                """.formatted(VISIBLE, PUBLISHED_AT), params, Long.class);
        boolean hasMore = ids.size() > normalizedSize;
        List<Long> window = hasMore ? ids.subList(0, normalizedSize) : ids;
        return new PageResult.CursorSlice<>(loadOrdered(window),
                hasMore ? String.valueOf(Math.max(0, offset) + normalizedSize) : null);
    }

    // ------------------------------------------------------------ 作者维度

    /** 作者视频列表，可附带状态过滤（创作中心使用 ALL 表示不过滤）。 */
    public PageResult<Video> byUser(long userId, String status, boolean publishedOnly, int page, int size) {
        Map<String, Object> params = new HashMap<>();
        params.put("userId", userId);
        StringBuilder where = new StringBuilder(" WHERE v.user_id = :userId");
        if (publishedOnly) where.append(" AND v.status='PUBLISHED' AND v.visibility='PUBLIC'");
        if (status != null && !status.isBlank() && !"ALL".equalsIgnoreCase(status)) {
            where.append(" AND v.status = :status");
            params.put("status", status.toUpperCase(Locale.ROOT));
        }
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        long total = Objects.requireNonNullElse(
                named.queryForObject("SELECT COUNT(*) FROM videos v" + where, params, Long.class), 0L);
        if (total == 0) return PageResult.empty(normalizedPage, normalizedSize);
        params.put("limit", normalizedSize);
        params.put("offset", (long) (normalizedPage - 1) * normalizedSize);
        List<Long> ids = named.queryForList("SELECT v.id FROM videos v" + where
                + " ORDER BY COALESCE(v.published_at, v.created_at) DESC, v.id DESC LIMIT :limit OFFSET :offset",
                params, Long.class);
        return PageResult.of(loadOrdered(ids), total, normalizedPage, normalizedSize);
    }

    /**
     * 「个人数据表 + 视频可见性」的分页原语。
     *
     * <p>这里刻意不用 {@code JOIN videos v}：2 万视频实测下优化器会选「以 videos 为驱动表」
     * 的计划，单请求要扫 2 万行再回查个人表（H2 计划里 {@code scanCount: 20003}）。
     * 改成 EXISTS 半连接后驱动表回到个人表（{@code scanCount: 302}），每行一次主键回查，
     * 扫描量与个人数据量成正比而不是与视频总量成正比；语义与原先的内连接完全一致。</p>
     *
     * @param selectColumn 个人表上的视频 id 列，如 {@code "f.video_id"}
     * @param fromWhere    形如 {@code "favorites f WHERE f.user_id = :userId AND EXISTS (...)"}
     */
    public PageResult<Video> pageFiltered(String selectColumn, String fromWhere, Map<String, Object> params,
                                          String orderBy, int page, int size) {
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(size, 1, PageResult.MAX_PAGE_SIZE);
        Long counted = named.queryForObject("SELECT COUNT(*) FROM " + fromWhere, params, Long.class);
        long total = counted == null ? 0L : counted;
        if (total == 0) return PageResult.empty(normalizedPage, normalizedSize);
        Map<String, Object> pageParams = new HashMap<>(params);
        pageParams.put("limit", normalizedSize);
        pageParams.put("offset", (long) (normalizedPage - 1) * normalizedSize);
        List<Long> ids = named.queryForList(
                "SELECT " + selectColumn + " FROM " + fromWhere + " ORDER BY " + orderBy + " LIMIT :limit OFFSET :offset",
                pageParams, Long.class);
        return PageResult.of(loadOrdered(ids), total, normalizedPage, normalizedSize);
    }

    // ------------------------------------------------------------ 内部工具

    private String buildFilters(Filter filter, Map<String, Object> params) {
        StringBuilder where = new StringBuilder();
        if (filter.keyword() != null && !filter.keyword().isBlank()) {
            where.append("""
                     AND (LOWER(v.title) LIKE :keyword
                          OR EXISTS (SELECT 1 FROM video_tags vt JOIN tags t ON t.id = vt.tag_id
                                     WHERE vt.video_id = v.id AND LOWER(t.tag_name) LIKE :keyword))""");
            params.put("keyword", "%" + filter.keyword().trim().toLowerCase(Locale.ROOT) + "%");
        }
        if (filter.videoType() != null) {
            where.append(" AND v.video_type = :videoType");
            params.put("videoType", filter.videoType().name());
        }
        if (filter.categoryId() != null) {
            where.append(" AND v.category_id = :categoryId");
            params.put("categoryId", filter.categoryId());
        }
        switch (Objects.requireNonNullElse(filter.duration(), "")) {
            case "short" -> where.append(" AND v.duration < 300");
            case "medium" -> where.append(" AND v.duration BETWEEN 300 AND 1800");
            case "long" -> where.append(" AND v.duration > 1800");
            default -> { }
        }
        int days = switch (Objects.requireNonNullElse(filter.dateRange(), "all")) {
            case "day" -> 1;
            case "week" -> 7;
            case "month" -> 30;
            default -> 0;
        };
        if (days > 0) {
            where.append(" AND ").append(PUBLISHED_AT).append(" >= :publishedSince");
            params.put("publishedSince", Timestamp.from(Instant.now().minus(Duration.ofDays(days))));
        }
        return where.toString();
    }

    /** 按传入主键顺序装载实体，避免 {@code findAllById} 的返回顺序不确定。 */
    public List<Video> loadOrdered(List<Long> ids) {
        if (ids.isEmpty()) return List.of();
        Map<Long, Video> byId = videos.findAllById(ids).stream()
                .collect(Collectors.toMap(Video::getId, Function.identity(), (a, b) -> a));
        List<Video> ordered = new ArrayList<>(ids.size());
        for (Long id : ids) {
            Video video = byId.get(id);
            if (video != null) ordered.add(video);
        }
        return ordered;
    }
}
