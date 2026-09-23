USE quanly_thicong;

-- 1. Bảng projects (Quản lý dự án thi công)
CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bảng work_items (Cây cơ cấu công việc WBS - tự tham chiếu parent_id)
CREATE TABLE IF NOT EXISTS work_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    parent_id INT NULL,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NULL,
    unit VARCHAR(50) NULL,
    quantity DECIMAL(12,2) DEFAULT 0,
    status ENUM('pending', 'in_progress', 'completed') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES work_items(id) ON DELETE RESTRICT
);
