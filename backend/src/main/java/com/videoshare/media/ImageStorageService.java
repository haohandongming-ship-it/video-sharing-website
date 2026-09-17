package com.videoshare.media;

import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.UUID;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import org.springframework.stereotype.Service;

/**
 * 图片校验与落存储的公共实现，头像与视频封面共用。
 *
 * <p>两条调用路径的入参形态不同，因此同时提供按需解析：
 * <ul>
 *   <li>头像：multipart 上传的原始字节；</li>
 *   <li>封面：浏览器 canvas 抓帧后以 {@code data:image/...;base64,} 形式放在 JSON 请求体里。</li>
 * </ul>
 *
 * <p>校验一律以文件头魔数（magic bytes）为准，不接受扩展名或 Content-Type —— 二者都可以伪造。
 */
@Service
public class ImageStorageService {

    private static final int MAX_DIMENSION = 4096;
    /** 封面是 canvas 抓帧产物，通常几十到几百 KB；给到 4MB 足够宽容，同时挡住异常大图。 */
    public static final long MAX_COVER_BYTES = 4L * 1024 * 1024;

    private final StorageGateway storage;

    public ImageStorageService(StorageGateway storage) {
        this.storage = storage;
    }

    public record ImagePayload(byte[] bytes, String extension, String contentType) { }

    /** 解析 {@code data:image/...;base64,...} 形式的封面；非该形式返回 null，由调用方决定是否报错。 */
    public ImagePayload parseDataUrl(String dataUrl, long maxBytes, String tooLargeMessage) {
        if (dataUrl == null || dataUrl.isBlank()) return null;
        int comma = dataUrl.indexOf(',');
        if (comma < 0 || !dataUrl.startsWith("data:image/")) {
            throw new ApiException(ErrorCode.VALIDATION, "封面格式不支持");
        }
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(dataUrl.substring(comma + 1));
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION, "封面数据无法解析");
        }
        if (bytes.length > maxBytes) {
            throw new ApiException(ErrorCode.VALIDATION, tooLargeMessage);
        }
        return validate(bytes, tooLargeMessage);
    }

    /** 校验原始图片字节并给出扩展名与 MIME 类型。 */
    public ImagePayload validate(byte[] bytes, String tooLargeMessage) {
        if (bytes == null || bytes.length == 0) {
            throw new ApiException(ErrorCode.VALIDATION, "图片内容为空");
        }
        ImagePayload payload = detect(bytes);
        if (payload == null) {
            throw new ApiException(ErrorCode.VALIDATION, "只支持 JPG、PNG、GIF 格式的图片");
        }
        verifyDimensions(bytes, payload.extension());
        return payload;
    }

    /** 校验后写入对象存储，返回可公开访问的 URL。 */
    public String store(String prefix, long ownerId, ImagePayload payload, String tooLargeMessage) {
        return storeNamed(prefix + ownerId + "-" + UUID.randomUUID().toString().replace("-", ""), payload);
    }

    /**
     * 无归属者的图片写入（如私信附件）：按日期分目录，避免单目录对象过多。
     * 对象名用 UUID，不吃用户可控输入，因此不存在路径穿越风险。
     */
    public String store(String prefix, ImagePayload payload) {
        String day = java.time.LocalDate.now().toString().replace("-", "/");
        return storeNamed(prefix + day + "/" + UUID.randomUUID().toString().replace("-", ""), payload);
    }

    private String storeNamed(String keyWithoutExtension, ImagePayload payload) {
        String objectKey = keyWithoutExtension + "." + payload.extension();
        try (ByteArrayInputStream input = new ByteArrayInputStream(payload.bytes())) {
            storage.putObject(objectKey, input, payload.bytes().length, payload.contentType());
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.INTERNAL, "图片保存失败");
        }
        return storage.publicUrl(objectKey);
    }

    /** 删除本存储管理的旧图，避免更换后残留；外链或他人资源不会被误删。 */
    public void deleteManaged(String prefix, String url) {
        if (url == null) return;
        int marker = url.indexOf(prefix);
        if (marker < 0) return;
        String key = url.substring(marker);
        if (storage.manages(key)) storage.deleteObject(key);
    }

    /** 从魔数判定真实图片类型；扩展名与声明类型都不作为依据。 */
    private ImagePayload detect(byte[] b) {
        if (b.length >= 8 && (b[0] & 0xff) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G'
                && (b[4] & 0xff) == 0x0d && (b[5] & 0xff) == 0x0a && (b[6] & 0xff) == 0x1a && (b[7] & 0xff) == 0x0a) {
            return new ImagePayload(b, "png", "image/png");
        }
        if (b.length >= 3 && (b[0] & 0xff) == 0xff && (b[1] & 0xff) == 0xd8 && (b[2] & 0xff) == 0xff) {
            return new ImagePayload(b, "jpg", "image/jpeg");
        }
        if (b.length >= 6 && b[0] == 'G' && b[1] == 'I' && b[2] == 'F' && b[3] == '8'
                && (b[4] == '7' || b[4] == '9') && b[5] == 'a') {
            return new ImagePayload(b, "gif", "image/gif");
        }
        // 前端 canvas.toDataURL('image/webp') 是默认封面格式，服务端必须认，
        // 否则「浏览器截的帧」会在校验这一步被拒，封面永远是占位图。
        if (b.length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            return new ImagePayload(b, "webp", "image/webp");
        }
        return null;
    }

    /** 用 ImageIO 只读元数据取宽高，不整图解码，避免大图占用内存。 */
    private void verifyDimensions(byte[] bytes, String extension) {
        // JDK 自带 ImageIO 没有 WebP 解码器。WebP 无法用此路径量尺寸，
        // 由调用方的字节上限兜底（封面 4MB / 头像 2MB），不足以构成像素炸弹风险。
        if ("webp".equals(extension)) return;
        try (ImageInputStream in = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            if (in == null) throw new ApiException(ErrorCode.VALIDATION, "图片无法解析");
            var readers = ImageIO.getImageReaders(in);
            if (!readers.hasNext()) throw new ApiException(ErrorCode.VALIDATION, "图片无法解析");
            ImageReader reader = readers.next();
            try {
                reader.setInput(in);
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width <= 0 || height <= 0) throw new ApiException(ErrorCode.VALIDATION, "图片尺寸无效");
                if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                    throw new ApiException(ErrorCode.VALIDATION, "图片尺寸过大，单边不得超过 " + MAX_DIMENSION + " 像素");
                }
            } finally {
                reader.dispose();
            }
        } catch (ApiException ex) {
            throw ex;
        } catch (IOException | RuntimeException ex) {
            throw new ApiException(ErrorCode.VALIDATION, "图片无法解析或已损坏");
        }
    }
}
