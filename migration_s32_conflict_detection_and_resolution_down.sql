-- ========================================================
-- DOWN MIGRATION S-32: ROLLBACK PHÁT HIỆN XUNG ĐỘT (SCRUM-145)
-- ========================================================

USE `quanly_thicong`;

DROP TABLE IF EXISTS `site_diary_item_history`;
DROP TABLE IF EXISTS `site_diary_item_conflicts`;

ALTER TABLE `site_diary_items`
    DROP INDEX IF EXISTS `idx_diary_item_conflict`,
    DROP COLUMN IF EXISTS `has_conflict`,
    DROP COLUMN IF EXISTS `version`;
