package com.videoshare.media;

import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.Set;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
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
 * 本地存储模式下对外提供小对象（如头像）的读取入口。
 *
 * <p>MinIO 模式下 {@link StorageGateway#publicUrl} 直接给出对象存储地址，不经过这里；
 * 本地模式没有对象存储，只能由后端同源输出。只允许图片扩展名，避免这个端点变成
 * 任意文件读取（视频等大文件仍走 {@code /api/v1/videos/*&#47;source} 的 Range 通道）。
 */
@RestController
@RequestMapping("/api/v1/media")
@ConditionalOnProperty(name = "app.storage.mode", havingValue = "local", matchIfMissing = true)
public class MediaController {

    /**
     * 允许的扩展名：图片，以及字幕文本（vtt/srt）。
     * 字幕是纯文本、体积很小，放在这里可以复用同源读取，不必为一个表再开一条通道。
     */
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of("jpg", "jpeg", "png", "gif", "webp", "vtt", "srt");

    private final StorageGateway storage;

    public MediaController(StorageGateway storage) {
        this.storage = storage;
    }

    @GetMapping("/**")
    public ResponseEntity<InputStreamResource> read(HttpServletRequest request) {
        String path = (String) request.getAttribute(HandlerMapping.PATH_WITHIN_HANDLER_MAPPING_ATTRIBUTE);
        String key = path == null ? "" : path.replaceFirst("^/api/v1/media/", "");
        if (key.isBlank() || key.contains("..")) {
            throw new ApiException(ErrorCode.NOT_FOUND, "文件不存在");
        }
        String extension = key.contains(".") ? key.substring(key.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
        if (!ALLOWED_EXTENSIONS.contains(extension)) {
            throw new ApiException(ErrorCode.NOT_FOUND, "文件不存在");
        }
        StorageGateway.StoredObject object = storage.open(storage.bucket(), key, 0L, Long.MAX_VALUE);
        try {
            InputStream stream = object.stream();
            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(object.contentType()))
                    .contentLength(object.length())
                    // 头像按 userId + UUID 命名，内容不会原地变化，可以长缓存
                    .cacheControl(CacheControl.maxAge(365, TimeUnit.DAYS).cachePublic())
                    .body(new InputStreamResource(stream));
        } catch (RuntimeException ex) {
            closeQuietly(object);
            throw ex;
        }
    }

    private void closeQuietly(StorageGateway.StoredObject object) {
        try {
            object.stream().close();
        } catch (IOException ignored) {
            // 关闭失败无需向上传递
        }
    }
}
