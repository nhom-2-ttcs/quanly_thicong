const test = require('node:test');
const assert = require('node:assert');
const {
  DEPENDENCY_TYPES,
  ALLOWED_TYPE_CODES,
  validateDependency,
  createDependency,
  getDependencyById,
  getAllDependencies,
  updateDependency,
  deleteDependency,
  deleteDependenciesForWorkItem,
  resetInMemoryDependencies
} = require('../src/models/dependencyManager');

test.beforeEach(() => {
  // Đặt lại dữ liệu sạch trước mỗi test case
  resetInMemoryDependencies([]);
});

// =========================================================================
// TIÊU CHÍ 1: Lưu được đầy đủ FS, SS, FF và SF
// =========================================================================
test('TC-1: Lưu được đầy đủ 4 loại quan hệ FS, SS, FF và SF với mã chuẩn', () => {
  assert.strictEqual(ALLOWED_TYPE_CODES.length, 4, 'Hệ thống phải hỗ trợ đúng 4 loại quan hệ');
  assert.deepStrictEqual(ALLOWED_TYPE_CODES.sort(), ['FF', 'FS', 'SF', 'SS'], 'Gồm các mã: FS, SS, FF, SF');

  // 1. Thử tạo FS (Finish-to-Start: Kết thúc - Khởi đầu)
  const depFS = createDependency({
    project_id: 1,
    predecessor_id: 1,
    successor_id: 2,
    dependency_type: 'FS',
    lag: 0
  });
  assert.strictEqual(depFS.dependency_type, 'FS');

  // 2. Thử tạo SS (Start-to-Start: Khởi đầu - Khởi đầu)
  const depSS = createDependency({
    project_id: 1,
    predecessor_id: 2,
    successor_id: 3,
    dependency_type: 'SS',
    lag: 1
  });
  assert.strictEqual(depSS.dependency_type, 'SS');

  // 3. Thử tạo FF (Finish-to-Finish: Kết thúc - Kết thúc)
  const depFF = createDependency({
    project_id: 1,
    predecessor_id: 3,
    successor_id: 4,
    dependency_type: 'FF',
    lag: 2
  });
  assert.strictEqual(depFF.dependency_type, 'FF');

  // 4. Thử tạo SF (Start-to-Finish: Khởi đầu - Kết thúc)
  const depSF = createDependency({
    project_id: 1,
    predecessor_id: 4,
    successor_id: 5,
    dependency_type: 'SF',
    lag: -1
  });
  assert.strictEqual(depSF.dependency_type, 'SF');

  const all = getAllDependencies(1);
  assert.strictEqual(all.length, 4, 'Cả 4 quan hệ phải được lưu thành công');
  const storedTypes = all.map(d => d.dependency_type);
  assert.ok(storedTypes.includes('FS'));
  assert.ok(storedTypes.includes('SS'));
  assert.ok(storedTypes.includes('FF'));
  assert.ok(storedTypes.includes('SF'));
});

// =========================================================================
// TIÊU CHÍ 2: Quan hệ có thể có độ trễ dương, bằng 0 hoặc âm
// =========================================================================
test('TC-2: Quan hệ có thể có độ trễ dương, bằng 0 hoặc âm (Lead/Lag)', () => {
  // 1. Độ trễ dương (+5 ngày)
  const depPositive = createDependency({
    project_id: 1,
    predecessor_id: 10,
    successor_id: 11,
    dependency_type: 'FS',
    lag: 5
  });
  assert.strictEqual(depPositive.lag, 5, 'Độ trễ dương phải được lưu chính xác là 5');

  // 2. Độ trễ bằng 0
  const depZero = createDependency({
    project_id: 1,
    predecessor_id: 11,
    successor_id: 12,
    dependency_type: 'FS',
    lag: 0
  });
  assert.strictEqual(depZero.lag, 0, 'Độ trễ bằng 0 phải được lưu chính xác là 0');

  // 3. Độ trễ âm (-3 ngày: Lead time / gối đầu sớm)
  const depNegative = createDependency({
    project_id: 1,
    predecessor_id: 12,
    successor_id: 13,
    dependency_type: 'SS',
    lag: -3
  });
  assert.strictEqual(depNegative.lag, -3, 'Độ trễ âm phải được lưu chính xác là -3');

  // 4. Kiểm tra độ trễ không hợp lệ (không phải số nguyên)
  const invalidLagResult = validateDependency({
    project_id: 1,
    predecessor_id: 1,
    successor_id: 2,
    dependency_type: 'FS',
    lag: 'không_phải_số'
  });
  assert.strictEqual(invalidLagResult.valid, false);
  assert.match(invalidLagResult.error, /Độ trễ/);
});

// =========================================================================
// TIÊU CHÍ 3: Không cho một công việc phụ thuộc chính nó
// =========================================================================
test('TC-3: Chặn một công việc phụ thuộc chính nó (Self-dependency)', () => {
  const result = validateDependency({
    project_id: 1,
    predecessor_id: 7,
    successor_id: 7, // Trùng với predecessor
    dependency_type: 'FS',
    lag: 0
  });

  assert.strictEqual(result.valid, false, 'Phải từ chối khi predecessor_id === successor_id');
  assert.match(result.error, /Không cho một công việc phụ thuộc chính nó/);

  // Kiểm tra ném ngoại lệ khi gọi hàm createDependency
  assert.throws(() => {
    createDependency({
      project_id: 1,
      predecessor_id: 7,
      successor_id: 7,
      dependency_type: 'FS',
      lag: 0
    });
  }, /Không cho một công việc phụ thuộc chính nó/);
});

