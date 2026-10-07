-- ==========================================================
-- MIGRATION T-44: Bảng `milestone_alerts` cảnh báo vượt mốc tiến độ
-- ==========================================================

-- 1. TIẾN (UP): Tạo bảng milestone_alerts
CREATE TABLE IF NOT EXISTS milestone_alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    milestone_id INT NOT NULL,
    work_item_id INT NOT NULL,
    due_date DATE NOT NULL,
    max_early_finish DECIMAL(8, 2) NOT NULL,
    overdue_days INT NOT NULL,
    status ENUM('active', 'closed') NOT NULL DEFAULT 'active',
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE CASCADE,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Index tìm cảnh báo theo dự án và trạng thái
CREATE INDEX idx_ma_project_status ON milestone_alerts(project_id, status);
CREATE INDEX idx_ma_milestone ON milestone_alerts(milestone_id);
