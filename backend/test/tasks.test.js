const test = require('node:test');
const assert = require('node:assert');

// Mock pool để kiểm thử logic validation và nghiệp vụ S-05 (T-11, T-12) độc lập
function createMockPool() {
  const projects = [{ id: 1, name: 'Dự án A', code: 'DA-01' }];
  const workItems = [
    { id: 10, project_id: 1, name: 'Hạng mục Móng (Lá)', code: 'HM-01', parent_id: null },
    { id: 11, project_id: 1, name: 'Hạng mục Mẹ (Cha)', code: 'HM-CHA', parent_id: null },
    { id: 12, project_id: 1, name: 'Hạng mục Con (Lá)', code: 'HM-CON', parent_id: 11 },
    { id: 20, project_id: 2, name: 'Hạng mục Thân (Dự án khác)', code: 'HM-02', parent_id: null }
  ];
  const tasks = [];
  const taskDependencies = [];
  let nextTaskId = 1;
  let shouldFailDelete = false;

  const pool = {
    projects,
    workItems,
    tasks,
    taskDependencies,
    get shouldFailDelete() { return shouldFailDelete; },
    set shouldFailDelete(val) { shouldFailDelete = val; },

    async getConnection() {
      let rolledBack = false;
      let committed = false;
      return {
        get isRolledBack() { return rolledBack; },
        get isCommitted() { return committed; },
        async beginTransaction() {},
        async commit() { committed = true; },
        async rollback() { rolledBack = true; },
        release() {},
        async query(sql, params = []) {
          return pool.query(sql, params);
        }
      };
    },

    async query(sql, params = []) {
      const trimmed = sql.trim().toUpperCase();

      if (trimmed.startsWith('SELECT ID FROM PROJECTS WHERE ID = ?')) {
        const found = projects.filter(p => p.id === Number(params[0]));
        return [found];
      }

      if (trimmed.startsWith('SELECT ID, PROJECT_ID FROM WORK_ITEMS WHERE ID = ?')) {
        const found = workItems.filter(w => w.id === Number(params[0]));
        return [found];
      }

      if (trimmed.startsWith('SELECT ID FROM WORK_ITEMS WHERE PARENT_ID = ?')) {
        const found = workItems.filter(w => w.parent_id === Number(params[0]));
        return [found];
      }

      if (trimmed.startsWith('SELECT ID FROM TASKS WHERE WORK_ITEM_ID = ?')) {
        const found = tasks.filter(t => t.work_item_id === Number(params[0]));
        return [found];
      }

      if (trimmed.startsWith('SELECT ID FROM TASK_DEPENDENCIES WHERE PREDECESSOR_TASK_ID = ? OR SUCCESSOR_TASK_ID = ?')) {
        const tId = Number(params[0]);
        const found = taskDependencies.filter(d => d.predecessor_task_id === tId || d.successor_task_id === tId);
        return [found];
      }

      if (trimmed.startsWith('INSERT INTO TASKS')) {
        const [projectId, workItemId, name, code, duration, status] = params;
        const newTask = {
          id: nextTaskId++,
          project_id: projectId,
          work_item_id: workItemId,
          name,
          code,
          duration,
          status
        };
        tasks.push(newTask);
        return [{ insertId: newTask.id }];
      }

      if (trimmed.startsWith('SELECT ID, PROJECT_ID, NAME, CODE FROM TASKS WHERE ID = ?') ||
          trimmed.startsWith('SELECT ID, PROJECT_ID FROM TASKS WHERE ID = ?') ||
          trimmed.startsWith('SELECT * FROM TASKS WHERE ID = ?')) {
        const found = tasks.filter(t => t.id === Number(params[0]));
        return [found];
      }

      if (trimmed.startsWith('DELETE FROM TASK_DEPENDENCIES WHERE PREDECESSOR_TASK_ID = ? OR SUCCESSOR_TASK_ID = ?')) {
        const tId = Number(params[0]);
        for (let i = taskDependencies.length - 1; i >= 0; i--) {
          if (taskDependencies[i].predecessor_task_id === tId || taskDependencies[i].successor_task_id === tId) {
            taskDependencies.splice(i, 1);
          }
        }
        return [{ affectedRows: 1 }];
      }

      if (trimmed.startsWith('DELETE FROM TASKS WHERE ID = ?')) {
        if (shouldFailDelete) {
          throw new Error('Cố ý gây lỗi xóa task để test rollback transaction');
        }
        const idx = tasks.findIndex(t => t.id === Number(params[0]));
        if (idx !== -1) tasks.splice(idx, 1);
        return [{ affectedRows: 1 }];
      }

      return [[]];
    }
  };

  return pool;
}

