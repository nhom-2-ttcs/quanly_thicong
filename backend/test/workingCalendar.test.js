const assert = require('assert');
const {
  isWorkingDay,
  calculateFinishDate,
  calculateStartDate,
  countWorkingDays,
  addWorkingDaysLag,
  getSuccessorStartFromFS,
  parseDate
} = require('../src/services/workingCalendarService');

console.log('================================================================');
console.log('🧪 BỘ TEST TÍNH TAY: LỊCH LÀM VIỆC CÔNG TRƯỜNG & NGÀY NGHỈ LỄ (S-17)');
console.log('================================================================');

// -----------------------------------------------------------------------------
// TC 1: AC 1 - Lịch 6 ngày/tuần, việc 6 ngày bắt đầu Thứ Năm -> kết thúc Thứ Tư tuần sau
// -----------------------------------------------------------------------------
function testAC1_SixDaysWorkStartingThursday() {
  console.log('\n--- Kiểm tra AC 1: Việc 6 ngày bắt đầu Thứ Năm (Lịch 6 ngày/tuần) ---');
  // Ngày 2026-10-08 là Thứ Năm (getDay() === 4)
  const startDate = '2026-10-08';
  assert.strictEqual(parseDate(startDate).getDay(), 4, '2026-10-08 phải là Thứ Năm');

  const config6Days = { work_days_per_week: 6 };
  const holidays = [];

  const finishDate = calculateFinishDate(startDate, 6, config6Days, holidays);
  console.log(`Bắt đầu: ${startDate} (Thứ Năm), Thời lượng: 6 ngày làm việc`);
  console.log(`Kết thúc thực tế: ${finishDate} (Thứ ${parseDate(finishDate).getDay() + 1})`);

  // Phải kết thúc vào Thứ Tư tuần sau (2026-10-14, getDay() === 3)
  assert.strictEqual(finishDate, '2026-10-14', 'Phải kết thúc vào Thứ Tư tuần sau (2026-10-14)');
  assert.strictEqual(parseDate(finishDate).getDay(), 3, 'Ngày kết thúc phải là Thứ Tư');

  // Đếm số ngày làm việc thực tế giữa 2 mốc
  const worked = countWorkingDays(startDate, finishDate, config6Days, holidays);
  assert.strictEqual(worked, 6, 'Số ngày làm việc thực tế phải đúng bằng 6');

  console.log('✅ AC 1 ĐẠT: Bỏ qua Chủ Nhật, kết thúc chuẩn xác vào Thứ Tư tuần sau!');
}

// -----------------------------------------------------------------------------
// TC 2: AC 2 - Khai ngày lễ rơi vào giữa việc -> Việc dài thêm đúng số ngày lễ, lùi việc sau
// -----------------------------------------------------------------------------
function testAC2_HolidayInBetweenExtendsDuration() {
  console.log('\n--- Kiểm tra AC 2: Ngày lễ rơi vào giữa công việc ---');
  const startDate = '2026-10-08'; // Thứ Năm
  const config6Days = { work_days_per_week: 6 };

  // Khai Thứ Sáu (2026-10-09) là ngày nghỉ lễ
  const holidays = [{ name: 'Nghỉ Lễ Công Trường', holiday_date: '2026-10-09' }];

  const finishDateWithHoliday = calculateFinishDate(startDate, 6, config6Days, holidays);
  console.log(`Khai ngày lễ: 2026-10-09 (Thứ Sáu)`);
  console.log(`Kết thúc mới: ${finishDateWithHoliday} (Thứ ${parseDate(finishDateWithHoliday).getDay() + 1})`);

  // Phải lùi đúng 1 ngày làm việc: từ Thứ Tư (2026-10-14) sang Thứ Năm (2026-10-15)
  assert.strictEqual(finishDateWithHoliday, '2026-10-15', 'Kết thúc phải lùi sang Thứ Năm tuần sau (2026-10-15)');
  assert.strictEqual(parseDate(finishDateWithHoliday).getDay(), 4, 'Ngày kết thúc phải là Thứ Năm');

  // Khai thêm 1 ngày lễ nữa vào Thứ Hai (2026-10-12)
  const holidays2 = [
    { name: 'Nghỉ Lễ 1', holiday_date: '2026-10-09' },
    { name: 'Nghỉ Lễ 2', holiday_date: '2026-10-12' }
  ];
  const finishDate2Holidays = calculateFinishDate(startDate, 6, config6Days, holidays2);
  console.log(`Khai thêm ngày lễ 2026-10-12 => Kết thúc: ${finishDate2Holidays}`);
  assert.strictEqual(finishDate2Holidays, '2026-10-16', 'Có 2 ngày lễ phải lùi sang Thứ Sáu tuần sau (2026-10-16)');

  console.log('✅ AC 2 ĐẠT: Công việc tự động kéo dài thêm đúng số ngày lễ và lùi mốc hoàn thành!');
}

