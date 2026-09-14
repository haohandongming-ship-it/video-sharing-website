-- 列表 / 个人内容库 / 后台队列的补索引
--
-- 背景：性能压测在 2 万视频数据集上发现两类问题——
--   1) 过滤 + ORDER BY 缺少可用索引（部分排序退化为 filesort）；
--   2) 个人内容库查询被优化器挑成「以 videos 为驱动表」的计划，单请求扫全表。
-- 第 2 类已通过改写为 EXISTS 半连接解决（见 VideoCatalog），这里只补真正缺失的索引。
--
-- 注意：V5 已建立 idx_videos_publish_sort(status, visibility, published_at, view_count, like_count)，
-- 它已经能服务「按发布时间排序」的主目录查询，因此这里不再重复建同前缀索引。
--
-- 兼容性：语句同时适用于 H2(MySQL 模式，开发/测试) 与 MySQL 8(生产)。

-- 1) PUBLISHED 视频必须能按发布时间排序取页；历史数据里若存在 NULL 先回填，
--    这样查询侧可以统一使用 v.published_at（COALESCE 会让索引失效）。
UPDATE videos SET published_at = created_at WHERE published_at IS NULL AND status = 'PUBLISHED';

-- 2) 按播放量排序：V5 的索引把 view_count 放在 published_at 之后，无法单独保序。
CREATE INDEX idx_video_visible_views ON videos(status, visibility, view_count, id);

-- 3) 短视频流：video_type 等值 + 可见性 + 时间排序（V1 的同类索引缺 visibility）。
CREATE INDEX idx_video_type_visible_time ON videos(video_type, status, visibility, published_at, id);

-- 4) 分区页与相关推荐：分区内按播放量取前 N。
CREATE INDEX idx_video_category_views ON videos(category_id, status, visibility, view_count, id);

-- 5) 个人内容库：收藏与观看历史都按用户取、按时间倒序；主键只覆盖 (user_id, video_id)。
CREATE INDEX idx_favorite_user_time ON favorites(user_id, created_at);
CREATE INDEX idx_play_record_user_time ON play_records(user_id, updated_at);

-- 6) 粉丝列表按 followee 取并按时间倒序（主键只覆盖 follower 前缀）。
CREATE INDEX idx_follow_followee_time ON follows(followee_id, created_at);

-- 7) 通知列表：现有 (user_id,is_read,created_at) 在没有 is_read 谓词时无法保序。
CREATE INDEX idx_notification_user_time ON notifications(user_id, created_at);

-- 8) 评论列表：顶级评论按时间/热度、回复按时间，现有索引以 root_id 为第二列用不上。
CREATE INDEX idx_comment_video_status_time ON comments(video_id, status, created_at);
CREATE INDEX idx_comment_root_time ON comments(root_id, created_at);

-- 9) 动态评论列表（此前该表没有任何索引）。
CREATE INDEX idx_feed_comment_feed_time ON feed_comments(feed_id, status, created_at);

-- 10) 后台审核队列：默认按提交时间倒序，也可按状态过滤。
CREATE INDEX idx_review_submitted_at ON video_reviews(submitted_at);
CREATE INDEX idx_review_status_time ON video_reviews(status, submitted_at);

-- 11) 私信会话列表按任一端查询并按更新时间倒序。
CREATE INDEX idx_conversation_user_a ON conversations(user_a_id, updated_at);
CREATE INDEX idx_conversation_user_b ON conversations(user_b_id, updated_at);

-- 12) 审核列表里按被举报内容统计举报数。
CREATE INDEX idx_report_target ON reports(target_type, target_id);
