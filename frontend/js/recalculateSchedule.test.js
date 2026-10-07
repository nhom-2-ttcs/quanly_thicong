const test = require('node:test');
const assert = require('node:assert/strict');
const { recalculateProjectSchedule } = require('./recalculateSchedule');

function calculate(tasks, projectEndDate = '2026-10-11') {
  return recalculateProjectSchedule({
    projectStartDate: '2026-10-01',
    projectEndDate,
    tasks
  }, '2026-10-15');
}

test('S-16 AC 1: việc găng kết thúc trễ ba ngày làm lùi ngày dự án ba ngày', () => {
  const result = calculate([{
    id: '1', earlyStart: '2026-10-01', earlyFinish: '2026-10-11',
    actualFinish: '2026-10-14', progress: 100, totalFloat: 0, isCritical: true
  }]);

  assert.equal(result.currentEndDate, '2026-10-14');
  assert.equal(result.delayDays, 3);
});

test('S-16 AC 2: việc không găng trễ ít hơn float không lùi ngày dự án', () => {
  const result = calculate([{
    id: '1', earlyStart: '2026-10-01', earlyFinish: '2026-10-11',
    actualFinish: '2026-10-12', progress: 100, totalFloat: 2, isCritical: false
  }]);

  assert.equal(result.tasks[0].currentFinish, '2026-10-12');
  assert.equal(result.currentEndDate, '2026-10-11');
  assert.equal(result.delayDays, 0);
});

test('S-16 AC 3: việc không găng trễ quá float trở thành găng mới', () => {
  const result = calculate([{
    id: '1', earlyStart: '2026-10-01', earlyFinish: '2026-10-11',
    actualFinish: '2026-10-16', progress: 100, totalFloat: 2, isCritical: false
  }]);

  assert.equal(result.currentEndDate, '2026-10-14');
  assert.equal(result.delayDays, 3);
  assert.equal(result.tasks[0].isNewCritical, true);
});

test('S-16 AC 4: việc đang làm dự báo theo hôm nay và phần thời lượng còn lại', () => {
  const result = calculate([{
    id: '1', earlyStart: '2026-10-01', earlyFinish: '2026-10-11',
    actualFinish: null, progress: 50, totalFloat: 0, lateFinish: '2026-10-11', isCritical: true
  }]);

  assert.equal(result.tasks[0].currentFinish, '2026-10-20');
  assert.equal(result.currentEndDate, '2026-10-20');
  assert.equal(result.delayDays, 9);
});
