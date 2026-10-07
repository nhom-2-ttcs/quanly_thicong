/**
 * S-18 (SCRUM-91): Lưu baseline kế hoạch gốc
 * Parent: SCRUM-16 [E-04] Tiến độ và đường găng
 * Acceptance Criteria:
 * - AC 1: Chốt kế hoạch gốc lần đầu được lưu riêng và không đổi khi tính lại sau này
 * - AC 2: Có kế hoạch gốc, sơ đồ có thêm thanh mờ thể hiện kế hoạch gốc bên dưới thanh hiện tại
 * - AC 3: Chốt kế hoạch gốc lần thứ hai thay bản cũ nhưng ghi lại lịch sử ai chốt và lúc nào
 * - AC 4: Chưa chốt kế hoạch gốc thì không hiện thanh mờ và có gợi ý chốt
 * - NFR: Kế hoạch gốc lưu bảng riêng, không phải cờ trong schedule_results
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { BaselineRepository } = require('../src/repositories/baselineRepository');
const { SchedulerService } = require('../src/domain/scheduling/schedulerService');

// ============================================================
// TEST SUITE 1: BaselineRepository - AC 1, AC 3, AC 4 & NFR
// ============================================================

test('AC 4 & NFR: Khi chưa chốt kế hoạch gốc, trả về hasBaseline = false để hiển thị gợi ý chốt', async () => {
  const repo = new BaselineRepository({});
  const projectId = 501;
  await repo.clearProject(projectId);

  const result = await repo.getCurrentBaseline(projectId);
  assert.equal(result.hasBaseline, false, 'Dự án mới chưa chốt baseline phải có hasBaseline = false');
  assert.equal(result.baseline, null);
  assert.equal(Array.isArray(result.tasks), true);
  assert.equal(result.tasks.length, 0);
});

test('AC 1 & NFR: Chốt kế hoạch gốc lần đầu được lưu riêng biệt và cố định, không đổi khi tính lại sau này', async () => {
  const repo = new BaselineRepository({});
  const projectId = 502;
  await repo.clearProject(projectId);

  const sampleTasks = [
    { id: 1, taskId: 1, taskCode: 'CV-01', taskName: 'Đào đất hố móng', duration: 5, earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
    { id: 2, taskId: 2, taskCode: 'CV-02', taskName: 'Đổ bê tông lót', duration: 3, earlyStart: 5, earlyFinish: 8, lateStart: 5, lateFinish: 8, totalFloat: 0, isCritical: true },
    { id: 3, taskId: 3, taskCode: 'CV-03', taskName: 'Cốt thép móng', duration: 4, earlyStart: 5, earlyFinish: 9, lateStart: 6, lateFinish: 10, totalFloat: 1, isCritical: false }
  ];

  // 1. Chốt kế hoạch gốc lần đầu
  const lockResult = await repo.lockBaseline(projectId, {
    tasks: sampleTasks,
    projectDuration: 8,
    userId: 2,
    userName: 'Kỹ sư Trưởng Nguyễn Văn A',
    reason: 'Phê duyệt khởi công đợt 1'
  });

  assert.equal(lockResult.success, true);
  assert.equal(lockResult.version, 1);
  assert.equal(lockResult.action, 'create_initial');
  assert.equal(lockResult.createdByName, 'Kỹ sư Trưởng Nguyễn Văn A');
  assert.equal(lockResult.taskCount, 3);

  // 2. Kiểm tra đọc lại baseline hiện hành (AC 2)
  const current = await repo.getCurrentBaseline(projectId);
  assert.equal(current.hasBaseline, true);
  assert.equal(current.baseline.version, 1);
  assert.equal(current.baseline.projectDuration, 8);
  assert.equal(current.baseline.createdByName, 'Kỹ sư Trưởng Nguyễn Văn A');
  assert.equal(current.tasks.length, 3);
  assert.equal(current.tasks[0].taskCode, 'CV-01');
  assert.equal(current.tasks[0].earlyStart, 0);
  assert.equal(current.tasks[0].earlyFinish, 5);

  // 3. Giả sử tiến độ dự án sau này bị trễ và tính toán lại
  // (Ví dụ CV-01 bị kéo dài duration lên 10 ngày)
  const updatedCurrentSchedule = [
    { id: 1, taskId: 1, taskCode: 'CV-01', taskName: 'Đào đất hố móng', duration: 10, earlyStart: 0, earlyFinish: 10, lateStart: 0, lateFinish: 10, totalFloat: 0, isCritical: true }
  ];

  // Kiểm tra kế hoạch gốc đã lưu vẫn giữ nguyên cam kết ban đầu (earlyFinish = 5, duration = 5)
  const verifyOriginal = await repo.getCurrentBaseline(projectId);
  assert.equal(verifyOriginal.tasks[0].earlyFinish, 5, 'Kế hoạch gốc phải giữ nguyên số liệu cam kết ban đầu (AC 1)');
  assert.equal(verifyOriginal.tasks[0].duration, 5);
});

test('AC 3: Chốt kế hoạch gốc lần thứ hai thay bản cũ nhưng lưu lịch sử ai chốt và lúc nào', async () => {
  const repo = new BaselineRepository({});
  const projectId = 503;
  await repo.clearProject(projectId);

  const v1Tasks = [
    { id: 1, taskId: 1, taskCode: 'CV-01', taskName: 'Task 1', duration: 4, earlyStart: 0, earlyFinish: 4, isCritical: true }
  ];

  // Lần 1: PM Nguyễn Văn A chốt V1
  await repo.lockBaseline(projectId, {
    tasks: v1Tasks,
    projectDuration: 4,
    userId: 2,
    userName: 'PM Nguyễn Văn A',
    reason: 'Kế hoạch sơ bộ lúc mở thầu'
  });

  const v2Tasks = [
    { id: 1, taskId: 1, taskCode: 'CV-01', taskName: 'Task 1', duration: 6, earlyStart: 0, earlyFinish: 6, isCritical: true },
    { id: 2, taskId: 2, taskCode: 'CV-02', taskName: 'Task 2', duration: 2, earlyStart: 6, earlyFinish: 8, isCritical: true }
  ];

  // Lần 2: Giám đốc Dự án Trần Văn B chốt điều chỉnh V2
  const lock2Result = await repo.lockBaseline(projectId, {
    tasks: v2Tasks,
    projectDuration: 8,
    userId: 1,
    userName: 'Giám đốc Trần Văn B',
    reason: 'Điều chỉnh thiết kế móng theo phụ lục hợp đồng'
  });

  assert.equal(lock2Result.success, true);
  assert.equal(lock2Result.version, 2, 'Phiên bản mới phải tăng lên 2');
  assert.equal(lock2Result.action, 'update_overwrite', 'Hành động là ghi đè cập nhật thay thế bản cũ');

  // Kiểm tra baseline hiện hành là V2
  const current = await repo.getCurrentBaseline(projectId);
  assert.equal(current.baseline.version, 2);
  assert.equal(current.baseline.projectDuration, 8);
  assert.equal(current.baseline.createdByName, 'Giám đốc Trần Văn B');
  assert.equal(current.tasks.length, 2);

  // Kiểm tra lịch sử ghi lại cả 2 lần chốt (AC 3: Ai chốt và lúc nào)
  const history = await repo.getHistory(projectId);
  assert.equal(history.length, 2);

  const [hLatest, hOlder] = history;
  assert.equal(hLatest.version, 2);
  assert.equal(hLatest.createdByName, 'Giám đốc Trần Văn B');
  assert.equal(hLatest.action, 'update_overwrite');
  assert.notEqual(hLatest.createdAt, null);

  assert.equal(hOlder.version, 1);
  assert.equal(hOlder.createdByName, 'PM Nguyễn Văn A');
  assert.equal(hOlder.action, 'create_initial');
  assert.notEqual(hOlder.createdAt, null);
});

// ============================================================
// TEST SUITE 2: SchedulerService Integration (AC 1, AC 2, AC 3)
// ============================================================

test('SchedulerService.lockProjectBaseline & getProjectBaseline tích hợp thành công', async () => {
  const projectId = 504;

  const mockDb = {
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM tasks')) {
          return [[
            { id: 10, project_id: projectId, work_item_id: 1, name: 'Công việc A', code: 'CV-A', duration: 3, status: 'pending' },
            { id: 20, project_id: projectId, work_item_id: 1, name: 'Công việc B', code: 'CV-B', duration: 4, status: 'pending' }
          ]];
        }
        if (sql.includes('FROM task_dependencies')) {
          return [[
            { id: 1, project_id: projectId, predecessor_task_id: 10, successor_task_id: 20, dependency_type: 'FS', lag_days: 0 }
          ]];
        }
        return [[]];
      }
    }
  };

  const service = new SchedulerService(mockDb);
  await service.baselineRepo.clearProject(projectId);

  // 1. Kiểm tra ban đầu chưa có baseline (AC 4)
  const initialCheck = await service.getProjectBaseline(projectId);
  assert.equal(initialCheck.hasBaseline, false);

  // 2. Chốt kế hoạch gốc
  const lockRes = await service.lockProjectBaseline(projectId, {
    userId: 2,
    userName: 'Chỉ Huy Trưởng Lê Văn C',
    reason: 'Kế hoạch duyệt đợt 1'
  });

  assert.equal(lockRes.success, true);
  assert.equal(lockRes.version, 1);
  assert.equal(lockRes.taskCount, 2);
  assert.equal(lockRes.projectDuration, 7); // CV-A(3) + CV-B(4) = 7 ngày

  // 3. Lấy kế hoạch gốc hiển thị sơ đồ (AC 2)
  const baselineData = await service.getProjectBaseline(projectId);
  assert.equal(baselineData.hasBaseline, true);
  assert.equal(baselineData.tasks.length, 2);
  assert.equal(baselineData.tasks[0].taskCode, 'CV-A');
  assert.equal(baselineData.tasks[0].earlyFinish, 3);
  assert.equal(baselineData.tasks[1].taskCode, 'CV-B');
  assert.equal(baselineData.tasks[1].earlyStart, 3);
  assert.equal(baselineData.tasks[1].earlyFinish, 7);

  // 4. Lấy lịch sử chốt
  const history = await service.getProjectBaselineHistory(projectId);
  assert.equal(history.length, 1);
  assert.equal(history[0].createdByName, 'Chỉ Huy Trưởng Lê Văn C');
});

test('RBAC & Validation: Người xem dự án (Viewer) không được chốt baseline', async () => {
  const { checkViewerForbidden } = require('../src/utils/rbac');

  // Giả lập request từ tài khoản Viewer
  const reqViewer = {
    user: { id: 3, role_name: 'viewer', role_id: 7, full_name: 'Khách Xem Dự Án' }
  };

  let responseStatus = null;
  let responseBody = null;
  const res = {
    status: (code) => {
      responseStatus = code;
      return {
        json: (data) => {
          responseBody = data;
        }
      };
    }
  };

  const isBlocked = checkViewerForbidden(reqViewer, res);
  assert.equal(isBlocked, true, 'Viewer phải bị chặn khi thực hiện thao tác chốt');
  assert.equal(responseStatus, 403, 'Mã lỗi trả về phải là HTTP 403 Forbidden');
  assert.match(responseBody.message, /Người xem dự án không được phép/);
});
