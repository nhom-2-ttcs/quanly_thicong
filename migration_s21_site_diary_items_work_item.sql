-- ========================================================
-- MIGRATION S-21: KỸ SƯ GIÁM SÁT GHI MỤC NHẬT KÝ HẰNG NGÀY GẮN HẠNG MỤC (SCRUM-113)
-- Epic: SCRUM-122 [E-05] Nhật ký công trường ngoại tuyến
-- ========================================================

USE `quanly_thicong`;

-- 1. Bổ sung trường log_time (giờ ghi nhận) và các chỉ mục phục vụ lọc tra cứu theo hạng mục
ALTER TABLE `site_diary_items`
    ADD COLUMN IF NOT EXISTS `log_time` VARCHAR(10) NULL AFTER `work_content`,
    ADD INDEX IF NOT EXISTS `idx_diary_item_work_item` (`work_item_id`);
