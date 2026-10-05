-- ====================================================================
-- MIGRATION S-06: QUẢN LÝ QUAN HỆ PHỤ THUỘC GIỮA CÁC CÔNG VIỆC (SCRUM-61)
-- Subtasks: T-13 (Khai báo quan hệ) & T-14 (Bốn loại quan hệ FS/SS/FF/SF & lag)
-- Tính chất: Idempotent (Chạy lại an toàn, không trùng lặp, không mất dữ liệu)
-- ====================================================================

-- 1. Tạo bảng task_dependencies nếu chưa tồn tại
CREATE TABLE IF NOT EXISTS task_dependencies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  predecessor_task_id INT NOT NULL,
  successor_task_id INT NOT NULL,
  dependency_type ENUM('FS', 'SS', 'FF', 'SF') NOT NULL DEFAULT 'FS',
  lag_days DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Ràng buộc toàn vẹn dữ liệu
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  -- Chặn xóa task khi đang có quan hệ phụ thuộc (tránh xóa lan truyền ngầm)
  FOREIGN KEY (predecessor_task_id) REFERENCES tasks(id) ON DELETE RESTRICT,
  FOREIGN KEY (successor_task_id) REFERENCES tasks(id) ON DELETE RESTRICT,
  
  -- Không cho phép tạo 2 dependency trùng giữa cùng cặp công việc
  UNIQUE KEY unique_dependency_pair (predecessor_task_id, successor_task_id),
  
  -- Chỉ mục tối ưu truy vấn
  INDEX idx_deps_project (project_id),
  INDEX idx_deps_pred (predecessor_task_id),
  INDEX idx_deps_succ (successor_task_id),
  
  -- Chặn tự phụ thuộc chính nó ở cấp CSDL (Self-loop)
  CONSTRAINT chk_no_self_loop CHECK (predecessor_task_id <> successor_task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Seed dữ liệu quan hệ mẫu ban đầu (idempotent: chỉ thêm nếu chưa tồn tại)
-- Liên kết: CV-01 (Đào đất hố móng) -> CV-02 (Đổ bê tông lót móng), Loại: FS, Lag: 0 ngày
INSERT IGNORE INTO task_dependencies (project_id, predecessor_task_id, successor_task_id, dependency_type, lag_days)
SELECT 1, 1, 2, 'FS', 0.00
FROM DUAL
WHERE EXISTS (SELECT 1 FROM tasks WHERE id = 1)
  AND EXISTS (SELECT 1 FROM tasks WHERE id = 2)
  AND NOT EXISTS (
    SELECT 1 FROM task_dependencies WHERE predecessor_task_id = 1 AND successor_task_id = 2
  );
