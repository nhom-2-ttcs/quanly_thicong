const test = require('node:test');
const assert = require('node:assert/strict');
const { SchedulerService } = require('../src/domain/scheduling/schedulerService');
const { calculateBackwardPass } = require('../src/algorithms/backwardPass');

const manualTasks = [
  { id: 1, code: 'A', name: 'A', duration: 3 },
  { id: 2, code: 'B', name: 'B', duration: 2 },
  { id: 3, code: 'C', name: 'C', duration: 1 },
  { id: 4, code: 'D', name: 'D', duration: 1 }
];
const manualDependencies = [
  { predecessorId: 1, successorId: 2, type: 'FS', lag: 0 },
  { predecessorId: 1, successorId: 3, type: 'FS', lag: 0 },
  { predecessorId: 2, successorId: 4, type: 'FS', lag: 0 },
  { predecessorId: 3, successorId: 4, type: 'FS', lag: 0 }
];

test('S-09: ID số MySQL cho đúng kết quả mạng tính tay', () => {
  const result = new SchedulerService({}).computeSchedule(manualTasks, manualDependencies);
  assert.equal(result.projectDuration, 6);
  assert.deepEqual(result.tasks.map(({ code, earlyStart, earlyFinish, lateStart, lateFinish, totalFloat, isCritical }) => ({
    code, earlyStart, earlyFinish, lateStart, lateFinish, totalFloat, isCritical
  })), [
    { code: 'A', earlyStart: 0, earlyFinish: 3, lateStart: 0, lateFinish: 3, totalFloat: 0, isCritical: true },
    { code: 'B', earlyStart: 3, earlyFinish: 5, lateStart: 3, lateFinish: 5, totalFloat: 0, isCritical: true },
    { code: 'C', earlyStart: 3, earlyFinish: 4, lateStart: 4, lateFinish: 5, totalFloat: 1, isCritical: false },
    { code: 'D', earlyStart: 5, earlyFinish: 6, lateStart: 5, lateFinish: 6, totalFloat: 0, isCritical: true }
  ]);
});

test('S-09: ID chuỗi, duration thập phân, nhiều task cuối và không có -0', () => {
  const result = new SchedulerService({}).computeSchedule([
    { id: 'A', duration: 1.5 },
    { id: 'B', duration: 2.5 },
    { id: 'C', duration: 1 }
  ], [
    { predecessorId: 'A', successorId: 'B', type: 'FS', lag: 0.5 }
  ]);
  assert.equal(result.projectDuration, 4.5);
  assert.equal(result.tasks.find(task => task.taskId === 'C').totalFloat, 3.5);
  for (const task of result.tasks) {
    assert.equal(task.lateStart - task.earlyStart, task.lateFinish - task.earlyFinish);
    assert.equal(Object.is(task.totalFloat, -0), false);
  }
});

test('S-09: đồ thị rỗng và một task', () => {
  const scheduler = new SchedulerService({});
  assert.deepEqual(scheduler.computeSchedule([], []).tasks, []);
  const one = scheduler.computeSchedule([{ id: 7, duration: 2 }], []);
  assert.equal(one.projectDuration, 2);
  assert.deepEqual(one.tasks[0], {
    id: 7, taskId: 7, duration: 2, earlyStart: 0, earlyFinish: 2,
    lateStart: 0, lateFinish: 2, totalFloat: 0, isCritical: true,
    name: undefined, code: undefined, status: undefined
  });
});

test('S-09: hỗ trợ FS/SS/FF/SF và lag mà không mutate input', () => {
  for (const type of ['FS', 'SS', 'FF', 'SF']) {
    const tasks = [{ id: 'P', duration: 3 }, { id: 'S', duration: 2 }];
    const dependencies = [{ predecessorId: 'P', successorId: 'S', type, lag: 1 }];
    const before = JSON.stringify({ tasks, dependencies });
    const result = new SchedulerService({}).computeSchedule(tasks, dependencies);
    assert.equal(result.tasks.length, 2);
    assert.equal(JSON.stringify({ tasks, dependencies }), before);
  }
});

test('S-09: validation từ chối task/dependency/topo/ES-EF sai', () => {
  const scheduler = new SchedulerService({});
  assert.throws(() => scheduler.computeSchedule([{ id: 1, duration: -1 }], []), /duration/);
  assert.throws(() => scheduler.computeSchedule([{ id: 1, duration: Number.NaN }], []), /duration/);
  assert.throws(() => scheduler.computeSchedule([{ id: 1, duration: 1 }, { id: 1, duration: 1 }], []), /trùng/);
  assert.throws(() => scheduler.computeSchedule([{ id: 1, duration: 1 }], [
    { predecessorId: 1, successorId: 2, type: 'FS', lag: 0 }
  ]), /không tồn tại/);
  assert.throws(() => scheduler.computeSchedule([{ id: 1, duration: 1 }, { id: 2, duration: 1 }], [
    { predecessorId: 1, successorId: 2, type: 'XX', lag: 0 }
  ]), /không hợp lệ/);
  assert.throws(() => scheduler.computeSchedule([{ id: 1, duration: 1 }, { id: 2, duration: 1 }], [
    { predecessorId: 1, successorId: 2, type: 'FS', lag: 'x' }
  ]), /số hữu hạn/);

  const tasks = [{ id: 1, duration: 1 }, { id: 2, duration: 1 }];
  assert.throws(() => calculateBackwardPass(tasks, [1], [
    { id: 1, earlyStart: 0, earlyFinish: 1 }, { id: 2, earlyStart: 1, earlyFinish: 2 }
  ]), /topologicalOrder/);
  assert.throws(() => calculateBackwardPass(tasks, [1, 2], [
    { id: 1, earlyStart: 0, earlyFinish: 1 }
  ]), /Thiếu ES\/EF/);
  assert.throws(() => calculateBackwardPass(tasks, [1, 2], [
    { id: 1, earlyStart: 0, earlyFinish: 2 }, { id: 2, earlyStart: 1, earlyFinish: 2 }
  ]), /không nhất quán/);
});

test('S-11/S-09: chu trình bị chặn trước backward pass', () => {
  const result = new SchedulerService({}).computeSchedule(
    [{ id: 1, duration: 1 }, { id: 2, duration: 1 }],
    [
      { predecessorId: 1, successorId: 2, type: 'FS', lag: 0 },
      { predecessorId: 2, successorId: 1, type: 'FS', lag: 0 }
    ]
  );
  assert.equal(result.hasCycle, true);
  assert.deepEqual(result.tasks, []);
  assert.match(result.cyclePath, /1.*2.*1/);
});
