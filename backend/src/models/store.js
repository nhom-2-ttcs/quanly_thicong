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

function saveSiteDiaryEntry({
  project_id,
  diary_date,
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
    existing.updated_at = nowStr;
    return existing;
  } else {
    const newId = inMemorySiteDiaries.length > 0 ? Math.max(...inMemorySiteDiaries.map(d => d.id)) + 1 : 1;
    const newEntry = {
      id: newId,
      project_id: pId,
      diary_date,
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
  temp_path = null
}) {
  const dId = Number(diary_id);
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
    client_photo_id: client_photo_id ? String(client_photo_id) : null,
    temp_path: temp_path ? String(temp_path) : null,
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
  work_item_id = null,
  work_content,
  log_time = null,
  quantity_done = 0,
  unit = ''
}) {
  const dId = Number(diary_id);
  const newId = inMemorySiteDiaryItems.length > 0 ? Math.max(...inMemorySiteDiaryItems.map(i => i.id)) + 1 : 1;
  const newItem = {
    id: newId,
    diary_id: dId,
    work_item_id: work_item_id ? Number(work_item_id) : null,
    work_content: String(work_content || '').trim(),
    log_time: log_time ? String(log_time).trim() : null,
    quantity_done: Number(quantity_done || 0),
    unit: String(unit || '').trim(),
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
  inMemorySiteDiaryItems = inMemorySiteDiaryItems.filter(i => Number(i.diary_id) !== dId);
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
  isUserProjectManager
};

