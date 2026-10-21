/**
 * S-44 (SCRUM-173) — Chủ đầu tư duyệt hoặc trả lại đề nghị thanh toán
 * Test suite bao phủ đầy đủ:
 *   T-101: Tạo thao tác duyệt / trả lại đề xuất (phân quyền Chủ đầu tư/Admin, lưu người thực hiện & lý do)
 *   T-102: Khóa đề nghị và các nguồn phiếu sau khi duyệt (chặn sửa/xóa đề nghị & phiếu nguồn với HTTP 409)
 *   T-103: Giải phóng nguồn phiếu khi đề xuất được trả lại (bắt buộc lý do, phiếu tái sử dụng cho đề xuất mới)
 *   T-104: Kiểm tra toàn diện luồng HTTP API trực tiếp, phân quyền RBAC và khóa dữ liệu
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const PaymentService = require('../src/services/paymentService');
const AcceptanceService = require('../src/services/acceptanceService');
const paymentRoutes = require('../src/routes/paymentRoutes');
const acceptanceRoutes = require('../src/routes/acceptanceRoutes');
const store = require('../src/models/store');

// ─── Helpers ────────────────────────────────────────────────────────────────

const PROJECT_ID = 888;

/** Làm tròn HALF_UP 2 chữ số */
function roundMoney(v) {
  const n = Number(v);
  if (isNaN(n)) return 0;
  return Number(Math.round(Number(n + 'e2')) + 'e-2');
}

