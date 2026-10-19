-- ========================================================
-- MIGRATION S-26: BÁO CÁO KHỐI LƯỢNG HẰNG NGÀY CỦA ĐỘI THI CÔNG (SCRUM-118)
-- Epic: SCRUM-123 [E-11] Giao việc cho đội và báo cáo từ hiện trường
-- Story S-26: Đội trưởng xem việc được giao và báo khối lượng đã làm trong ngày
-- ========================================================

USE `quanly_thicong`;

CREATE TABLE IF NOT EXISTS `team_daily_progress` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `project_id` INT NOT NULL,
    `task_id` INT NOT NULL,
    `team_id` INT NOT NULL,
    `report_date` DATE NOT NULL,
    `reported_quantity` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `notes` TEXT NULL,
    `created_by` INT NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_progress_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_progress_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_progress_team` FOREIGN KEY (`team_id`) REFERENCES `project_teams` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_progress_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    INDEX `idx_progress_task_team` (`task_id`, `team_id`),
    INDEX `idx_progress_report_date` (`project_id`, `report_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
