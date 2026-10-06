const assert = require('assert');
const {
  dateToCoordinateX,
  calculateBarWidth,
  generateTimeTicks
} = require('./timelineScale');

const BASE_DATE = '2026-10-01';

console.log('--- Chạy Unit Test T-30 (Hàm đổi tọa độ trục thời gian) ---');

// Mốc 1 tính tay: Trùng ngày khởi công -> X = 0
assert.strictEqual(dateToCoordinateX('2026-10-01', BASE_DATE, 'day', 40, 105), 0);
assert.strictEqual(dateToCoordinateX('2026-10-01', BASE_DATE, 'week', 40, 105), 0);
console.log('✓ Mốc 1 (Ngày khởi công): Pass');

// Mốc 2 tính tay: Sau 7 ngày -> Day = 280px, Week = 105px
assert.strictEqual(dateToCoordinateX('2026-10-08', BASE_DATE, 'day', 40, 105), 280);
assert.strictEqual(dateToCoordinateX('2026-10-08', BASE_DATE, 'week', 40, 105), 105);
console.log('✓ Mốc 2 (Sau 7 ngày): Pass');

// Mốc 3 tính tay: Sau 14 ngày, độ dài thanh 5 ngày (đến 2026-10-20)
assert.strictEqual(dateToCoordinateX('2026-10-15', BASE_DATE, 'day', 40, 105), 560);
assert.strictEqual(calculateBarWidth('2026-10-15', '2026-10-20', 'day', 40, 105), 200);
assert.strictEqual(calculateBarWidth('2026-10-15', '2026-10-20', 'week', 40, 105), 75);
console.log('✓ Mốc 3 (Sau 14 ngày & độ dài thanh 5 ngày): Pass');

// Kiểm tra đổi chế độ ticks Ngày và Tuần
const dayTicks = generateTimeTicks(BASE_DATE, 14, 'day');
const weekTicks = generateTimeTicks(BASE_DATE, 14, 'week');
assert.strictEqual(dayTicks.length, 15);
assert.strictEqual(weekTicks.length, 3);
console.log('✓ Vạch chia Ngày / Tuần: Pass');

console.log('===> TẤT CẢ UNIT TEST T-30 ĐÃ PASS 100%!');
