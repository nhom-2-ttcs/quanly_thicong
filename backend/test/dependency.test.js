const test = require('node:test');
const assert = require('node:assert');
const { DependencyRepository } = require('../src/repositories/dependencyRepository');
const { DependencyService } = require('../src/services/dependencyService');
const { findUserByEmail, createSession } = require('../src/models/store');

// Mock pool độc lập phục vụ kiểm thử đơn vị
function createMockPool() {
  const projects = [
    { id: 1, name: 'Dự án A', code: 'DA-01' },
    { id: 2, name: 'Dự án B', code: 'DA-02' }
  ];

  const tasks = [
    { id: 1, project_id: 1, name: 'Đào móng', code: 'CV-01', duration: 3, status: 'pending' },
    { id: 2, project_id: 1, name: 'Lót móng', code: 'CV-02', duration: 2, status: 'pending' },
    { id: 3, project_id: 1, name: 'Đổ bê tông', code: 'CV-03', duration: 4, status: 'pending' },
    { id: 4, project_id: 2, name: 'Nhiệm vụ DA 2', code: 'CV-04', duration: 1, status: 'pending' }
  ];

  const dependencies = [];
  let nextDepId = 1;

  return {
    projects,
    tasks,
    dependencies,
    async query(sql, params = []) {
      const upper = sql.trim().toUpperCase();

      if (upper.includes("SHOW TABLES LIKE 'TASK_DEPENDENCIES'")) {
        return [[{ 'Tables_in_test (task_dependencies)': 'task_dependencies' }]];
      }

      if (upper.startsWith('SELECT ID, NAME, CODE FROM PROJECTS WHERE ID = ?')) {
        const found = projects.filter(p => p.id === Number(params[0]));
        return [found];
      }

      if (upper.startsWith('SELECT ID, PROJECT_ID, WORK_ITEM_ID, NAME, CODE, DURATION, STATUS FROM TASKS WHERE ID = ?') ||
          upper.startsWith('SELECT ID, PROJECT_ID FROM TASKS WHERE ID = ?') ||
          upper.startsWith('SELECT * FROM TASKS WHERE ID = ?') ||
          upper.startsWith('SELECT ID FROM TASKS WHERE ID = ?')) {
        const found = tasks.filter(t => t.id === Number(params[0]));
        return [found];
      }

      if (upper.startsWith('SELECT ID, NAME, CODE, DURATION, STATUS FROM TASKS WHERE PROJECT_ID = ?') ||
          upper.startsWith('SELECT ID, PROJECT_ID, WORK_ITEM_ID, NAME, CODE, DURATION, STATUS FROM TASKS WHERE PROJECT_ID = ?')) {
        const found = tasks.filter(t => t.project_id === Number(params[0]));
        return [found];
      }

      if (upper.includes("FROM TASK_DEPENDENCIES WHERE PROJECT_ID = ?")) {
        const pId = Number(params[0]);
        const list = dependencies.filter(d => d.project_id === pId);
        return [list];
      }

      if (upper.includes("FROM TASK_DEPENDENCIES D") && upper.includes("WHERE D.PROJECT_ID = ?")) {
        const pId = Number(params[0]);
        const list = dependencies.filter(d => d.project_id === pId).map(d => {
          const tp = tasks.find(t => t.id === d.predecessor_task_id) || {};
          const ts = tasks.find(t => t.id === d.successor_task_id) || {};
          return {
            ...d,
            predecessor_task_name: tp.name || '',
            predecessor_task_code: tp.code || '',
            successor_task_name: ts.name || '',
            successor_task_code: ts.code || ''
          };
        });
        return [list];
      }

      if (upper.includes("FROM TASK_DEPENDENCIES D") && upper.includes("WHERE D.ID = ?")) {
        const dId = Number(params[0]);
        const d = dependencies.find(item => item.id === dId);
        if (!d) return [[]];
        const tp = tasks.find(t => t.id === d.predecessor_task_id) || {};
        const ts = tasks.find(t => t.id === d.successor_task_id) || {};
        return [[{
          ...d,
          predecessor_task_name: tp.name || '',
          predecessor_task_code: tp.code || '',
          successor_task_name: ts.name || '',
          successor_task_code: ts.code || ''
        }]];
      }

      const normalized = upper.replace(/\s+/g, ' ');

      if (normalized.includes('FROM TASK_DEPENDENCIES WHERE PREDECESSOR_TASK_ID = ? AND SUCCESSOR_TASK_ID = ?')) {
        const pred = Number(params[0]);
        const succ = Number(params[1]);
        const found = dependencies.filter(d => d.predecessor_task_id === pred && d.successor_task_id === succ);
        return [found];
      }

      if (upper.includes('SELECT ID FROM TASK_DEPENDENCIES WHERE PREDECESSOR_TASK_ID = ? OR SUCCESSOR_TASK_ID = ?') ||
          upper.includes('SELECT COUNT(*) AS TOTAL FROM TASK_DEPENDENCIES WHERE PREDECESSOR_TASK_ID = ? OR SUCCESSOR_TASK_ID = ?')) {
        const tId = Number(params[0]);
        const count = dependencies.filter(d => d.predecessor_task_id === tId || d.successor_task_id === tId).length;
        return [[{ total: count, id: count > 0 ? 1 : null }]];
      }

      if (upper.startsWith('INSERT INTO TASK_DEPENDENCIES')) {
        const [projectId, predId, succId, type, lag] = params;
        const newDep = {
          id: nextDepId++,
          project_id: Number(projectId),
          predecessor_task_id: Number(predId),
          successor_task_id: Number(succId),
          dependency_type: type,
          lag_days: Number(lag),
          created_at: new Date(),
          updated_at: new Date()
        };
        dependencies.push(newDep);
        return [{ insertId: newDep.id }];
      }

      if (upper.startsWith('UPDATE TASK_DEPENDENCIES')) {
        const [type, lag, id] = params;
        const dep = dependencies.find(d => d.id === Number(id));
        if (dep) {
          if (type !== undefined && type !== null) dep.dependency_type = type;
          if (lag !== undefined && lag !== null) dep.lag_days = Number(lag);
          dep.updated_at = new Date();
        }
        return [{ affectedRows: dep ? 1 : 0 }];
      }

      if (upper.startsWith('DELETE FROM TASK_DEPENDENCIES WHERE ID = ?')) {
        const idx = dependencies.findIndex(d => d.id === Number(params[0]));
        if (idx !== -1) {
          dependencies.splice(idx, 1);
          return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 0 }];
      }

      if (upper.includes("SHOW TABLES LIKE 'TASK_DEPENDENCIES'")) {
        return [[{ Tables_in_db: 'task_dependencies' }]];
      }

      if (upper.includes('FROM TASK_DEPENDENCIES WHERE PROJECT_ID = ?')) {
        const pId = Number(params[0]);
        const list = dependencies.filter(d => d.project_id === pId);
        return [list];
      }

      return [[]];
    }
  };
}

