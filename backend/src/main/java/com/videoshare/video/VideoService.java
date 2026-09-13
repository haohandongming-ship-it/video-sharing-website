package com.videoshare.video;

import com.videoshare.auth.CurrentUser; import com.videoshare.common.*;
import jakarta.persistence.criteria.Predicate;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class VideoService {
    private final VideoRepository videos; private final ViewFactory views; private final JdbcTemplate jdbc;
    public VideoService(VideoRepository videos,ViewFactory views,JdbcTemplate jdbc){this.videos=videos;this.views=views;this.jdbc=jdbc;}
    @Transactional(readOnly=true) public Map<String,Object> detail(long id,CurrentUser current) { Video video=accessible(id,current); return views.videoDetail(video,current==null?null:current.id()); }
    @Transactional(readOnly=true) public VideoDtos.PageData<Map<String,Object>> discover(String query,VideoType type,Long categoryId,String sort,int page,int size,CurrentUser current) { return discover(query,type,categoryId,sort,page,size,current,null,null); }
    @Transactional(readOnly=true)
    public VideoDtos.PageData<Map<String,Object>> discover(String query,VideoType type,Long categoryId,String sort,int page,int size,CurrentUser current,String duration,String dateRange) {
        Specification<Video> spec=(root,q,cb)->{
            List<Predicate> predicates=new ArrayList<>();
            predicates.add(cb.equal(root.get("status"),VideoStatus.PUBLISHED));
            predicates.add(cb.equal(root.get("visibility"),Visibility.PUBLIC));
            if(query!=null&&!query.isBlank()){
                String pattern="%"+query.trim().toLowerCase(Locale.ROOT)+"%";
                List<Long> tagged=jdbc.query("SELECT vt.video_id FROM video_tags vt JOIN tags t ON t.id=vt.tag_id WHERE LOWER(t.tag_name) LIKE ?",(rs,n)->rs.getLong(1),pattern);
                Predicate title=cb.like(cb.lower(root.get("title")),pattern);
                predicates.add(tagged.isEmpty()?title:cb.or(title,root.get("id").in(tagged)));
            }
            if("short".equals(duration)) predicates.add(cb.lessThan(root.get("duration"),300));
            else if("medium".equals(duration)) predicates.add(cb.between(root.get("duration"),300,1800));
            else if("long".equals(duration)) predicates.add(cb.greaterThan(root.get("duration"),1800));
            int days=switch(Objects.requireNonNullElse(dateRange,"all")){case "day"->1;case "week"->7;case "month"->30;default->0;};
            if(days>0) predicates.add(cb.greaterThanOrEqualTo(root.get("publishedAt"),Instant.now().minus(Duration.ofDays(days))));
            if(type!=null) predicates.add(cb.equal(root.get("videoType"),type));
            if(categoryId!=null) predicates.add(cb.equal(root.get("categoryId"),categoryId));
            return cb.and(predicates.toArray(Predicate[]::new));
        };
        List<Video> filtered=new ArrayList<>(videos.findAll(spec));
        String mode=Objects.requireNonNullElse(sort,"recommend");
        Comparator<Video> comparator=switch(mode){
            case "latest" -> Comparator.<Video,Instant>comparing(this::publishedOrCreated,Comparator.reverseOrder());
            case "views" -> Comparator.comparingLong(Video::getViewCount).reversed().thenComparing(this::publishedOrCreated,Comparator.reverseOrder());
            case "hot" -> Comparator.comparingDouble((Video v)->rankingScore(v,true)).reversed().thenComparing(this::publishedOrCreated,Comparator.reverseOrder());
            default -> Comparator.comparingDouble((Video v)->rankingScore(v,false)).reversed().thenComparing(this::publishedOrCreated,Comparator.reverseOrder());
        };
        filtered.sort(comparator);
        page=Math.max(1,page); size=Math.max(1,Math.min(size,100));
        int from=(int)Math.min((long)(page-1)*size,filtered.size());
        int to=Math.min(from+size,filtered.size());
        Long viewer=current==null?null:current.id();
        List<Map<String,Object>> items=filtered.subList(from,to).stream().map(v->views.videoSummary(v,viewer)).toList();
        return new VideoDtos.PageData<>(items,filtered.size(),page,size,to<filtered.size());
    }

    private Instant publishedOrCreated(Video video){return Objects.requireNonNullElse(video.getPublishedAt(),video.getCreatedAt());}
    private double rankingScore(Video video,boolean hot){
        double engagement=.35*Math.log1p(video.getViewCount())+.95*Math.log1p(video.getLikeCount())+1.25*Math.log1p(video.getCommentCount())+1.05*Math.log1p(video.getFavoriteCount());
        long ageHours=Math.max(0,Duration.between(publishedOrCreated(video),Instant.now()).toHours());
        double decay=Math.exp(-ageHours/(hot?72d:240d));
        return engagement*(hot?0.55+0.45*decay:0.35+0.65*decay);
    }
    @Transactional public Map<String,Object> edit(long id,CurrentUser current,VideoDtos.EditRequest request) { Video video=videos.findById(id).orElseThrow(()->new ApiException(ErrorCode.NOT_FOUND,"视频不存在")); owner(video,current); video.editPartial(request.title(),request.description(),request.categoryId(),request.visibility(),request.downloadEnabled());if(request.tags()!=null){jdbc.update("DELETE FROM video_tags WHERE video_id=?",id);for(String rawTag:request.tags().stream().filter(Objects::nonNull).map(String::trim).distinct().toList()){String tag=rawTag==null?"":rawTag.trim();if(tag.isBlank())continue;List<Long>tagIds=jdbc.query("SELECT id FROM tags WHERE tag_name=?",(rs,n)->rs.getLong(1),tag);Long tagId=tagIds.isEmpty()?insertTag(tag):tagIds.get(0);jdbc.update("INSERT INTO video_tags(video_id,tag_id) VALUES(?,?)",id,tagId);}} return views.videoDetail(video,current.id()); }
    @Transactional public void delete(long id,CurrentUser current) { Video video=videos.findById(id).orElseThrow(()->new ApiException(ErrorCode.NOT_FOUND,"视频不存在")); owner(video,current); video.delete(); }
    Video playable(long id,CurrentUser current) { return accessible(id,current); }
    private Video accessible(long id,CurrentUser current) { Video v=videos.findById(id).orElseThrow(()->new ApiException(ErrorCode.NOT_FOUND,"视频不存在"));boolean privileged=current!=null&&(current.id()==v.getUserId()||current.role()==com.videoshare.user.Role.ADMIN||current.role()==com.videoshare.user.Role.MODERATOR);if(v.getStatus()==VideoStatus.DELETED||!privileged&&(v.getStatus()!=VideoStatus.PUBLISHED||v.getVisibility()==Visibility.PRIVATE))throw new ApiException(ErrorCode.NOT_FOUND,"视频不存在");return v; }
    private void owner(Video video,CurrentUser current) { if(current==null) throw new ApiException(ErrorCode.UNAUTHORIZED,"请先登录"); if(video.getUserId()!=current.id() && current.role()!=com.videoshare.user.Role.ADMIN) throw new ApiException(ErrorCode.FORBIDDEN,"不能操作其他用户的视频"); }
    private Long insertTag(String tag){jdbc.update("INSERT INTO tags(tag_name) VALUES(?)",tag);return jdbc.queryForObject("SELECT id FROM tags WHERE tag_name=?",Long.class,tag);}
}
