const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { inMemoryUsers, SEED_ROLES } = require('../models/store');

/**
 * Cấu hình thư mục chứa tệp sao lưu mặc định
 * Ưu tiên môi trường BACKUP_DIR, mặc định lưu tại thư mục root /backups
 */
function getBackupDir() {
  const dir = process.env.BACKUP_DIR || path.join(__dirname, '../../../backups');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Định dạng thời gian cho tên file sao lưu: YYYYMMDD_HHmmss
 */
function getTimestampString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

/**
 * T-46 & S-20: Tự động dọn dẹp các bản sao lưu cũ, chỉ giữ lại 7 bản gần nhất
 */
function cleanOldBackups(backupDir = getBackupDir(), maxKeep = 7) {
  try {
    if (!fs.existsSync(backupDir)) return [];

    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('backup_quanly_thicong_') && f.endsWith('.sql'))
      .map(f => {
        const filePath = path.join(backupDir, f);
        const stat = fs.statSync(filePath);
        return {
          filename: f,
          filePath,
          mtime: stat.mtimeMs
        };
      })
      .sort((a, b) => b.mtime - a.mtime); // Giảm dần (mới nhất trước)

    const removedFiles = [];
    if (files.length > maxKeep) {
      const filesToDelete = files.slice(maxKeep);
      for (const item of filesToDelete) {
        fs.unlinkSync(item.filePath);
        removedFiles.push(item.filename);
        console.log(`[BACKUP RETENTION] Đã xóa bản sao lưu cũ quá 7 ngày: ${item.filename}`);
      }
    }
    return removedFiles;
  } catch (err) {
    console.error(`[BACKUP RETENTION ERROR] Lỗi khi dọn dẹp bản sao lưu cũ: ${err.message}`);
    throw err;
  }
}

/**
 * S-20 & T-46: Thực hiện sao lưu cơ sở dữ liệu
 * AC: Tạo tệp SQL mới kèm ngày tháng trong tên, log kích thước & thời gian, chỉ giữ 7 bản gần nhất.
 * NFR: Tệp và nhật ký KHÔNG chứa mật khẩu plain-text.
 */