// =========================================================================
// TIÊU CHÍ 4: Không cho trùng cặp công việc trước và công việc sau
// =========================================================================
test('TC-4: Không cho trùng cặp công việc trước và công việc sau', () => {
  // Tạo cặp đầu tiên giữa việc 2 và việc 5
  createDependency({
    project_id: 1,
    predecessor_id: 2,
    successor_id: 5,
    dependency_type: 'FS',
    lag: 0
  });

  // Cố gắng tạo thêm quan hệ nữa giữa cùng cặp (2 -> 5) dù khác loại hay khác lag
  const duplicateAttempt = validateDependency({
    project_id: 1,
    predecessor_id: 2,
    successor_id: 5,
    dependency_type: 'SS',
    lag: 2
  }, getAllDependencies());

  assert.strictEqual(duplicateAttempt.valid, false, 'Không được phép thêm trùng cặp (2, 5)');
  assert.match(duplicateAttempt.error, /Không cho trùng cặp công việc trước và công việc sau/);

  // Thử gọi createDependency phải quăng lỗi
  assert.throws(() => {
    createDependency({
      project_id: 1,
      predecessor_id: 2,
      successor_id: 5,
      dependency_type: 'FF',
      lag: 1
    });
  }, /Không cho trùng cặp/);

  // Ngược lại, cặp đảo chiều (5 -> 2) hoặc cặp khác (2 -> 6) thì hợp lệ
  const differentPair = validateDependency({
    project_id: 1,
    predecessor_id: 2,
    successor_id: 6,
    dependency_type: 'FS',
    lag: 0
  }, getAllDependencies());
  assert.strictEqual(differentPair.valid, true);
});

// =========================================================================
// TIÊU CHÍ 5: Loại quan hệ lưu bằng mã cố định, không lưu chuỗi tiếng Việt
// =========================================================================
test('TC-5: Loại quan hệ lưu bằng mã cố định, từ chối chuỗi tiếng Việt', () => {
  // 1. Thử gửi chuỗi tiếng Việt "Kết thúc – Khởi đầu"
  const vnTextAttempt1 = validateDependency({
    project_id: 1,
    predecessor_id: 1,
    successor_id: 2,
    dependency_type: 'Kết thúc – Khởi đầu',
    lag: 0
  });
  assert.strictEqual(vnTextAttempt1.valid, false, 'Phải từ chối chuỗi tiếng Việt');
  assert.match(vnTextAttempt1.error, /mã cố định: FS, SS, FF, SF/);

  // 2. Thử gửi chuỗi tiếng Việt "Khởi đầu – Khởi đầu"
  const vnTextAttempt2 = validateDependency({
    project_id: 1,
    predecessor_id: 1,
    successor_id: 2,
    dependency_type: 'Khởi đầu – Khởi đầu',
    lag: 0
  });
  assert.strictEqual(vnTextAttempt2.valid, false);

  // 3. Thử gửi chuỗi tùy tiện không hợp lệ "ABC"
  const invalidCodeAttempt = validateDependency({
    project_id: 1,
    predecessor_id: 1,
    successor_id: 2,
    dependency_type: 'ABC',
    lag: 0
  });
  assert.strictEqual(invalidCodeAttempt.valid, false);

  // 4. Gửi đúng mã chuẩn 'FS' hoặc chữ thường 'fs' được chuẩn hóa thành 'FS'
  const validAttempt = validateDependency({
    project_id: 1,
    predecessor_id: 1,
    successor_id: 2,
    dependency_type: 'fs',
    lag: 0
  });
  assert.strictEqual(validAttempt.valid, true);
  assert.strictEqual(validAttempt.sanitized.dependency_type, 'FS', 'Mã lưu phải là FS viết hoa cố định');
});

// =========================================================================
// BỔ SUNG: Kiểm tra Cập nhật (PUT) & Xóa (DELETE) & Cascade Clean-up
// =========================================================================
test('TC-6: Cập nhật và Xóa quan hệ phụ thuộc thành công', () => {
  const dep = createDependency({
    project_id: 1,
    predecessor_id: 20,
    successor_id: 21,
    dependency_type: 'FS',
    lag: 0
  });

  // Cập nhật đổi sang SS và lag = 3
  const updated = updateDependency(dep.id, {
    dependency_type: 'SS',
    lag: 3
  });
  assert.strictEqual(updated.dependency_type, 'SS');
  assert.strictEqual(updated.lag, 3);

  // Xóa quan hệ
  const deleteSuccess = deleteDependency(dep.id);
  assert.strictEqual(deleteSuccess, true);
  assert.strictEqual(getDependencyById(dep.id), null);
});

test('TC-7: Tự động dọn dẹp quan hệ khi công việc bị xóa (Cascade Clean-up)', () => {
  createDependency({
    project_id: 1,
    predecessor_id: 100,
    successor_id: 101,
    dependency_type: 'FS',
    lag: 0
  });
  createDependency({
    project_id: 1,
    predecessor_id: 101,
    successor_id: 102,
    dependency_type: 'SS',
    lag: 1
  });

  assert.strictEqual(getAllDependencies().length, 2);

  // Khi công việc 101 bị xóa, cả 2 quan hệ liên quan đến 101 phải được dọn dẹp
  const removedCount = deleteDependenciesForWorkItem(101);
  assert.strictEqual(removedCount, 2);
  assert.strictEqual(getAllDependencies().length, 0);
});