// -----------------------------------------------------------------------------
// TC 3: AC 3 - Đổi lịch sang 5 ngày/tuần -> Toàn bộ tiến độ tính lại và ngày hoàn thành đổi
// -----------------------------------------------------------------------------
function testAC3_SwitchToFiveDaysWeek() {
  console.log('\n--- Kiểm tra AC 3: Đổi lịch sang 5 ngày/tuần (Nghỉ Thứ 7 & Chủ Nhật) ---');
  const startDate = '2026-10-08'; // Thứ Năm
  const config5Days = { work_days_per_week: 5 };
  const holidays = [];

  const finishDate5Days = calculateFinishDate(startDate, 6, config5Days, holidays);
  console.log(`Lịch 5 ngày/tuần: Bắt đầu Thứ Năm, việc 6 ngày`);
  console.log(`Kết thúc: ${finishDate5Days} (Thứ ${parseDate(finishDate5Days).getDay() + 1})`);

  // Với 5 ngày/tuần:
  // T5(1), T6(2), T7(Nghỉ), CN(Nghỉ), T2(3), T3(4), T4(5), T5(6) => Kết thúc 2026-10-15
  assert.strictEqual(finishDate5Days, '2026-10-15', 'Với 5 ngày/tuần, kết thúc phải là Thứ Năm (2026-10-15)');
  assert.notStrictEqual(finishDate5Days, '2026-10-14', 'Ngày kết thúc phải khác so với lịch 6 ngày/tuần');

  console.log('✅ AC 3 ĐẠT: Chuyển sang 5 ngày/tuần tự động tính lại tiến độ và đổi ngày hoàn thành!');
}

// -----------------------------------------------------------------------------
// TC 4: AC 4 - Ngày lễ trùng Chủ Nhật -> Không trừ 2 lần
// -----------------------------------------------------------------------------
function testAC4_HolidayOnSundayNotDeductedTwice() {
  console.log('\n--- Kiểm tra AC 4: Ngày lễ trùng Chủ Nhật không trừ 2 lần ---');
  const startDate = '2026-10-08'; // Thứ Năm
  const config6Days = { work_days_per_week: 6 };

  // 2026-10-11 là Chủ Nhật
  assert.strictEqual(parseDate('2026-10-11').getDay(), 0, '2026-10-11 phải là Chủ Nhật');

  // Khai ngày lễ trùng đúng vào Chủ Nhật
  const holidays = [{ name: 'Lễ Trùng Chủ Nhật', holiday_date: '2026-10-11' }];

  // Kiểm tra isWorkingDay
  assert.strictEqual(isWorkingDay('2026-10-11', config6Days, holidays), false, 'Chủ Nhật là ngày nghỉ');
  assert.strictEqual(isWorkingDay('2026-10-12', config6Days, holidays), true, 'Thứ Hai vẫn là ngày làm việc bình thường');

  const finishDate = calculateFinishDate(startDate, 6, config6Days, holidays);
  console.log(`Khai lễ trùng Chủ Nhật 2026-10-11 => Kết thúc: ${finishDate}`);

  // Vì trùng Chủ Nhật (vốn đã nghỉ), không được trừ 2 lần => ngày kết thúc vẫn phải là 2026-10-14
  assert.strictEqual(finishDate, '2026-10-14', 'Không được trừ 2 lần! Ngày kết thúc vẫn là Thứ Tư (2026-10-14)');

  console.log('✅ AC 4 ĐẠT: Lễ trùng Chủ Nhật được xử lý chuẩn xác, không bị trừ lặp!');
}

