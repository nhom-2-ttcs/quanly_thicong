let mysql = null;
try {
  mysql = require('mysql2');
} catch (e) {
  // Khi chạy môi trường test độc lập chưa cài mysql2, sử dụng fallback in-memory
}
require('dotenv').config();
const { SEED_ROLES, findUserByEmail } = require('./src/models/store');

let rawPool = null;
let isConnected = false;

const isDockerOrCi = Boolean(
  (process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1') ||
  process.env.CI ||
  process.env.NODE_ENV === 'production'
);

if (mysql) {
  try {
    rawPool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'secret',
      database: process.env.DB_NAME || 'quanly_thicong',
      charset: "utf8mb4",
      waitForConnections: isDockerOrCi,
      connectTimeout: isDockerOrCi ? 10000 : 1200,
      connectionLimit: 10,
      queueLimit: 0
    }).promise();
  } catch (err) {
    console.warn('[DB] Không thể tạo MySQL pool, sẽ sử dụng in-memory store:', err.message);
  }
}

// Safe pool wrapper: Tuyệt đối không chờ socket timeout nếu DB offline (phản hồi trong 0ms)
const safePool = {
  get isConnected() { return isConnected; },
  query: async (...args) => {
    if (!isConnected || !rawPool) {
      const err = new Error('DB_OFFLINE');
      err.code = 'DB_OFFLINE';
      throw err;
    }
    return rawPool.query(...args);
  },
  getConnection: async () => {
    if (!isConnected || !rawPool) {
      const err = new Error('DB_OFFLINE');
      err.code = 'DB_OFFLINE';
      throw err;
    }
    return rawPool.getConnection();
  }
};

