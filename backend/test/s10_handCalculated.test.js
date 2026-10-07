/**
 * S-10 (SCRUM-65): Kiểm thử bằng đáp án tính tay
 * Parent: SCRUM-14 [E-02]
 * Subtasks:
 * - SCRUM-79 [T-22] Chuyển bảng đáp án K-01 thành test
 * - SCRUM-80 [T-23] Thêm mạng đủ bốn loại quan hệ (mỗi mạng 6–8 việc)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { SchedulerService } = require('../src/domain/scheduling/schedulerService');
const { calculateRelationWeight } = require('../src/algorithms/backwardPass');
const {
  K01_NETWORK,
  NETWORK_1_ALL_RELATIONS_NEGATIVE_LAG,
  NETWORK_2_PARALLEL_BRANCHES_OFFSET_3_DAYS
} = require('./fixtures/handCalculatedSchedules');

/**
 * Hàm so sánh kết quả tính toán với kết quả dự kiến tĩnh
 * Trả về danh sách sai lệch (nếu có)
 */
function verifyScheduleAgainstExpected(computedTasks, expectedTasks, projectDuration, expectedDuration) {
  const mismatches = [];

  if (projectDuration !== expectedDuration) {
    mismatches.push(`Project duration lệch: computed=${projectDuration}, expected=${expectedDuration}`);
  }

  const computedMap = new Map(computedTasks.map(t => [String(t.taskId), t]));

  for (const exp of expectedTasks) {
    const act = computedMap.get(String(exp.taskId));
    if (!act) {
      mismatches.push(`Task ${exp.taskId} thiếu trong computed schedule`);
      continue;
    }

    if (act.earlyStart !== exp.earlyStart) {
      mismatches.push(`Task ${exp.taskId} ES lệch: actual=${act.earlyStart}, expected=${exp.earlyStart}`);
    }
    if (act.earlyFinish !== exp.earlyFinish) {
      mismatches.push(`Task ${exp.taskId} EF lệch: actual=${act.earlyFinish}, expected=${exp.earlyFinish}`);
    }
    if (act.lateStart !== exp.lateStart) {
      mismatches.push(`Task ${exp.taskId} LS lệch: actual=${act.lateStart}, expected=${exp.lateStart}`);
    }
    if (act.lateFinish !== exp.lateFinish) {
      mismatches.push(`Task ${exp.taskId} LF lệch: actual=${act.lateFinish}, expected=${exp.lateFinish}`);
    }
    if (act.totalFloat !== exp.totalFloat) {
      mismatches.push(`Task ${exp.taskId} Float lệch: actual=${act.totalFloat}, expected=${exp.totalFloat}`);
    }
    if (act.isCritical !== exp.isCritical) {
      mismatches.push(`Task ${exp.taskId} Critical lệch: actual=${act.isCritical}, expected=${exp.isCritical}`);
    }
  }

  return {
    matches: mismatches.length === 0,
    mismatches
  };
}

