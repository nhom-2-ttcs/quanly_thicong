const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/models/store');
const { SheetAuditService } = require('../src/services/sheetAuditService');
const AcceptanceService = require('../src/services/acceptanceService');
const PaymentService = require('../src/services/paymentService');
const { DiaryService } = require('../src/services/diaryService');
const auditLogRoutes = require('../src/routes/auditLogRoutes');
const express = require('express');

describe('S-39: Nhật ký thao tác trên phiếu chỉ ghi thêm (Append-Only Audit Logs) — SCRUM-168', () => {
  let auditService;
  let acceptanceService;
  let paymentService;
  let diaryService;
  const mockProjectId = 99;

  beforeEach(() => {
    // Reset stores
    store.inMemorySheetAuditLogs.splice(0, store.inMemorySheetAuditLogs.length);
    store.inMemoryAcceptanceSheets.splice(0, store.inMemoryAcceptanceSheets.length);
    store.inMemoryAcceptanceSheetItems.splice(0, store.inMemoryAcceptanceSheetItems.length);
    store.inMemoryPaymentRequests.splice(0, store.inMemoryPaymentRequests.length);
    store.inMemoryPaymentRequestItems.splice(0, store.inMemoryPaymentRequestItems.length);
    store.inMemorySiteDiaries.splice(0, store.inMemorySiteDiaries.length);

    // Dùng in-memory fallback
    auditService = new SheetAuditService(null);
    acceptanceService = new AcceptanceService(null);
    paymentService = new PaymentService(null);
    diaryService = new DiaryService(null);
  });

  test('AC 1: Ghi nhận nhật ký thao tác trên Phiếu nghiệm thu (Lập mới và Phê duyệt)', async () => {
    // 1. Lập mới phiếu nghiệm thu
    const createRes = await acceptanceService.createAcceptanceSheet(mockProjectId, {
      sheet_code: 'PNT-2026-001',
      name: 'Nghiệm thu phần thân đợt 1',
      period_number: 1,
      items: [
        {
          task_id: 101,
          item_code: 'CV-01',
          item_name: 'Bê tông cột dầm',
          unit: 'm3',
          current_stage_quantity: 45
        }
      ]
    }, 10);

    assert.ok(createRes.success);
    const sheetId = createRes.data.id;

    // Kiểm tra log CREATE đã được ghi vào audit store
    const createLogs = await auditService.getLogs(mockProjectId, {
      entityType: 'acceptance_sheet',
      action: 'CREATE'
    });
    assert.strictEqual(createLogs.total, 1);
    const createLog = createLogs.data[0];
    assert.strictEqual(createLog.entity_type, 'acceptance_sheet');
    assert.strictEqual(createLog.entity_id, String(sheetId));
    assert.strictEqual(createLog.performed_by, 10);
    assert.strictEqual(createLog.old_values, null);
    assert.ok(createLog.new_values);
    assert.strictEqual(createLog.new_values.sheet_code, 'PNT-2026-001');

    // 2. Phê duyệt phiếu nghiệm thu
    const approveRes = await acceptanceService.approveAcceptanceSheet(mockProjectId, sheetId, 20);
    assert.ok(approveRes.success);

    // Kiểm tra log APPROVE đã được ghi
    const approveLogs = await auditService.getLogs(mockProjectId, {
      entityType: 'acceptance_sheet',
      action: 'APPROVE'
    });
    assert.strictEqual(approveLogs.total, 1);
    const approveLog = approveLogs.data[0];
    assert.strictEqual(approveLog.performed_by, 20);
    assert.strictEqual(approveLog.old_values.status, 'draft');
    assert.strictEqual(approveLog.new_values.status, 'approved');
    assert.ok(approveLog.created_at);
  });

  test('AC 2: Ghi nhận nhật ký thao tác trên Đề nghị thanh toán (Lập mới và Phê duyệt)', async () => {
    // 1. Lập đề nghị thanh toán
    const createRes = await paymentService.createPaymentRequest(mockProjectId, {
      request_code: 'DNTT-2026-001',
      name: 'Thanh toán đợt 1',
      period_number: 1,
      items: [
        {
          work_item_id: 1,
          item_code: 'CV-01',
          item_name: 'Bê tông dầm sàn',
          unit: 'm3',
          contract_quantity: 100,
          unit_price: 1000000,
          current_period_quantity: 50
        }
      ]
    }, 15);

    assert.ok(createRes.success);
    const reqId = createRes.data.id;

    const createLogs = await auditService.getLogs(mockProjectId, {
      entityType: 'payment_request',
      action: 'CREATE'
    });
    assert.strictEqual(createLogs.total, 1);
    assert.strictEqual(createLogs.data[0].entity_id, String(reqId));
    assert.strictEqual(createLogs.data[0].performed_by, 15);
    assert.ok(createLogs.data[0].new_values.retention_amount !== undefined);

    // 2. Phê duyệt đề nghị thanh toán
    const approveRes = await paymentService.approvePaymentRequest(mockProjectId, reqId, 30);
    assert.ok(approveRes.success);

    const approveLogs = await auditService.getLogs(mockProjectId, {
      entityType: 'payment_request',
      action: 'APPROVE'
    });
    assert.strictEqual(approveLogs.total, 1);
    assert.strictEqual(approveLogs.data[0].old_values.status, 'draft');
    assert.strictEqual(approveLogs.data[0].new_values.status, 'approved');
  });

  test('AC 3: Ghi nhận nhật ký thao tác trên Khối lượng hợp đồng (Giá trị trước/sau)', async () => {
    // Ghi nhận log trực tiếp từ thao tác cập nhật khối lượng
    const log = await auditService.recordLog({
      projectId: mockProjectId,
      entityType: 'contract_volume',
      entityId: '501',
      action: 'UPDATE',
      performedBy: 12,
      userName: 'Kỹ sư Đỗ Văn An',
      roleName: 'QS_ENGINEER',
      oldValues: {
        unit: 'm2',
        khoi_luong_hop_dong: '150.0000',
        don_gia_hop_dong: '250000.00'
      },
      newValues: {
        unit: 'm2',
        khoi_luong_hop_dong: '180.0000',
        don_gia_hop_dong: '250000.00'
      },
      changeSummary: 'Điều chỉnh bổ sung khối lượng hợp đồng theo phụ lục 01',
      reason: 'Phụ lục hợp đồng số 01 ký ngày 15/10/2026'
    });

    assert.ok(log.id);
    assert.strictEqual(log.entity_type, 'contract_volume');
    assert.strictEqual(log.old_values.khoi_luong_hop_dong, '150.0000');
    assert.strictEqual(log.new_values.khoi_luong_hop_dong, '180.0000');
    assert.strictEqual(log.reason, 'Phụ lục hợp đồng số 01 ký ngày 15/10/2026');
  });

  test('AC 4: Ghi nhận nhật ký thao tác Khóa và Mở khóa sổ nhật ký thi công', async () => {
    const testDate = '2026-10-19';

    // Seed nhật ký thi công cho ngày kiểm thử
    store.saveSiteDiaryEntry({
      project_id: mockProjectId,
      diary_date: testDate,
      weather: 'Nắng',
      is_locked: 0
    });

    // 1. Khóa sổ
    await diaryService.lockDiary(mockProjectId, testDate, 5);

    const lockLogs = await auditService.getLogs(mockProjectId, {
      entityType: 'site_diary_lock',
      action: 'LOCK'
    });
    assert.strictEqual(lockLogs.total, 1);
    assert.strictEqual(lockLogs.data[0].entity_id, `${mockProjectId}_${testDate}`);
    assert.strictEqual(lockLogs.data[0].new_values.is_locked, 1);

    // 2. Mở khóa sổ với lý do bắt buộc
    const adminUser = { id: 1, role_id: 1, role_name: 'admin', full_name: 'Quản Trị Viên' };
    await diaryService.unlockDiary(mockProjectId, testDate, adminUser, 'Bổ sung thông tin thời tiết mưa bão đột xuất');

    const unlockLogs = await auditService.getLogs(mockProjectId, {
      entityType: 'site_diary_lock',
      action: 'UNLOCK'
    });
    assert.strictEqual(unlockLogs.total, 1);
    assert.strictEqual(unlockLogs.data[0].reason, 'Bổ sung thông tin thời tiết mưa bão đột xuất');
    assert.strictEqual(unlockLogs.data[0].old_values.is_locked, 1);
    assert.strictEqual(unlockLogs.data[0].new_values.is_locked, 0);
  });

  test('AC 5 & Security: Tính chất Append-Only - Chặn sửa và xóa bản ghi nhật ký với HTTP 405 Method Not Allowed', async () => {
    const router = auditLogRoutes(null);

    // 1. Kiểm tra method PUT bị chặn
    let putCode = null;
    let putBody = null;
    const mockPutRes = {
      status(c) { putCode = c; return this; },
      json(b) { putBody = b; return this; }
    };
    const putReq = {
      method: 'PUT',
      url: `/projects/${mockProjectId}/sheet-audit-logs/1`,
      params: { projectId: mockProjectId, id: 1 },
      body: { action: 'TAMPERED' }
    };
    router.handle(putReq, mockPutRes, () => {});

    assert.strictEqual(putCode, 405);
    assert.strictEqual(putBody.code, 'METHOD_NOT_ALLOWED');
    assert.ok(putBody.message.includes('chỉ ghi thêm (append-only)'));

    // 2. Kiểm tra method DELETE bị chặn
    let deleteCode = null;
    let deleteBody = null;
    const mockDeleteRes = {
      status(c) { deleteCode = c; return this; },
      json(b) { deleteBody = b; return this; }
    };
    const deleteReq = {
      method: 'DELETE',
      url: `/projects/${mockProjectId}/sheet-audit-logs/1`,
      params: { projectId: mockProjectId, id: 1 }
    };
    router.handle(deleteReq, mockDeleteRes, () => {});

    assert.strictEqual(deleteCode, 405);
    assert.strictEqual(deleteBody.code, 'METHOD_NOT_ALLOWED');
    assert.ok(deleteBody.message.includes('chỉ ghi thêm (append-only)'));

    // 3. Kiểm tra method PATCH bị chặn
    let patchCode = null;
    let patchBody = null;
    const mockPatchRes = {
      status(c) { patchCode = c; return this; },
      json(b) { patchBody = b; return this; }
    };
    const patchReq = {
      method: 'PATCH',
      url: `/projects/${mockProjectId}/sheet-audit-logs/1`,
      params: { projectId: mockProjectId, id: 1 }
    };
    router.handle(patchReq, mockPatchRes, () => {});

    assert.strictEqual(patchCode, 405);
    assert.strictEqual(patchBody.code, 'METHOD_NOT_ALLOWED');
  });

  test('Tra cứu nhật ký thao tác qua API GET với đầy đủ bộ lọc', async () => {
    // Seed 3 bản ghi
    await auditService.recordLog({
      projectId: mockProjectId,
      entityType: 'acceptance_sheet',
      entityId: 'PNT-1',
      action: 'CREATE',
      performedBy: 1,
      changeSummary: 'Lập phiếu PNT-1'
    });
    await auditService.recordLog({
      projectId: mockProjectId,
      entityType: 'payment_request',
      entityId: 'DNTT-1',
      action: 'CREATE',
      performedBy: 2,
      changeSummary: 'Lập đề nghị DNTT-1'
    });
    await auditService.recordLog({
      projectId: mockProjectId,
      entityType: 'payment_request',
      entityId: 'DNTT-1',
      action: 'APPROVE',
      performedBy: 3,
      changeSummary: 'Duyệt đề nghị DNTT-1'
    });

    // Lọc theo entityType = 'payment_request'
    const resultPayment = await auditService.getLogs(mockProjectId, {
      entityType: 'payment_request'
    });
    assert.strictEqual(resultPayment.total, 2);

    // Lọc theo action = 'APPROVE'
    const resultApprove = await auditService.getLogs(mockProjectId, {
      action: 'APPROVE'
    });
    assert.strictEqual(resultApprove.total, 1);
    assert.strictEqual(resultApprove.data[0].change_summary, 'Duyệt đề nghị DNTT-1');
  });
});