// -----------------------------------------------------------------------------
// TC 5: AC 5 - Độ trễ trong quan hệ phụ thuộc là 2 ngày -> Cũng là 2 ngày làm việc
// -----------------------------------------------------------------------------
function testAC5_LagCalculatedAsWorkingDays() {
  console.log('\n--- Kiểm tra AC 5: Độ trễ (Lag) tính theo ngày làm việc ---');
  const config6Days = { work_days_per_week: 6 };

  // Việc A kết thúc Thứ Năm (2026-10-08)
  // Quan hệ FS có độ trễ 2 ngày làm việc:
  // - Ngày trễ 1: Thứ Sáu (2026-10-09)
  // - Ngày trễ 2: Thứ Bảy (2026-10-10)
  // - Chủ Nhật (2026-10-11): Nghỉ
  // => Việc B bắt đầu vào: Thứ Hai (2026-10-12)
  const successorStart1 = getSuccessorStartFromFS('2026-10-08', 2, config6Days, []);
  console.log(`Việc A kết thúc: 2026-10-08 (Thứ Năm), Lag: 2 ngày làm việc`);
  console.log(`Việc B bắt đầu: ${successorStart1} (Thứ ${parseDate(successorStart1).getDay() + 1})`);
  assert.strictEqual(successorStart1, '2026-10-12', 'Việc B phải bắt đầu vào Thứ Hai tuần sau (2026-10-12)');

  // Trường hợp có ngày lễ rơi vào thời gian trễ:
  // Thứ Sáu (2026-10-09) là ngày lễ:
  // - Thứ Sáu: Lễ (bỏ qua)
  // - Ngày trễ 1: Thứ Bảy (2026-10-10)
  // - Chủ Nhật: Nghỉ
  // - Ngày trễ 2: Thứ Hai (2026-10-12)
  // => Việc B bắt đầu vào: Thứ Ba (2026-10-13)
  const holidays = [{ name: 'Lễ Thứ Sáu', holiday_date: '2026-10-09' }];
  const successorStart2 = getSuccessorStartFromFS('2026-10-08', 2, config6Days, holidays);
  console.log(`Khi Thứ Sáu là ngày lễ => Việc B bắt đầu: ${successorStart2} (Thứ ${parseDate(successorStart2).getDay() + 1})`);
  assert.strictEqual(successorStart2, '2026-10-13', 'Có lễ trong thời gian lag => B bắt đầu vào Thứ Ba (2026-10-13)');

  console.log('✅ AC 5 ĐẠT: Độ trễ quan hệ phụ thuộc tuân thủ đúng 2 ngày làm việc công trường!');
}

// -----------------------------------------------------------------------------
// Chạy toàn bộ các bài test tính tay
// -----------------------------------------------------------------------------
try {
  testAC1_SixDaysWorkStartingThursday();
  testAC2_HolidayInBetweenExtendsDuration();
  testAC3_SwitchToFiveDaysWeek();
  testAC4_HolidayOnSundayNotDeductedTwice();
  testAC5_LagCalculatedAsWorkingDays();
  console.log('\n================================================================');
  console.log('🎉 TOÀN BỘ 5 TIÊU CHÍ CHẤP NHẬN (AC 1 -> AC 5) ĐÃ ĐẠT 100%!');
  console.log('================================================================');
} catch (err) {
  console.error('\n❌ TEST THẤT BẠI:', err.message);
  process.exit(1);
}
