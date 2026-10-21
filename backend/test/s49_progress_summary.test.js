/**
 * S-49 (SCRUM-225): Trang tổng hợp tiến trình
 * - T-115 (SCRUM-234): Tổng hợp các tiến trình
 * - T-116 (SCRUM-235): Hiển thị tổng hợp trang cho Chủ đầu tư
 * 
 * Kiểm thử toàn diện 4 chỉ số cốt lõi và các tiêu chí chấp nhận (AC):
 * 1. % Hoàn thành theo giá trị hợp lý & theo khối lượng
 * 2. Sai lệch hoàn thành theo kế hoạch gốc (Schedule variance)
 * 3. Các mốc tiến độ đang bị vượt qua (Milestones breached)
 * 4. Luồng công việc chậm lại (Delayed workflows)
 * 
 * NFR: Không làm thay đổi kết quả tiến trình của nguồn câu chuyện (Read-only)
 * NFR: Phân quyền - Chỉ hiển thị dự án người dùng được phép xem (RBAC)
 */

const test = require('node:test');
const assert = require('node:assert');
const ProgressSummaryService = require('../src/services/progressSummaryService');
const { createSession } = require('../src/models/store');
const store = require('../src/models/store');

// Mock pool độc lập phục vụ kiểm thử đơn vị & tích hợp
function createMockDb() {
  const projects = [
    { id: 1, name: 'Dự án Thi Công Mẫu 1', code: 'DA-01', start_date: '2026-10-01', status: 'active' },
    { id: 2, name: 'Dự án Cầu Vượt 2', code: 'DA-02', start_date: '2026-10-01', status: 'active' }
  ];

  const workItems = [
    { id: 10, project_id: 1, parent_id: null, name: 'Hạng mục Móng', code: 'HM-01', khoi_luong_du_toan: 100, don_gia_du_toan: 1000000, thanh_tien_du_toan: 100000000, thuc_chi: 85000000, khoi_luong_thu_duoc: 70 },
    { id: 11, project_id: 1, parent_id: 10, name: 'Đào hố móng', code: 'HM-01.01', khoi_luong_du_toan: 100, don_gia_du_toan: 1000000, thanh_tien_du_toan: 100000000, thuc_chi: 85000000, khoi_luong_thu_duoc: 70 }
  ];

  const tasks = [
    { id: 101, project_id: 1, work_item_id: 11, name: 'Đào móng trụ T1', code: 'CV-01', duration: 5, percent_complete: 100, status: 'completed' },
    { id: 102, project_id: 1, work_item_id: 11, name: 'Đổ bê tông lót', code: 'CV-02', duration: 4, percent_complete: 50, status: 'in_progress' },
    { id: 103, project_id: 1, work_item_id: 11, name: 'Lắp dựng cốt thép', code: 'CV-03', duration: 6, percent_complete: 0, status: 'pending' }
  ];

  const dependencies = [
    { predecessor_task_id: 101, successor_task_id: 102, dependency_type: 'FS', lag_days: 0 },
    { predecessor_task_id: 102, successor_task_id: 103, dependency_type: 'FS', lag_days: 0 }
  ];

  const milestones = [
    { id: 1, project_id: 1, work_item_id: 11, due_date: '2026-10-10', title: 'Hoàn thành móng', is_active: 1 }
  ];

  const milestoneAlerts = [
    { id: 1, project_id: 1, milestone_id: 1, work_item_id: 11, due_date: '2026-10-10', max_early_finish: 15, overdue_days: 3, status: 'active', opened_at: '2026-10-05T08:00:00Z' }
  ];

  const baselines = [];
  const baselineTasks = [];

  const queryFn = async (sql, params = []) => {
    const norm = sql.replace(/\s+/g, ' ').trim().toUpperCase();

    if (norm.includes('FROM PROJECTS WHERE ID = ?')) {
      const p = projects.filter(item => item.id === Number(params[0]));
      return [p];
    }

    if (norm.includes('SELECT START_DATE FROM PROJECTS WHERE ID = ?')) {
      const p = projects.find(item => item.id === Number(params[0]));
      return [[{ start_date: p?.start_date || null }]];
    }

    if (norm.includes('FROM BASELINE_SCHEDULES WHERE PROJECT_ID = ? AND IS_CURRENT = TRUE')) {
      const b = baselines.filter(item => item.project_id === Number(params[0]) && item.is_current);
      return [b];
    }

    if (norm.includes('FROM BASELINE_TASKS WHERE BASELINE_SCHEDULE_ID = ?')) {
      const bt = baselineTasks.filter(item => item.baseline_schedule_id === Number(params[0]));
      return [bt];
    }

    if (norm.includes('FROM TASKS WHERE PROJECT_ID = ?')) {
      const t = tasks.filter(item => item.project_id === Number(params[0]));
      return [t];
    }

    if (norm.includes('FROM TASK_DEPENDENCIES WHERE PROJECT_ID = ?')) {
      return [dependencies];
    }

    if (norm.includes('FROM WORK_ITEMS WHERE PROJECT_ID = ?')) {
      const w = workItems.filter(item => item.project_id === Number(params[0]));
      return [w];
    }

    if (norm.includes('FROM MILESTONES M JOIN WORK_ITEMS W ON M.WORK_ITEM_ID = W.ID WHERE W.PROJECT_ID = ? AND M.IS_ACTIVE = 1') ||
        norm.includes('FROM MILESTONES M LEFT JOIN WORK_ITEMS W ON M.WORK_ITEM_ID = W.ID WHERE W.PROJECT_ID = ?')) {
      return [milestones];
    }

    if (norm.includes('FROM MILESTONE_ALERTS WHERE PROJECT_ID = ?')) {
      return [milestoneAlerts];
    }

    if (norm.includes('SELECT * FROM SCHEDULE_RESULTS WHERE PROJECT_ID = ?')) {
      return [[]];
    }

    if (norm.includes('SELECT WORK_ITEM_ID, SUM(AMOUNT) AS TOTAL_EXPENSE FROM ACTUAL_EXPENSES')) {
      return [[]];
    }

    return [[]];
  };

  const mockDb = {
    isConnected: true,
    pool: {
      query: queryFn,
      async getConnection() {
        return {
          query: queryFn,
          beginTransaction: async () => {},
          commit: async () => {},
          rollback: async () => {},
          release: () => {}
        };
      }
    },
    // Trợ giúp tạo baseline cho test
    seedBaseline(projectId, duration = 12) {
      baselines.push({
        id: 1,
        project_id: projectId,
        version: 'v1.0',
        is_current: 1,
        project_duration: duration,
        created_by: 2,
        created_by_name: 'Trần Mạnh Dũng',
        reason: 'Chốt đợt 1',
        created_at: '2026-10-02T10:00:00Z'
      });
      baselineTasks.push(
        { id: 1, baseline_schedule_id: 1, project_id: projectId, task_id: 101, duration: 5, early_start: 0, early_finish: 5 },
        { id: 2, baseline_schedule_id: 1, project_id: projectId, task_id: 102, duration: 4, early_start: 5, early_finish: 9 },
        // Baseline ban đầu cho task 103 là duration 3 (early_finish = 12), hiện tại duration là 6 (early_finish = 15) -> Trễ 3 ngày
        { id: 3, baseline_schedule_id: 1, project_id: projectId, task_id: 103, duration: 3, early_start: 9, early_finish: 12 }
      );
    }
  };

  return mockDb;
}