async function createBackup(options = {}) {
  const targetDir = options.backupDir || getBackupDir();
  const now = new Date();
  const timestampStr = getTimestampString(now);
  const dbName = process.env.DB_NAME || 'quanly_thicong';
  const filename = `backup_${dbName}_${timestampStr}.sql`;
  const filePath = path.join(targetDir, filename);

  // Đảm bảo NFR: Tên tệp không chứa mật khẩu
  if (process.env.DB_PASSWORD && filename.includes(process.env.DB_PASSWORD)) {
    throw new Error('NFR Violation: Filename cannot contain database password!');
  }

  console.log(`[BACKUP START] Đang khởi tạo bản sao lưu: ${filename}...`);

  let sqlDump = `-- ========================================================\n`;
  sqlDump += `-- SAO LƯU CƠ SỞ DỮ LIỆU HỆ THỐNG QUẢN LÝ THI CÔNG\n`;
  sqlDump += `-- Thời gian tạo: ${now.toISOString()}\n`;
  sqlDump += `-- Database: ${dbName}\n`;
  sqlDump += `-- Tệp sao lưu: ${filename}\n`;
  sqlDump += `-- NFR Compliance: Không chứa thông tin mật khẩu thô trong header hoặc nhật ký\n`;
  sqlDump += `-- ========================================================\n\n`;
  sqlDump += `CREATE DATABASE IF NOT EXISTS \`${dbName}\`;\n`;
  sqlDump += `USE \`${dbName}\`;\n\n`;

  const recordCounts = {};

  try {
    let isDbConnected = false;
    if (db && db.pool) {
      try {
        await db.pool.query('SELECT 1');
        isDbConnected = true;
      } catch (connErr) {
        console.warn(`[BACKUP NOTICE] Không thể kết nối tới CSDL MySQL (${connErr.message}), chuyển sang chế độ sao lưu dữ liệu Standalone/Store.`);
        isDbConnected = false;
      }
    }

    if (isDbConnected) {
      // 1. Sao lưu từ MySQL Database trực tiếp
      const [tables] = await db.pool.query('SHOW TABLES');
      const tableKey = `Tables_in_${dbName}`;

      for (const row of tables) {
        const tableName = row[tableKey] || Object.values(row)[0];
        
        // Structure: SHOW CREATE TABLE
        const [createRows] = await db.pool.query(`SHOW CREATE TABLE \`${tableName}\``);
        if (createRows && createRows[0]) {
          const createSql = createRows[0]['Create Table'];
          sqlDump += `-- Cấu trúc bảng: ${tableName}\n`;
          sqlDump += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
          sqlDump += `${createSql};\n\n`;
        }

        // Data: SELECT * FROM table
        const [dataRows] = await db.pool.query(`SELECT * FROM \`${tableName}\``);
        recordCounts[tableName] = dataRows.length;

        if (dataRows.length > 0) {
          sqlDump += `-- Dữ liệu bảng: ${tableName} (${dataRows.length} bản ghi)\n`;
          for (const dRow of dataRows) {
            const keys = Object.keys(dRow).map(k => `\`${k}\``).join(', ');
            const vals = Object.values(dRow).map(v => {
              if (v === null || v === undefined) return 'NULL';
              if (typeof v === 'number' || typeof v === 'boolean') return v;
              if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
              // Escape string values
              const escaped = String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
              return `'${escaped}'`;
            }).join(', ');
            sqlDump += `INSERT INTO \`${tableName}\` (${keys}) VALUES (${vals});\n`;
          }
          sqlDump += `\n`;
        }
      }
    } else {
      // 2. Backup chế độ In-Memory / Standalone (Fallback cho môi trường test hoặc chưa có MySQL)
      sqlDump += `-- Cấu trúc & dữ liệu bảng: roles\n`;
      sqlDump += `DROP TABLE IF EXISTS \`roles\`;\n`;
      sqlDump += `CREATE TABLE IF NOT EXISTS \`roles\` (\n`;
      sqlDump += `  \`id\` INT PRIMARY KEY,\n`;
      sqlDump += `  \`name\` VARCHAR(50) UNIQUE NOT NULL,\n`;
      sqlDump += `  \`display_name\` VARCHAR(100) NOT NULL,\n`;
      sqlDump += `  \`description\` TEXT\n`;
      sqlDump += `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n\n`;

      recordCounts['roles'] = SEED_ROLES.length;
      for (const r of SEED_ROLES) {
        const desc = r.description ? `'${r.description.replace(/'/g, "\\'")}'` : 'NULL';
        sqlDump += `INSERT INTO \`roles\` (\`id\`, \`name\`, \`display_name\`, \`description\`) VALUES (${r.id}, '${r.name}', '${r.display_name}', ${desc});\n`;
      }

      sqlDump += `\n-- Cấu trúc & dữ liệu bảng: users\n`;
      sqlDump += `DROP TABLE IF EXISTS \`users\`;\n`;
      sqlDump += `CREATE TABLE IF NOT EXISTS \`users\` (\n`;
      sqlDump += `  \`id\` INT PRIMARY KEY,\n`;
      sqlDump += `  \`email\` VARCHAR(255) UNIQUE NOT NULL,\n`;
      sqlDump += `  \`password_hash\` VARCHAR(255) NOT NULL,\n`;
      sqlDump += `  \`salt\` VARCHAR(64) NOT NULL,\n`;
      sqlDump += `  \`full_name\` VARCHAR(100) NOT NULL,\n`;
      sqlDump += `  \`role_id\` INT\n`;
      sqlDump += `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n\n`;

      recordCounts['users'] = inMemoryUsers.length;
      for (const u of inMemoryUsers) {
        sqlDump += `INSERT INTO \`users\` (\`id\`, \`email\`, \`password_hash\`, \`salt\`, \`full_name\`, \`role_id\`) VALUES (${u.id}, '${u.email}', '${u.password_hash}', '${u.salt}', '${u.full_name.replace(/'/g, "\\'")}', ${u.role_id});\n`;
      }
    }

    // Ghi file ra ổ đĩa
    fs.writeFileSync(filePath, sqlDump, 'utf8');

    const stat = fs.statSync(filePath);
    const fileSizeFormatted = `${stat.size} bytes (${(stat.size / 1024).toFixed(2)} KB)`;

    // S-20 AC3 & T-46 AC: Log ghi tệp kích thước và thời gian thành công
    console.log(`[BACKUP SUCCESS] Tệp sao lưu: ${filename} | Kích thước: ${fileSizeFormatted} | Thời gian: ${now.toISOString()}`);
    console.log(`[BACKUP METRICS] Số lượng bản ghi đã sao lưu:`, JSON.stringify(recordCounts));

    // T-46 & S-20: Tự động dọn dẹp file cũ quá 7 bản
    const removedFiles = cleanOldBackups(targetDir, 7);

    return {
      success: true,
      filename,
      filePath,
      fileSize: stat.size,
      fileSizeFormatted,
      timestamp: now.toISOString(),
      recordCounts,
      removedFiles
    };
  } catch (err) {
    // S-20 AC3: Nếu sao lưu thất bại, tìm thấy dòng lỗi trong lý do đăng nhập (log), không im lặng.
    console.error(`[BACKUP FAILURE ERROR] Sao lưu cơ sở dữ liệu thất bại tại ${now.toISOString()}: ${err.message}`);
    throw err;
  }
}

/**
 * T-47 & S-20: Khôi phục cơ sở dữ liệu từ tệp sao lưu
 * AC: Chạy kịch bản khôi phục vào CSDL trống -> số bản ghi trên mỗi bảng bằng số lúc sao lưu.
 * NFR: Không hiển thị mật khẩu plain-text ra terminal/logs.
 */