// Helper mô phỏng response Express
function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}

// ==========================================
// 1. T-13: CRUD QUAN HỆ PHỤ THUỘC (DEPENDENCIES)
// ==========================================

test('S-06 T-13: Khai báo quan hệ phụ thuộc hợp lệ (FS, SS, FF, SF) và lưu trữ thành công', async () => {
  const mockDb = createMockPool();
  const repo = new DependencyRepository(mockDb);
  const service = new DependencyService(repo, mockDb);

  // Tạo quan hệ CV-01 -> CV-02 (FS, lag 0)
  const res1 = await service.createDependency(1, {
    predecessorId: 1,
    successorId: 2,
    type: 'FS',
    lag: 0
  });

  assert.strictEqual(res1.status, 201);
  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.data.predecessor_task_id, 1);
  assert.strictEqual(res1.data.successor_task_id, 2);
  assert.strictEqual(res1.data.dependency_type, 'FS');
  assert.strictEqual(Number(res1.data.lag_days), 0);

  // Lấy danh sách theo dự án
  const listRes = await service.getDependenciesByProject(1);
  assert.strictEqual(listRes.status, 200);
  assert.strictEqual(listRes.data.length, 1);
  assert.strictEqual(listRes.data[0].predecessor_task_name, 'Đào móng');
  assert.strictEqual(listRes.data[0].successor_task_name, 'Lót móng');

  // Lấy chi tiết theo ID
  const detailRes = await service.getDependencyById(res1.data.id);
  assert.strictEqual(detailRes.status, 200);
  assert.strictEqual(detailRes.data.id, res1.data.id);

  // Cập nhật quan hệ (đổi sang SS và lag 2 ngày)
  const updateRes = await service.updateDependency(res1.data.id, {
    type: 'SS',
    lag: 2
  });
  assert.strictEqual(updateRes.status, 200);
  assert.strictEqual(updateRes.data.dependency_type, 'SS');
  assert.strictEqual(Number(updateRes.data.lag_days), 2);

  // Xóa quan hệ
  const deleteRes = await service.deleteDependency(res1.data.id);
  assert.strictEqual(deleteRes.status, 200);
  assert.strictEqual(deleteRes.success, true);

  const afterDelete = await service.getDependenciesByProject(1);
  assert.strictEqual(afterDelete.data.length, 0);
});

