package com.videoshare.video;

import com.videoshare.auth.CurrentUser;
import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import com.videoshare.media.ImageStorageService;
import java.io.IOException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 视频封面的补传与更换。
 *
 * <p>上传流程本身已经会用浏览器抓取的帧写封面（见 UploadService）；这里提供的是
 * 事后更换入口：既服务于「早期版本上传时封面未被保存」的历史视频补图，
 * 也让作者能自行替换封面。
 */
@Service
public class VideoCoverService {

    private static final long MAX_BYTES = ImageStorageService.MAX_COVER_BYTES;
    private static final String TOO_LARGE = "封面图片过大，请选择 4MB 以内的图片";
    private static final String PREFIX = "media/cover/";

    private final ImageStorageService images;
    private final VideoRepository videos;

    public VideoCoverService(ImageStorageService images, VideoRepository videos) {
        this.images = images;
        this.videos = videos;
    }

    @Transactional
    public String update(long videoId, CurrentUser current, MultipartFile file) {
        Video video = videos.findById(videoId).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "视频不存在"));
        boolean privileged = current != null
                && (current.id() == video.getUserId()
                    || current.role() == com.videoshare.user.Role.ADMIN
                    || current.role() == com.videoshare.user.Role.MODERATOR);
        if (!privileged) throw new ApiException(ErrorCode.FORBIDDEN, "不能修改他人视频的封面");
        if (video.getStatus() == VideoStatus.DELETED) throw new ApiException(ErrorCode.NOT_FOUND, "视频不存在");

        if (file == null || file.isEmpty()) throw new ApiException(ErrorCode.VALIDATION, "请选择封面图片");
        if (file.getSize() > MAX_BYTES) throw new ApiException(ErrorCode.VALIDATION, TOO_LARGE);
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.VALIDATION, "封面读取失败，请重试");
        }
        var payload = images.validate(bytes, TOO_LARGE);
        String url = images.store(PREFIX, video.getUserId(), payload, TOO_LARGE);

        String previous = video.getCoverUrl();
        video.changeCover(url);
        videos.save(video);
        if (previous == null || !previous.equals(url)) images.deleteManaged(PREFIX, previous);
        return url;
    }
}
