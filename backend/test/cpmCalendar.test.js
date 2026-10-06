const assert = require('assert');
const { calculateCPMWithCalendar } = require('../src/algorithms/cpmCalendarEngine');
const calendarStore = require('../src/models/calendarStore');

console.log('================================================================');
console.log('🧪 BỘ TEST TÍCH HỢP CPM & LỊCH LÀM VIỆC DỰ ÁN (S-17 / T-40)');
console.log('================================================================');

function testCPMWithCalendar_Baseline() {
  console.log('\n--- Test 1: CPM cơ bản với lịch 6 ngày/tuần (Bắt đầu Thứ Năm 2026-10-08) ---');
  // Task A: duration 6 ngày làm việc (Thứ Năm -> Thứ Tư tuần sau 2026-10-14)
  // Task B: duration 3 ngày làm việc (FS sau A, lag = 0 => Thứ Năm 2026-10-15 -> Thứ Bảy 2026-10-17)
  const tasks = [
    { id: 'A', name: 'Công việc A', duration: 6, predecessors: [] },
    { id: 'B', name: 'Công việc B', duration: 3, predecessors: [{ id: 'A', type: 'FS', lag: 0 }] }
  ];

  const result = calculateCPMWithCalendar(tasks, {
    projectStartDate: '2026-10-08',
    calendarConfig: { work_days_per_week: 6 },
    holidays: []
  });

  const taskA = result.tasks.find(t => t.id === 'A');
  const taskB = result.tasks.find(t => t.id === 'B');

  console.log(`Task A: ${taskA.earlyStartDate} -> ${taskA.earlyFinishDate}`);
  console.log(`Task B: ${taskB.earlyStartDate} -> ${taskB.earlyFinishDate}`);
  console.log(`Project End Date: ${result.projectEndDate}`);

  assert.strictEqual(taskA.earlyStartDate, '2026-10-08', 'Task A phải bắt đầu vào 2026-10-08');
  assert.strictEqual(taskA.earlyFinishDate, '2026-10-14', 'Task A (6 ngày) phải kết thúc vào 2026-10-14 (Thứ Tư)');
  assert.strictEqual(taskB.earlyStartDate, '2026-10-15', 'Task B phải bắt đầu vào 2026-10-15 (Thứ Năm)');
  assert.strictEqual(taskB.earlyFinishDate, '2026-10-17', 'Task B (3 ngày: T5, T6, T7) phải kết thúc vào 2026-10-17 (Thứ Bảy)');
  assert.strictEqual(result.projectEndDate, '2026-10-17', 'Ngày kết thúc dự án phải là 2026-10-17');

  console.log('✅ Test 1 ĐẠT: CPM Forward & Backward tính toán chuẩn xác theo lịch 6 ngày!');
}

function testCPMWithHoliday_PushesSchedule() {
  console.log('\n--- Test 2: AC 2 - Khai ngày lễ giữa Task A làm Task A dài thêm và Task B lùi theo ---');
  const tasks = [
    { id: 'A', name: 'Công việc A', duration: 6, predecessors: [] },
    { id: 'B', name: 'Công việc B', duration: 3, predecessors: [{ id: 'A', type: 'FS', lag: 0 }] }
  ];

  // Khai Thứ Sáu 2026-10-09 là ngày nghỉ lễ
  const holidays = [{ name: 'Lễ Công Trường', holiday_date: '2026-10-09' }];

  const result = calculateCPMWithCalendar(tasks, {
    projectStartDate: '2026-10-08',
    calendarConfig: { work_days_per_week: 6 },
    holidays
  });

  const taskA = result.tasks.find(t => t.id === 'A');
  const taskB = result.tasks.find(t => t.id === 'B');

  console.log(`Task A khi có lễ: ${taskA.earlyStartDate} -> ${taskA.earlyFinishDate}`);
  console.log(`Task B khi có lễ: ${taskB.earlyStartDate} -> ${taskB.earlyFinishDate}`);
  console.log(`Project End Date mới: ${result.projectEndDate}`);

  // Task A bị lùi kết thúc sang Thứ Năm (2026-10-15)
  assert.strictEqual(taskA.earlyFinishDate, '2026-10-15', 'Task A phải lùi kết thúc sang 2026-10-15 do có lễ ngày 2026-10-09');
  
  // Task B nối tiếp cũng tự động lùi theo (bắt đầu Thứ Sáu 2026-10-16, làm T6, T7, nghỉ CN, T2 => kết thúc 2026-10-19)
  assert.strictEqual(taskB.earlyStartDate, '2026-10-16', 'Task B phải lùi bắt đầu sang 2026-10-16');
  assert.strictEqual(taskB.earlyFinishDate, '2026-10-19', 'Task B phải kết thúc vào 2026-10-19 (Thứ Hai)');
  assert.strictEqual(result.projectEndDate, '2026-10-19', 'Toàn bộ tiến độ dự án lùi sang 2026-10-19');

  console.log('✅ Test 2 ĐẠT: Đúng AC 2 - Ngày lễ rơi vào giữa việc thì việc đó dài thêm và việc sau lùi theo!');
}

