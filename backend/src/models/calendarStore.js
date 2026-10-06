/**
 * Calendar & Holiday Data Store (S-17 / SCRUM-103 / T-38)
 * Hỗ trợ lưu trữ CSDL MySQL và In-memory fallback khi chạy môi trường không có MySQL.
 */

const inMemoryCalendars = new Map();
const inMemoryHolidays = [];
let nextHolidayId = 1;

// Khởi tạo lịch mặc định dự án 1 (6 ngày/tuần: T2 -> T7, nghỉ CN)
inMemoryCalendars.set(1, {
  id: 1,
  project_id: 1,
  work_days_per_week: 6,
  working_days_mask: '1,2,3,4,5,6',
  description: 'Lịch làm việc mặc định công trường 6 ngày/tuần, nghỉ Chủ Nhật'
});

// Seed một số ngày lễ mẫu trong năm 2026 cho dự án 1
const defaultHolidays = [
  { project_id: 1, name: 'Tết Dương Lịch 2026', holiday_date: '2026-01-01' },
  { project_id: 1, name: 'Giỗ Tổ Hùng Vương 2026', holiday_date: '2026-04-26' },
  { project_id: 1, name: 'Kỷ niệm Ngày Chiến thắng', holiday_date: '2026-04-30' },
  { project_id: 1, name: 'Ngày Quốc tế Lao động', holiday_date: '2026-05-01' },
  { project_id: 1, name: 'Quốc Khánh 2026', holiday_date: '2026-09-02' }
];

for (const h of defaultHolidays) {
  inMemoryHolidays.push({
    id: nextHolidayId++,
    project_id: h.project_id,
    name: h.name,
    holiday_date: h.holiday_date,
    created_at: new Date()
  });
}

let dbAvailable = null;

function getPool() {
  if (dbAvailable === false) return null;
  try {
    const db = require('../../db');
    return db && db.pool ? db.pool : null;
  } catch (e) {
    dbAvailable = false;
    return null;
  }
}

function handleDbError(err) {
  if (err && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT' || err.message?.includes('connect'))) {
    dbAvailable = false;
  }
}

/**
 * Lấy cấu hình lịch của dự án (mặc định 6 ngày/tuần nếu chưa cấu hình)
 */
async function getCalendar(projectId = 1) {
  const pId = parseInt(projectId, 10) || 1;
  const pool = getPool();

  if (pool) {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM calendars WHERE project_id = ?',
        [pId]
      );
      if (rows && rows.length > 0) {
        return rows[0];
      }
    } catch (err) {
      handleDbError(err);
      // Fallback về in-memory nếu lỗi truy vấn MySQL
    }
  }

  // Fallback in-memory
  if (inMemoryCalendars.has(pId)) {
    return inMemoryCalendars.get(pId);
  }

  // Mặc định 6 ngày/tuần nếu chưa có
  const defaultCal = {
    id: pId,
    project_id: pId,
    work_days_per_week: 6,
    working_days_mask: '1,2,3,4,5,6',
    description: 'Lịch làm việc mặc định công trường 6 ngày/tuần, nghỉ Chủ Nhật'
  };
  inMemoryCalendars.set(pId, defaultCal);
  return defaultCal;
}

/**
 * Lưu / cập nhật cấu hình lịch làm việc cho dự án (5 ngày hoặc 6 ngày/tuần)
 */
