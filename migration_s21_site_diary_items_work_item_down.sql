-- ========================================================
-- MIGRATION S-21 DOWN: HẠ CẤP BẢNG site_diary_items
-- ========================================================

USE `quanly_thicong`;

ALTER TABLE `site_diary_items`
    DROP INDEX IF EXISTS `idx_diary_item_work_item`,
    DROP COLUMN IF EXISTS `log_time`;
