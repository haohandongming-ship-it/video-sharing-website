package com.videoshare.feed;

import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import com.videoshare.media.ImageStorageService;
import com.videoshare.media.StorageGateway;
import java.io.IOException;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * 私信附件上传：图片或视频本体落对象存储，消息里只保存一条 URL。
 *
 * <p>此前前端用 {@code window.prompt} 让用户「粘贴图片/视频地址」，无法使用本地文件；
 * 这里补上真正的上传通道。校验以文件头魔数为准，不信任扩展名和 Content-Type。
 */
@Service
public class MessageAttachmentService {

    private static final long MAX_IMAGE_BYTES = 5L * 1024 * 1024;
    private static final long MAX_VIDEO_BYTES = 50L * 1024 * 1024;
    private static final String PREFIX = "media/message/";

    private final ImageStorageService images;
    private final StorageGateway storage;

    public MessageAttachmentService(ImageStorageService images, StorageGateway storage) {
        this.images = images;
        this.storage = storage;
    }

    public Map<String, Object> upload(MultipartFile file) {
        if (file == null || file.isEmpty()) throw new ApiException(ErrorCode.VALIDATION, "请选择要发送的文件");
        long size = file.getSize();
        byte[] head = readHead(file);
        if (isVideo(head)) {
            if (size > MAX_VIDEO_BYTES) throw new ApiException(ErrorCode.VALIDATION, "视频不能超过 50MB");
            return storeVideo(file);
        }
        if (size > MAX_IMAGE_BYTES) throw new ApiException(ErrorCode.VALIDATION, "图片不能超过 5MB");
        var payload = images.validate(readAll(file), "图片不能超过 5MB");
        return result("IMAGE", images.store(PREFIX, payload));
    }

    /**
     * 视频直接流式写入对象存储，不整体读进内存：
     * 50MB 的附件若走 getBytes()，每个并发请求都会占用同等堆内存。
     */
    private Map<String, Object> storeVideo(MultipartFile file) {
        String objectKey = PREFIX + UUID.randomUUID().toString().replace("-", "") + ".mp4";
        try (InputStream in = file.getInputStream()) {
            storage.putObject(objectKey, in, file.getSize(), "video/mp4");
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.INTERNAL, "附件保存失败");
        }
        return result("VIDEO", storage.publicUrl(objectKey));
    }

    /** 只读文件头做魔数判定，避免为判断类型而整体载入大文件。 */
    private byte[] readHead(MultipartFile file) {
        try (InputStream in = file.getInputStream()) {
            return in.readNBytes(32);
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.VALIDATION, "文件读取失败，请重试");
        }
    }

    private byte[] readAll(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.VALIDATION, "文件读取失败，请重试");
        }
    }

    /** ISO-BMFF（mp4/mov）或 WebM/Matroska。 */
    private boolean isVideo(byte[] head) {
        boolean isoBmff = head.length >= 8 && head[4] == 'f' && head[5] == 't' && head[6] == 'y' && head[7] == 'p';
        boolean ebml = head.length >= 4 && (head[0] & 0xff) == 0x1a && (head[1] & 0xff) == 0x45
                && (head[2] & 0xff) == 0xdf && (head[3] & 0xff) == 0xa3;
        return isoBmff || ebml;
    }

    private Map<String, Object> result(String type, String url) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", type);
        m.put("url", url);
        return m;
    }
}
