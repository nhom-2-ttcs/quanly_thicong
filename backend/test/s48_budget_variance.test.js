const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const BudgetVarianceService = require('../src/services/budgetVarianceService');
const store = require('../src/models/store');

describe('S-48 (SCRUM-224): So sánh và cảnh báo dự toán, thực chi theo cây WBS', () => {
  let service;
  const mockProjectId = 88;

  beforeEach(() => {
    // Reset và khởi tạo môi trường in-memory cho project mock
    store.inMemoryWorkItems = (store.inMemoryWorkItems || []).filter(
      w => Number(w.project_id) !== mockProjectId
    );

    // Khởi tạo cây WBS phân cấp 3 tầng cho dự án mock
    // Cấp 0: Nút gốc (HM-00)
    // Cấp 1: HM-01 (Móng), HM-02 (Thân)
    // Cấp 2: Các hạng mục lá
    store.inMemoryWorkItems.push(
      {
        id: 8800,
        project_id: mockProjectId,
        parent_id: null,
        code: 'HM-ROOT',
        name: 'Dự án Xây dựng công trình Mock S-48',
        unit: 'Gói',
        khoi_luong_du_toan: 0,
        don_gia_du_toan: 0,
        thanh_tien_du_toan: 0,
        thuc_chi: 0,
        khoi_luong_thu_duoc: 0
      },
      {
        id: 8810,
        project_id: mockProjectId,
        parent_id: 8800,
        code: 'HM-01',
        name: 'Phần Ngầm và Móng',
        unit: 'Hạng mục',
        khoi_luong_du_toan: 0,
        don_gia_du_toan: 0,
        thanh_tien_du_toan: 0,
        thuc_chi: 0,
        khoi_luong_thu_duoc: 0
      },
      {
        id: 8811,
        project_id: mockProjectId,
        parent_id: 8810,
        code: 'HM-01.01',
        name: 'Đào hố móng',
        unit: 'm3',
        khoi_luong_du_toan: 100,
        don_gia_du_toan: 500000,
        thanh_tien_du_toan: 50000000,
        thuc_chi: 45000000,         // 90% chi phí (> 80%)
        khoi_luong_thu_duoc: 60      // 60% khối lượng (< 80%) => CẢNH BÁO
      },
      {
        id: 8812,
        project_id: mockProjectId,
        parent_id: 8810,
        code: 'HM-01.02',
        name: 'Bê tông lót móng',
        unit: 'm3',
        khoi_luong_du_toan: 80,
        don_gia_du_toan: 1000000,
        thanh_tien_du_toan: 80000000,
        thuc_chi: 70000000,         // 87.5% chi phí (> 80%)
        khoi_luong_thu_duoc: 72      // 90% khối lượng (>= 80%) => KHÔNG CẢNH BÁO
      },
      {
        id: 8820,
        project_id: mockProjectId,
        parent_id: 8800,
        code: 'HM-02',
        name: 'Phần Thân và Kết cấu',
        unit: 'Hạng mục',
        khoi_luong_du_toan: 0,
        don_gia_du_toan: 0,
        thanh_tien_du_toan: 0,
        thuc_chi: 0,
        khoi_luong_thu_duoc: 0
      },
      {
        id: 8821,
        project_id: mockProjectId,
        parent_id: 8820,
        code: 'HM-02.01',
        name: 'Cốt thép cột dầm',
        unit: 'tấn',
        khoi_luong_du_toan: 50,
        don_gia_du_toan: 2000000,
        thanh_tien_du_toan: 100000000,
        thuc_chi: 40000000,         // 40% chi phí (<= 80%)
        khoi_luong_thu_duoc: 20      // 40% khối lượng => KHÔNG CẢNH BÁO
      },
      {
        id: 8822,
        project_id: mockProjectId,
        parent_id: 8820,
        code: 'HM-02.02',
        name: 'Ván khuôn phủ phim',
        unit: 'm2',
        khoi_luong_du_toan: 200,
        don_gia_du_toan: 300000,
        thanh_tien_du_toan: 60000000,
        thuc_chi: 55000000,         // 91.67% chi phí (> 80%)
        khoi_luong_thu_duoc: 100     // 50% khối lượng (< 80%) => CẢNH BÁO
      }
    );

    service = new BudgetVarianceService(null); // Standalone in-memory mode
  });

  // =========================================================================
  // T-113: TÍNH DỰ TOÁN, THỰC CHI VÀ TỔNG THEO CÂY
  // =========================================================================
  describe('T-113: Tính dự toán, thực chi và tổng theo cây', () => {
    test('AC 1: Nhận dự toán từ S-46 và cập nhật thành công cho hạng mục lá', async () => {
      const updated = await service.updateLeafBudget(8811, {
        khoi_luong_du_toan: 120,
        don_gia_du_toan: 600000,
        thanh_tien_du_toan: 72000000
      });

      assert.strictEqual(updated.khoi_luong_du_toan, 120);
      assert.strictEqual(updated.don_gia_du_toan, 600000);
      assert.strictEqual(updated.thanh_tien_du_toan, 72000000);
    });

    test('AC 2: Chặn khai báo dự toán trên hạng mục cha với HTTP 400', async () => {
      // 8810 là hạng mục cha có con là 8811 và 8812
      await assert.rejects(
        async () => {
          await service.updateLeafBudget(8810, {
            khoi_luong_du_toan: 50,
            don_gia_du_toan: 1000000
          });
        },
        (err) => {
          assert.strictEqual(err.status, 400);
          assert.match(err.message, /hạng mục lá/i);
          return true;
        }
      );
    });

    test('AC 3: Nhận thực chi và khối lượng thu được từ S-47 cho hạng mục lá', async () => {
      const updated = await service.updateLeafActualExpense(8811, {
        thuc_chi: 48000000,
        khoi_luong_thu_duoc: 65
      });

      assert.strictEqual(updated.thuc_chi, 48000000);
      assert.strictEqual(updated.khoi_luong_thu_duoc, 65);
    });

    test('AC 4: Chặn nhập thực chi trên hạng mục cha với HTTP 400', async () => {
      await assert.rejects(
        async () => {
          await service.updateLeafActualExpense(8810, {
            thuc_chi: 100000000,
            khoi_luong_thu_duoc: 50
          });
        },
        (err) => {
          assert.strictEqual(err.status, 400);
          assert.match(err.message, /hạng mục lá/i);
          return true;
        }
      );
    });

    test('AC 5: Tính tổng dự toán và thực chi cộng dồn chuẩn xác từ lá lên các nút cha', async () => {
      const report = await service.getProjectBudgetVarianceReport(mockProjectId);
      const root = report.tree[0]; // Nút 8800
      assert.ok(root, 'Cây phải có nút gốc');

      // Nhánh 1 (HM-01):
      // Lá 8811: 50,000,000 đ | Thực chi: 45,000,000 đ
      // Lá 8812: 80,000,000 đ | Thực chi: 70,000,000 đ
      // => HM-01 = 130,000,000 đ | Thực chi = 115,000,000 đ
      const hm01 = root.children.find(c => c.id === 8810);
      assert.ok(hm01, 'Phải tìm thấy HM-01');
      assert.strictEqual(hm01.budget_cost, 130000000);
      assert.strictEqual(hm01.actual_cost, 115000000);

      // Nhánh 2 (HM-02):
      // Lá 8821: 100,000,000 đ | Thực chi: 40,000,000 đ
      // Lá 8822: 60,000,000 đ  | Thực chi: 55,000,000 đ
      // => HM-02 = 160,000,000 đ | Thực chi = 95,000,000 đ
      const hm02 = root.children.find(c => c.id === 8820);
      assert.ok(hm02, 'Phải tìm thấy HM-02');
      assert.strictEqual(hm02.budget_cost, 160000000);
      assert.strictEqual(hm02.actual_cost, 95000000);

      // Nút gốc (HM-ROOT): 130 tr + 160 tr = 290,000,000 đ
      // Thực chi gốc: 115 tr + 95 tr = 210,000,000 đ
      assert.strictEqual(root.budget_cost, 290000000);
      assert.strictEqual(root.actual_cost, 210000000);
    });

    test('NFR T-113: Không cộng các tài khoản giữa các cây cấp (Tổng dự án không bị cộng trùng lặp giữa cha và con)', async () => {
      const report = await service.getProjectBudgetVarianceReport(mockProjectId);
      const summary = report.summary;

      // Tổng chi phí dự án phải bằng đúng 290,000,000 đ (Tổng nút gốc level 0 hoặc tổng 4 nút lá)
      // Nếu cộng trùng lặp cả cha lẫn con thì tổng sẽ sai thành 870,000,000 đ (290 tr x 3 cấp)
      assert.strictEqual(summary.total_budget, 290000000);
      assert.strictEqual(summary.total_actual_cost, 210000000);

      // Tổng nút lá = 4, tổng mục = 7 (1 gốc + 2 cha cấp 1 + 4 lá)
      assert.strictEqual(summary.leaf_items_count, 4);
      assert.strictEqual(summary.total_items, 7);
    });
  });

  // =========================================================================
  // T-114: HIỂN THỊ BẢNG VÀ ĐÁNH DẤU CẢNH BÁO ĐIỀU KIỆN
  // =========================================================================
  describe('T-114: Hiển thị bảng và đánh dấu cảnh báo điều kiện', () => {
    test('AC 1: Đánh dấu cảnh báo khi chi phí > 80% VÀ khối lượng thu được < 80%', async () => {
      const report = await service.getProjectBudgetVarianceReport(mockProjectId);
      const flatList = report.flatList;

      // Hạng mục 8811: Chi phí 90% (> 80%) và Khối lượng 60% (< 80%)
      const item8811 = flatList.find(i => i.id === 8811);
      assert.strictEqual(item8811.cost_percentage, 90.00);
      assert.strictEqual(item8811.quantity_percentage, 60.00);
      assert.strictEqual(item8811.is_warning, true, 'Hạng mục 8811 phải bị đánh dấu cảnh báo');
      assert.strictEqual(item8811.warning_type, 'cost_overrun_progress_lag');
      assert.ok(item8811.warning_reason.includes('80%'));

      // Hạng mục 8822: Chi phí 91.67% (> 80%) và Khối lượng 50% (< 80%)
      const item8822 = flatList.find(i => i.id === 8822);
      assert.strictEqual(item8822.cost_percentage, 91.67);
      assert.strictEqual(item8822.quantity_percentage, 50.00);
      assert.strictEqual(item8822.is_warning, true, 'Hạng mục 8822 phải bị đánh dấu cảnh báo');
    });

    test('AC 2: KHÔNG cảnh báo khi chi phí > 80% NHƯNG khối lượng thu được >= 80%', async () => {
      const report = await service.getProjectBudgetVarianceReport(mockProjectId);
      const flatList = report.flatList;

      // Hạng mục 8812: Chi phí 87.5% (> 80%) nhưng Khối lượng 90% (>= 80%)
      const item8812 = flatList.find(i => i.id === 8812);
      assert.strictEqual(item8812.cost_percentage, 87.50);
      assert.strictEqual(item8812.quantity_percentage, 90.00);
      assert.strictEqual(item8812.is_warning, false, 'Hạng mục 8812 không được bị cảnh báo vì khối lượng đã đạt >= 80%');
    });

    test('AC 3: KHÔNG cảnh báo khi chi phí <= 80% và khối lượng thu được < 80%', async () => {
      const report = await service.getProjectBudgetVarianceReport(mockProjectId);
      const flatList = report.flatList;

      // Hạng mục 8821: Chi phí 40% (<= 80%) và Khối lượng 40% (< 80%)
      const item8821 = flatList.find(i => i.id === 8821);
      assert.strictEqual(item8821.cost_percentage, 40.00);
      assert.strictEqual(item8821.quantity_percentage, 40.00);
      assert.strictEqual(item8821.is_warning, false, 'Hạng mục 8821 không được bị cảnh báo vì chi phí chưa vượt 80%');
    });

    test('AC 4: Nút cha HM-01 tự động được đánh dấu cảnh báo khi tổng hợp vi phạm điều kiện 80%', async () => {
      const report = await service.getProjectBudgetVarianceReport(mockProjectId);
      const hm01 = report.flatList.find(i => i.id === 8810);

      // HM-01: Dự toán 130 tr, Thực chi 115 tr (88.46% > 80%)
      // Sản lượng: (60 x 500k) + (72 x 1,000k) = 30 tr + 72 tr = 102 tr
      // % Khối lượng thu được: (102 tr / 130 tr) = 78.46% (< 80%)
      assert.strictEqual(hm01.cost_percentage, 88.46);
      assert.strictEqual(hm01.quantity_percentage, 78.46);
      assert.strictEqual(hm01.is_warning, true, 'Nút cha HM-01 phải được đánh dấu cảnh báo');
    });

    test('Lỗi biên: Xử lý an toàn khi dự toán = 0 hoặc khối lượng = 0 không bị lỗi chia cho 0', async () => {
      const zeroItems = [
        {
          id: 9991,
          project_id: mockProjectId,
          parent_id: null,
          code: 'HM-ZERO',
          name: 'Hạng mục chưa có dự toán',
          unit: 'm3',
          khoi_luong_du_toan: 0,
          don_gia_du_toan: 0,
          thanh_tien_du_toan: 0,
          thuc_chi: 0,
          khoi_luong_thu_duoc: 0
        }
      ];

      const res = service.calculateTreeVariance(zeroItems);
      assert.strictEqual(res.tree[0].cost_percentage, 0);
      assert.strictEqual(res.tree[0].quantity_percentage, 0);
      assert.strictEqual(res.tree[0].is_warning, false);
      assert.strictEqual(res.summary.total_budget, 0);
      assert.strictEqual(res.summary.total_actual_cost, 0);
    });

    test('Validation: Từ chối số âm khi nhập dự toán hoặc thực chi', async () => {
      await assert.rejects(
        async () => {
          await service.updateLeafBudget(8811, { khoi_luong_du_toan: -10 });
        },
        (err) => {
          assert.strictEqual(err.status, 400);
          assert.match(err.message, /không âm/i);
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await service.updateLeafActualExpense(8811, { thuc_chi: -500000 });
        },
        (err) => {
          assert.strictEqual(err.status, 400);
          assert.match(err.message, /không âm/i);
          return true;
        }
      );
    });
  });

  // =========================================================================
  // S-48: BỘ DỮ LIỆU MẪU CHO TÍNH TOÁN PHẢN HỒI (AC 3)
  // =========================================================================
  describe('S-48: Bộ dữ liệu mẫu cho tính toán phản hồi', () => {
    test('Nạp bộ dữ liệu mẫu S-48 và phản hồi đầy đủ các ca kiểm thử', async () => {
      const seedResult = await service.seedS48SampleData(mockProjectId);
      assert.ok(seedResult.tree.length > 0, 'Cây phải có dữ liệu sau khi seed');
      assert.ok(seedResult.flatList.length >= 7, 'Phải có ít nhất 7 hạng mục');

      // Kiểm tra có cảnh báo và số lượng cảnh báo chính xác
      assert.strictEqual(seedResult.summary.has_warnings, true);
      assert.ok(seedResult.summary.warning_items_count >= 2);

      // Lấy lại qua API getProjectBudgetVarianceReport
      const rep = await service.getProjectBudgetVarianceReport(mockProjectId);
      assert.strictEqual(rep.summary.total_budget, 290000000);
      assert.strictEqual(rep.summary.total_actual_cost, 210000000);
    });
  });

  // =========================================================================
  // HTTP API & RBAC SUITE
  // =========================================================================
  describe('S-48 HTTP API & Phân quyền RBAC', () => {
    const express = require('express');
    const budgetVarianceRoutes = require('../src/routes/budgetVarianceRoutes');
    let app;
    let server;
    let baseUrl;
    let currentUser;

    beforeEach(async () => {
      app = express();
      app.use(express.json());

      // Mock user context middleware (Admin toàn quyền truy cập các dự án)
      currentUser = { id: 1, role_id: 1, role_name: 'admin' };
      app.use((req, res, next) => {
        req.user = currentUser;
        next();
      });

      app.use('/api', budgetVarianceRoutes(null));

      await new Promise(resolve => {
        server = app.listen(0, () => {
          const port = server.address().port;
          baseUrl = `http://localhost:${port}/api`;
          resolve();
        });
      });
    });

    test('GET /api/projects/:projectId/budget-variance trả về HTTP 200 và cấu trúc hợp lệ', async () => {
      const res = await fetch(`${baseUrl}/projects/${mockProjectId}/budget-variance`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(Array.isArray(json.tree));
      assert.ok(json.summary);
      assert.strictEqual(json.summary.total_budget, 290000000);
      server.close();
    });

    test('POST /api/projects/:projectId/budget-variance/seed-sample nạp mẫu thành công 200', async () => {
      const res = await fetch(`${baseUrl}/projects/${mockProjectId}/budget-variance/seed-sample`, {
        method: 'POST'
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(json.tree.length > 0);
      server.close();
    });

    test('PUT /api/work-items/:itemId/budget cập nhật dự toán thành công 200', async () => {
      const res = await fetch(`${baseUrl}/work-items/8811/budget`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ khoi_luong_du_toan: 150, don_gia_du_toan: 500000 })
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.khoi_luong_du_toan, 150);
      server.close();
    });

    test('PUT /api/work-items/:itemId/actual-expense cập nhật thực chi thành công 200', async () => {
      const res = await fetch(`${baseUrl}/work-items/8811/actual-expense`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thuc_chi: 60000000, khoi_luong_thu_duoc: 80 })
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.thuc_chi, 60000000);
      server.close();
    });

    test('RBAC: Người xem dự án (viewer, role 7) bị từ chối HTTP 403 khi sửa hoặc seed', async () => {
      currentUser = { id: 3, role_id: 7, role_name: 'viewer' };

      const putRes = await fetch(`${baseUrl}/work-items/8811/budget`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ khoi_luong_du_toan: 200 })
      });
      assert.strictEqual(putRes.status, 403);

      const postRes = await fetch(`${baseUrl}/projects/${mockProjectId}/budget-variance/seed-sample`, {
        method: 'POST'
      });
      assert.strictEqual(postRes.status, 403);

      server.close();
    });
  });
});

