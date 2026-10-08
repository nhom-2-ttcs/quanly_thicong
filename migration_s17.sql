-- Migration S-17 (SCRUM-103 / T-38): Bảng calendars và holidays theo dự án
USE quanly_thicong;

-- 1. Bảng calendars lưu cấu hình lịch làm việc của từng dự án (mặc định 6 ngày/tuần: T2-T7, nghỉ CN)
CREATE TABLE IF NOT EXISTS calendars (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    work_days_per_week TINYINT NOT NULL DEFAULT 6,
    working_days_mask VARCHAR(50) NOT NULL DEFAULT '1,2,3,4,5,6',
    description VARCHAR(255) DEFAULT 'Lịch thi công công trường (Mặc định 6 ngày/tuần, nghỉ CN)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_project_calendar (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Bảng holidays lưu danh sách ngày nghỉ lễ theo dự án
CREATE TABLE IF NOT EXISTS holidays (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NULL,
    name VARCHAR(255) NOT NULL,
    holiday_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_project_holiday (project_id, holiday_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed lịch làm việc mặc định 6 ngày/tuần cho dự án mẫu (project_id = 1)
INSERT INTO calendars (project_id, work_days_per_week, working_days_mask, description)
VALUES (1, 6, '1,2,3,4,5,6', 'Lịch làm việc mặc định công trường 6 ngày/tuần, nghỉ Chủ Nhật')
ON DUPLICATE KEY UPDATE 
    work_days_per_week = VALUES(work_days_per_week),
    working_days_mask = VALUES(working_days_mask);

-- Seed một số ngày nghỉ lễ mẫu trong năm 2026 cho dự án 1
INSERT IGNORE INTO holidays (project_id, name, holiday_date) VALUES
(1, 'Tết Dương Lịch 2026', '2026-01-01'),
(1, 'Giỗ Tổ Hùng Vương 2026', '2026-04-26'),
(1, 'Kỷ niệm Ngày Chiến thắng', '2026-04-30'),
(1, 'Ngày Quốc tế Lao động', '2026-05-01'),
(1, 'Quốc Khánh 2026', '2026-09-02');
