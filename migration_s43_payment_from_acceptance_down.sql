-- ========================================================
-- MIGRATION S-43 DOWN: Rollback
-- ========================================================

USE `quanly_thicong`;

DROP PROCEDURE IF EXISTS `sp_create_payment_from_acceptance`;
DROP VIEW IF EXISTS `v_approved_sheets_available`;

ALTER TABLE `acceptance_sheets`
    DROP FOREIGN KEY IF EXISTS `fk_as_payment_request`,
    DROP INDEX IF EXISTS `uq_acceptance_sheet_payment`,
    DROP COLUMN IF EXISTS `payment_request_id`;