test('S-06 T-13: Validation từ chối tự phụ thuộc chính nó (Self-loop) (HTTP 400)', async () => {
  const mockDb = createMockPool();
  const repo = new DependencyRepository(mockDb);
  const service = new DependencyService(repo, mockDb);

  const res = await service.createDependency(1, {
    predecessorId: 1,
    successorId: 1,
    type: 'FS',
    lag: 0
  });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.success, false);
  assert.ok(res.message.includes('Self-loop') || res.message.includes('tự phụ thuộc'));
});

test('S-06 T-13: Validation từ chối tạo trùng quan hệ giữa 2 công việc (HTTP 409 Conflict)', async () => {
  const mockDb = createMockPool();
  const repo = new DependencyRepository(mockDb);
  const service = new DependencyService(repo, mockDb);

  await service.createDependency(1, { predecessorId: 1, successorId: 2, type: 'FS', lag: 0 });

  // Thử tạo lại cặp (1 -> 2)
  const dupRes = await service.createDependency(1, { predecessorId: 1, successorId: 2, type: 'SS', lag: 1 });
  assert.strictEqual(dupRes.status, 409);
  assert.strictEqual(dupRes.success, false);
  assert.ok(dupRes.message.includes('đã tồn tại'));
});

test('S-06 T-13: Validation từ chối khi task không tồn tại hoặc khác dự án', async () => {
  const mockDb = createMockPool();
  const repo = new DependencyRepository(mockDb);
  const service = new DependencyService(repo, mockDb);

  // Task không tồn tại (999) -> 404
  const resNotFound = await service.createDependency(1, { predecessorId: 1, successorId: 999, type: 'FS', lag: 0 });
  assert.strictEqual(resNotFound.status, 404);

  // Task 4 thuộc Dự án 2, nhưng tạo trong Dự án 1 -> 400
  const resCrossProject = await service.createDependency(1, { predecessorId: 1, successorId: 4, type: 'FS', lag: 0 });
  assert.strictEqual(resCrossProject.status, 400);
  assert.ok(resCrossProject.message.includes('cùng dự án'));
});

// ==========================================
// 2. T-14: BỐN LOẠI QUAN HỆ VÀ ĐỘ TRỄ (LAG)
// ==========================================

