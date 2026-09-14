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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
@RequestMapping("/api/v1/videos")
public class VideoController {

    private static final Pattern RANGE = Pattern.compile("bytes=(\\d+)-(\\d*)");

    private final VideoService service;
    private final FileAssetRepository files;
    private final StorageGateway storage;

    public VideoController(VideoService service, FileAssetRepository files, StorageGateway storage) {
        this.service = service;
        this.files = files;
        this.storage = storage;
    }

    @GetMapping("/{id}")
    public ApiResponse<Map<String, Object>> detail(@PathVariable long id, @AuthenticationPrincipal CurrentUser current) {
        return ApiResponse.ok(service.detail(id, current));
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
        PageResult<Map<String, Object>> data = service.discover(q, null, categoryId, sort, page, pageSize, current, duration, dateRange);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", data.items());
        result.put("total", data.total());
        result.put("page", data.page());
        result.put("pageSize", data.pageSize());
        result.put("hasMore", data.hasMore());
        result.put("suggestions", List.of("架构设计", "性能优化", "旅行", "美食"));
        result.put("costMs", 1);
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
        long length = end - start + 1;
        StorageGateway.StoredObject object = storage.open(file.getBucket(), file.getObjectKey(), start, length);
        StreamingResponseBody body = output -> {
            try (InputStream input = object.stream()) {
                input.transferTo(output);
            }
        };
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.ACCEPT_RANGES, "bytes");
        headers.setContentLength(length);
        headers.setContentType(MediaType.parseMediaType(file.getMimeType()));
        if (partial) headers.set(HttpHeaders.CONTENT_RANGE, "bytes " + start + "-" + end + "/" + total);
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
            if (!matcher.matches()) return new Unsatisfiable(total);
            long start;
            try {
                start = Long.parseLong(matcher.group(1));
            } catch (NumberFormatException ex) {
                return new Unsatisfiable(total);
            }
            String rawEnd = matcher.group(2);
            long end = total - 1;
            if (rawEnd != null && !rawEnd.isBlank()) {
                try {
                    end = Math.min(Long.parseLong(rawEnd), total - 1);
                } catch (NumberFormatException ex) {
                    return new Unsatisfiable(total);
                }
            }
            if (start > end || start >= total) return new Unsatisfiable(total);
            return new Partial(start, end, total);
        }
    }
}
