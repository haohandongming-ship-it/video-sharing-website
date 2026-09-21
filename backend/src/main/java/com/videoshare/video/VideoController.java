package com.videoshare.video;

import com.videoshare.auth.CurrentUser;
import com.videoshare.common.ApiException;
import com.videoshare.common.ApiResponse;
import com.videoshare.common.ErrorCode;
import com.videoshare.common.PageResult;
import com.videoshare.media.FileAsset;
import com.videoshare.media.FileAssetRepository;
import com.videoshare.media.StorageGateway;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
@RequestMapping("/api/v1/videos")
public class VideoController {

    private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");

    /**
     * 搜索页的推荐关键词。
     *
     * <p>目前是固定的占位词，不是基于搜索热度或用户历史生成的建议 —— 真实建议需要单独的
     * 统计链路，属于产品决策。集中在这里是为了让「这是占位实现」一眼可见。</p>
     */
    private static final List<String> SEARCH_SUGGESTIONS = List.of("架构设计", "性能优化", "旅行", "美食");

    private final VideoService service;
    private final VideoCoverService coverService;
    private final DanmakuService danmaku;
    private final FileAssetRepository files;
    private final StorageGateway storage;

    public VideoController(VideoService service, VideoCoverService coverService, DanmakuService danmaku,
                           FileAssetRepository files, StorageGateway storage) {
        this.service = service;
        this.coverService = coverService;
        this.danmaku = danmaku;
        this.files = files;
        this.storage = storage;
    }

    /** 弹幕时间线：未登录也可看（与播放一致）。 */
    @GetMapping("/{id}/danmaku")
    public ApiResponse<List<Map<String, Object>>> danmakuTimeline(@PathVariable long id,
                                                                  @AuthenticationPrincipal CurrentUser current) {
        return ApiResponse.ok(danmaku.timeline(id, current));
    }

    /** 发送弹幕：需要登录，可带时间点、颜色与位置。 */
    @PostMapping("/{id}/danmaku")
    public ApiResponse<Map<String, Object>> sendDanmaku(@PathVariable long id,
                                                        @AuthenticationPrincipal CurrentUser current,
                                                        @RequestHeader(name = "Idempotency-Key", required = false) String key,
                                                        @RequestBody Map<String, Object> body) {
        return ApiResponse.ok(danmaku.send(id, current, body));
    }

    /**
     * 字幕轨道列表。
     *
     * <p>{@code subtitles} 表同样在 V4 就建好了却没有服务端实现。目前上传链路不会产出字幕文件，
     * 因此这里多半返回空数组——前端据此显示「暂无字幕」，而不是给一个点了没反应的开关。
     */
    @GetMapping("/{id}/subtitles")
    public ApiResponse<List<Map<String, Object>>> subtitles(@PathVariable long id,
                                                            @AuthenticationPrincipal CurrentUser current) {
        service.playable(id, current);
        List<Map<String, Object>> items = new java.util.ArrayList<>();
        for (Map<String, Object> row : service.subtitleRows(id)) {
            Map<String, Object> m = new LinkedHashMap<>(row);
            Object objectKey = row.get("objectKey");
            if (objectKey != null) m.put("url", storage.publicUrl(String.valueOf(objectKey)));
            items.add(m);
        }
        return ApiResponse.ok(items);
    }

    @GetMapping("/{id}")
    public ApiResponse<Map<String, Object>> detail(@PathVariable long id, @AuthenticationPrincipal CurrentUser current) {
        return ApiResponse.ok(service.detail(id, current));
    }

    /** 更换/补传封面：作者本人或管理员、审核员可用。 */
    @PostMapping("/{id}/cover")
    public ApiResponse<Map<String, String>> updateCover(@PathVariable long id,
                                                        @AuthenticationPrincipal CurrentUser current,
                                                        @RequestParam("file") MultipartFile file) {
        return ApiResponse.ok(Map.of("coverUrl", coverService.update(id, current, file)));
    }

