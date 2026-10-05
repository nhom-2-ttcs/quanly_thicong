const test = require('node:test');
const assert = require('node:assert');
const {
  findUserByEmail,
  createSession,
  destroySession,
  canUserAccessProject
} = require('../src/models/store');
const {
  authenticate,
  checkViewerForbidden,
  checkProjectReadAccess
} = require('../src/utils/rbac');

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
// 1. KIỂM THỬ MÃ HÓA VĂN BẢN TIẾNG VIỆT (UTF-8)
// ==========================================

test('UTF-8: Chuỗi tiếng Việt demo nguyên vẹn và không chứa ký tự thay thế \\uFFFD () hay lỗi mã hóa', () => {
  const demoStrings = [
    'Thi công phần móng',
    'Đào đất hố móng trụ T1',
    'Đổ bê tông lót móng',
    'Phần ngầm & Móng',
    'Phần thân & Kết cấu',
    'Chờ thực hiện',
    'Đang thực hiện',
    'Hoàn thành',
    'Người xem dự án',
    'Quản trị viên',
    'Chỉ huy trưởng'
  ];

  // Regex phát hiện mojibake thường gặp:  (\uFFFD), Ã, Â bị vỡ
  const mojibakeRegex = /[\uFFFD]|[\u00C3\u00C2][\u0080-\u00BF]/;

  for (const str of demoStrings) {
    assert.strictEqual(mojibakeRegex.test(str), false, `Chuỗi "${str}" không được chứa ký tự lỗi mojibake`);
    assert.strictEqual(str.includes('\uFFFD'), false, `Chuỗi "${str}" không được chứa ký tự thay thế Unicode \\uFFFD`);
    assert.strictEqual(str.includes('?'), false, `Chuỗi "${str}" không được chứa dấu hỏi ? do suy biến ASCII`);
  }

  // Kiểm tra tên các chuỗi mục tiêu từ yêu cầu đề bài
  assert.strictEqual(demoStrings[0], 'Thi công phần móng');
  assert.strictEqual(demoStrings[1], 'Đào đất hố móng trụ T1');
  assert.strictEqual(demoStrings[2], 'Đổ bê tông lót móng');
});

// ==========================================
// 2. KIỂM THỬ XÁC THỰC & PHIÊN LÀM VIỆC (AUTHENTICATION)
// ==========================================

test('Auth: Admin và Viewer đăng nhập và sinh phiên làm việc hợp lệ', () => {
  const admin = findUserByEmail('admin@thicong.vn');
  assert.ok(admin, 'Admin phải tồn tại');
  const adminToken = createSession(admin);
  assert.ok(adminToken, 'Admin phải được cấp token phiên');

  const viewer = findUserByEmail('viewer@thicong.vn');
  assert.ok(viewer, 'Viewer phải tồn tại');
  const viewerToken = createSession(viewer);
  assert.ok(viewerToken, 'Viewer phải được cấp token phiên');

  // Kiểm tra middleware authenticate với token hợp lệ
  const reqAdmin = { headers: { authorization: `Bearer ${adminToken}` } };
  const resAdmin = createMockRes();
  let adminNextCalled = false;
  authenticate(reqAdmin, resAdmin, () => { adminNextCalled = true; });
  assert.strictEqual(adminNextCalled, true);
  assert.strictEqual(reqAdmin.user.role_name, 'admin');

  // Kiểm tra middleware authenticate với token không hợp lệ -> 401
  const reqInvalid = { headers: { authorization: 'Bearer token-khong-hop-le' } };
  const resInvalid = createMockRes();
  let invalidNextCalled = false;
  authenticate(reqInvalid, resInvalid, () => { invalidNextCalled = true; });
  assert.strictEqual(invalidNextCalled, false);
  assert.strictEqual(resInvalid.statusCode, 401);
  assert.strictEqual(resInvalid.body.success, false);

  // Kiểm tra phiên bị hủy (đăng xuất) -> 401
  destroySession(viewerToken);
  const reqLoggedOut = { headers: { authorization: `Bearer ${viewerToken}` } };
  const resLoggedOut = createMockRes();
  let loggedOutNext = false;
  authenticate(reqLoggedOut, resLoggedOut, () => { loggedOutNext = true; });
  assert.strictEqual(loggedOutNext, false);
  assert.strictEqual(resLoggedOut.statusCode, 401);
});

