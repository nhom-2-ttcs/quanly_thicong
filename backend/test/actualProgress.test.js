const test = require('node:test');
const assert = require('node:assert');

// Mock pool để kiểm thử logic S-15 / SCRUM-88 (T-34, T-35)
function createMockPool() {
  const projects = [{ id: 1, name: 'Dự án Mẫu', code: 'DA-01' }];
  const workItems = [
    { id: 10, project_id: 1, name: 'Hạng mục Móng (Lá)', code: 'HM-01', parent_id: null }
  ];
  const tasks = [
    {
      id: 1,
      project_id: 1,
      work_item_id: 10,
      name: 'Đào hố móng trụ T1',
      code: 'CV-01',
      duration: 5,
      actual_start: null,
      actual_end: null,
      percent_complete: 0.00,
      status: 'pending'
    },
    {
      id: 2,
      project_id: 1,
      work_item_id: 10,
      name: 'Đổ bê tông lót móng',
      code: 'CV-02',
      duration: 3,
      actual_start: '2026-10-01',
      actual_end: '2026-10-03',
      percent_complete: 100.00,
      status: 'completed'
    }
  ];
  let nextTaskId = 3;

  const pool = {
    projects,
    workItems,
    tasks,

    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async query(sql, params) { return pool.query(sql, params); }
      };
    },

    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase();

      if (normalized.startsWith('SELECT ID FROM PROJECTS WHERE ID = ?')) {
        const found = projects.filter(p => p.id === Number(params[0]));
        return [found];
      }

      if (normalized.startsWith('SELECT ID, PROJECT_ID FROM WORK_ITEMS WHERE ID = ?')) {
        const found = workItems.filter(w => w.id === Number(params[0]));
        return [found];
      }

      if (normalized.startsWith('SELECT ID FROM WORK_ITEMS WHERE PARENT_ID = ?')) {
        const found = workItems.filter(w => w.parent_id === Number(params[0]));
        return [found];
      }

      if (normalized.startsWith('SELECT * FROM TASKS WHERE ID = ?') ||
          normalized.startsWith('SELECT ID, PROJECT_ID FROM TASKS WHERE ID = ?')) {
        const found = tasks.filter(t => t.id === Number(params[0]));
        return [found.map(t => ({ ...t }))];
      }

      if (normalized.includes('FROM TASKS T JOIN WORK_ITEMS W ON T.WORK_ITEM_ID = W.ID WHERE T.ID = ?')) {
        const t = tasks.find(item => item.id === Number(params[0]));
        if (!t) return [[]];
        const w = workItems.find(item => item.id === t.work_item_id) || { name: 'HM', code: 'HM-01' };
        return [[{ ...t, work_item_name: w.name, work_item_code: w.code }]];
      }

      if (normalized.includes('FROM TASKS T JOIN WORK_ITEMS W ON T.WORK_ITEM_ID = W.ID WHERE T.PROJECT_ID = ?')) {
        const pId = Number(params[0]);
        const matched = tasks.filter(t => t.project_id === pId).map(t => {
          const w = workItems.find(item => item.id === t.work_item_id) || { name: 'HM', code: 'HM-01' };
          return { ...t, work_item_name: w.name, work_item_code: w.code };
        });
        return [matched];
      }

      if (normalized.startsWith('INSERT INTO TASKS')) {
        const newTask = {
          id: nextTaskId++,
          project_id: params[0],
          work_item_id: params[1],
          name: params[2],
          code: params[3],
          duration: params[4],
          actual_start: params[5],
          actual_end: params[6],
          percent_complete: params[7],
          status: params[8]
        };
        tasks.push(newTask);
        return [{ insertId: newTask.id }];
      }

      if (normalized.startsWith('UPDATE TASKS SET ACTUAL_START = ?, ACTUAL_END = ?, PERCENT_COMPLETE = ?, STATUS = ? WHERE ID = ?')) {
        const [actual_start, actual_end, percent_complete, status, id] = params;
        const target = tasks.find(t => t.id === Number(id));
        if (target) {
          target.actual_start = actual_start;
          target.actual_end = actual_end;
          target.percent_complete = percent_complete;
          target.status = status;
        }
        return [{ affectedRows: 1 }];
      }

      if (normalized.startsWith('UPDATE TASKS SET NAME = ?, CODE = ?, DURATION = ?, WORK_ITEM_ID = ?, ACTUAL_START = ?, ACTUAL_END = ?, PERCENT_COMPLETE = ?, STATUS = ? WHERE ID = ?')) {
        const [name, code, duration, work_item_id, actual_start, actual_end, percent_complete, status, id] = params;
        const target = tasks.find(t => t.id === Number(id));
        if (target) {
          target.name = name;
          target.code = code;
          target.duration = duration;
          target.work_item_id = work_item_id;
          target.actual_start = actual_start;
          target.actual_end = actual_end;
          target.percent_complete = percent_complete;
          target.status = status;
        }
        return [{ affectedRows: 1 }];
      }

      return [[]];
    }
  };

  return pool;
}

