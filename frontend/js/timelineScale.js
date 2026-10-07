/**
 * Module chuyển đổi tọa độ trục thời gian (T-30)
 * Pure functions - Không can thiệp DOM
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateToMidnight(dateStr) {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDiffDays(startDateStr, targetDateStr) {
  const start = parseDateToMidnight(startDateStr);
  const target = parseDateToMidnight(targetDateStr);
  return Math.round((target.getTime() - start.getTime()) / MS_PER_DAY);
}

/**
 * Đổi ngày sang tọa độ X theo tỷ lệ xem Ngày hoặc Tuần
 */
function dateToCoordinateX(targetDateStr, startDateStr, unit, dayWidth = 40, weekWidth = 105) {
  const diffDays = getDiffDays(startDateStr, targetDateStr);
  const pxPerDay = unit === 'day' ? dayWidth : weekWidth / 7;
  return Math.round(diffDays * pxPerDay * 100) / 100;
}

/**
 * Tính chiều rộng thanh công việc
 */
function calculateBarWidth(earlyStartStr, earlyFinishStr, unit, dayWidth = 40, weekWidth = 105) {
  const days = Math.max(1, getDiffDays(earlyStartStr, earlyFinishStr));
  const pxPerDay = unit === 'day' ? dayWidth : weekWidth / 7;
  return Math.round(days * pxPerDay * 100) / 100;
}

/**
 * Sinh danh sách vạch chia và nhãn thời gian
 */
function generateTimeTicks(startDateStr, totalDays, unit, dayWidth = 40, weekWidth = 105) {
  const ticks = [];
  const baseDate = parseDateToMidnight(startDateStr);

  if (unit === 'day') {
    for (let day = 0; day <= totalDays; day++) {
      const current = new Date(baseDate.getTime() + day * MS_PER_DAY);
      const dayNum = current.getDate();
      const monthNum = current.getMonth() + 1;
      const isMonday = current.getDay() === 1;

      ticks.push({
        label: isMonday || dayNum === 1 ? `${dayNum}/${monthNum}` : `${dayNum}`,
        x: day * dayWidth,
        isMajor: isMonday || dayNum === 1
      });
    }
  } else {
    const totalWeeks = Math.ceil(totalDays / 7);
    for (let w = 0; w <= totalWeeks; w++) {
      const current = new Date(baseDate.getTime() + w * 7 * MS_PER_DAY);
      const dayNum = current.getDate();
      const monthNum = current.getMonth() + 1;

      ticks.push({
        label: `T${w + 1} (${dayNum}/${monthNum})`,
        x: w * weekWidth,
        isMajor: true
      });
    }
  }
  return ticks;
}

function addDaysToDate(baseDateStr, days) {
  if (typeof days === 'string' && /^\d{4}-\d{2}-\d{2}/.test(days)) return days;
  const d = parseDateToMidnight(baseDateStr);
  d.setDate(d.getDate() + Number(days || 0));
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getDiffDays,
    dateToCoordinateX,
    calculateBarWidth,
    generateTimeTicks,
    addDaysToDate
  };
}
