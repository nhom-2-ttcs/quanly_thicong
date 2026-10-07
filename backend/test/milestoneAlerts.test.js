const test = require('node:test');
const assert = require('node:assert/strict');
const { countWorkingDays, addWorkingDays } = require('../src/utils/workday');
const { MilestoneAlertService } = require('../src/services/milestoneAlertService');
const { SchedulerService } = require('../src/domain/scheduling/schedulerService');
const {
  inMemoryWorkItems,
  inMemoryMilestones,
  inMemoryMilestoneAlerts,
  createMilestoneData
} = require('../src/models/store');

test('T-44 Test 1: Milestone chưa bị vượt → không có cảnh báo vượt', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;

  // Hạng mục 1 có milestone ngày 2026-10-20
  createMilestoneData({
    work_item_id: 1,
    due_date: '2026-10-20',
    title: 'Mốc hoàn thành móng',
    created_by: 1
  });

  const scheduler = new SchedulerService({});
  const mockTasks = [
    { id: 101, work_item_id: 1, name: 'Task 1', duration: 5, earlyFinish: '2026-10-15' }
  ];

  const alerts = await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);
  assert.equal(alerts.length, 0, 'Không tạo cảnh báo nếu chưa vượt mốc');

  const activeAlerts = await scheduler.milestoneAlertService.getProjectAlerts(1, { status: 'active' });
  assert.equal(activeAlerts.length, 0, 'Danh sách cảnh báo active phải rỗng');
});

test('T-44 Test 2: Vượt 1 ngày làm việc → cảnh báo ghi đúng 1', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;

  // Milestone due_date = 2026-10-09 (Friday)
  createMilestoneData({
    work_item_id: 1,
    due_date: '2026-10-09',
    title: 'Mốc thi công',
    created_by: 1
  });

  const scheduler = new SchedulerService({});
  // Early finish = 2026-10-12 (Monday). Fri -> Mon = 1 working day (Sat/Sun skipped)
  const mockTasks = [
    { id: 101, work_item_id: 1, name: 'Task 1', duration: 5, earlyFinish: '2026-10-12' }
  ];

  const alerts = await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);
  assert.equal(alerts.length, 1, 'Tạo 1 cảnh báo khi vượt mốc');
  assert.equal(alerts[0].overdue_days, 1, 'Số ngày làm việc vượt phải bằng 1');
  assert.equal(alerts[0].status, 'active');
});

test('T-44 Test 3: Vượt đúng 4 ngày làm việc → cảnh báo ghi đúng 4', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;

  // Milestone due_date = 2026-10-09 (Friday)
  createMilestoneData({
    work_item_id: 1,
    due_date: '2026-10-09',
    title: 'Mốc nghiệm thu',
    created_by: 1
  });

  const scheduler = new SchedulerService({});
  // Early finish = 2026-10-15 (Thursday). Fri Oct 9 -> Thu Oct 15:
  // Sat 10, Sun 11 skipped. Mon 12 (1), Tue 13 (2), Wed 14 (3), Thu 15 (4) -> 4 working days!
  const mockTasks = [
    { id: 101, work_item_id: 1, name: 'Task 1', duration: 5, earlyFinish: '2026-10-15' }
  ];

  const alerts = await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].overdue_days, 4, 'Nếu vượt đúng 4 ngày làm việc thì cảnh báo phải ghi đúng 4');
  assert.equal(alerts[0].status, 'active');
});

test('T-44 Test 4: Vượt nhiều ngày → ghi đúng số ngày làm việc', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;

  // Milestone due_date = 2026-10-01 (Thursday)
  createMilestoneData({
    work_item_id: 1,
    due_date: '2026-10-01',
    title: 'Mốc khởi công',
    created_by: 1
  });

  const scheduler = new SchedulerService({});
  // Early finish = 2026-10-15 (Thursday) -> 2 weeks = 10 working days
  const mockTasks = [
    { id: 101, work_item_id: 1, name: 'Task 1', duration: 10, earlyFinish: '2026-10-15' }
  ];

  const alerts = await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].overdue_days, 10, 'Đếm đúng 10 ngày làm việc vượt');
});

