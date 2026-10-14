const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const teamRoutes = require('../src/routes/teamRoutes');
const { createSession, inMemoryUsers, addProjectMember } = require('../src/models/store');
const { authenticate } = require('../src/utils/rbac');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  const mockDb = { isConnected: false, pool: null };
  app.use('/api', teamRoutes(mockDb));
  return app;
}

const adminUser = inMemoryUsers.find(u => u.role_id === 1) || { id: 1, email: 'admin@thicong.vn', role_id: 1, role_name: 'admin' };
const pmUser = inMemoryUsers.find(u => u.role_id === 2) || { id: 2, email: 'dtc245160020@ictu.edu.vn', role_id: 2, role_name: 'project_manager' };
const viewerUser = inMemoryUsers.find(u => u.role_id === 7) || { id: 3, email: 'viewer@thicong.vn', role_id: 7, role_name: 'viewer' };

const adminToken = createSession(adminUser);
const pmToken = createSession(pmUser);
const viewerToken = createSession(viewerUser);

// Đội trưởng Đội 1 (DOI-01)
const contractor1User = { id: 4, email: 'contractor1@thicong.vn', role_id: 4, role_name: 'contractor', name: 'Nguyễn Văn Đội 1' };
addProjectMember({ projectId: 1, userId: 4, roleId: 4 });
const contractor1Token = createSession(contractor1User);

// Đội trưởng Đội 2 (DOI-02)
const contractor2User = { id: 5, email: 'contractor2@thicong.vn', role_id: 4, role_name: 'contractor', name: 'Trần Văn Cương' };
addProjectMember({ projectId: 1, userId: 5, roleId: 4 });
const contractor2Token = createSession(contractor2User);

async function makeRequest(app, method, url, body = null, token = null) {
  const server = app.listen(0);
  const port = server.address().port;
  const targetUrl = `http://localhost:${port}${url}`;

  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

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

test('S-26 / SCRUM-118: Đội trưởng xem công việc, báo cáo khối lượng và cách ly đội thi công', async (t) => {
  const app = createTestApp();

  await t.test('TC-S26-01: Đội trưởng chỉ xem công việc của đội mình, sắp xếp theo start_date ASC và nhận biết việc găng', async () => {
    // Đội 1 (DOI-01)
    const { status, data } = await makeRequest(app, 'GET', '/api/projects/1/contractor/tasks?team_id=1', null, contractor1Token);

    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.data));
    assert.ok(data.data.length > 0, 'Phải có ít nhất 1 công việc gán cho đội 1');

    // Tất cả các task trả về phải thuộc về đội 1
    data.data.forEach(task => {
      assert.strictEqual(Number(task.team_id), 1, 'Chỉ được xem việc của đội mình');
    });

    // Kiểm tra thứ tự sắp xếp theo start_date ASC
    for (let i = 0; i < data.data.length - 1; i++) {
      const currentStart = new Date(data.data[i].start_date || 0).getTime();
      const nextStart = new Date(data.data[i + 1].start_date || 0).getTime();
      assert.ok(currentStart <= nextStart, 'Danh sách phải được sắp xếp theo start_date tăng dần');
    }

    // Kiểm tra nhận biết việc găng (is_critical boolean)
    const hasCriticalFlag = data.data.some(task => typeof task.is_critical === 'boolean');
    assert.ok(hasCriticalFlag, 'Phải có trường is_critical dạng boolean');
  });

  await t.test('TC-S26-02: Báo cáo khối lượng hoàn thành theo ngày thành công và lưu thời điểm, cập nhật luỹ kế', async () => {
    const reportPayload = {
      team_id: 1,
      report_date: '2026-10-15',
      reported_quantity: 5.5,
      notes: 'Hoàn thành đào hố móng phân đoạn 1'
    };

    // Task 1 thuộc đội 1
    const { status, data } = await makeRequest(
      app,
      'POST',
      '/api/projects/1/contractor/tasks/1/daily-progress',
      reportPayload,
      contractor1Token
    );

    assert.strictEqual(status, 201);
    assert.strictEqual(data.success, true);
    assert.ok(data.data);
    assert.strictEqual(Number(data.data.reported_quantity), 5.5);
    assert.ok(data.data.created_at, 'Phải lưu thời điểm báo cáo');
    assert.ok(data.cumulative_quantity >= 5.5, 'Tổng luỹ kế phải được cập nhật');

    // Kiểm tra API lấy lịch sử báo cáo
    const historyRes = await makeRequest(
      app,
      'GET',
      '/api/projects/1/contractor/tasks/1/daily-progress',
      null,
      contractor1Token
    );

    assert.strictEqual(historyRes.status, 200);
    assert.strictEqual(historyRes.data.success, true);
    const found = historyRes.data.data.find(d => d.notes === 'Hoàn thành đào hố móng phân đoạn 1');
    assert.ok(found, 'Lịch sử báo cáo phải lưu trữ mục vừa gửi');
  });

  await t.test('TC-S26-03: Cảnh báo khi khối lượng báo cáo vượt kế hoạch nhưng VẪN CHO LƯU', async () => {
    // Task 1 gửi báo cáo với khối lượng lớn 999
    const reportPayload = {
      team_id: 1,
      report_date: '2026-10-15',
      reported_quantity: 999,
      notes: 'Khối lượng vượt kế hoạch'
    };

    const { status, data } = await makeRequest(
      app,
      'POST',
      '/api/projects/1/contractor/tasks/1/daily-progress',
      reportPayload,
      contractor1Token
    );

    assert.strictEqual(status, 201, 'Vượt kế hoạch vẫn cho phép lưu');
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.is_exceeded, true, 'is_exceeded phải là true');
    assert.strictEqual(data.warning, 'EXCEEDED_PLANNED_QUANTITY', 'Phải có mã cảnh báo EXCEEDED_PLANNED_QUANTITY');
    assert.ok(data.warning_message, 'Phải có thông điệp cảnh báo vượt khối lượng');
  });

  await t.test('TC-S26-04: Kiểm tra cách ly đội thi công - Không được báo cáo công việc của đội khác (403 Forbidden)', async () => {
    // Task 4 thuộc Đội 2
    // Đội trưởng Đội 1 (contractor1Token, team_id 1) cố gắng báo cáo cho Task 4
    const reportPayload = {
      team_id: 1,
      reported_quantity: 10,
      notes: 'Cố ý báo cáo việc của đội khác'
    };

    const { status, data } = await makeRequest(
      app,
      'POST',
      '/api/projects/1/contractor/tasks/4/daily-progress',
      reportPayload,
      contractor1Token
    );

    assert.strictEqual(status, 403, 'Phải trả về HTTP 403 khi sửa việc đội khác');
    assert.strictEqual(data.success, false);
    assert.match(data.message, /Từ chối|không có quyền/i);
  });

  await t.test('TC-S26-05: Validation từ chối khi khối lượng <= 0 hoặc không hợp lệ (400 Bad Request)', async () => {
    const invalidPayload = {
      team_id: 1,
      reported_quantity: -5,
      notes: 'Khối lượng âm'
    };

    const { status, data } = await makeRequest(
      app,
      'POST',
      '/api/projects/1/contractor/tasks/1/daily-progress',
      invalidPayload,
      contractor1Token
    );

    assert.strictEqual(status, 400);
    assert.strictEqual(data.success, false);
    assert.match(data.message, /Khối lượng báo cáo phải là số dương/i);
  });
});