test('S-49 / T-115: Tổng hợp 4 chỉ số tiến trình cốt lõi cho Chủ đầu tư', async (t) => {

  await t.test('AC 1: Tính toán chính xác phần trăm hoàn thành theo Giá trị và Khối lượng', async () => {
    const mockDb = createMockDb();
    const service = new ProgressSummaryService(mockDb);

    const res = await service.getProjectProgressSummary(1);

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.projectId, 1);
    assert.ok(res.metrics.completion, 'Phải có nhóm chỉ số completion');

    const comp = res.metrics.completion;
    // Khối lượng: Task 101 (5d, 100%), Task 102 (4d, 50%), Task 103 (6d, 0%)
    // Tổng trọng số = 5 + 4 + 6 = 15
    // Đã hoàn thành = 5*1.0 + 4*0.5 + 6*0 = 7.0
    // Tỷ lệ = 7.0 / 15 * 100 = 46.67%
    assert.strictEqual(comp.volumePercentage, 46.67);

    // Giá trị (EVM): 70% hoàn thành khối lượng thu được trên dự toán
    assert.strictEqual(comp.valuePercentage, 70);
    assert.strictEqual(comp.totalBudget, 100000000);
    assert.strictEqual(comp.totalActualCost, 85000000);

    // Công thức minh bạch
    assert.ok(comp.formulas.value.includes('Giá trị'), 'Phải có công thức tính theo Giá trị');
    assert.ok(comp.formulas.volume.includes('Khối lượng'), 'Phải có công thức tính theo Khối lượng');

    // Thống kê công việc
    assert.strictEqual(comp.taskStats.total, 3);
    assert.strictEqual(comp.taskStats.completed, 1);
    assert.strictEqual(comp.taskStats.inProgress, 1);
    assert.strictEqual(comp.taskStats.pending, 1);
  });

  await t.test('AC 2: Hoàn thành sai lệch theo kế hoạch gốc khi chưa chốt baseline', async () => {
    const mockDb = createMockDb();
    const service = new ProgressSummaryService(mockDb);

    const res = await service.getProjectProgressSummary(1);
    const variance = res.metrics.scheduleVariance;

    assert.strictEqual(variance.hasBaseline, false);
    assert.strictEqual(variance.status, 'no_baseline');
    assert.strictEqual(variance.statusText, 'Chưa chốt kế hoạch gốc (Baseline)');
    assert.strictEqual(variance.currentDuration, 15);
  });

  await t.test('AC 2: Hoàn thành sai lệch theo kế hoạch gốc khi ĐÃ chốt baseline (Chậm tiến độ)', async () => {
    const mockDb = createMockDb();
    // Baseline chốt ban đầu là 12 ngày, hiện tại CPM là 15 ngày -> Trễ 3 ngày
    mockDb.seedBaseline(1, 12);
    const service = new ProgressSummaryService(mockDb);

    const res = await service.getProjectProgressSummary(1);
    const variance = res.metrics.scheduleVariance;

    assert.strictEqual(variance.hasBaseline, true);
    assert.strictEqual(variance.baselineDuration, 12);
    assert.strictEqual(variance.currentDuration, 15);
    assert.strictEqual(variance.varianceDays, 3);
    assert.strictEqual(variance.status, 'delayed');
    assert.strictEqual(variance.statusText, 'Chậm 3 ngày so với kế hoạch gốc');
    assert.strictEqual(variance.baselineVersion, 'v1.0');
  });

  await t.test('AC 3: Liệt kê các bảng / mốc tiến độ đang bị vượt qua (Milestones breached)', async () => {
    const mockDb = createMockDb();
    const service = new ProgressSummaryService(mockDb);

    const res = await service.getProjectProgressSummary(1);
    const milestones = res.metrics.milestonesBreached;

    assert.ok(milestones, 'Phải có nhóm mốc tiến độ');
    assert.strictEqual(milestones.breachedCount, 1);
    assert.strictEqual(milestones.items.length, 1);
    assert.strictEqual(milestones.items[0].milestoneTitle, 'Hoàn thành móng');
    assert.strictEqual(milestones.items[0].overdueDays, 3);
    assert.strictEqual(milestones.items[0].status, 'active');
  });

  await t.test('AC 4: Luồng công việc chậm lại (Delayed workflows & tasks)', async () => {
    const mockDb = createMockDb();
    mockDb.seedBaseline(1, 12);
    const service = new ProgressSummaryService(mockDb);

    const res = await service.getProjectProgressSummary(1);
    const delayed = res.metrics.delayedWorkflows;

    assert.ok(delayed, 'Phải có nhóm luồng công việc chậm lại');
    assert.ok(delayed.delayedTasksCount >= 1, 'Phải phát hiện các công việc bị chậm');
    assert.ok(Array.isArray(delayed.items), 'Danh sách việc chậm phải là mảng');
  });

  await t.test('NFR (T-115): Không làm thay đổi kết quả tiến trình của nguồn câu chuyện (Read-only)', async () => {
    const mockDb = createMockDb();
    const service = new ProgressSummaryService(mockDb);

    // Chạy tổng hợp nhiều lần liên tiếp
    const res1 = await service.getProjectProgressSummary(1);
    const res2 = await service.getProjectProgressSummary(1);

    assert.strictEqual(res1.readOnly, true);
    assert.strictEqual(res2.readOnly, true);
    assert.deepStrictEqual(res1.metrics.completion, res2.metrics.completion);
    assert.deepStrictEqual(res1.metrics.scheduleVariance, res2.metrics.scheduleVariance);
  });

  await t.test('Validation: Từ chối projectId không hợp lệ với HTTP 400', async () => {
    const mockDb = createMockDb();
    const service = new ProgressSummaryService(mockDb);

    await assert.rejects(
      async () => service.getProjectProgressSummary(-1),
      (err) => err.status === 400 && err.message.includes('projectId')
    );
    await assert.rejects(
      async () => service.getProjectProgressSummary(0),
      (err) => err.status === 400 && err.message.includes('projectId')
    );
    await assert.rejects(
      async () => service.getProjectProgressSummary('abc'),
      (err) => err.status === 400 && err.message.includes('projectId')
    );
  });
});

