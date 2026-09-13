package com.videoshare.video;

import org.springframework.data.domain.*; import org.springframework.data.jpa.repository.JpaRepository;
public interface VideoRepository extends JpaRepository<Video,Long> {
    Page<Video> findByStatusAndVisibilityOrderByPublishedAtDesc(VideoStatus status, Visibility visibility, Pageable pageable);
    Page<Video> findByStatusAndVisibilityAndTitleContainingIgnoreCaseOrderByPublishedAtDesc(VideoStatus status, Visibility visibility, String q, Pageable pageable);
}
