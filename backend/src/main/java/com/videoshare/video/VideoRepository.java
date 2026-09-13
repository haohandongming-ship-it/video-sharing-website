package com.videoshare.video;

import org.springframework.data.domain.*; import org.springframework.data.jpa.repository.JpaRepository; import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
public interface VideoRepository extends JpaRepository<Video,Long>,JpaSpecificationExecutor<Video> {
    Page<Video> findByStatusAndVisibilityOrderByPublishedAtDesc(VideoStatus status, Visibility visibility, Pageable pageable);
    Page<Video> findByStatusAndVisibilityAndTitleContainingIgnoreCaseOrderByPublishedAtDesc(VideoStatus status, Visibility visibility, String q, Pageable pageable);
}
