-- ========================================================
-- DOWN MIGRATION S-32: ROLLBACK VERSION AND CONFLICT RESOLUTION
-- ========================================================

USE quanly_thicong;

DROP TABLE IF EXISTS `diary_conflicts`;

ALTER TABLE `site_diary_items`
DROP COLUMN `version`;

ALTER TABLE `site_diaries`
DROP COLUMN `version`;
