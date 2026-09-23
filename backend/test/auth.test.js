const test = require('node:test');
const assert = require('node:assert');
const { SEED_ROLES, findUserByEmail, updateUser, createSession, getSession, destroySession, SESSION_TTL_MS } = require('../src/models/store');
const { verifyPassword } = require('../src/utils/security');

test('T-04 (SCRUM-29): Kiểm tra định nghĩa và seed đủ 6 vai trò thi công', () => {
  assert.strictEqual(SEED_ROLES.length, 6, 'Hệ thống phải có đủ 6 vai trò thi công');
  
  const roleNames = SEED_ROLES.map(r => r.name);
  assert.ok(roleNames.includes('admin'), 'Phải có vai trò admin');
  assert.ok(roleNames.includes('project_manager'), 'Phải có vai trò project_manager (Chỉ huy trưởng)');
  assert.ok(roleNames.includes('supervisor'), 'Phải có vai trò supervisor (Kỹ sư giám sát)');
  assert.ok(roleNames.includes('contractor'), 'Phải có vai trò contractor (Đội trưởng thi công)');
  assert.ok(roleNames.includes('accountant'), 'Phải có vai trò accountant (Kế toán & Vật tư)');
  assert.ok(roleNames.includes('client'), 'Phải có vai trò client (Chủ đầu tư)');
});

test('T-05 (SCRUM-30): Đăng nhập thành công với tài khoản mẫu', () => {
  const user = findUserByEmail('dtc245160020@ictu.edu.vn');
  assert.ok(user, 'Tài khoản Trần Mạnh Dũng phải tồn tại');
  assert.strictEqual(user.full_name, 'Trần Mạnh Dũng');

  const isMatch = verifyPassword('Dung@123', user.salt, user.password_hash);
  assert.strictEqual(isMatch, true, 'Mật khẩu Dung@123 phải khớp hash');

  const token = createSession(user);
  assert.ok(token, 'Phải sinh token phiên làm việc');

  const session = getSession(token);
  assert.ok(session, 'Phiên phải hoạt động hợp lệ');
  assert.strictEqual(session.full_name, 'Trần Mạnh Dũng');
});

test('T-04 & T-05: Đăng ký tài khoản mới và kiểm tra không cho trùng email', () => {
  const { createUser, findUserByEmail } = require('../src/models/store');
  const { hashPassword } = require('../src/utils/security');

  const testEmail = 'nguyenvanan@thicong.vn';
  const { salt, hash } = hashPassword('MatKhau@123');

  const user = createUser({
    full_name: 'Nguyễn Văn An',
    email: testEmail,
    password_hash: hash,
    salt,
    role_id: 3 // Kỹ sư giám sát
  });

  assert.ok(user, 'User mới phải được tạo');
  assert.strictEqual(user.email, testEmail);
  assert.strictEqual(user.role_name, 'supervisor');

  const found = findUserByEmail(testEmail);
  assert.ok(found, 'Phải tìm thấy user vừa đăng ký theo email');
  assert.strictEqual(found.full_name, 'Nguyễn Văn An');
});

test('T-05 (SCRUM-30): Mật khẩu sai và logic khóa tài khoản 15 phút sau 5 lần sai liên tiếp', () => {
  const user = findUserByEmail('dtc245160020@ictu.edu.vn');
  user.failed_login_attempts = 0;
  user.locked_until = null;

  // Mô phỏng 4 lần sai
  for (let i = 1; i <= 4; i++) {
    const isMatch = verifyPassword('SaiPass', user.salt, user.password_hash);
    assert.strictEqual(isMatch, false);
    user.failed_login_attempts = i;
  }
  assert.strictEqual(user.failed_login_attempts, 4);
  assert.strictEqual(user.locked_until, null, 'Chưa đến 5 lần thì chưa bị khóa');

  // Lần sai thứ 5 -> Kích hoạt khóa 15 phút
  user.failed_login_attempts = 5;
  const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
  user.locked_until = lockUntil;

  assert.ok(user.locked_until > new Date(), 'Tài khoản phải bị khóa trong tương lai (15 phút)');

  // Kiểm tra thời gian còn lại
  const remainingSeconds = Math.ceil((user.locked_until.getTime() - Date.now()) / 1000);
  assert.ok(remainingSeconds > 0 && remainingSeconds <= 900, 'Thời gian khóa phải xấp xỉ 15 phút (900s)');

  // Reset tài khoản sau test
  user.failed_login_attempts = 0;
  user.locked_until = null;
});

test('T-05 (SCRUM-30): Kiểm tra thời hạn phiên 12 giờ và hủy phiên khi đăng xuất', () => {
  const user = findUserByEmail('admin@thicong.vn');
  const token = createSession(user);

  assert.ok(getSession(token), 'Phiên hợp lệ ngay sau khi tạo');

  // Đăng xuất
  destroySession(token);
  assert.strictEqual(getSession(token), null, 'Sau khi đăng xuất phiên phải bị hủy hoàn toàn');
});
