-- ========================================================
-- MIGRATION S-39: NHẬT KÝ THAO TÁC TRÊN PHIẾU CHỈ GHI THÊM (SCRUM-168)
-- Epic: SCRUM-219 [E-10] Nhật ký hệ thống, báo cáo và thông báo
-- Sprint: SCRUM Sprint 6 + 7
-- ========================================================

USE `quanly_thicong`;

-- Bảng lưu vết kiểm toán thao tác trên phiếu chỉ ghi thêm (Append-Only Audit Logs)
-- AC: Ghi thao tác trên phiếu nghiệm thu, đề nghị thanh toán, khối lượng hợp đồng và khoá sổ nhật ký,
--     kèm người, thời điểm, giá trị trước/sau; không có API sửa hoặc xoá bản ghi nhật ký.
CREATE TABLE IF NOT EXISTS `sheet_audit_logs` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `project_id` INT NOT NULL,
    `entity_type` ENUM('acceptance_sheet', 'payment_request', 'contract_volume', 'site_diary_lock') NOT NULL,
    `entity_id` VARCHAR(100) NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `performed_by` INT NOT NULL,
    `user_name` VARCHAR(100) NULL,
    `role_name` VARCHAR(50) NULL,
    `old_values` JSON NULL,
    `new_values` JSON NULL,
    `change_summary` TEXT NULL,
    `reason` TEXT NULL,
    `ip_address` VARCHAR(45) NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_sheet_audit_project` (`project_id`),
    INDEX `idx_sheet_audit_entity` (`entity_type`, `entity_id`),
    INDEX `idx_sheet_audit_action` (`action`),
    INDEX `idx_sheet_audit_user` (`performed_by`),
    INDEX `idx_sheet_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
