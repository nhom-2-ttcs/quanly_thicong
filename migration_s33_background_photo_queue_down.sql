-- ========================================================
-- MIGRATION S-33 DOWN: HẠ CẤP BẢNG site_diary_photos
-- ========================================================

USE `quanly_thicong`;

ALTER TABLE `site_diary_photos`
    DROP COLUMN IF EXISTS `temp_path`,
    DROP COLUMN IF EXISTS `client_photo_id`,
    DROP COLUMN IF EXISTS `upload_status`;
