require('dotenv').config();
const StagingMonitor = require('../src/services/stagingMonitor');

console.log('====================================================');
console.log('🛡️  KHỞI ĐỘNG TIẾN TRÌNH GIÁM SÁT SỨC KHỎE STAGING (S-51)');
console.log('====================================================');

const monitor = new StagingMonitor({
  targetUrl: process.env.MONITOR_TARGET_URL || 'http://localhost:5000/api/health/readiness',
  intervalSeconds: Number(process.env.MONITOR_INTERVAL_SECONDS || 30),
  alertThresholdSeconds: Number(process.env.MONITOR_ALERT_THRESHOLD_SECONDS || 300),
  webhookUrl: process.env.ALERT_WEBHOOK_URL || null,
  webhookTimeoutMs: Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS || 5000)
});

monitor.start();

// Xử lý dừng tiến trình an toàn
const handleShutdown = (signal) => {
  console.log(`\n[StagingMonitor] Nhận tín hiệu ${signal}. Đang đóng tiến trình giám sát...`);
  monitor.stop();
  process.exit(0);
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