test('S-06 T-14: Hỗ trợ đầy đủ 4 loại quan hệ FS, SS, FF, SF và từ chối loại không hợp lệ', async () => {
  const mockDb = createMockPool();
  const repo = new DependencyRepository(mockDb);
  const service = new DependencyService(repo, mockDb);

  for (const type of ['FS', 'SS', 'FF', 'SF', 'fs', 'ss', 'ff', 'sf']) {
    const res = await service.createDependency(1, {
      predecessorId: 1,
      successorId: 2,
      type,
      lag: 0
    });
    assert.strictEqual(res.status, 201, `Loại quan hệ ${type} phải được chấp thuận`);
    assert.strictEqual(res.data.dependency_type, type.toUpperCase());
    // Xóa để test loại tiếp theo không bị trùng
    await service.deleteDependency(res.data.id);
  }

  // Loại không hợp lệ (ví dụ: 'XX') -> 400
  const resInvalid = await service.createDependency(1, {
    predecessorId: 1,
    successorId: 2,
    type: 'INVALID_TYPE',
    lag: 0
  });
  assert.strictEqual(resInvalid.status, 400);
  assert.ok(resInvalid.message.includes('không hợp lệ'));
});

test('S-06 T-14: Hỗ trợ độ trễ lag hữu hạn: lag 0, lag dương, lag âm (lead gối đầu), lag thập phân', async () => {
  const mockDb = createMockPool();
  const repo = new DependencyRepository(mockDb);
  const service = new DependencyService(repo, mockDb);

  const validLags = [0, 3, -1.5, 0.5, -2];
  for (const lag of validLags) {
    const res = await service.createDependency(1, {
      predecessorId: 1,
      successorId: 2,
      type: 'FS',
      lag
    });
    assert.strictEqual(res.status, 201, `Lag ${lag} phải được chấp thuận`);
    assert.strictEqual(Number(res.data.lag_days), lag);
    await service.deleteDependency(res.data.id);
  }

  // Lag không hợp lệ: NaN, Infinity, chuỗi rác -> 400
  const invalidLags = ['abc', NaN, Infinity, -Infinity];
  for (const badLag of invalidLags) {
    const resBad = await service.createDependency(1, {
      predecessorId: 1,
      successorId: 2,
      type: 'FS',
      lag: badLag
    });
    assert.strictEqual(resBad.status, 400, `Lag ${badLag} phải bị từ chối`);
  }
});

// ==========================================
// 3. TÍCH HỢP S-06 VÀ S-07: PHÁT HIỆN VÒNG LẶP (CYCLE DETECTION)
// ==========================================

test('S-06 + S-07: Chặn đứng việc tạo quan hệ gây chu trình/vòng lặp phụ thuộc (HTTP 422 Unprocessable Entity)', async () => {
  const mockDb = createMockPool();
  const repo = new DependencyRepository(mockDb);
  const service = new DependencyService(repo, mockDb);

  // Tạo đường dẫn A -> B: Task 1 -> Task 2
  const step1 = await service.createDependency(1, { predecessorId: 1, successorId: 2, type: 'FS', lag: 0 });
  assert.strictEqual(step1.status, 201);

  // Tạo đường dẫn B -> C: Task 2 -> Task 3
  const step2 = await service.createDependency(1, { predecessorId: 2, successorId: 3, type: 'FS', lag: 0 });
  assert.strictEqual(step2.status, 201);

  // Thử tạo cạnh C -> A: Task 3 -> Task 1 (Tạo thành vòng khép kín 1 -> 2 -> 3 -> 1)
  const cycleRes = await service.createDependency(1, { predecessorId: 3, successorId: 1, type: 'FS', lag: 0 });
  assert.strictEqual(cycleRes.status, 422, 'Phải trả về HTTP 422 khi phát hiện chu trình');
  assert.strictEqual(cycleRes.hasCycle, true);
  assert.ok(cycleRes.cyclePath.includes('1') && cycleRes.cyclePath.includes('2') && cycleRes.cyclePath.includes('3'));

  // Xác minh quan hệ gây vòng lặp KHÔNG ĐƯỢC LƯU trong CSDL (Rollback)
  const currentList = await service.getDependenciesByProject(1);
  assert.strictEqual(currentList.data.length, 2, 'Cạnh gây chu trình không được phép lưu vào CSDL');
});