function testCPMWithCalendar_SwitchTo5Days() {
  console.log('\n--- Test 3: AC 3 - Đổi sang 5 ngày/tuần làm thay đổi toàn bộ tiến độ và ngày hoàn thành ---');
  const tasks = [
    { id: 'A', name: 'Công việc A', duration: 6, predecessors: [] },
    { id: 'B', name: 'Công việc B', duration: 3, predecessors: [{ id: 'A', type: 'FS', lag: 0 }] }
  ];

  const result = calculateCPMWithCalendar(tasks, {
    projectStartDate: '2026-10-08',
    calendarConfig: { work_days_per_week: 5 },
    holidays: []
  });

  const taskA = result.tasks.find(t => t.id === 'A');
  const taskB = result.tasks.find(t => t.id === 'B');

  console.log(`Lịch 5 ngày - Task A: ${taskA.earlyStartDate} -> ${taskA.earlyFinishDate}`);
  console.log(`Lịch 5 ngày - Task B: ${taskB.earlyStartDate} -> ${taskB.earlyFinishDate}`);
  console.log(`Lịch 5 ngày - Project End Date: ${result.projectEndDate}`);

  // Task A: T5(1), T6(2), T7&CN nghỉ, T2(3), T3(4), T4(5), T5(6) => Kết thúc 2026-10-15
  assert.strictEqual(taskA.earlyFinishDate, '2026-10-15', 'Task A lịch 5 ngày phải kết thúc 2026-10-15');
  // Task B: Bắt đầu T6 (2026-10-16), T7&CN nghỉ, T2(2), T3(3) => Kết thúc 2026-10-20
  assert.strictEqual(taskB.earlyStartDate, '2026-10-16', 'Task B bắt đầu Thứ Sáu 2026-10-16');
  assert.strictEqual(taskB.earlyFinishDate, '2026-10-20', 'Task B kết thúc Thứ Ba 2026-10-20');
  assert.strictEqual(result.projectEndDate, '2026-10-20', 'Ngày kết thúc toàn bộ dự án đổi sang 2026-10-20');

  console.log('✅ Test 3 ĐẠT: Đúng AC 3 - Đổi lịch 5 ngày/tuần tính lại tiến độ và cập nhật ngày hoàn thành!');
}

async function testCalendarStoreOperations() {
  console.log('\n--- Test 4: Kiểm tra thao tác lưu trữ CSDL calendars & holidays (T-38 & T-40) ---');
  calendarStore.resetStore();

  // 1. Lấy lịch mặc định
  const cal1 = await calendarStore.getCalendar(1);
  assert.strictEqual(cal1.work_days_per_week, 6, 'Mặc định phải là 6 ngày/tuần');

  // 2. Cập nhật lịch sang 5 ngày/tuần
  const updatedCal = await calendarStore.saveCalendar(1, { work_days_per_week: 5 });
  assert.strictEqual(updatedCal.work_days_per_week, 5, 'Lịch đã cập nhật sang 5 ngày/tuần');

  // 3. Thêm ngày lễ mới
  const newHoliday = await calendarStore.addHoliday(1, { name: 'Nghỉ lễ test', holiday_date: '2026-11-20' });
  assert.strictEqual(newHoliday.holiday_date, '2026-11-20', 'Ngày lễ đã được thêm đúng ngày');

  // 4. Lấy danh sách ngày lễ
  const holidays = await calendarStore.getHolidays(1);
  assert(holidays.some(h => h.holiday_date === '2026-11-20'), 'Danh sách ngày lễ phải chứa ngày vừa thêm');

  // 5. Xóa ngày lễ
  const deleted = await calendarStore.deleteHoliday(newHoliday.id, 1);
  assert.strictEqual(deleted, true, 'Xóa ngày lễ thành công');
  const holidaysAfter = await calendarStore.getHolidays(1);
  assert(!holidaysAfter.some(h => h.id === newHoliday.id), 'Ngày lễ không còn tồn tại sau khi xóa');

  console.log('✅ Test 4 ĐẠT: Toàn bộ thao tác CRUD cấu hình lịch và ngày nghỉ lễ hoạt động chuẩn xác!');
}

async function runAllTests() {
  try {
    testCPMWithCalendar_Baseline();
    testCPMWithHoliday_PushesSchedule();
    testCPMWithCalendar_SwitchTo5Days();
    await testCalendarStoreOperations();
    console.log('\n================================================================');
    console.log('🎉 TOÀN BỘ BÀI TEST TÍCH HỢP CPM & LỊCH LÀM VIỆC (T-40) ĐÃ PASS!');
    console.log('================================================================');
  } catch (err) {
    console.error('\n❌ TEST THẤT BẠI:', err.message);
    process.exit(1);
  }
}

runAllTests();