// Hàm khởi tạo bảng và seed vai trò khi kết nối MySQL thành công (SCRUM-29 / T-04)
async function initDbSchema(maxRetries = (isDockerOrCi ? 25 : 1), delayMs = (isDockerOrCi ? 1500 : 500)) {
  if (!rawPool) {
    isConnected = false;
    console.log('[DB] ⚡ Standalone Mode: Kích hoạt Fast In-Memory Store (Tốc độ phản hồi 0.1ms)!');
    return;
  }
  
  let connected = false;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (isDockerOrCi) {
        await rawPool.query('SELECT 1');
      } else {
        await Promise.race([
          rawPool.query('SELECT 1'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Connect timeout 8000ms')), 8000))
        ]);
      }
      connected = true;
      isConnected = true;
      console.log(`[DB] ✅ Đã kết nối thành công CSDL MySQL (lần thử ${attempt})!`);
      break;
    } catch (err) {
      if (attempt < maxRetries && isDockerOrCi) {
        console.log(`[DB] Đang đợi MySQL sẵn sàng (lần ${attempt}/${maxRetries}): ${err.message}. Thử lại sau ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  if (!connected) {
    isConnected = false;
    console.log('[DB] ⚡ MySQL không hoạt động (Standalone Mode). Kích hoạt Fast In-Memory Engine (Tốc độ phản hồi cực nhanh 0.1ms)!');
    return;
  }

  const pool = rawPool;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // 1. Tạo bảng roles
    await pool.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. Tạo bảng users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        salt VARCHAR(64) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role_id INT,
        failed_login_attempts INT DEFAULT 0,
        locked_until DATETIME NULL,
        is_active BOOLEAN DEFAULT TRUE,
        last_login_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3. Tạo bảng projects (Quản lý dự án thi công)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed dự án mặc định (id = 1)
    await pool.query(`
      INSERT INTO projects (id, name, code, description)
      VALUES (1, 'Dự án Thi Công Mẫu', 'DA-01', 'Dự án mẫu quản trị tiến độ thi công')
      ON DUPLICATE KEY UPDATE name = VALUES(name);
    `);

    // 4. Tạo bảng work_items (Cơ cấu công việc WBS)
    await pool.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed hạng mục WBS mẫu (id = 1)
    await pool.query(`
      INSERT INTO work_items (id, project_id, name, code, unit, quantity, status)
      VALUES (1, 1, 'Thi công phần móng', 'WBS-01', 'Gói', 1, 'in_progress')
      ON DUPLICATE KEY UPDATE name = VALUES(name);
    `);

    // 5. Tạo bảng tasks (S-05 / SCRUM-60 / T-11 & S-15 / SCRUM-88 / T-34: Tiến độ thực tế tách kế hoạch)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        work_item_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) NULL,
        duration INT NOT NULL,
        actual_start DATE NULL,
        actual_end DATE NULL,
        percent_complete DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
        status ENUM('pending', 'in_progress', 'completed') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_tasks_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        CONSTRAINT fk_tasks_work_item FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT,
        CONSTRAINT chk_task_duration_positive CHECK (duration > 0),
        CONSTRAINT chk_task_percent_complete CHECK (percent_complete >= 0.00 AND percent_complete <= 100.00)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // S-15 / SCRUM-99 (T-34): Đảm bảo các cột tiến độ thực tế tồn tại nếu bảng đã tạo từ trước
    try {
      const [taskCols] = await pool.query(`
        SELECT COLUMN_NAME 
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME IN ('actual_start', 'actual_end', 'percent_complete')
      `);
      const existingColNames = (taskCols || []).map(c => c.COLUMN_NAME.toLowerCase());
      if (!existingColNames.includes('actual_start')) {
        await pool.query('ALTER TABLE tasks ADD COLUMN actual_start DATE NULL AFTER duration');
      }
      if (!existingColNames.includes('actual_end')) {
        await pool.query('ALTER TABLE tasks ADD COLUMN actual_end DATE NULL AFTER actual_start');
      }
      if (!existingColNames.includes('percent_complete')) {
        await pool.query('ALTER TABLE tasks ADD COLUMN percent_complete DECIMAL(5, 2) NOT NULL DEFAULT 0.00 AFTER actual_end');
      }
    } catch (migErr) {
      console.warn('[DB] Lưu ý khi kiểm tra cột tiến độ thực tế bảng tasks:', migErr.message);
    }

    // Seed các công việc mẫu (task 1: CV-01, task 2: CV-02)
    await pool.query(`
      INSERT INTO tasks (id, project_id, work_item_id, name, code, duration, actual_start, actual_end, percent_complete, status)
      VALUES
        (1, 1, 1, 'Đào đất hố móng trụ T1', 'CV-01', 5, NULL, NULL, 0.00, 'pending'),
        (2, 1, 1, 'Đổ bê tông lót móng', 'CV-02', 3, NULL, NULL, 0.00, 'pending')
      ON DUPLICATE KEY UPDATE name = VALUES(name);
    `);

    // 6. Tạo bảng project_members (Phân quyền người xem / thành viên dự án)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_members (
        project_id INT NOT NULL,
        user_id INT NOT NULL,
        role_id INT NOT NULL DEFAULT 4,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (project_id, user_id),
        CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        CONSTRAINT fk_pm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    try {
      const [pmCols] = await pool.query(`
        SELECT COLUMN_NAME 
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_members' AND COLUMN_NAME = 'role_id'
      `);
      if (!pmCols || pmCols.length === 0) {
        await pool.query('ALTER TABLE project_members ADD COLUMN role_id INT NOT NULL DEFAULT 4 AFTER user_id');
      }
    } catch (migErr) {}

    // Bảng project_invitations (S-28 / SCRUM-120: Lời mời tham gia dự án)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_invitations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        email VARCHAR(255) NOT NULL,
        role_id INT NOT NULL DEFAULT 4,
        invited_by INT NULL,
        status ENUM('pending', 'accepted', 'revoked') NOT NULL DEFAULT 'pending',
        token VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES roles(id),
        FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_inv_project (project_id),
        INDEX idx_inv_email (email),
        INDEX idx_inv_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 7. Tạo bảng task_dependencies (S-06 / SCRUM-61: Quan hệ phụ thuộc công việc FS, SS, FF, SF và lag)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        predecessor_task_id INT NOT NULL,
        successor_task_id INT NOT NULL,
        dependency_type ENUM('FS', 'SS', 'FF', 'SF') NOT NULL DEFAULT 'FS',
        lag_days DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (predecessor_task_id) REFERENCES tasks(id) ON DELETE RESTRICT,
        FOREIGN KEY (successor_task_id) REFERENCES tasks(id) ON DELETE RESTRICT,
        UNIQUE KEY unique_dependency_pair (predecessor_task_id, successor_task_id),
        INDEX idx_deps_project (project_id),
        INDEX idx_deps_pred (predecessor_task_id),
        INDEX idx_deps_succ (successor_task_id),
        CONSTRAINT chk_no_self_loop CHECK (predecessor_task_id <> successor_task_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 8. Tạo bảng schedule_results & project_schedule_status (S-12 / SCRUM-67: Bảng tiến độ và việc găng)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        task_id INT NOT NULL,
        early_start DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
        early_finish DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
        late_start DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
        late_finish DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
        total_float DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
        is_critical BOOLEAN NOT NULL DEFAULT FALSE,
        is_stale BOOLEAN NOT NULL DEFAULT FALSE,
        calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_project_task (project_id, task_id),
        INDEX idx_sr_project_es (project_id, early_start, task_id),
        INDEX idx_sr_project_crit (project_id, is_critical),
        INDEX idx_sr_task (task_id),
        CONSTRAINT fk_sr_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        CONSTRAINT fk_sr_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_schedule_status (
        project_id INT PRIMARY KEY,
        needs_recalculation BOOLEAN NOT NULL DEFAULT TRUE,
        project_duration DECIMAL(8, 2) NULL,
        calculated_at TIMESTAMP NULL,
        has_cycle BOOLEAN NOT NULL DEFAULT FALSE,
        cycle_info TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_pss_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 9. Bảng lưu trữ kế hoạch gốc và lịch sử chốt (S-18 / SCRUM-91)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS baseline_schedules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        version INT NOT NULL DEFAULT 1,
        is_current BOOLEAN NOT NULL DEFAULT TRUE,
        project_duration DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
        created_by INT NULL,
        created_by_name VARCHAR(100) NOT NULL DEFAULT 'Ban Quản Lý',
        reason VARCHAR(255) NULL DEFAULT 'Khởi công chốt kế hoạch gốc',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_bs_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        INDEX idx_bs_project_curr (project_id, is_current),
        INDEX idx_bs_project_ver (project_id, version)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS baseline_tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        baseline_schedule_id INT NOT NULL,
        project_id INT NOT NULL,
        task_id INT NOT NULL,
        task_code VARCHAR(50) NULL,
        task_name VARCHAR(255) NOT NULL,
        duration INT NOT NULL DEFAULT 1,
        early_start DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
        early_finish DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
        late_start DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
        late_finish DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
        total_float DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
        is_critical BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_bt_baseline FOREIGN KEY (baseline_schedule_id) REFERENCES baseline_schedules(id) ON DELETE CASCADE,
        CONSTRAINT fk_bt_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        INDEX idx_bt_base_task (baseline_schedule_id, task_id),
        INDEX idx_bt_project (project_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS baseline_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        baseline_schedule_id INT NOT NULL,
        version INT NOT NULL DEFAULT 1,
        action ENUM('create_initial', 'update_overwrite') NOT NULL DEFAULT 'create_initial',
        created_by INT NULL,
        created_by_name VARCHAR(100) NOT NULL DEFAULT 'Ban Quản Lý',
        task_count INT NOT NULL DEFAULT 0,
        project_duration DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
        reason VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_bh_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        CONSTRAINT fk_bh_baseline FOREIGN KEY (baseline_schedule_id) REFERENCES baseline_schedules(id) ON DELETE CASCADE,
        INDEX idx_bh_project (project_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);


    // Seed 7 vai trò thi công xây dựng
    for (const r of SEED_ROLES) {
      await pool.query(`
        INSERT INTO roles (id, name, display_name, description)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);
      `, [r.id, r.name, r.display_name, r.description]);
    }
    console.log('[DB] Đã seed 7 vai trò thi công xây dựng thành công (SCRUM-29 & Sprint 2)!');

    // Seed tài khoản admin, PM và Người xem dự án mẫu
    const { inMemoryUsers } = require('./src/models/store');
    for (const u of inMemoryUsers) {
      await pool.query(`
        INSERT INTO users (id, email, password_hash, salt, full_name, role_id)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role_id = VALUES(role_id);
      `, [u.id, u.email, u.password_hash, u.salt, u.full_name, u.role_id]);
    }

    // Gán quyền thành viên dự án mẫu 1 cho Admin (1), PM (2), Viewer (3)
    await pool.query(`
      INSERT INTO project_members (project_id, user_id, role_id)
      VALUES (1, 1, 1), (1, 2, 2), (1, 3, 7)
      ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);
    `);

    // Sửa triệt để lỗi font/mojibake dữ liệu mẫu WBS và tasks theo cách idempotent
    await pool.query(`
      UPDATE work_items
      SET name = 'Thi công phần móng'
      WHERE code = 'WBS-01' OR (project_id = 1 AND (name LIKE '%ph%n m%ng%' OR name LIKE 'Thi c%ng%'));
    `);
    await pool.query(`
      UPDATE tasks
      SET name = 'Đào đất hố móng trụ T1'
      WHERE code = 'CV-01' OR (project_id = 1 AND (name LIKE '%o d%t h% m%ng%' OR name LIKE '%tr% T1%'));
    `);
    await pool.query(`
      UPDATE tasks
      SET name = 'Đổ bê tông lót móng'
      WHERE code = 'CV-02' OR (project_id = 1 AND (name LIKE '%b% t%ng l%t m%ng%' OR name LIKE '%l%t m%ng%'));
    `);

    // Seed quan hệ phụ thuộc mẫu: CV-01 -> CV-02, Loại FS, lag 0
    await pool.query(`
      INSERT IGNORE INTO task_dependencies (project_id, predecessor_task_id, successor_task_id, dependency_type, lag_days)
      SELECT 1, 1, 2, 'FS', 0.00
      FROM DUAL
      WHERE EXISTS (SELECT 1 FROM tasks WHERE id = 1)
        AND EXISTS (SELECT 1 FROM tasks WHERE id = 2)
        AND NOT EXISTS (
          SELECT 1 FROM task_dependencies WHERE predecessor_task_id = 1 AND successor_task_id = 2
        );
    `);

    // Đồng bộ người dùng đã đăng ký từ MySQL vào bộ nhớ
    const [rows] = await pool.query(`
      SELECT u.id, u.email, u.password_hash, u.salt, u.full_name, u.role_id, r.name as role_name, r.display_name as role_display_name
      FROM users u LEFT JOIN roles r ON u.role_id = r.id
    `);
    if (rows && rows.length > 0) {
      for (const row of rows) {
        if (!inMemoryUsers.some(im => im.email.toLowerCase() === row.email.toLowerCase())) {
          inMemoryUsers.push({
            id: row.id,
            email: row.email.toLowerCase(),
            password_hash: row.password_hash,
            salt: row.salt,
            full_name: row.full_name,
            role_id: row.role_id,
            role_name: row.role_name,
            role_display_name: row.role_display_name,
            failed_login_attempts: 0,
            locked_until: null,
            is_active: true
          });
        }
      }
    }
    // 3. Tạo bảng calendars và holidays (S-17 / SCRUM-103 / T-38)
    await pool.query(`
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
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS holidays (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NULL,
        name VARCHAR(255) NOT NULL,
        holiday_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_project_holiday (project_id, holiday_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed lịch làm việc mặc định 6 ngày/tuần cho dự án 1
    await pool.query(`
      INSERT INTO calendars (project_id, work_days_per_week, working_days_mask, description)
      VALUES (1, 6, '1,2,3,4,5,6', 'Lịch làm việc mặc định công trường 6 ngày/tuần, nghỉ Chủ Nhật')
      ON DUPLICATE KEY UPDATE work_days_per_week = VALUES(work_days_per_week), working_days_mask = VALUES(working_days_mask);
    `);
    console.log('[DB] Đã khởi tạo bảng calendars & holidays (S-17 / T-38) thành công!');

    // 9. Tạo bảng milestones (TASK T-43)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS milestones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        work_item_id INT NOT NULL,
        due_date DATE NOT NULL,
        title VARCHAR(255) NULL,
        created_by INT NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 10. Tạo bảng milestone_alerts (TASK T-44: Cảnh báo vượt mốc tiến độ)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS milestone_alerts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        milestone_id INT NOT NULL,
        work_item_id INT NOT NULL,
        due_date DATE NOT NULL,
        max_early_finish DECIMAL(8, 2) NOT NULL,
        overdue_days INT NOT NULL,
        status ENUM('active', 'closed') NOT NULL DEFAULT 'active',
        opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE CASCADE,
        FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
        INDEX idx_ma_project_status (project_id, status),
        INDEX idx_ma_milestone (milestone_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 11. Tạo bảng site_diaries & site_diary_items (TASK T50 & T51 - S-22: Nhật ký công trường & Ngày mưa)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS site_diaries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        diary_date DATE NOT NULL,
        weather_condition ENUM('sunny', 'cloudy', 'rain_intermittent', 'rain_all_day') NOT NULL DEFAULT 'sunny',
        is_rain_day TINYINT(1) NOT NULL DEFAULT 0,
        temperature_min DECIMAL(4, 1) NULL,
        temperature_max DECIMAL(4, 1) NULL,
        weather_notes VARCHAR(255) NULL,
        manpower_count INT NOT NULL DEFAULT 0,
        equipment_status TEXT NULL,
        work_notes TEXT NULL,
        is_locked TINYINT(1) NOT NULL DEFAULT 0,
        locked_at DATETIME NULL,
        locked_by INT NULL,
        created_by INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_project_diary_date (project_id, diary_date),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_diary_project_date (project_id, diary_date),
        INDEX idx_diary_rain (project_id, is_rain_day)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS site_diary_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        diary_id INT NOT NULL,
        work_item_id INT NULL,
        work_content TEXT NOT NULL,
        log_time VARCHAR(10) NULL,
        quantity_done DECIMAL(12, 2) DEFAULT 0,
        unit VARCHAR(50) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (diary_id) REFERENCES site_diaries(id) ON DELETE CASCADE,
        FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
        INDEX idx_item_diary (diary_id),
        INDEX idx_diary_item_work_item (work_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migration S-21: Bổ sung trường log_time và chỉ mục nếu bảng đã tồn tại từ trước
    try {
      await pool.query('ALTER TABLE site_diary_items ADD COLUMN IF NOT EXISTS log_time VARCHAR(10) NULL AFTER work_content');
      await pool.query('ALTER TABLE site_diary_items ADD INDEX IF NOT EXISTS idx_diary_item_work_item (work_item_id)');
    } catch (_) {}


    // 12. Tạo bảng site_diary_photos (TASK T52 / S-23 & S-33: Ảnh đính kèm & Hàng đợi tải nền)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS site_diary_photos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        diary_id INT NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_size INT NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        caption VARCHAR(255) NULL,
        upload_status ENUM('pending', 'uploading', 'completed', 'failed') NOT NULL DEFAULT 'completed',
        client_photo_id VARCHAR(100) NULL,
        temp_path VARCHAR(500) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (diary_id) REFERENCES site_diaries(id) ON DELETE CASCADE,
        INDEX idx_photo_diary (diary_id),
        INDEX idx_photo_client_id (client_photo_id),
        INDEX idx_photo_upload_status (upload_status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // S-33 / T-60 & S-30: Bổ sung các cột cho hàng đợi tải ảnh nền và ràng buộc unique idempotency
    try {
      await pool.query(`
        ALTER TABLE site_diary_photos
        ADD COLUMN IF NOT EXISTS upload_status ENUM('pending', 'uploading', 'completed', 'failed') NOT NULL DEFAULT 'completed' AFTER caption,
        ADD COLUMN IF NOT EXISTS client_photo_id VARCHAR(100) NULL AFTER upload_status,
        ADD COLUMN IF NOT EXISTS temp_path VARCHAR(500) NULL AFTER client_photo_id;
      `);
      // Thêm UNIQUE index cho client_photo_id (S-30)
      const [pIndexes] = await pool.query(`SHOW INDEX FROM site_diary_photos WHERE Key_name = 'uq_photo_client_id'`);
      if (!pIndexes || pIndexes.length === 0) {
        await pool.query('ALTER TABLE site_diary_photos ADD UNIQUE KEY uq_photo_client_id (client_photo_id)');
      }
    } catch (_) {}

    // S-30 & S-32: Bổ sung client_diary_id, version vào site_diaries
    try {
      await pool.query(`
        ALTER TABLE site_diaries
        ADD COLUMN IF NOT EXISTS client_diary_id VARCHAR(64) NULL AFTER project_id,
        ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1 AFTER is_locked;
      `);
      const [dIndexes] = await pool.query(`SHOW INDEX FROM site_diaries WHERE Key_name = 'uq_diary_client_id'`);
      if (!dIndexes || dIndexes.length === 0) {
        await pool.query('ALTER TABLE site_diaries ADD UNIQUE KEY uq_diary_client_id (client_diary_id)');
      }
    } catch (_) {}

    // S-30 & S-32: Bổ sung client_item_id, version vào site_diary_items
    try {
      await pool.query(`
        ALTER TABLE site_diary_items
        ADD COLUMN IF NOT EXISTS client_item_id VARCHAR(64) NULL AFTER diary_id,
        ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1 AFTER quantity_done;
      `);
      const [iIndexes] = await pool.query(`SHOW INDEX FROM site_diary_items WHERE Key_name = 'uq_item_client_id'`);
      if (!iIndexes || iIndexes.length === 0) {
        await pool.query('ALTER TABLE site_diary_items ADD UNIQUE KEY uq_item_client_id (client_item_id)');
      }
    } catch (_) {}

    // S-24: Bảng audit_logs phục vụ kiểm toán mở khóa sổ nhật ký
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        action VARCHAR(50) NOT NULL,
        resource_type VARCHAR(50) NOT NULL,
        resource_id VARCHAR(100) NOT NULL,
        reason TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_user (user_id),
        INDEX idx_audit_resource (resource_type, resource_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // S-26: Bảng team_daily_progress (Báo cáo khối lượng hằng ngày của đội thi công)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS team_daily_progress (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        task_id INT NOT NULL,
        team_id INT NOT NULL,
        report_date DATE NOT NULL,
        reported_quantity DECIMAL(12, 2) NOT NULL,
        notes TEXT NULL,
        created_by INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (team_id) REFERENCES project_teams(id) ON DELETE CASCADE,
        INDEX idx_tdp_task (task_id),
        INDEX idx_tdp_team (team_id),
        INDEX idx_tdp_date (report_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // S-32: Bảng diary_conflicts (Lưu vết xung đột phiên bản và giữ cả hai bản)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS diary_conflicts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        entity_type ENUM('diary', 'diary_item') NOT NULL,
        entity_id INT NOT NULL,
        server_version INT NOT NULL,
        client_version INT NOT NULL,
        server_data JSON NOT NULL,
        client_data JSON NOT NULL,
        conflict_fields JSON NOT NULL,
        auto_merged TINYINT(1) NOT NULL DEFAULT 0,
        merged_data JSON NULL,
        status ENUM('pending', 'resolved_server', 'resolved_client', 'resolved_merged') NOT NULL DEFAULT 'pending',
        resolved_by INT NULL,
        resolved_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        INDEX idx_conflict_entity (entity_type, entity_id),
        INDEX idx_conflict_status (project_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 13. Tạo bảng project_teams & task_assignments (S-25 / SCRUM-125 / T-50: Đội thi công & Giao việc)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_teams (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) NULL,
        leader_id INT NULL,
        leader_name VARCHAR(100) NULL,
        phone VARCHAR(20) NULL,
        specialty VARCHAR(100) NULL,
        member_count INT NOT NULL DEFAULT 10,
        max_parallel_tasks INT NOT NULL DEFAULT 3,
        status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (leader_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_teams_project (project_id),
        INDEX idx_teams_leader (leader_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Kiểm tra & thêm các cột giao việc vào bảng tasks nếu chưa có
    try {
      const [taskCols] = await pool.query(`
        SELECT COLUMN_NAME 
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME IN ('team_id', 'assigned_by', 'assigned_at', 'assignment_note')
      `);
      const existingCols = (taskCols || []).map(c => c.COLUMN_NAME.toLowerCase());
      if (!existingCols.includes('team_id')) {
        await pool.query('ALTER TABLE tasks ADD COLUMN team_id INT NULL AFTER percent_complete');
      }
      if (!existingCols.includes('assigned_by')) {
        await pool.query('ALTER TABLE tasks ADD COLUMN assigned_by INT NULL AFTER team_id');
      }
      if (!existingCols.includes('assigned_at')) {
        await pool.query('ALTER TABLE tasks ADD COLUMN assigned_at DATETIME NULL AFTER assigned_by');
      }
      if (!existingCols.includes('assignment_note')) {
        await pool.query('ALTER TABLE tasks ADD COLUMN assignment_note VARCHAR(255) NULL AFTER assigned_at');
      }
    } catch (teamColErr) {
      console.warn('[DB] Lưu ý khi kiểm tra cột giao việc bảng tasks:', teamColErr.message);
    }

    // Bảng task_assignments (Lịch sử và nhật ký giao việc)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS task_assignments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        task_id INT NOT NULL,
        team_id INT NOT NULL,
        assigned_by INT NULL,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        note TEXT NULL,
        status ENUM('assigned', 'reassigned', 'unassigned') DEFAULT 'assigned',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (team_id) REFERENCES project_teams(id) ON DELETE CASCADE,
        INDEX idx_ta_project (project_id),
        INDEX idx_ta_task (task_id),
        INDEX idx_ta_team (team_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed 3 đội thi công mẫu cho Dự án 1
    await pool.query(`
      INSERT INTO project_teams (id, project_id, name, code, leader_name, phone, specialty, member_count, max_parallel_tasks, status)
      VALUES
        (1, 1, 'Đội Cốp Pha & Bê Tông Móng', 'DOI-01', 'Nguyễn Văn Đội 1', '0912345678', 'Bê tông - Cốp pha', 15, 3, 'active'),
        (2, 1, 'Đội Gia Công & Lắp Dựng Cốt Thép', 'DOI-02', 'Trần Văn Cương', '0987654321', 'Cốt thép kết cấu', 12, 2, 'active'),
        (3, 1, 'Đội Xây Tô Hoàn Thiện & Điện Nước', 'DOI-03', 'Lê Văn Thợ', '0905123456', 'Xây trát - Cơ điện M&E', 10, 2, 'active')
      ON DUPLICATE KEY UPDATE name = VALUES(name), leader_name = VALUES(leader_name), max_parallel_tasks = VALUES(max_parallel_tasks);
    `);

    // Cập nhật gán việc mẫu
    await pool.query(`
      UPDATE tasks SET team_id = 1, assigned_by = 2, assigned_at = '2026-10-01 08:00:00' WHERE id = 1 AND project_id = 1 AND (team_id IS NULL OR team_id = 1);
    `);
    await pool.query(`
      UPDATE tasks SET team_id = 1, assigned_by = 2, assigned_at = '2026-10-04 08:00:00' WHERE id = 2 AND project_id = 1 AND (team_id IS NULL OR team_id = 1);
    `);

    console.log(`[DB] Đã đồng bộ ${inMemoryUsers.length} tài khoản người dùng, schema calendars (S-17), milestones (T-43), alerts (T-44), site_diaries (T-50/51), photos (T-52) và project_teams (S-25/T-50) sẵn sàng.`);
    return;
  } catch (err) {
    if (attempt < maxRetries) {
      console.warn(`[DB] Đang đợi MySQL sẵn sàng (lần ${attempt}/${maxRetries}): ${err.message}. Thử lại sau ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    } else {
      console.warn('[DB] Lưu ý khi tạo schema MySQL:', err.message);
    }
  }
}
}

module.exports = {
  pool: safePool,
  get isConnected() { return isConnected; },
  initDbSchema
};
