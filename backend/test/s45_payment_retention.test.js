const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const PaymentService = require('../src/services/paymentService');
const store = require('../src/models/store');

describe('S-45: Phần tạm giữ theo hợp đồng được trừ đúng trên mỗi đề nghị (Sprint 7 / Epic E-08)', () => {
  let service;
  const mockProjectId = 99;

  beforeEach(() => {
    // Reset in-memory data via splice
    store.inMemoryPaymentRequests.splice(0, store.inMemoryPaymentRequests.length);
    store.inMemoryPaymentRequestItems.splice(0, store.inMemoryPaymentRequestItems.length);

    // Seed dự án với tỉ lệ tạm giữ hợp đồng mặc định 5%
    store.updateProjectRetentionRate(mockProjectId, 5.00);

    service = new PaymentService(null); // in-memory store
  });

  test('AC 1: Lấy và cập nhật tỉ lệ tạm giữ hợp đồng (%) của dự án', async () => {
    // 1. Mặc định là 5.00%
    const currentRate = await service.getProjectRetentionRate(mockProjectId);
    assert.strictEqual(currentRate, 5.00);

    // 2. Cập nhật thành 8.5%
    const updateRes = await service.updateProjectRetentionRate(mockProjectId, 8.5);
    assert.ok(updateRes.success);
    assert.strictEqual(updateRes.retention_rate, 8.50);

    // 3. Lấy lại để xác nhận đã lưu
    const updatedRate = await service.getProjectRetentionRate(mockProjectId);
    assert.strictEqual(updatedRate, 8.50);
  });

  test('Lỗi dữ liệu: Chặn tỉ lệ tạm giữ không hợp lệ (< 0% hoặc > 100%) với lỗi 400', async () => {
    await assert.rejects(
      async () => {
        await service.updateProjectRetentionRate(mockProjectId, -2);
      },
      (err) => {
        assert.strictEqual(err.status, 400);
        assert.ok(err.message.includes('0% đến 100%'));
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await service.updateProjectRetentionRate(mockProjectId, 105);
      },
      (err) => {
        assert.strictEqual(err.status, 400);
        return true;
      }
    );
  });

  test('AC 2, AC 3 & AC 4: Lập đề nghị thanh toán tự động trừ đúng phần tạm giữ, chênh lệch bằng 0', async () => {
    // Tỉ lệ tạm giữ dự án đang là 5%
    const payload = {
      request_code: 'DNTT-01',
      name: 'Đề nghị thanh toán Đợt 1',
      period_number: 1,
      from_date: '2026-10-01',
      to_date: '2026-10-15',
      gross_amount: 100000000.0, // 100 triệu đồng
      items: [
        {
          acceptance_sheet_id: 1,
          item_name: 'Đào đất hố móng',
          unit: 'm3',
          period_quantity: 100,
          unit_price: 1000000,
          line_total: 100000000.0
        }
      ]
    };

    const res = await service.createPaymentRequest(mockProjectId, payload, 1);
    assert.ok(res.success);
    const req = res.data;
    assert.ok(req);
    assert.strictEqual(req.request_code, 'DNTT-01');
    assert.strictEqual(req.gross_amount, 100000000.0);
    assert.strictEqual(req.retention_rate, 5.00);

    // AC 2: retention_amount = 100tr * 5% = 5 triệu
    assert.strictEqual(req.retention_amount, 5000000.0);

    // AC 3: net_payable_amount = 100tr - 5tr = 95 triệu
    assert.strictEqual(req.net_payable_amount, 95000000.0);

    // AC 4: Chênh lệch tuyệt đối bằng 0 (gross = retention + net)
    const sum = Number((req.retention_amount + req.net_payable_amount).toFixed(2));
    assert.strictEqual(sum, req.gross_amount);
  });

  test('Lỗi biên: Làm tròn số thập phân không phát sinh sai lệch giữa các phần tiền', async () => {
    // Giá trị lẻ: 33,333,333.33 đ với tỉ lệ 7.5%
    const payload = {
      request_code: 'DNTT-ODD',
      name: 'Đề nghị thanh toán số lẻ',
      period_number: 2,
      gross_amount: 33333333.33,
      retention_rate: 7.5,
      items: []
    };

    const res = await service.createPaymentRequest(mockProjectId, payload, 1);
    const req = res.data;
    assert.ok(req);

    // 33,333,333.33 * 7.5% = 2,500,000.00
    assert.strictEqual(req.retention_amount, 2500000.0);
    assert.strictEqual(req.net_payable_amount, 30833333.33);

    // AC 4: gross_amount = retention_amount + net_payable_amount
    const total = Number((req.retention_amount + req.net_payable_amount).toFixed(2));
    assert.strictEqual(total, req.gross_amount);
  });

  test('AC 5: Tính tổng tiền tạm giữ luỹ kế qua các đợt đề nghị thanh toán', async () => {
    // Đợt 1: 100 triệu, giữ 5% = 5 triệu
    await service.createPaymentRequest(mockProjectId, {
      request_code: 'DNTT-D01',
      name: 'Đợt 1',
      period_number: 1,
      gross_amount: 100000000.0,
      retention_rate: 5.0
    }, 1);

    // Đợt 2: 200 triệu, giữ 5% = 10 triệu
    await service.createPaymentRequest(mockProjectId, {
      request_code: 'DNTT-D02',
      name: 'Đợt 2',
      period_number: 2,
      gross_amount: 200000000.0,
      retention_rate: 5.0
    }, 1);

    // Đợt 3: 50 triệu, giữ 5% = 2.5 triệu
    await service.createPaymentRequest(mockProjectId, {
      request_code: 'DNTT-D03',
      name: 'Đợt 3',
      period_number: 3,
      gross_amount: 50000000.0,
      retention_rate: 5.0
    }, 1);

    const listData = await service.getPaymentRequests(mockProjectId);
    assert.ok(listData);
    assert.strictEqual(listData.requests.length, 3);
    assert.strictEqual(listData.summary.cumulative_gross_amount, 350000000.0); // 100 + 200 + 50 = 350tr
    assert.strictEqual(listData.summary.cumulative_retention_amount, 17500000.0); // 5 + 10 + 2.5 = 17.5tr (AC 5)
    assert.strictEqual(listData.summary.cumulative_net_payable_amount, 332500000.0); // 350 - 17.5 = 332.5tr
  });

  test('Phê duyệt đề nghị thanh toán thành công', async () => {
    const created = await service.createPaymentRequest(mockProjectId, {
      request_code: 'DNTT-APPROVE',
      name: 'Đợt duyệt',
      gross_amount: 50000000.0,
      retention_rate: 5.0
    }, 1);

    const approved = await service.approvePaymentRequest(mockProjectId, created.data.id, 2);
    assert.ok(approved.success);
    assert.strictEqual(approved.data.status, 'approved');
    assert.strictEqual(approved.data.approved_by, 2);
    assert.ok(approved.data.approved_at);
  });
});
