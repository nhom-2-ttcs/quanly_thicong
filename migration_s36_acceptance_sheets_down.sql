-- ========================================================
-- DOWN MIGRATION S-36: HOÀN TÁC CÁC BẢNG PHIẾU NGHIỆM THU
-- ========================================================

USE `quanly_thicong`;

DROP TABLE IF EXISTS `acceptance_sheet_photos`;
DROP TABLE IF EXISTS `acceptance_sheet_items`;
DROP TABLE IF EXISTS `acceptance_sheets`;
