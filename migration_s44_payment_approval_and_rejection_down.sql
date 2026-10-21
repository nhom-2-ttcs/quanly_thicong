-- ========================================================
-- DOWN MIGRATION S-44: HOÀN TÁC CHỦ ĐẦU TƯ DUYỆT HOẶC TRẢ LẠI ĐỀ NGHỊ
-- ========================================================

USE `quanly_thicong`;

ALTER TABLE `payment_requests`
    DROP FOREIGN KEY IF EXISTS `fk_payment_rejecter`,
    DROP COLUMN IF EXISTS `rejection_reason`,
    DROP COLUMN IF EXISTS `rejected_at`,
    DROP COLUMN IF EXISTS `rejected_by`,
    DROP INDEX IF EXISTS `idx_payment_status_filter`;
