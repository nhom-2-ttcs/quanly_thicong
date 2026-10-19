/**
 * S-01: Ngày khởi công dự án.
 * Lưu dạng DATE (YYYY-MM-DD). Không có ngày khởi công => null, không tự gán ngày giả.
 */
const { inMemoryProjects } = require('../models/store');

function isValidCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// mysql2 trả cột DATE thành Date theo múi giờ local của tiến trình Node.
function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).slice(0, 10);
  return isValidCalendarDate(s) ? s : null;
}

function withStartDate(project) {
  if (!project) return project;
  return { ...project, start_date: toDateString(project.start_date) };
}

async function getProjectStartDate(db, projectId) {
  const pool = db?.pool || db;
  if (!db || db.isConnected === false || !pool || typeof pool.query !== 'function') {
    const p = inMemoryProjects.find(x => Number(x.id) === Number(projectId));
    return toDateString(p?.start_date);
  }
  try {
    const [rows] = await pool.query('SELECT start_date FROM projects WHERE id = ?', [projectId]);
    return toDateString(rows?.[0]?.start_date);
  } catch {
    const p = inMemoryProjects.find(x => Number(x.id) === Number(projectId));
    return toDateString(p?.start_date);
  }
}

module.exports = { isValidCalendarDate, toDateString, withStartDate, getProjectStartDate };
