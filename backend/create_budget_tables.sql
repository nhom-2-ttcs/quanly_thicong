
-- 1. Bảng quản lý phiên bản dự toán (T-110)
CREATE TABLE IF NOT EXISTS project_budget_versions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    version_number INT NOT NULL DEFAULT 1,
    is_current BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_project_version (project_id, version_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Bảng lưu chi tiết dự toán cho từng hạng mục theo phiên bản (T-109, T-110)
CREATE TABLE IF NOT EXISTS budget_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version_id INT NOT NULL,
    wbs_id INT NOT NULL,
    budget_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_version_wbs (version_id, wbs_id),
    CONSTRAINT fk_budget_version FOREIGN KEY (version_id) REFERENCES project_budget_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
