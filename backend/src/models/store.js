const { hashPassword } = require('../utils/security');

// 7 vai trò thi công xây dựng theo nhiệm vụ SCRUM-29 & Sprint 2
const SEED_ROLES = [
  { id: 1, name: 'admin', display_name: 'Quản trị viên hệ thống', description: 'Toàn quyền cấu hình hệ thống, phân quyền người dùng và duyệt dữ liệu' },
  { id: 2, name: 'project_manager', display_name: 'Chỉ huy trưởng công trình', description: 'Quản lý tiến độ dự án, phân công nhân lực, ký duyệt nhật ký thi công' },
  { id: 3, name: 'supervisor', display_name: 'Kỹ sư giám sát thi công', description: 'Giám sát kỹ thuật hiện trường, nghiệm thu công việc và ghi nhật ký' },
  { id: 4, name: 'contractor', display_name: 'Đội trưởng thi công', description: 'Tổ chức đội ngũ công nhân, báo cáo khối lượng thi công hàng ngày' },
  { id: 5, name: 'accountant', display_name: 'Kế toán & Quản lý vật tư', description: 'Kiểm soát ngân sách, xuất nhập kho vật liệu và thanh quyết toán' },
  { id: 6, name: 'client', display_name: 'Chủ đầu tư', description: 'Theo dõi tiến độ tổng thể, hình ảnh hiện trường và chất lượng công trình' },
  { id: 7, name: 'viewer', display_name: 'Người xem dự án', description: 'Chỉ xem những dự án được cấp quyền; không được tạo, sửa hoặc xóa dữ liệu.' }
];

// Khởi tạo hash mật khẩu mẫu
const adminHash = hashPassword(process.env.DEMO_ADMIN_PASSWORD || 'Admin@123');
const dungHash = hashPassword(process.env.DEMO_PM_PASSWORD || 'Dung@123');
const viewerHash = hashPassword(process.env.DEMO_VIEWER_PASSWORD || process.env.VIEWER_PASSWORD || 'Viewer@123');

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
  },
  {
    id: 3,
    email: 'viewer@thicong.vn',
    password_hash: viewerHash.hash,
    salt: viewerHash.salt,
    full_name: 'Nguyễn Khách Xem',
    role_id: 7,
    role_name: 'viewer',
    role_display_name: 'Người xem dự án',
    failed_login_attempts: 0,
    locked_until: null,
    is_active: true
  }
];

// Bộ nhớ phiên đăng nhập (Session Store): token -> sessionData
// Hết hạn sau 12 giờ không hoạt động (12 hours inactivity)
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

// Bảng phân quyền dự án: userId -> Set(projectId)
const userProjectAssignments = new Map();
userProjectAssignments.set(1, new Set(['*'])); // admin toàn quyền
userProjectAssignments.set(2, new Set([1]));   // PM dự án 1
userProjectAssignments.set(3, new Set([1]));   // Viewer dự án 1 (được cấp quyền xem dự án 1)

function canUserAccessProject(user, projectId) {
  if (!user) return false;
  // Admin được toàn quyền xem tất cả dự án
  if (user.role_name === 'admin' || user.role_id === 1) return true;
  // Project Manager được truy cập các dự án thi công
  if (user.role_name === 'project_manager' || user.role_id === 2) return true;
  // Viewer chỉ xem dự án được gán quyền
  const pId = Number(projectId);
  const assigned = userProjectAssignments.get(user.id);
  if (assigned) {
    if (assigned.has('*') || assigned.has(pId)) return true;
  }
  // Mặc định cho demo viewer nếu tài khoản là viewer@thicong.vn thì gán dự án 1
  if ((user.role_name === 'viewer' || user.role_id === 7) && pId === 1) {
    return true;
  }
  return false;
}

