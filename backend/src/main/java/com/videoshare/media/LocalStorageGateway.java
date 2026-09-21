package com.videoshare.media;

import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * 本地文件系统存储实现（{@code app.storage.mode=local}，缺省即启用）。
 *
 * <p>对象直接落在 {@code app.storage.local-root} 下；上传分片先写入 {@code uploads/&lt;id&gt;/}，
 * 合并校验通过后落到 {@code media/source/&lt;sha256&gt;.bin}，再清理分片目录。</p>
 */
@Component
@ConditionalOnProperty(name = "app.storage.mode", havingValue = "local", matchIfMissing = true)
public class LocalStorageGateway implements StorageGateway {

    private static final Logger log = LoggerFactory.getLogger(LocalStorageGateway.class);

    /** 分片签名有效期：2 小时，足够慢速网络完成一次断点续传。 */
    private static final long PART_URL_TTL_SECONDS = 7_200L;

    /** 单个分片上限：与 {@code UploadService.PART_SIZE}（8MB）留出余量。 */
    private static final long MAX_PART_BYTES = 10L * 1024 * 1024;

    private final Path root;
    private final String publicBase;
    private final byte[] signingKey;

    public LocalStorageGateway(StorageProperties properties) {
        this.root = Path.of(Objects.requireNonNullElse(properties.localRoot(), "./data"))
                .toAbsolutePath()
                .normalize();
        this.publicBase = Objects.requireNonNullElse(properties.publicBaseUrl(), "").trim().replaceAll("/$", "");
        this.signingKey = resolveSigningKey(properties.signingSecret());
    }

    /**
     * 解析分片签名密钥。
     *
     * <p>未配置时回退为进程内随机密钥（本地开发无需配置即可启动），但**显式告警**：
     * 随机密钥在重启后失效，多实例之间也无法互验，属于只在开发环境可接受的降级。</p>
     */
    private static byte[] resolveSigningKey(String configured) {
        if (configured != null && !configured.isBlank()) {
            return configured.getBytes(StandardCharsets.UTF_8);
        }
        log.warn("未配置 app.storage.signing-secret，已回退为进程内随机密钥："
                + "重启后未完成的分片上传地址将全部失效，多实例部署也无法互验。生产环境请显式配置。");
        return UUID.randomUUID().toString().getBytes(StandardCharsets.UTF_8);
    }

    @Override
    public String partUrl(String id, int part) {
        long expires = Instant.now().plusSeconds(PART_URL_TTL_SECONDS).getEpochSecond();
        String prefix = publicBase.isBlank() ? "" : publicBase;
        return prefix + "/api/v1/uploads/" + id + "/parts/" + part
                + "?expires=" + expires + "&signature=" + sign(id, part, expires);
    }

    @Override
    public void authorizePart(String id, int part, long expires, String signature) {
        boolean expired = expires < Instant.now().getEpochSecond();
        boolean signatureMatches = signature != null && MessageDigest.isEqual(
                sign(id, part, expires).getBytes(StandardCharsets.US_ASCII),
                signature.getBytes(StandardCharsets.US_ASCII));
        if (expired || !signatureMatches) {
            throw new ApiException(ErrorCode.FORBIDDEN, "上传地址无效或已过期");
        }
    }

    @Override
    public void putLocalPart(String id, int part, InputStream input, long size) {
        if (size > MAX_PART_BYTES) throw new ApiException(ErrorCode.VALIDATION, "分片过大");
        Path path = safe("uploads/" + id + "/part-" + part);
        try {
            Files.createDirectories(path.getParent());
            Files.copy(input, path, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.INTERNAL, "分片写入失败");
        }
    }

