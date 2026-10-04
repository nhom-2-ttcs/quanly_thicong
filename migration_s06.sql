USE quanly_thicong;

-- ====================================================================
-- Khai báo quan hệ phụ thuộc đủ bốn loại (FS, SS, FF, SF) và độ trễ thi công
-- User Story: Là ban quản lý dự án, tôi muốn khai việc nào phải chờ việc nào
-- theo đúng loại quan hệ thực tế để hệ thống tính được tiến độ.
-- Tiêu chí chấp nhận:
-- 1. Lưu được đầy đủ FS, SS, FF và SF.
-- 2. Quan hệ có thể có độ trễ dương, bằng 0 hoặc âm.
-- 3. Không cho một công việc phụ thuộc chính nó.
-- 4. Không cho trùng cặp công việc trước và công việc sau.
-- 5. Loại quan hệ lưu bằng mã cố định, không lưu chuỗi tiếng Việt.
-- ====================================================================

CREATE TABLE IF NOT EXISTS work_item_dependencies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    predecessor_id INT NOT NULL COMMENT 'Công việc trước (tiền nhiệm)',
    successor_id INT NOT NULL COMMENT 'Công việc sau (kế nhiệm)',
    dependency_type ENUM('FS', 'SS', 'FF', 'SF') NOT NULL DEFAULT 'FS' COMMENT 'Mã cố định: FS, SS, FF, SF (không lưu chuỗi tiếng Việt)',
    lag INT NOT NULL DEFAULT 0 COMMENT 'Độ trễ: số nguyên dương, bằng 0, hoặc âm (ngày/lead)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (predecessor_id) REFERENCES work_items(id) ON DELETE CASCADE,
    FOREIGN KEY (successor_id) REFERENCES work_items(id) ON DELETE CASCADE,
    UNIQUE KEY unique_predecessor_successor (predecessor_id, successor_id),
    CONSTRAINT chk_no_self_dependency CHECK (predecessor_id <> successor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed dữ liệu mẫu ban đầu cho S-06 (nếu chưa có)
INSERT IGNORE INTO work_item_dependencies (id, project_id, predecessor_id, successor_id, dependency_type, lag) VALUES
(1, 1, 3, 4, 'FS', 0),   -- FS độ trễ = 0
(2, 1, 4, 5, 'FS', 1),   -- FS độ trễ dương = 1
(3, 1, 2, 5, 'SS', 0),   -- SS độ trễ = 0
(4, 1, 5, 7, 'FF', 2),   -- FF độ trễ dương = 2
(5, 1, 7, 8, 'SF', -1);  -- SF độ trễ âm = -1
