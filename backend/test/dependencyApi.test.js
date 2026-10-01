const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const wbsRoutes = require('../wbs_routes');
const { resetInMemoryDependencies } = require('../src/models/dependencyManager');

// Khởi tạo app Express mini để kiểm thử API endpoint
function createTestApp() {
  const app = express();
  app.use(express.json());
  // Giả lập db ở trạng thái standalone
  app.use('/api', wbsRoutes({ pool: null }));
  return app;
}

test.beforeEach(() => {
  resetInMemoryDependencies([]);
});

// Helper gửi request HTTP ảo vào Express
async function mockRequest(app, method, url, body = null) {
  return new Promise((resolve) => {
    const req = {
      method,
      url,
      headers: { 'content-type': 'application/json' },
      body: body || {}
    };

    let statusCode = 200;
    let headers = {};
    let responseBody = null;

    const res = {
      setHeader(name, val) { headers[name] = val; return res; },
      status(code) { statusCode = code; return res; },
      json(data) { responseBody = data; resolve({ status: statusCode, body: responseBody }); },
      send(data) { responseBody = data; resolve({ status: statusCode, body: responseBody }); }
    };

    app.handle(req, res);
  });
}

test('API S-06: GET /api/dependencies/types trả về đủ 4 loại quan hệ chuẩn FS, SS, FF, SF', async () => {
  const app = createTestApp();
  const res = await mockRequest(app, 'GET', '/api/dependencies/types');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.data.length, 4);

  const codes = res.body.data.map(t => t.code);
  assert.ok(codes.includes('FS'));
  assert.ok(codes.includes('SS'));
  assert.ok(codes.includes('FF'));
  assert.ok(codes.includes('SF'));
});

test('API S-06: POST /api/dependencies lưu đủ 4 loại quan hệ và độ trễ dương, 0, âm', async () => {
  const app = createTestApp();

  // 1. FS với lag = 0
  const resFS = await mockRequest(app, 'POST', '/api/dependencies', {
    project_id: 1,
    predecessor_id: 1,
    successor_id: 2,
    dependency_type: 'FS',
    lag: 0
  });
  assert.strictEqual(resFS.status, 201);
  assert.strictEqual(resFS.body.data.dependency_type, 'FS');
  assert.strictEqual(resFS.body.data.lag, 0);

  // 2. SS với lag dương (+2 ngày)
  const resSS = await mockRequest(app, 'POST', '/api/dependencies', {
    project_id: 1,
    predecessor_id: 2,
    successor_id: 3,
    dependency_type: 'SS',
    lag: 2
  });
  assert.strictEqual(resSS.status, 201);
  assert.strictEqual(resSS.body.data.dependency_type, 'SS');
  assert.strictEqual(resSS.body.data.lag, 2);

  // 3. SF với lag âm (-1 ngày / lead)
  const resSF = await mockRequest(app, 'POST', '/api/dependencies', {
    project_id: 1,
    predecessor_id: 3,
    successor_id: 4,
    dependency_type: 'SF',
    lag: -1
  });
  assert.strictEqual(resSF.status, 201);
  assert.strictEqual(resSF.body.data.dependency_type, 'SF');
  assert.strictEqual(resSF.body.data.lag, -1);

  // 4. FF với lag dương (+3 ngày)
  const resFF = await mockRequest(app, 'POST', '/api/dependencies', {
    project_id: 1,
    predecessor_id: 4,
    successor_id: 5,
    dependency_type: 'FF',
    lag: 3
  });
  assert.strictEqual(resFF.status, 201);
  assert.strictEqual(resFF.body.data.dependency_type, 'FF');
  assert.strictEqual(resFF.body.data.lag, 3);
});

test('API S-06: Chặn tự phụ thuộc (predecessor === successor)', async () => {
  const app = createTestApp();
  const res = await mockRequest(app, 'POST', '/api/dependencies', {
    project_id: 1,
    predecessor_id: 5,
    successor_id: 5,
    dependency_type: 'FS',
    lag: 0
  });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.success, false);
  assert.match(res.body.message, /Không cho một công việc phụ thuộc chính nó/);
});

test('API S-06: Chặn trùng cặp công việc trước và công việc sau', async () => {
  const app = createTestApp();
  // Tạo cặp (1, 2)
  await mockRequest(app, 'POST', '/api/dependencies', {
    project_id: 1,
    predecessor_id: 1,
    successor_id: 2,
    dependency_type: 'FS',
    lag: 0
  });

  // Gửi lại cùng cặp (1, 2)
  const dupRes = await mockRequest(app, 'POST', '/api/dependencies', {
    project_id: 1,
    predecessor_id: 1,
    successor_id: 2,
    dependency_type: 'SS',
    lag: 1
  });

  assert.strictEqual(dupRes.status, 400);
  assert.strictEqual(dupRes.body.success, false);
  assert.match(dupRes.body.message, /Không cho trùng cặp/);
});

test('API S-06: Từ chối chuỗi tiếng Việt hoặc mã không hợp lệ cho loại quan hệ', async () => {
  const app = createTestApp();
  const res = await mockRequest(app, 'POST', '/api/dependencies', {
    project_id: 1,
    predecessor_id: 1,
    successor_id: 2,
    dependency_type: 'Kết thúc – Khởi đầu',
    lag: 0
  });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.success, false);
  assert.match(res.body.message, /mã cố định: FS, SS, FF, SF/);
});

test('API S-06: PUT và DELETE quan hệ phụ thuộc qua API', async () => {
  const app = createTestApp();
  const postRes = await mockRequest(app, 'POST', '/api/dependencies', {
    project_id: 1,
    predecessor_id: 10,
    successor_id: 11,
    dependency_type: 'FS',
    lag: 0
  });
  const id = postRes.body.data.id;

  // Cập nhật
  const putRes = await mockRequest(app, 'PUT', `/api/dependencies/${id}`, {
    dependency_type: 'FF',
    lag: 5
  });
  assert.strictEqual(putRes.status, 200);
  assert.strictEqual(putRes.body.data.dependency_type, 'FF');
  assert.strictEqual(putRes.body.data.lag, 5);

  // Xóa
  const delRes = await mockRequest(app, 'DELETE', `/api/dependencies/${id}`);
  assert.strictEqual(delRes.status, 200);
  assert.strictEqual(delRes.body.success, true);
});
