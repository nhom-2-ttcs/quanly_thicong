const assert = require('node:assert');

const {
  calculateBackwardPass,
  calculateProjectDuration,
  calculateRelationWeight
} = require('../src/algorithms/backwardPass');

console.log('--- T20/T21: Backward Pass Tests ---');

const tasks = [
  { id: 'A', duration: 3, predecessors: [] },
  { id: 'B', duration: 2, predecessors: [{ id: 'A', type: 'FS', lag: 0 }] },
  { id: 'C', duration: 1, predecessors: [{ id: 'A', type: 'FS', lag: 0 }] },
  { id: 'D', duration: 1, predecessors: [{ id: 'B', type: 'FS', lag: 0 }, { id: 'C', type: 'FS', lag: 0 }] }
];

const earlySchedule = [
  { id: 'A', earlyStart: 0, earlyFinish: 3 },
  { id: 'B', earlyStart: 3, earlyFinish: 5 },
  { id: 'C', earlyStart: 3, earlyFinish: 4 },
  { id: 'D', earlyStart: 5, earlyFinish: 6 }
];

const result = calculateBackwardPass(tasks, ['A', 'B', 'C', 'D'], earlySchedule);

console.log('Manual network result:', result);

assert.strictEqual(
  calculateProjectDuration(tasks, new Map(earlySchedule.map(item => [String(item.id), item]))),
  6,
  'Project duration phải bằng max EF'
);

assert.strictEqual(result[0].lateFinish, 3, 'A: LF phải bằng 3');
assert.strictEqual(result[0].lateStart, 0, 'A: LS phải bằng 0');
assert.strictEqual(result[1].lateFinish, 5, 'B: LF phải bằng 5');
assert.strictEqual(result[1].lateStart, 3, 'B: LS phải bằng 3');
assert.strictEqual(result[2].lateFinish, 5, 'C: LF phải bằng 5');
assert.strictEqual(result[2].lateStart, 4, 'C: LS phải bằng 4');
assert.strictEqual(result[3].lateFinish, 6, 'D: LF phải bằng 6');
assert.strictEqual(result[3].lateStart, 5, 'D: LS phải bằng 5');

assert.strictEqual(result[0].totalFloat, 0, 'A phải là công việc găng');
assert.strictEqual(result[1].totalFloat, 0, 'B phải là công việc găng');
assert.strictEqual(result[2].totalFloat, 1, 'C phải có độ trễ 1');
assert.strictEqual(result[3].totalFloat, 0, 'D phải là công việc găng');

assert.strictEqual(result[0].isCritical, true, 'A phải là critical');
assert.strictEqual(result[1].isCritical, true, 'B phải là critical');
assert.strictEqual(result[2].isCritical, false, 'C không phải critical');
assert.strictEqual(result[3].isCritical, true, 'D phải là critical');

console.log('✓ Manual network backward pass matched expected values');

const relationChecksum = [
  { type: 'FS', lag: 0, predecessor: { duration: 3 }, successor: { duration: 2 }, expected: 3 },
  { type: 'SS', lag: 2, predecessor: { duration: 3 }, successor: { duration: 2 }, expected: 2 },
  { type: 'FF', lag: 2, predecessor: { duration: 3 }, successor: { duration: 2 }, expected: 3 + 2 - 2 },
  { type: 'SF', lag: 2, predecessor: { duration: 3 }, successor: { duration: 2 }, expected: 2 - 2 }
];

for (const item of relationChecksum) {
  assert.strictEqual(
    calculateRelationWeight(item.predecessor, item.successor, item.type, item.lag),
    item.expected,
    `${item.type} weight must match formula`
  );
}

console.log('✓ Relation weight formulas validated');

const branchingTasks = [
  { id: 'A', duration: 3, predecessors: [] },
  { id: 'B', duration: 2, predecessors: [{ id: 'A', type: 'FS', lag: 0 }] },
  { id: 'C', duration: 1, predecessors: [{ id: 'A', type: 'FS', lag: 0 }] },
  { id: 'D', duration: 1, predecessors: [{ id: 'B', type: 'FS', lag: 0 }, { id: 'C', type: 'FS', lag: 0 }] }
];

const branchingEarly = [
  { id: 'A', earlyStart: 0, earlyFinish: 3 },
  { id: 'B', earlyStart: 3, earlyFinish: 5 },
  { id: 'C', earlyStart: 3, earlyFinish: 4 },
  { id: 'D', earlyStart: 5, earlyFinish: 6 }
];

const branchingResult = calculateBackwardPass(branchingTasks, ['A', 'B', 'C', 'D'], branchingEarly);

assert.strictEqual(branchingResult[0].lateStart, 0, 'A: late start should be zero');
assert.strictEqual(branchingResult[2].totalFloat, 1, 'C must have one-day float when the branch is shorter than the critical path');
assert.strictEqual(branchingResult[3].lateFinish, 6, 'Final task must finish at project duration');
assert.strictEqual(branchingResult[3].totalFloat, 0, 'Final task remains critical');

console.log('✓ Short branch / long branch float check passed');

const floatingTasks = [
  { id: 'X', duration: 1.5, predecessors: [] },
  { id: 'Y', duration: 2.5, predecessors: [{ id: 'X', type: 'FS', lag: 0.5 }] },
  { id: 'Z', duration: 0.5, predecessors: [{ id: 'Y', type: 'FS', lag: 0.25 }] }
];

const floatingEarly = [
  { id: 'X', earlyStart: 0, earlyFinish: 1.5 },
  { id: 'Y', earlyStart: 2, earlyFinish: 4.5 },
  { id: 'Z', earlyStart: 4.75, earlyFinish: 5.25 }
];

const floatingResult = calculateBackwardPass(floatingTasks, ['X', 'Y', 'Z'], floatingEarly);

assert.ok(Math.abs(floatingResult[1].lateStart - 2) < 1e-9, 'Late start should honor fractional duration on the critical path');
assert.ok(Math.abs(floatingResult[1].totalFloat) < 1e-9, 'Critical fractional path should keep zero float');
assert.ok(floatingResult[0].isCritical, 'Critical path should remain valid for fractional tasks');
assert.ok(!Object.is(floatingResult[1].totalFloat, -0), 'No negative zero should appear');

console.log('✓ Fractional and epsilon checks passed');

console.log('--- T20/T21: ALL TESTS PASSED ---');
