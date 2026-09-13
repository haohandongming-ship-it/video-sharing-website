ALTER TABLE upload_sessions ADD COLUMN duration INT NOT NULL DEFAULT 0;
CREATE INDEX idx_videos_publish_sort ON videos(status, visibility, published_at, view_count, like_count);