// ============================================================
// TEST 1: SCRUM-79 [T-22] - Chuyển bảng đáp án K-01 thành test
// ============================================================
test('S-10 / T-22: Mạng đáp án tính tay K-01 khớp chính xác với SchedulerService', () => {
  assert.ok(K01_NETWORK.metadata, 'Fixture K-01 phải có metadata');
  assert.ok(K01_NETWORK.metadata.calculationDate, 'Phải có ngày tính toán');
  assert.equal(K01_NETWORK.metadata.reviewStatus, 'PENDING_INDEPENDENT_REVIEW', 'Chờ xác nhận độc lập');

  const scheduler = new SchedulerService({});
  const result = scheduler.computeSchedule(K01_NETWORK.tasks, K01_NETWORK.dependencies);

  assert.equal(result.hasCycle, false, 'K-01 không có chu trình');
  assert.equal(result.projectDuration, K01_NETWORK.expected.projectDuration, 'Thời lượng dự án K-01 phải là 12 ngày');

  const verification = verifyScheduleAgainstExpected(
    result.tasks,
    K01_NETWORK.expected.tasks,
    result.projectDuration,
    K01_NETWORK.expected.projectDuration
  );

  assert.equal(verification.matches, true, `Mismatches in K-01: ${verification.mismatches.join('; ')}`);

  const taskMap = new Map(result.tasks.map(t => [String(t.taskId), t]));
  
  // A: ES=0, EF=5, LS=0, LF=5, Float=0, Critical=true
  const taskA = taskMap.get('A');
  assert.deepEqual({
    earlyStart: taskA.earlyStart,
    earlyFinish: taskA.earlyFinish,
    lateStart: taskA.lateStart,
    lateFinish: taskA.lateFinish,
    totalFloat: taskA.totalFloat,
    isCritical: taskA.isCritical
  }, {
    earlyStart: 0,
    earlyFinish: 5,
    lateStart: 0,
    lateFinish: 5,
    totalFloat: 0,
    isCritical: true
  });

  // B: ES=5, EF=8, LS=5, LF=8, Float=0, Critical=true
  const taskB = taskMap.get('B');
  assert.deepEqual({
    earlyStart: taskB.earlyStart,
    earlyFinish: taskB.earlyFinish,
    lateStart: taskB.lateStart,
    lateFinish: taskB.lateFinish,
    totalFloat: taskB.totalFloat,
    isCritical: taskB.isCritical
  }, {
    earlyStart: 5,
    earlyFinish: 8,
    lateStart: 5,
    lateFinish: 8,
    totalFloat: 0,
    isCritical: true
  });

  // C: ES=8, EF=12, LS=8, LF=12, Float=0, Critical=true
  const taskC = taskMap.get('C');
  assert.deepEqual({
    earlyStart: taskC.earlyStart,
    earlyFinish: taskC.earlyFinish,
    lateStart: taskC.lateStart,
    lateFinish: taskC.lateFinish,
    totalFloat: taskC.totalFloat,
    isCritical: taskC.isCritical
  }, {
    earlyStart: 8,
    earlyFinish: 12,
    lateStart: 8,
    lateFinish: 12,
    totalFloat: 0,
    isCritical: true
  });
});

