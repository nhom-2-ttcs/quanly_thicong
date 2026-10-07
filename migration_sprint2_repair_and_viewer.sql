USE quanly_thicong;

-- 1. Bổ sung vai trò Người xem dự án (viewer) nếu chưa có (SCRUM-29 / Sprint 2)
INSERT INTO roles (id, name, display_name, description)
VALUES (7, 'viewer', 'Người xem dự án', 'Chỉ xem những dự án được cấp quyền; không được tạo, sửa hoặc xóa dữ liệu.')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);

-- 2. Tạo bảng project_members để phân quyền người xem theo từng dự án
CREATE TABLE IF NOT EXISTS project_members (
    project_id INT NOT NULL,
    user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id),
    CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_pm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Khắc phục triệt để lỗi hiển thị tiếng Việt / mojibake trong các bản ghi mẫu WBS và Tasks
UPDATE work_items 
SET name = 'Thi công phần móng' 
WHERE code = 'WBS-01' OR (project_id = 1 AND (name LIKE '%ph%n m%ng%' OR name LIKE 'Thi c%ng%'));

UPDATE tasks 
SET name = 'Đào đất hố móng trụ T1' 
WHERE code = 'CV-01' OR (project_id = 1 AND (name LIKE '%o d%t h% m%ng%' OR name LIKE '%tr% T1%'));

UPDATE tasks 
SET name = 'Đổ bê tông lót móng' 
WHERE code = 'CV-02' OR (project_id = 1 AND (name LIKE '%b% t%ng l%t m%ng%' OR name LIKE '%l%t m%ng%'));
