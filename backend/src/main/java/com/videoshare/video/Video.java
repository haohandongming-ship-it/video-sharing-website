package com.videoshare.video;

import jakarta.persistence.*;
import java.time.Instant;

@Entity @Table(name="videos")
public class Video {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(name="user_id",nullable=false) private Long userId;
    @Column(name="source_file_id",nullable=false) private Long sourceFileId;
    @Column(nullable=false,length=200) private String title;
    @Column(length=5000) private String description;
    @Column(name="cover_url") private String coverUrl;
    @Column(name="hls_url") private String hlsUrl;
    @Column(nullable=false) private int duration;
    @Column(name="file_size",nullable=false) private long fileSize;
    @Enumerated(EnumType.STRING) @Column(name="video_type",nullable=false) private VideoType videoType;
    @Column(name="category_id",nullable=false) private Long categoryId;
    @Enumerated(EnumType.STRING) @Column(nullable=false) private Visibility visibility;
    @Enumerated(EnumType.STRING) @Column(nullable=false) private VideoStatus status;
    @Column(name="download_enabled",nullable=false) private boolean downloadEnabled;
    @Column(name="view_count",nullable=false) private long viewCount;
    @Column(name="like_count",nullable=false) private long likeCount;
    @Column(name="dislike_count",nullable=false) private long dislikeCount;
    @Column(name="comment_count",nullable=false) private long commentCount;
    @Column(name="favorite_count",nullable=false) private long favoriteCount;
    @Column(name="published_at") private Instant publishedAt;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="updated_at",nullable=false) private Instant updatedAt;
    @Column(name="review_note",length=1000) private String reviewNote;
    public Long getId(){return id;} public Long getUserId(){return userId;} public Long getSourceFileId(){return sourceFileId;} public String getTitle(){return title;} public String getDescription(){return description;} public String getCoverUrl(){return coverUrl;} public String getHlsUrl(){return hlsUrl;} public int getDuration(){return duration;} public long getFileSize(){return fileSize;} public VideoType getVideoType(){return videoType;} public Long getCategoryId(){return categoryId;} public Visibility getVisibility(){return visibility;} public VideoStatus getStatus(){return status;} public boolean isDownloadEnabled(){return downloadEnabled;} public long getViewCount(){return viewCount;} public long getLikeCount(){return likeCount;} public long getDislikeCount(){return dislikeCount;} public long getCommentCount(){return commentCount;} public long getFavoriteCount(){return favoriteCount;} public Instant getPublishedAt(){return publishedAt;} public Instant getCreatedAt(){return createdAt;} public Instant getUpdatedAt(){return updatedAt;} public String getReviewNote(){return reviewNote;}
    public void edit(String title,String description,Long categoryId,Visibility visibility,boolean downloadEnabled){this.title=title;this.description=description;this.categoryId=categoryId;this.visibility=visibility;this.downloadEnabled=downloadEnabled;}
    public void editPartial(String title,String description,Long categoryId,Visibility visibility,Boolean downloadEnabled){if(title!=null&&!title.isBlank())this.title=title;if(description!=null)this.description=description;if(categoryId!=null)this.categoryId=categoryId;if(visibility!=null)this.visibility=visibility;if(downloadEnabled!=null)this.downloadEnabled=downloadEnabled;this.updatedAt=Instant.now();}
    public void setCounters(long views,long likes,long dislikes,long comments,long favorites){this.viewCount=views;this.likeCount=likes;this.dislikeCount=dislikes;this.commentCount=comments;this.favoriteCount=favorites;}
    public void delete(){this.status=VideoStatus.DELETED;}
    public void initialize(long userId,long sourceFileId,String title,String description,long categoryId,VideoType type,Visibility visibility,long fileSize){this.userId=userId;this.sourceFileId=sourceFileId;this.title=title;this.description=description;this.categoryId=categoryId;this.videoType=type;this.visibility=visibility;this.fileSize=fileSize;this.status=VideoStatus.PROCESSING;this.createdAt=Instant.now();this.updatedAt=createdAt;}
    public void transcodeComplete(String hlsUrl,String coverUrl,int duration){this.hlsUrl=hlsUrl;this.coverUrl=coverUrl;this.duration=duration;this.status=VideoStatus.REVIEWING;this.updatedAt=Instant.now();}
    public void review(boolean approved,String note){this.status=approved?VideoStatus.PUBLISHED:VideoStatus.REJECTED;this.reviewNote=note;this.publishedAt=approved?Instant.now():null;this.updatedAt=Instant.now();}
}
