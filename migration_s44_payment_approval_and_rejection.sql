-- ========================================================
-- MIGRATION S-44: CHỦ ĐẦU TƯ DUYỆT HOẶC TRẢ LẠI ĐỀ NGHỊ THANH TOÁN
-- Epic: E-08 (Thanh toán theo tiến độ) / SCRUM-173
-- Subtasks: T-101, T-102, T-103, T-104
-- Phụ thuộc: S-43 (payment_requests, acceptance_sheets.payment_request_id)
-- ========================================================

USE `quanly_thicong`;

-- 1. Cập nhật ENUM trạng thái đề nghị thanh toán và thêm trường lưu thông tin trả lại / từ chối
ALTER TABLE `payment_requests`
    MODIFY COLUMN `status` ENUM('draft', 'submitted', 'approved', 'rejected', 'returned', 'paid', 'cancelled') NOT NULL DEFAULT 'draft'
        COMMENT 'Trạng thái: draft (nháp), approved (đã duyệt), rejected/returned (đã trả lại), paid (đã chi trả), cancelled (đã hủy)';

ALTER TABLE `payment_requests`
    ADD COLUMN IF NOT EXISTS `rejected_by` INT NULL
        COMMENT 'Chủ đầu tư hoặc người có thẩm quyền trả lại đề nghị' AFTER `approved_at`,
    ADD COLUMN IF NOT EXISTS `rejected_at` DATETIME NULL
        COMMENT 'Thời điểm trả lại đề nghị' AFTER `rejected_by`,
    ADD COLUMN IF NOT EXISTS `rejection_reason` TEXT NULL
        COMMENT 'Lý do trả lại đề nghị thanh toán (bắt buộc theo T-101 & T-103)' AFTER `rejected_at`,
    ADD CONSTRAINT `fk_payment_rejecter`
        FOREIGN KEY IF NOT EXISTS (`rejected_by`)
        REFERENCES `users` (`id`)
        ON DELETE SET NULL;

-- 2. Chỉ mục hỗ trợ tra cứu trạng thái đề nghị và kiểm soát khóa dữ liệu (T-102)
ALTER TABLE `payment_requests`
    ADD INDEX IF NOT EXISTS `idx_payment_status_filter` (`project_id`, `status`);
