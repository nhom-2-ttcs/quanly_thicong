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
