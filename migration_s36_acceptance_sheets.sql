-- ========================================================
-- MIGRATION S-36: LẬP PHIẾU NGHIỆM THU THEO ĐỢT & TỰ TÍNH KHỐI LƯỢNG PHÁT SINH (SCRUM-165 / SCRUM-218)
-- Epic: Quản lý nghiệm thu và thanh toán
-- Story S-36: T-70, T-71, T-72, T-73
-- ========================================================

USE `quanly_thicong`;

-- 1. Bảng acceptance_sheets (Phiếu nghiệm thu theo đợt)
CREATE TABLE IF NOT EXISTS `acceptance_sheets` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `project_id` INT NOT NULL,
    `sheet_code` VARCHAR(50) NOT NULL COMMENT 'Mã phiếu nghiệm thu, e.g. NT-01',
    `name` VARCHAR(255) NOT NULL COMMENT 'Tên đợt nghiệm thu, e.g. Phiếu nghiệm thu giai đoạn móng đợt 1',
    `period_number` INT NOT NULL DEFAULT 1 COMMENT 'Số thứ tự đợt nghiệm thu',
    `from_date` DATE NOT NULL COMMENT 'Ngày bắt đầu đợt',
    `to_date` DATE NOT NULL COMMENT 'Ngày kết thúc đợt nghiệm thu',
    `status` ENUM('draft', 'submitted', 'approved', 'rejected') NOT NULL DEFAULT 'draft' COMMENT 'Trạng thái phiếu',
    `notes` TEXT NULL COMMENT 'Ghi chú tổng quan đợt nghiệm thu',
    `created_by` INT NOT NULL COMMENT 'Kỹ sư giám sát lập phiếu',
    `approved_by` INT NULL COMMENT 'Người phê duyệt (Chỉ huy trưởng / Ban QLDA)',
    `approved_at` DATETIME NULL COMMENT 'Thời điểm phê duyệt',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_acceptance_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_acceptance_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_acceptance_approver` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    UNIQUE KEY `uq_project_sheet_code` (`project_id`, `sheet_code`),
    INDEX `idx_acceptance_project_period` (`project_id`, `period_number`),
    INDEX `idx_acceptance_status` (`project_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Bảng acceptance_sheet_items (Chi tiết hạng mục nghiệm thu trong đợt)
CREATE TABLE IF NOT EXISTS `acceptance_sheet_items` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `sheet_id` INT NOT NULL,
    `work_item_id` INT NULL COMMENT 'Liên kết hạng mục WBS',
    `task_id` INT NULL COMMENT 'Liên kết công việc cụ thể',
    `item_name` VARCHAR(255) NOT NULL COMMENT 'Tên hạng mục nghiệm thu',
    `unit` VARCHAR(50) NOT NULL DEFAULT 'm3' COMMENT 'Đơn vị tính',
    `previous_approved_quantity` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT 'Luỹ kế đợt trước đã duyệt (T-70)',
    `cumulative_quantity` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT 'Luỹ kế tới thời điểm này do kỹ sư nhập (AC 1)',
    `period_quantity` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT 'Tự tính: luỹ kế hiện tại trừ luỹ kế đợt trước đã duyệt (AC 2)',
    `team_reported_quantity` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT 'Số đội đã báo ở S-26 để đối chiếu (AC 3)',
    `difference` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT 'Chênh lệch: period_quantity - team_reported_quantity',
    `notes` TEXT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_asi_sheet` FOREIGN KEY (`sheet_id`) REFERENCES `acceptance_sheets` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_asi_work_item` FOREIGN KEY (`work_item_id`) REFERENCES `work_items` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_asi_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE SET NULL,
    INDEX `idx_asi_sheet` (`sheet_id`),
    INDEX `idx_asi_work_item` (`work_item_id`),
    INDEX `idx_asi_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Bảng acceptance_sheet_photos (Ảnh đính kèm phiếu nghiệm thu - AC 4, đính kèm ảnh hiện trường)
CREATE TABLE IF NOT EXISTS `acceptance_sheet_photos` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `sheet_id` INT NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `file_path` VARCHAR(500) NOT NULL,
    `file_size` INT NOT NULL DEFAULT 0,
    `mime_type` VARCHAR(100) NOT NULL DEFAULT 'image/jpeg',
    `caption` VARCHAR(255) NULL,
    `taken_at` DATETIME NULL COMMENT 'Thời điểm chụp ảnh từ EXIF (S-40)',
    `latitude` DECIMAL(10, 7) NULL COMMENT 'Toạ độ GPS vĩ độ từ EXIF (S-40)',
    `longitude` DECIMAL(10, 7) NULL COMMENT 'Toạ độ GPS kinh độ từ EXIF (S-40)',
    `has_metadata` BOOLEAN NOT NULL DEFAULT FALSE,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_asp_sheet` FOREIGN KEY (`sheet_id`) REFERENCES `acceptance_sheets` (`id`) ON DELETE CASCADE,
    INDEX `idx_asp_sheet` (`sheet_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
