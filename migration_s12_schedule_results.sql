-- ==============================================================================
-- MIGRATION S-12 (SCRUM-67): BẢNG TIẾN ĐỘ VÀ VIỆC GĂNG (T-26 / SCRUM-83)
-- Tác vụ: SCRUM-83 [T-26] Lưu kết quả vào schedule_results
-- Parent: SCRUM-16 [E-04]
-- Thiết kế idempotent, an toàn với dữ liệu hiện có
-- ==============================================================================

-- 1. Bảng lưu trữ kết quả tính toán tiến độ CPM chi tiết cho từng công việc
CREATE TABLE IF NOT EXISTS schedule_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  task_id INT NOT NULL,
  early_start DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  early_finish DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  late_start DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  late_finish DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  total_float DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  is_critical BOOLEAN NOT NULL DEFAULT FALSE,
  is_stale BOOLEAN NOT NULL DEFAULT FALSE,
  calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_project_task (project_id, task_id),
  INDEX idx_sr_project_es (project_id, early_start, task_id),
  INDEX idx_sr_project_crit (project_id, is_critical),
  INDEX idx_sr_task (task_id),
  CONSTRAINT fk_sr_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_sr_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Bảng theo dõi trạng thái bộ nhớ đệm tiến độ của dự án (cache status & invalidation)
CREATE TABLE IF NOT EXISTS project_schedule_status (
  project_id INT PRIMARY KEY,
  needs_recalculation BOOLEAN NOT NULL DEFAULT TRUE,
  project_duration DECIMAL(8, 2) NULL,
  calculated_at TIMESTAMP NULL,
  has_cycle BOOLEAN NOT NULL DEFAULT FALSE,
  cycle_info TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pss_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
