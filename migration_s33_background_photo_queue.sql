-- ========================================================
-- MIGRATION S-33: HÀNG ĐỢI TẢI ẢNH NỀN VÀ TRẠNG THÁI TẢI LÊN (SCRUM-158 / T-60)
-- Story S-33: Ảnh dung lượng lớn tải nền theo hàng đợi, tiếp tục sau khi đứt mạng
-- Subtasks: T-60 (Hàng đợi ảnh), T-61 (Gửi lại sau đứt mạng), T-62 (Tải nền không chặn ghi chép)
-- ========================================================

USE `quanly_thicong`;

-- 1. Bổ sung các cột phục vụ hàng đợi và trạng thái tải ảnh vào site_diary_photos
ALTER TABLE `site_diary_photos`
    ADD COLUMN IF NOT EXISTS `upload_status` ENUM('pending', 'uploading', 'completed', 'failed') NOT NULL DEFAULT 'completed' AFTER `caption`,
    ADD COLUMN IF NOT EXISTS `client_photo_id` VARCHAR(100) NULL AFTER `upload_status`,
    ADD COLUMN IF NOT EXISTS `temp_path` VARCHAR(500) NULL AFTER `client_photo_id`,
    ADD INDEX IF NOT EXISTS `idx_photo_client_id` (`client_photo_id`),
    ADD INDEX IF NOT EXISTS `idx_photo_upload_status` (`upload_status`);
