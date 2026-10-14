const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { performance } = require('perf_hooks');
const { chromium } = require('playwright-core');

const diaryRoutes = require('../src/routes/diaryRoutes');
const {
  inMemorySiteDiaries,
  inMemorySiteDiaryPhotos,
  inMemorySiteDiaryItems
} = require('../src/models/store');

/**
 * Helper tìm đường dẫn trình duyệt thực tế trên hệ thống (Windows / Linux CI)
 */
function findBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROME_PATH,
    process.env.CHROME_BIN,
    // Windows Edge & Chrome
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    // Linux Chrome & Chromium (Ubuntu GitHub Actions)
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ];

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * ============================================================================
 * [S-34 / SCRUM-147] KỊCH BẢN TRÌNH DUYỆT THẬT: NGẮT MẠNG GHI 20 MỤC RỒI KẾT NỐI LẠI
 * - T-63 (SCRUM-161): Trình duyệt thật chuyển offline, tạo 20 nhật ký kèm ảnh trong IndexedDB
 * - T-64 (SCRUM-162): Nối mạng lại, server nhận đúng 20 mục; gửi lặp cùng mã vẫn chỉ 1 bản (Idempotency)
 * - T-65 (SCRUM-163): Thời gian thực thi toàn bộ kịch bản E2E < 180 giây (NFR: < 180s)
 * ============================================================================
 */
