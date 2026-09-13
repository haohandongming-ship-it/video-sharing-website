CREATE TABLE account_deletion_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  reason VARCHAR(500),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scheduled_at TIMESTAMP NOT NULL,
  cancelled_at TIMESTAMP,
  completed_at TIMESTAMP,
  CONSTRAINT fk_deletion_user FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX idx_deletion_due ON account_deletion_requests(status,scheduled_at);

CREATE TABLE idempotency_records (
  idempotency_key VARCHAR(80) NOT NULL,
  request_scope VARCHAR(160) NOT NULL,
  user_id BIGINT NOT NULL,
  response_code INT,
  response_body VARCHAR(8000),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(idempotency_key,request_scope,user_id)
);
CREATE INDEX idx_idempotency_expiry ON idempotency_records(expires_at);

CREATE TABLE subtitles (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  video_id BIGINT NOT NULL,
  language_code VARCHAR(16) NOT NULL,
  label VARCHAR(64) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  format VARCHAR(8) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(video_id,language_code),
  CONSTRAINT fk_subtitle_video FOREIGN KEY(video_id) REFERENCES videos(id)
);

CREATE TABLE danmaku (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  video_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  time_offset_ms INT NOT NULL,
  content VARCHAR(200) NOT NULL,
  color VARCHAR(12) NOT NULL DEFAULT '#FFFFFF',
  position VARCHAR(12) NOT NULL DEFAULT 'SCROLL',
  status VARCHAR(16) NOT NULL DEFAULT 'VISIBLE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_danmaku_video FOREIGN KEY(video_id) REFERENCES videos(id),
  CONSTRAINT fk_danmaku_user FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX idx_danmaku_timeline ON danmaku(video_id,time_offset_ms,status);

CREATE TABLE coin_wallets (
  user_id BIGINT PRIMARY KEY,
  balance INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_coin_wallet_user FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE coin_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  video_id BIGINT NOT NULL,
  amount INT NOT NULL,
  idempotency_key VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,idempotency_key),
  CONSTRAINT fk_coin_user FOREIGN KEY(user_id) REFERENCES users(id),
  CONSTRAINT fk_coin_video FOREIGN KEY(video_id) REFERENCES videos(id)
);
CREATE INDEX idx_coin_video ON coin_records(video_id,created_at);
