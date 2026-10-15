const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isValidCalendarDate, toDateString, withStartDate, getProjectStartDate } = require('../src/utils/projectStartDate');

test('S-01 start_date: validate YYYY-MM-DD lịch thật', () => {
  assert.equal(isValidCalendarDate('2026-10-08'), true);
  assert.equal(isValidCalendarDate('2026-02-30'), false);
  assert.equal(isValidCalendarDate('08/10/2026'), false);
  assert.equal(isValidCalendarDate(''), false);
  assert.equal(isValidCalendarDate(null), false);
});

test('S-01 start_date: chuẩn hoá Date của mysql2 và chuỗi, null khi chưa có', () => {
  assert.equal(toDateString(new Date(2026, 9, 8)), '2026-10-08');
  assert.equal(toDateString('2026-10-08T00:00:00.000Z'), '2026-10-08');
  assert.equal(toDateString(null), null);
  assert.equal(toDateString('abc'), null);
  assert.deepEqual(withStartDate({ id: 1 }), { id: 1, start_date: null });
});

test('S-01 start_date: đọc từ CSDL, không tự gán ngày giả khi NULL', async () => {
  const fakeDb = (value) => ({ isConnected: true, pool: { query: async () => [[{ start_date: value }]] } });
  assert.equal(await getProjectStartDate(fakeDb(new Date(2026, 9, 8)), 1), '2026-10-08');
  assert.equal(await getProjectStartDate(fakeDb(null), 1), null);
});

test('S-01 migration tiến/lùi start_date tồn tại', () => {
  const up = fs.readFileSync(path.join(__dirname, '../../migration_s01_project_start_date.sql'), 'utf8');
  const down = fs.readFileSync(path.join(__dirname, '../../migration_s01_project_start_date_down.sql'), 'utf8');
  assert.match(up, /ADD COLUMN IF NOT EXISTS start_date DATE NULL/);
  assert.match(down, /DROP COLUMN IF EXISTS start_date/);
});

test('Gantt không dùng ngày khởi công/ngày hiện tại cố định', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../frontend/gantt.html'), 'utf8');
  assert.doesNotMatch(html, /2026-10-01|2026-10-25/);
  assert.match(html, /json\.projectStartDate/);
});