function mockRes() {
  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; },
    get statusCode() { return statusCode; },
    get data() { return responseData; }
  };
  return res;
}

// ====================================================================
// TEST SUITE: S-15 / SCRUM-88 (Cập nhật tiến độ thực tế tách kế hoạch)
// ====================================================================

test('S-15 AC 1: Việc chưa bắt đầu, khi nhập ngày bắt đầu thực tế -> chuyển sang đang làm, số liệu kế hoạch gốc (duration) không đổi', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });

  const patchRoute = taskRoutes.stack.find(s => s.route && s.route.path === '/tasks/:id/progress' && s.route.methods.patch);
  assert.ok(patchRoute, 'Route PATCH /tasks/:id/progress phải tồn tại');

  const res = mockRes();
  await patchRoute.route.stack[0].handle({
    params: { id: 1 },
    body: {
      actual_start: '2026-10-05',
      percent_complete: 25
    }
  }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.data.success, true);
  // AC 1: Trạng thái chuyển sang in_progress
  assert.strictEqual(res.data.data.status, 'in_progress', 'Việc chưa bắt đầu có actual_start phải chuyển sang in_progress');
  assert.strictEqual(res.data.data.actual_start, '2026-10-05');
  assert.strictEqual(res.data.data.percent_complete, 25);
  // NFR: Số liệu kế hoạch gốc không đổi
  assert.strictEqual(res.data.data.duration, 5, 'Thời lượng kế hoạch gốc (5 ngày) phải được giữ nguyên tuyệt đối');
});

test('S-15 AC 2: Nhập ngày kết thúc thực tế sớm hơn ngày bắt đầu thực tế -> bị chặn kèm lý do (HTTP 400)', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const patchRoute = taskRoutes.stack.find(s => s.route && s.route.path === '/tasks/:id/progress' && s.route.methods.patch);

  const res = mockRes();
  await patchRoute.route.stack[0].handle({
    params: { id: 1 },
    body: {
      actual_start: '2026-10-10',
      actual_end: '2026-10-08', // Sớm hơn ngày bắt đầu!
      percent_complete: 100
    }
  }, res);

  assert.strictEqual(res.statusCode, 400, 'actual_end sớm hơn actual_start phải trả về HTTP 400');
  assert.strictEqual(res.data.success, false);
  assert.ok(
    res.data.message.includes('Ngày kết thúc thực tế không được sớm hơn ngày bắt đầu thực tế'),
    `Thông báo lỗi phải nêu rõ lý do: ${res.data.message}`
  );
});

test('S-15 AC 3: Nhập phần trăm hoàn thành ngoài khoảng 0–100 -> bị chặn kèm mã 400', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const patchRoute = taskRoutes.stack.find(s => s.route && s.route.path === '/tasks/:id/progress' && s.route.methods.patch);

  const invalidPercents = [-5, -0.1, 100.5, 105, 200, 'abc'];

  for (const badPct of invalidPercents) {
    const res = mockRes();
    await patchRoute.route.stack[0].handle({
      params: { id: 1 },
      body: {
        percent_complete: badPct
      }
    }, res);

    assert.strictEqual(res.statusCode, 400, `percent_complete = ${badPct} phải bị từ chối với HTTP 400`);
    assert.strictEqual(res.data.success, false);
    assert.ok(res.data.message.includes('Phần trăm hoàn thành phải nằm trong khoảng từ 0 đến 100'));
  }
});

