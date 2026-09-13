CREATE TABLE upload_session_tags (upload_id VARCHAR(80) NOT NULL,tag_name VARCHAR(64) NOT NULL,PRIMARY KEY(upload_id,tag_name));
CREATE INDEX idx_upload_user_status ON upload_sessions(user_id,status,created_at);
CREATE INDEX idx_transcode_video ON transcode_tasks(video_id,status);
CREATE INDEX idx_report_status_priority ON reports(status,priority,created_at);
CREATE INDEX idx_like_target ON likes(target_type,target_id,type);
CREATE INDEX idx_favorite_video ON favorites(video_id);
