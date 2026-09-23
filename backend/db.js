const mysql = require('mysql2');
require('dotenv').config();
const { SEED_ROLES, findUserByEmail } = require('./src/models/store');

let pool = null;

try {
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'db',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'secret',
    database: process.env.DB_NAME || 'quanly_thicong',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  }).promise();
} catch (err) {
  console.warn('[DB] Không thể tạo MySQL pool, sẽ sử dụng in-memory store:', err.message);
}

// Hàm khởi tạo bảng và seed 6 vai trò khi kết nối MySQL thành công (SCRUM-29 / T-04)
async function initDbSchema() {
  if (!pool) return;
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

    // Seed 6 vai trò
    for (const r of SEED_ROLES) {
      await pool.query(`
        INSERT INTO roles (id, name, display_name, description)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description);
      `, [r.id, r.name, r.display_name, r.description]);
    }
    console.log('[DB] Đã seed 6 vai trò thi công xây dựng thành công (SCRUM-29)!');

    // Seed tài khoản admin và người dùng mẫu
    const { inMemoryUsers } = require('./src/models/store');
    for (const u of inMemoryUsers) {
      await pool.query(`
        INSERT INTO users (id, email, password_hash, salt, full_name, role_id)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role_id = VALUES(role_id);
      `, [u.id, u.email, u.password_hash, u.salt, u.full_name, u.role_id]);
    }

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
    console.log(`[DB] Đã đồng bộ ${inMemoryUsers.length} tài khoản người dùng sẵn sàng.`);
  } catch (err) {
    console.warn('[DB] Lưu ý khi tạo schema MySQL:', err.message);
  }
}

module.exports = {
  pool,
  initDbSchema
};
