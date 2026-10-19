-- ========================================================
-- MIGRATION S-32: PHÁT HIỆN XUNG ĐỘT HAI NGƯỜI CÙNG SỬA MỤC VÀ GIỮ CẢ HAI BẢN (SCRUM-145)
-- Epic: SCRUM-122 [E-05] Nhật ký công trường ngoại tuyến
-- Sprint: SCRUM Sprint 4
-- ========================================================

USE `quanly_thicong`;

-- 1. Bổ sung trường version và cờ xung đột vào bảng site_diary_items
ALTER TABLE `site_diary_items`
    ADD COLUMN IF NOT EXISTS `version` INT NOT NULL DEFAULT 1 AFTER `unit`,
    ADD COLUMN IF NOT EXISTS `has_conflict` TINYINT(1) NOT NULL DEFAULT 0 AFTER `version`,
    ADD INDEX IF NOT EXISTS `idx_diary_item_conflict` (`has_conflict`);

-- 2. Bảng lưu trữ các bản ghi xung đột khi hai người cùng sửa mục ngoại tuyến (AC 1 & AC 2)
CREATE TABLE IF NOT EXISTS `site_diary_item_conflicts` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `item_id` INT NOT NULL,
    `diary_id` INT NOT NULL,
    `base_version` INT NOT NULL DEFAULT 1,
    `server_version` INT NOT NULL DEFAULT 1,
    `client_version_data` JSON NOT NULL,
    `server_version_data` JSON NOT NULL,
    `conflicted_fields` JSON NOT NULL,
    `submitted_by` INT NULL,
    `device_id` VARCHAR(100) NULL,
    `status` ENUM('pending', 'resolved') NOT NULL DEFAULT 'pending',
    `resolved_choice` ENUM('keep_server', 'keep_incoming', 'manual_merge') NULL,
    `resolved_by` INT NULL,
    `resolved_at` DATETIME NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_conflict_item` FOREIGN KEY (`item_id`) REFERENCES `site_diary_items` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_conflict_diary` FOREIGN KEY (`diary_id`) REFERENCES `site_diaries` (`id`) ON DELETE CASCADE,
    INDEX `idx_conflict_item` (`item_id`),
    INDEX `idx_conflict_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Bảng lưu vết lịch sử các phiên bản của mục nhật ký (AC 2: bản kia vẫn lưu trong lịch sử)
CREATE TABLE IF NOT EXISTS `site_diary_item_history` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `item_id` INT NOT NULL,
    `diary_id` INT NOT NULL,
    `version` INT NOT NULL,
    `work_item_id` INT NULL,
    `work_content` TEXT NOT NULL,
    `log_time` VARCHAR(10) NULL,
    `quantity_done` DECIMAL(12, 2) DEFAULT 0,
    `unit` VARCHAR(50) NULL,
    `change_type` ENUM('created', 'updated', 'auto_merged', 'conflict_resolved', 'conflict_superseded') NOT NULL DEFAULT 'updated',
    `changed_by` INT NULL,
    `change_summary` TEXT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_history_item` FOREIGN KEY (`item_id`) REFERENCES `site_diary_items` (`id`) ON DELETE CASCADE,
    INDEX `idx_history_item` (`item_id`),
    INDEX `idx_history_item_ver` (`item_id`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
