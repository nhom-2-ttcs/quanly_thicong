USE quanly_thicong;

-- Migration T-08: create project and WBS schema without dropping existing data.
CREATE TABLE IF NOT EXISTS projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS work_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  parent_id INT NULL,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NULL,
  unit VARCHAR(50) NULL,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('pending', 'in_progress', 'completed') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES work_items(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dependencies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  predecessor_task_id INT NOT NULL,
  successor_task_id INT NOT NULL,
  type ENUM('FS', 'SS', 'FF', 'SF') NOT NULL DEFAULT 'FS',
  lag DECIMAL(12,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (predecessor_task_id) REFERENCES work_items(id) ON DELETE CASCADE,
  FOREIGN KEY (successor_task_id) REFERENCES work_items(id) ON DELETE CASCADE,
  UNIQUE KEY uq_dependencies (predecessor_task_id, successor_task_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