test('S-49 / T-116: Phân quyền truy cập và API Endpoint', async (t) => {
  const express = require('express');
  const progressSummaryRoutes = require('../src/routes/progressSummaryRoutes');

  const mockDb = createMockDb();
  const app = express();
  app.use(express.json());
  const { authenticate } = require('../src/utils/rbac');
  app.use(authenticate);
  app.use('/api', progressSummaryRoutes(mockDb));

  // Khởi động server test nội bộ
  let server;
  let baseUrl;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}/api`;
      resolve();
    });
  });

  t.after(() => {
    if (server) server.close();
  });

  await t.test('GET /api/projects/:projectId/progress-summary trả về 200 và 4 chỉ số', async () => {
    store.addProjectMember({ projectId: 1, userId: 6, roleId: 6 });

    const token = createSession({
      id: 6,
      email: 'client@thicong.vn',
      full_name: 'Đại Diện Chủ Đầu Tư',
      role_id: 6,
      role_name: 'client'
    });

    const res = await fetch(`${baseUrl}/projects/1/progress-summary`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.projectId, 1);
    assert.ok(body.metrics.completion);
    assert.ok(body.metrics.scheduleVariance);
    assert.ok(body.metrics.milestonesBreached);
    assert.ok(body.metrics.delayedWorkflows);
  });

  await t.test('NFR (T-116): Quyền truy cập - Trả về 403 khi người dùng không được phân quyền xem dự án', async () => {
    // Tạo user không có quyền vào dự án 9999
    const token = createSession({
      id: 99,
      email: 'outsider@thicong.vn',
      full_name: 'Người Ngoài Dự Án',
      role_id: 7,
      role_name: 'viewer'
    });

    const res = await fetch(`${baseUrl}/projects/9999/progress-summary`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.ok(body.message.includes('quyền xem dự án') || body.message.includes('từ chối'));
  });

  await t.test('GET với projectId không hợp lệ -> 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/projects/invalid-id/progress-summary`);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
  });

  await t.test('T-116: Trang HTML progress-summary.html hiển thị đủ 4 chỉ số và công thức', async () => {
    const fs = require('fs');
    const path = require('path');
    const htmlPath = path.join(__dirname, '../../frontend/progress-summary.html');
    assert.ok(fs.existsSync(htmlPath), 'File progress-summary.html phải tồn tại');

    const content = fs.readFileSync(htmlPath, 'utf8');

    // 1. Phải có 4 nhóm chỉ số
    assert.ok(content.includes('kpiPrimaryPct'), 'Phải có % hoàn thành');
    assert.ok(content.includes('kpiVarianceDays'), 'Phải có sai lệch kế hoạch gốc');
    assert.ok(content.includes('kpiBreachedCount'), 'Phải có mốc tiến độ bị vượt');
    assert.ok(content.includes('kpiDelayedCount'), 'Phải có luồng việc chậm lại');

    // 2. Phải có bảng chi tiết cho mốc bị vượt và chuỗi việc chậm
    assert.ok(content.includes('tblMilestonesBody'), 'Phải có bảng mốc tiến độ bị vượt');
    assert.ok(content.includes('tblDelayedTasksBody'), 'Phải có bảng công việc chậm trễ');

    // 3. Phải có công thức tính minh bạch (giải quyết mục Cần sàng lọc)
    assert.ok(content.includes('formulaModal'), 'Phải có modal công thức tính toán');
    assert.ok(content.includes('Earned Value'), 'Phải có giải thích công thức Giá trị EVM');
    assert.ok(content.includes('Khối lượng'), 'Phải có giải thích công thức Khối lượng');

    // 4. Phải có thanh so sánh timeline Kế hoạch gốc vs Dự kiến
    assert.ok(content.includes('timeline-segment baseline'), 'Phải có thanh kế hoạch gốc');
    assert.ok(content.includes('timeline-segment current'), 'Phải có thanh dự kiến hiện tại');
  });
});
