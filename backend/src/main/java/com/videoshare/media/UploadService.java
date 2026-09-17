package com.videoshare.media;

import com.videoshare.common.*;
import com.videoshare.video.*;
import java.io.InputStream;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UploadService {
    public static final int PART_SIZE = 8 * 1024 * 1024;
    private static final String COVER_PREFIX = "media/cover/";
    private static final long MAX_COVER_BYTES = ImageStorageService.MAX_COVER_BYTES;
    private static final String COVER_TOO_LARGE = "封面图片过大，请重新截取";

    private final JdbcTemplate jdbc;
    private final FileAssetRepository files;
    private final VideoRepository videos;
    private final StorageGateway storage;
    private final VideoTags tags;
    private final ImageStorageService images;

    public UploadService(JdbcTemplate jdbc, FileAssetRepository files, VideoRepository videos, StorageGateway storage,
                         VideoTags tags, ImageStorageService images) {
        this.jdbc = jdbc;
        this.files = files;
        this.videos = videos;
        this.storage = storage;
        this.tags = tags;
        this.images = images;
    }

    @Transactional
    public Map<String, Object> init(long userId, Map<String, Object> b) {
        String name = text(b, "fileName"), sha = text(b, "sha256").toLowerCase(java.util.Locale.ROOT),
                title = text(b, "title");
        long size = number(b, "fileSize"), category = number(b, "categoryId");
        int duration = (int) Math.max(0, number(b, "duration"));
        if (title.isBlank() || title.length() > 200) throw new ApiException(ErrorCode.VALIDATION, "标题应为 1-200 字");
        if (jdbc.queryForObject("SELECT COUNT(*) FROM categories WHERE id=?", Integer.class, category) == 0)
            throw new ApiException(ErrorCode.VALIDATION, "分区不存在");
        VideoType type = enumValue(VideoType.class, text(b, "videoType"), VideoType.LONG);
        if (!sha.matches("[a-fA-F0-9]{64}")) throw new ApiException(ErrorCode.VALIDATION, "SHA-256 格式错误");
        long maxSize = type == VideoType.SHORT ? 500L * 1024 * 1024 : 8L * 1024 * 1024 * 1024;
        if (size <= 0 || size > maxSize) throw new ApiException(ErrorCode.VALIDATION, "文件大小不符合要求");
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase() : "";
        if (!Set.of("mp4", "mov", "webm", "m4v").contains(ext))
            throw new ApiException(ErrorCode.VALIDATION, "不支持的文件格式");

        // 封面由浏览器在 canvas 上抓帧后以 data URL 提交；这里落存储，数据库只存 URL。
        String coverUrl = null;
        ImageStorageService.ImagePayload cover = images.parseDataUrl(text(b, "coverDataUrl"), MAX_COVER_BYTES, COVER_TOO_LARGE);
        if (cover != null) coverUrl = images.store(COVER_PREFIX, userId, cover, COVER_TOO_LARGE);

        Optional<FileAsset> existing = files.findBySha256AndFileSize(sha, size);
        if (existing.isPresent()) {
            existing.get().reference();
            Video v = createVideo(userId, existing.get().getId(), title, text(b, "description"), category, type,
                    enumValue(Visibility.class, text(b, "visibility"), Visibility.PUBLIC), size, duration);
            videos.save(v);
            // 秒传：文件已存在，直接带封面进入待审核
            v.transcodeComplete("/api/v1/videos/" + v.getId() + "/source", coverUrl, duration);
            videos.save(v);
            jdbc.update("INSERT INTO video_reviews(video_id,machine_result,machine_labels,risk_level,status) VALUES(?,?,?,?,?)",
                    v.getId(), "PASS", "[]", "LOW", "PENDING");
            tags.append(v.getId(), list(b.get("tags")));
            return Map.of("instant", true, "fileId", existing.get().getId(), "videoId", v.getId());
        }

        String id = "up_" + UUID.randomUUID().toString().replace("-", "");
        Visibility visibility = enumValue(Visibility.class, text(b, "visibility"), Visibility.PUBLIC);
        jdbc.update("""
                INSERT INTO upload_sessions(id,user_id,sha256,file_name,file_size,part_size,video_type,title,description,
                    category_id,visibility,status,cover_url)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,'UPLOADING',?)
                """,
                id, userId, sha, name, size, PART_SIZE, type.name(), title, text(b, "description"),
                category, visibility.name(), coverUrl);
        List<Integer> parts = new ArrayList<>();
        for (int part = 1; part <= (int) Math.ceil((double) size / PART_SIZE); part++) {
            parts.add(part);
            jdbc.update("INSERT INTO upload_parts(upload_id,part_number,etag,size_bytes) VALUES(?,?,NULL,0)", id, part);
        }
        for (String tag : list(b.get("tags")))
            jdbc.update("INSERT INTO upload_session_tags(upload_id,tag_name) VALUES(?,?)", id, tag);

        List<Map<String, Object>> urls = new ArrayList<>();
        for (Integer part : parts) urls.add(Map.of("partNumber", part, "url", storage.partUrl(id, part)));
        return Map.of("instant", false, "uploadId", id, "partSize", PART_SIZE, "parts", urls, "uploadedParts", List.of());
    }

    @Transactional
    public void part(String id, int number, long expires, String signature, InputStream input, long size) {
        Map<String, Object> s = session(id);
        requireUploading(s);
        if (jdbc.queryForObject("SELECT COUNT(*) FROM upload_parts WHERE upload_id=? AND part_number=?", Integer.class, id, number) == 0)
            throw new ApiException(ErrorCode.VALIDATION, "分片编号无效");
        storage.authorizePart(id, number, expires, signature);
        storage.putLocalPart(id, number, input, size);
        jdbc.update("UPDATE upload_parts SET etag=?,size_bytes=?,uploaded_at=? WHERE upload_id=? AND part_number=?",
                "etag-" + id + "-" + number, size, Timestamp.from(Instant.now()), id, number);
    }

    @Transactional
    public Map<String, Object> complete(long userId, String id, List<Map<String, Object>> submitted) {
        Map<String, Object> s = session(id);
        if (((Number) s.get("user_id")).longValue() != userId) throw new ApiException(ErrorCode.FORBIDDEN, "无权完成此上传");
        requireUploading(s);
        List<Integer> expected = jdbc.query("SELECT part_number FROM upload_parts WHERE upload_id=? ORDER BY part_number",
                (rs, n) -> rs.getInt(1), id);
        List<Integer> got = submitted.stream().map(x -> ((Number) x.get("partNumber")).intValue()).sorted().toList();
        if (!expected.equals(got)) throw new ApiException(ErrorCode.VALIDATION, "分片列表不完整");
        long fileSize = ((Number) s.get("file_size")).longValue();
        String fileName = String.valueOf(s.get("file_name"));
        String key = storage.complete(id, String.valueOf(s.get("sha256")), expected, fileSize, fileName);
        FileAsset file = new FileAsset();
        file.initialize(String.valueOf(s.get("sha256")), fileSize, storage.bucket(), key, mime(fileName));
        files.save(file);
        Video v = createVideo(userId, file.getId(), String.valueOf(s.get("title")), Objects.toString(s.get("description"), ""),
                ((Number) s.get("category_id")).longValue(), VideoType.valueOf(String.valueOf(s.get("video_type"))),
                Visibility.valueOf(String.valueOf(s.get("visibility"))), fileSize, ((Number) s.get("duration")).intValue());
        videos.save(v);
        tags.append(v.getId(), jdbc.query("SELECT tag_name FROM upload_session_tags WHERE upload_id=?",
                (rs, n) -> rs.getString(1), id));
        // 封面在 init 阶段已落到对象存储，这里把它带回会话记录，转码完成时写入 videos.cover_url
        jdbc.update("UPDATE upload_sessions SET status='COMPLETED', video_id=? WHERE id=?", v.getId(), id);
        jdbc.update("INSERT INTO transcode_tasks(video_id,quality,status,progress) VALUES(?,?,?,?)", v.getId(), "720p", "RUNNING", 5);
        return Map.of("videoId", v.getId(), "status", "PROCESSING", "message", "上传完成，已进入转码队列");
    }

    @Transactional
    public void abort(long userId, String id) {
        Map<String, Object> s = session(id);
        if (((Number) s.get("user_id")).longValue() != userId) throw new ApiException(ErrorCode.FORBIDDEN, "无权中止此上传");
        requireUploading(s);
        storage.abort(id);
        jdbc.update("UPDATE upload_sessions SET status='ABORTED' WHERE id=?", id);
    }

    @Transactional
    public Map<String, Object> progress(long videoId) {
        Video v = videos.findById(videoId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "视频不存在"));
        List<Map<String, Object>> tasks = jdbc.queryForList(
                "SELECT * FROM transcode_tasks WHERE video_id=? ORDER BY id DESC LIMIT 1", videoId);
        if (tasks.isEmpty()) throw new ApiException(ErrorCode.NOT_FOUND, "转码任务不存在");
        Map<String, Object> task = tasks.get(0);
        long taskId = ((Number) task.get("id")).longValue();
        int progress = ((Number) task.get("progress")).intValue();
        String status = String.valueOf(task.get("status"));
        if ("RUNNING".equals(status)) {
            int next = Math.min(100, progress + 20);
            int changed = jdbc.update(
                    "UPDATE transcode_tasks SET progress=?,status=?,completed_at=CASE WHEN ?=100 THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=? AND status='RUNNING' AND progress=?",
                    next, next >= 100 ? "SUCCESS" : "RUNNING", next, taskId, progress);
            if (changed > 0) {
                progress = next;
                if (progress >= 100) {
                    status = "SUCCESS";
                    // 用上传时抓取的封面；没有则回落到项目自带的占位图
                    v.transcodeComplete("/api/v1/videos/" + videoId + "/source", coverFor(videoId), v.getDuration());
                    videos.save(v);
                    if (jdbc.queryForObject("SELECT COUNT(*) FROM video_reviews WHERE video_id=?", Integer.class, videoId) == 0)
                        jdbc.update("INSERT INTO video_reviews(video_id,machine_result,machine_labels,risk_level,status) VALUES(?,?,?,?,?)",
                                videoId, "PASS", "[]", "LOW", "PENDING");
                }
            } else {
                Map<String, Object> latest = jdbc.queryForMap("SELECT progress,status FROM transcode_tasks WHERE id=?", taskId);
                progress = ((Number) latest.get("progress")).intValue();
                status = String.valueOf(latest.get("status"));
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("videoId", videoId);
        result.put("taskId", taskId);
        result.put("quality", task.get("quality"));
        result.put("status", status);
        result.put("progress", progress);
        result.put("errorMsg", task.get("error_msg"));
        result.put("retryCount", task.get("retry_count"));
        result.put("videoStatus", v.getStatus().name());
        return result;
    }

    /** 取该视频所属上传会话记录的封面地址；没有会话或未提交封面时返回 null。 */
    private String coverFor(long videoId) {
        List<String> covers = jdbc.queryForList(
                "SELECT cover_url FROM upload_sessions WHERE video_id=? AND cover_url IS NOT NULL ORDER BY created_at DESC LIMIT 1",
                String.class, videoId);
        return covers.isEmpty() ? null : covers.get(0);
    }

    private void requireUploading(Map<String, Object> session) {
        if (!"UPLOADING".equals(session.get("status"))) throw new ApiException(ErrorCode.CONFLICT, "上传任务已结束");
    }

    private Map<String, Object> session(String id) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM upload_sessions WHERE id=?", id);
        if (rows.isEmpty()) throw new ApiException(ErrorCode.NOT_FOUND, "上传任务不存在");
        return rows.get(0);
    }

    private Video createVideo(long user, long file, String title, String description, long category, VideoType type,
                              Visibility visibility, long size) {
        return createVideo(user, file, title, description, category, type, visibility, size, 0);
    }

    private Video createVideo(long user, long file, String title, String description, long category, VideoType type,
                              Visibility visibility, long size, int duration) {
        if (title == null || title.isBlank()) throw new ApiException(ErrorCode.VALIDATION, "标题不能为空");
        Video v = new Video();
        v.initialize(user, file, title, description, category, type, visibility, size, duration);
        return v;
    }

    private String text(Map<String, Object> b, String key) { return Objects.toString(b.get(key), ""); }

    private long number(Map<String, Object> b, String key) { return b.get(key) instanceof Number n ? n.longValue() : 0; }

    private List<String> list(Object value) {
        if (!(value instanceof List<?> l)) return List.of();
        return l.stream().map(String::valueOf).filter(s -> !s.isBlank()).distinct().limit(10).toList();
    }

    private <E extends Enum<E>> E enumValue(Class<E> type, String value, E fallback) {
        try { return Enum.valueOf(type, value); } catch (Exception e) { return fallback; }
    }

    private String mime(String name) { return name.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4"; }
}