async function saveCalendar(projectId = 1, { work_days_per_week = 6, working_days_mask, description }) {
  const pId = parseInt(projectId, 10) || 1;
  const daysPerWeek = parseInt(work_days_per_week, 10) === 5 ? 5 : 6;
  const mask = working_days_mask || (daysPerWeek === 5 ? '1,2,3,4,5' : '1,2,3,4,5,6');
  const desc = description || (daysPerWeek === 5 
    ? 'Lịch làm việc 5 ngày/tuần, nghỉ Thứ 7 và Chủ Nhật' 
    : 'Lịch làm việc mặc định 6 ngày/tuần, nghỉ Chủ Nhật');

  const pool = getPool();
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO calendars (project_id, work_days_per_week, working_days_mask, description)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
            work_days_per_week = VALUES(work_days_per_week),
            working_days_mask = VALUES(working_days_mask),
            description = VALUES(description)`,
        [pId, daysPerWeek, mask, desc]
      );
    } catch (err) {
      handleDbError(err);
      // Tiếp tục cập nhật in-memory
    }
  }

  const calData = {
    id: pId,
    project_id: pId,
    work_days_per_week: daysPerWeek,
    working_days_mask: mask,
    description: desc,
    updated_at: new Date()
  };
  inMemoryCalendars.set(pId, calData);
  return calData;
}

/**
 * Lấy danh sách ngày nghỉ lễ theo dự án (bao gồm ngày lễ chung project_id IS NULL)
 */
async function getHolidays(projectId = 1) {
  const pId = parseInt(projectId, 10) || 1;
  const pool = getPool();

  if (pool) {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM holidays WHERE project_id = ? OR project_id IS NULL ORDER BY holiday_date ASC',
        [pId]
      );
      if (rows) {
        return rows.map(r => ({
          ...r,
          holiday_date: typeof r.holiday_date === 'string' ? r.holiday_date.slice(0, 10) : new Date(r.holiday_date).toISOString().slice(0, 10)
        }));
      }
    } catch (err) {
      handleDbError(err);
      // Fallback về in-memory
    }
  }

  return inMemoryHolidays
    .filter(h => h.project_id === pId || h.project_id === null)
    .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
}

/**
 * Thêm một ngày nghỉ lễ mới
 */
async function addHoliday(projectId = 1, { name, holiday_date }) {
  const pId = parseInt(projectId, 10) || 1;
  if (!name || !name.trim()) {
    throw new Error('Tên ngày nghỉ lễ không được để trống');
  }
  if (!holiday_date || !/^\d{4}-\d{2}-\d{2}$/.test(holiday_date.trim())) {
    throw new Error('Ngày lễ không hợp lệ (định dạng YYYY-MM-DD)');
  }
  const cleanDate = holiday_date.trim();

  // Kiểm tra trùng ngày lễ
  const existing = await getHolidays(pId);
  if (existing.some(h => h.holiday_date === cleanDate)) {
    throw new Error(`Ngày lễ "${cleanDate}" đã tồn tại trong dự án!`);
  }

  const pool = getPool();
  let insertId = null;

  if (pool) {
    try {
      const [res] = await pool.query(
        'INSERT INTO holidays (project_id, name, holiday_date) VALUES (?, ?, ?)',
        [pId, name.trim(), cleanDate]
      );
      insertId = res.insertId;
    } catch (err) {
      handleDbError(err);
      // Tiếp tục in-memory
    }
  }

  if (!insertId) {
    insertId = nextHolidayId++;
  }

  const newHoliday = {
    id: insertId,
    project_id: pId,
    name: name.trim(),
    holiday_date: cleanDate,
    created_at: new Date()
  };
  inMemoryHolidays.push(newHoliday);
  return newHoliday;
}

/**
 * Xóa một ngày nghỉ lễ
 */
async function deleteHoliday(id, projectId = 1) {
  const holidayId = parseInt(id, 10);
  const pId = parseInt(projectId, 10) || 1;
  const pool = getPool();

  if (pool) {
    try {
      await pool.query(
        'DELETE FROM holidays WHERE id = ? AND (project_id = ? OR project_id IS NULL)',
        [holidayId, pId]
      );
    } catch (err) {
      handleDbError(err);
      // Tiếp tục in-memory
    }
  }


  const idx = inMemoryHolidays.findIndex(h => h.id === holidayId && (h.project_id === pId || h.project_id === null));
  if (idx !== -1) {
    inMemoryHolidays.splice(idx, 1);
    return true;
  }
  return false;
}

/**
 * Reset store (tiện ích cho unit test)
 */
function resetStore() {
  inMemoryCalendars.clear();
  inMemoryCalendars.set(1, {
    id: 1,
    project_id: 1,
    work_days_per_week: 6,
    working_days_mask: '1,2,3,4,5,6',
    description: 'Lịch làm việc mặc định công trường 6 ngày/tuần, nghỉ Chủ Nhật'
  });
  inMemoryHolidays.length = 0;
  nextHolidayId = 1;
  for (const h of defaultHolidays) {
    inMemoryHolidays.push({
      id: nextHolidayId++,
      project_id: h.project_id,
      name: h.name,
      holiday_date: h.holiday_date,
      created_at: new Date()
    });
  }
}

module.exports = {
  getCalendar,
  saveCalendar,
  getHolidays,
  addHoliday,
  deleteHoliday,
  resetStore,
  inMemoryCalendars,
  inMemoryHolidays
};
