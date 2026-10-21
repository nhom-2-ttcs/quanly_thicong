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

// Bảng thành viên dự án in-memory
let inMemoryProjectMembers = [
  { project_id: 1, user_id: 1, role_id: 1, role_name: 'admin', role_display_name: 'Quản trị viên hệ thống', created_at: '2026-10-01 08:00:00' },
  { project_id: 1, user_id: 2, role_id: 2, role_name: 'project_manager', role_display_name: 'Chỉ huy trưởng công trình', created_at: '2026-10-01 08:00:00' },
  { project_id: 1, user_id: 3, role_id: 7, role_name: 'viewer', role_display_name: 'Người xem dự án', created_at: '2026-10-01 08:00:00' }
];

// Danh sách lời mời tham gia dự án in-memory
let inMemoryProjectInvitations = [];

function getProjectMembers(projectId) {
  const pId = Number(projectId);
  return inMemoryProjectMembers
    .filter(m => m.project_id === pId)
    .map(m => {
      const u = inMemoryUsers.find(user => user.id === m.user_id) || {};
      const role = SEED_ROLES.find(r => r.id === m.role_id) || {};
      return {
        project_id: m.project_id,
        user_id: m.user_id,
        email: u.email || '',
        full_name: u.full_name || '',
        role_id: m.role_id,
        role_name: role.name || m.role_name || '',
        role_display_name: role.display_name || m.role_display_name || '',
        created_at: m.created_at || new Date().toISOString()
      };
    });
}

function findProjectMember(projectId, userId) {
  const pId = Number(projectId);
  const uId = Number(userId);
  return inMemoryProjectMembers.find(m => m.project_id === pId && m.user_id === uId) || null;
}

function countProjectManagers(projectId) {
  const pId = Number(projectId);
  return inMemoryProjectMembers.filter(m => m.project_id === pId && (m.role_id === 2 || m.role_name === 'project_manager')).length;
}

function addProjectMember({ projectId, userId, roleId }) {
  const pId = Number(projectId);
  const uId = Number(userId);
  const rId = Number(roleId) || 4;
  const role = SEED_ROLES.find(r => r.id === rId) || { id: 4, name: 'contractor', display_name: 'Đội trưởng thi công' };

  const existing = findProjectMember(pId, uId);
  if (existing) {
    existing.role_id = rId;
    existing.role_name = role.name;
    existing.role_display_name = role.display_name;
    return existing;
  }

  const member = {
    project_id: pId,
    user_id: uId,
    role_id: rId,
    role_name: role.name,
    role_display_name: role.display_name,
    created_at: new Date().toISOString()
  };
  inMemoryProjectMembers.push(member);

  let assigned = userProjectAssignments.get(uId);
  if (!assigned) {
    assigned = new Set();
    userProjectAssignments.set(uId, assigned);
  }
  assigned.add(pId);

  return member;
}

function updateProjectMemberRole({ projectId, userId, roleId }) {
  const member = findProjectMember(projectId, userId);
  if (!member) return null;
  const rId = Number(roleId);
  const role = SEED_ROLES.find(r => r.id === rId) || { id: rId, name: 'member', display_name: 'Thành viên' };
  member.role_id = rId;
  member.role_name = role.name;
  member.role_display_name = role.display_name;
  return member;
}

function removeProjectMember({ projectId, userId }) {
  const pId = Number(projectId);
  const uId = Number(userId);
  const idx = inMemoryProjectMembers.findIndex(m => m.project_id === pId && m.user_id === uId);
  if (idx === -1) return false;
  inMemoryProjectMembers.splice(idx, 1);

  const assigned = userProjectAssignments.get(uId);
  if (assigned) {
    assigned.delete(pId);
  }
  return true;
}

function getProjectInvitations(projectId) {
  const pId = Number(projectId);
  return inMemoryProjectInvitations.filter(i => i.project_id === pId && i.status === 'pending');
}

function findPendingInvitation(email, projectId = null) {
  if (!email) return null;
  const clean = email.trim().toLowerCase();
  return inMemoryProjectInvitations.find(i => 
    i.email.toLowerCase() === clean && 
    i.status === 'pending' &&
    (!projectId || i.project_id === Number(projectId))
  ) || null;
}

function createProjectInvitation({ projectId, email, roleId, invitedBy, token = null }) {
  const pId = Number(projectId);
  const clean = email.trim().toLowerCase();
  const rId = Number(roleId) || 4;
  const newId = inMemoryProjectInvitations.length > 0 ? Math.max(...inMemoryProjectInvitations.map(i => i.id)) + 1 : 1;

  const inv = {
    id: newId,
    project_id: pId,
    email: clean,
    role_id: rId,
    invited_by: invitedBy ? Number(invitedBy) : null,
    status: 'pending',
    token: token || null,
    created_at: new Date().toISOString()
  };
  inMemoryProjectInvitations.push(inv);
  return inv;
}

function acceptProjectInvitation(email, userId) {
  if (!email) return [];
  const clean = email.trim().toLowerCase();
  const accepted = [];
  for (const inv of inMemoryProjectInvitations) {
    if (inv.email.toLowerCase() === clean && inv.status === 'pending') {
      inv.status = 'accepted';
      addProjectMember({
        projectId: inv.project_id,
        userId,
        roleId: inv.role_id
      });
      accepted.push(inv);
    }
  }
  return accepted;
}

function isUserProjectManager(user, projectId) {
  if (!user) return false;
  if (user.role_name === 'admin' || user.role_id === 1) return true;
  const pId = Number(projectId);
  const uId = user.id || user.userId;
  const member = findProjectMember(pId, uId);
  if (member && (member.role_id === 2 || member.role_name === 'project_manager')) {
    return true;
  }
  if (user.role_name === 'project_manager' || user.role_id === 2) {
    const assigned = userProjectAssignments.get(uId);
    if (assigned && (assigned.has('*') || assigned.has(pId))) {
      return true;
    }
  }
  return false;
}

