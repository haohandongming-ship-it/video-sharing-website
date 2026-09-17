package com.videoshare.user;

import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import com.videoshare.media.ImageStorageService;
import java.io.IOException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 头像上传：图片本体落到对象存储（MinIO 或本地目录），数据库只保存一条短 URL。
 *
 * <p>这样做的原因：此前头像以 base64 Data URL 直接写进 {@code users.avatar_url}，
 * 列宽和数据量互相拖累——一张 20KB 的图编码后就是 27330 字符，超出列宽后报 50001
 * 「服务暂时不可用」，用户完全看不出原因。改成存 URL 后，图片大小不再受数据库列宽约束，
 * 2MB 上限只由这里的校验决定。
 *
 * <p>图片校验与落存储复用 {@link ImageStorageService}，与视频封面走同一套规则。
 */
@Service
public class AvatarService {

    /** 头像大小上限，与前端提示保持一致。 */
    static final long MAX_BYTES = 2L * 1024 * 1024;
    private static final String PREFIX = "media/avatar/";

    private final ImageStorageService images;
    private final UserRepository users;

    public AvatarService(ImageStorageService images, UserRepository users) {
        this.images = images;
        this.users = users;
    }

    @Transactional
    public String update(long userId, MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new ApiException(ErrorCode.VALIDATION, "请选择要上传的图片");
        }
        if (file.getSize() > MAX_BYTES) {
            throw new ApiException(ErrorCode.VALIDATION, "头像图片过大，请选择 2MB 以内的图片");
        }
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.VALIDATION, "图片读取失败，请重试");
        }
        var payload = images.validate(bytes, "头像图片过大，请选择 2MB 以内的图片");
        String url = images.store(PREFIX, userId, payload, "头像图片过大，请选择 2MB 以内的图片");

        User user = users.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "用户不存在"));
        String previous = user.getAvatarUrl();
        user.updateProfile(null, null, url);
        users.save(user);

        // 旧头像只有归本存储管理时才删除，避免误删外部地址或他人资源
        if (previous == null || !previous.equals(url)) {
            images.deleteManaged(PREFIX, previous);
        }
        return url;
    }
}
