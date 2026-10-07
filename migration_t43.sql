USE quanly_thicong;

-- ==========================================================
-- MIGRATION T-43: Bảng `milestones` gắn hạng mục với ngày bắt buộc
-- SPRINT: 3 | PARENT: S-19
-- ==========================================================

-- 1. TIẾN (UP): Tạo bảng milestones
CREATE TABLE IF NOT EXISTS milestones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    work_item_id INT NOT NULL,
    due_date DATE NOT NULL,
    title VARCHAR(255) NULL,
    created_by INT NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Index hỗ trợ truy vấn mốc đang hiệu lực theo hạng mục (NFR T-43)
CREATE INDEX idx_milestones_work_item_active ON milestones(work_item_id, is_active);

-- ==========================================================
-- LÙI (DOWN): Xóa bảng milestones (Rollback)
-- Để lùi migration, thực thi các câu lệnh bên dưới:
-- DROP INDEX IF EXISTS idx_milestones_work_item_active ON milestones;
-- DROP TABLE IF EXISTS milestones;
-- ==========================================================
