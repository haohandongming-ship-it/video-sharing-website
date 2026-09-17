package com.videoshare.video;

import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.Set;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.HandlerMapping;
import jakarta.servlet.http.HttpServletRequest;
import java.util.concurrent.TimeUnit;

/**
 * 演示 HLS 输出。
 *
 * <p>项目自带一套真实的多码率演示流（360p/540p/720p，build 产物见
 * {@code frontend/scripts/make-demo-hls.sh}），但它一直只放在前端 public 目录里，
 * 后端读不到；而所有视频的 {@code hls_url} 又被指向单一 {@code /source}，
 * 于是播放器的清晰度菜单永远没有档位可切。
 *
 * <p>这里把同一套素材作为后端资源输出，使清晰度切换在演示视频上真实可用。
 * 只放行 .m3u8 / .m4s / .mp4 三种扩展名，并校验路径，避免退化成任意资源读取。
 */
@RestController
@RequestMapping("/api/v1/demo/hls")
public class DemoSegmentController {

    private static final String ROOT = "demo/hls/";
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of("m3u8", "m4s", "mp4");

    @GetMapping("/**")
    public ResponseEntity<InputStreamResource> read(HttpServletRequest request) {
        String path = (String) request.getAttribute(HandlerMapping.PATH_WITHIN_HANDLER_MAPPING_ATTRIBUTE);
        String name = path == null ? "" : path.replaceFirst("^/api/v1/demo/hls/", "");
        if (name.isBlank() || name.contains("..") || name.contains("/")) {
            throw new ApiException(ErrorCode.NOT_FOUND, "资源不存在");
        }
        String extension = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
        if (!ALLOWED_EXTENSIONS.contains(extension)) {
            throw new ApiException(ErrorCode.NOT_FOUND, "资源不存在");
        }
        InputStream stream = getClass().getClassLoader().getResourceAsStream(ROOT + name);
        if (stream == null) throw new ApiException(ErrorCode.NOT_FOUND, "资源不存在");
        try {
            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(contentType(extension)))
                    .contentLength(stream.available())
                    // 演示素材随构建固定，可长缓存
                    .cacheControl(CacheControl.maxAge(365, TimeUnit.DAYS).cachePublic())
                    .body(new InputStreamResource(stream));
        } catch (IOException ex) {
            try {
                stream.close();
            } catch (IOException ignored) {
                // 关闭失败无需向上传递
            }
            throw new ApiException(ErrorCode.INTERNAL, "资源读取失败");
        }
    }

    private static String contentType(String extension) {
        return switch (extension) {
            case "m3u8" -> "application/vnd.apple.mpegurl";
            case "m4s" -> "video/iso.segment";
            default -> "video/mp4";
        };
    }
}
