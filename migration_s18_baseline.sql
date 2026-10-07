-- ==============================================================================
-- MIGRATION S-18 (SCRUM-91 / S-18): LƯU BASELINE KẾ HOẠCH GỐC
-- Parent: SCRUM-16 [E-04] Tiến độ và đường găng
-- NFR: Kế hoạch gốc lưu bảng riêng, không phải cờ trong schedule_results
-- Thiết kế idempotent, an toàn với dữ liệu hiện có
-- ==============================================================================

USE quanly_thicong;

-- 1. Bảng lưu trữ thông tin phiên bản kế hoạch gốc (Baseline Schedules)
CREATE TABLE IF NOT EXISTS baseline_schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  project_duration DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  created_by INT NULL,
  created_by_name VARCHAR(100) NOT NULL DEFAULT 'Ban Quản Lý',
  reason VARCHAR(255) NULL DEFAULT 'Khởi công chốt kế hoạch gốc',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bs_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  INDEX idx_bs_project_curr (project_id, is_current),
  INDEX idx_bs_project_ver (project_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Bảng lưu trữ chi tiết công việc thuộc kế hoạch gốc (Baseline Tasks)
CREATE TABLE IF NOT EXISTS baseline_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  baseline_schedule_id INT NOT NULL,
  project_id INT NOT NULL,
  task_id INT NOT NULL,
  task_code VARCHAR(50) NULL,
  task_name VARCHAR(255) NOT NULL,
  duration INT NOT NULL DEFAULT 1,
  early_start DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  early_finish DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  late_start DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  late_finish DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  total_float DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  is_critical BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bt_baseline FOREIGN KEY (baseline_schedule_id) REFERENCES baseline_schedules(id) ON DELETE CASCADE,
  CONSTRAINT fk_bt_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  INDEX idx_bt_base_task (baseline_schedule_id, task_id),
  INDEX idx_bt_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Bảng ghi lịch sử các lần chốt kế hoạch gốc (Baseline History - AC 3)
CREATE TABLE IF NOT EXISTS baseline_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  baseline_schedule_id INT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  action ENUM('create_initial', 'update_overwrite') NOT NULL DEFAULT 'create_initial',
  created_by INT NULL,
  created_by_name VARCHAR(100) NOT NULL DEFAULT 'Ban Quản Lý',
  task_count INT NOT NULL DEFAULT 0,
  project_duration DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  reason VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bh_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_bh_baseline FOREIGN KEY (baseline_schedule_id) REFERENCES baseline_schedules(id) ON DELETE CASCADE,
  INDEX idx_bh_project (project_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
