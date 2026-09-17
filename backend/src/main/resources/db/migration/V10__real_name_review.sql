-- 实名认证此前只保存了姓名密文和证件号的 SHA-256 哈希：
-- 哈希不可逆，审核员无从核对「姓名 + 证件号」，实名审核因此根本无法进行。
-- 这里补上证件号密文（与姓名同为 AES-256-GCM），并记录提交时间用于队列排序。
--
-- 隐私口径：队列接口只返回掩码后的证件号（前 6 后 4），姓名加密存储、审核时解密。
ALTER TABLE creator_profiles ADD COLUMN id_card_encrypted VARCHAR(512);
ALTER TABLE creator_profiles ADD COLUMN submitted_at TIMESTAMP;
-- 已有 PENDING 申请没有可核对的证件号，提交时间以库中可见信息兜底
UPDATE creator_profiles SET submitted_at = CURRENT_TIMESTAMP WHERE auth_status = 'PENDING' AND submitted_at IS NULL;
