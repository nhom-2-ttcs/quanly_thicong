-- ========================================================
-- MIGRATION S-38: BAN QUẢN LÝ DUYỆT HOẶC TRẢ LẠI PHIẾU NGHIỆM THU KÈM LÝ DO (SCRUM-167)
-- Epic: E-06 (Nghiệm thu khối lượng luỹ kế)
-- Story S-38: Ban quản lý duyệt hoặc trả lại phiếu nghiệm thu kèm lý do
-- Phụ thuộc: S-36 (acceptance_sheets, acceptance_sheet_items)
--
-- Tiêu chí chấp nhận (AC):
--   a. Phiếu chỉ được tính vào khối lượng luỹ kế sau khi được duyệt.
--   b. Trả lại phiếu bắt buộc có lý do; phiếu quay lại cho người lập sửa.
--   c. Phiếu đã duyệt không được sửa trực tiếp; muốn sửa phải lập phiếu điều chỉnh.
-- ========================================================

USE `quanly_thicong`;

-- 1. Bổ sung các trường phục vụ luồng trả lại phiếu nghiệm thu kèm lý do
ALTER TABLE `acceptance_sheets`
    ADD COLUMN IF NOT EXISTS `rejection_reason` TEXT NULL COMMENT 'Lý do ban quản lý trả lại phiếu nghiệm thu (S-38 AC b)' AFTER `notes`,
    ADD COLUMN IF NOT EXISTS `rejected_by` INT NULL COMMENT 'Người trả lại phiếu (BQL/Chỉ huy trưởng/Admin)' AFTER `approved_at`,
    ADD COLUMN IF NOT EXISTS `rejected_at` DATETIME NULL COMMENT 'Thời điểm trả lại phiếu nghiệm thu' AFTER `rejected_by`,
    ADD CONSTRAINT `fk_acceptance_rejecter` FOREIGN KEY IF NOT EXISTS (`rejected_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;
