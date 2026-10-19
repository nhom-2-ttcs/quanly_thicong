const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { chromium } = require('playwright-core');

function findBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROME_PATH,
    process.env.CHROME_BIN,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];

  const appData = process.env.LOCALAPPDATA || 'C:\\Users\\Admin\\AppData\\Local';
  const pwDir = `${appData}\\ms-playwright`;
  if (fs.existsSync(pwDir)) {
    try {
      const entries = fs.readdirSync(pwDir);
      for (const e of entries) {
        if (e.startsWith('chromium-')) {
          candidates.push(`${pwDir}\\${e}\\chrome-win64\\chrome.exe`);
          candidates.push(`${pwDir}\\${e}\\chrome-win\\chrome.exe`);
        }
      }
    } catch (_) {}
  }

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

const BASE_URL = 'http://localhost:5000';
const PAGES = [
  { file: 'index.html', title: 'Tổng quan', activeIndex: 0 },
  { file: 'wbs.html', title: 'WBS', activeIndex: 1 },
  { file: 'schedule.html', title: 'CPM', activeIndex: 2 },
  { file: 'gantt.html', title: 'Gantt', activeIndex: 3 },
  { file: 'calendar.html', title: 'Lịch', activeIndex: 4 },
  { file: 'diary.html', title: 'Nhật ký', activeIndex: 5 },
  { file: 'teams.html', title: 'Đội & Giao việc', activeIndex: 6 }
];

const VIEWPORTS = [
  { name: 'Desktop 1440px', width: 1440, height: 900 },
  { name: 'Tablet 1024px', width: 1024, height: 768 },
  { name: 'Mobile iPhone 375px', width: 375, height: 667 },
  { name: 'Mobile Modern 390px', width: 390, height: 844 }
];

test('Frontend UI Consistency & Responsiveness across all 7 pages and 4 viewports', async (t) => {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    t.skip('Bỏ qua: Không tìm thấy trình duyệt Chromium/Edge cục bộ.');
    return;
  }

  let ephemeralServer = null;
  let activeBaseUrl = BASE_URL;
  try {
    const probe = await fetch(`${BASE_URL}/login.html`, { signal: AbortSignal.timeout(800) });
    if (!probe.ok && probe.status !== 200) throw new Error('Unhealthy');
  } catch (_) {
    const express = require('express');
    const path = require('path');
    const app = express();
    app.use(express.json());
    app.use('/api/auth/me', (req, res) => res.json({ success: true, user: { id: 1, full_name: 'Nguyễn Quản Trị', role_name: 'admin', role_display_name: 'Quản trị viên' } }));
    app.use('/api/auth/login', (req, res) => res.json({ success: true, token: 'mock_test_token_admin', user: { id: 1, full_name: 'Nguyễn Quản Trị', role_name: 'admin', role_display_name: 'Quản trị viên' } }));
    app.use('/api/projects/:id', (req, res) => res.json({ success: true, project: { id: 1, name: 'Dự án mẫu Cầu Vàm Cỏ', code: 'DA-01' } }));
    app.use(express.static(path.join(__dirname, '../../frontend')));
    ephemeralServer = app.listen(0);
    activeBaseUrl = `http://localhost:${ephemeralServer.address().port}`;
  }

  // 1. Lấy token đăng nhập thật từ hệ thống backend (nếu có)
  let realToken = '';
  let realUser = null;
  try {
    const loginRes = await fetch(`${activeBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@thicong.vn', password: 'Admin@123' })
    });
    if (loginRes.ok) {
      const loginData = await loginRes.json();
      realToken = loginData.token;
      realUser = loginData.user;
    }
  } catch (err) {
    // Static server mode
  }

  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Khởi tạo trước phiên đăng nhập hợp lệ cho LocalStorage
  const testUser = realUser || { id: 1, full_name: 'Nguyễn Quản Trị', role_name: 'admin', role_display_name: 'Quản trị viên' };
  const testToken = realToken || 'mock_test_token_admin';
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('quanly_token', token);
    localStorage.setItem('quanly_user', JSON.stringify(user));
  }, { token: testToken, user: testUser });

  try {
    for (const pageConfig of PAGES) {
      await t.test(`Kiểm tra trang ${pageConfig.file}`, async (st) => {
        for (const vp of VIEWPORTS) {
          await st.test(`Hiển thị tại độ phân giải ${vp.name}`, async () => {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            const targetUrl = `${activeBaseUrl}/${pageConfig.file}?projectId=1`;
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(250);

          // 1. Kiểm tra 7 mục điều hướng theo đúng thứ tự
          const navLinks = await page.$$eval('.nav-dock a, .module-nav a', els =>
            els.map(el => ({
              text: el.innerText.trim().replace(/^[^a-zA-ZÀ-ỹ0-9&]+/g, '').trim(),
              href: el.getAttribute('href'),
              isActive: el.classList.contains('active') || el.getAttribute('aria-current') === 'page'
            }))
          );

          assert.equal(navLinks.length, 7, `Trang ${pageConfig.file} phải có đủ 7 mục điều hướng`);

          const expectedNames = ['Tổng quan', 'WBS', 'CPM', 'Gantt', 'Lịch', 'Nhật ký', 'Đội & Giao việc'];
          navLinks.forEach((link, idx) => {
            assert.ok(
              link.text.includes(expectedNames[idx]),
              `Mục số ${idx + 1} phải là "${expectedNames[idx]}", thực tế: "${link.text}"`
            );
          });

          // 2. Kiểm tra chỉ duy nhất 1 tiện ích active
          const activeLinks = navLinks.filter(l => l.isActive);
          assert.equal(activeLinks.length, 1, `Trang ${pageConfig.file} chỉ được có đúng 1 tab active`);
          assert.ok(
            navLinks[pageConfig.activeIndex].isActive,
            `Tab active trên ${pageConfig.file} phải là "${expectedNames[pageConfig.activeIndex]}"`
          );

          // 3. Kiểm tra bảo lưu projectId trên các liên kết
          const linksWithProjectId = navLinks.filter((l, idx) => idx > 0 && l.href && l.href.includes('projectId=1'));
          assert.ok(
            linksWithProjectId.length >= 5,
            `Các liên kết tiện ích trên ${pageConfig.file} phải bảo lưu projectId=1`
          );

          // 4. Kiểm tra user-pill và nút đăng xuất
          const userPillVisible = await page.$eval('.user-pill, .user-profile', el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          assert.ok(userPillVisible, `Khối tài khoản trên ${pageConfig.file} phải hiển thị`);

          const logoutBtn = await page.$('.btn-logout, #btnLogout');
          assert.ok(logoutBtn, `Nút đăng xuất trên ${pageConfig.file} phải tồn tại`);

          // 5. Kiểm tra không tràn ngang giao diện toàn trang
          const hasBodyOverflow = await page.evaluate(() => {
            return document.documentElement.scrollWidth > window.innerWidth + 2;
          });
          assert.equal(
            hasBodyOverflow,
            false,
            `Trang ${pageConfig.file} không được tràn ngang ở màn hình ${vp.name}`
          );
        });
      }
    });
  }
  } finally {
    try {
      await browser.close();
    } catch (_) {}
    if (ephemeralServer) {
      ephemeralServer.close();
    }
  }
});
