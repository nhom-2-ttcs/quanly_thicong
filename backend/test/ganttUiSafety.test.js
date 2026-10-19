const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ganttHtml = fs.readFileSync(path.join(__dirname, '../../frontend/gantt.html'), 'utf8');

test('Gantt page keeps navigation separate from Gantt-only actions', () => {
  assert.match(ganttHtml, /<nav class="module-nav" aria-label="Tiện ích dự án">/);
  assert.match(ganttHtml, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(ganttHtml, /target\.searchParams\.set\('projectId'/);
  assert.match(ganttHtml, /<div class="top-actions">[\s\S]*?id="btnFilterCrit"[\s\S]*?id="btnLockBaseline"/);
  assert.match(ganttHtml, /@media \(max-width: 560px\)/);
  assert.match(ganttHtml, /\.timeline-col\s*\{[^}]*min-width:\s*0/s);
});

test('Gantt never hides a failed API request behind fabricated project data', () => {
  assert.doesNotMatch(ganttHtml, /fallbackProjectData|BỘ DỮ LIỆU CÔNG TRƯỜNG MẪU/);
  assert.doesNotMatch(ganttHtml, /Dự án mẫu thi công|15\/11\/2026|18\/11\/2026/);
  assert.match(ganttHtml, /id="ganttStatus"[^>]*role="status"/);
  assert.match(ganttHtml, /Không thể tải dữ liệu Gantt/);
  assert.match(ganttHtml, /Không lưu được tiến độ/);
  assert.match(ganttHtml, /Không chốt được kế hoạch gốc/);
});

test('Gantt HTML contains no unresolved Git merge markers', () => {
  assert.doesNotMatch(ganttHtml, /^<{7}\s|^={7}\s|^>{7}\s/m);
});