// ==========================================
// 4. PHÂN QUYỀN RBAC VÀ CHẶN XÓA TASK ĐANG CÓ DEPENDENCY
// ==========================================

test('S-06 RBAC: Viewer chỉ được xem; bị chặn 403 khi thêm, sửa hoặc xóa quan hệ phụ thuộc', async () => {
  const mockDb = createMockPool();
  const dependencyRoutes = require('../src/routes/dependencyRoutes')(mockDb);
  const viewer = findUserByEmail('viewer@thicong.vn');

  // Lấy các route layer
  const postLayer = dependencyRoutes.stack.find(s => s.route && s.route.path === '/projects/:projectId/dependencies' && s.route.methods.post);
  const putLayer = dependencyRoutes.stack.find(s => s.route && s.route.path === '/dependencies/:id' && s.route.methods.put);
  const delLayer = dependencyRoutes.stack.find(s => s.route && s.route.path === '/dependencies/:id' && s.route.methods.delete);

  // Viewer POST -> 403
  const reqPost = { user: viewer, params: { projectId: 1 }, body: { predecessorId: 1, successorId: 2, type: 'FS', lag: 0 } };
  const resPost = createMockRes();
  await postLayer.route.stack[0].handle(reqPost, resPost);
  assert.strictEqual(resPost.statusCode, 403);

  // Viewer PUT -> 403
  const reqPut = { user: viewer, params: { id: 1 }, body: { type: 'SS', lag: 1 } };
  const resPut = createMockRes();
  await putLayer.route.stack[0].handle(reqPut, resPut);
  assert.strictEqual(resPut.statusCode, 403);

  // Viewer DELETE -> 403
  const reqDel = { user: viewer, params: { id: 1 } };
  const resDel = createMockRes();
  await delLayer.route.stack[0].handle(reqDel, resDel);
  assert.strictEqual(resDel.statusCode, 403);
});

test('S-05 & S-06: Chặn xóa công việc (Task) khi đang có quan hệ phụ thuộc liên kết (HTTP 409 Conflict)', async () => {
  const mockDb = createMockPool();
  // Giả lập Task 1 đang có quan hệ phụ thuộc trong danh sách
  mockDb.dependencies.push({
    id: 1,
    project_id: 1,
    predecessor_task_id: 1,
    successor_task_id: 2,
    dependency_type: 'FS',
    lag_days: 0
  });

  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const delTaskLayer = taskRoutes.stack.find(s => s.route && s.route.path === '/tasks/:id' && s.route.methods.delete);

  const req = { params: { id: 1 } };
  const res = createMockRes();
  await delTaskLayer.route.stack[delTaskLayer.route.stack.length - 1].handle(req, res);

  assert.strictEqual(res.statusCode, 409, 'Phải trả về 409 Conflict khi xóa task đang có quan hệ phụ thuộc');
  assert.strictEqual(res.body.success, false);
  assert.ok(res.body.message.includes('quan hệ phụ thuộc'));
});

test('S-06 Validation: Từ chối hai task thuộc hai project khác nhau (HTTP 400)', async () => {
  const mockDb = createMockPool();
  const repo = new DependencyRepository(mockDb);
  const service = new DependencyService(repo, mockDb);

  // Task 1 thuộc Project 1, Task 4 thuộc Project 2
  const res = await service.createDependency(1, {
    predecessorId: 1,
    successorId: 4,
    type: 'FS',
    lag: 0
  });

  assert.strictEqual(res.status, 400);
  assert.ok(res.message.includes('cùng dự án'));
});

test('S-06 Validation: Dự án không tồn tại trả về HTTP 404', async () => {
  const mockDb = createMockPool();
  const repo = new DependencyRepository(mockDb);
  const service = new DependencyService(repo, mockDb);

  const res = await service.createDependency(999, {
    predecessorId: 1,
    successorId: 2,
    type: 'FS',
    lag: 0
  });

  assert.strictEqual(res.status, 404);
  assert.ok(res.message.includes('không tồn tại'));
});

