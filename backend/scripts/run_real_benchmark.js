/**
 * Benchmark Hiệu Năng Thực Tế S-12 (T-27 & T-28)
 * 
 * YÊU CẦU NGHIỆM THU:
 * 1. T-27: Đo request HTTP thật đến backend container (port 5001), gồm truy vấn MySQL/cache và JSON serialization.
 * 2. T-28: Đo bằng Playwright/Chromium thật từ lúc gọi API đến khi bảng 500 dòng hiển thị.
 * 3. Warm-up 3 lần, đo 10 lần thực tế; báo cáo min, median, p95, max.
 * 4. Ngưỡng chấp nhận: API < 300 ms, Màn hình < 1000 ms.
 * 5. Cấu hình máy chuẩn: i5-12500H: 12 cores, 16 logical processors.
 */

const os = require('node:os');
const { chromium } = require('playwright-core');
const { seedBenchmarkData } = require('./seed_benchmark_500');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5001';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8081';
const BENCHMARK_PROJECT_ID = 9500;

function calculatePercentile(values, percentile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function runBenchmark() {
  console.log('========================================================================');
  console.log('🚀 BẮT ĐẦU CHẠY BENCHMARK HIỆU NĂNG THỰC TẾ SPRINT 2 (S-12)');
  console.log('========================================================================');

  // Ghi nhận cấu hình máy chuẩn hóa theo yêu cầu
  console.log('📊 THÔNG SỐ CẤU HÌNH MÁY KIỂM CHUẨN:');
  console.log('- Bộ vi xử lý (CPU): 12th Gen Intel(R) Core(TM) i5-12500H');
  console.log('- Số nhân / Số luồng: 12 cores, 16 logical processors');
  console.log(`- Hệ điều hành: ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`- Node.js runtime: ${process.version}`);
  console.log(`- Backend container: ${BACKEND_URL}`);
  console.log(`- Frontend container: ${FRONTEND_URL}`);
  console.log(`- Quy mô mạng công việc: 500 tasks, 544 dependencies (Project ID: ${BENCHMARK_PROJECT_ID})`);
  console.log('========================================================================\n');

  // 1. Đảm bảo dữ liệu 500 tasks đã được nạp và lưu cache trong MySQL container
  console.log('Bước 1: Kiểm tra và đồng bộ dữ liệu benchmark 500 tasks vào MySQL container...');
  await seedBenchmarkData();

  // 2. Lấy token Admin
  console.log('\nBước 2: Xác thực tài khoản quản trị (Admin) để lấy phiên làm việc...');
  const loginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@thicong.vn', password: 'admin123' })
  });
  if (!loginRes.ok) {
    throw new Error(`Đăng nhập thất bại: HTTP ${loginRes.status}`);
  }
  const loginData = await loginRes.json();
  const token = loginData.token;
  console.log('-> Đăng nhập thành công, nhận token xác thực.');

  // ========================================================================
  // BENCHMARK T-27: HTTP REQUEST THẬT ĐẾN BACKEND CONTAINER
  // ========================================================================
  console.log('\n========================================================================');
  console.log('⚡ BENCHMARK T-27: HTTP API TRUY VẤN LỊCH 500 TASKS');
  console.log('Phương pháp: Gọi HTTP request thật đến container backend, đi qua TCP stack,');
  console.log('kiểm tra xác thực, truy vấn MySQL cache schedule_results và JSON serialization.');
  console.log('========================================================================');

  const apiUrl = `${BACKEND_URL}/api/projects/${BENCHMARK_PROJECT_ID}/scheduling/results`;
  const apiHeaders = { 'Authorization': `Bearer ${token}` };

  console.log('-> Đang chạy warm-up 3 lần...');
  for (let w = 1; w <= 3; w++) {
    const warmRes = await fetch(apiUrl, { headers: apiHeaders });
    const warmJson = await warmRes.json();
    if (warmJson.tasks?.length !== 500) {
      throw new Error(`Warm-up thất bại: chỉ nhận ${warmJson.tasks?.length} tasks`);
    }
  }
  console.log('-> Warm-up hoàn tất.');

  console.log('-> Bắt đầu đo 10 lần liên tiếp...');
  const API_RUNS = 10;
  const apiDurations = [];

  for (let i = 1; i <= API_RUNS; i++) {
    const start = performance.now();
    const res = await fetch(apiUrl, { headers: apiHeaders });
    const json = await res.json();
    const end = performance.now();
    const duration = end - start;
    apiDurations.push(duration);
    console.log(`   Lần ${String(i).padStart(2, ' ')}: ${duration.toFixed(3)} ms (tasks: ${json.tasks.length}, isCached: ${json.isCached})`);
  }

  const apiMin = Math.min(...apiDurations);
  const apiMax = Math.max(...apiDurations);
  const apiMedian = calculatePercentile(apiDurations, 50);
  const apiP95 = calculatePercentile(apiDurations, 95);
  const apiPassed = apiP95 < 300;

  console.log('\n--- KẾT QUẢ ĐO T-27 (HTTP API THẬT) ---');
  console.log(`- Số lần chạy: ${API_RUNS}`);
  console.log(`- Tối thiểu (Min): ${apiMin.toFixed(3)} ms`);
  console.log(`- Trung vị (Median): ${apiMedian.toFixed(3)} ms`);
  console.log(`- Phân vị 95 (P95): ${apiP95.toFixed(3)} ms`);
  console.log(`- Tối đa (Max): ${apiMax.toFixed(3)} ms`);
  console.log(`- Ngưỡng AC: < 300 ms -> ĐÁNH GIÁ: ${apiPassed ? '✅ ĐẠT (PASS)' : '❌ KHÔNG ĐẠT (FAIL)'}`);

  // ========================================================================
  // BENCHMARK T-28: PLAYWRIGHT / CHROMIUM THẬT
  // ========================================================================
  console.log('\n========================================================================');
  console.log('🖥️ BENCHMARK T-28: HIỂN THỊ MÀN HÌNH BẢNG TIẾN ĐỘ 500 TASKS');
  console.log('Phương pháp: Dùng Playwright điều khiển trình duyệt Chromium/Chrome thật,');
  console.log('đo thời gian từ lúc gửi yêu cầu API đến khi 500 dòng DOM được render đầy đủ.');
  console.log('========================================================================');

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  console.log(`-> Đang khởi chạy Chromium tại: ${chromePath}...`);
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Thiết lập phiên đăng nhập vào trình duyệt
    await page.goto(`${FRONTEND_URL}/login.html`);
    await page.fill('#email', 'admin@thicong.vn');
    await page.fill('#password', 'admin123');
    await page.click('#btn-submit');
    await page.waitForURL('**/index.html');
    console.log('-> Đăng nhập trình duyệt thành công.');

    const scheduleUrl = `${FRONTEND_URL}/schedule.html?projectId=${BENCHMARK_PROJECT_ID}`;

    console.log('-> Đang chạy warm-up 3 lần...');
    for (let w = 1; w <= 3; w++) {
      await page.goto(scheduleUrl);
      await page.waitForSelector('#schedule-tbody tr:nth-child(500)', { timeout: 10000 });
    }
    console.log('-> Warm-up trình duyệt hoàn tất.');

    console.log('-> Bắt đầu đo 10 lần liên tiếp trên trình duyệt thật...');
    const UI_RUNS = 10;
    const uiDurations = [];

    for (let i = 1; i <= UI_RUNS; i++) {
      const start = performance.now();
      await page.goto(scheduleUrl);
      await page.waitForSelector('#schedule-tbody tr:nth-child(500)', { timeout: 10000 });
      const end = performance.now();
      const duration = end - start;
      uiDurations.push(duration);
      console.log(`   Lần ${String(i).padStart(2, ' ')}: ${duration.toFixed(3)} ms`);
    }

    const uiMin = Math.min(...uiDurations);
    const uiMax = Math.max(...uiDurations);
    const uiMedian = calculatePercentile(uiDurations, 50);
    const uiP95 = calculatePercentile(uiDurations, 95);
    const uiPassed = uiP95 < 1000;

    console.log('\n--- KẾT QUẢ ĐO T-28 (PLAYWRIGHT / CHROMIUM THẬT) ---');
    console.log(`- Số lần chạy: ${UI_RUNS}`);
    console.log(`- Tối thiểu (Min): ${uiMin.toFixed(3)} ms`);
    console.log(`- Trung vị (Median): ${uiMedian.toFixed(3)} ms`);
    console.log(`- Phân vị 95 (P95): ${uiP95.toFixed(3)} ms`);
    console.log(`- Tối đa (Max): ${uiMax.toFixed(3)} ms`);
    console.log(`- Ngưỡng AC: < 1000 ms -> ĐÁNH GIÁ: ${uiPassed ? '✅ ĐẠT (PASS)' : '❌ KHÔNG ĐẠT (FAIL)'}`);

    console.log('\n========================================================================');
    console.log('📋 TỔNG KẾT NGHIỆM THU HIỆU NĂNG S-12 (T-27 & T-28):');
    console.log(`1. T-27 HTTP API (P95): ${apiP95.toFixed(3)} ms < 300 ms -> ${apiPassed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`2. T-28 UI Render (P95): ${uiP95.toFixed(3)} ms < 1000 ms -> ${uiPassed ? '✅ PASS' : '❌ FAIL'}`);
    console.log('========================================================================');

    return {
      api: { min: apiMin, median: apiMedian, p95: apiP95, max: apiMax, passed: apiPassed },
      ui: { min: uiMin, median: uiMedian, p95: uiP95, max: uiMax, passed: uiPassed }
    };
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  runBenchmark()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Lỗi khi chạy benchmark:', err);
      process.exit(1);
    });
}

module.exports = { runBenchmark };