test('S-05 T-11: Khai báo công việc hợp lệ có thời lượng là số nguyên dương (ngày)', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });

  const req = {
    params: { projectId: 1 },
    body: {
      name: 'Đào hố móng trụ T1',
      code: 'CV-01',
      work_item_id: 10,
      duration: 4, // 4 ngày (số nguyên dương)
      status: 'pending'
    }
  };

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; }
  };

  const route = taskRoutes.stack.find(s => s.route && s.route.path === '/projects/:projectId/tasks' && s.route.methods.post);
  assert.ok(route, 'Route POST /projects/:projectId/tasks phải tồn tại');

  await route.route.stack[0].handle(req, res);

  assert.strictEqual(statusCode, 201, 'Tạo công việc thành công phải trả HTTP 201');
  assert.strictEqual(responseData.success, true);
  assert.strictEqual(responseData.data.name, 'Đào hố móng trụ T1');
  assert.strictEqual(responseData.data.duration, 4);
  assert.strictEqual(responseData.data.work_item_id, 10);
  assert.strictEqual(mockDb.tasks.length, 1);
});

test('S-05 T-11: Validation từ chối khi tên công việc trống', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });

  const testCases = ['', '   ', null, undefined];
  const route = taskRoutes.stack.find(s => s.route && s.route.path === '/projects/:projectId/tasks' && s.route.methods.post);

  for (const emptyName of testCases) {
    let statusCode = 200;
    let responseData = null;
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { responseData = data; return this; }
    };

    await route.route.stack[0].handle({
      params: { projectId: 1 },
      body: { name: emptyName, duration: 2, work_item_id: 10 }
    }, res);

    assert.strictEqual(statusCode, 400, 'Tên trống phải trả 400 Bad Request');
    assert.strictEqual(responseData.success, false);
    assert.ok(responseData.message.includes('Tên công việc không được để trống'));
  }
});

test('S-05 T-11: Validation từ chối thời lượng không hợp lệ (số thực, âm, 0, NaN, chuỗi ký tự)', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const route = taskRoutes.stack.find(s => s.route && s.route.path === '/projects/:projectId/tasks' && s.route.methods.post);

  const invalidDurations = [3.5, 0.5, 0, -1, -5.5, 'không phải số', NaN, Infinity, -Infinity, ''];

  for (const badDuration of invalidDurations) {
    let statusCode = 200;
    let responseData = null;
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { responseData = data; return this; }
    };

    await route.route.stack[0].handle({
      params: { projectId: 1 },
      body: { name: 'Đổ bê tông', duration: badDuration, work_item_id: 10 }
    }, res);

    assert.strictEqual(statusCode, 400, `Thời lượng ${badDuration} phải bị từ chối với HTTP 400`);
    assert.strictEqual(responseData.success, false);
    assert.ok(responseData.message.includes('Thời lượng'));
  }
});

test('S-05: Từ chối gắn công việc vào hạng mục cha và chỉ cho phép gắn vào hạng mục lá', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const route = taskRoutes.stack.find(s => s.route && s.route.path === '/projects/:projectId/tasks' && s.route.methods.post);

  // 1. Thử gắn vào hạng mục cha (id: 11 là cha của id: 12)
  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; }
  };

  await route.route.stack[0].handle({
    params: { projectId: 1 },
    body: { name: 'Gắn vào hạng mục cha', duration: 3, work_item_id: 11 }
  }, res);

  assert.strictEqual(statusCode, 400, 'Gắn vào hạng mục cha phải trả HTTP 400');
  assert.strictEqual(responseData.success, false);
  assert.ok(responseData.message.includes('hạng mục lá'), 'Phải thông báo chỉ được gắn vào hạng mục lá');

  // 2. Gắn vào hạng mục lá con (id: 12) -> thành công 201
  let statusCode2 = 200;
  let responseData2 = null;
  const res2 = {
    status(code) { statusCode2 = code; return this; },
    json(data) { responseData2 = data; return this; }
  };

  await route.route.stack[0].handle({
    params: { projectId: 1 },
    body: { name: 'Gắn vào hạng mục con lá', duration: 3, work_item_id: 12 }
  }, res2);

  assert.strictEqual(statusCode2, 201, 'Gắn vào hạng mục lá phải trả HTTP 201');
  assert.strictEqual(responseData2.success, true);
});