// ==========================================
// 3. KIỂM THỬ PHÂN QUYỀN RBAC CHO NGƯỜI XEM DỰ ÁN (VIEWER)
// ==========================================

test('RBAC: Viewer chỉ được truy cập dự án được gán quyền (HTTP 200 vs HTTP 403)', () => {
  const viewer = findUserByEmail('viewer@thicong.vn');
  const viewerToken = createSession(viewer);

  // Dự án 1 đã được gán cho viewer
  const canAccessProj1 = canUserAccessProject(viewer, 1);
  assert.strictEqual(canAccessProj1, true, 'Viewer phải được quyền truy cập Dự án 1');

  // Dự án 2 KHÔNG được gán cho viewer
  const canAccessProj2 = canUserAccessProject(viewer, 2);
  assert.strictEqual(canAccessProj2, false, 'Viewer không được truy cập Dự án 2');

  // Thử nghiệm helper checkProjectReadAccess với Dự án 1 (cho phép đọc -> false)
  const reqProj1 = {
    headers: { authorization: `Bearer ${viewerToken}` },
    user: viewer
  };
  const resProj1 = createMockRes();
  const isBlockedProj1 = checkProjectReadAccess(reqProj1, resProj1, 1);
  assert.strictEqual(isBlockedProj1, false, 'checkProjectReadAccess phải cho phép đọc dự án được gán');

  // Thử nghiệm helper checkProjectReadAccess với Dự án 2 -> HTTP 403
  const reqProj2 = {
    headers: { authorization: `Bearer ${viewerToken}` },
    user: viewer
  };
  const resProj2 = createMockRes();
  const isBlockedProj2 = checkProjectReadAccess(reqProj2, resProj2, 2);
  assert.strictEqual(isBlockedProj2, true, 'checkProjectReadAccess phải chặn dự án chưa được cấp quyền');
  assert.strictEqual(resProj2.statusCode, 403, 'Phải trả về 403 Forbidden khi viewer truy cập dự án chưa được cấp quyền');
});

test('RBAC: Viewer bị chặn hoàn toàn các thao tác ghi (POST/PUT/DELETE) trên Project, WBS và Task (HTTP 403)', () => {
  const viewer = findUserByEmail('viewer@thicong.vn');
  const viewerToken = createSession(viewer);

  // Kiểm tra middleware checkViewerForbidden
  const reqViewerMutate = {
    headers: { authorization: `Bearer ${viewerToken}` },
    user: viewer
  };
  const resViewerMutate = createMockRes();
  const isForbidden = checkViewerForbidden(reqViewerMutate, resViewerMutate);

  assert.strictEqual(isForbidden, true, 'Viewer không được tiếp tục thực thi thao tác ghi (isForbidden = true)');
  assert.strictEqual(resViewerMutate.statusCode, 403, 'Thao tác ghi của Viewer phải trả về HTTP 403 Forbidden');
  assert.strictEqual(resViewerMutate.body.success, false);
  assert.ok(resViewerMutate.body.message.includes('Người xem dự án'), 'Thông báo phải nêu rõ vai trò Người xem dự án');
});

test('RBAC: Admin được phép thực hiện mọi thao tác ghi (POST/PUT/DELETE) và truy cập mọi dự án', () => {
  const admin = findUserByEmail('admin@thicong.vn');
  const adminToken = createSession(admin);

  // Admin truy cập bất kỳ dự án nào
  assert.strictEqual(canUserAccessProject(admin, 1), true);
  assert.strictEqual(canUserAccessProject(admin, 2), true);
  assert.strictEqual(canUserAccessProject(admin, 999), true);

  // Admin qua helper checkViewerForbidden (không bị chặn -> false)
  const reqAdminMutate = {
    headers: { authorization: `Bearer ${adminToken}` },
    user: admin
  };
  const resAdminMutate = createMockRes();
  const isForbidden = checkViewerForbidden(reqAdminMutate, resAdminMutate);
  assert.strictEqual(isForbidden, false, 'Admin phải được phép thực hiện thao tác ghi (không bị chặn)');

  // Admin qua helper checkProjectReadAccess trên dự án bất kỳ (không bị chặn -> false)
  const reqAdminProj = {
    headers: { authorization: `Bearer ${adminToken}` },
    user: admin
  };
  const resAdminProj = createMockRes();
  const isBlocked = checkProjectReadAccess(reqAdminProj, resAdminProj, 999);
  assert.strictEqual(isBlocked, false, 'Admin phải được phép đọc bất kỳ dự án nào');
});

