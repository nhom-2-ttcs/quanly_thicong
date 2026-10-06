/**
 * Working Calendar Service (S-17 / SCRUM-104 / T-39)
 * 
 * Tính toán ngày làm việc thực tế cho công trường:
 * - Trừ ngày nghỉ cuối tuần (mặc định 6 ngày/tuần: nghỉ Chủ Nhật; hoặc 5 ngày/tuần: nghỉ T7 & CN).
 * - Trừ các ngày nghỉ lễ đã khai báo.
 * - Xử lý lễ trùng ngày nghỉ cuối tuần (không trừ 2 lần theo AC 4).
 * - Tính độ trễ (Lag/Lead) trong quan hệ phụ thuộc theo ngày làm việc (AC 5).
 */

function parseDate(dateInput) {
  if (dateInput instanceof Date) {
    return new Date(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate());
  }
  if (typeof dateInput === 'string') {
    const parts = dateInput.slice(0, 10).split('-');
    if (parts.length === 3) {
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
  }
  throw new Error(`Định dạng ngày không hợp lệ: ${dateInput}`);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addCalendarDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getHolidaySet(holidays = []) {
  const set = new Set();
  if (Array.isArray(holidays)) {
    for (const h of holidays) {
      if (!h) continue;
      if (typeof h === 'string') {
        set.add(h.slice(0, 10));
      } else if (h.holiday_date) {
        const dStr = typeof h.holiday_date === 'string' 
          ? h.holiday_date.slice(0, 10) 
          : formatDate(new Date(h.holiday_date));
        set.add(dStr);
      }
    }
  }
  return set;
}

/**
 * Kiểm tra xem một ngày có phải là ngày làm việc hay không.
 * AC 4: Nếu ngày lễ trùng ngày nghỉ (ví dụ trùng Chủ Nhật), hàm chỉ xác định là ngày nghỉ (không trừ lặp).
 * 
 * @param {string|Date} dateInput 
 * @param {object} calendarConfig { work_days_per_week: 6 hoặc 5 }
 * @param {Array} holidays Danh sách ngày lễ
 * @returns {boolean}
 */
function isWorkingDay(dateInput, calendarConfig = { work_days_per_week: 6 }, holidays = []) {
  const d = parseDate(dateInput);
  const dateStr = formatDate(d);
  const dayOfWeek = d.getDay(); // 0: Chủ Nhật, 1..6: T2..T7

  const workDaysPerWeek = (calendarConfig && parseInt(calendarConfig.work_days_per_week, 10) === 5) ? 5 : 6;
  
  // Kiểm tra ngày nghỉ cuối tuần
  const isWeekend = (workDaysPerWeek === 5) 
    ? (dayOfWeek === 0 || dayOfWeek === 6) // Nghỉ T7 & CN
    : (dayOfWeek === 0);                  // Nghỉ CN

  if (isWeekend) {
    // Là ngày nghỉ cuối tuần => Không phải ngày làm việc
    // (Dù có trùng ngày lễ thì cũng chỉ trả về false, không tính 2 lần)
    return false;
  }

  // Kiểm tra ngày lễ
  const holidaySet = getHolidaySet(holidays);
  if (holidaySet.has(dateStr)) {
    return false;
  }

  return true;
}

/**
 * Tìm ngày làm việc hợp lệ đầu tiên bắt đầu từ hoặc sau ngày dateInput.
 * Nếu dateInput rơi vào Chủ Nhật hoặc ngày lễ, sẽ tịnh tiến tới ngày làm việc kế tiếp.
 */
function getNextWorkingDay(dateInput, calendarConfig = { work_days_per_week: 6 }, holidays = []) {
  let cur = parseDate(dateInput);
  while (!isWorkingDay(cur, calendarConfig, holidays)) {
    cur = addCalendarDays(cur, 1);
  }
  return cur;
}

/**
 * Tìm ngày làm việc hợp lệ lùi về trước từ hoặc trước ngày dateInput.
 */
function getPrevWorkingDay(dateInput, calendarConfig = { work_days_per_week: 6 }, holidays = []) {
  let cur = parseDate(dateInput);
  while (!isWorkingDay(cur, calendarConfig, holidays)) {
    cur = addCalendarDays(cur, -1);
  }
  return cur;
}

/**
 * Tính ngày kết thúc của công việc dựa trên ngày bắt đầu và thời lượng (working days).
 * 
 * AC 1: Lịch 6 ngày/tuần, việc 6 ngày bắt đầu Thứ Năm -> kết thúc Thứ Tư tuần sau (bỏ qua CN).
 * AC 2: Ngày lễ rơi vào giữa việc -> việc dài thêm đúng số ngày lễ, ngày kết thúc lùi theo.
 * AC 3: Đổi sang 5 ngày/tuần -> ngày hoàn thành đổi tương ứng (nghỉ thêm T7).
 * AC 4: Lễ trùng Chủ Nhật -> không trừ 2 lần.
 * 
 * @param {string|Date} startDateInput 
 * @param {number} duration Số ngày làm việc (working days)
 * @param {object} calendarConfig { work_days_per_week: 6|5 }
 * @param {Array} holidays 
 * @returns {string} Ngày kết thúc (YYYY-MM-DD)
 */
function calculateFinishDate(startDateInput, duration = 1, calendarConfig = { work_days_per_week: 6 }, holidays = []) {
  const dur = parseInt(duration, 10);
  if (isNaN(dur) || dur <= 0) {
    const s = getNextWorkingDay(startDateInput, calendarConfig, holidays);
    return formatDate(s);
  }

  // Ngày làm việc thứ 1
  let cur = getNextWorkingDay(startDateInput, calendarConfig, holidays);
  let workedDays = 1;

  while (workedDays < dur) {
    cur = addCalendarDays(cur, 1);
    if (isWorkingDay(cur, calendarConfig, holidays)) {
      workedDays++;
    }
  }

  return formatDate(cur);
}

/**
 * Tính ngày bắt đầu từ ngày kết thúc và thời lượng làm việc (cho backward pass).
 * 
 * @param {string|Date} finishDateInput 
 * @param {number} duration Số ngày làm việc
 * @param {object} calendarConfig 
 * @param {Array} holidays 
 * @returns {string} Ngày bắt đầu (YYYY-MM-DD)
 */
function calculateStartDate(finishDateInput, duration = 1, calendarConfig = { work_days_per_week: 6 }, holidays = []) {
  const dur = parseInt(duration, 10);
  if (isNaN(dur) || dur <= 0) {
    const f = getPrevWorkingDay(finishDateInput, calendarConfig, holidays);
    return formatDate(f);
  }

  let cur = getPrevWorkingDay(finishDateInput, calendarConfig, holidays);
  let workedDays = 1;

  while (workedDays < dur) {
    cur = addCalendarDays(cur, -1);
    if (isWorkingDay(cur, calendarConfig, holidays)) {
      workedDays++;
    }
  }

  return formatDate(cur);
}

/**
 * Đếm số ngày làm việc giữa hai mốc ngày (bao gồm cả start và end).
 */
function countWorkingDays(startDateInput, endDateInput, calendarConfig = { work_days_per_week: 6 }, holidays = []) {
  const start = parseDate(startDateInput);
  const end = parseDate(endDateInput);

  if (start > end) {
    return 0;
  }

  let count = 0;
  let cur = new Date(start);

  while (cur <= end) {
    if (isWorkingDay(cur, calendarConfig, holidays)) {
      count++;
    }
    cur = addCalendarDays(cur, 1);
  }

  return count;
}

/**
 * AC 5: Tính mốc ngày khi cộng thêm số ngày trễ (Lag) theo ngày làm việc.
 * Độ trễ 2 ngày trong quan hệ phụ thuộc cũng là 2 ngày làm việc (bỏ qua CN/lễ).
 * 
 * @param {string|Date} baseDate Mốc ngày cơ sở
 * @param {number} lagDays Số ngày trễ (dương = trễ, âm = sớm, 0 = không trễ)
 * @param {object} calendarConfig 
 * @param {Array} holidays 
 * @returns {string} Ngày sau độ trễ (YYYY-MM-DD)
 */
function addWorkingDaysLag(baseDate, lagDays = 0, calendarConfig = { work_days_per_week: 6 }, holidays = []) {
  const lag = parseInt(lagDays, 10) || 0;
  let cur = parseDate(baseDate);

  if (lag === 0) {
    return formatDate(cur);
  }

  if (lag > 0) {
    let counted = 0;
    while (counted < lag) {
      cur = addCalendarDays(cur, 1);
      if (isWorkingDay(cur, calendarConfig, holidays)) {
        counted++;
      }
    }
    return formatDate(cur);
  } else {
    // lag âm (Lead time)
    let counted = 0;
    const target = Math.abs(lag);
    while (counted < target) {
      cur = addCalendarDays(cur, -1);
      if (isWorkingDay(cur, calendarConfig, holidays)) {
        counted++;
      }
    }
    return formatDate(cur);
  }
}

/**
 * Lấy ngày làm việc kế tiếp ngay sau một ngày kết thúc (cho quan hệ Finish-to-Start).
 * Ví dụ: Công việc A kết thúc Thứ Năm -> Công việc B bắt đầu Thứ Sáu (nếu lag = 0).
 * Nếu có lag = 2 ngày làm việc (AC 5):
 * - Ngày kết thúc A: Thứ Năm.
 * - Ngày trễ 1: Thứ Sáu.
 * - Ngày trễ 2: Thứ Bảy.
 * - [CN nghỉ]
 * - B bắt đầu: Thứ Hai tuần sau.
 */
function getSuccessorStartFromFS(finishDate, lag = 0, calendarConfig = { work_days_per_week: 6 }, holidays = []) {
  const lagVal = parseInt(lag, 10) || 0;
  if (lagVal === 0) {
    // Bắt đầu vào ngày làm việc tiếp theo ngay sau ngày kết thúc của việc trước
    const nextDay = addCalendarDays(parseDate(finishDate), 1);
    return formatDate(getNextWorkingDay(nextDay, calendarConfig, holidays));
  } else if (lagVal > 0) {
    // Trải qua lagVal ngày làm việc, sau đó lấy ngày làm việc tiếp theo
    let cur = parseDate(finishDate);
    let counted = 0;
    while (counted < lagVal) {
      cur = addCalendarDays(cur, 1);
      if (isWorkingDay(cur, calendarConfig, holidays)) {
        counted++;
      }
    }
    const nextDay = addCalendarDays(cur, 1);
    return formatDate(getNextWorkingDay(nextDay, calendarConfig, holidays));
  } else {
    // Lag âm: B có thể bắt đầu sớm hơn ngày kết thúc của A
    // Ví dụ lag = -1: B bắt đầu vào ngày làm việc cuối cùng của A
    return calculateStartDate(finishDate, Math.abs(lagVal) + 1, calendarConfig, holidays);
  }
}

module.exports = {
  parseDate,
  formatDate,
  addCalendarDays,
  isWorkingDay,
  getNextWorkingDay,
  getPrevWorkingDay,
  calculateFinishDate,
  calculateStartDate,
  countWorkingDays,
  addWorkingDaysLag,
  getSuccessorStartFromFS
};