test('S-06 + S-07: Chu trình hai node (2-node cycle: A ➔ B và B ➔ A) bị từ chối 422', async () => {
  const mockDb = createMockPool();
  const repo = new DependencyRepository(mockDb);
  const service = new DependencyService(repo, mockDb);

  const step1 = await service.createDependency(1, { predecessorId: 1, successorId: 2, type: 'FS', lag: 0 });
  assert.strictEqual(step1.status, 201);

  const step2 = await service.createDependency(1, { predecessorId: 2, successorId: 1, type: 'FS', lag: 0 });
  assert.strictEqual(step2.status, 422);
  assert.strictEqual(step2.hasCycle, true);
  assert.ok(step2.cyclePath.includes('1') && step2.cyclePath.includes('2'));

  // Không được lưu vào DB
  const list = await service.getDependenciesByProject(1);
  assert.strictEqual(list.data.length, 1);
});

test('S-06 RBAC: Admin và Project Manager được phép CRUD quan hệ phụ thuộc trong phạm vi', async () => {
  const mockDb = createMockPool();
  const dependencyRoutes = require('../src/routes/dependencyRoutes')(mockDb);
  const admin = findUserByEmail('admin@thicong.vn');
  const pm = findUserByEmail('pm@thicong.vn');

  const postLayer = dependencyRoutes.stack.find(s => s.route && s.route.path === '/projects/:projectId/dependencies' && s.route.methods.post);

  // Admin POST dự án 1 -> Thành công (status 201)
  const reqAdmin = { user: admin, params: { projectId: 1 }, body: { predecessorId: 1, successorId: 2, type: 'FS', lag: 0 } };
  const resAdmin = createMockRes();
  await postLayer.route.stack[postLayer.route.stack.length - 1].handle(reqAdmin, resAdmin);
  assert.strictEqual(resAdmin.statusCode, 201);

  // PM POST dự án 1 -> Thành công (status 201 với quan hệ khác)
  const reqPM = { user: pm, params: { projectId: 1 }, body: { predecessorId: 2, successorId: 3, type: 'SS', lag: 1 } };
  const resPM = createMockRes();
  await postLayer.route.stack[postLayer.route.stack.length - 1].handle(reqPM, resPM);
  assert.strictEqual(resPM.statusCode, 201);
});

// ==========================================
// 5. TÍCH HỢP TOPO SCHEDULER VỚI DỮ LIỆU THẬT S-06
// ==========================================

test('S-07 Integration: Scheduler đọc task_dependencies thật, trả về INTEGRATED WITH S-06', async () => {
  const mockDb = createMockPool();
  // Giả lập 3 tasks trong project 1: 1, 2, 3
  // Thêm quan hệ 1 -> 2 -> 3
  mockDb.dependencies.push(
    { id: 1, project_id: 1, predecessor_task_id: 1, successor_task_id: 2, dependency_type: 'FS', lag_days: 0 },
    { id: 2, project_id: 1, predecessor_task_id: 2, successor_task_id: 3, dependency_type: 'SS', lag_days: 1 }
  );

  const { SchedulerService } = require('../src/domain/scheduling/schedulerService');
  const scheduler = new SchedulerService(mockDb);

  const result = await scheduler.getProjectSchedule(1);

  assert.strictEqual(result.integrationStatus, 'INTEGRATED WITH S-06');
  assert.strictEqual(result.hasCycle, false);
  assert.strictEqual(result.dependenciesCount, 2);
  assert.strictEqual(result.nodeCount, 3);
  assert.strictEqual(result.order.length, 3);

  // Thứ tự topo phải là Task 1 -> Task 2 -> Task 3
  const orderIds = result.order.map(t => t.id);
  assert.deepStrictEqual(orderIds, [1, 2, 3], 'Thứ tự chuỗi 1 -> 2 -> 3 phải đúng chuẩn Topo');
});

