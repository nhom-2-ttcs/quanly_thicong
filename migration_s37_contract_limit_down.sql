-- ========================================================
-- ROLLBACK MIGRATION S-37: XÓA TRIGGER CHẶN NGHIỆM THU VƯỢT HỢP ĐỒNG
-- ========================================================

USE `quanly_thicong`;

DROP TRIGGER IF EXISTS `trg_check_acceptance_contract_qty_insert`;
DROP TRIGGER IF EXISTS `trg_check_acceptance_contract_qty_update`;