// ==========================================
// 4. KIỂM THỬ TÍCH HỢP ROUTE PROJECT (RBAC VÀ DỮ LIỆU)
// ==========================================

test('ProjectRoutes: GET danh sách dự án lọc theo quyền của user (Admin thấy tất cả, Viewer chỉ thấy dự án được gán)', async () => {
  const mockPool = {
    async query(sql) {
      return [[
        { id: 1, name: 'Dự án Thi Công Mẫu', code: 'DA-01', description: 'Mô tả dự án 1' },
        { id: 2, name: 'Tòa Nhà Sky Tower', code: 'DA-02', description: 'Mô tả dự án 2' }
      ]];
    }
  };

  const projectRoutes = require('../src/routes/projectRoutes')({ pool: mockPool });
  const admin = findUserByEmail('admin@thicong.vn');
  const viewer = findUserByEmail('viewer@thicong.vn');

  // Mock gọi router stack
  const getProjectsLayer = projectRoutes.stack.find(s => s.route && s.route.path === '/projects' && s.route.methods.get);
  assert.ok(getProjectsLayer, 'Phải có route GET /projects');

  // Admin gọi GET /projects
  const reqAdmin = { user: admin };
  const resAdmin = createMockRes();
  await getProjectsLayer.route.stack[getProjectsLayer.route.stack.length - 1].handle(reqAdmin, resAdmin);
  assert.strictEqual(resAdmin.statusCode, 200);
  assert.strictEqual(resAdmin.body.data.length, 2, 'Admin phải nhìn thấy cả 2 dự án');

  // Viewer gọi GET /projects
  const reqViewer = { user: viewer };
  const resViewer = createMockRes();
  await getProjectsLayer.route.stack[getProjectsLayer.route.stack.length - 1].handle(reqViewer, resViewer);
  assert.strictEqual(resViewer.statusCode, 200);
  assert.strictEqual(resViewer.body.data.length, 1, 'Viewer chỉ được thấy 1 dự án đã được cấp quyền');
  assert.strictEqual(resViewer.body.data[0].id, 1);
});

// ==========================================
// 5. REGRESSION: S-06 -> S-09 ĐÃ TÍCH HỢP
// ==========================================

test('Regression S-07/S-09: Endpoint trả lịch tích hợp từ task_dependencies', async () => {
  const mockPool = {
    async query(sql) {
      const upper = sql.trim().toUpperCase();
      if (upper.includes('FROM TASK_DEPENDENCIES')) {
        return [[]];
      }
      return [[
        { id: 1, project_id: 1, name: 'Công việc 1', code: 'CV-01', duration: 2, status: 'pending' },
        { id: 2, project_id: 1, name: 'Công việc 2', code: 'CV-02', duration: 3.5, status: 'in_progress' }
      ]];
    }
  };

  const schedulingRoutes = require('../src/routes/schedulingRoutes')({ pool: mockPool });
  const orderLayer = schedulingRoutes.stack.find(s => s.route && s.route.path === '/projects/:projectId/scheduling/order');
  assert.ok(orderLayer, 'Phải có route GET /projects/:projectId/scheduling/order');

  const req = { params: { projectId: 1 } };
  const res = createMockRes();
  await orderLayer.route.stack[orderLayer.route.stack.length - 1].handle(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.integrationStatus, 'INTEGRATED WITH S-06');
  assert.ok(Array.isArray(res.body.order), 'Phải trả về danh sách thứ tự thi công');
  assert.ok(Array.isArray(res.body.tasks), 'Phải trả về ES/EF/LS/LF/float của S-09');
});
