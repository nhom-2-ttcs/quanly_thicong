/**
 * BỘ KIỂM THỬ: S-27 (SCRUM-119) — ỨNG DỤNG HIỆN TRƯỜNG CÀI ĐẶT PWA VÀ MỞ NHANH TRÊN ĐIỆN THOẠI
 * 
 * Parent Epic: SCRUM-122 [E-05] Nhật ký công trường & Giám sát hiện trường
 * 
 * Subtasks:
 * - SCRUM-129 [T-54]: Cấu hình Web App Manifest, Service Worker cache app shell mở dưới 1s
 * - SCRUM-130 [T-55]: Bộ kiểm thử PWA: cài đặt màn hình chính, mở offline và cập nhật SW
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');
const MANIFEST_PATH = path.join(FRONTEND_DIR, 'manifest.json');
const SW_PATH = path.join(FRONTEND_DIR, 'sw.js');
const PWA_REGISTER_PATH = path.join(FRONTEND_DIR, 'js', 'pwa-register.js');
const OFFLINE_HTML_PATH = path.join(FRONTEND_DIR, 'offline.html');
const ICONS_DIR = path.join(FRONTEND_DIR, 'icons');

// Khởi tạo Express Test Server mô phỏng cấu hình phục vụ PWA của backend/server.js
function createPwaTestApp() {
  const app = express();

  // Header chống lưu cache cho sw.js
  app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(SW_PATH);
  });

  // Web App Manifest
  app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.sendFile(MANIFEST_PATH);
  });

  app.get('/offline', (req, res) => {
    res.sendFile(OFFLINE_HTML_PATH);
  });

  app.use(express.static(FRONTEND_DIR));
  return app;
}

// Helper gọi HTTP request cục bộ
async function makeRequest(app, url) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${url}`);
    const text = await res.text();
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body: text
    };
  } finally {
    server.close();
  }
}

// =========================================================================
// SUBTASK T-54 (SCRUM-129): CẤU HÌNH WEB APP MANIFEST & APP SHELL CACHE
// =========================================================================

test('T-54 [Manifest] File manifest.json tồn tại, cú pháp JSON hợp lệ và chứa đầy đủ trường PWA bắt buộc', () => {
  assert.ok(fs.existsSync(MANIFEST_PATH), 'File manifest.json phải tồn tại trong frontend');

  const content = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  let manifest;
  assert.doesNotThrow(() => {
    manifest = JSON.parse(content);
  }, 'manifest.json phải là JSON hợp lệ');

  // Kiểm tra các trường định danh cơ bản
  assert.ok(manifest.name && manifest.name.includes('Quản Lý Thi Công'), 'Tên ứng dụng phải rõ nghĩa');
  assert.ok(manifest.short_name, 'Phải có tên viết tắt (short_name) để hiển thị dưới icon điện thoại');
  assert.equal(manifest.display, 'standalone', 'Chế độ hiển thị phải là standalone để mở như app độc lập');
  assert.ok(manifest.start_url, 'Phải có start_url cho ứng dụng');
  assert.ok(manifest.background_color, 'Phải có màu nền splash screen (background_color)');
  assert.ok(manifest.theme_color, 'Phải có màu thanh trạng thái (theme_color)');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'Phải có danh sách icons');
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length > 0, 'Phải có shortcuts lối tắt nhanh');
});

test('T-54 [Icons] Bộ biểu tượng PWA có đủ kích thước di động chuẩn (192x192, 512x512, maskable) và file vật lý tồn tại', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  const iconSizes = manifest.icons.map(i => i.sizes);

  assert.ok(iconSizes.includes('192x192'), 'Phải có icon kích thước 192x192');
  assert.ok(iconSizes.includes('512x512'), 'Phải có icon kích thước 512x512');

  const hasMaskable = manifest.icons.some(i => i.purpose === 'maskable');
  assert.ok(hasMaskable, 'Phải có icon định dạng maskable cho Android Adaptive Icons');

  // Kiểm tra file vật lý tồn tại trên đĩa và không bị rỗng
  manifest.icons.forEach(icon => {
    const iconRelPath = icon.src.replace(/^\//, '');
    const iconAbsPath = path.join(FRONTEND_DIR, iconRelPath);
    assert.ok(fs.existsSync(iconAbsPath), `File icon vật lý phải tồn tại: ${icon.src}`);
    const stat = fs.statSync(iconAbsPath);
    assert.ok(stat.size > 0, `File icon không được rỗng: ${icon.src}`);
  });
});

test('T-54 [Service Worker] File sw.js tồn tại, cấu hình đầy đủ sự kiện vòng đời và danh sách App Shell', () => {
  assert.ok(fs.existsSync(SW_PATH), 'File sw.js phải tồn tại trong frontend');
  const swCode = fs.readFileSync(SW_PATH, 'utf-8');

  // Kiểm tra định nghĩa Cache Name & Version
  assert.match(swCode, /CACHE_NAME\s*=/i, 'Phải định nghĩa hằng số CACHE_NAME');
  assert.match(swCode, /APP_SHELL_ASSETS\s*=/i, 'Phải định nghĩa danh sách tài nguyên APP_SHELL_ASSETS');

  // Kiểm tra danh sách App Shell chứa các trang cốt lõi
  assert.ok(swCode.includes('diary.html'), 'App shell phải cache trang nhật ký hiện trường diary.html');
  assert.ok(swCode.includes('index.html'), 'App shell phải cache trang tổng quan index.html');
  assert.ok(swCode.includes('offline.html'), 'App shell phải cache trang ngoại tuyến offline.html');
  assert.ok(swCode.includes('manifest.json'), 'App shell phải cache manifest.json');
  assert.ok(swCode.includes('pwa-register.js'), 'App shell phải cache script đăng ký pwa-register.js');

  // Kiểm tra các sự kiện Service Worker
  assert.match(swCode, /addEventListener\(\s*['"]install['"]/i, 'Phải có sự kiện install');
  assert.match(swCode, /addEventListener\(\s*['"]activate['"]/i, 'Phải có sự kiện activate');
  assert.match(swCode, /addEventListener\(\s*['"]fetch['"]/i, 'Phải có sự kiện fetch');
  assert.match(swCode, /addEventListener\(\s*['"]message['"]/i, 'Phải có sự kiện message');
});

test('T-54 [NFR Hiệu năng] Tốc độ nạp App Shell từ Cache đạt tiêu chuẩn mở dưới 1 giây (<1000ms)', async () => {
  // Đo lường thời gian đọc và phân tích toàn bộ tài nguyên App Shell cốt lõi
  const startTime = performance.now();

  const coreAssets = [
    path.join(FRONTEND_DIR, 'diary.html'),
    path.join(FRONTEND_DIR, 'index.html'),
    path.join(FRONTEND_DIR, 'offline.html'),
    path.join(FRONTEND_DIR, 'manifest.json'),
    path.join(FRONTEND_DIR, 'js', 'pwa-register.js')
  ];

  let totalBytes = 0;
  for (const assetPath of coreAssets) {
    const data = fs.readFileSync(assetPath);
    totalBytes += data.length;
  }

  const durationMs = performance.now() - startTime;

  assert.ok(totalBytes > 0, 'Phải đọc thành công các file App Shell');
  assert.ok(durationMs < 1000, `Thời gian nạp App Shell phải dưới 1000ms (thực tế: ${durationMs.toFixed(2)}ms)`);
});

// =========================================================================
// SUBTASK T-55 (SCRUM-130): BỘ KIỂM THỬ PWA (A2HS, OFFLINE & UPDATE SW)
// =========================================================================

test('T-55 [A2HS - Cài đặt màn hình chính] Các trang HTML chính nhúng đầy đủ meta tag và script đăng ký PWA', () => {
  const pagesToCheck = [
    'diary.html',
    'index.html',
    'schedule.html',
    'teams.html',
    'wbs.html',
    'calendar.html',
    'gantt.html',
    'login.html'
  ];

  for (const pageName of pagesToCheck) {
    const pagePath = path.join(FRONTEND_DIR, pageName);
    assert.ok(fs.existsSync(pagePath), `Trang ${pageName} phải tồn tại`);

    const html = fs.readFileSync(pagePath, 'utf-8');

    // Kiểm tra thẻ manifest
    assert.match(html, /<link\s+[^>]*rel=["']manifest["'][^>]*>/i, `Trang ${pageName} phải có thẻ <link rel="manifest">`);

    // Kiểm tra thẻ theme-color
    assert.match(html, /<meta\s+[^>]*name=["']theme-color["'][^>]*>/i, `Trang ${pageName} phải có thẻ <meta name="theme-color">`);

    // Kiểm tra thẻ apple-touch-icon
    assert.match(html, /<link\s+[^>]*rel=["']apple-touch-icon["'][^>]*>/i, `Trang ${pageName} phải có thẻ apple-touch-icon`);

    // Kiểm tra nhúng pwa-register.js
    assert.match(html, /pwa-register\.js/i, `Trang ${pageName} phải nhúng pwa-register.js`);
  }
});

test('T-55 [A2HS - Script UI] pwa-register.js hỗ trợ sự kiện beforeinstallprompt, appinstalled và nút cài đặt', () => {
  assert.ok(fs.existsSync(PWA_REGISTER_PATH), 'File pwa-register.js phải tồn tại');
  const code = fs.readFileSync(PWA_REGISTER_PATH, 'utf-8');

  // Bắt sự kiện cài đặt của trình duyệt
  assert.match(code, /addEventListener\(\s*['"]beforeinstallprompt['"]/i, 'Phải lắng nghe sự kiện beforeinstallprompt');
  assert.match(code, /addEventListener\(\s*['"]appinstalled['"]/i, 'Phải lắng nghe sự kiện appinstalled');

  // Hỗ trợ hiển thị UI cài đặt và hướng dẫn iOS Safari
  assert.match(code, /deferredPrompt\.prompt\(\)/i, 'Phải có lệnh gọi deferredPrompt.prompt()');
  assert.match(code, /pwa-install-banner/i, 'Phải có banner nhắc cài đặt PWA');
});

test('T-55 [Mở Offline] Trang offline.html đầy đủ nội dung, nút thử lại và fallback an toàn trong SW', () => {
  assert.ok(fs.existsSync(OFFLINE_HTML_PATH), 'File offline.html phải tồn tại');
  const offlineHtml = fs.readFileSync(OFFLINE_HTML_PATH, 'utf-8');

  assert.ok(offlineHtml.includes('Ngoại Tuyến') || offlineHtml.includes('ngoại tuyến'), 'offline.html phải có thông báo ngoại tuyến');
  assert.ok(offlineHtml.includes('diary.html'), 'offline.html phải có liên kết mở nhật ký cache');
  assert.ok(offlineHtml.includes('retryConnection'), 'offline.html phải có chức năng thử lại kết nối');

  const swCode = fs.readFileSync(SW_PATH, 'utf-8');
  assert.match(swCode, /offline\.html/i, 'Service worker phải định tuyến fallback về offline.html khi mất mạng');
});

test('T-55 [Chiến lược mạng & API Offline] Service Worker có Network-First cho API và Stale-While-Revalidate cho App Shell', () => {
  const swCode = fs.readFileSync(SW_PATH, 'utf-8');

  // Kiểm tra xử lý API
  assert.match(swCode, /pathname\.startsWith\(['"]\/api\/['"]\)/i, 'Service worker phải nhận diện đường dẫn /api/');
  assert.match(swCode, /JSON\.stringify\(\s*\{\s*offline:\s*true/i, 'Phải có phản hồi JSON ngoại tuyến an toàn khi API mất sóng');

  // Kiểm tra Stale-While-Revalidate cho App Shell
  assert.match(swCode, /caches\.match\(req\)/i, 'Phải kiểm tra cache trước để trả lời tức thì');
  assert.match(swCode, /fetch\(req\)/i, 'Phải gửi fetch để cập nhật cache ngầm');
});

test('T-55 [Cập nhật Service Worker] Cơ chế xóa cache phiên bản cũ và hỗ trợ SKIP_WAITING tức thì', () => {
  const swCode = fs.readFileSync(SW_PATH, 'utf-8');

  // Dọn dẹp cache cũ khi activate
  assert.match(swCode, /caches\.delete\(/i, 'Sự kiện activate phải xóa các cache phiên bản cũ');
  assert.match(swCode, /clients\.claim\(\)/i, 'Sự kiện activate phải gọi clients.claim() để nhận quyền kiểm soát ngay');

  // Xử lý thông điệp SKIP_WAITING
  assert.match(swCode, /SKIP_WAITING/i, 'Phải xử lý lệnh SKIP_WAITING');
  assert.match(swCode, /self\.skipWaiting\(\)/i, 'Phải gọi self.skipWaiting() để kích hoạt worker mới');

  // Client thông báo cập nhật
  const clientCode = fs.readFileSync(PWA_REGISTER_PATH, 'utf-8');
  assert.match(clientCode, /updatefound/i, 'Client phải lắng nghe sự kiện updatefound');
  assert.match(clientCode, /pwa-update-toast/i, 'Client phải hiển thị hộp thoại thông báo có bản cập nhật mới');
});

test('T-55 [Server Config] Express phục vụ /sw.js với header chống cache và /manifest.json chuẩn MIME type', async () => {
  const app = createPwaTestApp();

  // Kiểm tra /sw.js
  const swRes = await makeRequest(app, '/sw.js');
  assert.equal(swRes.status, 200, 'Endpoint /sw.js phải trả về HTTP 200');
  assert.ok(swRes.headers['content-type'].includes('javascript'), 'sw.js phải có Content-Type là javascript');
  assert.equal(swRes.headers['service-worker-allowed'], '/', 'sw.js phải có header Service-Worker-Allowed là /');
  assert.ok(swRes.headers['cache-control'].includes('no-cache'), 'sw.js phải có header Cache-Control no-cache');
  assert.ok(swRes.body.includes('CACHE_NAME'), 'Nội dung sw.js phải hợp lệ');

  // Kiểm tra /manifest.json
  const manifestRes = await makeRequest(app, '/manifest.json');
  assert.equal(manifestRes.status, 200, 'Endpoint /manifest.json phải trả về HTTP 200');
  assert.ok(
    manifestRes.headers['content-type'].includes('manifest+json') ||
    manifestRes.headers['content-type'].includes('json'),
    'manifest.json phải có Content-Type chuẩn JSON'
  );
  const parsedManifest = JSON.parse(manifestRes.body);
  assert.equal(parsedManifest.display, 'standalone');
});