test('S-05 T-11: Validation từ chối khi gắn vào hạng mục WBS không tồn tại', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const route = taskRoutes.stack.find(s => s.route && s.route.path === '/projects/:projectId/tasks' && s.route.methods.post);

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; }
  };

  await route.route.stack[0].handle({
    params: { projectId: 1 },
    body: { name: 'Công việc X', duration: 5, work_item_id: 9999 }
  }, res);

  assert.strictEqual(statusCode, 404, 'Hạng mục không tồn tại phải trả HTTP 404');
  assert.strictEqual(responseData.success, false);
  assert.ok(responseData.message.includes('không tồn tại'));
});

test('S-05 T-11: Validation từ chối khi hạng mục WBS thuộc dự án khác (tham chiếu chéo sai dự án)', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const route = taskRoutes.stack.find(s => s.route && s.route.path === '/projects/:projectId/tasks' && s.route.methods.post);

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; }
  };

  await route.route.stack[0].handle({
    params: { projectId: 1 },
    body: { name: 'Công việc Y', duration: 4, work_item_id: 20 }
  }, res);

  assert.strictEqual(statusCode, 400, 'Khác dự án phải trả HTTP 400');
  assert.strictEqual(responseData.success, false);
  assert.ok(responseData.message.includes('không thuộc cùng dự án'));
});

test('S-05: Xóa công việc có quan hệ phụ thuộc yêu cầu xác nhận (HTTP 409 requires_confirmation)', async () => {
  const mockDb = createMockPool();
  mockDb.tasks.push({ id: 1, project_id: 1, work_item_id: 10, name: 'Công việc gốc', duration: 3 });
  mockDb.tasks.push({ id: 2, project_id: 1, work_item_id: 10, name: 'Công việc sau', duration: 4 });
  mockDb.taskDependencies.push({ id: 100, predecessor_task_id: 1, successor_task_id: 2, type: 'FS', lag: 0 });

  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const deleteRoute = taskRoutes.stack.find(s => s.route && s.route.path === '/tasks/:id' && s.route.methods.delete);
  assert.ok(deleteRoute, 'Route DELETE /tasks/:id phải tồn tại');

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; }
  };

  // Thử xóa task 1 không kèm confirm -> 409 Conflict
  await deleteRoute.route.stack[0].handle({
    params: { id: 1 },
    query: {}
  }, res);

  assert.strictEqual(statusCode, 409, 'Xóa task có dependency chưa xác nhận phải trả HTTP 409');
  assert.strictEqual(responseData.requires_confirmation, true);
  assert.strictEqual(responseData.dependency_count, 1);
  assert.strictEqual(mockDb.tasks.length, 2, 'Công việc chưa bị xóa');
  assert.strictEqual(mockDb.taskDependencies.length, 1, 'Quan hệ chưa bị xóa');
});

