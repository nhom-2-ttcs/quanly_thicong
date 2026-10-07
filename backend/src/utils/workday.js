/**
 * Utility module for T-39 / T-44: Working days calculation.
 * Counts working days (excluding Saturdays and Sundays) between two dates or day offsets.
 */

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    const d = new Date(val);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (typeof val === 'number') {
    return val;
  }
  if (typeof val === 'string') {
    // If it's a numeric string like "10"
    if (/^\d+$/.test(val.trim())) {
      return Number(val.trim());
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      return d;
    }
  }
  return null;
}

/**
 * Counts working days (excluding weekends) between startDate and endDate.
 * If startDate >= endDate, returns 0.
 * If inputs are numeric day offsets (e.g. day 10 vs day 14), returns (endDate - startDate).
 *
 * @param {string|Date|number} startDate - Milestone due date or start date
 * @param {string|Date|number} endDate - Max Early Finish date or end date
 * @returns {number} Number of working days overdue / elapsed
 */
function countWorkingDays(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  if (start === null || end === null) return 0;

  // If both inputs are numeric day offsets (e.g. 10 and 14)
  if (typeof start === 'number' && typeof end === 'number') {
    const diff = Math.ceil(end - start);
    return diff > 0 ? diff : 0;
  }

  // If one is date and the other is number, project start date fallback
  let startObj = start;
  let endObj = end;
  const projectBaseDate = new Date('2026-10-01T00:00:00Z');

  if (typeof start === 'number' && endObj instanceof Date) {
    startObj = addWorkingDays(projectBaseDate, start);
  } else if (startObj instanceof Date && typeof end === 'number') {
    endObj = addWorkingDays(projectBaseDate, end);
  }

  if (startObj >= endObj) {
    return 0;
  }

  let count = 0;
  const cur = new Date(startObj);
  // Move to the next day to start counting overrun days
  cur.setDate(cur.getDate() + 1);

  while (cur <= endObj) {
    const dayOfWeek = cur.getDay(); // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
    cur.setDate(cur.getDate() + 1);
  }

  return count;
}

/**
 * Adds N working days to a base date, skipping weekends.
 * @param {Date|string} baseDate 
 * @param {number} days 
 * @returns {Date}
 */
function addWorkingDays(baseDate, days) {
  const d = parseDate(baseDate) || new Date('2026-10-01T00:00:00Z');
  const result = new Date(d);
  let added = 0;
  const totalDays = Math.ceil(days);

  while (added < totalDays) {
    result.setDate(result.getDate() + 1);
    const dayOfWeek = result.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      added++;
    }
  }
  return result;
}

module.exports = {
  parseDate,
  countWorkingDays,
  addWorkingDays
};