// ============================================================
// TEST 2: SCRUM-80 [T-23] - Mạng 1: Đủ 4 loại quan hệ (FS, SS, FF, SF) & lag âm (7 việc)
// ============================================================
test('S-10 / T-23: Mạng độc lập 1 (7 việc) đủ 4 loại quan hệ FS, SS, FF, SF và lag âm khớp tính tay', () => {
  const fixture = NETWORK_1_ALL_RELATIONS_NEGATIVE_LAG;

  // Kiểm tra quy mô 6–8 công việc theo Excel
  assert.ok(fixture.tasks.length >= 6 && fixture.tasks.length <= 8, `Mạng 1 phải có 6–8 công việc, hiện có ${fixture.tasks.length}`);

  // Kiểm tra bao phủ 4 loại quan hệ và lag âm
  const typesUsed = new Set(fixture.dependencies.map(d => d.type));
  assert.ok(typesUsed.has('FS'), 'Phải bao phủ quan hệ FS');
  assert.ok(typesUsed.has('SS'), 'Phải bao phủ quan hệ SS');
  assert.ok(typesUsed.has('FF'), 'Phải bao phủ quan hệ FF');
  assert.ok(typesUsed.has('SF'), 'Phải bao phủ quan hệ SF');

  const hasNegativeLag = fixture.dependencies.some(d => Number(d.lag) < 0);
  assert.ok(hasNegativeLag, 'Phải có ít nhất một quan hệ có độ trễ lag âm (lead time)');

  // Tính toán bằng SchedulerService
  const scheduler = new SchedulerService({});
  const result = scheduler.computeSchedule(fixture.tasks, fixture.dependencies);

  assert.equal(result.hasCycle, false);
  assert.equal(result.projectDuration, 22);

  const verification = verifyScheduleAgainstExpected(
    result.tasks,
    fixture.expected.tasks,
    result.projectDuration,
    fixture.expected.projectDuration
  );

  assert.equal(verification.matches, true, `Mismatches in Network 1: ${verification.mismatches.join('; ')}`);

  const taskMap = new Map(result.tasks.map(t => [String(t.taskId), t]));
  
  // N1_1: ES=0, EF=4, LS=0, LF=4, Float=0, Critical=true
  assert.equal(taskMap.get('N1_1').earlyStart, 0);
  assert.equal(taskMap.get('N1_1').earlyFinish, 4);
  assert.equal(taskMap.get('N1_1').lateStart, 0);
  assert.equal(taskMap.get('N1_1').lateFinish, 4);
  assert.equal(taskMap.get('N1_1').totalFloat, 0);
  assert.equal(taskMap.get('N1_1').isCritical, true);

  // N1_2 (SS lag 2): ES=2, EF=7, LS=7, LF=12, Float=5, Critical=false
  assert.equal(taskMap.get('N1_2').earlyStart, 2);
  assert.equal(taskMap.get('N1_2').earlyFinish, 7);
  assert.equal(taskMap.get('N1_2').lateStart, 7);
  assert.equal(taskMap.get('N1_2').lateFinish, 12);
  assert.equal(taskMap.get('N1_2').totalFloat, 5);
  assert.equal(taskMap.get('N1_2').isCritical, false);

  // N1_3 (FS lag -1): ES=3, EF=6, LS=3, LF=6, Float=0, Critical=true
  assert.equal(taskMap.get('N1_3').earlyStart, 3);
  assert.equal(taskMap.get('N1_3').earlyFinish, 6);
  assert.equal(taskMap.get('N1_3').lateStart, 3);
  assert.equal(taskMap.get('N1_3').lateFinish, 6);
  assert.equal(taskMap.get('N1_3').totalFloat, 0);
  assert.equal(taskMap.get('N1_3').isCritical, true);

  // N1_4 (FF lag 2): ES=5, EF=9, LS=10, LF=14, Float=5, Critical=false
  assert.equal(taskMap.get('N1_4').earlyStart, 5);
  assert.equal(taskMap.get('N1_4').earlyFinish, 9);
  assert.equal(taskMap.get('N1_4').lateStart, 10);
  assert.equal(taskMap.get('N1_4').lateFinish, 14);
  assert.equal(taskMap.get('N1_4').totalFloat, 5);
  assert.equal(taskMap.get('N1_4').isCritical, false);

  // N1_5 (SF lag 12): ES=9, EF=15, LS=9, LF=15, Float=0, Critical=true
  assert.equal(taskMap.get('N1_5').earlyStart, 9);
  assert.equal(taskMap.get('N1_5').earlyFinish, 15);
  assert.equal(taskMap.get('N1_5').lateStart, 9);
  assert.equal(taskMap.get('N1_5').lateFinish, 15);
  assert.equal(taskMap.get('N1_5').totalFloat, 0);
  assert.equal(taskMap.get('N1_5').isCritical, true);

  // N1_6 (FS lag 0): ES=15, EF=20, LS=15, LF=20, Float=0, Critical=true
  assert.equal(taskMap.get('N1_6').earlyStart, 15);
  assert.equal(taskMap.get('N1_6').earlyFinish, 20);
  assert.equal(taskMap.get('N1_6').lateStart, 15);
  assert.equal(taskMap.get('N1_6').lateFinish, 20);
  assert.equal(taskMap.get('N1_6').totalFloat, 0);
  assert.equal(taskMap.get('N1_6').isCritical, true);

  // N1_7 (FS lag 0): ES=20, EF=22, LS=20, LF=22, Float=0, Critical=true
  assert.equal(taskMap.get('N1_7').earlyStart, 20);
  assert.equal(taskMap.get('N1_7').earlyFinish, 22);
  assert.equal(taskMap.get('N1_7').lateStart, 20);
  assert.equal(taskMap.get('N1_7').lateFinish, 22);
  assert.equal(taskMap.get('N1_7').totalFloat, 0);
  assert.equal(taskMap.get('N1_7').isCritical, true);
});