test('T-44 Test 5: Hạng mục có hạng mục con → tính cả task của hạng mục con', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;

  // Hạng mục 1 có hạng mục con 2 (HM-01.01) và cháu 3 (HM-01.01.01)
  // Gắn milestone vào hạng mục cha 1 với due_date = 2026-10-09
  createMilestoneData({
    work_item_id: 1,
    due_date: '2026-10-09',
    title: 'Mốc hạng mục cha 1',
    created_by: 1
  });

  const scheduler = new SchedulerService({});
  // Task ở hạng mục cháu 3 có EF = 2026-10-15 (trễ hơn task ở hạng mục 1)
  const mockTasks = [
    { id: 101, work_item_id: 1, name: 'Task gốc', duration: 2, earlyFinish: '2026-10-05' },
    { id: 102, work_item_id: 3, name: 'Task cháu', duration: 5, earlyFinish: '2026-10-15' }
  ];

  const alerts = await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].max_early_finish, '2026-10-15');
  assert.equal(alerts[0].overdue_days, 4, 'Lấy max Early Finish của task thuộc hạng mục con/cháu để tính ngày vượt');
});

test('T-44 Test 6: Chạy schedule nhiều lần không tạo duplicate cảnh báo', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;

  createMilestoneData({
    work_item_id: 1,
    due_date: '2026-10-09',
    title: 'Mốc thử nghiệm',
    created_by: 1
  });

  const scheduler = new SchedulerService({});
  const mockTasks = [
    { id: 101, work_item_id: 1, name: 'Task 1', duration: 5, earlyFinish: '2026-10-15' }
  ];

  // Lần chạy 1
  await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);
  // Lần chạy 2
  await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);
  // Lần chạy 3
  await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, mockTasks);

  const activeAlerts = await scheduler.milestoneAlertService.getProjectAlerts(1, { status: 'active' });
  assert.equal(activeAlerts.length, 1, 'Chạy schedule nhiều lần chỉ duy nhất 1 cảnh báo active (không duplicate)');
});

test('T-44 Test 7: Khi Early Finish không còn vượt milestone → cảnh báo được đóng và có thời điểm đóng', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;

  createMilestoneData({
    work_item_id: 1,
    due_date: '2026-10-10',
    title: 'Mốc linh hoạt',
    created_by: 1
  });

  const scheduler = new SchedulerService({});
  
  // Lần 1: Task bị trễ (EF = 2026-10-15) -> tạo cảnh báo
  const lateTasks = [
    { id: 101, work_item_id: 1, name: 'Task 1', duration: 5, earlyFinish: '2026-10-15' }
  ];
  await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, lateTasks);

  let activeAlerts = await scheduler.milestoneAlertService.getProjectAlerts(1, { status: 'active' });
  assert.equal(activeAlerts.length, 1, 'Phải có 1 cảnh báo active');

  // Lần 2: Điều chỉnh tiến độ, task hết trễ (EF = 2026-10-08 <= due_date 2026-10-10) -> đóng cảnh báo
  const onTimeTasks = [
    { id: 101, work_item_id: 1, name: 'Task 1', duration: 3, earlyFinish: '2026-10-08' }
  ];
  await scheduler.milestoneAlertService.checkProjectMilestoneAlerts(1, onTimeTasks);

  activeAlerts = await scheduler.milestoneAlertService.getProjectAlerts(1, { status: 'active' });
  assert.equal(activeAlerts.length, 0, 'Cảnh báo active phải chuyển sang trạng thái closed');

  const closedAlerts = await scheduler.milestoneAlertService.getProjectAlerts(1, { status: 'closed' });
  assert.equal(closedAlerts.length, 1, 'Phải có 1 cảnh báo ở trạng thái closed');
  assert.ok(closedAlerts[0].closed_at, 'Phải ghi nhận thời điểm đóng closed_at');
});

test('T-44 Test 8: Kiểm tra logic được chạy trong flow của T-36, không tạo background task riêng', async () => {
  inMemoryMilestoneAlerts.length = 0;
  inMemoryMilestones.length = 0;

  createMilestoneData({
    work_item_id: 1,
    due_date: '2026-10-05',
    title: 'Mốc tích hợp T-36',
    created_by: 1
  });

  const scheduler = new SchedulerService({});
  
  // Trực tiếp gọi getProjectScheduleResults của T-36
  const results = await scheduler.getProjectScheduleResults(1, { forceRecalculate: true });
  assert.equal(results.success, true);

  const activeAlerts = await scheduler.milestoneAlertService.getProjectAlerts(1, { status: 'active' });
  assert.ok(Array.isArray(activeAlerts), 'Cảnh báo T-44 tự động kích hoạt và cập nhật khi gọi T-36 scheduler');
});
