const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { dateToCoordinateX, calculateBarWidth, addDaysToDate } = require('../../frontend/js/timelineScale');

test('S-13 / T-30: 3 mốc tính tay trục thời gian và dự án 18 tháng', () => {
  assert.strictEqual(dateToCoordinateX('2026-10-01', '2026-10-01', 'day', 40, 105), 0);
  assert.strictEqual(dateToCoordinateX('2026-10-08', '2026-10-01', 'day', 40, 105), 280);
  assert.strictEqual(dateToCoordinateX('2026-10-15', '2026-10-01', 'day', 40, 105), 560);
  assert.strictEqual(calculateBarWidth('2026-10-15', '2026-10-20', 'day', 40, 105), 200);
  assert.ok(dateToCoordinateX('2028-03-24', '2026-10-01', 'week', 40, 105) > 0);
  assert.strictEqual(addDaysToDate('2026-10-01', 5), '2026-10-06');
});

test('S-13 / T-31 E2E: Nạp API T-27, chu trình, 500 thanh và mobile', async () => {
  let mockMode = 'normal';
  let progressPayload = null;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.startsWith('/api/projects/') && url.pathname.endsWith('/scheduling/results')) {
      if (mockMode === 'cycle') {
        res.writeHead(422);
        return res.end(JSON.stringify({ success: false, hasCycle: true, cyclePath: ['A', 'B', 'C', 'A'] }));
      }
      if (mockMode === '500') {
        const tasks = Array.from({ length: 500 }, (_, i) => ({ taskId: i + 1, code: `CV-${i + 1}`, name: `Công việc số ${i + 1}`, earlyStart: i % 30, earlyFinish: (i % 30) + 3, duration: 3, isCritical: i % 5 === 0 }));
        return res.end(JSON.stringify({ success: true, projectDuration: 40, tasks }));
      }
      return res.end(JSON.stringify({ success: true, projectDuration: 20, tasks: [
        { taskId: 1, code: 'CV-01', name: 'Đào móng', earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
        { taskId: 2, code: 'CV-02', name: 'Đổ bê tông', earlyStart: 5, earlyFinish: 10, lateStart: 7, lateFinish: 12, totalFloat: 2, isCritical: false }
      ] }));
    }
    if (url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/progress')) {
      progressPayload = JSON.parse(await new Promise(resolve => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => resolve(body));
      }));
      return res.end(JSON.stringify({ success: true, message: 'Cập nhật tiến độ thành công' }));
    }
    if (url.pathname.startsWith('/api/projects/')) {
      return res.end(JSON.stringify({ success: true, data: { id: 1, start_date: '2026-10-01' } }));
    }
    const fp = path.join(__dirname, '../../frontend', url.pathname === '/' ? 'gantt.html' : url.pathname);
    if (fs.existsSync(fp)) {
      const ext = path.extname(fp);
      res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : (ext === '.js' ? 'application/javascript' : 'text/css') });
      return res.end(fs.readFileSync(fp));
    }
    res.writeHead(404); res.end('Not found');
  });

  await new Promise(r => server.listen(0, r));
  const baseUrl = `http://localhost:${server.address().port}/gantt.html`;
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}?projectId=1`);
    await page.waitForSelector('.gantt-bar');
    assert.strictEqual(await page.locator('.gantt-bar').count(), 2);
    await page.click('#btnWeek');
    assert.strictEqual(await page.locator('#btnWeek').getAttribute('class'), 'active');

    // S-14: Lọc việc găng
    await page.click('#btnFilterCrit');
    assert.strictEqual(await page.locator('.gantt-bar').count(), 1);
    await page.click('#btnFilterCrit');
    assert.strictEqual(await page.locator('.gantt-bar').count(), 2);

    await page.locator('.gantt-bar').first().hover();
    await page.waitForSelector('#ganttTooltip');
    const tt = await page.locator('#ganttTooltip').innerText();
    assert.ok(tt.includes('Khởi sớm (ES)') && tt.includes('Độ trễ cho phép (Float)'));
    assert.ok(tt.includes('Kết sớm (EF)') && tt.includes('Khởi muộn (LS)') && tt.includes('Kết muộn (LF)'));

    await page.locator('.gantt-bar').first().click();
    await page.locator('#timelineHeader').click();
    assert.strictEqual(await page.locator('#ganttTooltip').evaluate(el => getComputedStyle(el).display), 'none');
    await page.locator('.gantt-bar').first().hover();

    await page.locator('#ganttTooltip button').click();
    assert.strictEqual(await page.locator('#progModal').isVisible(), true);
    await page.fill('#progActStart', '2026-10-10');
    await page.fill('#progActEnd', '2026-10-08');
    await page.fill('#progPercent', '75');
    await page.click('button:text("Lưu")');
    assert.strictEqual(await page.locator('#progError').isVisible(), true);
    assert.strictEqual(progressPayload, null, 'Ngày không hợp lệ phải bị chặn trước khi gọi API');
    await page.fill('#progActEnd', '2026-10-11');
    await page.click('button:text("Lưu")');
    await page.waitForFunction(() => !document.getElementById('progModal') || document.getElementById('progModal').style.display === 'none');
    assert.strictEqual(await page.locator('#progModal').isVisible(), false);
    assert.deepStrictEqual(progressPayload, {
      actual_start: '2026-10-10', actual_end: '2026-10-11', percent_complete: 75, confirm_reopen: false
    });

    mockMode = 'cycle';
    await page.goto(`${baseUrl}?projectId=1`);
    await page.waitForSelector('#cycleAlert');
    assert.strictEqual(await page.locator('#cycleAlert').isVisible(), true);
    assert.strictEqual(await page.locator('#ganttContainer').isVisible(), false);
    assert.ok((await page.locator('#cycleAlert').innerText()).includes('A → B → C → A'));

    mockMode = '500';
    const t0 = Date.now();
    await page.goto(`${baseUrl}?projectId=1`);
    await page.waitForFunction(() => document.querySelectorAll('.gantt-bar').length === 500);
    const renderTime = Date.now() - t0;
    assert.ok(renderTime < 3000, `500 thanh render mất ${renderTime}ms (> 3000ms)`);

    await page.setViewportSize({ width: 390, height: 844 });
    const colBox = await page.locator('.task-col').boundingBox();
    assert.ok(colBox && colBox.width <= 150, 'Cột tên trên mobile phải <= 150px');
    await page.evaluate(() => { document.getElementById('timelineCol').scrollLeft = 200; });
    const colScrolled = await page.locator('.task-col').boundingBox();
    assert.strictEqual(colScrolled.x, colBox.x, 'Cột tên phải cố định vị trí X khi cuộn');
  } finally {
    await browser.close();
    server.close();
  }
});