// ============================================================
// TEST 3: SCRUM-80 [T-23] - Mạng 2: Hai nhánh song song lệch nhau 3 ngày (6 việc)
// ============================================================
test('S-10 / T-23: Mạng độc lập 2 (6 việc) có hai nhánh song song lệch nhau đúng 3 ngày float', () => {
  const fixture = NETWORK_2_PARALLEL_BRANCHES_OFFSET_3_DAYS;

  // Kiểm tra quy mô 6–8 công việc theo Excel
  assert.ok(fixture.tasks.length >= 6 && fixture.tasks.length <= 8, `Mạng 2 phải có 6–8 công việc, hiện có ${fixture.tasks.length}`);

  const scheduler = new SchedulerService({});
  const result = scheduler.computeSchedule(fixture.tasks, fixture.dependencies);

  assert.equal(result.hasCycle, false);
  assert.equal(result.projectDuration, 14);

  const taskMap = new Map(result.tasks.map(t => [String(t.taskId), t]));

  // Nhánh 1: N2_2 -> N2_3 (đường găng, float = 0)
  const b1_1 = taskMap.get('N2_2');
  const b1_2 = taskMap.get('N2_3');
  assert.equal(b1_1.totalFloat, 0, 'Nhánh 1 task N2_2 phải có float = 0');
  assert.equal(b1_1.isCritical, true);
  assert.equal(b1_2.totalFloat, 0, 'Nhánh 1 task N2_3 phải có float = 0');
  assert.equal(b1_2.isCritical, true);

  // Nhánh 2: N2_4 -> N2_5 (nhánh phụ, float = 3)
  const b2_1 = taskMap.get('N2_4');
  const b2_2 = taskMap.get('N2_5');
  assert.equal(b2_1.totalFloat, 3, 'Nhánh 2 task N2_4 phải có float = 3');
  assert.equal(b2_1.isCritical, false);
  assert.equal(b2_2.totalFloat, 3, 'Nhánh 2 task N2_5 phải có float = 3');
  assert.equal(b2_2.isCritical, false);

  // Chênh lệch float đúng 3 ngày giữa 2 nhánh song song
  assert.equal(b2_1.totalFloat - b1_1.totalFloat, 3, 'Độ lệch float giữa 2 nhánh song song đúng 3 ngày');
  assert.equal(b2_2.totalFloat - b1_2.totalFloat, 3, 'Độ lệch float giữa 2 nhánh song song đúng 3 ngày');

  const verification = verifyScheduleAgainstExpected(
    result.tasks,
    fixture.expected.tasks,
    result.projectDuration,
    fixture.expected.projectDuration
  );

  assert.equal(verification.matches, true, `Mismatches in Network 2: ${verification.mismatches.join('; ')}`);
});

// ============================================================
// TEST 4: S-10 AC 6 - Negative / Mutation Test: Phát hiện sai lệch mốc
// ============================================================
test('S-10 AC 6: Negative test phát hiện sai lệch mốc khi expected bị cố ý sửa sai', () => {
  const fixture = K01_NETWORK;
  const scheduler = new SchedulerService({});
  const result = scheduler.computeSchedule(fixture.tasks, fixture.dependencies);

  // 1. Kiểm tra với expected chuẩn -> không có lỗi
  const normalCheck = verifyScheduleAgainstExpected(
    result.tasks,
    fixture.expected.tasks,
    result.projectDuration,
    fixture.expected.projectDuration
  );
  assert.equal(normalCheck.matches, true);
  assert.equal(normalCheck.mismatches.length, 0);

  // 2. Cố ý sửa sai mốc Early Finish của Task B từ 8 thành 99 (mutation)
  const mutatedTasks = fixture.expected.tasks.map(t => {
    if (t.taskId === 'B') {
      return { ...t, earlyFinish: 99 };
    }
    return { ...t };
  });

  const mutatedCheck = verifyScheduleAgainstExpected(
    result.tasks,
    mutatedTasks,
    result.projectDuration,
    fixture.expected.projectDuration
  );

  assert.equal(mutatedCheck.matches, false, 'Verifier phải phát hiện sai lệch khi mốc bị sửa');
  assert.ok(mutatedCheck.mismatches.some(m => m.includes('Task B EF lệch: actual=8, expected=99')));

  // 3. Cố ý sửa sai isCritical của Task A từ true thành false
  const mutatedCriticalTasks = fixture.expected.tasks.map(t => {
    if (t.taskId === 'A') {
      return { ...t, isCritical: false };
    }
    return { ...t };
  });

  const criticalCheck = verifyScheduleAgainstExpected(
    result.tasks,
    mutatedCriticalTasks,
    result.projectDuration,
    fixture.expected.projectDuration
  );

  assert.equal(criticalCheck.matches, false, 'Verifier phải phát hiện sai lệch trạng thái găng');
  assert.ok(criticalCheck.mismatches.some(m => m.includes('Task A Critical lệch')));
});

