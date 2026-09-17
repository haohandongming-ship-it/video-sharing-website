-- 头像以 Data URL（base64）形式保存，VARCHAR(512) 远不够用：
-- 一张 36KB 的 JPG 编码后约 48K 字符，超出后插入会抛 DataIntegrityViolationException，
-- 被全局异常处理器兜成 50001「服务暂时不可用」，用户完全看不出问题在哪。
-- 这里放宽到 TEXT（MySQL/H2 均为 65535 字节上限），配合服务端 48000 字符的显式校验，
-- 保证「校验拦住」发生在写库之前，而不是靠数据库报错兜底。
ALTER TABLE users MODIFY COLUMN avatar_url TEXT;
