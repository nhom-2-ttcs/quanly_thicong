/**
 * S-12 (SCRUM-67): Bảng tiến độ và việc găng
 * Parent: SCRUM-16 [E-04]
 * Subtasks:
 * - SCRUM-83 [T-26] Lưu kết quả vào schedule_results
 * - SCRUM-84 [T-27] API trả về bảng kết quả tiến độ
 * - SCRUM-85 [T-28] Màn hình bảng tiến độ và lọc việc găng
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ScheduleResultRepository } = require('../src/repositories/scheduleResultRepository');
const { SchedulerService } = require('../src/domain/scheduling/schedulerService');

// ============================================================
// TEST SUITE 1: T-26 - Lưu kết quả vào schedule_results
// ============================================================
test('T-26: Lưu kết quả trong một transaction và không lưu dở dang khi có lỗi', async () => {
  const repo = new ScheduleResultRepository({});
  const projectId = 101;

  await repo.clearProject(projectId);

  const sampleTasks = [
    { id: 1, taskId: 1, name: 'Task 1', code: 'CV-1', duration: 4, earlyStart: 0, earlyFinish: 4, lateStart: 0, lateFinish: 4, totalFloat: 0, isCritical: true },
    { id: 2, taskId: 2, name: 'Task 2', code: 'CV-2', duration: 3, earlyStart: 4, earlyFinish: 7, lateStart: 4, lateFinish: 7, totalFloat: 0, isCritical: true },
    { id: 3, taskId: 3, name: 'Task 3', code: 'CV-3', duration: 2, earlyStart: 4, earlyFinish: 6, lateStart: 5, lateFinish: 7, totalFloat: 1, isCritical: false }
  ];

  // 1. Lưu thành công trong transaction
  await repo.saveResultsInTransaction(projectId, sampleTasks, 7);

  // 2. Đọc lại dữ liệu đã lưu
  const saved = await repo.getSavedResults(projectId);
  assert.equal(saved.totalTasks, 3);
  assert.equal(saved.projectDuration, 7);
  assert.equal(saved.criticalTasksCount, 2);
  assert.equal(saved.tasks.length, 3);

  // Sắp xếp ổn định theo earlyStart tăng dần
  assert.equal(saved.tasks[0].taskId, 1);
  assert.equal(saved.tasks[0].earlyStart, 0);
  assert.equal(saved.tasks[1].earlyStart, 4);
  assert.equal(saved.tasks[2].earlyStart, 4);

  // 3. Kiểm tra trạng thái isStale sau khi lưu phải là false
  const staleAfterSave = await repo.isStale(projectId);
  assert.equal(staleAfterSave, false, 'Vừa lưu xong thì cache phải còn hiệu lực (isStale = false)');
});

test('T-26: Đánh dấu stale khi task hoặc dependency thay đổi và cô lập theo project', async () => {
  const repo = new ScheduleResultRepository({});
  const projectA = 201;
  const projectB = 202;

  await repo.clearProject(projectA);
  await repo.clearProject(projectB);

  const tasksA = [
    { id: 10, taskId: 10, name: 'Task A1', duration: 5, earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true }
  ];
  const tasksB = [
    { id: 20, taskId: 20, name: 'Task B1', duration: 8, earlyStart: 0, earlyFinish: 8, lateStart: 0, lateFinish: 8, totalFloat: 0, isCritical: true }
  ];

  await repo.saveResultsInTransaction(projectA, tasksA, 5);
  await repo.saveResultsInTransaction(projectB, tasksB, 8);

  assert.equal(await repo.isStale(projectA), false);
  assert.equal(await repo.isStale(projectB), false);

  // Thay đổi task/dependency tại project A -> chỉ project A bị stale
  await repo.markStale(projectA);

  assert.equal(await repo.isStale(projectA), true, 'Project A phải chuyển sang trạng thái stale');
  assert.equal(await repo.isStale(projectB), false, 'Project B KHÔNG được bị ảnh hưởng khi Project A thay đổi (Cô lập project)');
});

test('T-26: Rollback an toàn khi phát hiện chu trình (Không lưu bảng kết quả dở dang)', async () => {
  // Mock pool có thể kiểm tra chu trình
  const mockDb = {
    pool: {
      query: async (sql, params) => {
        if (sql.includes('FROM tasks')) {
          return [[
            { id: 1, project_id: 301, name: 'T1', code: 'C1', duration: 2, status: 'pending' },
            { id: 2, project_id: 301, name: 'T2', code: 'C2', duration: 3, status: 'pending' }
          ]];
        }
        if (sql.includes('FROM task_dependencies')) {
          // Chu trình T1 -> T2 và T2 -> T1
          return [[
            { id: 1, project_id: 301, predecessor_task_id: 1, successor_task_id: 2, dependency_type: 'FS', lag_days: 0 },
            { id: 2, project_id: 301, predecessor_task_id: 2, successor_task_id: 1, dependency_type: 'FS', lag_days: 0 }
          ]];
        }
        return [[]];
      }
    }
  };

  const scheduler = new SchedulerService(mockDb);
  const result = await scheduler.getProjectScheduleResults(301, { forceRecalculate: true });

  assert.equal(result.success, false);
  assert.equal(result.hasCycle, true);
  assert.ok(result.message.includes('chu trình'));

  // Kiểm tra bảng schedule_results không lưu kết quả chu trình
  const repo = new ScheduleResultRepository({});
  const saved = await repo.getSavedResults(301);
  assert.equal(saved.tasks.length, 0, 'Không được lưu bảng kết quả dở dang khi có chu trình');
});

// ============================================================
// TEST SUITE 2: T-27 - API trả về bảng kết quả tiến độ và bộ lọc
// ============================================================
test('T-27: SchedulerService.getProjectScheduleResults trả kết quả lưu sẵn và hỗ trợ lọc critical', async () => {
  let queryCount = 0;
  const mockDb = {
    pool: {
      query: async (sql, params) => {
        queryCount += 1;
        if (sql.includes('FROM tasks')) {
          return [[
            { id: 1, project_id: 401, name: 'Task Găng', code: 'CV-1', duration: 5, status: 'pending' },
            { id: 2, project_id: 401, name: 'Task Thường', code: 'CV-2', duration: 2, status: 'pending' }
          ]];
        }
        if (sql.includes('FROM task_dependencies')) {
          return [[]];
        }
        return [[]];
      }
    }
  };

  const scheduler = new SchedulerService(mockDb);
  const projectId = 401;

  // Lần 1: Chưa có cache -> tính toán và lưu (isCached = false)
  const firstCall = await scheduler.getProjectScheduleResults(projectId, { forceRecalculate: true });
  assert.equal(firstCall.success, true);
  assert.equal(firstCall.isCached, false);
  assert.equal(firstCall.totalTasks, 2);
  assert.equal(firstCall.projectDuration, 5);

  // Lần 2: Đã có cache -> đọc từ kết quả lưu sẵn (isCached = true), KHÔNG tính toán lại
  const secondCall = await scheduler.getProjectScheduleResults(projectId);
  assert.equal(secondCall.success, true);
  assert.equal(secondCall.isCached, true, 'Lần 2 phải đọc kết quả lưu sẵn, không tính lại');
  assert.equal(secondCall.totalTasks, 2);

  // Lần 3: Lọc chỉ công việc găng (critical = true)
  const criticalCall = await scheduler.getProjectScheduleResults(projectId, { criticalOnly: true });
  assert.equal(criticalCall.success, true);
  assert.ok(criticalCall.tasks.every(t => t.isCritical === true), 'Tất cả task trả về phải là việc găng');

  // Kiểm tra không trả trường công thức nội bộ không cần thiết
  for (const t of criticalCall.tasks) {
    assert.equal(t.predecessors, undefined, 'Không trả predecessors nội bộ');
    assert.equal(t.normalizedId, undefined, 'Không trả normalizedId nội bộ');
    assert.ok(t.taskId !== undefined);
    assert.ok(t.earlyStart !== undefined);
    assert.ok(t.earlyFinish !== undefined);
    assert.ok(t.lateStart !== undefined);
    assert.ok(t.lateFinish !== undefined);
    assert.ok(t.totalFloat !== undefined);
    assert.ok(t.isCritical !== undefined);
  }
});

// ============================================================
// TEST SUITE 3: RBAC & Project Access cho S-12
// ============================================================
test('S-12 RBAC: Người xem dự án (Viewer) được xem lịch nhưng không được sửa', async () => {
  const { checkViewerForbidden, checkProjectReadAccess } = require('../src/utils/rbac');

  // Giả lập req/res của Viewer cho dự án 1 (được phân quyền)
  const reqViewerAllowed = {
    user: { id: 3, role_id: 7, role_name: 'viewer' },
    params: { projectId: 1 }
  };
  let statusCode = 200;
  const res = {
    status: (code) => { statusCode = code; return { json: (d) => d }; }
  };

  // Viewer đọc dự án được gán -> Cho phép truy cập (checkProjectReadAccess trả về undefined / false)
  const readForbidden = checkProjectReadAccess(reqViewerAllowed, res, 1);
  assert.equal(readForbidden, false, 'Viewer được phép đọc dự án được gán quyền');

  // Viewer đọc dự án không được gán (ví dụ: dự án 999) -> Bị chặn 403 Forbidden
  const reqViewerDenied = {
    user: { id: 3, role_id: 7, role_name: 'viewer' },
    params: { projectId: 999 }
  };
  let deniedStatus = 200;
  const resDenied = {
    status: (code) => { deniedStatus = code; return { json: (d) => d }; }
  };
  const readDenied = checkProjectReadAccess(reqViewerDenied, resDenied, 999);
  assert.equal(readDenied, true, 'Viewer bị chặn khi truy cập dự án không thuộc quyền');
  assert.equal(deniedStatus, 403, 'Trả về mã lỗi HTTP 403 Forbidden');

  // Viewer cố gắng ghi (modify) -> checkViewerForbidden trả true và trả về 403
  let writeStatus = 200;
  const resWrite = {
    status: (code) => { writeStatus = code; return { json: (d) => d }; }
  };
  const writeForbidden = checkViewerForbidden(reqViewerAllowed, resWrite);
  assert.equal(writeForbidden, true, 'Viewer bị chặn khi cố gắng chỉnh sửa');
  assert.equal(writeStatus, 403);
});
