const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const db = require('./db');
const authController = require('./src/controllers/authController');

const app = express();
const PORT = process.env.PORT || 5000;

process.on('uncaughtException', (err) => {
  console.warn('[SERVER EXCEPTION]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[SERVER REJECTION]', reason?.message || reason);
});

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Header chống lưu bộ nhớ đệm (Chống nút Back trình duyệt truy cập lại trang bảo vệ sau đăng xuất)
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Phục vụ file Service Worker và Manifest với MIME Type và Header chuẩn (S-27 / PWA)
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../frontend/sw.js'));
});

app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.sendFile(path.join(__dirname, '../frontend/manifest.json'));
});

// Phục vụ giao diện người dùng frontend và file uploads
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API kiem tra trang thai server (S-01)
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Backend quan ly thi cong dang hoat dong' });
});

// API kiem tra ket noi database (S-01)
app.get('/api/db-check', async (req, res) => {
  try {
    if (db.isConnected && db.pool) {
      const [rows] = await db.pool.query('SELECT 1 + 1 AS solution');
      return res.json({ status: 'Connected', data: rows });
    }
    // Nếu có cấu hình DB_HOST (môi trường Docker/CI), trả về 503 để CI polling đợi DB sẵn sàng
    if (process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1') {
      return res.status(503).json({ status: 'Connecting', message: 'Đang đợi kết nối MySQL container...' });
    }
    return res.json({ status: 'Standalone', message: 'Đang chạy in-memory store (chưa kết nối MySQL container)' });
  } catch (error) {
    if (process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1') {
      return res.status(503).json({ status: 'Error', message: error.message });
    }
    return res.json({ status: 'Standalone', message: error.message });
  }
});

// ==========================================
// CÁC ENDPOINT CHO SPRINT S-02 (SCRUM-19)
// ==========================================
// Đăng nhập, đếm lần sai và khóa 15 phút (SCRUM-30 / T-05)
app.post('/api/auth/login', authController.login);

// Đăng ký tài khoản người dùng mới
app.post('/api/auth/register', authController.register);

// Lấy thông tin người dùng từ phiên hiện tại
app.get('/api/auth/me', authController.getMe);

// Đăng xuất - hủy phiên làm việc
app.post('/api/auth/logout', authController.logout);

// Danh sách 6 vai trò đã seed (SCRUM-29 / T-04)
app.get('/api/auth/roles', authController.getRoles);

// Mở khóa nhanh tài khoản (dành cho test/dev)
app.post('/api/auth/unlock-dev', authController.unlockDev);

// Thiết lập mật khẩu lần đầu cho người được mời (S-28 / AC 2)
app.post('/api/auth/first-login', authController.firstLogin);
app.post('/api/auth/set-first-password', authController.firstLogin);

// Điều hướng trang mặc định
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/register.html'));
});

app.get('/schedule', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/schedule.html'));
});

app.get('/diary', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/diary.html'));
});

app.get('/offline', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/offline.html'));
});

app.get('/teams', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/teams.html'));
});

// Middleware xác thực token phiên
const { authenticate } = require('./src/utils/rbac');
app.use(authenticate);

// Quản lý dự án thi công
const projectRoutes = require('./src/routes/projectRoutes');
app.use('/api', projectRoutes(db));

const wbsRoutes = require("./wbs_routes");
app.use("/api", wbsRoutes(db));

// Routes quản lý lịch làm việc và ngày nghỉ lễ (S-17 / T-40)
const calendarRoutes = require('./src/routes/calendarRoutes');
app.use('/api', calendarRoutes);

// Sprint 2: S-05 (Tasks có thời lượng) & S-06 (Quan hệ phụ thuộc) & S-07 (Thứ tự phụ thuộc & phát hiện vòng)
const taskRoutes = require("./src/routes/taskRoutes");
app.use("/api", taskRoutes(db));

const dependencyRoutes = require("./src/routes/dependencyRoutes");
app.use("/api", dependencyRoutes(db));

const schedulingRoutes = require("./src/routes/schedulingRoutes");
app.use("/api", schedulingRoutes(db));

// Sprint 4: S-22 / T50 & T51 - Nhật ký công trường, thiết bị, thời tiết & ngày mưa
const diaryRoutes = require("./src/routes/diaryRoutes");
app.use("/api", diaryRoutes(db));

// S-25 / SCRUM-125 / T-50: Đội thi công & Chỉ huy trưởng giao việc
const teamRoutes = require("./src/routes/teamRoutes");
app.use("/api", teamRoutes(db));

// ==========================================
// CÁC ENDPOINT CHO SAO LƯU & KHÔI PHỤC CSDL (S-20, T-46, T-47)
// ==========================================
const backupService = require('./src/services/backupService');

// Lấy danh sách 7 bản sao lưu gần nhất
app.get('/api/backup/list', (req, res) => {
  try {
    const backups = backupService.getBackupList();
    res.json({ success: true, backups });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Chạy sao lưu CSDL theo yêu cầu (S-20 / T-46)
app.post('/api/backup/run', async (req, res) => {
  try {
    const result = await backupService.createBackup();
    res.json({ success: true, message: 'Sao lưu CSDL thành công', backup: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Khôi phục CSDL từ bản sao lưu (S-20 / T-47)
app.post('/api/backup/restore', async (req, res) => {
  try {
    const { filename } = req.body || {};
    let filePath = null;
    if (filename) {
      filePath = path.join(backupService.getBackupDir(), path.basename(filename));
    }
    const result = await backupService.restoreBackup(filePath);
    res.json({ success: true, message: 'Khôi phục CSDL thành công', restore: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

function startServer(port) {
  const server = app.listen(port, async () => {
    console.log(`===================================================`);
    console.log(`🚀 Backend Quản lý thi công đang chạy tại port ${port}`);
    console.log(`👉 Link giao diện Lịch Làm Việc: http://localhost:${port}/calendar.html`);
    console.log(`👉 Link giao diện đăng nhập: http://localhost:${port}/login.html`);
    console.log(`👉 Link trang chính: http://localhost:${port}/index.html`);
    console.log(`===================================================`);

    if (db.initDbSchema) {
      await db.initDbSchema();
    }

    // Kích hoạt lịch sao lưu CSDL tự động hằng đêm [S-20 / T-46]
    backupService.scheduleNightlyBackup();
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[PORT] Cổng ${port} đang bị chiếm dụng bởi tiến trình khác. Tự động chuyển sang cổng ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('[SERVER ERROR]', err);
    }
  });

  return server;
}

startServer(PORT);

module.exports = app;

