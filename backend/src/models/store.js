const { hashPassword } = require('../utils/security');

// 6 vai trò thi công xây dựng theo nhiệm vụ SCRUM-29 (T-04)
const SEED_ROLES = [
  { id: 1, name: 'admin', display_name: 'Quản trị viên hệ thống', description: 'Toàn quyền cấu hình hệ thống, phân quyền người dùng và duyệt dữ liệu' },
  { id: 2, name: 'project_manager', display_name: 'Chỉ huy trưởng công trình', description: 'Quản lý tiến độ dự án, phân công nhân lực, ký duyệt nhật ký thi công' },
  { id: 3, name: 'supervisor', display_name: 'Kỹ sư giám sát thi công', description: 'Giám sát kỹ thuật hiện trường, nghiệm thu công việc và ghi nhật ký' },
  { id: 4, name: 'contractor', display_name: 'Đội trưởng thi công', description: 'Tổ chức đội ngũ công nhân, báo cáo khối lượng thi công hàng ngày' },
  { id: 5, name: 'accountant', display_name: 'Kế toán & Quản lý vật tư', description: 'Kiểm soát ngân sách, xuất nhập kho vật liệu và thanh quyết toán' },
  { id: 6, name: 'client', display_name: 'Chủ đầu tư', description: 'Theo dõi tiến độ tổng thể, hình ảnh hiện trường và chất lượng công trình' }
];

// Khởi tạo hash mật khẩu mẫu
const adminHash = hashPassword('Admin@123');
const dungHash = hashPassword('Dung@123');

// Dữ liệu người dùng khởi tạo ban đầu
let inMemoryUsers = [
  {
    id: 1,
    email: 'admin@thicong.vn',
    password_hash: adminHash.hash,
    salt: adminHash.salt,
    full_name: 'Nguyễn Quản Trị',
    role_id: 1,
    role_name: 'admin',
    role_display_name: 'Quản trị viên hệ thống',
    failed_login_attempts: 0,
    locked_until: null,
    is_active: true
  },
  {
    id: 2,
    email: 'dtc245160020@ictu.edu.vn',
    password_hash: dungHash.hash,
    salt: dungHash.salt,
    full_name: 'Trần Mạnh Dũng',
    role_id: 2,
    role_name: 'project_manager',
    role_display_name: 'Chỉ huy trưởng công trình',
    failed_login_attempts: 0,
    locked_until: null,
    is_active: true
  }
];

// Bộ nhớ phiên đăng nhập (Session Store): token -> sessionData
// Hết hạn sau 12 giờ không hoạt động (12 hours inactivity)
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

function findUserByEmail(email) {
  if (!email) return null;
  const cleanEmail = email.trim().toLowerCase();
  return inMemoryUsers.find(u => u.email.toLowerCase() === cleanEmail) || null;
}

function updateUser(id, updates) {
  const user = inMemoryUsers.find(u => u.id === id);
  if (user) {
    Object.assign(user, updates);
  }
  return user;
}

function createSession(user) {
  const { generateSessionToken } = require('../utils/security');
  const token = generateSessionToken();
  const sessionData = {
    userId: user.id,
    email: user.email,
    full_name: user.full_name,
    role_id: user.role_id,
    role_name: user.role_name,
    role_display_name: user.role_display_name,
    last_activity: Date.now()
  };
  sessions.set(token, sessionData);
  return token;
}

function getSession(token) {
  if (!token || !sessions.has(token)) return null;
  const session = sessions.get(token);
  const now = Date.now();
  // Kiểm tra thời hạn 12 giờ không hoạt động
  if (now - session.last_activity > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  // Cập nhật lại thời gian hoạt động
  session.last_activity = now;
  return session;
}

function destroySession(token) {
  if (token) {
    sessions.delete(token);
  }
}

function createUser(userData) {
  const newId = inMemoryUsers.length > 0 ? Math.max(...inMemoryUsers.map(u => u.id)) + 1 : 1;
  const role = SEED_ROLES.find(r => r.id === parseInt(userData.role_id, 10)) || SEED_ROLES[1]; // mặc định Chỉ huy trưởng
  const newUser = {
    id: newId,
    email: userData.email.trim().toLowerCase(),
    password_hash: userData.password_hash,
    salt: userData.salt,
    full_name: userData.full_name.trim(),
    role_id: role.id,
    role_name: role.name,
    role_display_name: role.display_name,
    failed_login_attempts: 0,
    locked_until: null,
    is_active: true
  };
  inMemoryUsers.push(newUser);
  return newUser;
}

module.exports = {
  SEED_ROLES,
  findUserByEmail,
  updateUser,
  createUser,
  createSession,
  getSession,
  destroySession,
  SESSION_TTL_MS
};
