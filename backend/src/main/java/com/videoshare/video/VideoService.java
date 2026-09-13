package com.videoshare.video;

import com.videoshare.auth.CurrentUser; import com.videoshare.common.*; import com.videoshare.user.UserRepository;
import java.util.*; import org.springframework.data.domain.*; import org.springframework.stereotype.Service; import org.springframework.transaction.annotation.Transactional;

@Service
public class VideoService {
    private final VideoRepository videos; private final UserRepository users;
    public VideoService(VideoRepository videos,UserRepository users){this.videos=videos;this.users=users;}
    @Transactional(readOnly=true) public VideoDtos.Detail detail(long id) { Video video=publicVideo(id); return toDetail(video); }
    @Transactional(readOnly=true) public VideoDtos.PageData<VideoDtos.Detail> discover(String query,int page,int size) { Pageable paging=PageRequest.of(page-1,size,Sort.by(Sort.Direction.DESC,"publishedAt")); Page<Video> result=(query==null||query.isBlank())?videos.findByStatusAndVisibilityOrderByPublishedAtDesc(VideoStatus.PUBLISHED,Visibility.PUBLIC,paging):videos.findByStatusAndVisibilityAndTitleContainingIgnoreCaseOrderByPublishedAtDesc(VideoStatus.PUBLISHED,Visibility.PUBLIC,query.trim(),paging); return new VideoDtos.PageData<>(result.map(this::toDetail).getContent(),result.getTotalElements(),page,size); }
    @Transactional public VideoDtos.Detail edit(long id,CurrentUser current,VideoDtos.EditRequest request) { Video video=videos.findById(id).orElseThrow(()->new ApiException(ErrorCode.NOT_FOUND,"视频不存在")); owner(video,current); video.edit(request.title(),request.description(),request.categoryId(),request.visibility(),request.downloadEnabled()); return toDetail(video); }
    @Transactional public void delete(long id,CurrentUser current) { Video video=videos.findById(id).orElseThrow(()->new ApiException(ErrorCode.NOT_FOUND,"视频不存在")); owner(video,current); video.delete(); }
    private Video publicVideo(long id) { Video v=videos.findById(id).orElseThrow(()->new ApiException(ErrorCode.NOT_FOUND,"视频不存在")); if(v.getStatus()!=VideoStatus.PUBLISHED || v.getVisibility()!=Visibility.PUBLIC) throw new ApiException(ErrorCode.NOT_FOUND,"视频不存在"); return v; }
    private void owner(Video video,CurrentUser current) { if(current==null) throw new ApiException(ErrorCode.UNAUTHORIZED,"请先登录"); if(video.getUserId()!=current.id() && current.role()!=com.videoshare.user.Role.ADMIN) throw new ApiException(ErrorCode.FORBIDDEN,"不能操作其他用户的视频"); }
    private VideoDtos.Detail toDetail(Video v) { var user=users.findById(v.getUserId()).orElseThrow(()->new ApiException(ErrorCode.NOT_FOUND,"作者不存在")); return new VideoDtos.Detail(v.getId(),v.getVideoType(),v.getTitle(),v.getDescription(),v.getCoverUrl(),v.getDuration(),v.getCategoryId(),new VideoDtos.Author(user.getId(),user.getNickname()),new VideoDtos.Stats(v.getViewCount(),v.getLikeCount(),v.getCommentCount(),v.getFavoriteCount()),v.getStatus(),v.getPublishedAt(),v.isDownloadEnabled()); }
}
