const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const diaryRoutes = require('../src/routes/diaryRoutes');
const { createSession, inMemoryUsers, inMemorySiteDiaries } = require('../src/models/store');
const { authenticate } = require('../src/utils/rbac');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  const mockDb = { isConnected: false, pool: null };
  app.use('/api', diaryRoutes(mockDb));
  return app;
}

const adminUser = inMemoryUsers.find(u => u.role_id === 1) || { id: 1, email: 'admin@thicong.vn', role_id: 1, role_name: 'admin' };
const pmUser = inMemoryUsers.find(u => u.role_id === 2) || { id: 2, email: 'dtc245160020@ictu.edu.vn', role_id: 2, role_name: 'project_manager' };
const supervisorUser = { id: 6, email: 'supervisor@thicong.vn', role_id: 3, role_name: 'supervisor', full_name: 'Kỹ sư giám sát' };
const contractorUser = { id: 7, email: 'contractor@thicong.vn', role_id: 4, role_name: 'contractor', full_name: 'Đội trưởng' };
const viewerUser = inMemoryUsers.find(u => u.role_id === 7) || { id: 3, email: 'viewer@thicong.vn', role_id: 7, role_name: 'viewer' };

const adminToken = createSession(adminUser);
const pmToken = createSession(pmUser);
const supervisorToken = createSession(supervisorUser);
const contractorToken = createSession(contractorUser);
const viewerToken = createSession(viewerUser);

async function makeRequest(app, method, url, body = null, token = null) {
  const server = app.listen(0);
  const port = server.address().port;
  const targetUrl = `http://localhost:${port}${url}`;

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(targetUrl, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    });
    const status = res.status;
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status, data };
  } finally {
    server.close();
  }
}

test('S-24 / SCRUM-116: Khóa sổ nhật ký thi công, mở khóa theo quyền, lý do bắt buộc và audit log', async (t) => {
  const app = createTestApp();
  const testDate = '2026-10-24';

  // Chuẩn bị dữ liệu ban đầu
  inMemorySiteDiaries.length = 0;
  await makeRequest(app, 'POST', '/api/projects/1/diaries', {
    diary_date: testDate,
    weather_condition: 'sunny',
    manpower_count: 25,
    work_notes: 'Thi công ép cọc đại trà'
  }, pmToken);

  await t.test('TC-S24-01: Chỉ huy trưởng thực hiện khóa sổ nhật ký thành công', async () => {
    const { status, data } = await makeRequest(
      app,
      'POST',
      `/api/projects/1/diaries/${testDate}/lock`,
      {},
      pmToken
    );

    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);
    assert.match(data.message, /Đã khóa sổ/i);

    // Kiểm tra trạng thái nhật ký đã bị khóa
    const detail = await makeRequest(app, 'GET', `/api/projects/1/diaries/${testDate}`, null, pmToken);
    assert.strictEqual(detail.status, 200);
    assert.strictEqual(Number(detail.data.data.is_locked), 1, 'Trường is_locked phải là 1');
  });

  await t.test('TC-S24-02: Sau khi khóa sổ, server từ chối mọi thao tác chỉnh sửa (HTTP 423 Locked)', async () => {
    // Thử cập nhật nhật ký ngày đã khóa
    const updateRes = await makeRequest(app, 'POST', '/api/projects/1/diaries', {
      diary_date: testDate,
      weather_condition: 'rain_all_day',
      manpower_count: 5
    }, pmToken);

    assert.strictEqual(updateRes.status, 423, 'Phải trả về HTTP 423 Locked khi sửa nhật ký đã khóa');
    assert.strictEqual(updateRes.data.success, false);
    assert.match(updateRes.data.message, /khóa sổ/i);
  });

  await t.test('TC-S24-03: Mở khóa sổ bị từ chối nếu thiếu lý do bắt buộc (HTTP 400 Bad Request)', async () => {
    const { status, data } = await makeRequest(
      app,
      'POST',
      `/api/projects/1/diaries/${testDate}/unlock`,
      { reason: '   ' }, // Lý do rỗng
      pmToken
    );

    assert.strictEqual(status, 400);
    assert.strictEqual(data.success, false);
    assert.match(data.message, /Lý do mở khóa là bắt buộc/i);
  });

  await t.test('TC-S24-04: Mở khóa sổ bị từ chối nếu không có quyền phù hợp (HTTP 403 Forbidden)', async () => {
    // Đội trưởng (role contractor) cố tình mở khóa
    const contractorRes = await makeRequest(
      app,
      'POST',
      `/api/projects/1/diaries/${testDate}/unlock`,
      { reason: 'Cần sửa lại số công nhân' },
      contractorToken
    );
    assert.strictEqual(contractorRes.status, 403);
    assert.strictEqual(contractorRes.data.success, false);

    // Kỹ sư giám sát (role supervisor) cố tình mở khóa
    const supervisorRes = await makeRequest(
      app,
      'POST',
      `/api/projects/1/diaries/${testDate}/unlock`,
      { reason: 'Cần sửa lại thời tiết' },
      supervisorToken
    );
    assert.strictEqual(supervisorRes.status, 403);
    assert.strictEqual(supervisorRes.data.success, false);
  });

  await t.test('TC-S24-05: Chỉ huy trưởng mở khóa thành công kèm lý do và ghi nhận audit log', async () => {
    const unlockReason = 'Bổ sung danh sách thiết bị phát sinh ca đêm';
    const { status, data } = await makeRequest(
      app,
      'POST',
      `/api/projects/1/diaries/${testDate}/unlock`,
      { reason: unlockReason },
      pmToken
    );

    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.reason, unlockReason);

    // Kiểm tra nhật ký đã được mở khóa (is_locked = 0)
    const detail = await makeRequest(app, 'GET', `/api/projects/1/diaries/${testDate}`, null, pmToken);
    assert.strictEqual(detail.status, 200);
    assert.strictEqual(Number(detail.data.data.is_locked), 0, 'Sau khi mở khóa, is_locked phải về 0');

    // Sau khi mở khóa, có thể chỉnh sửa lại bình thường
    const editRes = await makeRequest(app, 'POST', '/api/projects/1/diaries', {
      diary_date: testDate,
      weather_condition: 'cloudy',
      manpower_count: 28,
      work_notes: 'Đã bổ sung thiết bị ca đêm'
    }, pmToken);
    assert.strictEqual(editRes.status, 200);
  });

  await t.test('TC-S24-06: Truy vấn audit log mở khóa sổ thể hiện đầy đủ người mở, lý do và thời điểm', async () => {
    const { status, data } = await makeRequest(
      app,
      'GET',
      `/api/projects/1/diaries/${testDate}/unlock-logs`,
      null,
      pmToken
    );

    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.data));
    assert.ok(data.data.length > 0, 'Phải có ít nhất 1 bản ghi audit log');

    const logEntry = data.data.find(l => l.action === 'UNLOCK_DIARY');
    assert.ok(logEntry, 'Phải có bản ghi action UNLOCK_DIARY');
    assert.match(logEntry.reason, /Bổ sung danh sách thiết bị/i);
    assert.ok(logEntry.created_at, 'Phải có thời điểm ghi audit log');
  });
});