function canUserAccessProject(user, projectId) {
  if (!user) return false;
  // Admin được toàn quyền xem tất cả dự án
  if (user.role_name === 'admin' || user.role_id === 1) return true;
  const pId = Number(projectId);
  const uId = user.id || user.userId;

  // Kiểm tra bảng gán quyền userProjectAssignments
  const assigned = userProjectAssignments.get(uId);
  if (assigned) {
    if (assigned.has('*') || assigned.has(pId)) return true;
  }

  // Kiểm tra bảng thành viên inMemoryProjectMembers
  if (inMemoryProjectMembers.some(m => m.project_id === pId && m.user_id === uId)) {
    return true;
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
    id: user.id,
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
    password_hash: userData.password_hash || '',
    salt: userData.salt || '',
    full_name: (userData.full_name || userData.email.split('@')[0]).trim(),
    role_id: role.id,
    role_name: role.name,
    role_display_name: role.display_name,
    failed_login_attempts: 0,
    locked_until: null,
    must_set_password: Boolean(userData.must_set_password),
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
// NHẬT KÝ CÔNG TRƯỜNG & NGÀY MƯA (T50 / T51 - S-22)
// ==========================================
let inMemorySiteDiaries = [];

function getSiteDiaries(filter = {}) {
  let list = [...inMemorySiteDiaries];
  if (filter.project_id !== undefined) {
    list = list.filter(d => Number(d.project_id) === Number(filter.project_id));
  }
  if (filter.date) {
    list = list.filter(d => d.diary_date === filter.date);
  }
  if (filter.start_date && filter.end_date) {
    list = list.filter(d => d.diary_date >= filter.start_date && d.diary_date <= filter.end_date);
  }
  if (filter.is_rain_day !== undefined) {
    const isRain = Boolean(filter.is_rain_day);
    list = list.filter(d => Boolean(d.is_rain_day) === isRain);
  }
  return list.sort((a, b) => a.diary_date.localeCompare(b.diary_date));
}

function getSiteDiaryByDate(projectId, date) {
  const pId = Number(projectId);
  return inMemorySiteDiaries.find(d => Number(d.project_id) === pId && d.diary_date === date) || null;
}

let inMemoryAuditLogs = [];
function logAudit({ userId, action, resourceType, resourceId, reason }) {
  const newId = inMemoryAuditLogs.length > 0 ? Math.max(...inMemoryAuditLogs.map(l => l.id)) + 1 : 1;
  const entry = {
    id: newId,
    user_id: Number(userId || 1),
    action: String(action),
    resource_type: String(resourceType),
    resource_id: String(resourceId),
    reason: String(reason || ''),
    created_at: new Date().toISOString()
  };
  inMemoryAuditLogs.push(entry);
  return entry;
}

function getAuditLogs({ resourceType, resourceId } = {}) {
  let list = [...inMemoryAuditLogs];
  if (resourceType) list = list.filter(l => l.resource_type === resourceType);
  if (resourceId) list = list.filter(l => String(l.resource_id) === String(resourceId));
  return list;
}

let inMemoryDiaryConflicts = [];
function saveDiaryConflict({ projectId, entityType, entityId, serverVersion, clientVersion, serverData, clientData, conflictFields, autoMerged = false, mergedData = null }) {
  const newId = inMemoryDiaryConflicts.length > 0 ? Math.max(...inMemoryDiaryConflicts.map(c => c.id)) + 1 : 1;
  const conflict = {
    id: newId,
    project_id: Number(projectId),
    entity_type: entityType,
    entity_id: Number(entityId),
    server_version: Number(serverVersion),
    client_version: Number(clientVersion),
    server_data: serverData,
    client_data: clientData,
    conflict_fields: conflictFields || [],
    auto_merged: autoMerged ? 1 : 0,
    merged_data: mergedData || null,
    status: autoMerged ? 'resolved_merged' : 'pending',
    resolved_by: autoMerged ? 1 : null,
    resolved_at: autoMerged ? new Date().toISOString() : null,
    created_at: new Date().toISOString()
  };
  inMemoryDiaryConflicts.push(conflict);
  return conflict;
}

function getDiaryConflicts(projectId, status = null) {
  const pId = Number(projectId);
  let list = inMemoryDiaryConflicts.filter(c => c.project_id === pId);
  if (status) list = list.filter(c => c.status === status);
  return list;
}

function getDiaryConflictById(id) {
  const cId = Number(id);
  return inMemoryDiaryConflicts.find(c => c.id === cId) || null;
}

function resolveDiaryConflict(id, resolution, resolvedBy = 1) {
  const conflict = getDiaryConflictById(id);
  if (!conflict) return null;
  conflict.status = resolution.status || 'resolved_client';
  conflict.resolved_by = Number(resolvedBy || 1);
  conflict.resolved_at = new Date().toISOString();
  if (resolution.mergedData) {
    conflict.merged_data = resolution.mergedData;
  }
  return conflict;
}

function saveSiteDiaryEntry({
  project_id,
  diary_date,
  client_diary_id = null,
  weather_condition = 'sunny',
  is_rain_day = false,
  temperature_min = null,
  temperature_max = null,
  weather_notes = '',
  manpower_count = 0,
  equipment_status = '',
  work_notes = '',
  created_by = 1
}) {
  const pId = Number(project_id);
  const nowStr = new Date().toISOString();

  // S-30: Ràng buộc idempotency - Nếu đã có bản ghi cùng client_diary_id thì trả về luôn bản ghi cũ (không tạo trùng)
  if (client_diary_id) {
    const existingByClient = inMemorySiteDiaries.find(d => Number(d.project_id) === pId && d.client_diary_id === String(client_diary_id));
    if (existingByClient) {
      return existingByClient;
    }
  }

  // Kiểm tra khóa sổ (S-24)
  const existing = inMemorySiteDiaries.find(d => Number(d.project_id) === pId && d.diary_date === diary_date);
  if (existing && (existing.is_locked === 1 || existing.is_locked === true)) {
    const err = new Error('Nhật ký của ngày này đã bị khóa sổ, không thể chỉnh sửa.');
    err.status = 423;
    throw err;
  }

  // Tự động suy luận is_rain_day nếu weather_condition là rain_all_day
  const calculatedIsRain = weather_condition === 'rain_all_day' || Boolean(is_rain_day);

  if (existing) {
    existing.weather_condition = weather_condition;
    existing.is_rain_day = calculatedIsRain ? 1 : 0;
    existing.temperature_min = temperature_min;
    existing.temperature_max = temperature_max;
    existing.weather_notes = weather_notes;
    existing.manpower_count = Number(manpower_count || 0);
    existing.equipment_status = equipment_status;
    existing.work_notes = work_notes;
    existing.version = (existing.version || 1) + 1; // S-32: Tăng phiên bản khi sửa
    existing.updated_at = nowStr;
    return existing;
  } else {
    const newId = inMemorySiteDiaries.length > 0 ? Math.max(...inMemorySiteDiaries.map(d => d.id)) + 1 : 1;
    const newEntry = {
      id: newId,
      project_id: pId,
      diary_date,
      client_diary_id: client_diary_id ? String(client_diary_id) : null,
      weather_condition,
      is_rain_day: calculatedIsRain ? 1 : 0,
      temperature_min,
      temperature_max,
      weather_notes,
      manpower_count: Number(manpower_count || 0),
      equipment_status,
      work_notes,
      is_locked: 0,
      locked_at: null,
      locked_by: null,
      version: 1, // S-32: Phiên bản khởi tạo
      created_by: Number(created_by || 1),
      created_at: nowStr,
      updated_at: nowStr
    };
    inMemorySiteDiaries.push(newEntry);
    return newEntry;
  }
}

function lockSiteDiary(projectId, date, userId) {
  const diary = getSiteDiaryByDate(projectId, date);
  if (!diary) {
    const err = new Error('Không tìm thấy nhật ký của ngày này để khóa sổ.');
    err.status = 404;
    throw err;
  }
  diary.is_locked = 1;
  diary.locked_at = new Date().toISOString();
  diary.locked_by = Number(userId || 1);
  return diary;
}

function unlockSiteDiary(projectId, date, userId, reason) {
  const diary = getSiteDiaryByDate(projectId, date);
  if (!diary) {
    const err = new Error('Không tìm thấy nhật ký của ngày này để mở khóa.');
    err.status = 404;
    throw err;
  }
  diary.is_locked = 0;
  diary.locked_at = null;
  diary.locked_by = null;
  logAudit({
    userId,
    action: 'UNLOCK_DIARY',
    resourceType: 'site_diaries',
    resourceId: `${projectId}_${date}`,
    reason
  });
  return diary;
}

let inMemorySiteDiaryPhotos = [];
let inMemorySiteDiaryItems = [];

function getSiteDiaryPhotos(diaryId) {
  const dId = Number(diaryId);
  return inMemorySiteDiaryPhotos.filter(p => Number(p.diary_id) === dId);
}

function saveSiteDiaryPhoto({
  diary_id,
  file_name,
  file_path = '',
  file_size = 0,
  mime_type = 'image/jpeg',
  caption = '',
  upload_status = 'completed',
  client_photo_id = null,
  temp_path = null,
  taken_at = null,
  latitude = null,
  longitude = null,
  altitude = null,
  has_metadata = false,
  raw_metadata = null,
  is_suspicious = false,
  suspicious_reasons = [],
  confidence_level = null,
  suspicious_details = null
}) {
  const dId = Number(diary_id);
  const cId = client_photo_id ? String(client_photo_id) : null;

  // S-34 / T-64: Idempotency & deduplication - Nếu client_photo_id đã tồn tại trong nhật ký, cập nhật bản ghi cũ
  if (cId) {
    const existing = inMemorySiteDiaryPhotos.find(p => p.diary_id === dId && p.client_photo_id === cId);
    if (existing) {
      if (file_name) existing.file_name = String(file_name).trim();
      if (file_path) existing.file_path = String(file_path).trim();
      if (file_size) existing.file_size = Number(file_size);
      if (mime_type) existing.mime_type = String(mime_type);
      if (caption !== undefined && caption !== null) existing.caption = String(caption).trim();
      if (upload_status) existing.upload_status = upload_status;
      if (temp_path !== undefined) existing.temp_path = temp_path;
      if (taken_at !== undefined) existing.taken_at = taken_at;
      if (latitude !== undefined) existing.latitude = latitude;
      if (longitude !== undefined) existing.longitude = longitude;
      if (altitude !== undefined) existing.altitude = altitude;
      if (has_metadata !== undefined) existing.has_metadata = Boolean(has_metadata);
      if (raw_metadata !== undefined) existing.raw_metadata = raw_metadata;
      if (is_suspicious !== undefined) existing.is_suspicious = Boolean(is_suspicious);
      if (suspicious_reasons !== undefined) existing.suspicious_reasons = Array.isArray(suspicious_reasons) ? suspicious_reasons : [];
      if (confidence_level !== undefined) existing.confidence_level = confidence_level;
      if (suspicious_details !== undefined) existing.suspicious_details = suspicious_details;
      return existing;
    }
  }

  const newId = inMemorySiteDiaryPhotos.length > 0 ? Math.max(...inMemorySiteDiaryPhotos.map(p => p.id)) + 1 : 1;
  const newPhoto = {
    id: newId,
    diary_id: dId,
    file_name: String(file_name || 'photo.jpg').trim(),
    file_path: String(file_path || '').trim(),
    file_size: Number(file_size || 0),
    mime_type: String(mime_type || 'image/jpeg'),
    caption: caption ? String(caption).trim() : null,
    upload_status: upload_status || 'completed',
    client_photo_id: cId,
    temp_path: temp_path ? String(temp_path) : null,
    taken_at: taken_at || null,
    latitude: latitude !== undefined && latitude !== null ? Number(latitude) : null,
    longitude: longitude !== undefined && longitude !== null ? Number(longitude) : null,
    altitude: altitude !== undefined && altitude !== null ? Number(altitude) : null,
    has_metadata: Boolean(has_metadata || taken_at || (latitude !== null && latitude !== undefined)),
    raw_metadata: raw_metadata || null,
    is_suspicious: Boolean(is_suspicious),
    suspicious_reasons: Array.isArray(suspicious_reasons) ? suspicious_reasons : [],
    confidence_level: confidence_level || null,
    suspicious_details: suspicious_details ? String(suspicious_details) : null,
    created_at: new Date().toISOString()
  };
  inMemorySiteDiaryPhotos.push(newPhoto);
  return newPhoto;
}

function updateSiteDiaryPhoto(photoIdOrClientId, updateData) {
  const photo = inMemorySiteDiaryPhotos.find(p => 
    p.id === Number(photoIdOrClientId) || (p.client_photo_id && p.client_photo_id === String(photoIdOrClientId))
  );
  if (!photo) return null;
  if (updateData.file_name !== undefined) photo.file_name = updateData.file_name;
  if (updateData.file_path !== undefined) photo.file_path = updateData.file_path;
  if (updateData.file_size !== undefined) photo.file_size = Number(updateData.file_size);
  if (updateData.mime_type !== undefined) photo.mime_type = updateData.mime_type;
  if (updateData.caption !== undefined) photo.caption = updateData.caption;
  if (updateData.upload_status !== undefined) photo.upload_status = updateData.upload_status;
  if (updateData.client_photo_id !== undefined) photo.client_photo_id = updateData.client_photo_id;
  if (updateData.temp_path !== undefined) photo.temp_path = updateData.temp_path;
  if (updateData.taken_at !== undefined) photo.taken_at = updateData.taken_at;
  if (updateData.latitude !== undefined) photo.latitude = updateData.latitude;
  if (updateData.longitude !== undefined) photo.longitude = updateData.longitude;
  if (updateData.altitude !== undefined) photo.altitude = updateData.altitude;
  if (updateData.has_metadata !== undefined) photo.has_metadata = Boolean(updateData.has_metadata);
  if (updateData.raw_metadata !== undefined) photo.raw_metadata = updateData.raw_metadata;
  if (updateData.is_suspicious !== undefined) photo.is_suspicious = Boolean(updateData.is_suspicious);
  if (updateData.suspicious_reasons !== undefined) photo.suspicious_reasons = Array.isArray(updateData.suspicious_reasons) ? updateData.suspicious_reasons : [];
  if (updateData.confidence_level !== undefined) photo.confidence_level = updateData.confidence_level;
  if (updateData.suspicious_details !== undefined) photo.suspicious_details = updateData.suspicious_details;
  return photo;
}

function registerPendingSiteDiaryPhotos(diaryId, pendingPhotosList = []) {
  const dId = Number(diaryId);
  const created = [];
  for (const item of pendingPhotosList) {
    const photo = saveSiteDiaryPhoto({
      diary_id: dId,
      file_name: item.file_name || item.fileName || 'anh_dang_cho.jpg',
      file_path: '',
      file_size: Number(item.file_size || item.fileSize || 0),
      mime_type: item.mime_type || item.mimeType || 'image/jpeg',
      caption: item.caption || null,
      upload_status: 'pending',
      client_photo_id: item.client_photo_id || item.id || null
    });
    created.push(photo);
  }
  return created;
}

function deleteSiteDiaryPhoto(photoId) {
  const pId = Number(photoId);
  const idx = inMemorySiteDiaryPhotos.findIndex(p => p.id === pId);
  if (idx !== -1) {
    inMemorySiteDiaryPhotos.splice(idx, 1);
    return true;
  }
  return false;
}

function getSiteDiaryItems(diaryId) {
  const dId = Number(diaryId);
  return inMemorySiteDiaryItems.filter(i => Number(i.diary_id) === dId);
}

function getSiteDiaryItemById(itemId) {
  const iId = Number(itemId);
  return inMemorySiteDiaryItems.find(i => Number(i.id) === iId) || null;
}

function saveSiteDiaryItem({
  diary_id,
  client_item_id = null,
  work_item_id = null,
  work_content,
  log_time = null,
  quantity_done = 0,
  unit = '',
  version = 1,
  has_conflict = 0
}) {
  const dId = Number(diary_id);
  const cId = client_item_id ? String(client_item_id) : null;

  // S-30: Ràng buộc idempotency - Nếu đã có client_item_id trùng thì trả về bản ghi cũ
  if (cId) {
    const existing = inMemorySiteDiaryItems.find(i => Number(i.diary_id) === dId && i.client_item_id === cId);
    if (existing) {
      return existing;
    }
  }

  const newId = inMemorySiteDiaryItems.length > 0 ? Math.max(...inMemorySiteDiaryItems.map(i => i.id)) + 1 : 1;
  const newItem = {
    id: newId,
    diary_id: dId,
    client_item_id: cId,
    work_item_id: work_item_id ? Number(work_item_id) : null,
    work_content: String(work_content || '').trim(),
    log_time: log_time ? String(log_time).trim() : null,
    quantity_done: Number(quantity_done || 0),
    unit: String(unit || '').trim(),
    version: Number(version || 1),
    has_conflict: has_conflict ? 1 : 0,
    created_at: new Date().toISOString()
  };
  inMemorySiteDiaryItems.push(newItem);
  return newItem;
}

function updateSiteDiaryItem(itemId, updateData = {}) {
  const item = getSiteDiaryItemById(itemId);
  if (!item) return null;
  if (updateData.work_item_id !== undefined) item.work_item_id = updateData.work_item_id ? Number(updateData.work_item_id) : null;
  if (updateData.work_content !== undefined) item.work_content = String(updateData.work_content).trim();
  if (updateData.log_time !== undefined) item.log_time = updateData.log_time ? String(updateData.log_time).trim() : null;
  if (updateData.quantity_done !== undefined) item.quantity_done = Number(updateData.quantity_done || 0);
  if (updateData.unit !== undefined) item.unit = String(updateData.unit || '').trim();
  if (updateData.has_conflict !== undefined) item.has_conflict = updateData.has_conflict ? 1 : 0;
  if (updateData.version !== undefined) {
    item.version = Number(updateData.version);
  } else {
    // NFR: Mỗi lần máy chủ ghi nhận cập nhật, version tăng +1
    item.version = (item.version || 1) + 1;
  }
  item.updated_at = new Date().toISOString();
  return item;
}

function deleteSiteDiaryItem(itemId) {
  const iId = Number(itemId);
  const idx = inMemorySiteDiaryItems.findIndex(i => Number(i.id) === iId);
  if (idx !== -1) {
    inMemorySiteDiaryItems.splice(idx, 1);
    return true;
  }
  return false;
}

function clearSiteDiaryItems(diaryId) {
  const dId = Number(diaryId);
  for (let i = inMemorySiteDiaryItems.length - 1; i >= 0; i--) {
    if (Number(inMemorySiteDiaryItems[i].diary_id) === dId) {
      inMemorySiteDiaryItems.splice(i, 1);
    }
  }
}

// ==========================================
// S-32: PHÁT HIỆN XUNG ĐỘT & LỊCH SỬ MỤC NHẬT KÝ (SCRUM-145)
// ==========================================
let inMemorySiteDiaryItemConflicts = [];
let inMemorySiteDiaryItemHistory = [];

function saveSiteDiaryItemConflict({
  item_id,
  diary_id,
  base_version = 1,
  server_version = 1,
  client_version_data,
  server_version_data,
  conflicted_fields = [],
  submitted_by = null,
  device_id = null,
  status = 'pending'
}) {
  const newId = inMemorySiteDiaryItemConflicts.length > 0 ? Math.max(...inMemorySiteDiaryItemConflicts.map(c => c.id)) + 1 : 1;
  const newConflict = {
    id: newId,
    item_id: Number(item_id),
    diary_id: Number(diary_id),
    base_version: Number(base_version || 1),
    server_version: Number(server_version || 1),
    client_version_data: typeof client_version_data === 'string' ? JSON.parse(client_version_data) : client_version_data,
    server_version_data: typeof server_version_data === 'string' ? JSON.parse(server_version_data) : server_version_data,
    conflicted_fields: typeof conflicted_fields === 'string' ? JSON.parse(conflicted_fields) : conflicted_fields,
    submitted_by: submitted_by ? Number(submitted_by) : null,
    device_id: device_id ? String(device_id) : null,
    status: status || 'pending',
    resolved_choice: null,
    resolved_by: null,
    resolved_at: null,
    created_at: new Date().toISOString()
  };
  inMemorySiteDiaryItemConflicts.push(newConflict);
  return newConflict;
}

function getSiteDiaryItemConflicts({ diaryId, itemId, status } = {}) {
  return inMemorySiteDiaryItemConflicts.filter(c => {
    if (diaryId && Number(c.diary_id) !== Number(diaryId)) return false;
    if (itemId && Number(c.item_id) !== Number(itemId)) return false;
    if (status && c.status !== status) return false;
    return true;
  });
}

function getSiteDiaryItemConflictById(conflictId) {
  const cId = Number(conflictId);
  return inMemorySiteDiaryItemConflicts.find(c => Number(c.id) === cId) || null;
}

function updateSiteDiaryItemConflict(conflictId, updateData = {}) {
  const conflict = getSiteDiaryItemConflictById(conflictId);
  if (!conflict) return null;
  if (updateData.status !== undefined) conflict.status = updateData.status;
  if (updateData.resolved_choice !== undefined) conflict.resolved_choice = updateData.resolved_choice;
  if (updateData.resolved_by !== undefined) conflict.resolved_by = updateData.resolved_by ? Number(updateData.resolved_by) : null;
  if (updateData.resolved_at !== undefined) conflict.resolved_at = updateData.resolved_at;
  return conflict;
}

function saveSiteDiaryItemHistory({
  item_id,
  diary_id,
  version,
  work_item_id = null,
  work_content,
  log_time = null,
  quantity_done = 0,
  unit = '',
  change_type = 'updated',
  changed_by = null,
  change_summary = null
}) {
  const newId = inMemorySiteDiaryItemHistory.length > 0 ? Math.max(...inMemorySiteDiaryItemHistory.map(h => h.id)) + 1 : 1;
  const historyEntry = {
    id: newId,
    item_id: Number(item_id),
    diary_id: Number(diary_id),
    version: Number(version || 1),
    work_item_id: work_item_id ? Number(work_item_id) : null,
    work_content: String(work_content || '').trim(),
    log_time: log_time ? String(log_time).trim() : null,
    quantity_done: Number(quantity_done || 0),
    unit: String(unit || '').trim(),
    change_type: change_type || 'updated',
    changed_by: changed_by ? Number(changed_by) : null,
    change_summary: change_summary ? String(change_summary) : null,
    created_at: new Date().toISOString()
  };
  inMemorySiteDiaryItemHistory.push(historyEntry);
  return historyEntry;
}

function getSiteDiaryItemHistory(itemId) {
  const iId = Number(itemId);
  return inMemorySiteDiaryItemHistory
    .filter(h => Number(h.item_id) === iId)
    .sort((a, b) => (b.version - a.version) || (new Date(b.created_at) - new Date(a.created_at)));
}

// ==========================================
// DỰ ÁN, CÔNG VIỆC VÀ PHỤ THUỘC IN-MEMORY (FAST STANDALONE)
// ==========================================
let inMemoryProjects = [
  { id: 1, name: 'Dự án Thi Công Mẫu', code: 'DA-01', description: 'Dự án mẫu quản trị tiến độ thi công công trình' }
];

let inMemoryTasks = [
  { id: 1, project_id: 1, work_item_id: 3, name: 'Đào đất thủ công hố móng trụ T1', code: 'CV-01', duration: 4, actual_start: '2026-10-01', actual_end: '2026-10-04', percent_complete: 100, status: 'completed', team_id: 1, assigned_by: 2, assigned_at: '2026-10-01T08:00:00Z', assignment_note: 'Thi công an toàn' },
  { id: 2, project_id: 1, work_item_id: 4, name: 'Vận chuyển đất thải ra bãi tập kết', code: 'CV-02', duration: 3, actual_start: '2026-10-04', actual_end: null, percent_complete: 60, status: 'in_progress', team_id: 1, assigned_by: 2, assigned_at: '2026-10-04T08:00:00Z' },
  { id: 3, project_id: 1, work_item_id: 5, name: 'Đổ bê tông lót móng M1 dày 100mm', code: 'CV-03', duration: 3, actual_start: null, actual_end: null, percent_complete: 0, status: 'pending', team_id: 1, assigned_by: 2, assigned_at: '2026-10-05T08:00:00Z' },
  { id: 4, project_id: 1, work_item_id: 5, name: 'Gia công lắp dựng cốt thép móng', code: 'CV-04', duration: 5, actual_start: null, actual_end: null, percent_complete: 0, status: 'pending', team_id: 2, assigned_by: 2, assigned_at: '2026-10-06T08:00:00Z' },
  { id: 5, project_id: 1, work_item_id: 5, name: 'Lắp dựng ván khuôn móng đài cọc', code: 'CV-05', duration: 3, actual_start: null, actual_end: null, percent_complete: 0, status: 'pending', team_id: 2, assigned_by: 2, assigned_at: '2026-10-06T08:00:00Z' },
  { id: 6, project_id: 1, work_item_id: 6, name: 'Đổ bê tông móng thương phẩm B25', code: 'CV-06', duration: 2, actual_start: null, actual_end: null, percent_complete: 0, status: 'pending', team_id: null },
  { id: 7, project_id: 1, work_item_id: 6, name: 'Bảo dưỡng và tháo dỡ ván khuôn', code: 'CV-07', duration: 3, actual_start: null, actual_end: null, percent_complete: 0, status: 'pending', team_id: null }
];

// ==========================================
// ĐỘI THI CÔNG & GIAO VIỆC (S-25 / SCRUM-125 / T-50)
// ==========================================
let inMemoryTeams = [
  {
    id: 1,
    project_id: 1,
    name: 'Đội Cốp Pha & Bê Tông Móng',
    code: 'DOI-01',
    leader_id: null,
    leader_name: 'Nguyễn Văn Đội 1',
    phone: '0912345678',
    specialty: 'Bê tông - Cốp pha',
    member_count: 15,
    max_parallel_tasks: 3,
    status: 'active',
    created_at: new Date().toISOString()
  },
  {
    id: 2,
    project_id: 1,
    name: 'Đội Gia Công & Lắp Dựng Cốt Thép',
    code: 'DOI-02',
    leader_id: null,
    leader_name: 'Trần Văn Cương',
    phone: '0987654321',
    specialty: 'Cốt thép kết cấu',
    member_count: 12,
    max_parallel_tasks: 2,
    status: 'active',
    created_at: new Date().toISOString()
  },
  {
    id: 3,
    project_id: 1,
    name: 'Đội Xây Tô Hoàn Thiện & Điện Nước',
    code: 'DOI-03',
    leader_id: null,
    leader_name: 'Lê Văn Thợ',
    phone: '0905123456',
    specialty: 'Xây trát - Cơ điện M&E',
    member_count: 10,
    max_parallel_tasks: 2,
    status: 'active',
    created_at: new Date().toISOString()
  }
];

let inMemoryTaskAssignments = [
  { id: 1, project_id: 1, task_id: 1, team_id: 1, assigned_by: 2, assigned_at: '2026-10-01T08:00:00Z', note: 'Thi công hố móng trụ T1', status: 'assigned' },
  { id: 2, project_id: 1, task_id: 2, team_id: 1, assigned_by: 2, assigned_at: '2026-10-04T08:00:00Z', note: 'Vận chuyển đất thải', status: 'assigned' },
  { id: 3, project_id: 1, task_id: 3, team_id: 1, assigned_by: 2, assigned_at: '2026-10-05T08:00:00Z', note: 'Bê tông lót móng M1', status: 'assigned' },
  { id: 4, project_id: 1, task_id: 4, team_id: 2, assigned_by: 2, assigned_at: '2026-10-06T08:00:00Z', note: 'Cốt thép móng', status: 'assigned' },
  { id: 5, project_id: 1, task_id: 5, team_id: 2, assigned_by: 2, assigned_at: '2026-10-06T08:00:00Z', note: 'Ván khuôn móng đài cọc', status: 'assigned' }
];

function getTeams(projectId = 1) {
  const pId = Number(projectId);
  const teams = inMemoryTeams.filter(t => t.project_id === pId);
  return teams.map(team => {
    const assignedTasks = inMemoryTasks.filter(t => t.project_id === pId && Number(t.team_id) === Number(team.id));
    const totalCount = assignedTasks.length;
    const activeTasks = assignedTasks.filter(t => (t.status !== 'completed' && Number(t.percent_complete || 0) < 100));
    const activeCount = activeTasks.length;
    const completedCount = totalCount - activeCount;

    const maxParallel = Number(team.max_parallel_tasks || 3);
    const isOverloaded = activeCount > maxParallel;
    const isFull = activeCount === maxParallel;

    let workloadStatus = 'normal';
    if (isOverloaded) {
      workloadStatus = 'overloaded';
    } else if (isFull) {
      workloadStatus = 'full';
    }

    return {
      ...team,
      task_count: totalCount,
      active_task_count: activeCount,
      completed_task_count: completedCount,
      is_overloaded: isOverloaded,
      is_full: isFull,
      workload_ratio: Number((activeCount / maxParallel).toFixed(2)),
      workload_status: workloadStatus,
      active_tasks: activeTasks.map(at => ({ id: at.id, name: at.name, code: at.code, duration: at.duration, percent_complete: at.percent_complete }))
    };
  });
}

function getTeamById(teamId) {
  const tId = Number(teamId);
  return inMemoryTeams.find(t => t.id === tId) || null;
}

function createTeamData(data) {
  const newId = inMemoryTeams.length > 0 ? Math.max(...inMemoryTeams.map(t => t.id)) + 1 : 1;
  const pId = Number(data.project_id || 1);
  const newTeam = {
    id: newId,
    project_id: pId,
    name: String(data.name || '').trim(),
    code: data.code ? String(data.code).trim() : `DOI-${String(newId).padStart(2, '0')}`,
    leader_id: data.leader_id ? Number(data.leader_id) : null,
    leader_name: data.leader_name ? String(data.leader_name).trim() : null,
    phone: data.phone ? String(data.phone).trim() : null,
    specialty: data.specialty ? String(data.specialty).trim() : 'Thi công xây dựng',
    member_count: Number(data.member_count || 10),
    max_parallel_tasks: Number(data.max_parallel_tasks || 3),
    status: data.status || 'active',
    created_at: new Date().toISOString()
  };
  inMemoryTeams.push(newTeam);
  return newTeam;
}

function updateTeamData(teamId, data) {
  const tId = Number(teamId);
  const team = inMemoryTeams.find(t => t.id === tId);
  if (!team) return null;
  if (data.name !== undefined) team.name = String(data.name).trim();
  if (data.code !== undefined) team.code = String(data.code).trim();
  if (data.leader_id !== undefined) team.leader_id = data.leader_id ? Number(data.leader_id) : null;
  if (data.leader_name !== undefined) team.leader_name = String(data.leader_name).trim();
  if (data.phone !== undefined) team.phone = String(data.phone).trim();
  if (data.specialty !== undefined) team.specialty = String(data.specialty).trim();
  if (data.member_count !== undefined) team.member_count = Number(data.member_count);
  if (data.max_parallel_tasks !== undefined) team.max_parallel_tasks = Number(data.max_parallel_tasks);
  if (data.status !== undefined) team.status = data.status;
  team.updated_at = new Date().toISOString();
  return team;
}

function deleteTeamData(teamId) {
  const tId = Number(teamId);
  const idx = inMemoryTeams.findIndex(t => t.id === tId);
  if (idx === -1) return false;
  inMemoryTeams.splice(idx, 1);
  inMemoryTasks.forEach(t => {
    if (t.team_id === tId) {
      t.team_id = null;
      t.assigned_by = null;
      t.assigned_at = null;
      t.assignment_note = null;
    }
  });
  return true;
}

function assignTaskToTeamData({ projectId = 1, taskId, teamId, assignedBy = 2, note = '' }) {
  const tId = Number(taskId);
  const tmId = Number(teamId);
  const task = inMemoryTasks.find(t => t.id === tId && t.project_id === Number(projectId));
  if (!task) {
    const err = new Error('Không tìm thấy công việc trong dự án.');
    err.status = 404;
    throw err;
  }
  const team = inMemoryTeams.find(t => t.id === tmId && t.project_id === Number(projectId));
  if (!team) {
    const err = new Error('Không tìm thấy đội thi công trong dự án.');
    err.status = 404;
    throw err;
  }

  const otherActiveTasks = inMemoryTasks.filter(
    t => t.project_id === Number(projectId) && Number(t.team_id) === tmId && t.id !== tId && t.status !== 'completed' && Number(t.percent_complete || 0) < 100
  );
  const willBeActive = task.status !== 'completed' && Number(task.percent_complete || 0) < 100;
  const newActiveCount = otherActiveTasks.length + (willBeActive ? 1 : 0);
  const maxParallel = Number(team.max_parallel_tasks || 3);
  const isOverloaded = newActiveCount > maxParallel;

  const nowIso = new Date().toISOString();
  task.team_id = tmId;
  task.assigned_by = Number(assignedBy || 2);
  task.assigned_at = nowIso;
  task.assignment_note = note ? String(note).trim() : null;

  const assignLogId = inMemoryTaskAssignments.length > 0 ? Math.max(...inMemoryTaskAssignments.map(a => a.id)) + 1 : 1;
  const assignmentLog = {
    id: assignLogId,
    project_id: Number(projectId),
    task_id: tId,
    team_id: tmId,
    assigned_by: Number(assignedBy || 2),
    assigned_at: nowIso,
    note: note ? String(note).trim() : null,
    status: 'assigned'
  };
  inMemoryTaskAssignments.push(assignmentLog);

  let warning = null;
  if (isOverloaded) {
    warning = `Cảnh báo quá tải: Đội "${team.name}" hiện đang phụ trách ${newActiveCount} công việc đang thi công (định mức tối đa là ${maxParallel} việc song song). Việc giao thêm công việc có thể dẫn đến chậm tiến độ!`;
  }

  return {
    success: true,
    task,
    team,
    is_overloaded: isOverloaded,
    active_task_count: newActiveCount,
    max_parallel_tasks: maxParallel,
    warning
  };
}

function unassignTaskData({ projectId = 1, taskId, assignedBy = 2 }) {
  const tId = Number(taskId);
  const task = inMemoryTasks.find(t => t.id === tId && t.project_id === Number(projectId));
  if (!task) {
    const err = new Error('Không tìm thấy công việc trong dự án.');
    err.status = 404;
    throw err;
  }
  const oldTeamId = task.team_id;
  task.team_id = null;
  task.assigned_by = null;
  task.assigned_at = null;
  task.assignment_note = null;

  if (oldTeamId) {
    const assignLogId = inMemoryTaskAssignments.length > 0 ? Math.max(...inMemoryTaskAssignments.map(a => a.id)) + 1 : 1;
    inMemoryTaskAssignments.push({
      id: assignLogId,
      project_id: Number(projectId),
      task_id: tId,
      team_id: oldTeamId,
      assigned_by: Number(assignedBy || 2),
      assigned_at: new Date().toISOString(),
      note: 'Hủy giao việc',
      status: 'unassigned'
    });
  }

  return { success: true, task };
}

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

// ==========================================
// BÁO CÁO KHỐI LƯỢNG NGÀY CỦA ĐỘI (S-26 / SCRUM-118)
// ==========================================
let inMemoryTeamDailyProgress = [];

function getTeamDailyProgress(taskId = null, teamId = null, projectId = null) {
  return inMemoryTeamDailyProgress.filter(p => {
    if (projectId && Number(p.project_id) !== Number(projectId)) return false;
    if (taskId && Number(p.task_id) !== Number(taskId)) return false;
    if (teamId && Number(p.team_id) !== Number(teamId)) return false;
    return true;
  });
}

function saveTeamDailyProgress({ project_id, task_id, team_id, report_date, reported_quantity, notes, created_by }) {
  const newId = inMemoryTeamDailyProgress.length > 0 ? Math.max(...inMemoryTeamDailyProgress.map(p => p.id)) + 1 : 1;
  const entry = {
    id: newId,
    project_id: Number(project_id),
    task_id: Number(task_id),
    team_id: Number(team_id),
    report_date: String(report_date),
    reported_quantity: Number(reported_quantity),
    notes: notes ? String(notes).trim() : null,
    created_by: Number(created_by || 1),
    created_at: new Date().toISOString()
  };
  inMemoryTeamDailyProgress.push(entry);
  return entry;
}

// ==========================================
// PHIẾU NGHIỆM THU THEO ĐỢT (S-36 / SCRUM-165)
// ==========================================
let inMemoryAcceptanceSheets = [];
let inMemoryAcceptanceSheetItems = [];
let inMemoryAcceptanceSheetPhotos = [];

function getAcceptanceSheets(projectId) {
  const pId = Number(projectId);
  return inMemoryAcceptanceSheets
    .filter(s => Number(s.project_id) === pId)
    .sort((a, b) => b.period_number - a.period_number);
}

function getAcceptanceSheetById(sheetId) {
  const sId = Number(sheetId);
  const sheet = inMemoryAcceptanceSheets.find(s => s.id === sId);
  if (!sheet) return null;
  const items = inMemoryAcceptanceSheetItems.filter(i => i.sheet_id === sId);
  const photos = inMemoryAcceptanceSheetPhotos.filter(p => p.sheet_id === sId);
  return { ...sheet, items, photos };
}

function getLatestApprovedAcceptanceSheet(projectId) {
  const pId = Number(projectId);
  const approved = inMemoryAcceptanceSheets
    .filter(s => Number(s.project_id) === pId && s.status === 'approved')
    .sort((a, b) => b.period_number - a.period_number);
  if (approved.length === 0) return null;
  const latest = approved[0];
  const items = inMemoryAcceptanceSheetItems.filter(i => i.sheet_id === latest.id);
  return { ...latest, items };
}

function saveAcceptanceSheet(sheetData) {
  const newId = sheetData.id ? Number(sheetData.id) : (inMemoryAcceptanceSheets.length > 0 ? Math.max(...inMemoryAcceptanceSheets.map(s => s.id)) + 1 : 1);
  const now = new Date().toISOString();
  const sheet = {
    id: newId,
    project_id: Number(sheetData.project_id),
    sheet_code: String(sheetData.sheet_code).trim(),
    name: String(sheetData.name).trim(),
    period_number: Number(sheetData.period_number || 1),
    from_date: String(sheetData.from_date),
    to_date: String(sheetData.to_date),
    status: sheetData.status || 'draft',
    notes: sheetData.notes ? String(sheetData.notes).trim() : null,
    created_by: Number(sheetData.created_by || 1),
    approved_by: sheetData.approved_by ? Number(sheetData.approved_by) : null,
    approved_at: sheetData.approved_at || null,
    created_at: now,
    updated_at: now
  };
  inMemoryAcceptanceSheets.push(sheet);
  return sheet;
}

function updateAcceptanceSheet(sheetId, updateData) {
  const sId = Number(sheetId);
  const sheet = inMemoryAcceptanceSheets.find(s => s.id === sId);
  if (!sheet) return null;
  // S-44 / T-102: Khóa phiếu nghiệm thu nếu thuộc đề nghị thanh toán đã duyệt
  if (sheet.payment_request_id) {
    const linkedPr = inMemoryPaymentRequests.find(pr => pr.id === sheet.payment_request_id);
    if (linkedPr && linkedPr.status === 'approved') {
      const err = new Error('Phiếu nghiệm thu thuộc đề nghị thanh toán đã được phê duyệt (đã bị khóa), không thể chỉnh sửa.');
      err.status = 409;
      throw err;
    }
  }
  if (updateData.name !== undefined) sheet.name = String(updateData.name).trim();
  if (updateData.sheet_code !== undefined) sheet.sheet_code = String(updateData.sheet_code).trim();
  if (updateData.period_number !== undefined) sheet.period_number = Number(updateData.period_number);
  if (updateData.from_date !== undefined) sheet.from_date = String(updateData.from_date);
  if (updateData.to_date !== undefined) sheet.to_date = String(updateData.to_date);
  if (updateData.status !== undefined) sheet.status = updateData.status;
  if (updateData.notes !== undefined) sheet.notes = updateData.notes;
  if (updateData.approved_by !== undefined) sheet.approved_by = updateData.approved_by;
  if (updateData.approved_at !== undefined) sheet.approved_at = updateData.approved_at;
  sheet.updated_at = new Date().toISOString();
  return sheet;
}

function deleteAcceptanceSheet(sheetId) {
  const sId = Number(sheetId);
  const idx = inMemoryAcceptanceSheets.findIndex(s => s.id === sId);
  if (idx === -1) return false;
  const sheet = inMemoryAcceptanceSheets[idx];
  // S-44 / T-102: Khóa phiếu nghiệm thu nếu thuộc đề nghị thanh toán đã duyệt
  if (sheet && sheet.payment_request_id) {
    const linkedPr = inMemoryPaymentRequests.find(pr => pr.id === sheet.payment_request_id);
    if (linkedPr && linkedPr.status === 'approved') {
      const err = new Error('Phiếu nghiệm thu thuộc đề nghị thanh toán đã được phê duyệt (đã bị khóa), không thể xóa.');
      err.status = 409;
      throw err;
    }
  }
  inMemoryAcceptanceSheets.splice(idx, 1);
  inMemoryAcceptanceSheetItems = inMemoryAcceptanceSheetItems.filter(i => i.sheet_id !== sId);
  inMemoryAcceptanceSheetPhotos = inMemoryAcceptanceSheetPhotos.filter(p => p.sheet_id !== sId);
  return true;
}

function saveAcceptanceSheetItem(itemData) {
  const newId = inMemoryAcceptanceSheetItems.length > 0 ? Math.max(...inMemoryAcceptanceSheetItems.map(i => i.id)) + 1 : 1;
  const prevApproved = Number(itemData.previous_approved_quantity || 0);
  const cumulative = Number(itemData.cumulative_quantity || 0);
  const periodQty = Number(itemData.period_quantity !== undefined ? itemData.period_quantity : (cumulative - prevApproved).toFixed(2));
  const teamReported = Number(itemData.team_reported_quantity || 0);
  const diff = Number((periodQty - teamReported).toFixed(2));

  const item = {
    id: newId,
    sheet_id: Number(itemData.sheet_id),
    work_item_id: itemData.work_item_id ? Number(itemData.work_item_id) : null,
    task_id: itemData.task_id ? Number(itemData.task_id) : null,
    item_name: String(itemData.item_name || '').trim(),
    unit: String(itemData.unit || 'm3').trim(),
    previous_approved_quantity: prevApproved,
    cumulative_quantity: cumulative,
    period_quantity: periodQty,
    team_reported_quantity: teamReported,
    difference: diff,
    notes: itemData.notes ? String(itemData.notes).trim() : null,
    created_at: new Date().toISOString()
  };
  inMemoryAcceptanceSheetItems.push(item);
  return item;
}

function saveAcceptanceSheetPhoto(photoData) {
  // S-44 / T-102: Khóa không cho thêm ảnh nếu phiếu nghiệm thu thuộc đề nghị đã duyệt
  const parentSheet = inMemoryAcceptanceSheets.find(s => s.id === Number(photoData.sheet_id));
  if (parentSheet && parentSheet.payment_request_id) {
    const linkedPr = inMemoryPaymentRequests.find(pr => pr.id === parentSheet.payment_request_id);
    if (linkedPr && linkedPr.status === 'approved') {
      const err = new Error('Phiếu nghiệm thu thuộc đề nghị thanh toán đã được phê duyệt (đã bị khóa), không thể thêm ảnh hiện trường.');
      err.status = 409;
      throw err;
    }
  }

  const newId = inMemoryAcceptanceSheetPhotos.length > 0 ? Math.max(...inMemoryAcceptanceSheetPhotos.map(p => p.id)) + 1 : 1;
  const photo = {
    id: newId,
    sheet_id: Number(photoData.sheet_id),
    file_name: String(photoData.file_name || 'photo.jpg').trim(),
    file_path: String(photoData.file_path || '').trim(),
    file_size: Number(photoData.file_size || 0),
    mime_type: String(photoData.mime_type || 'image/jpeg'),
    caption: photoData.caption ? String(photoData.caption).trim() : null,
    taken_at: photoData.taken_at || null,
    latitude: photoData.latitude !== undefined && photoData.latitude !== null ? Number(photoData.latitude) : null,
    longitude: photoData.longitude !== undefined && photoData.longitude !== null ? Number(photoData.longitude) : null,
    has_metadata: Boolean(photoData.has_metadata || photoData.taken_at || (photoData.latitude !== null && photoData.latitude !== undefined)),
    is_suspicious: Boolean(photoData.is_suspicious),
    suspicious_reasons: Array.isArray(photoData.suspicious_reasons) ? photoData.suspicious_reasons : (typeof photoData.suspicious_reasons === 'string' ? JSON.parse(photoData.suspicious_reasons || '[]') : []),
    confidence_level: photoData.confidence_level || null,
    suspicious_details: photoData.suspicious_details ? String(photoData.suspicious_details) : null,
    created_at: new Date().toISOString()
  };
  inMemoryAcceptanceSheetPhotos.push(photo);
  return photo;
}

function deleteAcceptanceSheetPhoto(photoId) {
  const pId = Number(photoId);
  const idx = inMemoryAcceptanceSheetPhotos.findIndex(p => p.id === pId);
  if (idx === -1) return false;
  // S-44 / T-102: Khóa không cho xóa ảnh nếu phiếu nghiệm thu thuộc đề nghị đã duyệt
  const photo = inMemoryAcceptanceSheetPhotos[idx];
  if (photo) {
    const parentSheet = inMemoryAcceptanceSheets.find(s => s.id === photo.sheet_id);
    if (parentSheet && parentSheet.payment_request_id) {
      const linkedPr = inMemoryPaymentRequests.find(pr => pr.id === parentSheet.payment_request_id);
      if (linkedPr && linkedPr.status === 'approved') {
        const err = new Error('Phiếu nghiệm thu thuộc đề nghị thanh toán đã được phê duyệt (đã bị khóa), không thể xóa ảnh hiện trường.');
        err.status = 409;
        throw err;
      }
    }
  }
  inMemoryAcceptanceSheetPhotos.splice(idx, 1);
  return true;
}

// ==========================================
// S-43 (SCRUM-172): SINH ĐỀ NGHỊ THANH TOÁN TỪ PHIẾU NGHIỆM THU ĐÃ DUYỆT
// ==========================================

// S-43 NFR: Hàm làm tròn HALF_UP 2 chữ số thập phân chính xác
function roundMoney(v) {
  const n = Number(v);
  if (isNaN(n)) return 0;
  return Number(Math.round(Number(n + 'e2')) + 'e-2');
}

/**
 * T-97: Lấy danh sách phiếu NT đã duyệt, chưa đưa vào đề nghị nào,
 *        kèm đủ hạng mục, khối lượng đợt và đơn giá hợp đồng.
 * AC: Chỉ lấy phiếu đã duyệt; thuộc đúng project + period nếu chỉ định;
 *     không lấy phiếu đã được đưa vào đề nghị khác.
 *
 * @param {number} projectId
 * @param {number|null} periodNumber  - nếu null thì lấy tất cả kỳ
 */
function getApprovedSheetsAvailable(projectId, periodNumber = null) {
  const pId = Number(projectId);

  // Lọc phiếu: đã duyệt + chưa liên kết (payment_request_id === null/undefined)
  const sheets = inMemoryAcceptanceSheets.filter(s => {
    if (Number(s.project_id) !== pId) return false;
    if (s.status !== 'approved') return false;
    if (s.payment_request_id != null) return false; // T-99: đã liên kết → bỏ
    const hasPeriodFilter = periodNumber !== null && periodNumber !== undefined && periodNumber !== '';
    if (hasPeriodFilter && Number(s.period_number) !== Number(periodNumber)) return false;
    return true;
  });

  // Ghép từng hạng mục kèm đơn giá hợp đồng (T-97 AC: kết quả có đủ hạng mục, khối lượng đợt, đơn giá)
  const result = [];
  for (const s of sheets) {
    const items = inMemoryAcceptanceSheetItems.filter(i => i.sheet_id === s.id);
    const workItemIds = [...new Set(items.map(i => i.work_item_id).filter(Boolean))];
    const workItemsMap = new Map();
    inMemoryWorkItems
      .filter(w => workItemIds.includes(w.id))
      .forEach(w => workItemsMap.set(w.id, w));

    const enrichedItems = items.map(i => {
      const w = i.work_item_id ? workItemsMap.get(Number(i.work_item_id)) : null;
      // T-98 NFR: đơn giá từ hợp đồng (don_gia_hop_dong)
      const unitPrice = (w && w.don_gia_hop_dong != null)
        ? Number(w.don_gia_hop_dong)
        : (i.unit_price != null ? Number(i.unit_price) : 0);
      // T-98: thành tiền = khối lượng đợt × đơn giá, làm tròn HALF_UP 2 chữ số
      const periodQty = Number(i.period_quantity || 0);
      const lineTotal = roundMoney(periodQty * unitPrice); // HALF_UP 2 chữ số

      return {
        acceptance_sheet_id: s.id,
        acceptance_sheet_code: s.sheet_code,
        work_item_id: i.work_item_id || null,
        item_name: i.item_name,
        unit: i.unit,
        period_quantity: periodQty,
        unit_price: unitPrice,
        line_total: lineTotal
      };
    });

    result.push({
      sheet_id: s.id,
      sheet_code: s.sheet_code,
      sheet_name: s.name,
      period_number: s.period_number,
      from_date: s.from_date,
      to_date: s.to_date,
      approved_at: s.approved_at,
      items: enrichedItems
    });
  }
  return result;
}

/**
 * T-99: Khoá liên kết phiếu NT → payment_request (nguyên tử trong in-memory).
 * Ràng buộc: một phiếu chỉ được liên kết với 1 đề nghị duy nhất.
 * Nếu phiếu đã bị liên kết (race condition giữa hai request đồng thời), trả về false.
 *
 * @param {number} projectId
 * @param {number} paymentRequestId
 * @param {number[]} sheetIds  - danh sách sheet_id cần khoá
 * @returns {{ ok: boolean, alreadyLinked: number[] }}
 */
function linkSheetsToPaymentRequest(projectId, paymentRequestId, sheetIds) {
  const pId = Number(projectId);
  const reqId = Number(paymentRequestId);
  const ids = sheetIds.map(Number);

  // Kiểm tra từng phiếu: phải thuộc project + đã duyệt + chưa liên kết
  const alreadyLinked = [];
  for (const sid of ids) {
    const s = inMemoryAcceptanceSheets.find(sh => sh.id === sid && Number(sh.project_id) === pId);
    if (!s) {
      alreadyLinked.push(sid);
      continue;
    }
    if (s.status !== 'approved') {
      alreadyLinked.push(sid);
      continue;
    }
    if (s.payment_request_id != null) {
      alreadyLinked.push(sid); // T-99: đã liên kết với đề nghị khác
    }
  }

  if (alreadyLinked.length > 0) {
    return { ok: false, alreadyLinked };
  }

  // Khoá liên kết — đặt payment_request_id
  for (const sid of ids) {
    const s = inMemoryAcceptanceSheets.find(sh => sh.id === sid);
    if (s) {
      s.payment_request_id = reqId;
      s.updated_at = new Date().toISOString();
    }
  }
  return { ok: true, alreadyLinked: [] };
}

/**
 * T-99: Rollback khoá liên kết khi tạo đề nghị thất bại (không để lại liên kết dở dang).
 */
function unlinkSheetsFromPaymentRequest(paymentRequestId) {
  const reqId = Number(paymentRequestId);
  inMemoryAcceptanceSheets.forEach(s => {
    if (s.payment_request_id === reqId) {
      s.payment_request_id = null;
      s.updated_at = new Date().toISOString();
    }
  });
}

// ==========================================
// ĐỀ NGHỊ THANH TOÁN & TẠM GIỮ HỢP ĐỒNG (S-45 / SCRUM-E08)
// ==========================================
let inMemoryPaymentRequests = [];
let inMemoryPaymentRequestItems = [];

function getProjectRetentionRate(projectId) {
  const pId = Number(projectId);
  const proj = inMemoryProjects.find(p => p.id === pId);
  return proj && proj.retention_rate !== undefined ? Number(proj.retention_rate) : 5.00;
}

function updateProjectRetentionRate(projectId, rate) {
  const pId = Number(projectId);
  const r = Number(rate);
  let proj = inMemoryProjects.find(p => p.id === pId);
  if (!proj) {
    proj = { id: pId, name: `Dự án ${pId}`, code: `DA-${pId}`, retention_rate: r };
    inMemoryProjects.push(proj);
  } else {
    proj.retention_rate = r;
  }
  return r;
}

function getPaymentRequests(projectId) {
  const pId = Number(projectId);
  const list = inMemoryPaymentRequests
    .filter(pr => Number(pr.project_id) === pId)
    .sort((a, b) => b.period_number - a.period_number);

  // Tính tổng tạm giữ luỹ kế qua các đề nghị (AC 3 S-45: tổng tạm giữ luỹ kế xem được)
  let cumulativeRetention = 0;
  let cumulativeGross = 0;
  let cumulativeNet = 0;
  list.forEach(pr => {
    cumulativeRetention += Number(pr.retention_amount || 0);
    cumulativeGross += Number(pr.gross_amount || 0);
    cumulativeNet += Number(pr.net_payable_amount || 0);
  });

  return {
    requests: list,
    summary: {
      retention_rate: getProjectRetentionRate(pId),
      cumulative_retention_amount: Number(cumulativeRetention.toFixed(2)),
      cumulative_gross_amount: Number(cumulativeGross.toFixed(2)),
      cumulative_net_payable_amount: Number(cumulativeNet.toFixed(2))
    }
  };
}

function getPaymentRequestById(requestId) {
  const rId = Number(requestId);
  const req = inMemoryPaymentRequests.find(pr => pr.id === rId);
  if (!req) return null;
  const items = inMemoryPaymentRequestItems
    .filter(it => it.payment_request_id === rId)
    .map(it => {
      const sheet = inMemoryAcceptanceSheets.find(s => s.id === it.acceptance_sheet_id);
      return {
        ...it,
        acceptance_sheet_code: sheet ? sheet.sheet_code : (it.acceptance_sheet_code || null)
      };
    });
  const creator = inMemoryUsers.find(u => u.id === req.created_by);
  const approver = inMemoryUsers.find(u => u.id === req.approved_by);
  const rejecter = inMemoryUsers.find(u => u.id === req.rejected_by);
  return {
    ...req,
    creator_name: creator ? creator.full_name : null,
    approver_name: approver ? approver.full_name : null,
    rejecter_name: rejecter ? rejecter.full_name : null,
    items
  };
}

function savePaymentRequest(requestData, itemsData = []) {
  const newId = inMemoryPaymentRequests.length > 0 ? Math.max(...inMemoryPaymentRequests.map(r => r.id)) + 1 : 1;
  const gross = roundMoney(requestData.gross_amount || 0);
  const rate = Number(requestData.retention_rate !== undefined ? requestData.retention_rate : 5.00);
  const retention = Number(requestData.retention_amount !== undefined ? requestData.retention_amount : roundMoney(gross * (rate / 100)));
  const net = Number(requestData.net_payable_amount !== undefined ? requestData.net_payable_amount : roundMoney(gross - retention));

  const newReq = {
    id: newId,
    project_id: Number(requestData.project_id),
    request_code: String(requestData.request_code).trim(),
    name: String(requestData.name).trim(),
    period_number: Number(requestData.period_number || 1),
    from_date: String(requestData.from_date),
    to_date: String(requestData.to_date),
    gross_amount: Number(gross.toFixed(2)),
    retention_rate: Number(rate.toFixed(2)),
    retention_amount: Number(retention.toFixed(2)),
    net_payable_amount: Number(net.toFixed(2)),
    status: requestData.status || 'draft',
    notes: requestData.notes ? String(requestData.notes).trim() : null,
    created_by: Number(requestData.created_by || 1),
    approved_by: requestData.approved_by ? Number(requestData.approved_by) : null,
    approved_at: requestData.approved_at || null,
    rejected_by: requestData.rejected_by ? Number(requestData.rejected_by) : null,
    rejected_at: requestData.rejected_at || null,
    rejection_reason: requestData.rejection_reason ? String(requestData.rejection_reason).trim() : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  inMemoryPaymentRequests.push(newReq);

  const createdItems = [];
  let itemCounter = inMemoryPaymentRequestItems.length > 0 ? Math.max(...inMemoryPaymentRequestItems.map(i => i.id)) + 1 : 1;
  for (const it of itemsData) {
    const itemGross = Number((Number(it.period_quantity || 0) * Number(it.unit_price || 0)).toFixed(2));
    const newItem = {
      id: itemCounter++,
      payment_request_id: newId,
      acceptance_sheet_id: Number(it.acceptance_sheet_id),
      work_item_id: it.work_item_id ? Number(it.work_item_id) : null,
      item_name: String(it.item_name || 'Hạng mục').trim(),
      unit: String(it.unit || 'm3').trim(),
      period_quantity: Number(it.period_quantity || 0),
      unit_price: Number(it.unit_price || 0),
      line_total: Number(it.line_total !== undefined ? it.line_total : itemGross),
      created_at: new Date().toISOString()
    };
    inMemoryPaymentRequestItems.push(newItem);
    createdItems.push(newItem);
  }

  return { ...newReq, items: createdItems };
}

function approvePaymentRequest(projectId, requestId, userId) {
  const rId = Number(requestId);
  const req = inMemoryPaymentRequests.find(pr => pr.id === rId && Number(pr.project_id) === Number(projectId));
  if (!req) return null;
  // S-44 / T-102: Khóa không cho duyệt lại nếu đã duyệt
  if (req.status === 'approved') {
    const err = new Error('Đề nghị thanh toán đã được duyệt trước đó và đã bị khóa.');
    err.status = 409;
    throw err;
  }
  // S-44: Không cho duyệt đề nghị đã bị từ chối / trả lại
  if (req.status === 'rejected' || req.status === 'returned') {
    const err = new Error('Đề nghị thanh toán đã bị từ chối/trả lại, không thể phê duyệt.');
    err.status = 409;
    throw err;
  }
  req.status = 'approved';
  req.approved_by = Number(userId);
  req.approved_at = new Date().toISOString();
  req.updated_at = new Date().toISOString();
  return req;
}

// S-44 / T-101 & T-103: Chủ đầu tư trả lại đề nghị thanh toán và giải phóng các phiếu nghiệm thu liên kết
function rejectPaymentRequest(projectId, requestId, userId, reason) {
  const rId = Number(requestId);
  const req = inMemoryPaymentRequests.find(pr => pr.id === rId && Number(pr.project_id) === Number(projectId));
  if (!req) return null;
  // S-44 / T-102: Đề nghị đã duyệt bị khóa, không thể trả lại
  if (req.status === 'approved') {
    const err = new Error('Đề nghị thanh toán đã được phê duyệt và bị khóa, không thể trả lại.');
    err.status = 409;
    throw err;
  }
  if (req.status === 'rejected' || req.status === 'returned') {
    const err = new Error('Đề nghị thanh toán đã được trả lại trước đó.');
    err.status = 409;
    throw err;
  }
  if (!reason || !String(reason).trim()) {
    const err = new Error('Lý do trả lại đề nghị thanh toán là bắt buộc.');
    err.status = 400;
    throw err;
  }
  req.status = 'rejected';
  req.rejected_by = Number(userId);
  req.rejected_at = new Date().toISOString();
  req.rejection_reason = String(reason).trim();
  req.updated_at = new Date().toISOString();

  // T-103: Giải phóng các phiếu nghiệm thu liên kết để đưa vào đề xuất khác
  unlinkSheetsFromPaymentRequest(rId);

  return req;
}

// S-44 / T-102: Khóa chỉnh sửa đề nghị đã duyệt hoặc đã trả lại
function updatePaymentRequest(projectId, requestId, updateData) {
  const rId = Number(requestId);
  const req = inMemoryPaymentRequests.find(pr => pr.id === rId && Number(pr.project_id) === Number(projectId));
  if (!req) return null;
  if (req.status === 'approved') {
    const err = new Error('Đề nghị thanh toán đã được phê duyệt (đã bị khóa), không thể chỉnh sửa.');
    err.status = 409;
    throw err;
  }
  if (req.status === 'rejected' || req.status === 'returned') {
    const err = new Error('Đề nghị thanh toán đã bị trả lại, không thể chỉnh sửa.');
    err.status = 409;
    throw err;
  }
  if (updateData.name !== undefined) req.name = String(updateData.name).trim();
  if (updateData.notes !== undefined) req.notes = updateData.notes;
  req.updated_at = new Date().toISOString();
  return req;
}

// S-44 / T-102: Khóa xóa đề nghị đã duyệt
function deletePaymentRequest(projectId, requestId) {
  const rId = Number(requestId);
  const idx = inMemoryPaymentRequests.findIndex(pr => pr.id === rId && Number(pr.project_id) === Number(projectId));
  if (idx === -1) return null;
  const req = inMemoryPaymentRequests[idx];
  if (req.status === 'approved') {
    const err = new Error('Đề nghị thanh toán đã được phê duyệt (đã bị khóa), không thể xóa.');
    err.status = 409;
    throw err;
  }
  unlinkSheetsFromPaymentRequest(rId);
  inMemoryPaymentRequests.splice(idx, 1);
  inMemoryPaymentRequestItems = inMemoryPaymentRequestItems.filter(it => it.payment_request_id !== rId);
  return req;
}

// ==========================================
// S-39 (SCRUM-168): NHẬT KÝ THAO TÁC TRÊN PHIẾU CHỈ GHI THÊM (APPEND-ONLY)
// ==========================================
let inMemorySheetAuditLogs = [];

function saveSheetAuditLog({
  project_id,
  entity_type,
  entity_id,
  action,
  performed_by,
  user_name = null,
  role_name = null,
  old_values = null,
  new_values = null,
  change_summary = null,
  reason = null,
  ip_address = null
}) {
  const newId = inMemorySheetAuditLogs.length > 0 ? Math.max(...inMemorySheetAuditLogs.map(l => l.id)) + 1 : 1;
  const newLog = {
    id: newId,
    project_id: Number(project_id),
    entity_type: String(entity_type),
    entity_id: String(entity_id),
    action: String(action).toUpperCase(),
    performed_by: Number(performed_by || 1),
    user_name: user_name ? String(user_name) : null,
    role_name: role_name ? String(role_name) : null,
    old_values: typeof old_values === 'string' ? JSON.parse(old_values) : old_values,
    new_values: typeof new_values === 'string' ? JSON.parse(new_values) : new_values,
    change_summary: change_summary ? String(change_summary) : null,
    reason: reason ? String(reason) : null,
    ip_address: ip_address ? String(ip_address) : null,
    created_at: new Date().toISOString()
  };
  inMemorySheetAuditLogs.push(newLog);
  return newLog;
}

function getSheetAuditLogs(projectIdOrFilters, maybeFilters = {}) {
  let projectId;
  let filters;
  if (typeof projectIdOrFilters === 'object' && projectIdOrFilters !== null) {
    filters = projectIdOrFilters;
    projectId = filters.projectId || filters.project_id;
  } else {
    projectId = projectIdOrFilters;
    filters = maybeFilters || {};
  }

  const { entityType, entityId, action, fromDate, toDate, search, limit = 50, offset = 0 } = filters;

  const filtered = inMemorySheetAuditLogs.filter(l => {
    if (projectId && Number(l.project_id) !== Number(projectId)) return false;
    if (entityType && l.entity_type !== entityType) return false;
    if (entityId && String(l.entity_id) !== String(entityId)) return false;
    if (action && l.action.toUpperCase() !== String(action).toUpperCase()) return false;
    if (fromDate && l.created_at < fromDate) return false;
    if (toDate && l.created_at > `${toDate} 23:59:59`) return false;
    if (search) {
      const s = String(search).toLowerCase();
      const match = (l.change_summary && l.change_summary.toLowerCase().includes(s)) ||
                    (l.reason && l.reason.toLowerCase().includes(s)) ||
                    (l.entity_id && l.entity_id.toLowerCase().includes(s)) ||
                    (l.user_name && l.user_name.toLowerCase().includes(s));
      if (!match) return false;
    }
    return true;
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const total = filtered.length;
  const paged = filtered.slice(Number(offset), Number(offset) + Number(limit));

  return {
    total,
    limit: Number(limit),
    offset: Number(offset),
    data: paged
  };
}

function getSheetAuditLogById(logId) {
  const lId = Number(logId);
  return inMemorySheetAuditLogs.find(l => Number(l.id) === lId) || null;
}

module.exports = {
  inMemoryAcceptanceSheets,
  inMemoryAcceptanceSheetItems,
  inMemoryAcceptanceSheetPhotos,
  getAcceptanceSheets,
  getAcceptanceSheetById,
  getLatestApprovedAcceptanceSheet,
  saveAcceptanceSheet,
  updateAcceptanceSheet,
  deleteAcceptanceSheet,
  saveAcceptanceSheetItem,
  saveAcceptanceSheetPhoto,
  deleteAcceptanceSheetPhoto,
  inMemoryTeamDailyProgress,
  getTeamDailyProgress,
  saveTeamDailyProgress,
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
  inMemorySiteDiaries,
  findWorkItemById,
  getMilestones,
  createMilestoneData,
  getMilestoneAlerts,
  saveMilestoneAlert,
  closeMilestoneAlert,
  getSiteDiaries,
  getSiteDiaryByDate,
  saveSiteDiaryEntry,
  lockSiteDiary,
  unlockSiteDiary,
  inMemoryAuditLogs,
  logAudit,
  getAuditLogs,
  inMemoryDiaryConflicts,
  saveDiaryConflict,
  getDiaryConflicts,
  getDiaryConflictById,
  resolveDiaryConflict,
  inMemorySiteDiaryPhotos,
  getSiteDiaryPhotos,
  saveSiteDiaryPhoto,
  updateSiteDiaryPhoto,
  registerPendingSiteDiaryPhotos,
  deleteSiteDiaryPhoto,
  inMemorySiteDiaryItems,
  getSiteDiaryItems,
  getSiteDiaryItemById,
  saveSiteDiaryItem,
  updateSiteDiaryItem,
  deleteSiteDiaryItem,
  clearSiteDiaryItems,
  getTasks,
  createTaskData,
  updateTaskData,
  deleteTaskData,
  inMemoryTeams,
  inMemoryTaskAssignments,
  getTeams,
  getTeamById,
  createTeamData,
  updateTeamData,
  deleteTeamData,
  assignTaskToTeamData,
  unassignTaskData,
  inMemoryProjectMembers,
  inMemoryProjectInvitations,
  getProjectMembers,
  findProjectMember,
  countProjectManagers,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  getProjectInvitations,
  findPendingInvitation,
  createProjectInvitation,
  acceptProjectInvitation,
  isUserProjectManager,
  inMemorySiteDiaryItemConflicts,
  inMemorySiteDiaryItemHistory,
  saveSiteDiaryItemConflict,
  getSiteDiaryItemConflicts,
  getSiteDiaryItemConflictById,
  updateSiteDiaryItemConflict,
  saveSiteDiaryItemHistory,
  getSiteDiaryItemHistory,
  inMemoryPaymentRequests,
  inMemoryPaymentRequestItems,
  getProjectRetentionRate,
  updateProjectRetentionRate,
  getPaymentRequests,
  getPaymentRequestById,
  savePaymentRequest,
  approvePaymentRequest,
  // S-44 / SCRUM-173: Chủ đầu tư duyệt hoặc trả lại đề nghị thanh toán (T-101, T-102, T-103)
  rejectPaymentRequest,
  updatePaymentRequest,
  deletePaymentRequest,
  // S-43 / SCRUM-172: Sinh đề nghị thanh toán từ phiếu nghiệm thu đã duyệt (T-97, T-98, T-99)
  getApprovedSheetsAvailable,
  linkSheetsToPaymentRequest,
  unlinkSheetsFromPaymentRequest,
  // S-39 / SCRUM-168: Nhật ký thao tác trên phiếu chỉ ghi thêm (Append-only Audit Logs)
  inMemorySheetAuditLogs,
  saveSheetAuditLog,
  getSheetAuditLogs,
  getSheetAuditLogById
};


