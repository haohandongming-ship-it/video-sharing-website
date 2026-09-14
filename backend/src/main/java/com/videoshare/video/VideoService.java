package com.videoshare.video;

import com.videoshare.auth.CurrentUser;
import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import com.videoshare.common.PageResult;
import com.videoshare.common.ViewFactory;
import com.videoshare.user.Role;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 视频目录服务。
 *
 * <p>列表与详情统一走 {@link VideoCatalog} + {@link ViewFactory} 的批量渲染路径：
 * 过滤/排序/分页在 SQL 内完成，视图装配固定在常数次查询，不再把整表读进内存。</p>
 */
@Service
public class VideoService {
    private final VideoRepository videos;
    private final VideoCatalog catalog;
    private final VideoTags tags;
    private final ViewFactory views;

    public VideoService(VideoRepository videos, VideoCatalog catalog, VideoTags tags, ViewFactory views) {
        this.videos = videos;
        this.catalog = catalog;
        this.tags = tags;
        this.views = views;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> detail(long id, CurrentUser current) {
        return views.videoDetail(accessible(id, current), current == null ? null : current.id());
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> discover(String query, VideoType type, Long categoryId, String sort,
                                                    int page, int size, CurrentUser current) {
        return discover(query, type, categoryId, sort, page, size, current, null, null);
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> discover(String query, VideoType type, Long categoryId, String sort,
                                                    int page, int size, CurrentUser current, String duration, String dateRange) {
        Long viewer = current == null ? null : current.id();
        PageResult<Video> page1 = catalog.page(
                VideoCatalog.Filter.of(query, type, categoryId, duration, dateRange),
                VideoCatalog.sortOf(sort), page, size);
        return PageResult.of(views.videoSummaries(page1.items(), viewer), page1.total(), page1.page(), page1.pageSize());
    }

    @Transactional
    public Map<String, Object> edit(long id, CurrentUser current, VideoDtos.EditRequest request) {
        Video video = videos.findById(id).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "视频不存在"));
        owner(video, current);
        video.editPartial(request.title(), request.description(), request.categoryId(), request.visibility(), request.downloadEnabled());
        if (request.tags() != null) tags.replace(id, request.tags());
        return views.videoDetail(video, current.id());
    }

    @Transactional
    public void delete(long id, CurrentUser current) {
        Video video = videos.findById(id).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "视频不存在"));
        owner(video, current);
        video.delete();
    }

    /** 播放/下载入口：需要可播放权限才能取得源文件。 */
    public Video playable(long id, CurrentUser current) {
        return accessible(id, current);
    }

    private Video accessible(long id, CurrentUser current) {
        Video video = videos.findById(id).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "视频不存在"));
        boolean privileged = current != null
                && (current.id() == video.getUserId() || current.role() == Role.ADMIN || current.role() == Role.MODERATOR);
        if (video.getStatus() == VideoStatus.DELETED
                || (!privileged && (video.getStatus() != VideoStatus.PUBLISHED || video.getVisibility() == Visibility.PRIVATE))) {
            throw new ApiException(ErrorCode.NOT_FOUND, "视频不存在");
        }
        return video;
    }

    private void owner(Video video, CurrentUser current) {
        if (current == null) throw new ApiException(ErrorCode.UNAUTHORIZED, "请先登录");
        if (video.getUserId() != current.id() && current.role() != Role.ADMIN) {
            throw new ApiException(ErrorCode.FORBIDDEN, "不能操作其他用户的视频");
        }
    }
}