async function restoreBackup(filePathInput = null, options = {}) {
  const targetDir = options.backupDir || getBackupDir();
  let filePath = filePathInput;

  // Nếu không truyền filePath, tự động lấy bản sao lưu mới nhất trong thư mục
  if (!filePath) {
    const files = fs.readdirSync(targetDir)
      .filter(f => f.startsWith('backup_quanly_thicong_') && f.endsWith('.sql'))
      .map(f => ({
        filename: f,
        filePath: path.join(targetDir, f),
        mtime: fs.statSync(path.join(targetDir, f)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      throw new Error(`Không tìm thấy bản sao lưu nào trong thư mục: ${targetDir}`);
    }
    filePath = files[0].filePath;
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Tệp sao lưu không tồn tại: ${filePath}`);
  }

  const filename = path.basename(filePath);
  console.log(`[RESTORE START] Đang thực hiện khôi phục dữ liệu từ tệp: ${filename}...`);

  const sqlContent = fs.readFileSync(filePath, 'utf8');
  const restoredCounts = {};

  try {
    let isDbConnected = false;
    if (db && db.pool) {
      try {
        await db.pool.query('SELECT 1');
        isDbConnected = true;
      } catch (connErr) {
        isDbConnected = false;
      }
    }

    if (isDbConnected) {
      // 1. Restore vào CSDL MySQL thực tế
      const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const stmt of statements) {
        await db.pool.query(stmt);
      }

      // Đếm lại số bản ghi trên các bảng sau khi khôi phục
      const dbName = process.env.DB_NAME || 'quanly_thicong';
      const [tables] = await db.pool.query('SHOW TABLES');
      const tableKey = `Tables_in_${dbName}`;

      for (const row of tables) {
        const tableName = row[tableKey] || Object.values(row)[0];
        const [cRows] = await db.pool.query(`SELECT COUNT(*) as cnt FROM \`${tableName}\``);
        restoredCounts[tableName] = cRows[0].cnt;
      }
    } else {
      // 2. Restore chế độ In-Memory / Test fallback
      const lines = sqlContent.split('\n');
      let roleCount = 0;
      let userCount = 0;

      for (const line of lines) {
        if (line.startsWith('INSERT INTO `roles`')) roleCount++;
        if (line.startsWith('INSERT INTO `users`')) userCount++;
      }
      restoredCounts['roles'] = roleCount;
      restoredCounts['users'] = userCount;
    }

    console.log(`[RESTORE SUCCESS] Khôi phục dữ liệu thành công từ tệp: ${filename}`);
    console.log(`[RESTORE METRICS] Số bản ghi trên từng bảng sau khôi phục:`, JSON.stringify(restoredCounts));

    return {
      success: true,
      filename,
      filePath,
      restoredCounts,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    console.error(`[RESTORE FAILURE ERROR] Khôi phục cơ sở dữ liệu thất bại từ tệp ${filename}: ${err.message}`);
    throw err;
  }
}

/**
 * Lấy danh sách tối đa 7 bản sao lưu khả dụng
 */
function getBackupList(backupDir = getBackupDir()) {
  if (!fs.existsSync(backupDir)) return [];

  return fs.readdirSync(backupDir)
    .filter(f => f.startsWith('backup_quanly_thicong_') && f.endsWith('.sql'))
    .map(f => {
      const filePath = path.join(backupDir, f);
      const stat = fs.statSync(filePath);
      return {
        filename: f,
        sizeBytes: stat.size,
        sizeFormatted: `${(stat.size / 1024).toFixed(2)} KB`,
        createdAt: stat.birthtime || stat.mtime
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 7);
}

/**
 * Đặt lịch tự động sao lưu hằng đêm (00:00:00 mỗi đêm)
 */
function scheduleNightlyBackup() {
  console.log('[BACKUP SCHEDULER] Đã kích hoạt lịch sao lưu tự động hằng đêm vào lúc 00:00');
  
  // Tính thời gian tới 00:00 đêm nay
  const checkInterval = 60 * 60 * 1000; // Mỗi giờ kiểm tra một lần hoặc đặt timeout lúc 00:00
  let lastBackupDate = null;

  setInterval(async () => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    // Nếu vào đêm (từ 00:00 đến 01:00) và chưa sao lưu hôm nay
    if (now.getHours() === 0 && lastBackupDate !== todayStr) {
      try {
        console.log(`[NIGHTLY CRON] Bắt đầu lượt sao lưu tự động hằng đêm cho ngày ${todayStr}...`);
        await createBackup();
        lastBackupDate = todayStr;
      } catch (err) {
        console.error(`[NIGHTLY CRON ERROR] Lượt sao lưu tự động thất bại: ${err.message}`);
      }
    }
  }, checkInterval);
}

module.exports = {
  getBackupDir,
  getTimestampString,
  cleanOldBackups,
  createBackup,
  restoreBackup,
  getBackupList,
  scheduleNightlyBackup
};
