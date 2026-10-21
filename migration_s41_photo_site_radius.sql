-- ========================================================
-- MIGRATION S-41: ẢNH CHỤP NGOÀI BÁN KÍNH CÔNG TRƯỜNG BỊ ĐÁNH DẤU NGHI VẤN (SCRUM-170)
-- Epic: E-07 (Ảnh hiện trường chống giả mạo)
-- Story S-41: Ảnh chụp ngoài bán kính công trường bị đánh dấu nghi vấn
-- Phụ thuộc: S-40 (SCRUM-169: Lưu thời điểm và toạ độ GPS từ siêu dữ liệu ảnh)
--
-- Tiêu chí chấp nhận (AC):
--   1. Dự án khai báo tọa độ tâm và bán kính công trường.
--   2. Ảnh có tọa độ nằm ngoài bán kính bị đánh dấu nghi vấn và kèm khoảng cách.
--   3. Người duyệt phiếu nhìn thấy dấu nghi vấn.
-- ========================================================

USE `quanly_thicong`;

-- 1. Bổ sung tọa độ tâm và bán kính công trường vào bảng projects (AC 1)
ALTER TABLE `projects`
    ADD COLUMN IF NOT EXISTS `site_latitude` DECIMAL(10, 7) NULL COMMENT 'Vĩ độ tâm công trường (WGS84)' AFTER `description`,
    ADD COLUMN IF NOT EXISTS `site_longitude` DECIMAL(10, 7) NULL COMMENT 'Kinh độ tâm công trường (WGS84)' AFTER `site_latitude`,
    ADD COLUMN IF NOT EXISTS `site_radius_meters` DECIMAL(10, 2) NULL COMMENT 'Bán kính công trường cho phép chụp ảnh hợp lệ (mét)' AFTER `site_longitude`;

-- 2. Bổ sung khoảng cách từ vị trí chụp đến tâm công trường vào bảng acceptance_sheet_photos (AC 2)
ALTER TABLE `acceptance_sheet_photos`
    ADD COLUMN IF NOT EXISTS `distance_to_center_meters` DECIMAL(10, 2) NULL COMMENT 'Khoảng cách tính toán từ vị trí chụp đến tâm công trường (mét)' AFTER `longitude`;

-- 3. Bổ sung khoảng cách từ vị trí chụp đến tâm công trường vào bảng site_diary_photos (AC 2)
ALTER TABLE `site_diary_photos`
    ADD COLUMN IF NOT EXISTS `distance_to_center_meters` DECIMAL(10, 2) NULL COMMENT 'Khoảng cách tính toán từ vị trí chụp đến tâm công trường (mét)' AFTER `longitude`;
