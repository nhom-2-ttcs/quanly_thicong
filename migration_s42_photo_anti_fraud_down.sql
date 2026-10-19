-- ========================================================
-- ROLLBACK MIGRATION S-42: XÓA CỘT ĐÁNH DẤU NGHI VẤN ẢNH
-- ========================================================

USE `quanly_thicong`;

ALTER TABLE `acceptance_sheet_photos`
    DROP COLUMN IF EXISTS `suspicious_details`,
    DROP COLUMN IF EXISTS `confidence_level`,
    DROP COLUMN IF EXISTS `suspicious_reasons`,
    DROP COLUMN IF EXISTS `is_suspicious`;

ALTER TABLE `site_diary_photos`
    DROP COLUMN IF EXISTS `suspicious_details`,
    DROP COLUMN IF EXISTS `confidence_level`,
    DROP COLUMN IF EXISTS `suspicious_reasons`,
    DROP COLUMN IF EXISTS `is_suspicious`;
