-- ========================================================
-- DOWN MIGRATION S-40: HOÀN TÁC CÁC CỘT SIÊU DỮ LIỆU EXIF
-- ========================================================

USE `quanly_thicong`;

ALTER TABLE `site_diary_photos`
    DROP INDEX IF EXISTS `idx_photo_gps`,
    DROP INDEX IF EXISTS `idx_photo_taken_at`,
    DROP COLUMN IF EXISTS `raw_metadata`,
    DROP COLUMN IF EXISTS `has_metadata`,
    DROP COLUMN IF EXISTS `altitude`,
    DROP COLUMN IF EXISTS `longitude`,
    DROP COLUMN IF EXISTS `latitude`,
    DROP COLUMN IF EXISTS `taken_at`;
