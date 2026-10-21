-- S-47 (SCRUM-223): Ghi chi phí thực tế và quản lý khoản chờ phân bổ (T-111, T-112)
CREATE TABLE IF NOT EXISTS actual_expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    expense_date DATE NOT NULL,
    amount DECIMAL(18, 2) NOT NULL,
    expense_type VARCHAR(50) NOT NULL,
    work_item_id INT NULL,
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_expense_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_expense_work_item FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