test('=== [S-34 / SCRUM-147] E2E REAL BROWSER: OFFLINE 20 DIARIES & RETRY IDEMPOTENCY ===', async (t) => {
  const globalSuiteStart = performance.now();
  const executablePath = findBrowserExecutable();

  assert.ok(
    executablePath,
    'Phải tìm thấy trình duyệt Edge hoặc Chrome trên hệ thống để chạy kịch bản trình duyệt thật S-34'
  );

  // 1. Khởi động máy chủ Express phục vụ cả static frontend và API
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(path.join(__dirname, '../../frontend')));
  const mockDb = { isConnected: false, pool: null };
  app.use('/api', diaryRoutes(mockDb));

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  // Dọn dẹp CSDL in-memory trước kiểm thử
  inMemorySiteDiaries.length = 0;
  inMemorySiteDiaryPhotos.length = 0;
  inMemorySiteDiaryItems.length = 0;

  // 2. Khởi tạo phiên trình duyệt thật bằng Playwright
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 3. Mở trang nhật ký thi công trên trình duyệt
    await page.goto(`${baseUrl}/diary.html`, { waitUntil: 'domcontentloaded' });

    // ==========================================================================
    // PHẦN 1: T-63 (SCRUM-161) — CHUYỂN OFFLINE THẬT & TẠO 20 MỤC NHẬT KÝ KÈM ẢNH
    // ==========================================================================
    await t.test('1. T-63: Chuyển offline thật trên trình duyệt, tạo 20 nhật ký kèm ảnh trong IndexedDB', async () => {
      // 1.1. Ngắt mạng thật thông qua cơ chế Network Offline của trình duyệt (CDP / Playwright)
      await context.setOffline(true);
      const isOnline = await page.evaluate(() => navigator.onLine);
      assert.strictEqual(isOnline, false, 'Trình duyệt phải ở trạng thái mất kết nối mạng (navigator.onLine === false)');

      // 1.2. Tạo 20 nhật ký có cấu trúc kèm ảnh lưu vào IndexedDB
      await page.evaluate(async () => {
        // Chuỗi ảnh 1x1 JPEG Base64 hợp lệ
        const tinyBase64Jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

        for (let i = 1; i <= 20; i++) {
          const idx = String(i).padStart(2, '0');
          const clientDiaryId = `client_diary_s34_${idx}`;
          const clientItemId = `client_item_s34_${idx}`;
          const clientPhotoId = `client_photo_s34_${idx}`;

          await window.OfflineDiaryStorage.saveOfflineDiary({
            clientId: clientDiaryId,
            client_diary_id: clientDiaryId,
            project_id: 1,
            diary_date: `2026-10-${idx}`,
            weather_condition: (i % 2 === 0) ? 'sunny' : 'cloudy',
            manpower_count: 15 + i,
            equipment_status: `Máy ủi 01, Máy đào #${idx}`,
            work_notes: `Nhật ký thi công ngoại tuyến hạng mục đài móng số ${idx}`,
            items: [
              {
                client_item_id: clientItemId,
                work_content: `Đổ bê tông đài móng block #${idx}`,
                quantity_done: 25.5 + i,
                unit: 'm3'
              }
            ],
            photos: [
              {
                client_photo_id: clientPhotoId,
                dataUrl: tinyBase64Jpg,
                file_name: `hien_truong_${idx}.jpg`,
                caption: `Hiện trường thi công #${idx}`
              }
            ]
          });
        }
      });

      // 1.3. Kiểm tra dữ liệu được lưu bền vững trong IndexedDB với trạng thái chưa đồng bộ
      const pendingCount = await page.evaluate(async () => {
        const pending = await window.OfflineDiaryStorage.getPendingDiaries();
        return pending.length;
      });
      assert.strictEqual(pendingCount, 20, 'IndexedDB trên trình duyệt phải lưu trữ đúng 20 nhật ký chờ đồng bộ');

      // 1.4. Đảm bảo trong lúc mất mạng, máy chủ hoàn toàn KHÔNG nhận được dữ liệu
      assert.strictEqual(inMemorySiteDiaries.length, 0, 'Máy chủ tuyệt đối chưa có nhật ký nào khi đang ngắt mạng');
    });

    // ==========================================================================
    // PHẦN 2: T-64 (SCRUM-162) — NỐI MẠNG LẠI, TỰ ĐỒNG BỘ 20 MỤC & CHỐNG TRÙNG LẶP
    // ==========================================================================
    await t.test('2. T-64: Nối mạng lại, máy chủ nhận đúng 20 mục; gửi lặp lại cùng mã vẫn chỉ 1 bản (Idempotency)', async () => {
      // 2.1. Khôi phục kết nối mạng cho trình duyệt
      await context.setOffline(false);
      const isOnline = await page.evaluate(() => navigator.onLine);
      assert.strictEqual(isOnline, true, 'Trình duyệt đã có mạng trở lại (navigator.onLine === true)');

      // 2.2. Kích hoạt đồng bộ từ trình duyệt và đợi hoàn tất
      await page.evaluate(async (base) => {
        await window.OfflineDiaryStorage.syncPendingDiaries(base);
        await window.OfflineDiaryStorage.waitForAllDiariesSynced(15000);
      }, baseUrl);

      // 2.3. Kiểm tra máy chủ nhận đúng 20 bản ghi duy nhất
      assert.strictEqual(inMemorySiteDiaries.length, 20, 'Máy chủ phải có ĐÚNG 20 BẢN GHI nhật ký');

      const clientIds = inMemorySiteDiaries.map(d => d.client_diary_id);
      const uniqueClientIds = new Set(clientIds);
      assert.strictEqual(uniqueClientIds.size, 20, 'Tất cả 20 client_diary_id trên máy chủ phải duy nhất');

      // 2.4. Kiểm tra trên trình duyệt: Không còn mục nào ở trạng thái chờ đồng bộ
      const remainingPending = await page.evaluate(async () => {
        const list = await window.OfflineDiaryStorage.getPendingDiaries();
        return list.length;
      });
      assert.strictEqual(remainingPending, 0, 'Toàn bộ 20 mục trên IndexedDB đã được chuyển sang trạng thái đã đồng bộ');

      // 2.5. KỊCH BẢN GỬI LẶP / VÒNG LẶP (IDEMPOTENCY RETRY)
      // Giả lập tình huống mạng chập chờn khiến trình duyệt gửi lại cùng 20 mục đã gửi
      await page.evaluate(async (base) => {
        // Đặt lại trạng thái pending để ép gửi lại toàn bộ cùng mã client_diary_id
        const db = await window.OfflineDiaryStorage.openOfflineDB();
        const all = await window.OfflineDiaryStorage.getOfflineDiaries();
        const tx = db.transaction('offline_diaries', 'readwrite');
        const store = tx.objectStore('offline_diaries');
        for (const item of all) {
          item.syncStatus = 'chưa đồng bộ';
          store.put(item);
        }
        await new Promise(r => { tx.oncomplete = r; });
        await window.OfflineDiaryStorage.syncPendingDiaries(base);
        await window.OfflineDiaryStorage.waitForAllDiariesSynced(15000);
      }, baseUrl);

      // 2.6. Khẳng định máy chủ VẪN CHỈ CÓ ĐÚNG 20 BẢN GHI (Không nhân bản lên 40)
      assert.strictEqual(inMemorySiteDiaries.length, 20, 'Máy chủ VẪN CHỈ CÓ ĐÚNG 20 MỤC sau khi gửi lại (Idempotency được bảo vệ)');
    });

    // ==========================================================================
    // PHẦN 3: T-65 (SCRUM-163) — NFR: THỜI GIAN CHẠY TRÌNH DUYỆT THẬT DƯỚI 180 GIÂY
    // ==========================================================================
    await t.test('3. T-65: Đảm bảo thời gian chạy toàn bộ kịch bản E2E < 180 giây trên CI', () => {
      const elapsedTotalMs = performance.now() - globalSuiteStart;
      const elapsedSeconds = (elapsedTotalMs / 1000).toFixed(3);
      const CI_NFR_LIMIT_MS = 180 * 1000; // 3 phút = 180,000 ms

      console.log('\n================================================================');
      console.log('⏱️ [BÁO CÁO THỜI GIAN CHẠY S-34 REAL BROWSER E2E TRÊN CI]');
      console.log(`- Trình duyệt thực thi: ${executablePath}`);
      console.log(`- Thời gian thực thi toàn bộ kịch bản: ${elapsedSeconds} giây (${elapsedTotalMs.toFixed(1)} ms)`);
      console.log(`- Giới hạn NFR tối đa: 180.000 giây (3 phút)`);
      console.log(`- Đánh giá: ${elapsedTotalMs < CI_NFR_LIMIT_MS ? '✅ ĐẠT YÊU CẦU NFR (PASS)' : '❌ VƯỢT QUÁ GIỚI HẠN (FAIL)'}`);
      console.log('================================================================\n');

      assert.ok(
        elapsedTotalMs < CI_NFR_LIMIT_MS,
        `Thời gian thực thi (${elapsedSeconds}s) vượt quá giới hạn 180s của NFR`
      );
    });

  } finally {
    await browser.close();
    server.close();
  }
});
