USE quanly_thicong;

CREATE TABLE IF NOT EXISTS roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

INSERT IGNORE INTO roles (id, name) VALUES 
(1, 'Admin'), 
(2, 'Kỹ sư'), 
(3, 'Thầu phụ');

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role_id INT DEFAULT 2,
    failed_attempts INT DEFAULT 0,
    locked_until DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- Seed tài khoản mẫu: admin@thicong.vn / mật khẩu: 123456 (đã băm bằng bcrypt)
INSERT IGNORE INTO users (id, email, password, full_name, role_id) 
VALUES (1, 'admin@thicong.vn', '$2b$10$wT2Hl7J4b7h5I5x9M9L8xe6k3p5F6N3v3K9g0E7t2Z1y8x7w6v5u4', 'Nguyễn Đức Hiếu', 1);

-- Bảng projects (Quản lý dự án thi công)
CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO projects (id, name, code, description) VALUES
(1, 'Tòa nhà phức hợp Staging Center', 'DA-STAGING', 'Dự án thi công tòa nhà mẫu');

-- Bảng work_items (Cây cơ cấu công việc WBS - tự tham chiếu parent_id)
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

-- Bảng work_item_dependencies (Khai báo quan hệ phụ thuộc đủ 4 loại FS, SS, FF, SF và độ trễ [S-06])
CREATE TABLE IF NOT EXISTS work_item_dependencies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    predecessor_id INT NOT NULL,
    successor_id INT NOT NULL,
    dependency_type ENUM('FS', 'SS', 'FF', 'SF') NOT NULL DEFAULT 'FS',
    lag INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (predecessor_id) REFERENCES work_items(id) ON DELETE CASCADE,
    FOREIGN KEY (successor_id) REFERENCES work_items(id) ON DELETE CASCADE,
    UNIQUE KEY unique_predecessor_successor (predecessor_id, successor_id),
    CONSTRAINT chk_no_self_dependency CHECK (predecessor_id <> successor_id)
);

