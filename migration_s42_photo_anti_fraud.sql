-- ========================================================
-- MIGRATION S-42: ĐÁNH DẤU ẢNH THIẾU SIÊU DỮ LIỆU HOẶC CÓ DẤU HIỆU CHỤP LẠI MÀN HÌNH (SCRUM-E07)
-- Epic: E-07 (Ảnh hiện trường chống giả mạo)
-- Story S-42: Ảnh thiếu siêu dữ liệu hoặc có dấu hiệu chụp lại màn hình bị đánh dấu
-- ========================================================

USE `quanly_thicong`;

-- 1. Bổ sung các cột đánh dấu nghi vấn vào bảng acceptance_sheet_photos
ALTER TABLE `acceptance_sheet_photos`
    ADD COLUMN IF NOT EXISTS `is_suspicious` BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Đánh dấu ảnh có dấu hiệu nghi vấn giả mạo' AFTER `has_metadata`,
    ADD COLUMN IF NOT EXISTS `suspicious_reasons` JSON NULL COMMENT 'Danh sách mã dấu hiệu nghi vấn (missing_camera_metadata, screenshot_detected, taken_time_too_far)' AFTER `is_suspicious`,
    ADD COLUMN IF NOT EXISTS `confidence_level` ENUM('low', 'medium', 'high') NULL COMMENT 'Mức độ tin cậy của phát hiện nghi vấn' AFTER `suspicious_reasons`,
    ADD COLUMN IF NOT EXISTS `suspicious_details` TEXT NULL COMMENT 'Chi tiết giải thích dấu hiệu nghi vấn cho người duyệt xem kỹ' AFTER `confidence_level`,
    ADD INDEX IF NOT EXISTS `idx_asp_suspicious` (`is_suspicious`);

-- 2. Bổ sung các cột đánh dấu nghi vấn vào bảng site_diary_photos
ALTER TABLE `site_diary_photos`
    ADD COLUMN IF NOT EXISTS `is_suspicious` BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Đánh dấu ảnh có dấu hiệu nghi vấn giả mạo' AFTER `has_metadata`,
    ADD COLUMN IF NOT EXISTS `suspicious_reasons` JSON NULL COMMENT 'Danh sách mã dấu hiệu nghi vấn' AFTER `is_suspicious`,
    ADD COLUMN IF NOT EXISTS `confidence_level` ENUM('low', 'medium', 'high') NULL COMMENT 'Mức độ tin cậy của phát hiện nghi vấn' AFTER `suspicious_reasons`,
    ADD COLUMN IF NOT EXISTS `suspicious_details` TEXT NULL COMMENT 'Chi tiết giải thích dấu hiệu nghi vấn cho người duyệt xem kỹ' AFTER `confidence_level`,
    ADD INDEX IF NOT EXISTS `idx_sdp_suspicious` (`is_suspicious`);
