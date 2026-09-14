package com.videoshare.video;

import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 标签读写。
 *
 * <p>标签的「不存在则创建」逻辑此前在 VideoService 与 UploadService 里各写了一份，
 * 且每个标签都要 2~3 次独立往返。这里统一实现并改为批量：先一次 {@code IN} 查询命中
 * 已有标签，再只为缺失的标签发插入，最后补齐 id 映射。</p>
 */
@Component
public class VideoTags {
    /** 单条视频最多保留的标签数。 */
    public static final int MAX_TAGS = 10;

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;

    public VideoTags(JdbcTemplate jdbc, NamedParameterJdbcTemplate named) {
        this.jdbc = jdbc;
        this.named = named;
    }

    /** 规范化：去空白、去重、限制数量。 */
    public static List<String> normalize(Collection<String> raw) {
        if (raw == null) return List.of();
        return raw.stream()
                .filter(java.util.Objects::nonNull)
                .map(String::trim)
                .filter(tag -> !tag.isBlank())
                .distinct()
                .limit(MAX_TAGS)
                .toList();
    }

    /** 确保标签存在，返回 name -> id。 */
    public Map<String, Long> ensure(Collection<String> names) {
        List<String> normalized = normalize(names);
        if (normalized.isEmpty()) return Map.of();
        Map<String, Long> ids = lookup(normalized);
        List<String> missing = normalized.stream().filter(name -> !ids.containsKey(name)).toList();
        for (String name : missing) {
            try {
                jdbc.update("INSERT INTO tags(tag_name) VALUES(?)", name);
            } catch (DuplicateKeyException concurrentInsert) {
                // 唯一索引兜底：并发下另一个请求已经插入同名标签，直接复用即可。
            }
        }
        if (!missing.isEmpty()) ids.putAll(lookup(missing));
        return ids;
    }

    /** 整体替换某视频的标签。 */
    public void replace(long videoId, Collection<String> names) {
        jdbc.update("DELETE FROM video_tags WHERE video_id=?", videoId);
        append(videoId, names);
    }

    /** 追加标签（已存在则忽略）。 */
    public void append(long videoId, Collection<String> names) {
        Map<String, Long> ids = ensure(names);
        if (ids.isEmpty()) return;
        List<Object[]> batch = ids.values().stream().map(tagId -> new Object[]{videoId, tagId}).toList();
        jdbc.batchUpdate("INSERT INTO video_tags(video_id,tag_id) VALUES(?,?)", batch);
    }

    private Map<String, Long> lookup(Collection<String> names) {
        Map<String, Long> ids = new LinkedHashMap<>();
        named.query("SELECT id, tag_name FROM tags WHERE tag_name IN (:names)", Map.of("names", names),
                (RowCallbackHandler) rs -> ids.put(rs.getString("tag_name"), rs.getLong("id")));
        return new HashMap<>(ids);
    }
}
