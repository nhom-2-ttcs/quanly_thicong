-- ========================================================
-- DOWN MIGRATION S-30: ROLLBACK UNIQUE CONSTRAINTS
-- ========================================================

USE quanly_thicong;

ALTER TABLE `site_diary_photos`
DROP INDEX `uq_photo_client_id`;

ALTER TABLE `site_diary_items`
DROP INDEX `uq_item_client_id`,
DROP COLUMN `client_item_id`;

ALTER TABLE `site_diaries`
DROP INDEX `uq_diary_client_id`,
DROP COLUMN `client_diary_id`;