// ============================================================
// TEST 5: S-10 / T-23: Xác minh tính độc lập và metadata kiểm toán
// ============================================================
test('S-10 / T-23: Metadata kiểm toán ghi nhận trạng thái PENDING_INDEPENDENT_REVIEW (không khai khống khi chưa có xác nhận thực tế)', () => {
  const fixtures = [
    K01_NETWORK,
    NETWORK_1_ALL_RELATIONS_NEGATIVE_LAG,
    NETWORK_2_PARALLEL_BRANCHES_OFFSET_3_DAYS
  ];

  for (const f of fixtures) {
    assert.ok(f.metadata.calculator, `Fixture ${f.metadata.id} phải có người tính`);
    assert.ok(f.metadata.calculationDate, `Fixture ${f.metadata.id} phải có ngày tính`);
    assert.equal(
      f.metadata.reviewStatus,
      'PENDING_INDEPENDENT_REVIEW',
      `Fixture ${f.metadata.id} phải ghi rõ trạng thái PENDING_INDEPENDENT_REVIEW khi chưa có chữ ký thực tế của người thứ hai`
    );
    assert.equal(f.metadata.reviewer, null, 'Chưa có chữ ký người thứ hai thì reviewer phải là null');
    assert.equal(f.metadata.reviewDate, null, 'Chưa có chữ ký người thứ hai thì reviewDate phải là null');
  }
});

// ============================================================
// HÀM HELPER: Chạy tính toán lịch với bộ trọng số quan hệ tùy biến
// để kiểm chứng phát hiện lỗi công thức (Formula Fault Detection)
// ============================================================
function computeScheduleWithCustomWeight(tasks, dependencies, customWeightFn) {
  const taskMap = new Map(tasks.map(t => [t.id, { ...t, predecessors: [], successors: [] }]));
  for (const d of dependencies) {
    taskMap.get(d.successorId).predecessors.push(d);
    taskMap.get(d.predecessorId).successors.push(d);
  }

  // Thứ tự topo của Mạng 1
  const topoOrder = ['N1_1', 'N1_2', 'N1_3', 'N1_4', 'N1_5', 'N1_6', 'N1_7'];

  // Forward pass
  for (const id of topoOrder) {
    const task = taskMap.get(id);
    let es = 0;
    for (const pred of task.predecessors) {
      const pTask = taskMap.get(pred.predecessorId);
      const w = customWeightFn(pTask, task, pred.type, pred.lag);
      es = Math.max(es, pTask.earlyStart + w);
    }
    task.earlyStart = es;
    task.earlyFinish = es + task.duration;
  }

  const projectDuration = Math.max(...[...taskMap.values()].map(t => t.earlyFinish));

  // Backward pass
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const id = topoOrder[i];
    const task = taskMap.get(id);
    if (task.successors.length === 0) {
      task.lateFinish = projectDuration;
      task.lateStart = projectDuration - task.duration;
    } else {
      let minLs = Infinity;
      for (const succ of task.successors) {
        const sTask = taskMap.get(succ.successorId);
        const w = customWeightFn(task, sTask, succ.type, succ.lag);
        minLs = Math.min(minLs, sTask.lateStart - w);
      }
      task.lateStart = minLs;
      task.lateFinish = minLs + task.duration;
    }
    task.totalFloat = Math.max(0, task.lateStart - task.earlyStart);
    task.isCritical = task.totalFloat === 0;
  }

  return {
    projectDuration,
    tasks: topoOrder.map(id => ({ taskId: id, ...taskMap.get(id) }))
  };
}

// ============================================================
// TEST 6: S-10 AC 6 - Kiểm chứng phát hiện lỗi công thức khi cố ý làm sai quan hệ FS (Finish-to-Start)
// ============================================================
test('S-10 AC 6: Kiểm chứng phát hiện lỗi công thức khi cố ý làm sai quan hệ FS (Finish-to-Start)', () => {
  const fixture = NETWORK_1_ALL_RELATIONS_NEGATIVE_LAG;

  // Cố ý làm sai công thức FS (ví dụ: bỏ quên độ trễ lag âm)
  const faultyWeightFn = (p, s, type, lag) => {
    if (type === 'FS') return p.duration; // Sai: bỏ qua lag
    return calculateRelationWeight(p, s, type, lag);
  };

  const faultyResult = computeScheduleWithCustomWeight(fixture.tasks, fixture.dependencies, faultyWeightFn);
  const check = verifyScheduleAgainstExpected(
    faultyResult.tasks,
    fixture.expected.tasks,
    faultyResult.projectDuration,
    fixture.expected.projectDuration
  );

  assert.equal(check.matches, false, 'Bộ kiểm thử phải bắt được lỗi khi công thức FS bị sai');
  assert.ok(
    check.mismatches.some(m => m.includes('N1_3') && m.includes('ES lệch')),
    'Phải chỉ đích danh Task N1_3 (liên kết FS lag -1) bị sai lệch khi công thức FS bị hỏng'
  );
});

