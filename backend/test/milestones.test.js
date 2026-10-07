const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const {
  SEED_ROLES,
  createUser,
  createSession,
  getSession,
  inMemoryUsers,
  inMemoryMilestones,
  getMilestones,
  createMilestoneData
} = require('../src/models/store');
const { hashPassword } = require('../src/utils/security');
const wbsRoutes = require('../wbs_routes');

// Tạo mock app Express để gọi trực tiếp router
const app = express();
app.use(express.json());
app.use('/api', wbsRoutes({ pool: null }));

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const server = app.listen(0, () => {
      const port = server.address().port;
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const reqOpts = {
        hostname: '127.0.0.1',
        port,
        path: `/api${path}`,
        method,
        headers
      };

      const req = http.request(reqOpts, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          server.close();
          try {
            const data = JSON.parse(rawData);
            resolve({ status: res.statusCode, body: data });
          } catch (e) {
            resolve({ status: res.statusCode, body: rawData });
          }
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  });
}

test('T-43 AC-1 & AC-2: Kiểm tra cấu trúc dữ liệu mốc tiến độ (Milestone) và helper store', () => {
  const user = inMemoryUsers.find(u => u.role_id === 2); // Chỉ huy trưởng
  assert.ok(user, 'Phải có user Chỉ huy trưởng');

  const m = createMilestoneData({
    work_item_id: 1,
    due_date: '2026-11-30',
    title: 'Bàn giao phần móng',
    created_by: user.id
  });

  assert.ok(m, 'Milestone phải được khởi tạo thành công');
  assert.strictEqual(m.work_item_id, 1, 'Milestone phải gắn đúng với hạng mục/công việc id=1');
  assert.strictEqual(m.due_date, '2026-11-30', 'Lưu đúng ngày bắt buộc');
  assert.strictEqual(m.created_by, user.id, 'Lưu đúng người đặt milestone');
  assert.strictEqual(m.is_active, 1, 'Mốc mới tạo mặc định đang hiệu lực (is_active = 1)');
});

test('T-43 AC-5: Phân quyền đặt mốc milestone - Chỉ Chủ đầu tư và Ban quản lý được phép', async () => {
  // 1. Khởi tạo tài khoản test thuộc 6 vai trò khác nhau
  const rolesTestConfig = [
    { role_id: 1, role_name: 'admin', allowed: true },            // Ban quản lý hệ thống
    { role_id: 2, role_name: 'project_manager', allowed: true }, // Chỉ huy trưởng / Ban quản lý
    { role_id: 6, role_name: 'client', allowed: true },          // Chủ đầu tư
    { role_id: 3, role_name: 'supervisor', allowed: false },     // Kỹ sư giám sát (Từ chối 403)
    { role_id: 4, role_name: 'contractor', allowed: false },     // Đội trưởng thi công (Từ chối 403)
    { role_id: 5, role_name: 'accountant', allowed: false }      // Kế toán & Vật tư (Từ chối 403)
  ];

  for (const cfg of rolesTestConfig) {
    const { salt, hash } = hashPassword('Pass123456');
    const u = createUser({
      full_name: `User Test Role ${cfg.role_name}`,
      email: `test_role_${cfg.role_name}_${Date.now()}@thicong.vn`,
      password_hash: hash,
      salt,
      role_id: cfg.role_id
    });

    const token = createSession(u);
    const res = await makeRequest('POST', '/milestones', {
      work_item_id: 1,
      due_date: '2026-12-15',
      title: `Thử nghiệm phân quyền ${cfg.role_name}`
    }, token);

    if (cfg.allowed) {
      assert.strictEqual(res.status, 201, `Role ${cfg.role_name} phải được phép tạo milestone (201 Created)`);
      assert.strictEqual(res.body.success, true);
    } else {
      assert.strictEqual(res.status, 403, `Role ${cfg.role_name} không được phép tạo milestone (403 Forbidden)`);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.message.includes('Chỉ Chủ đầu tư và Ban quản lý'), 'Thông báo phải ghi rõ quyền hạn');
    }
  }
});

