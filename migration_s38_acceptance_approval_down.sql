-- ========================================================
-- ROLLBACK MIGRATION S-38: BAN QUẢN LÝ DUYỆT HOẶC TRẢ LẠI PHIẾU NGHIỆM THU KÈM LÝ DO
-- ========================================================

USE `quanly_thicong`;

ALTER TABLE `acceptance_sheets`
    DROP FOREIGN KEY IF EXISTS `fk_acceptance_rejecter`,
    DROP COLUMN IF EXISTS `rejected_at`,
    DROP COLUMN IF EXISTS `rejected_by`,
    DROP COLUMN IF EXISTS `rejection_reason`;
