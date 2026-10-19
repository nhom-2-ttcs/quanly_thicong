/**
 * ========================================================
 * BỘ KIỂM THỬ: S-32 (SCRUM-145) — XUNG ĐỘT HAI NGƯỜI SỬA CÙNG MỤC ĐƯỢC PHÁT HIỆN VÀ GIỮ CẢ HAI BẢN
 * Epic: SCRUM-122 [E-05] Nhật ký công trường ngoại tuyến
 * Sprint: SCRUM Sprint 4
 *
 * User Story:
 *   "Là ban quản lý dự án tôi muốn biết khi hai người cùng sửa một mục nhật ký lúc ngoại tuyến
 *    để không mất một bản ghi mà không ai hay."
 *
 * Acceptance Criteria (theo Jira):
 *   AC 1: Giả sử hai người cùng sửa một mục khi ngoại tuyến, Khi cả hai đồng bộ,
 *         Thì bản đến sau không ghi đè mà được lưu thành bản xung đột.
 *   AC 2: Giả sử có bản xung đột, Khi kỹ sư giám sát mở mục,
 *         Thì thấy cả hai bản cạnh nhau và chọn bản giữ, bản kia vẫn lưu trong lịch sử.
 *   AC 3: Giả sử hai người sửa hai trường khác nhau của cùng mục, Khi đồng bộ,
 *         Thì hệ thống gộp được và không báo xung đột (3-way field merge).
 *
 * NFR:
 *   - Phát hiện bằng số phiên bản của mục, tăng mỗi lần máy chủ ghi.
 * ========================================================
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

const diaryRoutes = require('../src/routes/diaryRoutes');
const { DiaryService } = require('../src/services/diaryService');
const {
  inMemorySiteDiaries,
  inMemorySiteDiaryItems,
  inMemorySiteDiaryItemConflicts,
  inMemorySiteDiaryItemHistory,
  saveSiteDiaryItem
} = require('../src/models/store');

function createTestApp(diaryServiceInstance) {
  const app = express();
  app.use(express.json());

  // Giả lập middleware user Kỹ sư giám sát
  app.use((req, res, next) => {
    req.user = { id: 3, userId: 3, role_name: 'supervisor', role_id: 3 };
    next();
  });

  const mockDb = { isConnected: false, pool: null };
  app.use('/api', diaryRoutes(mockDb));

  return app;
}

async function request(app, method, url, body = null) {
  const server = app.listen(0);
  const port = server.address().port;
  const targetUrl = `http://localhost:${port}${url}`;

  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(targetUrl, opts);
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } finally {
    server.close();
  }
}

test('=== [S-32 / SCRUM-145] PHÁT HIỆN XUNG ĐỘT NGOẠI TUYẾN & GIỮ CẢ HAI BẢN ===', async (t) => {
  const mockDb = { pool: null };
  const diaryService = new DiaryService(mockDb);
  const app = createTestApp(diaryService);

  const PROJECT_ID = 1;
  const TEST_DATE = '2026-10-14';

  function resetTestData() {
    inMemorySiteDiaries.length = 0;
    inMemorySiteDiaryItems.length = 0;
    inMemorySiteDiaryItemConflicts.length = 0;
    inMemorySiteDiaryItemHistory.length = 0;

    inMemorySiteDiaries.push({
      id: 10,
      project_id: PROJECT_ID,
      diary_date: TEST_DATE,
      weather_condition: 'sunny',
      is_rain_day: 0,
      manpower_count: 15,
      is_locked: 0,
      created_by: 3
    });
  }

  await t.test('NFR: Số phiên bản tăng mỗi lần máy chủ ghi', async () => {
    resetTestData();

    // Khởi tạo mục nhật ký ban đầu: version = 1
    const item = saveSiteDiaryItem({
      diary_id: 10,
      work_item_id: 1,
      work_content: 'Đào móng hố trụ T1',
      log_time: '08:00',
      quantity_done: 10,
      unit: 'm3'
    });

    assert.equal(item.version, 1, 'Mục mới tạo phải có version = 1');
    assert.equal(item.has_conflict, 0, 'Mục mới tạo không có cờ xung đột');

    // Người thứ nhất đồng bộ cập nhật hợp lệ (base_version = 1 >= current_version = 1)
    const syncRes = await request(app, 'POST', `/api/projects/${PROJECT_ID}/diary-items/sync`, {
      item_id: item.id,
      base_version: 1,
      work_content: 'Đào móng hố trụ T1 và đầm đất nền',
      quantity_done: 15
    });

    assert.equal(syncRes.status, 200);
    assert.equal(syncRes.body.conflict, false);
    assert.equal(syncRes.body.item.version, 2, 'Version phải tăng lên 2 sau khi máy chủ ghi nhận');
  });

  await t.test('AC 1: Hai người cùng sửa một mục khi ngoại tuyến -> Bản đến sau không ghi đè, lưu thành bản xung đột', async () => {
    resetTestData();

    // 1. Tạo mục ban đầu trên server (version = 1)
    const baseItem = saveSiteDiaryItem({
      diary_id: 10,
      work_item_id: 1,
      work_content: 'Lắp dựng cốt thép dầm móng D1',
      log_time: '08:30',
      quantity_done: 5,
      unit: 'tấn'
    });

    // 2. Hai người A và B cùng tải dữ liệu này về điện thoại (cả 2 đều có base_version = 1)
    // Người A ngoại tuyến sửa thành: khối lượng 8 tấn.
    // Người B ngoại tuyến cùng sửa trường khối lượng thành: 12 tấn.

    // 3. Người A có mạng trước, đồng bộ lên server -> Thành công, máy chủ lên version 2
    const resA = await request(app, 'POST', `/api/projects/${PROJECT_ID}/diary-items/sync`, {
      item_id: baseItem.id,
      base_version: 1,
      work_content: 'Lắp dựng cốt thép dầm móng D1',
      log_time: '08:30',
      quantity_done: 8, // Người A sửa 5 -> 8
      unit: 'tấn'
    });
    assert.equal(resA.status, 200);
    assert.equal(resA.body.item.version, 2);
    assert.equal(resA.body.item.quantity_done, 8);

    // 4. Người B có mạng sau, gửi đồng bộ lên máy chủ với base_version = 1 (trong khi máy chủ đã là version 2)
    // Người B cũng sửa quantity_done thành 12
    const resB = await request(app, 'POST', `/api/projects/${PROJECT_ID}/diary-items/sync`, {
      item_id: baseItem.id,
      base_version: 1,
      work_content: 'Lắp dựng cốt thép dầm móng D1',
      log_time: '08:30',
      quantity_done: 12, // Người B sửa 5 -> 12
      unit: 'tấn'
    });

    // AC 1: Không ghi đè bản của người A (vẫn giữ quantity_done = 8 trên server)
    assert.equal(resB.status, 409, 'Phải trả về HTTP 409 Conflict');
    assert.equal(resB.body.conflict, true);
    assert.ok(resB.body.conflict_id, 'Phải có conflict_id');
    assert.deepEqual(resB.body.conflicted_fields, ['quantity_done'], 'Trường xung đột phải là quantity_done');

    // Kiểm tra dữ liệu trên máy chủ: Bản đến sau KHÔNG GHI ĐÈ!
    const checkItem = inMemorySiteDiaryItems.find(i => i.id === baseItem.id);
    assert.equal(checkItem.quantity_done, 8, 'Máy chủ vẫn bảo toàn bản ghi 8 tấn của người đến trước');
    assert.equal(checkItem.has_conflict, 1, 'Mục phải được đánh dấu has_conflict = 1');

    // Kiểm tra bản xung đột đã được lưu trong bảng conflicts
    const conflicts = await request(app, 'GET', `/api/projects/${PROJECT_ID}/diary-items/conflicts?itemId=${baseItem.id}`);
    assert.equal(conflicts.status, 200);
    assert.equal(conflicts.body.data.length, 1);
    assert.equal(conflicts.body.data[0].status, 'pending');
    assert.equal(conflicts.body.data[0].client_version_data.quantity_done, 12);
    assert.equal(conflicts.body.data[0].server_version_data.quantity_done, 8);
  });

  await t.test('AC 3: Hai người sửa hai trường khác nhau -> Hệ thống tự động gộp (3-way merge) và không báo xung đột', async () => {
    resetTestData();

    // Tạo mục gốc (version 1): log_time = '08:00', quantity_done = 10, work_content = 'Đổ bê tông sàn'
    const baseItem = saveSiteDiaryItem({
      diary_id: 10,
      work_item_id: 2,
      work_content: 'Đổ bê tông sàn tầng 2',
      log_time: '08:00',
      quantity_done: 20,
      unit: 'm3'
    });

    // Cả A và B đều lấy dữ liệu gốc lúc offline (base_version = 1, base_data)
    const baseSnapshot = {
      work_item_id: 2,
      work_content: 'Đổ bê tông sàn tầng 2',
      log_time: '08:00',
      quantity_done: 20,
      unit: 'm3'
    };

    // Người A chỉ sửa thời gian: log_time từ '08:00' -> '09:30' (giữ nguyên content và quantity)
    const resA = await request(app, 'POST', `/api/projects/${PROJECT_ID}/diary-items/sync`, {
      item_id: baseItem.id,
      base_version: 1,
      base_data: baseSnapshot,
      work_item_id: 2,
      work_content: 'Đổ bê tông sàn tầng 2',
      log_time: '09:30',
      quantity_done: 20,
      unit: 'm3'
    });
    assert.equal(resA.status, 200);
    assert.equal(resA.body.item.version, 2);

    // Người B chỉ sửa khối lượng: quantity_done từ 20 -> 35 (giữ nguyên log_time = '08:00')
    const resB = await request(app, 'POST', `/api/projects/${PROJECT_ID}/diary-items/sync`, {
      item_id: baseItem.id,
      base_version: 1,
      base_data: baseSnapshot,
      work_item_id: 2,
      work_content: 'Đổ bê tông sàn tầng 2',
      log_time: '08:00',
      quantity_done: 35,
      unit: 'm3'
    });

    // AC 3: Hệ thống gộp được và không báo xung đột!
    assert.equal(resB.status, 200);
    assert.equal(resB.body.conflict, false);
    assert.equal(resB.body.merged, true, 'Phải kích hoạt auto_merged');
    assert.equal(resB.body.item.log_time, '09:30', 'Phải giữ trường log_time của người A');
    assert.equal(resB.body.item.quantity_done, 35, 'Phải cập nhật trường quantity_done của người B');
    assert.equal(resB.body.item.has_conflict, 0, 'Không báo xung đột');
    assert.equal(resB.body.item.version, 3, 'Version máy chủ tăng tiếp lên 3');

    // Kiểm tra lịch sử tự động gộp
    const historyRes = await request(app, 'GET', `/api/projects/${PROJECT_ID}/diary-items/${baseItem.id}/history`);
    assert.equal(historyRes.status, 200);
    const autoMergedEntry = historyRes.body.data.find(h => h.change_type === 'auto_merged');
    assert.ok(autoMergedEntry, 'Phải có bản ghi lịch sử change_type = auto_merged');
  });

  await t.test('AC 2: Kỹ sư giám sát đối chiếu hai bản cạnh nhau và chọn bản giữ, bản kia vẫn lưu trong lịch sử', async () => {
    resetTestData();

    // 1. Tạo mục và tạo ra 1 xung đột
    const item = saveSiteDiaryItem({
      diary_id: 10,
      work_item_id: 1,
      work_content: 'Xây tường gạch ống T1',
      log_time: '10:00',
      quantity_done: 50,
      unit: 'm2'
    });

    // Người A đồng bộ trước -> server v2 (quantity_done = 60)
    await request(app, 'POST', `/api/projects/${PROJECT_ID}/diary-items/sync`, {
      item_id: item.id,
      base_version: 1,
      work_content: 'Xây tường gạch ống T1 (Đội A)',
      quantity_done: 60
    });

    // Người B đồng bộ sau -> Xung đột (quantity_done = 80)
    const conflictRes = await request(app, 'POST', `/api/projects/${PROJECT_ID}/diary-items/sync`, {
      item_id: item.id,
      base_version: 1,
      work_content: 'Xây tường gạch ống T1 (Đội B)',
      quantity_done: 80
    });
    assert.equal(conflictRes.status, 409);
    const conflictId = conflictRes.body.conflict_id;

    // 2. Kỹ sư giám sát xem danh sách xung đột (thấy cả hai bản cạnh nhau)
    const listRes = await request(app, 'GET', `/api/projects/${PROJECT_ID}/diary-items/conflicts?itemId=${item.id}`);
    assert.equal(listRes.status, 200);
    const conflictData = listRes.body.data[0];
    assert.equal(conflictData.server_version_data.quantity_done, 60);
    assert.equal(conflictData.client_version_data.quantity_done, 80);

    // 3. Kỹ sư giám sát quyết định chọn giữ bản ngoại tuyến của Người B ('keep_incoming')
    const resolveRes = await request(app, 'POST', `/api/projects/${PROJECT_ID}/diary-items/conflicts/${conflictId}/resolve`, {
      choice: 'keep_incoming'
    });
    assert.equal(resolveRes.status, 200);
    assert.equal(resolveRes.body.resolved_choice, 'keep_incoming');
    assert.equal(resolveRes.body.item.quantity_done, 80, 'Mục chính thức phải cập nhật theo bản được chọn');
    assert.equal(resolveRes.body.item.has_conflict, 0, 'Cờ xung đột phải được xóa về 0');

    // 4. Kiểm tra lịch sử: Bản kia (bản máy chủ cũ 60m2) vẫn được lưu trong lịch sử!
    const histRes = await request(app, 'GET', `/api/projects/${PROJECT_ID}/diary-items/${item.id}/history`);
    assert.equal(histRes.status, 200);
    const superseded = histRes.body.data.find(h => h.change_type === 'conflict_superseded');
    assert.ok(superseded, 'Bản không được chọn phải được lưu vết trong lịch sử với change_type = conflict_superseded');
    assert.equal(superseded.quantity_done, 60, 'Bản cũ được lưu bảo toàn trong lịch sử');

    const resolved = histRes.body.data.find(h => h.change_type === 'conflict_resolved');
    assert.ok(resolved, 'Bản được chọn phải có vết change_type = conflict_resolved');
    assert.equal(resolved.quantity_done, 80);
  });

  await t.test('Kiểm tra file migration SQL cho S-32', () => {
    const upMigrationPath = path.join(__dirname, '..', '..', 'migration_s32_conflict_detection_and_resolution.sql');
    const downMigrationPath = path.join(__dirname, '..', '..', 'migration_s32_conflict_detection_and_resolution_down.sql');

    assert.ok(fs.existsSync(upMigrationPath), 'File migration_s32_conflict_detection_and_resolution.sql phải tồn tại');
    assert.ok(fs.existsSync(downMigrationPath), 'File migration_s32_conflict_detection_and_resolution_down.sql phải tồn tại');

    const sqlContent = fs.readFileSync(upMigrationPath, 'utf8');
    assert.ok(sqlContent.includes('site_diary_item_conflicts'), 'SQL phải tạo bảng site_diary_item_conflicts');
    assert.ok(sqlContent.includes('site_diary_item_history'), 'SQL phải tạo bảng site_diary_item_history');
    assert.ok(sqlContent.includes('version'), 'SQL phải bổ sung trường version');
    assert.ok(sqlContent.includes('has_conflict'), 'SQL phải bổ sung trường has_conflict');
  });
});