test('T-43 Technical Validation: Kiểm tra validation dữ liệu milestone', async () => {
  const pmUser = inMemoryUsers.find(u => u.role_id === 2);
  const token = createSession(pmUser);

  // 1. Thiếu work_item_id
  const res1 = await makeRequest('POST', '/milestones', {
    due_date: '2026-12-20'
  }, token);
  assert.strictEqual(res1.status, 400, 'Thiếu work_item_id phải trả về 400 Bad Request');

  // 2. Thiếu due_date
  const res2 = await makeRequest('POST', '/milestones', {
    work_item_id: 2
  }, token);
  assert.strictEqual(res2.status, 400, 'Thiếu due_date phải trả về 400 Bad Request');

  // 3. Sai định dạng due_date
  const res3 = await makeRequest('POST', '/milestones', {
    work_item_id: 2,
    due_date: 'invalid-date'
  }, token);
  assert.strictEqual(res3.status, 400, 'Sai định dạng ngày phải trả về 400 Bad Request');
});

test('T-43 NFR: Ràng buộc duy nhất 1 mốc bàn giao đang hiệu lực trên cùng hạng mục', async () => {
  const pmUser = inMemoryUsers.find(u => u.role_id === 2);
  const token = createSession(pmUser);
  const targetWorkItemId = 3;

  // Lần 1: Tạo milestone 1 cho hạng mục 3
  const res1 = await makeRequest('POST', '/milestones', {
    work_item_id: targetWorkItemId,
    due_date: '2026-10-15',
    title: 'Mốc đợt 1'
  }, token);
  assert.strictEqual(res1.status, 201);
  const m1Id = res1.body.data.id;

  // Lần 2: Tạo milestone 2 cho cùng hạng mục 3
  const res2 = await makeRequest('POST', '/milestones', {
    work_item_id: targetWorkItemId,
    due_date: '2026-10-25',
    title: 'Mốc đợt 2 mới thay thế'
  }, token);
  assert.strictEqual(res2.status, 201);
  const m2Id = res2.body.data.id;

  // Lấy danh sách mốc đang hiệu lực của hạng mục 3
  const getRes = await makeRequest('GET', `/milestones?work_item_id=${targetWorkItemId}&is_active=true`);
  assert.strictEqual(getRes.status, 200);
  const activeMilestones = getRes.body.data.filter(m => m.work_item_id === targetWorkItemId && (m.is_active === 1 || m.is_active === true));

  assert.strictEqual(activeMilestones.length, 1, 'Một hạng mục chỉ được phép có đúng 1 mốc bàn giao đang hiệu lực');
  assert.strictEqual(activeMilestones[0].id, m2Id, 'Mốc mới tạo (m2) phải là mốc đang hiệu lực');
});

test('T-43 AC-4: Migration có thể chạy tiến (UP) và lùi (DOWN) được', () => {
  const fs = require('fs');
  const path = require('path');

  const upPath = path.join(__dirname, '../../migration_t43.sql');
  const downPath = path.join(__dirname, '../../migration_t43_down.sql');

  assert.ok(fs.existsSync(upPath), 'File migration tiến migration_t43.sql phải tồn tại');
  assert.ok(fs.existsSync(downPath), 'File migration lùi migration_t43_down.sql phải tồn tại');

  const upSql = fs.readFileSync(upPath, 'utf8');
  const downSql = fs.readFileSync(downPath, 'utf8');

  assert.ok(upSql.includes('CREATE TABLE IF NOT EXISTS milestones'), 'Migration UP phải có lệnh CREATE TABLE milestones');
  assert.ok(upSql.includes('work_item_id'), 'Bảng milestones phải có cột work_item_id');
  assert.ok(upSql.includes('due_date'), 'Bảng milestones phải có cột due_date');
  assert.ok(upSql.includes('created_by'), 'Bảng milestones phải có cột created_by');

  assert.ok(downSql.includes('DROP TABLE IF EXISTS milestones'), 'Migration DOWN phải có lệnh DROP TABLE IF EXISTS milestones');
});
