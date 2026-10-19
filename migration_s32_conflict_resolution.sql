-- ========================================================
-- MIGRATION S-32 (SCRUM-145): PHÁT HIỆN XUNG ĐỘT, PHIÊN BẢN (OPTIMISTIC CONCURRENCY) VÀ GIỮ CẢ 2 BẢN
-- ========================================================

USE quanly_thicong;

-- 1. Bổ sung trường version tự tăng vào site_diaries
ALTER TABLE `site_diaries`
ADD COLUMN `version` INT NOT NULL DEFAULT 1 AFTER `is_locked`;

-- 2. Bổ sung trường version tự tăng vào site_diary_items
ALTER TABLE `site_diary_items`
ADD COLUMN `version` INT NOT NULL DEFAULT 1 AFTER `quantity_done`;

-- 3. Tạo bảng lưu trữ xung đột nhật ký (diary_conflicts) để giữ cả hai bản
CREATE TABLE IF NOT EXISTS `diary_conflicts` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `project_id` INT NOT NULL,
    `entity_type` ENUM('diary', 'diary_item') NOT NULL,
    `entity_id` INT NOT NULL,
    `server_version` INT NOT NULL,
    `client_version` INT NOT NULL,
    `server_data` JSON NOT NULL,
    `client_data` JSON NOT NULL,
    `conflict_fields` JSON NOT NULL,
    `auto_merged` TINYINT(1) NOT NULL DEFAULT 0,
    `merged_data` JSON NULL,
    `status` ENUM('pending', 'resolved_server', 'resolved_client', 'resolved_merged') NOT NULL DEFAULT 'pending',
    `resolved_by` INT NULL,
    `resolved_at` DATETIME NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_conflict_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    INDEX `idx_conflict_entity` (`entity_type`, `entity_id`),
    INDEX `idx_conflict_status` (`project_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
