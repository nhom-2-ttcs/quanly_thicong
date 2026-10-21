const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const acceptanceRoutes = require('../src/routes/acceptanceRoutes');
const {
  createSession,
  inMemoryUsers,
  addProjectMember,
  inMemoryWorkItems,
  inMemoryAcceptanceSheets,
  inMemoryAcceptanceSheetItems,
  inMemorySheetAuditLogs
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

// Setup user accounts & tokens
const adminUser = inMemoryUsers.find(u => u.role_id === 1) || { id: 1, email: 'admin@thicong.vn', role_id: 1, role_name: 'admin' };
const pmUser = inMemoryUsers.find(u => u.role_id === 2) || { id: 2, email: 'pm@thicong.vn', role_id: 2, role_name: 'project_manager' };
const supervisorUser = { id: 20, email: 'supervisor_s38@thicong.vn', role_id: 3, role_name: 'site_manager' };
const contractorUser = { id: 21, email: 'contractor_s38@thicong.vn', role_id: 4, role_name: 'contractor' };
const viewerUser = inMemoryUsers.find(u => u.role_id === 7) || { id: 22, email: 'viewer_s38@thicong.vn', role_id: 7, role_name: 'viewer' };
const outsiderUser = { id: 99, email: 'outsider@thicong.vn', role_id: 2, role_name: 'project_manager' }; // not in project 1

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
const outsiderToken = createSession(outsiderUser);

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

test('S-38 (SCRUM-167) — Ban quản lý duyệt hoặc trả lại phiếu nghiệm thu kèm lý do', async (suite) => {
  const app = createTestApp();
  const projectId = 1;

  // Setup seed work item
  const workItemId = 3801;
  const existingWI = inMemoryWorkItems.find(w => w.id === workItemId);
  if (!existingWI) {
    inMemoryWorkItems.push({
      id: workItemId,
      project_id: projectId,
      code: 'HM-S38',
      name: 'Thi công kết cấu dầm sàn S38',
      unit: 'm3',
      khoi_luong_hop_dong: 100,
      quantity: 100,
      contract_quantity: 100,
      planned_quantity: 100
    });
  }

  await suite.test('Migration: Xác thực file migration UP và DOWN của S-38', () => {
    const upSqlPath = path.resolve(__dirname, '../../migration_s38_acceptance_approval.sql');
    const downSqlPath = path.resolve(__dirname, '../../migration_s38_acceptance_approval_down.sql');

    assert.ok(fs.existsSync(upSqlPath), 'File migration UP phải tồn tại');
    assert.ok(fs.existsSync(downSqlPath), 'File migration DOWN phải tồn tại');

    const upContent = fs.readFileSync(upSqlPath, 'utf8');
    const downContent = fs.readFileSync(downSqlPath, 'utf8');

    assert.ok(upContent.includes('rejection_reason'), 'UP migration phải thêm cột rejection_reason');
    assert.ok(upContent.includes('rejected_by'), 'UP migration phải thêm cột rejected_by');
    assert.ok(upContent.includes('rejected_at'), 'UP migration phải thêm cột rejected_at');

    assert.ok(downContent.includes('DROP COLUMN'), 'DOWN migration phải xóa các cột đã thêm');
  });

  await suite.test('AC 1: Phiếu chưa duyệt (draft) không được tính vào luỹ kế', async () => {
    // 1. Tạo phiếu đợt 1 ở trạng thái draft với khối lượng luỹ kế = 30
    const createRes = await makeRequest(app, 'POST', `/api/projects/${projectId}/acceptance-sheets`, {
      sheet_code: 'NT-S38-DRAFT-01',
      title: 'Phiếu nghiệm thu đợt nháp S38',
      period_number: 101,
      cutoff_date: '2026-10-22',
      items: [
        {
          work_item_id: workItemId,
          cumulative_quantity: 30
        }
      ]
    }, supervisorToken);

    assert.equal(createRes.status, 201);
    const draftSheet = createRes.data.data;
    assert.equal(draftSheet.status, 'draft');

    // 2. Gọi prefill đợt tiếp theo: khối lượng luỹ kế trước đó phải bằng 0 (vì phiếu đợt 1 chưa duyệt)
    const prefillRes = await makeRequest(
      app,
      'GET',
      `/api/projects/${projectId}/acceptance-sheets/prefill`,
      null,
      supervisorToken
    );
    assert.equal(prefillRes.status, 200);
    const itemPrefill = prefillRes.data.data.items.find(it => it.work_item_id === workItemId);
    assert.ok(itemPrefill);
    assert.equal(
      Number(itemPrefill.previous_approved_quantity),
      0,
      'Phiếu draft không được tính vào previous_approved_quantity của đợt tiếp theo'
    );
  });

  await suite.test('AC 1: Duyệt phiếu làm cập nhật luỹ kế đúng một lần (Idempotency)', async () => {
    // 1. Tạo phiếu đợt mới để duyệt
    const createRes = await makeRequest(app, 'POST', `/api/projects/${projectId}/acceptance-sheets`, {
      sheet_code: 'NT-S38-APPROVE-01',
      title: 'Phiếu nghiệm thu duyệt đợt 1 S38',
      period_number: 102,
      cutoff_date: '2026-10-22',
      items: [
        {
          work_item_id: workItemId,
          cumulative_quantity: 25
        }
      ]
    }, supervisorToken);
    assert.equal(createRes.status, 201);
    const sheetId = createRes.data.data.id;

    // 2. Ban quản lý (PM) duyệt phiếu
    const approveRes = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}/approve`,
      {},
      pmToken
    );
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.data.status, 'approved');

    // 3. Kiểm tra prefill: bây giờ luỹ kế đã được tính = 25
    const prefillRes1 = await makeRequest(
      app,
      'GET',
      `/api/projects/${projectId}/acceptance-sheets/prefill`,
      null,
      supervisorToken
    );
    assert.equal(prefillRes1.status, 200);
    const prefillItem1 = prefillRes1.data.data.items.find(it => it.work_item_id === workItemId);
    assert.equal(Number(prefillItem1.previous_approved_quantity), 25);

    // 4. Thử duyệt lại lần 2 (idempotent hoặc từ chối phiếu đã approved)
    const approveAgainRes = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}/approve`,
      {},
      pmToken
    );
    // Code hiện tại trả 400 nếu đã approved
    assert.equal(approveAgainRes.status, 400);

    // 5. Luỹ kế vẫn giữ nguyên là 25, không bị nhân đôi
    const prefillRes2 = await makeRequest(
      app,
      'GET',
      `/api/projects/${projectId}/acceptance-sheets/prefill`,
      null,
      supervisorToken
    );
    const prefillItem2 = prefillRes2.data.data.items.find(it => it.work_item_id === workItemId);
    assert.equal(Number(prefillItem2.previous_approved_quantity), 25, 'Luỹ kế chỉ được tính đúng 1 lần');
  });

  await suite.test('AC 2: Trả lại thiếu lý do bị từ chối 400; có lý do chuyển sang status rejected', async () => {
    // 1. Tạo phiếu draft
    const createRes = await makeRequest(app, 'POST', `/api/projects/${projectId}/acceptance-sheets`, {
      sheet_code: 'NT-S38-REJECT-01',
      title: 'Phiếu kiểm tra trả lại S38',
      period_number: 103,
      cutoff_date: '2026-10-22',
      items: [
        {
          work_item_id: workItemId,
          cumulative_quantity: 35
        }
      ]
    }, supervisorToken);
    assert.equal(createRes.status, 201);
    const sheetId = createRes.data.data.id;

    // 2. Trả lại thiếu lý do -> 400
    const rejectNoReason = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}/reject`,
      { reason: '   ' },
      pmToken
    );
    assert.equal(rejectNoReason.status, 400);
    assert.ok(rejectNoReason.data.message.includes('bắt buộc'));

    // 3. Trả lại có lý do hợp lệ -> 200
    const reasonText = 'Chất lượng cốt thép chưa đạt biên bản nghiệm thu vật liệu đầu vào';
    const rejectSuccess = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}/reject`,
      { reason: reasonText },
      pmToken
    );
    assert.equal(rejectSuccess.status, 200);
    assert.equal(rejectSuccess.data.data.status, 'rejected');
    assert.equal(rejectSuccess.data.data.rejection_reason, reasonText);
    assert.equal(rejectSuccess.data.data.rejected_by, pmUser.id);
    assert.ok(rejectSuccess.data.data.rejected_at);

    // 4. Kiểm tra audit log đã ghi nhận sự kiện REJECT
    const logs = inMemorySheetAuditLogs.filter(
      l => l.action === 'REJECT' && l.entity_id === String(sheetId)
    );
    assert.ok(logs.length > 0, 'Phải có audit log ghi nhận việc trả lại phiếu');
    assert.equal(logs[logs.length - 1].performed_by, pmUser.id);

    // 5. Phiếu bị trả lại (rejected) không được tính vào luỹ kế
    const prefillRes = await makeRequest(
      app,
      'GET',
      `/api/projects/${projectId}/acceptance-sheets/prefill`,
      null,
      supervisorToken
    );
    const prefillItem = prefillRes.data.data.items.find(it => it.work_item_id === workItemId);
    assert.equal(Number(prefillItem.previous_approved_quantity), 25, 'Phiếu bị trả lại không được cộng vào luỹ kế');
  });

  await suite.test('AC 2: Người lập sửa được phiếu đã bị trả lại (rejected)', async () => {
    // 1. Tạo phiếu và trả lại
    const createRes = await makeRequest(app, 'POST', `/api/projects/${projectId}/acceptance-sheets`, {
      sheet_code: 'NT-S38-EDIT-REJECTED-01',
      title: 'Phiếu sửa sau khi trả lại S38',
      period_number: 104,
      cutoff_date: '2026-10-22',
      items: [
        {
          work_item_id: workItemId,
          cumulative_quantity: 40
        }
      ]
    }, supervisorToken);
    assert.equal(createRes.status, 201);
    const sheetId = createRes.data.data.id;

    await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}/reject`,
      { reason: 'Sai lệch số đo thực tế tại hiện trường' },
      pmToken
    );

    // 2. Người lập (supervisor) sửa lại phiếu
    const updateRes = await makeRequest(
      app,
      'PUT',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}`,
      {
        note: 'Đã hiệu chỉnh lại số đo theo biên bản thực tế',
        items: [
          {
            work_item_id: workItemId,
            cumulative_quantity: 37 // giảm từ 40 xuống 37
          }
        ]
      },
      supervisorToken
    );

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.data.data.note, 'Đã hiệu chỉnh lại số đo theo biên bản thực tế');
    assert.equal(Number(updateRes.data.data.items[0].cumulative_quantity), 37);
    // Khối lượng đợt phát sinh = 37 - 25 = 12
    assert.equal(Number(updateRes.data.data.items[0].period_quantity), 12);

    // 3. Sau khi sửa, PM có thể duyệt phiếu này
    const approveRes = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}/approve`,
      {},
      pmToken
    );
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.data.status, 'approved');

    // 4. Luỹ kế bây giờ phải là 37
    const prefillRes = await makeRequest(
      app,
      'GET',
      `/api/projects/${projectId}/acceptance-sheets/prefill`,
      null,
      supervisorToken
    );
    const prefillItem = prefillRes.data.data.items.find(it => it.work_item_id === workItemId);
    assert.equal(Number(prefillItem.previous_approved_quantity), 37);
  });

  await suite.test('AC 3: Phiếu đã duyệt không được sửa trực tiếp (HTTP 422)', async () => {
    // 1. Tạo và duyệt phiếu
    const createRes = await makeRequest(app, 'POST', `/api/projects/${projectId}/acceptance-sheets`, {
      sheet_code: 'NT-S38-LOCKED-01',
      title: 'Phiếu đã duyệt khóa sửa S38',
      period_number: 105,
      cutoff_date: '2026-10-22',
      items: [
        {
          work_item_id: workItemId,
          cumulative_quantity: 42
        }
      ]
    }, supervisorToken);
    assert.equal(createRes.status, 201);
    const sheetId = createRes.data.data.id;

    await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}/approve`,
      {},
      pmToken
    );

    // 2. Thử sửa trực tiếp phiếu đã approved -> Phải bị từ chối với HTTP 422
    const updateRes = await makeRequest(
      app,
      'PUT',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}`,
      {
        note: 'Cố tình sửa phiếu đã duyệt'
      },
      pmToken
    );

    assert.equal(updateRes.status, 422);
    assert.ok(updateRes.data.message.includes('không được phép chỉnh sửa trực tiếp'));

    // 3. Cũng không thể reject một phiếu đã duyệt -> HTTP 422
    const rejectApprovedRes = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}/reject`,
      { reason: 'Cố tình reject phiếu đã duyệt' },
      pmToken
    );
    assert.equal(rejectApprovedRes.status, 422);
  });

  await suite.test('RBAC & Scope: User sai vai trò hoặc ngoài dự án bị từ chối 403', async () => {
    // 1. Tạo phiếu draft
    const createRes = await makeRequest(app, 'POST', `/api/projects/${projectId}/acceptance-sheets`, {
      sheet_code: 'NT-S38-RBAC-01',
      title: 'Phiếu kiểm tra RBAC S38',
      period_number: 106,
      cutoff_date: '2026-10-22',
      items: [{ work_item_id: workItemId, cumulative_quantity: 45 }]
    }, supervisorToken);
    assert.equal(createRes.status, 201);
    const sheetId = createRes.data.data.id;

    // 2. Viewer không thể approve hoặc reject
    const viewerApprove = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}/approve`,
      {},
      viewerToken
    );
    assert.equal(viewerApprove.status, 403);

    const viewerReject = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}/reject`,
      { reason: 'Viewer thu reject' },
      viewerToken
    );
    assert.equal(viewerReject.status, 403);

    // 3. Contractor không thể approve hoặc reject
    const contractorApprove = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}/approve`,
      {},
      contractorToken
    );
    assert.equal(contractorApprove.status, 403);

    // 4. User ngoài dự án (outsider) bị từ chối 403
    const outsiderApprove = await makeRequest(
      app,
      'POST',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}/approve`,
      {},
      outsiderToken
    );
    assert.equal(outsiderApprove.status, 403);
  });

  await suite.test('Bảo toàn giới hạn hợp đồng S-37 khi chỉnh sửa phiếu', async () => {
    // contract_quantity là 100.
    // Thử tạo phiếu với cumulative_quantity = 150 (> 100) -> 422
    const overLimitCreate = await makeRequest(app, 'POST', `/api/projects/${projectId}/acceptance-sheets`, {
      sheet_code: 'NT-S38-LIMIT-01',
      title: 'Phiếu vượt giới hạn hợp đồng S38',
      period_number: 107,
      cutoff_date: '2026-10-22',
      items: [{ work_item_id: workItemId, cumulative_quantity: 150 }]
    }, supervisorToken);

    assert.ok([400, 422].includes(overLimitCreate.status), `Expected 400 or 422, got ${overLimitCreate.status}`);
    assert.ok(overLimitCreate.data.message.includes('vượt quá khối lượng hợp đồng'));

    // Tạo phiếu hợp lệ với cumulative_quantity = 50
    const createRes = await makeRequest(app, 'POST', `/api/projects/${projectId}/acceptance-sheets`, {
      sheet_code: 'NT-S38-LIMIT-02',
      title: 'Phiếu hợp lệ chuẩn bị sửa quá giới hạn',
      period_number: 108,
      cutoff_date: '2026-10-22',
      items: [{ work_item_id: workItemId, cumulative_quantity: 50 }]
    }, supervisorToken);
    assert.equal(createRes.status, 201);
    const sheetId = createRes.data.data.id;

    // Thử sửa phiếu để cumulative_quantity = 120 (> 100) -> 400/422
    const overLimitUpdate = await makeRequest(
      app,
      'PUT',
      `/api/projects/${projectId}/acceptance-sheets/${sheetId}`,
      {
        items: [{ work_item_id: workItemId, cumulative_quantity: 120 }]
      },
      supervisorToken
    );

    assert.ok([400, 422].includes(overLimitUpdate.status), `Expected 400 or 422, got ${overLimitUpdate.status}`);
    assert.ok(overLimitUpdate.data.message.includes('vượt quá khối lượng hợp đồng'));
  });
});