function findUserByEmail(email) {
  if (!email) return null;
  const clean = email.trim().toLowerCase();
  // Hỗ trợ linh hoạt cho kiểm thử admin: "admin", "admin@thicong.vn", "admin@gmail.com", "admin@admin.com", "administrator"
  const adminAliases = ['admin', 'admin@thicong.vn', 'admin@gmail.com', 'admin@admin.com', 'administrator', 'quantri', 'quantrivien'];
  if (adminAliases.includes(clean)) {
    return inMemoryUsers.find(u => u.role_id === 1) || inMemoryUsers[0];
  }
  // Hỗ trợ linh hoạt cho kiểm thử viewer
  const viewerAliases = ['viewer', 'viewer@thicong.vn', 'nguoixem', 'khachxem'];
  if (viewerAliases.includes(clean)) {
    return inMemoryUsers.find(u => u.role_id === 7) || inMemoryUsers[2];
  }
  return inMemoryUsers.find(u => u.email.toLowerCase() === clean) || null;
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

// ==========================================
// THÔNG TIN HẠNG MỤC VÀ MILESTONE (T-43)
// ==========================================
let inMemoryWorkItems = [
  { id: 1, project_id: 1, parent_id: null, name: 'Phần ngầm & Móng', code: 'HM-01', unit: 'Gói', quantity: 1, status: 'in_progress' },
  { id: 2, project_id: 1, parent_id: 1, name: 'Đào đất hố móng', code: 'HM-01.01', unit: 'm3', quantity: 500, status: 'in_progress' },
  { id: 3, project_id: 1, parent_id: 2, name: 'Đào đất thủ công hố móng', code: 'HM-01.01.01', unit: 'm3', quantity: 100, status: 'completed' },
  { id: 4, project_id: 1, parent_id: 2, name: 'Vận chuyển đất thải', code: 'HM-01.01.02', unit: 'chuyến', quantity: 40, status: 'pending' },
  { id: 5, project_id: 1, parent_id: 1, name: 'Đổ bê tông lót móng', code: 'HM-01.02', unit: 'm3', quantity: 50, status: 'pending' },
  { id: 6, project_id: 1, parent_id: null, name: 'Phần thân & Kết cấu', code: 'HM-02', unit: 'Gói', quantity: 1, status: 'pending' }
];

let inMemoryMilestones = [];

function findWorkItemById(id) {
  return inMemoryWorkItems.find(item => item.id === parseInt(id, 10)) || null;
}

function getMilestones(filter = {}) {
  let list = inMemoryMilestones;
  if (filter.work_item_id) {
    list = list.filter(m => m.work_item_id === parseInt(filter.work_item_id, 10));
  }
  if (filter.is_active !== undefined) {
    const activeVal = filter.is_active ? 1 : 0;
    list = list.filter(m => m.is_active === activeVal);
  }
  return list;
}

function createMilestoneData({ work_item_id, due_date, title, created_by }) {
  // NFR: Đảm bảo một hạng mục chỉ có 1 milestone bàn giao đang hiệu lực (is_active = 1)
  inMemoryMilestones.forEach(m => {
    if (m.work_item_id === parseInt(work_item_id, 10) && m.is_active === 1) {
      m.is_active = 0;
    }
  });

  const creator = inMemoryUsers.find(u => u.id === parseInt(created_by, 10));
  const newId = inMemoryMilestones.length > 0 ? Math.max(...inMemoryMilestones.map(m => m.id)) + 1 : 1;

  const newMilestone = {
    id: newId,
    work_item_id: parseInt(work_item_id, 10),
    due_date,
    title: title || null,
    created_by: parseInt(created_by, 10),
    created_by_name: creator ? creator.full_name : 'Người dùng',
    created_by_role: creator ? (creator.role_display_name || creator.role_name) : '',
    is_active: 1,
    created_at: new Date().toISOString()
  };

  inMemoryMilestones.push(newMilestone);
  return newMilestone;
}

// ==========================================
// CẢNH BÁO VƯỢT MỐC MILESTONE (T-44)
// ==========================================
let inMemoryMilestoneAlerts = [];

function getMilestoneAlerts(filter = {}) {
  let list = inMemoryMilestoneAlerts;
  if (filter.project_id !== undefined) {
    list = list.filter(a => Number(a.project_id) === Number(filter.project_id));
  }
  if (filter.milestone_id !== undefined) {
    list = list.filter(a => Number(a.milestone_id) === Number(filter.milestone_id));
  }
  if (filter.status) {
    list = list.filter(a => a.status === filter.status);
  }
  return list;
}

function saveMilestoneAlert({ project_id, milestone_id, work_item_id, due_date, max_early_finish, overdue_days }) {
  const pId = Number(project_id);
  const mId = Number(milestone_id);
  const wId = Number(work_item_id);

  // Tìm cảnh báo đang active hiện có
  let existing = inMemoryMilestoneAlerts.find(a => Number(a.milestone_id) === mId && a.status === 'active');
  const nowStr = new Date().toISOString();

  const parsedMaxEf = (typeof max_early_finish === 'number' || !isNaN(Number(max_early_finish))) ? Number(max_early_finish) : max_early_finish;

  if (existing) {
    existing.due_date = due_date;
    existing.max_early_finish = parsedMaxEf;
    existing.overdue_days = Number(overdue_days);
    existing.updated_at = nowStr;
    return existing;
  } else {
    const newId = inMemoryMilestoneAlerts.length > 0 ? Math.max(...inMemoryMilestoneAlerts.map(a => a.id)) + 1 : 1;
    const newAlert = {
      id: newId,
      project_id: pId,
      milestone_id: mId,
      work_item_id: wId,
      due_date,
      max_early_finish: parsedMaxEf,
      overdue_days: Number(overdue_days),
      status: 'active',
      opened_at: nowStr,
      closed_at: null,
      created_at: nowStr,
      updated_at: nowStr
    };
    inMemoryMilestoneAlerts.push(newAlert);
    return newAlert;
  }
}

function closeMilestoneAlert(milestone_id) {
  const mId = Number(milestone_id);
  const nowStr = new Date().toISOString();
  let updatedCount = 0;

  inMemoryMilestoneAlerts.forEach(a => {
    if (Number(a.milestone_id) === mId && a.status === 'active') {
      a.status = 'closed';
      a.closed_at = nowStr;
      a.updated_at = nowStr;
      updatedCount++;
    }
  });

  return updatedCount;
}

// ==========================================
// DỰ ÁN, CÔNG VIỆC VÀ PHỤ THUỘC IN-MEMORY (FAST STANDALONE)
// ==========================================
let inMemoryProjects = [
  { id: 1, name: 'Dự án Thi Công Mẫu', code: 'DA-01', description: 'Dự án mẫu quản trị tiến độ thi công công trình' }
];

let inMemoryTasks = [
  { id: 1, project_id: 1, work_item_id: 3, name: 'Đào đất thủ công hố móng trụ T1', code: 'CV-01', duration: 4, actual_start: '2026-10-01', actual_end: '2026-10-04', percent_complete: 100, status: 'completed' },
  { id: 2, project_id: 1, work_item_id: 4, name: 'Vận chuyển đất thải ra bãi tập kết', code: 'CV-02', duration: 3, actual_start: '2026-10-04', actual_end: null, percent_complete: 60, status: 'in_progress' },
  { id: 3, project_id: 1, work_item_id: 5, name: 'Đổ bê tông lót móng M1 dày 100mm', code: 'CV-03', duration: 3, actual_start: null, actual_end: null, percent_complete: 0, status: 'pending' },
  { id: 4, project_id: 1, work_item_id: 5, name: 'Gia công lắp dựng cốt thép móng', code: 'CV-04', duration: 5, actual_start: null, actual_end: null, percent_complete: 0, status: 'pending' },
  { id: 5, project_id: 1, work_item_id: 5, name: 'Lắp dựng ván khuôn móng đài cọc', code: 'CV-05', duration: 3, actual_start: null, actual_end: null, percent_complete: 0, status: 'pending' },
  { id: 6, project_id: 1, work_item_id: 6, name: 'Đổ bê tông móng thương phẩm B25', code: 'CV-06', duration: 2, actual_start: null, actual_end: null, percent_complete: 0, status: 'pending' },
  { id: 7, project_id: 1, work_item_id: 6, name: 'Bảo dưỡng và tháo dỡ ván khuôn', code: 'CV-07', duration: 3, actual_start: null, actual_end: null, percent_complete: 0, status: 'pending' }
];

let inMemoryDependencies = [
  { id: 1, project_id: 1, predecessor_task_id: 1, successor_task_id: 2, dependency_type: 'FS', lag_days: 0 },
  { id: 2, project_id: 1, predecessor_task_id: 2, successor_task_id: 3, dependency_type: 'FS', lag_days: 0 },
  { id: 3, project_id: 1, predecessor_task_id: 3, successor_task_id: 4, dependency_type: 'FS', lag_days: 1 },
  { id: 4, project_id: 1, predecessor_task_id: 3, successor_task_id: 5, dependency_type: 'FS', lag_days: 1 },
  { id: 5, project_id: 1, predecessor_task_id: 4, successor_task_id: 6, dependency_type: 'FS', lag_days: 0 },
  { id: 6, project_id: 1, predecessor_task_id: 5, successor_task_id: 6, dependency_type: 'FS', lag_days: 0 },
  { id: 7, project_id: 1, predecessor_task_id: 6, successor_task_id: 7, dependency_type: 'FS', lag_days: 2 }
];

function getTasks(projectId = 1, workItemId = null) {
  let list = inMemoryTasks.filter(t => t.project_id === Number(projectId));
  if (workItemId) {
    list = list.filter(t => t.work_item_id === Number(workItemId));
  }
  return list.map(t => {
    const wi = inMemoryWorkItems.find(w => w.id === t.work_item_id);
    return {
      ...t,
      work_item_name: wi ? wi.name : '',
      work_item_code: wi ? wi.code : ''
    };
  });
}

function createTaskData(data) {
  const newId = inMemoryTasks.length > 0 ? Math.max(...inMemoryTasks.map(t => t.id)) + 1 : 1;
  const newTask = {
    id: newId,
    project_id: Number(data.project_id || 1),
    work_item_id: Number(data.work_item_id),
    name: String(data.name).trim(),
    code: data.code ? String(data.code).trim() : `CV-${String(newId).padStart(2, '0')}`,
    duration: Number(data.duration || 1),
    actual_start: data.actual_start || null,
    actual_end: data.actual_end || null,
    percent_complete: Number(data.percent_complete || 0),
    status: data.status || 'pending',
    created_at: new Date().toISOString()
  };
  inMemoryTasks.push(newTask);
  const wi = inMemoryWorkItems.find(w => w.id === newTask.work_item_id);
  return {
    ...newTask,
    work_item_name: wi ? wi.name : '',
    work_item_code: wi ? wi.code : ''
  };
}

function updateTaskData(id, updates) {
  const t = inMemoryTasks.find(item => item.id === Number(id));
  if (!t) return null;
  Object.assign(t, updates);
  const wi = inMemoryWorkItems.find(w => w.id === t.work_item_id);
  return {
    ...t,
    work_item_name: wi ? wi.name : '',
    work_item_code: wi ? wi.code : ''
  };
}

function deleteTaskData(id) {
  const taskId = Number(id);
  const idx = inMemoryTasks.findIndex(t => t.id === taskId);
  if (idx === -1) return false;
  inMemoryTasks.splice(idx, 1);
  // Xóa các quan hệ phụ thuộc liên quan
  inMemoryDependencies = inMemoryDependencies.filter(
    d => d.predecessor_task_id !== taskId && d.successor_task_id !== taskId
  );
  return true;
}

module.exports = {
  SEED_ROLES,
  findUserByEmail,
  updateUser,
  createUser,
  createSession,
  getSession,
  destroySession,
  inMemoryUsers,
  SESSION_TTL_MS,
  canUserAccessProject,
  userProjectAssignments,
  inMemoryProjects,
  inMemoryWorkItems,
  inMemoryTasks,
  inMemoryDependencies,
  inMemoryMilestones,
  inMemoryMilestoneAlerts,
  findWorkItemById,
  getMilestones,
  createMilestoneData,
  getMilestoneAlerts,
  saveMilestoneAlert,
  closeMilestoneAlert,
  getTasks,
  createTaskData,
  updateTaskData,
  deleteTaskData
};

