-- ========================================================
-- MIGRATION S-45: PHẦN TẠM GIỮ THEO HỢP ĐỒNG ĐƯỢC TRỪ ĐÚNG TRÊN MỖI ĐỀ NGHỊ (SCRUM-E08)
-- Epic: E-08 (Thanh toán theo tiến độ)
-- Story S-45: Phần tạm giữ theo hợp đồng được trừ đúng trên mỗi đề nghị
-- Phụ thuộc: S-43 (Đề nghị thanh toán sinh từ phiếu nghiệm thu đã duyệt nhân đơn giá)
-- ========================================================

USE `quanly_thicong`;

-- 1. Bổ sung trường retention_rate (tỉ lệ tạm giữ bảo hành %) vào bảng projects
ALTER TABLE `projects`
    ADD COLUMN IF NOT EXISTS `retention_rate` DECIMAL(5, 2) NOT NULL DEFAULT 5.00 COMMENT 'Tỉ lệ tạm giữ bảo hành theo hợp đồng (%)' AFTER `description`;

-- 2. Bảng payment_requests (Đề nghị thanh toán theo tiến độ đợt)
CREATE TABLE IF NOT EXISTS `payment_requests` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `project_id` INT NOT NULL,
    `request_code` VARCHAR(50) NOT NULL COMMENT 'Mã đề nghị thanh toán, e.g. DNTT-01',
    `name` VARCHAR(255) NOT NULL COMMENT 'Tên đề nghị, e.g. Đề nghị thanh toán đợt 1',
    `period_number` INT NOT NULL DEFAULT 1 COMMENT 'Kỳ thanh toán số',
    `from_date` DATE NOT NULL COMMENT 'Ngày bắt đầu kỳ thanh toán',
    `to_date` DATE NOT NULL COMMENT 'Ngày kết thúc kỳ thanh toán',
    `gross_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.00 COMMENT 'Thành tiền khối lượng đã nghiệm thu nhân đơn giá',
    `retention_rate` DECIMAL(5, 2) NOT NULL DEFAULT 5.00 COMMENT 'Tỉ lệ tạm giữ áp dụng (%)',
    `retention_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.00 COMMENT 'Số tiền tạm giữ bảo hành',
    `net_payable_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.00 COMMENT 'Số tiền thực trả (gross - retention)',
    `status` ENUM('draft', 'submitted', 'approved', 'rejected') NOT NULL DEFAULT 'draft' COMMENT 'Trạng thái đề nghị',
    `notes` TEXT NULL,
    `created_by` INT NOT NULL COMMENT 'Người lập đề nghị (Ban QLDA)',
    `approved_by` INT NULL COMMENT 'Chủ đầu tư phê duyệt',
    `approved_at` DATETIME NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_payment_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_payment_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_payment_approver` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    UNIQUE KEY `uq_project_request_code` (`project_id`, `request_code`),
    INDEX `idx_payment_project_period` (`project_id`, `period_number`),
    INDEX `idx_payment_status` (`project_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Bảng payment_request_items (Chi tiết từng hạng mục trong đề nghị thanh toán)
CREATE TABLE IF NOT EXISTS `payment_request_items` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `payment_request_id` INT NOT NULL,
    `acceptance_sheet_id` INT NOT NULL COMMENT 'Liên kết phiếu nghiệm thu đã duyệt (S-43)',
    `work_item_id` INT NULL COMMENT 'Liên kết hạng mục công việc',
    `item_name` VARCHAR(255) NOT NULL COMMENT 'Tên hạng mục thanh toán',
    `unit` VARCHAR(50) NOT NULL DEFAULT 'm3' COMMENT 'Đơn vị tính',
    `period_quantity` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT 'Khối lượng nghiệm thu trong đợt',
    `unit_price` DECIMAL(18, 2) NOT NULL DEFAULT 0.00 COMMENT 'Đơn giá hợp đồng',
    `line_total` DECIMAL(18, 2) NOT NULL DEFAULT 0.00 COMMENT 'Thành tiền dòng = period_quantity * unit_price',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_pri_request` FOREIGN KEY (`payment_request_id`) REFERENCES `payment_requests` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_pri_sheet` FOREIGN KEY (`acceptance_sheet_id`) REFERENCES `acceptance_sheets` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_pri_work_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE SET NULL,
    INDEX `idx_pri_request` (`payment_request_id`),
    INDEX `idx_pri_sheet` (`acceptance_sheet_id`),
    INDEX `idx_pri_work_item` (`work_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
