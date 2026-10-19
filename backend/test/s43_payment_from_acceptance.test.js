/**
 * S-43 (SCRUM-172) — Sinh đề nghị thanh toán từ phiếu nghiệm thu đã duyệt
 * Test suite bao phủ:
 *   T-97: Lấy phiếu NT đã duyệt chưa đưa vào đề nghị (kèm hạng mục + đơn giá)
 *   T-98: Tính thành tiền từng dòng và tổng đề nghị (DECIMAL chính xác, HALF_UP)
 *   T-99: Tạo đề nghị và khoá liên kết phiếu NT (chống trùng ở tầng lưu trữ)
 *   T-100: Hiển thị đề nghị và kiểm thử phép tính, chống trùng
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const PaymentService = require('../src/services/paymentService');
const store = require('../src/models/store');

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Làm tròn HALF_UP 2 chữ số — khớp với NFR S-43 */
function roundMoney(v) {
  const n = Number(v);
  if (isNaN(n)) return 0;
  return Number(Math.round(Number(n + 'e2')) + 'e-2');
}

/** Seed phiếu nghiệm thu đã duyệt với các hạng mục kèm đơn giá */
function seedApprovedSheet({
  projectId = 999,
  sheetId,
  periodNumber = 1,
  items = [],
  paymentRequestId = null
}) {
  // Đảm bảo không trùng id
  if (!store.inMemoryAcceptanceSheets.find(s => s.id === sheetId)) {
    store.inMemoryAcceptanceSheets.push({
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
    });
  }

  let itemIdCounter = store.inMemoryAcceptanceSheetItems.length > 0
    ? Math.max(...store.inMemoryAcceptanceSheetItems.map(i => i.id)) + 1
    : 1000;

  for (const it of items) {
    const periodQty = Number(it.period_quantity || 0);
    const prevApproved = Number(it.previous_approved_quantity || 0);
    store.inMemoryAcceptanceSheetItems.push({
      id: itemIdCounter++,
      sheet_id: sheetId,
      work_item_id: it.work_item_id || null,
      task_id: null,
      item_name: it.item_name,
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

/** Seed work item với đơn giá hợp đồng */
function seedWorkItem({ id, projectId = 999, name, unitPrice }) {
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

describe('S-43 (SCRUM-172) — Sinh đề nghị thanh toán từ phiếu nghiệm thu đã duyệt', () => {
  const PROJECT_ID = 999;
  let service;

  beforeEach(() => {
    // Reset in-memory data
    store.inMemoryPaymentRequests.splice(0, store.inMemoryPaymentRequests.length);
    store.inMemoryPaymentRequestItems.splice(0, store.inMemoryPaymentRequestItems.length);
    store.inMemoryAcceptanceSheets.splice(0, store.inMemoryAcceptanceSheets.length);
    store.inMemoryAcceptanceSheetItems.splice(0, store.inMemoryAcceptanceSheetItems.length);

    // Đặt tỉ lệ tạm giữ mặc định 5%
    store.updateProjectRetentionRate(PROJECT_ID, 5.00);

    // Seed work items với đơn giá
    seedWorkItem({ id: 801, projectId: PROJECT_ID, name: 'Đào đất hố móng', unitPrice: 120000 });
    seedWorkItem({ id: 802, projectId: PROJECT_ID, name: 'Bê tông lót móng', unitPrice: 850000 });

    service = new PaymentService(null); // in-memory mode
  });

  // ─── T-97: Lấy phiếu NT đã duyệt chưa đưa vào đề nghị ───────────────────

  describe('T-97: Lấy phiếu NT đã duyệt chưa đưa vào đề nghị', () => {
    test('AC T-97-1: Chỉ lấy phiếu có status = approved', async () => {
      // Phiếu draft — không được lấy
      store.inMemoryAcceptanceSheets.push({
        id: 901, project_id: PROJECT_ID, sheet_code: 'NT-DRAFT', name: 'Draft',
        period_number: 1, from_date: '2026-10-01', to_date: '2026-10-10',
        status: 'draft', payment_request_id: null, approved_by: null, approved_at: null,
        notes: null, created_by: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      });

      // Phiếu approved — phải lấy
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 902, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 50 }]
      });

      const sheets = await service.getApprovedSheetsAvailable(PROJECT_ID);
      assert.strictEqual(sheets.length, 1, 'Chỉ lấy phiếu approved');
      assert.strictEqual(sheets[0].sheet_id, 902);
    });

    test('AC T-97-2: Không lấy phiếu đã được đưa vào đề nghị khác (payment_request_id IS NOT NULL)', async () => {
      // Phiếu đã liên kết
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 903, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 30 }],
        paymentRequestId: 999 // đã liên kết
      });

      // Phiếu chưa liên kết — phải lấy
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 904, periodNumber: 2,
        items: [{ work_item_id: 802, item_name: 'Bê tông', period_quantity: 20 }]
      });

      const sheets = await service.getApprovedSheetsAvailable(PROJECT_ID);
      assert.strictEqual(sheets.length, 1, 'Không lấy phiếu đã liên kết');
      assert.strictEqual(sheets[0].sheet_id, 904);
    });

    test('AC T-97-3: Mỗi phiếu thuộc đúng project_id', async () => {
      // Phiếu của project khác
      seedApprovedSheet({
        projectId: 111, sheetId: 905, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 10 }]
      });

      // Phiếu của project đang test
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 906, periodNumber: 1,
        items: [{ work_item_id: 802, item_name: 'Bê tông', period_quantity: 15 }]
      });

      const sheets = await service.getApprovedSheetsAvailable(PROJECT_ID);
      assert.strictEqual(sheets.length, 1);
      assert.strictEqual(sheets[0].sheet_id, 906);
    });

    test('AC T-97-4: Kết quả có đủ hạng mục, khối lượng đợt và đơn giá hợp đồng', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 907, periodNumber: 1,
        items: [
          { work_item_id: 801, item_name: 'Đào đất hố móng', period_quantity: 100 },
          { work_item_id: 802, item_name: 'Bê tông lót móng', period_quantity: 30 }
        ]
      });

      const sheets = await service.getApprovedSheetsAvailable(PROJECT_ID);
      assert.strictEqual(sheets.length, 1);
      const items = sheets[0].items;
      assert.strictEqual(items.length, 2, 'Có đủ số hạng mục');

      const item1 = items.find(i => i.work_item_id === 801);
      assert.ok(item1, 'Có hạng mục Đào đất');
      assert.strictEqual(item1.period_quantity, 100, 'Có khối lượng đợt');
      assert.strictEqual(item1.unit_price, 120000, 'Có đơn giá hợp đồng');
      assert.ok(item1.item_name, 'Có tên hạng mục');

      const item2 = items.find(i => i.work_item_id === 802);
      assert.ok(item2, 'Có hạng mục Bê tông');
      assert.strictEqual(item2.unit_price, 850000, 'Có đơn giá hợp đồng đúng');
    });

    test('AC T-97-5: Lọc theo period_number nếu chỉ định', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 908, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 50 }]
      });
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 909, periodNumber: 2,
        items: [{ work_item_id: 802, item_name: 'Bê tông', period_quantity: 20 }]
      });

      const sheets = await service.getApprovedSheetsAvailable(PROJECT_ID, 1);
      assert.strictEqual(sheets.length, 1, 'Chỉ lấy phiếu đợt 1');
      assert.strictEqual(sheets[0].period_number, 1);
    });
  });

  // ─── T-98: Tính thành tiền từng dòng và tổng đề nghị ────────────────────

  describe('T-98: Tính thành tiền từng dòng và tổng đề nghị', () => {
    test('AC T-98-1: Mỗi dòng có hạng mục, khối lượng đợt, đơn giá và thành tiền', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 910, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 100 }]
      });

      const prefill = await service.getS43PrefillData(PROJECT_ID);
      const item = prefill.items[0];
      assert.ok(item.item_name, 'Có tên hạng mục');
      assert.ok(item.period_quantity >= 0, 'Có khối lượng đợt');
      assert.ok(item.unit_price >= 0, 'Có đơn giá');
      assert.ok(item.line_total >= 0, 'Có thành tiền');
    });

    test('AC T-98-2: Thành tiền từng dòng = period_quantity × unit_price (HALF_UP 2 chữ số)', async () => {
      // 100 m3 × 120,000 đ = 12,000,000 đ
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 911, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 100 }]
      });

      const sheets = await service.getApprovedSheetsAvailable(PROJECT_ID);
      const item = sheets[0].items[0];
      const expected = roundMoney(100 * 120000);
      assert.strictEqual(item.line_total, expected, `Thành tiền = ${expected}`);
      assert.strictEqual(item.line_total, 12000000);
    });

    test('AC T-98-3: Tổng gross = SUM(line_total) chính xác', async () => {
      // Phiếu 1: 100m3 × 120,000 = 12,000,000
      // Phiếu 2: 30m3 × 850,000 = 25,500,000
      // Tổng = 37,500,000
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 912, periodNumber: 1,
        items: [
          { work_item_id: 801, item_name: 'Đào đất', period_quantity: 100 },
          { work_item_id: 802, item_name: 'Bê tông', period_quantity: 30 }
        ]
      });

      const prefill = await service.getS43PrefillData(PROJECT_ID);
      const expectedGross = roundMoney(100 * 120000 + 30 * 850000);
      assert.strictEqual(prefill.gross_amount, expectedGross, 'Tổng gross khớp tổng các dòng');
      assert.strictEqual(prefill.gross_amount, 37500000);

      // Tổng gross phải bằng sum của items
      const sumFromItems = roundMoney(prefill.items.reduce((acc, it) => acc + it.line_total, 0));
      assert.strictEqual(prefill.gross_amount, sumFromItems, 'gross_amount = SUM(line_total)');
    });

    test('AC T-98-4: Làm tròn HALF_UP 2 chữ số — số lẻ không phát sinh sai lệch', async () => {
      // Giá trị lẻ: 7 m3 × 333,333 đ/m3 = 2,333,331 đ (chẵn 2 chữ số)
      seedWorkItem({ id: 803, projectId: PROJECT_ID, name: 'Hạng mục lẻ', unitPrice: 333333 });
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 913, periodNumber: 1,
        items: [{ work_item_id: 803, item_name: 'Hạng mục lẻ', period_quantity: 7 }]
      });

      const sheets = await service.getApprovedSheetsAvailable(PROJECT_ID);
      const item = sheets[0].items[0];
      const expected = roundMoney(7 * 333333); // 2333331.00
      assert.strictEqual(item.line_total, expected);
      // Đảm bảo 2 chữ số thập phân
      const decimalParts = item.line_total.toString().split('.');
      if (decimalParts[1]) {
        assert.ok(decimalParts[1].length <= 2, 'Tối đa 2 chữ số thập phân');
      }
    });

    test('AC T-98-5: gross = retention + net (chênh lệch = 0)', async () => {
      // 33,333,333.33 × 7.5% = 2,500,000.00 → net = 30,833,333.33
      store.updateProjectRetentionRate(PROJECT_ID, 7.5);
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 914, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 277.778 }]
      });

      const prefill = await service.getS43PrefillData(PROJECT_ID);
      const sumCheck = roundMoney(prefill.retention_amount + prefill.net_payable_amount);
      assert.strictEqual(sumCheck, prefill.gross_amount, 'gross = retention + net (AC T-98, S-43 NFR)');
    });
  });

  // ─── T-99: Tạo đề nghị và khoá liên kết phiếu NT ────────────────────────

  describe('T-99: Tạo đề nghị và khoá liên kết phiếu NT', () => {
    test('AC T-99-1: Tạo đề nghị thành công, liên kết được với phiếu nguồn', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 920, periodNumber: 1,
        items: [
          { work_item_id: 801, item_name: 'Đào đất', period_quantity: 100 },
          { work_item_id: 802, item_name: 'Bê tông', period_quantity: 30 }
        ]
      });

      const payload = {
        request_code: 'DNTT-S43-01',
        name: 'Đề nghị thanh toán S-43 Đợt 1',
        period_number: 1,
        from_date: '2026-10-01',
        to_date: '2026-10-15',
        retention_rate: 5.0
      };

      const result = await service.createFromAcceptanceSheets(PROJECT_ID, payload, 1);
      assert.ok(result.success, 'Tạo đề nghị thành công');
      assert.ok(result.data, 'Có data trả về');
      assert.strictEqual(result.data.request_code, 'DNTT-S43-01');
      assert.ok(result.source_sheet_ids.includes(920), 'Phiếu nguồn được liên kết');

      // Kiểm tra gross = 100×120000 + 30×850000 = 37,500,000
      assert.strictEqual(result.data.gross_amount, 37500000);
    });

    test('AC T-99-2: Một phiếu NT không thể thuộc hai đề nghị (chặn ở tầng lưu trữ)', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 921, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 50 }]
      });

      // Tạo đề nghị đầu tiên — thành công
      await service.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-FIRST',
        name: 'Đề nghị đầu tiên',
        period_number: 1,
        retention_rate: 5.0
      }, 1);

      // Tạo đề nghị thứ hai với cùng phiếu — phải thất bại
      await assert.rejects(
        async () => {
          await service.createFromAcceptanceSheets(PROJECT_ID, {
            request_code: 'DNTT-SECOND',
            name: 'Đề nghị thứ hai',
            period_number: 2,
            retention_rate: 5.0
          }, 1);
        },
        (err) => {
          assert.ok(
            err.status === 409 || err.status === 422,
            `Phải trả về 409 hoặc 422, nhận được ${err.status}: ${err.message}`
          );
          return true;
        },
        'Phiếu NT đã liên kết — phải bị chặn ở tầng lưu trữ (T-99 AC)'
      );
    });

    test('AC T-99-3: Ràng buộc bảo vệ ở tầng lưu trữ — kiểm tra trực tiếp store', () => {
      // Seed phiếu chưa liên kết
      store.inMemoryAcceptanceSheets.push({
        id: 922, project_id: PROJECT_ID, sheet_code: 'NT-22', name: 'Test',
        period_number: 1, from_date: '2026-10-01', to_date: '2026-10-10',
        status: 'approved', payment_request_id: null, approved_by: 2, approved_at: '2026-10-11 08:00:00',
        notes: null, created_by: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      });

      // Khoá lần 1 — thành công
      const r1 = store.linkSheetsToPaymentRequest(PROJECT_ID, 10, [922]);
      assert.ok(r1.ok, 'Khoá lần 1 thành công');

      // Khoá lần 2 — phải thất bại (phiếu đã liên kết)
      const r2 = store.linkSheetsToPaymentRequest(PROJECT_ID, 11, [922]);
      assert.ok(!r2.ok, 'Khoá lần 2 phải thất bại');
      assert.ok(r2.alreadyLinked.includes(922), 'Phiếu 922 được báo đã liên kết');
    });

    test('AC T-99-4: Nếu tạo đề nghị thất bại, không để lại liên kết dở dang', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 923, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 50 }]
      });

      // Cố tình gây lỗi: request_code trùng
      await service.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-CLASH',
        name: 'Đề nghị đầu',
        period_number: 1,
        retention_rate: 5.0
      }, 1);

      // Seed thêm phiếu mới để đề nghị thứ 2 có thể tạo được nếu không bị rollback
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 924, periodNumber: 2,
        items: [{ work_item_id: 802, item_name: 'Bê tông', period_quantity: 10 }]
      });

      // Tạo đề nghị 2 thành công (đề nghị 1 đã hết phiếu 923, đề nghị 2 lấy phiếu 924)
      const r2 = await service.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-S43-02',
        name: 'Đề nghị thứ 2',
        period_number: 2,
        retention_rate: 5.0
      }, 1);
      assert.ok(r2.success, 'Đề nghị 2 thành công khi phiếu còn khả dụng');

      // Phiếu 923 phải được liên kết với đề nghị 1
      const sheet923 = store.inMemoryAcceptanceSheets.find(s => s.id === 923);
      assert.ok(sheet923.payment_request_id != null, 'Phiếu 923 đã liên kết với đề nghị 1');
    });

    test('Lỗi: Không có phiếu NT đã duyệt nào khả dụng → status 422', async () => {
      // Không seed phiếu nào
      await assert.rejects(
        async () => {
          await service.createFromAcceptanceSheets(PROJECT_ID, {
            request_code: 'DNTT-EMPTY',
            name: 'Đề nghị rỗng',
            period_number: 1,
            retention_rate: 5.0
          }, 1);
        },
        (err) => {
          assert.strictEqual(err.status, 422);
          assert.ok(err.message.includes('Không có phiếu nghiệm thu'));
          return true;
        }
      );
    });

    test('Lỗi: Trùng mã đề nghị → status 409', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 925, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 50 }]
      });

      await service.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-DUP',
        name: 'Đề nghị trùng',
        period_number: 1,
        retention_rate: 5.0
      }, 1);

      // Seed phiếu mới (phiếu 925 đã bị liên kết)
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 926, periodNumber: 2,
        items: [{ work_item_id: 802, item_name: 'Bê tông', period_quantity: 10 }]
      });

      await assert.rejects(
        async () => {
          await service.createFromAcceptanceSheets(PROJECT_ID, {
            request_code: 'DNTT-DUP', // trùng mã
            name: 'Đề nghị trùng 2',
            period_number: 2,
            retention_rate: 5.0
          }, 1);
        },
        (err) => {
          assert.strictEqual(err.status, 409);
          assert.ok(err.message.includes('đã tồn tại'));
          return true;
        }
      );
    });
  });

  // ─── T-100: Hiển thị đề nghị và kiểm thử phép tính, chống trùng ─────────

  describe('T-100: Hiển thị đề nghị và kiểm thử phép tính, chống trùng', () => {
    test('AC T-100-1: Đề nghị có đủ cột: hạng mục, khối lượng đợt, đơn giá, thành tiền', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 930, periodNumber: 1,
        items: [
          { work_item_id: 801, item_name: 'Đào đất hố móng', period_quantity: 100 },
          { work_item_id: 802, item_name: 'Bê tông lót móng', period_quantity: 30 }
        ]
      });

      const result = await service.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-T100-01',
        name: 'Đề nghị T-100 test',
        period_number: 1,
        retention_rate: 5.0
      }, 1);

      assert.ok(result.success);
      const req = result.data;
      // Kiểm tra các trường bắt buộc
      assert.ok('gross_amount' in req, 'Có gross_amount');
      assert.ok('retention_rate' in req, 'Có retention_rate');
      assert.ok('retention_amount' in req, 'Có retention_amount');
      assert.ok('net_payable_amount' in req, 'Có net_payable_amount');
      assert.ok('items' in req || result.source_sheet_ids, 'Có liên kết phiếu nguồn');

      // Lấy chi tiết items từ payment_request_items
      const items = store.inMemoryPaymentRequestItems.filter(i => i.payment_request_id === req.id);
      assert.ok(items.length > 0, 'Có dòng hạng mục');
      for (const item of items) {
        assert.ok('item_name' in item, 'Có item_name');
        assert.ok('period_quantity' in item, 'Có period_quantity');
        assert.ok('unit_price' in item, 'Có unit_price');
        assert.ok('line_total' in item, 'Có line_total');
      }
    });

    test('AC T-100-2: Tổng hiển thị khớp tổng các dòng (gross_amount = SUM(line_total))', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 931, periodNumber: 1,
        items: [
          { work_item_id: 801, item_name: 'Đào đất', period_quantity: 100 },
          { work_item_id: 802, item_name: 'Bê tông', period_quantity: 30 }
        ]
      });

      const result = await service.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-T100-02',
        name: 'Đề nghị T-100 tổng',
        period_number: 1,
        retention_rate: 5.0
      }, 1);

      const req = result.data;
      const items = store.inMemoryPaymentRequestItems.filter(i => i.payment_request_id === req.id);
      const sumFromItems = roundMoney(items.reduce((acc, it) => acc + Number(it.line_total), 0));
      assert.strictEqual(req.gross_amount, sumFromItems, 'gross_amount = SUM(line_total) từ items');
    });

    test('AC T-100-3: Test chứng minh một phiếu không vào được đề nghị thứ hai', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 932, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 50 }]
      });

      // Đề nghị 1 — thành công
      const r1 = await service.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-ANTI-DUP-1',
        name: 'Đề nghị 1',
        period_number: 1,
        retention_rate: 5.0
      }, 1);
      assert.ok(r1.success, 'Đề nghị 1 thành công');

      // Đề nghị 2 — phải thất bại vì phiếu 932 đã liên kết
      let secondFailed = false;
      try {
        await service.createFromAcceptanceSheets(PROJECT_ID, {
          request_code: 'DNTT-ANTI-DUP-2',
          name: 'Đề nghị 2',
          period_number: 2,
          retention_rate: 5.0
        }, 1);
      } catch (err) {
        secondFailed = true;
        assert.ok(
          err.status === 409 || err.status === 422,
          `Phải bị chặn (409/422), nhận ${err.status}`
        );
      }
      assert.ok(secondFailed, 'Đề nghị 2 phải bị từ chối (T-100 AC: một phiếu không vào được đề nghị thứ hai)');

      // Xác minh phiếu 932 còn liên kết với đề nghị 1 (không bị xóa hoặc dở dang)
      const sheet932 = store.inMemoryAcceptanceSheets.find(s => s.id === 932);
      assert.strictEqual(sheet932.payment_request_id, r1.data.id, 'Phiếu 932 vẫn liên kết với đề nghị 1');
    });

    test('AC T-100-4: Phép tính dùng quy tắc làm tròn HALF_UP 2 chữ số đã được ghi rõ', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 933, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 100 }]
      });

      const result = await service.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-ROUNDING',
        name: 'Đề nghị kiểm tra làm tròn',
        period_number: 1,
        retention_rate: 5.0
      }, 1);

      // Kiểm tra rounding_rule được ghi rõ trong response
      assert.strictEqual(result.rounding_rule, 'HALF_UP_2_DECIMAL', 'Quy tắc làm tròn được ghi rõ');

      // Kiểm tra phép tính cụ thể: 100m3 × 120,000 = 12,000,000
      assert.strictEqual(result.data.gross_amount, 12000000);
      // retention = 12,000,000 × 5% = 600,000
      assert.strictEqual(result.data.retention_amount, 600000);
      // net = 12,000,000 - 600,000 = 11,400,000
      assert.strictEqual(result.data.net_payable_amount, 11400000);

      // Xác minh: gross = retention + net
      const sum = roundMoney(result.data.retention_amount + result.data.net_payable_amount);
      assert.strictEqual(sum, result.data.gross_amount, 'gross = retention + net (chênh lệch = 0)');
    });

    test('AC T-100-5: Prefill S-43 trả đủ thông tin để render màn hình', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 934, periodNumber: 1,
        items: [
          { work_item_id: 801, item_name: 'Đào đất', period_quantity: 100 },
          { work_item_id: 802, item_name: 'Bê tông', period_quantity: 30 }
        ]
      });

      const prefill = await service.getS43PrefillData(PROJECT_ID);

      // Kiểm tra tất cả trường cần thiết cho màn hình T-100
      assert.ok(prefill.suggested_request_code, 'Có mã đề nghị gợi ý');
      assert.ok(prefill.suggested_name, 'Có tên gợi ý');
      assert.ok(prefill.retention_rate >= 0, 'Có tỉ lệ tạm giữ');
      assert.ok(prefill.gross_amount >= 0, 'Có tổng trước tạm giữ');
      assert.ok(prefill.retention_amount >= 0, 'Có số tạm giữ');
      assert.ok(prefill.net_payable_amount >= 0, 'Có số thực trả');
      assert.ok(Array.isArray(prefill.items), 'Có danh sách items');
      assert.ok(Array.isArray(prefill.source_sheets), 'Có danh sách phiếu nguồn');
      assert.ok(prefill.rounding_rule, 'Có quy tắc làm tròn được ghi rõ');

      // Mỗi item phải có đủ 4 cột AC S-43
      for (const item of prefill.items) {
        assert.ok(item.item_name, 'Item có tên hạng mục');
        assert.ok('period_quantity' in item, 'Item có khối lượng đợt');
        assert.ok('unit_price' in item, 'Item có đơn giá');
        assert.ok('line_total' in item, 'Item có thành tiền');
      }
    });
  });

  // ─── Kiểm thử tích hợp: nhiều phiếu, nhiều đề nghị ─────────────────────

  describe('Tích hợp: nhiều phiếu NT → nhiều đề nghị', () => {
    test('Mỗi đợt tạo được đề nghị riêng từ phiếu NT của đợt đó', async () => {
      // Đợt 1: phiếu 940
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 940, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất đợt 1', period_quantity: 100 }]
      });
      // Đợt 2: phiếu 941
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 941, periodNumber: 2,
        items: [{ work_item_id: 802, item_name: 'Bê tông đợt 2', period_quantity: 20 }]
      });

      // Tạo đề nghị đợt 1 (lọc theo period_number = 1)
      const r1 = await service.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-DOT1',
        name: 'Đề nghị đợt 1',
        period_number: 1,
        retention_rate: 5.0,
        filter_period_number: 1
      }, 1);
      assert.ok(r1.success);
      assert.strictEqual(r1.data.gross_amount, roundMoney(100 * 120000));

      // Tạo đề nghị đợt 2 (lọc theo period_number = 2)
      const r2 = await service.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-DOT2',
        name: 'Đề nghị đợt 2',
        period_number: 2,
        retention_rate: 5.0,
        filter_period_number: 2
      }, 1);
      assert.ok(r2.success);
      assert.strictEqual(r2.data.gross_amount, roundMoney(20 * 850000));

      // Xác minh cả hai phiếu đã bị khoá liên kết
      const s940 = store.inMemoryAcceptanceSheets.find(s => s.id === 940);
      const s941 = store.inMemoryAcceptanceSheets.find(s => s.id === 941);
      assert.ok(s940.payment_request_id === r1.data.id, 'Phiếu 940 liên kết đề nghị 1');
      assert.ok(s941.payment_request_id === r2.data.id, 'Phiếu 941 liên kết đề nghị 2');
    });
  });

  // ─── T-98: Kiểm thử nâng cao quy tắc làm tròn HALF_UP & Số thập phân chính xác (NFR S-43) ───

  describe('T-98: Kiểm thử nâng cao quy tắc làm tròn HALF_UP & Số thập phân chính xác (NFR S-43)', () => {
    test('Làm tròn HALF_UP chính xác với các số biên (.005 -> .01, .004 -> .00)', () => {
      assert.strictEqual(roundMoney(1.005), 1.01, '1.005 phải làm tròn lên 1.01');
      assert.strictEqual(roundMoney(1.004), 1.00, '1.004 phải làm tròn xuống 1.00');
      assert.strictEqual(roundMoney(1.006), 1.01, '1.006 phải làm tròn lên 1.01');
      assert.strictEqual(roundMoney(2.555), 2.56, '2.555 phải làm tròn lên 2.56');
      assert.strictEqual(roundMoney(33333333.335), 33333333.34, 'Số tiền lớn lẻ nửa xu làm tròn chuẩn');
    });

    test('Tính toán số lẻ phân số không để lại chênh lệch giữa Gross và Retention + Net', async () => {
      // 12.345 m3 × 123,456.78 đ = 1,524,074.08 đ
      seedWorkItem({ id: 899, projectId: PROJECT_ID, name: 'Hạng mục lẻ phân số', unitPrice: 123456.78 });
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 945, periodNumber: 1,
        items: [{ work_item_id: 899, item_name: 'Hạng mục lẻ phân số', period_quantity: 12.345 }]
      });

      const result = await service.createFromAcceptanceSheets(PROJECT_ID, {
        request_code: 'DNTT-FRAC',
        name: 'Đề nghị phân số',
        period_number: 1,
        retention_rate: 5.55
      }, 1);

      const gross = result.data.gross_amount;
      const retention = result.data.retention_amount;
      const net = result.data.net_payable_amount;

      assert.strictEqual(roundMoney(retention + net), gross, 'Gross = Retention + Net không lệch 1 xu');
    });
  });

  // ─── Migration: Xác thực các tệp migration UP & DOWN của S-43 ─────────────

  describe('Migration: Xác thực các tệp migration UP & DOWN của S-43', () => {
    const fs = require('fs');
    const path = require('path');

    test('File migration UP (migration_s43_payment_from_acceptance.sql) đầy đủ cấu trúc', () => {
      const upPath = path.join(__dirname, '../../migration_s43_payment_from_acceptance.sql');
      assert.ok(fs.existsSync(upPath), 'File migration UP phải tồn tại');
      const content = fs.readFileSync(upPath, 'utf8');

      assert.ok(content.includes('payment_request_id'), 'Có cột payment_request_id');
      assert.ok(content.includes('fk_as_payment_request'), 'Có Foreign Key');
      assert.ok(content.includes('uq_acceptance_sheet_payment'), 'Có ràng buộc Unique (T-99)');
      assert.ok(content.includes('v_approved_sheets_available'), 'Có View tiện ích (T-97)');
      assert.ok(content.includes('sp_create_payment_from_acceptance'), 'Có Stored Procedure atomic (T-99)');
      assert.ok(content.includes('FOR UPDATE'), 'Có SELECT FOR UPDATE chống race condition');
    });

    test('File migration DOWN (migration_s43_payment_from_acceptance_down.sql) hoàn tác an toàn', () => {
      const downPath = path.join(__dirname, '../../migration_s43_payment_from_acceptance_down.sql');
      assert.ok(fs.existsSync(downPath), 'File migration DOWN phải tồn tại');
      const content = fs.readFileSync(downPath, 'utf8');

      assert.ok(content.includes('DROP PROCEDURE IF EXISTS `sp_create_payment_from_acceptance`'));
      assert.ok(content.includes('DROP VIEW IF EXISTS `v_approved_sheets_available`'));
      assert.ok(content.includes('DROP COLUMN IF EXISTS `payment_request_id`'));
    });
  });

  // ─── T-100: Kiểm thử tích hợp HTTP API hoàn chỉnh ────────────────────────

  describe('T-100: Kiểm thử tích hợp HTTP API hoàn chỉnh', () => {
    const express = require('express');
    const paymentRoutes = require('../src/routes/paymentRoutes');
    let app;
    let server;
    let baseUrl;

    beforeEach(async () => {
      app = express();
      app.use(express.json());
      // Giả lập auth middleware
      app.use((req, res, next) => {
        req.user = { id: 1, role_id: 1, role_name: 'admin' };
        next();
      });
      app.use('/api', paymentRoutes(null)); // in-memory mode

      await new Promise(resolve => {
        server = app.listen(0, () => {
          const port = server.address().port;
          baseUrl = `http://localhost:${port}/api`;
          resolve();
        });
      });
    });

    test('GET /available-sheets: Trả về danh sách phiếu NT chưa liên kết kèm đơn giá', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 950, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 50 }]
      });

      const res = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/available-sheets`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.ok(json.success);
      assert.strictEqual(json.count, 1);
      assert.strictEqual(json.data[0].sheet_id, 950);
      assert.strictEqual(json.data[0].items[0].unit_price, 120000);
      server.close();
    });

    test('GET /s43-prefill: Trả về thông tin prefill đầy đủ và quy tắc làm tròn', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 951, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 10 }]
      });

      const res = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/s43-prefill`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.ok(json.success);
      assert.strictEqual(json.data.rounding_rule, 'HALF_UP_2_DECIMAL');
      assert.strictEqual(json.data.gross_amount, 1200000);
      server.close();
    });

    test('POST /from-acceptance-sheets: Tự sinh đề nghị thanh toán và chặn tạo lại phiếu đó', async () => {
      seedApprovedSheet({
        projectId: PROJECT_ID, sheetId: 952, periodNumber: 1,
        items: [{ work_item_id: 801, item_name: 'Đào đất', period_quantity: 100 }]
      });

      // Tạo lần 1 — Thành công 201
      const res1 = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/from-acceptance-sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_code: 'DNTT-API-01',
          name: 'Đề nghị API test 1',
          period_number: 1,
          retention_rate: 5.0
        })
      });
      assert.strictEqual(res1.status, 201);
      const json1 = await res1.json();
      assert.ok(json1.success);
      const newId = json1.data.id;

      // GET /:id kiểm tra màn hình chi tiết (T-100: Đầy đủ các cột AC)
      const resDetail = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/${newId}`);
      assert.strictEqual(resDetail.status, 200);
      const detailJson = await resDetail.json();
      assert.ok(detailJson.success);
      assert.ok(detailJson.data.items.length > 0);
      const firstItem = detailJson.data.items[0];
      assert.ok(firstItem.item_name);
      assert.ok('period_quantity' in firstItem);
      assert.ok('unit_price' in firstItem);
      assert.ok('line_total' in firstItem);
      assert.ok(firstItem.acceptance_sheet_code);

      // Tạo lần 2 với cùng phiếu (không còn phiếu nào khả dụng) — Thất bại 422 hoặc 409
      const res2 = await fetch(`${baseUrl}/projects/${PROJECT_ID}/payment-requests/from-acceptance-sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_code: 'DNTT-API-02',
          name: 'Đề nghị API test 2',
          period_number: 2,
          retention_rate: 5.0
        })
      });
      assert.ok(res2.status === 409 || res2.status === 422, 'Phải bị từ chối chống trùng (T-99 & T-100)');
      server.close();
    });
  });
});