test('S-05: Xóa công việc có quan hệ phụ thuộc khi có confirm=true xóa sạch trong transaction', async () => {
  const mockDb = createMockPool();
  mockDb.tasks.push({ id: 1, project_id: 1, work_item_id: 10, name: 'Công việc gốc', duration: 3 });
  mockDb.tasks.push({ id: 2, project_id: 1, work_item_id: 10, name: 'Công việc sau', duration: 4 });
  mockDb.taskDependencies.push({ id: 100, predecessor_task_id: 1, successor_task_id: 2, type: 'FS', lag: 0 });

  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const deleteRoute = taskRoutes.stack.find(s => s.route && s.route.path === '/tasks/:id' && s.route.methods.delete);

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; }
  };

  // Xóa với query confirm=true
  await deleteRoute.route.stack[0].handle({
    params: { id: 1 },
    query: { confirm: 'true' }
  }, res);

  assert.strictEqual(statusCode, 200, 'Xóa có xác nhận phải trả HTTP 200');
  assert.strictEqual(responseData.success, true);
  assert.strictEqual(responseData.deleted_dependencies_count, 1);
  assert.strictEqual(mockDb.tasks.length, 1, 'Công việc 1 đã bị xóa khỏi cơ sở dữ liệu');
  assert.strictEqual(mockDb.taskDependencies.length, 0, 'Quan hệ phụ thuộc liên đới đã bị xóa');
});

test('S-05: Rollback transaction an toàn khi xóa gặp lỗi bất ngờ', async () => {
  const mockDb = createMockPool();
  mockDb.tasks.push({ id: 1, project_id: 1, work_item_id: 10, name: 'Công việc lỗi', duration: 3 });
  mockDb.shouldFailDelete = true;

  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const deleteRoute = taskRoutes.stack.find(s => s.route && s.route.path === '/tasks/:id' && s.route.methods.delete);

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; }
  };

  await deleteRoute.route.stack[0].handle({
    params: { id: 1 },
    query: { confirm: 'true' }
  }, res);

  assert.strictEqual(statusCode, 500, 'Lỗi cơ sở dữ liệu phải trả về HTTP 500');
  assert.strictEqual(responseData.success, false);
  assert.strictEqual(mockDb.tasks.length, 1, 'Task không bị xóa dở dang nhờ rollback');
});

test('S-05 / RBAC: Quyền Viewer bị từ chối 403 Forbidden khi tạo hoặc xóa công việc', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });

  const createRoute = taskRoutes.stack.find(s => s.route && s.route.path === '/projects/:projectId/tasks' && s.route.methods.post);
  const deleteRoute = taskRoutes.stack.find(s => s.route && s.route.path === '/tasks/:id' && s.route.methods.delete);

  // 1. Viewer tạo công việc
  let status1 = 200;
  let data1 = null;
  const res1 = {
    status(code) { status1 = code; return this; },
    json(data) { data1 = data; return this; }
  };
  await createRoute.route.stack[0].handle({
    params: { projectId: 1 },
    user: { role: 'viewer', userId: 99 },
    body: { name: 'Viewer thử tạo', duration: 2, work_item_id: 10 }
  }, res1);
  assert.strictEqual(status1, 403, 'Viewer tạo task phải nhận HTTP 403');
  assert.strictEqual(data1.success, false);

  // 2. Viewer xóa công việc
  let status2 = 200;
  let data2 = null;
  const res2 = {
    status(code) { status2 = code; return this; },
    json(data) { data2 = data; return this; }
  };
  await deleteRoute.route.stack[0].handle({
    params: { id: 1 },
    user: { role: 'viewer', userId: 99 },
    query: { confirm: 'true' }
  }, res2);
  assert.strictEqual(status2, 403, 'Viewer xóa task phải nhận HTTP 403');
  assert.strictEqual(data2.success, false);
});

test('S-05 & T-10: Chặn xóa hạng mục WBS khi đang chứa công việc (Trả về 409 Conflict)', async () => {
  const mockDb = createMockPool();
  // Gắn 1 công việc vào hạng mục 10
  mockDb.tasks.push({ id: 1, project_id: 1, work_item_id: 10, name: 'Công việc gắn móng', duration: 2 });

  const wbsRoutes = require('../wbs_routes')({ pool: mockDb });
  const deleteRoute = wbsRoutes.stack.find(s => s.route && s.route.path === '/work-items/:id' && s.route.methods.delete);
  assert.ok(deleteRoute, 'Route DELETE /work-items/:id phải tồn tại');

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; }
  };

  await deleteRoute.route.stack[0].handle({ params: { id: 10 } }, res);

  assert.strictEqual(statusCode, 409, 'Hạng mục có công việc phải trả về HTTP 409 Conflict');
  assert.strictEqual(responseData.success, false);
  assert.ok(responseData.message.includes('đang có công việc'));
});
