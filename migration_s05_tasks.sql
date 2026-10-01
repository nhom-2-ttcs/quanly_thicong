USE quanly_thicong;

-- 3. Bảng tasks: Công việc có thời lượng gắn vào hạng mục WBS (S-05 / SCRUM-60 / T-11)
CREATE TABLE IF NOT EXISTS tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    work_item_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NULL,
    duration DECIMAL(8,2) NOT NULL,
    status ENUM('pending', 'in_progress', 'completed') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tasks_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_tasks_work_item FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
