-- ========================================================
-- MIGRATION S-40: LƯU THỜI ĐIỂM VÀ TOẠ ĐỘ GPS TỪ SIÊU DỮ LIỆU ẢNH (SCRUM-194 / SCRUM-195)
-- Epic: Quản lý hiện trường & Giám sát thi công
-- Story S-40: Ảnh lưu kèm thời điểm và toạ độ đọc từ siêu dữ liệu (T-85, T-86)
-- ========================================================

USE `quanly_thicong`;

ALTER TABLE `site_diary_photos`
    ADD COLUMN IF NOT EXISTS `taken_at` DATETIME NULL COMMENT 'Thời điểm chụp thực tế trích xuất từ EXIF (DateTimeOriginal)' AFTER `caption`,
    ADD COLUMN IF NOT EXISTS `latitude` DECIMAL(10, 7) NULL COMMENT 'Vĩ độ GPS trích xuất từ EXIF' AFTER `taken_at`,
    ADD COLUMN IF NOT EXISTS `longitude` DECIMAL(10, 7) NULL COMMENT 'Kinh độ GPS trích xuất từ EXIF' AFTER `latitude`,
    ADD COLUMN IF NOT EXISTS `altitude` DECIMAL(8, 2) NULL COMMENT 'Độ cao GPS' AFTER `longitude`,
    ADD COLUMN IF NOT EXISTS `has_metadata` BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Đánh dấu ảnh có siêu dữ liệu hay không (AC 3)' AFTER `altitude`,
    ADD COLUMN IF NOT EXISTS `raw_metadata` JSON NULL COMMENT 'Dữ liệu EXIF bổ sung dạng JSON' AFTER `has_metadata`,
    ADD INDEX IF NOT EXISTS `idx_photo_gps` (`latitude`, `longitude`),
    ADD INDEX IF NOT EXISTS `idx_photo_taken_at` (`taken_at`);
