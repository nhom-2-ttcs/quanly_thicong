const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const acceptanceRoutes = require('../src/routes/acceptanceRoutes');
const {
  createSession,
  inMemoryUsers,
  addProjectMember,
  inMemoryWorkItems,
  inMemoryTeamDailyProgress,
  inMemoryAcceptanceSheets,
  inMemoryAcceptanceSheetItems,
  inMemoryAcceptanceSheetPhotos
} = require('../src/models/store');
const { authenticate } = require('../src/utils/rbac');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  const mockDb = { isConnected: false, pool: null };
  app.use('/api', acceptanceRoutes(mockDb));
  return app;
}

// User tokens
const adminUser = inMemoryUsers.find(u => u.role_id === 1) || { id: 1, email: 'admin@thicong.vn', role_id: 1, role_name: 'admin' };
const pmUser = inMemoryUsers.find(u => u.role_id === 2) || { id: 2, email: 'pm@thicong.vn', role_id: 2, role_name: 'project_manager' };
const supervisorUser = { id: 10, email: 'supervisor@thicong.vn', role_id: 3, role_name: 'site_manager' };
const contractorUser = { id: 11, email: 'contractor@thicong.vn', role_id: 4, role_name: 'contractor' };
const viewerUser = inMemoryUsers.find(u => u.role_id === 7) || { id: 12, email: 'viewer@thicong.vn', role_id: 7, role_name: 'viewer' };

addProjectMember({ projectId: 1, userId: adminUser.id, roleId: 1 });
addProjectMember({ projectId: 1, userId: pmUser.id, roleId: 2 });
addProjectMember({ projectId: 1, userId: supervisorUser.id, roleId: 3 });
addProjectMember({ projectId: 1, userId: contractorUser.id, roleId: 4 });
addProjectMember({ projectId: 1, userId: viewerUser.id, roleId: 7 });

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