// ============================================================
// TEST 7: S-10 AC 6 - Kiểm chứng phát hiện lỗi công thức khi cố ý làm sai quan hệ SS (Start-to-Start)
// ============================================================
test('S-10 AC 6: Kiểm chứng phát hiện lỗi công thức khi cố ý làm sai quan hệ SS (Start-to-Start)', () => {
  const fixture = NETWORK_1_ALL_RELATIONS_NEGATIVE_LAG;

  // Cố ý làm sai công thức SS (ví dụ: nhầm SS thành FS: p.duration + lag)
  const faultyWeightFn = (p, s, type, lag) => {
    if (type === 'SS') return p.duration + lag; // Sai: tính theo finish thay vì start
    return calculateRelationWeight(p, s, type, lag);
  };

  const faultyResult = computeScheduleWithCustomWeight(fixture.tasks, fixture.dependencies, faultyWeightFn);
  const check = verifyScheduleAgainstExpected(
    faultyResult.tasks,
    fixture.expected.tasks,
    faultyResult.projectDuration,
    fixture.expected.projectDuration
  );

  assert.equal(check.matches, false, 'Bộ kiểm thử phải bắt được lỗi khi công thức SS bị sai');
  assert.ok(
    check.mismatches.some(m => m.includes('N1_2') && m.includes('ES lệch')),
    'Phải chỉ đích danh Task N1_2 (liên kết SS) bị sai lệch khi công thức SS bị hỏng'
  );
});

// ============================================================
// TEST 8: S-10 AC 6 - Kiểm chứng phát hiện lỗi công thức khi cố ý làm sai quan hệ FF (Finish-to-Finish)
// ============================================================
test('S-10 AC 6: Kiểm chứng phát hiện lỗi công thức khi cố ý làm sai quan hệ FF (Finish-to-Finish)', () => {
  const fixture = NETWORK_1_ALL_RELATIONS_NEGATIVE_LAG;

  // Cố ý làm sai công thức FF (ví dụ: quên trừ duration của successor: p.duration + lag)
  const faultyWeightFn = (p, s, type, lag) => {
    if (type === 'FF') return p.duration + lag; // Sai: quên trừ s.duration
    return calculateRelationWeight(p, s, type, lag);
  };

  const faultyResult = computeScheduleWithCustomWeight(fixture.tasks, fixture.dependencies, faultyWeightFn);
  const check = verifyScheduleAgainstExpected(
    faultyResult.tasks,
    fixture.expected.tasks,
    faultyResult.projectDuration,
    fixture.expected.projectDuration
  );

  assert.equal(check.matches, false, 'Bộ kiểm thử phải bắt được lỗi khi công thức FF bị sai');
  assert.ok(
    check.mismatches.some(m => m.includes('N1_4') && m.includes('ES lệch')),
    'Phải chỉ đích danh Task N1_4 (liên kết FF) bị sai lệch khi công thức FF bị hỏng'
  );
});

// ============================================================
// TEST 9: S-10 AC 6 - Kiểm chứng phát hiện lỗi công thức khi cố ý làm sai quan hệ SF (Start-to-Finish)
// ============================================================
test('S-10 AC 6: Kiểm chứng phát hiện lỗi công thức khi cố ý làm sai quan hệ SF (Start-to-Finish)', () => {
  const fixture = NETWORK_1_ALL_RELATIONS_NEGATIVE_LAG;

  // Cố ý làm sai công thức SF (ví dụ: quên trừ duration của successor: lag)
  const faultyWeightFn = (p, s, type, lag) => {
    if (type === 'SF') return lag; // Sai: quên trừ s.duration
    return calculateRelationWeight(p, s, type, lag);
  };

  const faultyResult = computeScheduleWithCustomWeight(fixture.tasks, fixture.dependencies, faultyWeightFn);
  const check = verifyScheduleAgainstExpected(
    faultyResult.tasks,
    fixture.expected.tasks,
    faultyResult.projectDuration,
    fixture.expected.projectDuration
  );

  assert.equal(check.matches, false, 'Bộ kiểm thử phải bắt được lỗi khi công thức SF bị sai');
  assert.ok(
    check.mismatches.some(m => m.includes('N1_5') && m.includes('ES lệch')),
    'Phải chỉ đích danh Task N1_5 (liên kết SF) bị sai lệch khi công thức SF bị hỏng'
  );
});
