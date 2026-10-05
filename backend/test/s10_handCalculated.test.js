/**
 * S-10 (SCRUM-65): Kiểm thử bằng đáp án tính tay
 * Parent: SCRUM-14 [E-02]
 * Subtasks:
 * - SCRUM-79 [T-22] Chuyển bảng đáp án K-01 thành test
 * - SCRUM-80 [T-23] Thêm mạng đủ bốn loại quan hệ
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { SchedulerService } = require('../src/domain/scheduling/schedulerService');
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
  // 1. Kiểm tra fixture tĩnh và metadata
  assert.ok(K01_NETWORK.metadata, 'Fixture K-01 phải có metadata');
  assert.equal(typeof K01_NETWORK.metadata.calculator, 'string', 'Phải ghi người tính toán');
  assert.ok(K01_NETWORK.metadata.calculationDate, 'Phải có ngày tính toán');
  assert.equal(K01_NETWORK.metadata.reviewer, 'PENDING INDEPENDENT REVIEW', 'Ghi rõ trạng thái reviewer');

  // 2. Chạy tính toán bằng SchedulerService
  const scheduler = new SchedulerService({});
  const result = scheduler.computeSchedule(K01_NETWORK.tasks, K01_NETWORK.dependencies);

  assert.equal(result.hasCycle, false, 'K-01 không có chu trình');
  assert.equal(result.projectDuration, K01_NETWORK.expected.projectDuration, 'Thời lượng dự án K-01 phải là 12 ngày');

  // 3. So khớp từng task với expected tĩnh
  const verification = verifyScheduleAgainstExpected(
    result.tasks,
    K01_NETWORK.expected.tasks,
    result.projectDuration,
    K01_NETWORK.expected.projectDuration
  );

  assert.equal(verification.matches, true, `Mismatches in K-01: ${verification.mismatches.join('; ')}`);

  // Chi tiết từng mốc công việc K-01
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
// TEST 2: SCRUM-80 [T-23] - Mạng 1: Đủ 4 loại quan hệ (FS, SS, FF, SF) & lag âm
// ============================================================
test('S-10 / T-23: Mạng độc lập 1 đủ 4 loại quan hệ FS, SS, FF, SF và lag âm khớp tính tay', () => {
  const fixture = NETWORK_1_ALL_RELATIONS_NEGATIVE_LAG;

  // 1. Kiểm tra bao phủ 4 loại quan hệ và lag âm
  const typesUsed = new Set(fixture.dependencies.map(d => d.type));
  assert.ok(typesUsed.has('FS'), 'Phải bao phủ quan hệ FS');
  assert.ok(typesUsed.has('SS'), 'Phải bao phủ quan hệ SS');
  assert.ok(typesUsed.has('FF'), 'Phải bao phủ quan hệ FF');
  assert.ok(typesUsed.has('SF'), 'Phải bao phủ quan hệ SF');

  const hasNegativeLag = fixture.dependencies.some(d => Number(d.lag) < 0);
  assert.ok(hasNegativeLag, 'Phải có ít nhất một quan hệ có độ trễ lag âm (lead time)');

  // 2. Chạy tính toán bằng SchedulerService
  const scheduler = new SchedulerService({});
  const result = scheduler.computeSchedule(fixture.tasks, fixture.dependencies);

  assert.equal(result.hasCycle, false);
  assert.equal(result.projectDuration, 14);

  // 3. So khớp với kết quả tính tay tĩnh
  const verification = verifyScheduleAgainstExpected(
    result.tasks,
    fixture.expected.tasks,
    result.projectDuration,
    fixture.expected.projectDuration
  );

  assert.equal(verification.matches, true, `Mismatches in Network 1: ${verification.mismatches.join('; ')}`);

  // Chi tiết từng task
  const taskMap = new Map(result.tasks.map(t => [String(t.taskId), t]));
  
  // N1_A: ES=0, EF=5, LS=0, LF=5, Float=0, Critical=true
  assert.deepEqual(taskMap.get('N1_A'), {
    id: 'N1_A',
    taskId: 'N1_A',
    code: 'T1',
    name: 'Thi công cọc đại trà',
    status: undefined,
    duration: 5,
    earlyStart: 0,
    earlyFinish: 5,
    lateStart: 0,
    lateFinish: 5,
    totalFloat: 0,
    isCritical: true
  });

  // N1_B: ES=2, EF=6, LS=7, LF=11, Float=5, Critical=false
  assert.deepEqual(taskMap.get('N1_B'), {
    id: 'N1_B',
    taskId: 'N1_B',
    code: 'T2',
    name: 'Đào đất tầng hầm',
    status: undefined,
    duration: 4,
    earlyStart: 2,
    earlyFinish: 6,
    lateStart: 7,
    lateFinish: 11,
    totalFloat: 5,
    isCritical: false
  });

  // N1_C: ES=3, EF=9, LS=3, LF=9, Float=0, Critical=true (bị kéo sớm bởi lag âm -2 từ A)
  assert.deepEqual(taskMap.get('N1_C'), {
    id: 'N1_C',
    taskId: 'N1_C',
    code: 'T3',
    name: 'Gia cố vách shoring',
    status: undefined,
    duration: 6,
    earlyStart: 3,
    earlyFinish: 9,
    lateStart: 3,
    lateFinish: 9,
    totalFloat: 0,
    isCritical: true
  });

  // N1_D: ES=9, EF=14, LS=9, LF=14, Float=0, Critical=true
  assert.deepEqual(taskMap.get('N1_D'), {
    id: 'N1_D',
    taskId: 'N1_D',
    code: 'T4',
    name: 'Bê tông đài giằng móng',
    status: undefined,
    duration: 5,
    earlyStart: 9,
    earlyFinish: 14,
    lateStart: 9,
    lateFinish: 14,
    totalFloat: 0,
    isCritical: true
  });
});

// ============================================================
// TEST 3: SCRUM-80 [T-23] - Mạng 2: Hai nhánh song song lệch nhau ba ngày
// ============================================================
test('S-10 / T-23: Mạng độc lập 2 có hai nhánh song song lệch nhau 3 ngày float', () => {
  const fixture = NETWORK_2_PARALLEL_BRANCHES_OFFSET_3_DAYS;

  const scheduler = new SchedulerService({});
  const result = scheduler.computeSchedule(fixture.tasks, fixture.dependencies);

  assert.equal(result.hasCycle, false);
  assert.equal(result.projectDuration, 12);

  const taskMap = new Map(result.tasks.map(t => [String(t.taskId), t]));
  const branch1 = taskMap.get('N2_B1');
  const branch2 = taskMap.get('N2_B2');

  assert.ok(branch1, 'Phải có nhánh B1');
  assert.ok(branch2, 'Phải có nhánh B2');

  // Kiểm tra độ lệch đúng 3 ngày float giữa 2 nhánh song song
  assert.equal(branch1.totalFloat, 0, 'Nhánh dài B1 thuộc đường găng (float = 0)');
  assert.equal(branch1.isCritical, true);

  assert.equal(branch2.totalFloat, 3, 'Nhánh ngắn B2 có float đúng bằng 3 ngày');
  assert.equal(branch2.isCritical, false);

  assert.equal(branch2.totalFloat - branch1.totalFloat, 3, 'Độ lệch float giữa 2 nhánh song song đúng 3 ngày');

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

  // Assert rằng mismatch được phát hiện chính xác, không bị bỏ lọt
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
test('S-10 / T-23: Metadata kiểm toán tuân thủ quy tắc không bịa đặt tên người kiểm tra', () => {
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
      'PENDING INDEPENDENT REVIEW',
      `Fixture ${f.metadata.id} phải ghi rõ PENDING INDEPENDENT REVIEW khi chưa có chữ ký người thứ 2 ngoài đời thực`
    );
  }
});
