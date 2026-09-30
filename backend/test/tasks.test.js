const test = require('node:test');
const assert = require('node:assert');

// Mock pool để kiểm thử logic validation và nghiệp vụ T-11 độc lập
function createMockPool() {
  const projects = [{ id: 1, name: 'Dự án A', code: 'DA-01' }];
  const workItems = [
    { id: 10, project_id: 1, name: 'Hạng mục Móng', code: 'HM-01' },
    { id: 20, project_id: 2, name: 'Hạng mục Thân (Dự án khác)', code: 'HM-02' }
  ];
  const tasks = [];
  let nextTaskId = 1;

  return {
    projects,
    workItems,
    tasks,
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

      if (trimmed.startsWith('SELECT ID FROM TASKS WHERE WORK_ITEM_ID = ?')) {
        const found = tasks.filter(t => t.work_item_id === Number(params[0]));
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

      if (trimmed.startsWith('SELECT * FROM TASKS WHERE ID = ?')) {
        const found = tasks.filter(t => t.id === Number(params[0]));
        return [found];
      }

      if (trimmed.startsWith('DELETE FROM TASKS WHERE ID = ?')) {
        const idx = tasks.findIndex(t => t.id === Number(params[0]));
        if (idx !== -1) tasks.splice(idx, 1);
        return [{ affectedRows: 1 }];
      }

      return [[]];
    }
  };
}

test('S-05 T-11: Khai báo công việc hợp lệ có thời lượng (ngày)', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });

  // Mô phỏng request hợp lệ
  const req = {
    params: { projectId: 1 },
    body: {
      name: 'Đào hố móng trụ T1',
      code: 'CV-01',
      work_item_id: 10,
      duration: 3.5, // 3.5 ngày
      status: 'pending'
    }
  };

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; }
  };

  // Tìm handler POST /projects/:projectId/tasks
  const route = taskRoutes.stack.find(s => s.route && s.route.path === '/projects/:projectId/tasks' && s.route.methods.post);
  assert.ok(route, 'Route POST /projects/:projectId/tasks phải tồn tại');

  await route.route.stack[0].handle(req, res);

  assert.strictEqual(statusCode, 201, 'Tạo công việc thành công phải trả HTTP 201');
  assert.strictEqual(responseData.success, true);
  assert.strictEqual(responseData.data.name, 'Đào hố móng trụ T1');
  assert.strictEqual(responseData.data.duration, 3.5);
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

test('S-05 T-11: Validation từ chối thời lượng không hợp lệ (âm, 0, NaN, chuỗi ký tự)', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const route = taskRoutes.stack.find(s => s.route && s.route.path === '/projects/:projectId/tasks' && s.route.methods.post);

  const invalidDurations = [0, -1, -5.5, 'không phải số', NaN, Infinity, -Infinity, ''];

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
    body: { name: 'Công việc X', duration: 5, work_item_id: 9999 } // 9999 không tồn tại
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

  // work_item 20 thuộc project 2, nhưng gửi cho project 1
  await route.route.stack[0].handle({
    params: { projectId: 1 },
    body: { name: 'Công việc Y', duration: 4, work_item_id: 20 }
  }, res);

  assert.strictEqual(statusCode, 400, 'Khác dự án phải trả HTTP 400');
  assert.strictEqual(responseData.success, false);
  assert.ok(responseData.message.includes('không thuộc cùng dự án'));
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
