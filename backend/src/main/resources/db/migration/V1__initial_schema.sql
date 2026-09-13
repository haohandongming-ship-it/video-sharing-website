CREATE TABLE users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  email VARCHAR(128) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  nickname VARCHAR(64) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'USER',
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE categories (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(32) NOT NULL UNIQUE,
  slug VARCHAR(32) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
);
CREATE TABLE files (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  sha256 CHAR(64) NOT NULL,
  file_size BIGINT NOT NULL,
  bucket VARCHAR(64) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  ref_count INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (sha256, file_size)
);
CREATE TABLE videos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  source_file_id BIGINT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(5000),
  cover_url VARCHAR(512),
  hls_url VARCHAR(512),
  duration INT NOT NULL DEFAULT 0,
  file_size BIGINT NOT NULL DEFAULT 0,
  video_type VARCHAR(16) NOT NULL DEFAULT 'LONG',
  category_id BIGINT NOT NULL,
  visibility VARCHAR(16) NOT NULL DEFAULT 'PUBLIC',
  status VARCHAR(16) NOT NULL DEFAULT 'PROCESSING',
  download_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  view_count BIGINT NOT NULL DEFAULT 0,
  like_count BIGINT NOT NULL DEFAULT 0,
  dislike_count BIGINT NOT NULL DEFAULT 0,
  comment_count BIGINT NOT NULL DEFAULT 0,
  favorite_count BIGINT NOT NULL DEFAULT 0,
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_video_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_video_file FOREIGN KEY (source_file_id) REFERENCES files(id),
  CONSTRAINT fk_video_category FOREIGN KEY (category_id) REFERENCES categories(id)
);
CREATE INDEX idx_video_user_status ON videos(user_id, status);
CREATE INDEX idx_video_type_status_time ON videos(video_type, status, published_at);
CREATE TABLE comments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  video_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  parent_id BIGINT,
  root_id BIGINT,
  content VARCHAR(1000) NOT NULL,
  like_count INT NOT NULL DEFAULT 0,
  reply_count INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'VISIBLE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_comment_video FOREIGN KEY (video_id) REFERENCES videos(id),
  CONSTRAINT fk_comment_user FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_comment_video_root_time ON comments(video_id, root_id, created_at);
CREATE TABLE follows (follower_id BIGINT NOT NULL, followee_id BIGINT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (follower_id, followee_id), CONSTRAINT ck_no_self_follow CHECK (follower_id <> followee_id));
CREATE TABLE favorites (user_id BIGINT NOT NULL, video_id BIGINT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, video_id));
CREATE TABLE likes (user_id BIGINT NOT NULL, target_type VARCHAR(16) NOT NULL, target_id BIGINT NOT NULL, type VARCHAR(16) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, target_type, target_id));
CREATE TABLE reports (id BIGINT AUTO_INCREMENT PRIMARY KEY, reporter_id BIGINT NOT NULL, target_type VARCHAR(16) NOT NULL, target_id BIGINT NOT NULL, reason VARCHAR(32) NOT NULL, description VARCHAR(1000), status VARCHAR(16) NOT NULL DEFAULT 'PENDING', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO categories(name, slug, sort_order) VALUES ('科技','technology',1),('生活','life',2),('娱乐','entertainment',3);
