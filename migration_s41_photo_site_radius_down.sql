-- ========================================================
-- ROLLBACK MIGRATION S-41: ẢNH CHỤP NGOÀI BÁN KÍNH CÔNG TRƯỜNG BỊ ĐÁNH DẤU NGHI VẤN
-- ========================================================

USE `quanly_thicong`;

ALTER TABLE `site_diary_photos`
    DROP COLUMN IF EXISTS `distance_to_center_meters`;

ALTER TABLE `acceptance_sheet_photos`
    DROP COLUMN IF EXISTS `distance_to_center_meters`;

ALTER TABLE `projects`
    DROP COLUMN IF EXISTS `site_radius_meters`,
    DROP COLUMN IF EXISTS `site_longitude`,
    DROP COLUMN IF EXISTS `site_latitude`;