test('S-36 (SCRUM-165) Acceptance Sheets - Comprehensive Test Suite', async (t) => {
  const app = createTestApp();
  const projectId = 1;

  // Setup seed work items if needed
  if (!inMemoryWorkItems.find(w => w.id === 101)) {
    inMemoryWorkItems.push({
      id: 101,
      project_id: projectId,
      code: 'HM-01',
      name: 'Đào đất hố móng',
      unit: 'm3',
      contract_quantity: 500,
      planned_quantity: 500
    });
  }
  if (!inMemoryWorkItems.find(w => w.id === 102)) {
    inMemoryWorkItems.push({
      id: 102,
      project_id: projectId,
      code: 'HM-02',
      name: 'Bê tông lót móng',
      unit: 'm3',
      contract_quantity: 120,
      planned_quantity: 120
    });
  }

  // Setup team reported progress in S-26
  inMemoryTeamDailyProgress.push({
    id: 991,
    project_id: projectId,
    task_id: 1,
    work_item_id: 101,
    team_id: 1,
    report_date: '2026-10-10',
    reported_quantity: 80,
    status: 'SUBMITTED'
  });
  inMemoryTeamDailyProgress.push({
    id: 992,
    project_id: projectId,
    task_id: 2,
    work_item_id: 101,
    team_id: 1,
    report_date: '2026-10-11',
    reported_quantity: 45,
    status: 'APPROVED'
  });
  inMemoryTeamDailyProgress.push({
    id: 993,
    project_id: projectId,
    task_id: 3,
    work_item_id: 102,
    team_id: 2,
    report_date: '2026-10-11',
    reported_quantity: 30,
    status: 'APPROVED'
  });

  await t.test('T-70 (SCRUM-179): Lấy dữ liệu điền sẵn (prefill) gồm luỹ kế duyệt đợt trước & số đội báo S-26', async () => {
    const res = await makeRequest(
      app,
      'GET',
      `/api/projects/${projectId}/acceptance-sheets/prefill`,
      null,
      supervisorToken
    );

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.ok(Array.isArray(res.data.data.items), 'Items must be an array');

    const item101 = res.data.data.items.find(i => i.work_item_id === 101);
    assert.ok(item101, 'Work item 101 should exist in prefill');
    // Chưa có đợt nào duyệt, luỹ kế trước = 0
    assert.equal(item101.previous_approved_quantity, 0);
    // Số đội báo = 80 + 45 = 125
    assert.equal(item101.team_reported_quantity, 125);

    const item102 = res.data.data.items.find(i => i.work_item_id === 102);
    assert.ok(item102, 'Work item 102 should exist in prefill');
    assert.equal(item102.previous_approved_quantity, 0);
    assert.equal(item102.team_reported_quantity, 30);
  });

  let createdSheet1Id = null;

  await t.test('T-71 (SCRUM-180): Tạo phiếu nghiệm thu Đợt 1 và tự tính khối lượng đợt phát sinh', async () => {
    const sheetData = {
      sheet_code: 'NT-D01-2026',
      title: 'Nghiệm thu khối lượng Đợt 1 - Hố móng & Bê tông lót',
      period_number: 1,
      cutoff_date: '2026-10-15',
      note: 'Nghiệm thu hoàn thành giai đoạn đào đất',
      items: [
        {
          work_item_id: 101,
          cumulative_quantity: 120, // Kỹ sư giám sát ghi luỹ kế là 120
          note: 'Đã hoàn tất đào hố móng khu A'
        },
        {
          work_item_id: 102,
          cumulative_quantity: 28, // Kỹ sư ghi 28
          note: 'Đổ bê tông lót trục 1-4'
        }
      ]
    };

    const res = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets`,
      sheetData,
      supervisorToken
    );

    assert.equal(res.status, 201);
    assert.equal(res.data.success, true);
    assert.ok(res.data.data.id, 'Sheet ID should be returned');
    createdSheet1Id = res.data.data.id;

    // Kiểm tra tự tính khối lượng đợt = luỹ kế hiện tại - luỹ kế đợt trước (0)
    const item1 = res.data.data.items.find(i => i.work_item_id === 101);
    assert.equal(item1.previous_approved_quantity, 0);
    assert.equal(item1.cumulative_quantity, 120);
    assert.equal(item1.period_quantity, 120, 'period_quantity = 120 - 0 = 120');
    // Số đội báo là 125, chênh lệch = 120 - 125 = -5
    assert.equal(item1.team_reported_quantity, 125);
    assert.equal(item1.difference, -5);

    const item2 = res.data.data.items.find(i => i.work_item_id === 102);
    assert.equal(item2.previous_approved_quantity, 0);
    assert.equal(item2.cumulative_quantity, 28);
    assert.equal(item2.period_quantity, 28, 'period_quantity = 28 - 0 = 28');
    assert.equal(item2.team_reported_quantity, 30);
    assert.equal(item2.difference, -2);
  });

  await t.test('T-72 (SCRUM-181): Đính kèm ảnh hiện trường có và không có metadata (S-40 AC 3 & S-36 AC 4)', async () => {
    // S-36 AC 4: Phiếu đính được ảnh hiện trường
    const photoPayload = {
      photos: [
        {
          file_name: 'mong_khu_a_exif.jpg',
          file_url: '/uploads/acceptance/mong_khu_a_exif.jpg',
          caption: 'Hiện trường đào móng trục A',
          taken_at: '2026-10-15T09:30:00.000Z',
          latitude: 21.028511,
          longitude: 105.854167,
          has_metadata: true
        },
        {
          file_name: 'ban_ve_thi_cong.png',
          file_url: '/uploads/acceptance/ban_ve_thi_cong.png',
          caption: 'Ảnh chụp màn hình bản vẽ (không có EXIF GPS)',
          has_metadata: false
        }
      ]
    };

    const res = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${createdSheet1Id}/photos`,
      photoPayload,
      supervisorToken
    );

    assert.equal(res.status, 201);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.length, 2);

    const photo1 = res.data.data.find(p => p.file_name === 'mong_khu_a_exif.jpg');
    assert.equal(photo1.has_metadata, true);
    assert.equal(photo1.latitude, 21.028511);

    const photo2 = res.data.data.find(p => p.file_name === 'ban_ve_thi_cong.png');
    assert.equal(photo2.has_metadata, false);
    assert.equal(photo2.latitude, null);
  });

  await t.test('T-73 (SCRUM-182): Lấy chi tiết phiếu nghiệm thu kiểm tra đầy đủ quan hệ và tính toán', async () => {
    const res = await makeRequest(
      app,
      'GET',
      `/api/projects/${projectId}/acceptance-sheets/${createdSheet1Id}`,
      null,
      supervisorToken
    );

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.id, createdSheet1Id);
    assert.equal(res.data.data.items.length, 2);
    assert.equal(res.data.data.photos.length, 2);
  });

  await t.test('T-73 (SCRUM-182): Phê duyệt Đợt 1 và kiểm tra tính luỹ kế tự động cho Đợt 2', async () => {
    // 1. Phê duyệt phiếu Đợt 1 bởi Chỉ huy trưởng / Ban QLDA
    const approveRes = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${createdSheet1Id}/approve`,
      {},
      pmToken
    );
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.success, true);
    assert.equal(String(approveRes.data.data.status).toLowerCase(), 'approved');

    // 2. Prefill cho Đợt 2: Luỹ kế đợt trước phải tự động lấy từ Đợt 1 đã duyệt (120 và 28)
    const prefill2Res = await makeRequest(
      app,
      'GET',
      `/api/projects/${projectId}/acceptance-sheets/prefill`,
      null,
      supervisorToken
    );
    assert.equal(prefill2Res.status, 200);
    const item101Prefill = prefill2Res.data.data.items.find(i => i.work_item_id === 101);
    assert.equal(item101Prefill.previous_approved_quantity, 120, 'Đợt 2 phải lấy luỹ kế đã duyệt đợt 1 là 120');

    const item102Prefill = prefill2Res.data.data.items.find(i => i.work_item_id === 102);
    assert.equal(item102Prefill.previous_approved_quantity, 28, 'Đợt 2 phải lấy luỹ kế đã duyệt đợt 1 là 28');

    // 3. Tạo phiếu Đợt 2: luỹ kế HM-01 = 190, HM-02 = 60
    const sheet2Data = {
      sheet_code: 'NT-D02-2026',
      title: 'Nghiệm thu khối lượng Đợt 2',
      period_number: 2,
      cutoff_date: '2026-10-30',
      items: [
        {
          work_item_id: 101,
          cumulative_quantity: 190 // Khối lượng đợt phát sinh sẽ tự động = 190 - 120 = 70
        },
        {
          work_item_id: 102,
          cumulative_quantity: 60 // Khối lượng đợt phát sinh sẽ tự động = 60 - 28 = 32
        }
      ]
    };

    const create2Res = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets`,
      sheet2Data,
      supervisorToken
    );

    assert.equal(create2Res.status, 201);
    const item2_1 = create2Res.data.data.items.find(i => i.work_item_id === 101);
    assert.equal(item2_1.previous_approved_quantity, 120);
    assert.equal(item2_1.cumulative_quantity, 190);
    assert.equal(item2_1.period_quantity, 70, 'AC 2: Khối lượng đợt phải đúng bằng luỹ kế hiện tại trừ luỹ kế đợt trước đã duyệt (190 - 120 = 70)');

    const item2_2 = create2Res.data.data.items.find(i => i.work_item_id === 102);
    assert.equal(item2_2.previous_approved_quantity, 28);
    assert.equal(item2_2.cumulative_quantity, 60);
    assert.equal(item2_2.period_quantity, 32, 'AC 2: Khối lượng đợt (60 - 28 = 32)');
  });

  await t.test('Validation: Luỹ kế nhập vào nhỏ hơn luỹ kế đã duyệt trước đó thì báo lỗi', async () => {
    const invalidSheet = {
      sheet_code: 'NT-ERR-01',
      title: 'Phiếu lỗi số âm',
      period_number: 3,
      items: [
        {
          work_item_id: 101,
          cumulative_quantity: 50 // Nhỏ hơn 120 đã duyệt ở đợt 1
        }
      ]
    };

    const res = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets`,
      invalidSheet,
      supervisorToken
    );

    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
    assert.ok(res.data.message.includes('không thể nhỏ hơn'));
  });

  await t.test('RBAC: Viewer không được tạo phiếu hoặc duyệt phiếu; Contractor không được duyệt', async () => {
    // 1. Viewer tạo phiếu -> 403
    const viewerCreate = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets`,
      { sheet_code: 'VIEWER-01', title: 'Test' },
      viewerToken
    );
    assert.equal(viewerCreate.status, 403);

    // 2. Contractor duyệt phiếu -> 403
    const contractorApprove = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${createdSheet1Id}/approve`,
      {},
      contractorToken
    );
    assert.equal(contractorApprove.status, 403);
  });
});