    /**
     * 源文件下载/拖动播放。Range 解析结果用 sealed 接口 + record 建模，
     * 由 switch 模式匹配穷尽处理，避免原先「解析、校验、响应」混在一段代码里。
     */
    @GetMapping("/{id}/source")
    public ResponseEntity<StreamingResponseBody> source(@PathVariable long id,
                                                        @RequestParam(defaultValue = "false") boolean download,
                                                        @AuthenticationPrincipal CurrentUser current,
                                                        @RequestHeader(value = "Range", required = false) String range) {
        Video video = service.playable(id, current);
        if (download && current == null) throw new ApiException(ErrorCode.UNAUTHORIZED, "请先登录");
        if (download && !video.isDownloadEnabled()) throw new ApiException(ErrorCode.FORBIDDEN, "作者未开放下载");
        FileAsset file = files.findById(video.getSourceFileId())
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "视频文件不存在"));
        long total = file.getFileSize();
        return switch (RangeSpec.parse(range, total)) {
            case RangeSpec.Unsatisfiable unsatisfiable -> ResponseEntity.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                    .header(HttpHeaders.CONTENT_RANGE, "bytes */" + unsatisfiable.total())
                    .build();
            case RangeSpec.Full full -> stream(file, video, 0, full.total() - 1, full.total(), false, download);
            case RangeSpec.Partial partial -> stream(file, video, partial.start(), partial.end(), partial.total(), true, download);
        };
    }

    @GetMapping("/recommend")
    public ApiResponse<PageResult<Map<String, Object>>> discover(@RequestParam(required = false) String q,
                                                                 @RequestParam(required = false) VideoType videoType,
                                                                 @RequestParam(required = false) Long categoryId,
                                                                 @RequestParam(defaultValue = "recommend") String sort,
                                                                 @RequestParam(defaultValue = "1") @Min(1) int page,
                                                                 @RequestParam(defaultValue = "20") @Min(1) @Max(100) int pageSize,
                                                                 @AuthenticationPrincipal CurrentUser current) {
        return ApiResponse.ok(service.discover(q, videoType, categoryId, sort, page, pageSize, current));
    }

    @GetMapping("/search")
    public ApiResponse<Map<String, Object>> search(@RequestParam @NotBlank String q,
                                                   @RequestParam(required = false) String duration,
                                                   @RequestParam(required = false) String dateRange,
                                                   @RequestParam(required = false) Long categoryId,
                                                   @RequestParam(defaultValue = "relevance") String sort,
                                                   @RequestParam(defaultValue = "1") @Min(1) int page,
                                                   @RequestParam(defaultValue = "20") @Min(1) @Max(100) int pageSize,
                                                   @AuthenticationPrincipal CurrentUser current) {
        long startedAt = System.nanoTime();
        PageResult<Map<String, Object>> data = service.discover(q, null, categoryId, sort, page, pageSize, current, duration, dateRange);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", data.items());
        result.put("total", data.total());
        result.put("page", data.page());
        result.put("pageSize", data.pageSize());
        result.put("hasMore", data.hasMore());
        result.put("suggestions", SEARCH_SUGGESTIONS);
        /*
         * 这里返回的是**真实**耗时。此前硬编码为 1，而前端搜索页会把它显示成
         * 「耗时 1ms」，等于向用户展示一个假指标。至少取 1，避免显示 0ms 造成误解。
         */
        result.put("costMs", Math.max(1L, (System.nanoTime() - startedAt) / 1_000_000L));
        return ApiResponse.ok(result);
    }

    @PutMapping("/{id}")
    public ApiResponse<Map<String, Object>> edit(@PathVariable long id,
                                                 @AuthenticationPrincipal CurrentUser current,
                                                 @Valid @RequestBody VideoDtos.EditRequest request) {
        return ApiResponse.ok(service.edit(id, current, request));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Map<String, Object>> delete(@PathVariable long id, @AuthenticationPrincipal CurrentUser current) {
        service.delete(id, current);
        return ApiResponse.ok(Map.of("success", true, "recoverableUntil", Instant.now().plus(Duration.ofDays(30))));
    }

    private ResponseEntity<StreamingResponseBody> stream(FileAsset file, Video video, long start, long end, long total,
                                                         boolean partial, boolean download) {
        long requested = end - start + 1;
        StorageGateway.StoredObject object = storage.open(file.getBucket(), file.getObjectKey(), start, requested);
        // 数据库里的 file_size 可能与对象实际长度不一致：声明多少就发多少，二者都取存储层给出的可用字节数。
        long available = object.length();
        if (available <= 0) {
            return ResponseEntity.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                    .header(HttpHeaders.CONTENT_RANGE, "bytes */" + total).build();
        }
        long responseEnd = start + available - 1;
        StreamingResponseBody body = output -> {
            try (InputStream input = object.stream()) {
                byte[] buffer = new byte[64 * 1024];
                long remaining = available;
                while (remaining > 0) {
                    int read = input.read(buffer, 0, (int)Math.min(buffer.length, remaining));
                    if (read < 0) break;
                    output.write(buffer, 0, read);
                    remaining -= read;
                }
            }
        };
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.ACCEPT_RANGES, "bytes");
        headers.setContentLength(available);
        headers.setContentType(MediaType.parseMediaType(file.getMimeType()));
        if (partial) headers.set(HttpHeaders.CONTENT_RANGE, "bytes " + start + "-" + responseEnd + "/" + total);
        if (download) {
            headers.setContentDisposition(ContentDisposition.attachment()
                    .filename(video.getTitle() + ".mp4", StandardCharsets.UTF_8).build());
        }
        return new ResponseEntity<>(body, headers, partial ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK);
    }

    /** HTTP Range 解析结果。 */
    private sealed interface RangeSpec {
        record Full(long total) implements RangeSpec { }

        record Partial(long start, long end, long total) implements RangeSpec { }

        record Unsatisfiable(long total) implements RangeSpec { }

        static RangeSpec parse(String header, long total) {
            if (header == null || header.isBlank()) return new Full(total);
            Matcher matcher = RANGE.matcher(header.trim());
            // 多区间、非 bytes 单位或语法不符：按 RFC 9110 忽略 Range 头返回完整内容，而不是 416。
            if (!matcher.matches()) return new Full(total);
            long start;
            long end;
            try {
                String rawStart = matcher.group(1);
                String rawEnd = matcher.group(2);
                if (rawStart.isBlank()) {
                    // 后缀区间 bytes=-N：请求最后 N 字节（部分播放器用它读取文件尾部的 moov）。
                    long suffix = Long.parseLong(rawEnd);
                    if (suffix <= 0 || total <= 0) return new Unsatisfiable(total);
                    start = Math.max(0, total - suffix);
                    end = total - 1;
                } else {
                    start = Long.parseLong(rawStart);
                    end = rawEnd == null || rawEnd.isBlank() ? total - 1 : Math.min(Long.parseLong(rawEnd), total - 1);
                }
            } catch (NumberFormatException ex) {
                return new Unsatisfiable(total);
            }
            if (total <= 0 || start > end || start >= total) return new Unsatisfiable(total);
            return new Partial(start, end, total);
        }
    }
}
