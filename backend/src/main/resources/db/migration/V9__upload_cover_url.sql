-- 上传时浏览器会在 canvas 上抓取一帧作为封面，但此前前端截取的帧从未提交给后端，
-- UploadService 又两处把 cover_url 写死成 /favicon.svg，导致所有上传视频的封面
-- 都是同一个占位图标（用户看到的「统一暂停符号」）。
--
-- cover_url：在 init 阶段把抓帧结果落到对象存储后，把 URL 暂存在会话里；
-- video_id：分片合并成功、视频记录建立后回填，转码完成时据此取出封面写入 videos.cover_url。
ALTER TABLE upload_sessions ADD COLUMN cover_url VARCHAR(512);
ALTER TABLE upload_sessions ADD COLUMN video_id BIGINT;