/** Seed phiếu nghiệm thu đã duyệt kèm hạng mục có đơn giá */
function seedApprovedSheet({
  projectId = PROJECT_ID,
  sheetId,
  periodNumber = 1,
  items = [],
  paymentRequestId = null
}) {
  const existingSheetIdx = store.inMemoryAcceptanceSheets.findIndex(s => s.id === sheetId);
  const sheetObj = {
    id: sheetId,
    project_id: projectId,
    sheet_code: `NT-${String(sheetId).padStart(2, '0')}`,
    name: `Phiếu nghiệm thu đợt ${periodNumber}`,
    period_number: periodNumber,
    from_date: '2026-10-01',
    to_date: '2026-10-15',
    status: 'approved',
    payment_request_id: paymentRequestId,
    approved_by: 2,
    approved_at: '2026-10-16 08:00:00',
    notes: null,
    created_by: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (existingSheetIdx >= 0) {
    store.inMemoryAcceptanceSheets[existingSheetIdx] = sheetObj;
  } else {
    store.inMemoryAcceptanceSheets.push(sheetObj);
  }

  let itemIdCounter = store.inMemoryAcceptanceSheetItems.length > 0
    ? Math.max(...store.inMemoryAcceptanceSheetItems.map(i => i.id)) + 1
    : 2000;

  for (const it of items) {
    const periodQty = Number(it.period_quantity || 0);
    const prevApproved = Number(it.previous_approved_quantity || 0);
    store.inMemoryAcceptanceSheetItems.push({
      id: itemIdCounter++,
      sheet_id: sheetId,
      work_item_id: it.work_item_id || null,
      task_id: null,
      item_name: it.item_name || 'Hạng mục test',
      unit: it.unit || 'm3',
      previous_approved_quantity: prevApproved,
      cumulative_quantity: prevApproved + periodQty,
      period_quantity: periodQty,
      team_reported_quantity: periodQty,
      difference: 0,
      notes: null,
      created_at: new Date().toISOString()
    });
  }
}

/** Seed work item */
function seedWorkItem({ id, projectId = PROJECT_ID, name, unitPrice }) {
  if (!store.inMemoryWorkItems.find(w => w.id === id)) {
    store.inMemoryWorkItems.push({
      id,
      project_id: projectId,
      code: `WI-${id}`,
      name,
      unit: 'm3',
      khoi_luong_hop_dong: 1000,
      don_gia_hop_dong: unitPrice,
      planned_quantity: 1000
    });
  }
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('S-44 (SCRUM-173) — Chủ đầu tư duyệt hoặc trả lại đề nghị thanh toán', () => {
  let paymentService;
  let acceptanceService;

  beforeEach(() => {
    // Reset in-memory data in-place
    store.inMemoryPaymentRequests.splice(0, store.inMemoryPaymentRequests.length);
    store.inMemoryPaymentRequestItems.splice(0, store.inMemoryPaymentRequestItems.length);
    store.inMemoryAcceptanceSheets.splice(0, store.inMemoryAcceptanceSheets.length);
    store.inMemoryAcceptanceSheetItems.splice(0, store.inMemoryAcceptanceSheetItems.length);
    store.inMemoryAcceptanceSheetPhotos.splice(0, store.inMemoryAcceptanceSheetPhotos.length);
    store.inMemorySheetAuditLogs.splice(0, store.inMemorySheetAuditLogs.length);

    // Gán quyền truy cập dự án cho các role test
    store.userProjectAssignments.set(1, new Set(['*', PROJECT_ID]));
    store.userProjectAssignments.set(6, new Set(['*', PROJECT_ID]));
    store.userProjectAssignments.set(4, new Set(['*', PROJECT_ID]));
    store.userProjectAssignments.set(7, new Set(['*', PROJECT_ID]));

    store.updateProjectRetentionRate(PROJECT_ID, 5.00);

    paymentService = new PaymentService(null); // in-memory
    acceptanceService = new AcceptanceService(null);

    // Seed work items
    seedWorkItem({ id: 801, projectId: PROJECT_ID, name: 'Bê tông đài móng', unitPrice: 1500000 });
    seedWorkItem({ id: 802, projectId: PROJECT_ID, name: 'Cốt thép móng', unitPrice: 22000 });
  });

  // ─── Migration Tests ───────────────────────────────────────────────────────

  describe('Migration: Xác thực tệp migration UP & DOWN của S-44', () => {
    test('File migration UP (migration_s44_payment_approval_and_rejection.sql) đầy đủ', () => {
      const upPath = path.join(__dirname, '../../migration_s44_payment_approval_and_rejection.sql');
      assert.ok(fs.existsSync(upPath), 'File migration UP S-44 phải tồn tại');
      const content = fs.readFileSync(upPath, 'utf8');

      assert.ok(content.includes('rejected_by'), 'Có cột rejected_by');
      assert.ok(content.includes('rejected_at'), 'Có cột rejected_at');
      assert.ok(content.includes('rejection_reason'), 'Có cột rejection_reason');
      assert.ok(content.includes('fk_payment_rejecter'), 'Có Foreign Key fk_payment_rejecter');
      assert.ok(content.includes('rejected') || content.includes('returned'), 'Có ENUM trạng thái rejected/returned');
    });

    test('File migration DOWN (migration_s44_payment_approval_and_rejection_down.sql) an toàn', () => {
      const downPath = path.join(__dirname, '../../migration_s44_payment_approval_and_rejection_down.sql');
      assert.ok(fs.existsSync(downPath), 'File migration DOWN S-44 phải tồn tại');
      const content = fs.readFileSync(downPath, 'utf8');

      assert.ok(content.includes('DROP FOREIGN KEY IF EXISTS `fk_payment_rejecter`'));
      assert.ok(content.includes('DROP COLUMN IF EXISTS `rejection_reason`'));
      assert.ok(content.includes('DROP COLUMN IF EXISTS `rejected_at`'));
      assert.ok(content.includes('DROP COLUMN IF EXISTS `rejected_by`'));
    });
  });

  // ─── T-101: Tạo thao tác duyệt / trả lại đề xuất ────────────────────────────

  describe('T-101: Thao tác duyệt và trả lại đề xuất của Chủ đầu tư', () => {
    test('Chủ đầu tư phê duyệt đề xuất thành công và lưu thông tin người duyệt', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 101, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Bê tông', period_quantity: 10 }]
      });

      const createRes = await paymentService.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-T101-01',
        name: 'Đề nghị đợt 1',
        period_number: 1,
        retention_rate: 5.0
      }, 1);
      const reqId = createRes.data.id;

      // Phê duyệt bởi Chủ đầu tư (user_id = 6)
      const approveRes = await paymentService.approvePaymentRequest(PROJECT_ID, reqId, 6);
      assert.ok(approveRes.success);
      assert.strictEqual(approveRes.data.status, 'approved');
      assert.strictEqual(approveRes.data.approved_by, 6);
      assert.ok(approveRes.data.approved_at);

      // Kiểm tra audit log S-39 ghi nhận hành động APPROVE
      const logs = store.getSheetAuditLogs(PROJECT_ID);
      const approveLog = logs.data.find(l => l.action === 'APPROVE' && l.entity_id === String(reqId));
      assert.ok(approveLog, 'Phải có audit log ghi lại hành động APPROVE');
      assert.strictEqual(approveLog.performed_by, 6);
    });

    test('Trả lại đề xuất bắt buộc phải có lý do (nếu rỗng -> báo lỗi 400)', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 102, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Bê tông', period_quantity: 10 }]
      });

      const createRes = await paymentService.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-T101-02',
        name: 'Đề nghị đợt 2',
        period_number: 1
      }, 1);
      const reqId = createRes.data.id;

      // Trả lại không truyền reason
      await assert.rejects(
        () => paymentService.rejectPaymentRequest(PROJECT_ID, reqId, 6, ''),
        (err) => {
          assert.strictEqual(err.status, 400);
          assert.ok(err.message.includes('Lý do trả lại'));
          return true;
        }
      );

      // Trả lại chỉ có khoảng trắng
      await assert.rejects(
        () => paymentService.rejectPaymentRequest(PROJECT_ID, reqId, 6, '   '),
        (err) => {
          assert.strictEqual(err.status, 400);
          return true;
        }
      );
    });

    test('Chủ đầu tư trả lại đề xuất thành công kèm lý do và lưu lịch sử', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 103, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Bê tông', period_quantity: 10 }]
      });

      const createRes = await paymentService.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-T101-03',
        name: 'Đề nghị đợt 3',
        period_number: 1
      }, 1);
      const reqId = createRes.data.id;

      const reason = 'Sai sót trong khối lượng đài móng, yêu cầu đo đạc lại hiện trường';
      const rejectRes = await paymentService.rejectPaymentRequest(PROJECT_ID, reqId, 6, reason);
      assert.ok(rejectRes.success);
      assert.strictEqual(rejectRes.data.status, 'rejected');
      assert.strictEqual(rejectRes.data.rejected_by, 6);
      assert.strictEqual(rejectRes.data.rejection_reason, reason);
      assert.ok(rejectRes.data.rejected_at);

      // Kiểm tra audit log S-39 ghi nhận hành động REJECT
      const logs = store.getSheetAuditLogs(PROJECT_ID);
      const rejectLog = logs.data.find(l => l.action === 'REJECT' && l.entity_id === String(reqId));
      assert.ok(rejectLog, 'Phải có audit log ghi lại hành động REJECT');
      assert.strictEqual(rejectLog.reason, reason);
    });
  });

  // ─── T-102: Khóa đề nghị và các nguồn phiếu sau khi duyệt ───────────────────

  describe('T-102: Khóa đề nghị và các nguồn phiếu sau khi duyệt', () => {
    let approvedReqId;
    const SHEET_ID = 104;

    beforeEach(async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: SHEET_ID, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Bê tông', period_quantity: 20 }]
      });

      const createRes = await paymentService.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-LOCKED',
        name: 'Đề nghị bị khóa sau khi duyệt',
        period_number: 1
      }, 1);
      approvedReqId = createRes.data.id;

      // Duyệt đề nghị
      await paymentService.approvePaymentRequest(PROJECT_ID, approvedReqId, 6);
    });

    test('Không thể phê duyệt lại đề xuất đã duyệt (HTTP 409 Conflict)', async () => {
      await assert.rejects(
        () => paymentService.approvePaymentRequest(PROJECT_ID, approvedReqId, 6),
        (err) => {
          assert.strictEqual(err.status, 409);
          assert.ok(err.message.includes('đã bị khóa'));
          return true;
        }
      );
    });

    test('Không thể trả lại đề xuất đã duyệt (HTTP 409 Conflict)', async () => {
      await assert.rejects(
        () => paymentService.rejectPaymentRequest(PROJECT_ID, approvedReqId, 6, 'Muốn trả lại sau khi đã duyệt'),
        (err) => {
          assert.strictEqual(err.status, 409);
          assert.ok(err.message.includes('đã được phê duyệt và bị khóa'));
          return true;
        }
      );
    });

    test('Không thể chỉnh sửa đề xuất đã duyệt (HTTP 409 Conflict)', async () => {
      await assert.rejects(
        () => paymentService.updatePaymentRequest(PROJECT_ID, approvedReqId, { name: 'Tên mới' }),
        (err) => {
          assert.strictEqual(err.status, 409);
          assert.ok(err.message.includes('không thể chỉnh sửa'));
          return true;
        }
      );
    });

    test('Không thể xóa đề xuất đã duyệt (HTTP 409 Conflict)', async () => {
      await assert.rejects(
        () => paymentService.deletePaymentRequest(PROJECT_ID, approvedReqId),
        (err) => {
          assert.strictEqual(err.status, 409);
          assert.ok(err.message.includes('không thể xóa'));
          return true;
        }
      );
    });

    test('Khóa nguồn phiếu: Không thể xóa phiếu nghiệm thu thuộc đề xuất đã duyệt (HTTP 409)', async () => {
      await assert.rejects(
        () => acceptanceService.deleteAcceptanceSheet(PROJECT_ID, SHEET_ID),
        (err) => {
          assert.strictEqual(err.status, 409);
          assert.ok(err.message.includes('đã được phê duyệt (đã bị khóa)'));
          return true;
        }
      );
    });

    test('Khóa nguồn phiếu: Không thể thêm ảnh hiện trường vào phiếu đã khóa (HTTP 409)', async () => {
      await assert.rejects(
        () => acceptanceService.addPhotos(PROJECT_ID, SHEET_ID, [{ file_name: 'anh_moi.jpg' }]),
        (err) => {
          assert.strictEqual(err.status, 409);
          assert.ok(err.message.includes('đã được phê duyệt (đã bị khóa)'));
          return true;
        }
      );
    });

    test('Khóa nguồn phiếu: Store in-memory chặn sửa phiếu nghiệm thu đã khóa (HTTP 409)', () => {
      assert.throws(
        () => store.updateAcceptanceSheet(SHEET_ID, { name: 'Sửa tên phiếu' }),
        (err) => {
          assert.strictEqual(err.status, 409);
          assert.ok(err.message.includes('đã được phê duyệt (đã bị khóa)'));
          return true;
        }
      );
    });
  });

  // ─── T-103: Giải phóng nguồn phiếu khi đề xuất được trả lại ─────────────────

  describe('T-103: Giải phóng nguồn phiếu khi đề xuất được trả lại', () => {
    test('Phiếu nghiệm thu được giải phóng và có thể chọn đưa vào đề xuất khác', async () => {
      const SHEET_ID = 105;
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: SHEET_ID, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Bê tông', period_quantity: 30 }]
      });

      // 1. Tạo đề xuất 1
      const res1 = await paymentService.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-REJECT-01',
        name: 'Đề xuất lần 1',
        period_number: 1
      }, 1);
      const reqId1 = res1.data.id;

      // Kiểm tra phiếu đã liên kết với reqId1
      const sheetBefore = store.inMemoryAcceptanceSheets.find(s => s.id === SHEET_ID);
      assert.strictEqual(sheetBefore.payment_request_id, reqId1);

      // Kiểm tra danh sách available-sheets trống
      let avail = await paymentService.getApprovedSheetsAvailable(PROJECT_ID);
      assert.strictEqual(avail.length, 0, 'Phiếu đã vào đề xuất 1 thì không còn trong available');

      // 2. Chủ đầu tư trả lại đề xuất 1
      const rejectRes = await paymentService.rejectPaymentRequest(PROJECT_ID, reqId1, 6, 'Bổ sung biên bản kiểm tra');
      assert.ok(rejectRes.success);
      assert.strictEqual(rejectRes.data.status, 'rejected');

      // 3. T-103 AC: Nguồn phiếu được giải phóng (payment_request_id = null)
      const sheetAfter = store.inMemoryAcceptanceSheets.find(s => s.id === SHEET_ID);
      assert.strictEqual(sheetAfter.payment_request_id, null, 'Phiếu phải được giải phóng payment_request_id = null');

      // 4. T-103 AC: Phiếu xuất hiện trở lại trong available-sheets
      avail = await paymentService.getApprovedSheetsAvailable(PROJECT_ID);
      assert.strictEqual(avail.length, 1, 'Phiếu đã giải phóng phải xuất hiện lại');
      assert.strictEqual(avail[0].sheet_id, SHEET_ID);

      // 5. T-103 AC: Có thể đưa phiếu đã giải phóng vào đề xuất mới khác
      const res2 = await paymentService.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-REJECT-02',
        name: 'Đề xuất lần 2 (đã điều chỉnh)',
        period_number: 1
      }, 1);
      assert.ok(res2.success);
      assert.strictEqual(res2.data.request_code, 'DNTT-REJECT-02');
      const sheetInReq2 = store.inMemoryAcceptanceSheets.find(s => s.id === SHEET_ID);
      assert.strictEqual(sheetInReq2.payment_request_id, res2.data.id, 'Phiếu đã được liên kết với đề xuất mới');

      // 6. T-103 AC: Đề xuất cũ vẫn giữ lại trạng thái lịch sử
      const oldReq = await paymentService.getPaymentRequestById(PROJECT_ID, reqId1);
      assert.ok(oldReq);
      assert.strictEqual(oldReq.status, 'rejected');
      assert.strictEqual(oldReq.rejection_reason, 'Bổ sung biên bản kiểm tra');
    });
  });

  // ─── T-104: Kiểm thử tích hợp HTTP API hoàn chỉnh ───────────────────────────

  describe('T-104: Kiểm tra toàn diện HTTP API trực tiếp (phân quyền, khóa dữ liệu, luồng trả lại)', () => {
    let app;
    let server;
    let baseUrl;
    let currentUser;

    beforeEach(async () => {
      app = express();
      app.use(express.json());

      // Dynamic mock auth user
      app.use((req, res, next) => {
        req.user = currentUser;
        next();
      });

      app.use('/api', paymentRoutes(null));
      app.use('/api', acceptanceRoutes(null));

      await new Promise(resolve => {
        server = app.listen(0, () => {
          const port = server.address().port;
          baseUrl = `http://localhost:${port}/api`;
          resolve();
        });
      });
    });

    test('Chủ đầu tư (role client, role_id 6) duyệt đề nghị qua API thành công 200', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 106, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Bê tông', period_quantity: 15 }]
      });

      currentUser = { id: 1, role_id: 1, role_name: 'admin' };
      const createRes = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/from-acceptance-sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_code: 'DNTT-HTTP-01', name: 'Đợt 1 HTTP' })
      });
      const createJson = await createRes.json();
      const reqId = createJson.data.id;

      // Đổi sang Chủ đầu tư
      currentUser = { id: 6, role_id: 6, role_name: 'client' };
      const approveRes = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/${reqId}/approve`, {
        method: 'POST'
      });
      assert.strictEqual(approveRes.status, 200);
      const approveJson = await approveRes.json();
      assert.ok(approveJson.success);
      assert.strictEqual(approveJson.data.status, 'approved');

      server.close();
    });

    test('Người không có quyền (viewer role 7, contractor role 4) gọi API duyệt/trả lại bị từ chối 403', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 107, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Bê tông', period_quantity: 15 }]
      });

      currentUser = { id: 1, role_id: 1, role_name: 'admin' };
      const createRes = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/from-acceptance-sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_code: 'DNTT-HTTP-02', name: 'Đợt 2 HTTP' })
      });
      const createJson = await createRes.json();
      const reqId = createJson.data.id;

      // Viewer thử duyệt -> 403 Forbidden
      currentUser = { id: 7, role_id: 7, role_name: 'viewer' };
      const resViewerApprove = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/${reqId}/approve`, {
        method: 'POST'
      });
      assert.strictEqual(resViewerApprove.status, 403);

      // Contractor (đội trưởng thi công) thử trả lại -> 403 Forbidden
      currentUser = { id: 4, role_id: 4, role_name: 'contractor' };
      const resContractorReject = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/${reqId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Contractor không có thẩm quyền' })
      });
      assert.strictEqual(resContractorReject.status, 403);

      server.close();
    });

    test('Chủ đầu tư trả lại đề xuất qua API không có lý do -> 400 Bad Request', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 108, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Bê tông', period_quantity: 15 }]
      });

      currentUser = { id: 1, role_id: 1, role_name: 'admin' };
      const createRes = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/from-acceptance-sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_code: 'DNTT-HTTP-03', name: 'Đợt 3 HTTP' })
      });
      const createJson = await createRes.json();
      const reqId = createJson.data.id;

      // Chủ đầu tư gọi reject nhưng không gửi reason
      currentUser = { id: 6, role_id: 6, role_name: 'client' };
      const rejectRes = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/${reqId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(rejectRes.status, 400);
      const json = await rejectRes.json();
      assert.strictEqual(json.success, false);
      assert.ok(json.message.includes('Lý do trả lại'));

      server.close();
    });

    test('Khóa API trực tiếp: Gọi PUT hoặc DELETE lên đề nghị đã duyệt -> 409 Locked/Conflict', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 109, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Bê tông', period_quantity: 15 }]
      });

      currentUser = { id: 1, role_id: 1, role_name: 'admin' };
      const createRes = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/from-acceptance-sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_code: 'DNTT-HTTP-04', name: 'Đợt 4 HTTP' })
      });
      const createJson = await createRes.json();
      const reqId = createJson.data.id;

      // Duyệt
      currentUser = { id: 6, role_id: 6, role_name: 'client' };
      await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/${reqId}/approve`, { method: 'POST' });

      // Gọi PUT sửa -> 409
      currentUser = { id: 1, role_id: 1, role_name: 'admin' };
      const putRes = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/${reqId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Tên sửa sau duyệt' })
      });
      assert.strictEqual(putRes.status, 409);

      // Gọi DELETE xóa -> 409
      const delRes = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/${reqId}`, {
        method: 'DELETE'
      });
      assert.strictEqual(delRes.status, 409);

      // Gọi DELETE xóa phiếu nghiệm thu nguồn của đề nghị đã duyệt -> 409
      const delSheetRes = await fetch(`${baseUrl}/projects/${PROJECT_ID}/acceptance-sheets/109`, {
        method: 'DELETE'
      });
      assert.strictEqual(delSheetRes.status, 409);

      server.close();
    });

    test('Luồng hoàn chỉnh: Tạo -> Trả lại & giải phóng phiếu -> Tạo đề nghị mới thành công 201', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 110, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Bê tông', period_quantity: 25 }]
      });

      currentUser = { id: 1, role_id: 1, role_name: 'admin' };
      // 1. Tạo đề nghị 1
      const res1 = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/from-acceptance-sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_code: 'DNTT-FLOW-01', name: 'Đợt Flow 1' })
      });
      assert.strictEqual(res1.status, 201);
      const reqId1 = (await res1.json()).data.id;

      // 2. Chủ đầu tư trả lại
      currentUser = { id: 6, role_id: 6, role_name: 'client' };
      const rejectRes = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/${reqId1}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ return_reason: 'Cần bổ sung chữ ký giám sát' })
      });
      assert.strictEqual(rejectRes.status, 200);

      // 3. Admin tạo đề nghị mới sử dụng lại phiếu 110 vừa được giải phóng
      currentUser = { id: 1, role_id: 1, role_name: 'admin' };
      const res2 = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/from-acceptance-sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_code: 'DNTT-FLOW-02', name: 'Đợt Flow 2 (Tạo lại thành công)' })
      });
      assert.strictEqual(res2.status, 201);
      const req2Data = (await res2.json()).data;
      assert.strictEqual(req2Data.request_code, 'DNTT-FLOW-02');

      server.close();
    });
  });
});
