const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const path = require('path');
const diaryRoutes = require('../src/routes/diaryRoutes');
const {
  createSession,
  inMemoryUsers,
  inMemorySiteDiaries,
  inMemoryDiaryConflicts
} = require('../src/models/store');
const { authenticate } = require('../src/utils/rbac');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  const mockDb = { isConnected: false, pool: null };
  app.use('/api', diaryRoutes(mockDb));
  return app;
}

const pmUser = inMemoryUsers.find(u => u.role_id === 2) || { id: 2, email: 'dtc245160020@ictu.edu.vn', role_id: 2, role_name: 'project_manager' };
const viewerUser = inMemoryUsers.find(u => u.role_id === 3) || { id: 3, email: 'viewer@ictu.edu.vn', role_id: 3, role_name: 'viewer' };
const pmToken = createSession(pmUser);
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

test('S-32 / SCRUM-145: Xử lý xung đột phiên bản (Optimistic Concurrency) và Auto-Merge', async (t) => {
  const app = createTestApp();

  // Reset store trước các test case
  inMemorySiteDiaries.length = 0;
  inMemoryDiaryConflicts.length = 0;

  const projectId = 1;
  const testDate = '2026-10-28';

  await t.test('TC-S32-01: Khởi tạo nhật ký phiên bản 1 và kiểm tra tự tăng version khi cập nhật', async () => {
    // 1. Tạo mới nhật ký ban đầu
    const createRes = await makeRequest(app, 'POST', `/api/projects/${projectId}/diaries`, {
      diary_date: testDate,
      weather_condition: 'sunny',
      manpower_count: 15,
      equipment_status: '1 Máy ủi',
      work_notes: 'Bản gốc phiên bản 1'
    }, pmToken);

    assert.strictEqual(createRes.status, 200);
    assert.strictEqual(createRes.data.success, true);
    assert.strictEqual(createRes.data.data.version, 1, 'Nhật ký tạo mới phải có version = 1');

    // 2. Cập nhật với đúng version = 1
    const updateRes = await makeRequest(app, 'PUT', `/api/projects/${projectId}/diaries/${testDate}`, {
      version: 1,
      manpower_count: 20,
      work_notes: 'Cập nhật lần 1 lên phiên bản 2'
    }, pmToken);

    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.data.success, true);
    assert.strictEqual(updateRes.data.data.version, 2, 'Version phải tự động tăng lên 2 sau khi cập nhật');
  });

  await t.test('TC-S32-02: Tự động gộp an toàn (Auto-Merge) khi hai người sửa hai trường khác nhau', async () => {
    // Hiện tại server đang ở version = 2:
    // manpower_count = 20, equipment_status = '1 Máy ủi', weather_notes = ''
    
    // Client B có dữ liệu cơ sở từ version 1 (base_version_data: equipment_status = '1 Máy ủi')
    // Client B muốn cập nhật thiết bị thành '1 Máy ủi, 1 Cần cẩu' (không sửa manpower_count)
    const clientBUpdate = {
      version: 1, // Client B gửi phiên bản cũ hơn server (1 < 2)
      base_version_data: {
        manpower_count: 15,
        equipment_status: '1 Máy ủi'
      },
      equipment_status: '1 Máy ủi, 1 Cần cẩu'
    };

    const mergeRes = await makeRequest(app, 'PUT', `/api/projects/${projectId}/diaries/${testDate}`, clientBUpdate, pmToken);
    
    assert.strictEqual(mergeRes.status, 200);
    assert.strictEqual(mergeRes.data.success, true);
    assert.strictEqual(mergeRes.data.data.auto_merged, true, 'Phải tự động gộp hai trường không trùng lặp');
    assert.strictEqual(mergeRes.data.data.manpower_count, 20, 'Giữ nguyên manpower_count đã cập nhật ở version 2');
    assert.strictEqual(mergeRes.data.data.equipment_status, '1 Máy ủi, 1 Cần cẩu', 'Gộp thành công equipment_status mới');
  });

  await t.test('TC-S32-03: Phát hiện xung đột, trả về HTTP 409 và giữ cả hai bản khi sửa cùng một trường', async () => {
    // Lấy thông tin nhật ký hiện tại
    const currentRes = await makeRequest(app, 'GET', `/api/projects/${projectId}/diaries/${testDate}`, null, pmToken);
    const currentVersion = currentRes.data.data.version;

    // Giả sử Client C đang ở version cũ (currentVersion - 1) và cũng sửa work_notes
    const clientCUpdate = {
      version: currentVersion - 1,
      base_version_data: {
        work_notes: 'Bản gốc phiên bản 1'
      },
      work_notes: 'Nội dung xung đột từ Client C'
    };

    const conflictRes = await makeRequest(app, 'PUT', `/api/projects/${projectId}/diaries/${testDate}`, clientCUpdate, pmToken);
    
    assert.strictEqual(conflictRes.status, 409, 'Phải trả về HTTP 409 Conflict khi sửa cùng trường');
    assert.strictEqual(conflictRes.data.conflict, true);
    assert.ok(conflictRes.data.data.server_data, 'Phải có server_data');
    assert.ok(conflictRes.data.data.client_data, 'Phải có client_data');

    // Kiểm tra bản ghi xung đột được lưu trong bảng diary_conflicts
    const conflictsListRes = await makeRequest(app, 'GET', `/api/projects/${projectId}/diary-conflicts?status=pending`, null, pmToken);
    assert.strictEqual(conflictsListRes.status, 200);
    assert.strictEqual(conflictsListRes.data.data.length, 1, 'Phải lưu 1 bản ghi xung đột chưa giải quyết');
    const conflictRecord = conflictsListRes.data.data[0];
    assert.strictEqual(conflictRecord.status, 'pending');
    assert.strictEqual(conflictRecord.auto_merged, 0);
  });

  await t.test('TC-S32-04: Giải quyết xung đột với lựa chọn giữ bản client (keep_client)', async () => {
    const conflictsRes = await makeRequest(app, 'GET', `/api/projects/${projectId}/diary-conflicts?status=pending`, null, pmToken);
    const conflictId = conflictsRes.data.data[0].id;

    // Giải quyết bằng cách chọn bản client
    const resolveRes = await makeRequest(app, 'POST', `/api/projects/${projectId}/diary-conflicts/${conflictId}/resolve`, {
      choice: 'keep_client'
    }, pmToken);

    assert.strictEqual(resolveRes.status, 200);
    assert.strictEqual(resolveRes.data.success, true);
    assert.strictEqual(resolveRes.data.status, 'resolved_client');

    // Kiểm tra dữ liệu hiện tại của nhật ký đã áp dụng nội dung Client C
    const verifyRes = await makeRequest(app, 'GET', `/api/projects/${projectId}/diaries/${testDate}`, null, pmToken);
    assert.strictEqual(verifyRes.data.data.work_notes, 'Nội dung xung đột từ Client C');

    // Kiểm tra trong lịch sử xung đột, bản ghi vẫn lưu trữ đầy đủ cả hai bản
    const historyRes = await makeRequest(app, 'GET', `/api/projects/${projectId}/diary-conflicts`, null, pmToken);
    const resolvedRecord = historyRes.data.data.find(c => c.id === conflictId);
    assert.strictEqual(resolvedRecord.status, 'resolved_client');
    assert.ok(resolvedRecord.server_data, 'Bản server cũ vẫn được lưu trong lịch sử, không bị mất');
  });

  await t.test('TC-S32-05: RBAC - Quyền Viewer không được phép sửa nhật ký hoặc giải quyết xung đột', async () => {
    // 1. Viewer không được gọi PUT sửa nhật ký
    const putRes = await makeRequest(app, 'PUT', `/api/projects/${projectId}/diaries/${testDate}`, {
      work_notes: 'Viewer cố ý sửa'
    }, viewerToken);
    assert.strictEqual(putRes.status, 403, 'Viewer phải bị chặn HTTP 403 khi sửa');

    // 2. Viewer không được gọi resolve xung đột
    const resolveRes = await makeRequest(app, 'POST', `/api/projects/${projectId}/diary-conflicts/1/resolve`, {
      choice: 'keep_server'
    }, viewerToken);
    assert.strictEqual(resolveRes.status, 403, 'Viewer phải bị chặn HTTP 403 khi resolve');
  });

  await t.test('TC-S32-06: Xác thực tính toàn vẹn của file migration S-32 UP và DOWN', () => {
    const upFile = path.join(__dirname, '../../migration_s32_conflict_resolution.sql');
    const downFile = path.join(__dirname, '../../migration_s32_conflict_resolution_down.sql');

    assert.ok(fs.existsSync(upFile), 'Phải có file migration_s32_conflict_resolution.sql');
    assert.ok(fs.existsSync(downFile), 'Phải có file migration_s32_conflict_resolution_down.sql');

    const upContent = fs.readFileSync(upFile, 'utf8');
    const downContent = fs.readFileSync(downFile, 'utf8');

    assert.ok(upContent.includes('CREATE TABLE IF NOT EXISTS `diary_conflicts`'));
    assert.ok(upContent.includes('ADD COLUMN `version`'));
    assert.ok(downContent.includes('DROP TABLE IF EXISTS `diary_conflicts`'));
    assert.ok(downContent.includes('DROP COLUMN `version`'));
  });
});