    @Override
    public String complete(String id, String sha, List<Integer> parts, long expectedSize, String fileName) {
        Path target = safe("media/source/" + sha + ".bin");
        try {
            Files.createDirectories(target.getParent());
            try (OutputStream out = Files.newOutputStream(target,
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING)) {
                for (Integer part : parts) {
                    Path source = safe("uploads/" + id + "/part-" + part);
                    if (!Files.exists(source)) {
                        throw new ApiException(ErrorCode.VALIDATION, "缺少分片 " + part);
                    }
                    Files.copy(source, out);
                }
            }
            // 先比大小再比摘要：大小不符时不必白算一遍 SHA-256。
            if (Files.size(target) != expectedSize) {
                Files.deleteIfExists(target);
                throw new ApiException(ErrorCode.VALIDATION, "合并后的文件大小不一致");
            }
            String actual = hash(target);
            if (!actual.equalsIgnoreCase(sha)) {
                Files.deleteIfExists(target);
                throw new ApiException(ErrorCode.VALIDATION, "文件 SHA-256 校验失败");
            }
            // 摘要通过只说明「字节没坏」，还要确认它确实是一个可播放的视频文件。
            try (InputStream input = Files.newInputStream(target)) {
                StorageGateway.validateVideoHeader(input.readNBytes(32), fileName);
                StorageGateway.validateVideoFile(target, fileName);
            } catch (ApiException ex) {
                Files.deleteIfExists(target);
                throw ex;
            }
            abort(id);
            return root.relativize(target).toString().replace('\\', '/');
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.INTERNAL, "文件合并失败");
        }
    }

    @Override
    public StorageGateway.StoredObject open(String bucket, String objectKey, long offset, long length) {
        Path path = safe(objectKey);
        try {
            long size = Files.size(path);
            if (offset < 0 || offset > size) throw new ApiException(ErrorCode.NOT_FOUND, "视频文件不存在");
            long available = Math.min(length, size - offset);
            InputStream input = Files.newInputStream(path);
            // 用 skip 定位到 Range 起点；skip 可能少于请求量，因此循环补齐。
            long skipped = 0;
            while (skipped < offset) {
                long n = input.skip(offset - skipped);
                if (n <= 0) {
                    input.close();
                    throw new ApiException(ErrorCode.INTERNAL, "视频文件读取失败");
                }
                skipped += n;
            }
            return new StorageGateway.StoredObject(input, available, contentType(path));
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.NOT_FOUND, "视频文件不存在");
        }
    }

    @Override
    public void abort(String id) {
        Path dir = safe("uploads/" + id);
        if (!Files.exists(dir)) return;
        try (var walk = Files.walk(dir)) {
            walk.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // 清理是尽力而为：残留的分片目录不影响正确性。
                }
            });
        } catch (IOException ignored) {
            // 同上
        }
    }

    @Override
    public String bucket() {
        return "local";
    }

    @Override
    public void putObject(String objectKey, InputStream input, long size, String contentType) {
        Path path = safe(objectKey);
        try {
            Files.createDirectories(path.getParent());
            long written = Files.copy(input, path, StandardCopyOption.REPLACE_EXISTING);
            if (written != size) {
                Files.deleteIfExists(path);
                throw new ApiException(ErrorCode.VALIDATION, "文件大小与声明不一致");
            }
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.INTERNAL, "文件写入失败");
        }
    }

    @Override
    public String publicUrl(String objectKey) {
        return "/api/v1/media/" + objectKey;
    }

    @Override
    public void deleteObject(String objectKey) {
        try {
            Files.deleteIfExists(safe(objectKey));
        } catch (IOException ignored) {
            // 删除失败无需向上传递
        }
    }

    @Override
    public boolean manages(String objectKey) {
        return objectKey != null && objectKey.startsWith("media/");
    }

    /** 把相对 key 解析到存储根目录下，并挡住路径穿越。 */
    private Path safe(String relative) {
        Path path = root.resolve(relative).normalize();
        if (!path.startsWith(root)) throw new ApiException(ErrorCode.FORBIDDEN, "非法存储路径");
        return path;
    }

    /**
     * Files.probeContentType 依赖系统注册表，对 .webp 常返回 null 或 octet-stream，
     * 会让浏览器拒收封面。这里按扩展名显式给出类型，未知扩展名才回退。
     */
    private String contentType(Path path) {
        String name = path.getFileName().toString().toLowerCase(Locale.ROOT);
        int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot + 1);
        return switch (ext) {
            case "png" -> "image/png";
            case "jpg", "jpeg" -> "image/jpeg";
            case "gif" -> "image/gif";
            case "webp" -> "image/webp";
            case "vtt" -> "text/vtt";
            case "srt" -> "application/x-subrip";
            case "mp4", "m4v" -> "video/mp4";
            case "webm" -> "video/webm";
            case "mov" -> "video/quicktime";
            default -> {
                String probed = null;
                try {
                    probed = Files.probeContentType(path);
                } catch (IOException ignored) {
                    // 探测失败按未知类型处理
                }
                yield probed == null ? "application/octet-stream" : probed;
            }
        };
    }

    private String hash(Path path) throws IOException {
        try (InputStream in = Files.newInputStream(path)) {
            try {
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                byte[] buffer = new byte[8192];
                for (int n; (n = in.read(buffer)) > 0; ) digest.update(buffer, 0, n);
                return HexFormat.of().formatHex(digest.digest());
            } catch (NoSuchAlgorithmException ex) {
                throw new IllegalStateException(ex);
            }
        }
    }

    /** 分片签名：HMAC-SHA256 over {@code id:part:expires}。 */
    private String sign(String id, int part, long expires) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(signingKey, "HmacSHA256"));
            return HexFormat.of().formatHex(
                    mac.doFinal((id + ":" + part + ":" + expires).getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