test('S-15 AC 3: Nhập phần trăm hoàn thành hợp lệ [0, 100] được chấp nhận', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const patchRoute = taskRoutes.stack.find(s => s.route && s.route.path === '/tasks/:id/progress' && s.route.methods.patch);

  const validPercents = [0, 50, 75.5, 100];

  for (const goodPct of validPercents) {
    const res = mockRes();
    await patchRoute.route.stack[0].handle({
      params: { id: 1 },
      body: {
        percent_complete: goodPct
      }
    }, res);

    assert.strictEqual(res.statusCode, 200, `percent_complete = ${goodPct} phải hợp lệ`);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.percent_complete, goodPct);
  }
});

test('S-15 AC 4: Việc đã kết thúc thực tế, khi nhập lại phần trăm < 100 mà chưa xác nhận -> bị hỏi xác nhận (HTTP 409)', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const patchRoute = taskRoutes.stack.find(s => s.route && s.route.path === '/tasks/:id/progress' && s.route.methods.patch);

  // Task ID 2: status = 'completed', percent_complete = 100, actual_end = '2026-10-03'
  const res = mockRes();
  await patchRoute.route.stack[0].handle({
    params: { id: 2 },
    body: {
      percent_complete: 80 // Nhập lại < 100
    }
  }, res);

  assert.strictEqual(res.statusCode, 409, 'Mở lại việc đã xong mà chưa confirm phải trả về HTTP 409 Conflict');
  assert.strictEqual(res.data.success, false);
  assert.strictEqual(res.data.requires_confirmation, true);
  assert.ok(
    res.data.message.includes('Công việc đã kết thúc thực tế') && res.data.message.includes('mở lại một việc đã xong'),
    `Phải cảnh báo đang mở lại việc đã xong: ${res.data.message}`
  );
});

test('S-15 AC 4: Việc đã kết thúc thực tế, khi nhập lại phần trăm < 100 kèm xác nhận confirm_reopen=true -> mở lại thành công, chuyển in_progress', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const patchRoute = taskRoutes.stack.find(s => s.route && s.route.path === '/tasks/:id/progress' && s.route.methods.patch);

  // Task ID 2: status = 'completed', nhập lại 80% kèm confirm_reopen: true
  const res = mockRes();
  await patchRoute.route.stack[0].handle({
    params: { id: 2 },
    body: {
      percent_complete: 80,
      confirm_reopen: true
    }
  }, res);

  assert.strictEqual(res.statusCode, 200, 'Có confirm_reopen phải mở lại thành công');
  assert.strictEqual(res.data.success, true);
  assert.strictEqual(res.data.data.percent_complete, 80);
  assert.strictEqual(res.data.data.status, 'in_progress', 'Trạng thái phải chuyển về in_progress vì việc đang mở lại');
  assert.strictEqual(res.data.data.duration, 3, 'Thời lượng kế hoạch gốc (3 ngày) giữ nguyên');
});

test('S-15 NFR: Cập nhật tiến độ lưu tách cột khỏi số liệu kế hoạch, không ghi đè duration', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const patchRoute = taskRoutes.stack.find(s => s.route && s.route.path === '/tasks/:id/progress' && s.route.methods.patch);

  const initialDuration = mockDb.tasks[0].duration;

  const res = mockRes();
  await patchRoute.route.stack[0].handle({
    params: { id: 1 },
    body: {
      actual_start: '2026-10-02',
      actual_end: '2026-10-07',
      percent_complete: 100
    }
  }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(mockDb.tasks[0].duration, initialDuration, 'NFR: Cột duration kế hoạch tuyệt đối không bị ghi đè');
  assert.strictEqual(mockDb.tasks[0].actual_start, '2026-10-02');
  assert.strictEqual(mockDb.tasks[0].actual_end, '2026-10-07');
  assert.strictEqual(mockDb.tasks[0].percent_complete, 100);
  assert.strictEqual(mockDb.tasks[0].status, 'completed');
});

test('S-15 RBAC: Quyền Viewer (Người xem) bị từ chối 403 Forbidden khi cập nhật tiến độ thực tế', async () => {
  const mockDb = createMockPool();
  const taskRoutes = require('../src/routes/taskRoutes')({ pool: mockDb });
  const patchRoute = taskRoutes.stack.find(s => s.route && s.route.path === '/tasks/:id/progress' && s.route.methods.patch);

  const res = mockRes();
  await patchRoute.route.stack[0].handle({
    user: { role_name: 'viewer' },
    params: { id: 1 },
    body: { percent_complete: 50 }
  }, res);

  assert.strictEqual(res.statusCode, 403, 'Viewer phải bị chặn 403 Forbidden');
  assert.strictEqual(res.data.success, false);
});
