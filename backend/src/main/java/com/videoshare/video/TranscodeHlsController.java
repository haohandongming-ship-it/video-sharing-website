package com.videoshare.video;

import com.videoshare.auth.CurrentUser;
import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.concurrent.TimeUnit;

/**
 * 输出由 {@code scripts/transcode-hls.ps1} 用 ffmpeg 转出的多码率 HLS。
 *
 * <p>放在磁盘目录而不是对象存储：转码是开发期的离线步骤，产物属于派生物，重启或重建对象
 * 都不应影响它；目录可通过 {@code app.hls.root} 配置。
 *
 * <p>只放行 .m3u8 / .m4s / .mp4 / .ts，并校验解析后的路径仍位于视频自己的目录内，
 * 避免退化成任意文件读取。
 */
@RestController
@RequestMapping("/api/v1/videos")
public class TranscodeHlsController {

    private static final Set<String> ALLOWED_EXTENSIONS = Set.of("m3u8", "m4s", "mp4", "ts");

    private final VideoService videos;
    private final Path root;

    public TranscodeHlsController(VideoService videos, @Value("${app.hls.root:./data/hls}") String root) {
        this.videos = videos;
        this.root = Path.of(root).toAbsolutePath().normalize();
    }

    @GetMapping("/{id}/hls/**")
    public ResponseEntity<InputStreamResource> read(@PathVariable long id,
                                                    @AuthenticationPrincipal CurrentUser current,
                                                    jakarta.servlet.http.HttpServletRequest request) throws IOException {
        videos.playable(id, current);
        String path = (String) request.getAttribute(
                org.springframework.web.servlet.HandlerMapping.PATH_WITHIN_HANDLER_MAPPING_ATTRIBUTE);
        String prefix = "/api/v1/videos/" + id + "/hls/";
        String relative = path != null && path.startsWith(prefix) ? path.substring(prefix.length()) : "";
        if (relative.isBlank()) throw new ApiException(ErrorCode.NOT_FOUND, "资源不存在");

        String extension = relative.contains(".")
                ? relative.substring(relative.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT)
                : "";
        if (!ALLOWED_EXTENSIONS.contains(extension)) throw new ApiException(ErrorCode.NOT_FOUND, "资源不存在");

        Path base = root.resolve(String.valueOf(id)).normalize();
        Path file = base.resolve(relative).normalize();
        // 关键校验：解析后的路径必须仍在 <root>/<id>/ 之内
        if (!file.startsWith(base) || !Files.isRegularFile(file)) {
            throw new ApiException(ErrorCode.NOT_FOUND, "资源不存在");
        }

        long length = Files.size(file);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(contentType(extension)))
                .contentLength(length)
                .cacheControl(CacheControl.maxAge(7, TimeUnit.DAYS).cachePublic())
                .body(new InputStreamResource(Files.newInputStream(file)));
    }

    /** 该视频是否已转码（前端据此决定是否显示多档清晰度）。 */
    public boolean transcoded(long id) {
        return Files.isRegularFile(root.resolve(String.valueOf(id)).resolve("master.m3u8"));
    }

    private static String contentType(String extension) {
        return switch (extension) {
            case "m3u8" -> "application/vnd.apple.mpegurl";
            case "m4s" -> "video/iso.segment";
            case "ts" -> "video/mp2t";
            default -> "video/mp4";
        };
    }

    /** 供视频视图装配时查询转码状态。 */
    public static InputStream openQuietly(Path file) {
        try {
            return Files.newInputStream(file);
        } catch (IOException ex) {
            return null;
        }
    }
}
