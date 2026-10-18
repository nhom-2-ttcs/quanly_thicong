const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const AcceptanceService = require('../src/services/acceptanceService');
const store = require('../src/models/store');

describe('S-37: Luỹ kế nghiệm thu không vượt khối lượng hợp đồng (Sprint 6 / Epic E-06)', () => {
  let service;
  const mockProjectId = 99;

  beforeEach(() => {
    // Reset dữ liệu in-memory của dự án mock
    store.inMemoryAcceptanceSheets = store.inMemoryAcceptanceSheets.filter(s => s.project_id !== mockProjectId);
    store.inMemoryAcceptanceSheetItems = store.inMemoryAcceptanceSheetItems.filter(i => {
      const parentSheet = store.inMemoryAcceptanceSheets.find(s => s.id === i.sheet_id);
      return parentSheet && parentSheet.project_id !== mockProjectId;
    });
    store.inMemoryWorkItems = (store.inMemoryWorkItems || []).filter(w => w.project_id !== mockProjectId);

    // Khởi tạo 2 work_items có khối lượng hợp đồng
    store.inMemoryWorkItems.push(
      {
        id: 901,
        project_id: mockProjectId,
        code: 'CV-01',
        name: 'Đào đất hố móng trụ T1',
        unit: 'm3',
        quantity: 100.0,
        khoi_luong_hop_dong: 100.0,
        don_gia_hop_dong: 250000.0
      },
      {
        id: 902,
        project_id: mockProjectId,
        code: 'CV-02',
        name: 'Đổ bê tông lót móng',
        unit: 'm3',
        quantity: 50.0,
        khoi_luong_hop_dong: 50.0,
        don_gia_hop_dong: 1500000.0
      }
    );

    service = new AcceptanceService(null); // Sử dụng in-memory store
  });

  test('AC 3: getPrefillData trả về khối lượng hợp đồng của các hạng mục', async () => {
    const prefill = await service.getPrefillData(mockProjectId);
    assert.ok(prefill);
    assert.strictEqual(prefill.project_id, mockProjectId);
    assert.ok(Array.isArray(prefill.items));
    assert.strictEqual(prefill.items.length, 2);

    const item1 = prefill.items.find(i => i.work_item_id === 901);
    assert.ok(item1);
    assert.strictEqual(item1.contract_quantity, 100.0);
    assert.strictEqual(item1.code, 'CV-01');

    const item2 = prefill.items.find(i => i.work_item_id === 902);
    assert.ok(item2);
    assert.strictEqual(item2.contract_quantity, 50.0);
  });

  test('Trường hợp thành công: Luỹ kế nhỏ hơn hoặc bằng khối lượng hợp đồng', async () => {
    const payload = {
      sheet_code: 'NT-TEST-01',
      name: 'Nghiệm thu đợt 1',
      period_number: 1,
      from_date: '2026-10-01',
      to_date: '2026-10-15',
      items: [
        {
          work_item_id: 901,
          item_name: 'Đào đất hố móng trụ T1',
          unit: 'm3',
          cumulative_quantity: 80.0 // <= 100 hợp đồng
        },
        {
          work_item_id: 902,
          item_name: 'Đổ bê tông lót móng',
          unit: 'm3',
          cumulative_quantity: 50.0 // Bằng đúng hợp đồng
        }
      ]
    };

    const res = await service.createAcceptanceSheet(mockProjectId, payload, 1);
    assert.ok(res.success);
    assert.ok(res.data);
    assert.strictEqual(res.data.sheet_code, 'NT-TEST-01');
    assert.strictEqual(res.data.items.length, 2);
    assert.strictEqual(res.data.items[0].cumulative_quantity, 80.0);
    assert.strictEqual(res.data.items[0].period_quantity, 80.0);
    assert.strictEqual(res.data.items[1].cumulative_quantity, 50.0);
  });

  test('AC 1 & AC 2: Chặn khi luỹ kế vượt khối lượng hợp đồng, báo lỗi chi tiết số liệu', async () => {
    const payload = {
      sheet_code: 'NT-TEST-EXCESS',
      name: 'Nghiệm thu đợt vượt hạn mức',
      period_number: 1,
      from_date: '2026-10-01',
      to_date: '2026-10-15',
      items: [
        {
          work_item_id: 901,
          item_name: 'Đào đất hố móng trụ T1',
          unit: 'm3',
          cumulative_quantity: 120.0 // Vượt 100 HĐ
        }
      ]
    };

    await assert.rejects(
      async () => {
        await service.createAcceptanceSheet(mockProjectId, payload, 1);
      },
      (err) => {
        assert.strictEqual(err.status, 400);
        assert.ok(err.message.includes('vượt quá khối lượng hợp đồng'));
        assert.ok(err.message.includes('120'));
        assert.ok(err.message.includes('100'));
        assert.ok(err.message.includes('Đào đất hố móng trụ T1'));
        assert.ok(err.details);
        assert.strictEqual(err.details.work_item_id, 901);
        assert.strictEqual(err.details.contract_quantity, 100);
        assert.strictEqual(err.details.cumulative_quantity, 120);
        assert.strictEqual(err.details.excess_quantity, 20);
        return true;
      }
    );
  });

  test('Lỗi biên: Luỹ kế nhỏ hơn luỹ kế đã duyệt đợt trước bị chặn', async () => {
    // 1. Tạo và duyệt đợt 1 với luỹ kế 60m3
    const sheet1 = store.saveAcceptanceSheet({
      project_id: mockProjectId,
      sheet_code: 'NT-D01',
      name: 'Đợt 1',
      period_number: 1,
      status: 'approved'
    });
    store.saveAcceptanceSheetItem({
      sheet_id: sheet1.id,
      work_item_id: 901,
      item_name: 'Đào đất hố móng trụ T1',
      unit: 'm3',
      previous_approved_quantity: 0,
      cumulative_quantity: 60.0,
      period_quantity: 60.0
    });

    // 2. Cố tình nhập đợt 2 với luỹ kế 50m3 (< 60m3)
    const payload = {
      sheet_code: 'NT-D02',
      name: 'Đợt 2',
      period_number: 2,
      items: [
        {
          work_item_id: 901,
          item_name: 'Đào đất hố móng trụ T1',
          unit: 'm3',
          cumulative_quantity: 50.0 // Nhỏ hơn 60 đã duyệt
        }
      ]
    };

    await assert.rejects(
      async () => {
        await service.createAcceptanceSheet(mockProjectId, payload, 1);
      },
      (err) => {
        assert.strictEqual(err.status, 400);
        assert.ok(err.message.includes('nhỏ hơn luỹ kế đã duyệt đợt trước'));
        return true;
      }
    );
  });

  test('Race condition R-05 / T-99: Chặn 2 request đồng thời cố tình vượt hạn mức hợp đồng', async () => {
    // Khởi tạo một work item với khối lượng hợp đồng là 100
    store.inMemoryWorkItems = [
      {
        id: 950,
        project_id: mockProjectId,
        code: 'CV-RACE',
        name: 'Hạng mục kiểm tra đồng thời',
        unit: 'm3',
        quantity: 100.0,
        khoi_luong_hop_dong: 100.0
      }
    ];

    // Mô phỏng 2 request gửi đồng thời với luỹ kế vượt hợp đồng
    const req1 = service.createAcceptanceSheet(mockProjectId, {
      sheet_code: 'NT-RACE-01',
      name: 'Đợt 1 đồng thời',
      items: [{ work_item_id: 950, cumulative_quantity: 90.0 }]
    }, 1);

    const req2 = service.createAcceptanceSheet(mockProjectId, {
      sheet_code: 'NT-RACE-02',
      name: 'Đợt 2 đồng thời',
      items: [{ work_item_id: 950, cumulative_quantity: 110.0 }] // Vượt 100
    }, 1);

    const results = await Promise.allSettled([req1, req2]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1, 'Chỉ 1 request hợp lệ được chấp nhận');
    assert.strictEqual(rejected.length, 1, 'Request vượt hạn mức phải bị từ chối');
    assert.strictEqual(rejected[0].reason.status, 400);
  });
});