test('S-07 Integration: Đồ thị rẽ nhánh và hội tụ xử lý chính xác và deterministic', async () => {
  const { SchedulerService } = require('../src/domain/scheduling/schedulerService');
  const scheduler = new SchedulerService({});

  const tasks = [
    { id: 1, name: 'Khởi đầu', duration: 1 },
    { id: 2, name: 'Nhánh A', duration: 1 },
    { id: 3, name: 'Nhánh B', duration: 1 },
    { id: 4, name: 'Hội tụ', duration: 1 }
  ];

  // Rẽ nhánh: 1 -> 2, 1 -> 3; Hội tụ: 2 -> 4, 3 -> 4
  const dependencies = [
    { predecessorId: 1, successorId: 2, type: 'FS', lag: 0 },
    { predecessorId: 1, successorId: 3, type: 'FS', lag: 0 },
    { predecessorId: 2, successorId: 4, type: 'FS', lag: 0 },
    { predecessorId: 3, successorId: 4, type: 'FS', lag: 0 }
  ];

  const result = scheduler.computeSchedule(tasks, dependencies);
  assert.strictEqual(result.hasCycle, false);

  const ids = result.order.map(t => t.id);
  assert.strictEqual(ids[0], 1, 'Task 1 phải đứng đầu');
  assert.strictEqual(ids[3], 4, 'Task 4 phải đứng cuối');
  assert.ok(ids.indexOf(1) < ids.indexOf(2) && ids.indexOf(2) < ids.indexOf(4));
  assert.ok(ids.indexOf(1) < ids.indexOf(3) && ids.indexOf(3) < ids.indexOf(4));
});

test('S-07 Integration: Đồ thị rời rạc (nhiều thành phần liên thông) xử lý đầy đủ node', async () => {
  const { SchedulerService } = require('../src/domain/scheduling/schedulerService');
  const scheduler = new SchedulerService({});

  const tasks = [
    { id: 10, name: 'Cụm 1 - A', duration: 1 },
    { id: 11, name: 'Cụm 1 - B', duration: 1 },
    { id: 20, name: 'Cụm 2 - A', duration: 1 },
    { id: 21, name: 'Cụm 2 - B', duration: 1 },
    { id: 30, name: 'Độc lập', duration: 1 }
  ];

  const dependencies = [
    { predecessorId: 10, successorId: 11, type: 'FS', lag: 0 },
    { predecessorId: 20, successorId: 21, type: 'FS', lag: 0 }
  ];

  const result = scheduler.computeSchedule(tasks, dependencies);
  assert.strictEqual(result.hasCycle, false);
  assert.strictEqual(result.order.length, 5, 'Toàn bộ 5 công việc phải có mặt trong kết quả');

  const ids = result.order.map(t => t.id);
  assert.ok(ids.indexOf(10) < ids.indexOf(11));
  assert.ok(ids.indexOf(20) < ids.indexOf(21));
});

test('S-07 Integration: Hiệu năng thuật toán Topo với đồ thị 100 node đạt O(V+E)', async () => {
  const { SchedulerService } = require('../src/domain/scheduling/schedulerService');
  const scheduler = new SchedulerService({});

  const count = 100;
  const tasks = [];
  for (let i = 1; i <= count; i++) {
    tasks.push({ id: i, name: `Công việc #${i}`, duration: 1 });
  }

  // Tạo chuỗi 1 -> 2 -> ... -> 100
  const dependencies = [];
  for (let i = 1; i < count; i++) {
    dependencies.push({ predecessorId: i, successorId: i + 1, type: 'FS', lag: 0 });
  }

  const startTime = Date.now();
  const result = scheduler.computeSchedule(tasks, dependencies);
  const elapsed = Date.now() - startTime;

  assert.strictEqual(result.hasCycle, false);
  assert.strictEqual(result.order.length, count);
  assert.strictEqual(result.order[0].id, 1);
  assert.strictEqual(result.order[count - 1].id, count);
  assert.ok(elapsed < 100, `Thuật toán 100 node phải chạy dưới 100ms (thực tế: ${elapsed}ms)`);
});
