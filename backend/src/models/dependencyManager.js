/**
 * Sprint S-06: Quản lý quan hệ phụ thuộc đủ bốn loại (FS, SS, FF, SF) và độ trễ
 * User Story: Là ban quản lý dự án, tôi muốn khai việc nào phải chờ việc nào
 * theo đúng loại quan hệ thực tế để hệ thống tính được tiến độ.
 * 
 * Tiêu chí chấp nhận:
 * 1. Lưu được đầy đủ FS, SS, FF và SF.
 * 2. Quan hệ có thể có độ trễ dương, bằng 0 hoặc âm.
 * 3. Không cho một công việc phụ thuộc chính nó.
 * 4. Không cho trùng cặp công việc trước và công việc sau.
 * 5. Loại quan hệ lưu bằng mã cố định, không lưu chuỗi tiếng Việt.
 */

// Bốn loại quan hệ chuẩn quốc tế với mã cố định (Strict Fixed Codes)
const DEPENDENCY_TYPES = {
  FS: {
    code: 'FS',
    name: 'Finish-to-Start',
    vn_name: 'Kết thúc – Khởi đầu',
    description: 'Công việc sau chỉ có thể bắt đầu khi công việc trước đã kết thúc.'
  },
  SS: {
    code: 'SS',
    name: 'Start-to-Start',
    vn_name: 'Khởi đầu – Khởi đầu',
    description: 'Công việc sau chỉ có thể bắt đầu khi công việc trước đã bắt đầu.'
  },
  FF: {
    code: 'FF',
    name: 'Finish-to-Finish',
    vn_name: 'Kết thúc – Kết thúc',
    description: 'Công việc sau chỉ có thể kết thúc khi công việc trước đã kết thúc.'
  },
  SF: {
    code: 'SF',
    name: 'Start-to-Finish',
    vn_name: 'Khởi đầu – Kết thúc',
    description: 'Công việc sau chỉ có thể kết thúc khi công việc trước đã bắt đầu.'
  }
};

const ALLOWED_TYPE_CODES = Object.keys(DEPENDENCY_TYPES);

/**
 * Kiểm tra tính hợp lệ của quan hệ phụ thuộc theo các tiêu chí chấp nhận S-06
 * @param {Object} data - Dữ liệu quan hệ cần kiểm tra
 * @param {Array} existingDependencies - Danh sách các quan hệ hiện có
 * @param {number|null} currentId - ID của quan hệ nếu đang cập nhật (để bỏ qua chính nó khi kiểm tra trùng)
 * @returns {{ valid: boolean, error?: string, sanitized?: Object }}
 */
function validateDependency(data, existingDependencies = [], currentId = null) {
  if (!data) {
    return { valid: false, error: 'Thiếu dữ liệu khai báo quan hệ phụ thuộc.' };
  }

  // 1. Kiểm tra ID công việc trước và sau
  const pred = parseInt(data.predecessor_id, 10);
  const succ = parseInt(data.successor_id, 10);

  if (isNaN(pred) || isNaN(succ) || pred <= 0 || succ <= 0) {
    return {
      valid: false,
      error: 'Công việc trước (predecessor) và công việc sau (successor) phải là mã số hợp lệ.'
    };
  }

  // 2. Tiêu chí 3: Không cho một công việc phụ thuộc chính nó
  if (pred === succ) {
    return {
      valid: false,
      error: 'Không cho một công việc phụ thuộc chính nó (Công việc trước và công việc sau không được trùng nhau).'
    };
  }

  // 3. Tiêu chí 5 & 1: Loại quan hệ lưu bằng mã cố định (FS, SS, FF, SF), không lưu chuỗi tiếng Việt
  const rawType = typeof data.dependency_type === 'string' ? data.dependency_type.trim().toUpperCase() : '';
  if (!ALLOWED_TYPE_CODES.includes(rawType)) {
    return {
      valid: false,
      error: 'Loại quan hệ không hợp lệ. Hệ thống chỉ chấp nhận mã cố định: FS, SS, FF, SF (không lưu chuỗi tiếng Việt).'
    };
  }

  // 4. Tiêu chí 2: Quan hệ có thể có độ trễ dương, bằng 0 hoặc âm
  const lagInput = data.lag !== undefined && data.lag !== null && data.lag !== '' ? data.lag : 0;
  const parsedLag = Number(lagInput);

  if (isNaN(parsedLag) || !Number.isInteger(parsedLag)) {
    return {
      valid: false,
      error: 'Độ trễ (lag) phải là số nguyên (cho phép số dương, bằng 0 hoặc số âm).'
    };
  }

  // 5. Tiêu chí 4: Không cho trùng cặp công việc trước và công việc sau
  const isDuplicate = existingDependencies.some(d => {
    const isSamePair = parseInt(d.predecessor_id, 10) === pred && parseInt(d.successor_id, 10) === succ;
    if (!isSamePair) return false;
    if (currentId && (parseInt(d.id, 10) === parseInt(currentId, 10))) {
      return false; // Bỏ qua bản ghi đang cập nhật
    }
    return true;
  });

  if (isDuplicate) {
    return {
      valid: false,
      error: `Không cho trùng cặp công việc trước và công việc sau. Cặp quan hệ giữa việc ID ${pred} và việc ID ${succ} đã tồn tại.`
    };
  }

  return {
    valid: true,
    sanitized: {
      project_id: parseInt(data.project_id, 10) || 1,
      predecessor_id: pred,
      successor_id: succ,
      dependency_type: rawType, // Lưu đúng mã cố định FS, SS, FF, SF
      lag: parsedLag
    }
  };
}

// Bộ nhớ In-Memory lưu trữ các quan hệ phụ thuộc mẫu cho chế độ Standalone / Test
let inMemoryDependencies = [
  {
    id: 1,
    project_id: 1,
    predecessor_id: 3, // HM-01.01.01: Đào đất thủ công hố móng
    successor_id: 4,   // HM-01.01.02: Vận chuyển đất thải
    dependency_type: 'FS',
    lag: 0,            // Độ trễ = 0
    created_at: new Date()
  },
  {
    id: 2,
    project_id: 1,
    predecessor_id: 4, // HM-01.01.02: Vận chuyển đất thải
    successor_id: 5,   // HM-01.02: Đổ bê tông lót móng
    dependency_type: 'FS',
    lag: 1,            // Độ trễ dương (+1 ngày)
    created_at: new Date()
  },
  {
    id: 3,
    project_id: 1,
    predecessor_id: 2, // HM-01.01: Đào đất hố móng
    successor_id: 5,   // HM-01.02: Đổ bê tông lót móng
    dependency_type: 'SS',
    lag: 0,            // Độ trễ = 0
    created_at: new Date()
  },
  {
    id: 4,
    project_id: 1,
    predecessor_id: 5, // HM-01.02: Đổ bê tông lót móng
    successor_id: 7,   // HM-02.01: Lắp dựng cốt thép cột vách
    dependency_type: 'FF',
    lag: 2,            // Độ trễ dương (+2 ngày)
    created_at: new Date()
  },
  {
    id: 5,
    project_id: 1,
    predecessor_id: 7, // HM-02.01: Lắp dựng cốt thép cột vách
    successor_id: 8,   // HM-02.02: Đổ bê tông sàn tầng 1
    dependency_type: 'SF',
    lag: -1,           // Độ trễ âm (-1 ngày / lead)
    created_at: new Date()
  }
];

function getAllDependencies(projectId = null) {
  if (projectId) {
    return inMemoryDependencies.filter(d => parseInt(d.project_id, 10) === parseInt(projectId, 10));
  }
  return [...inMemoryDependencies];
}

function getDependencyById(id) {
  return inMemoryDependencies.find(d => parseInt(d.id, 10) === parseInt(id, 10)) || null;
}

function createDependency(data) {
  const validation = validateDependency(data, inMemoryDependencies);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const newId = inMemoryDependencies.length > 0 
    ? Math.max(...inMemoryDependencies.map(d => parseInt(d.id, 10))) + 1 
    : 1;

  const record = {
    id: newId,
    ...validation.sanitized,
    created_at: new Date()
  };

  inMemoryDependencies.push(record);
  return record;
}

function updateDependency(id, updates) {
  const current = getDependencyById(id);
  if (!current) {
    throw new Error(`Không tìm thấy quan hệ phụ thuộc với ID ${id}`);
  }

  const merged = {
    ...current,
    ...updates,
    id: current.id
  };

  const validation = validateDependency(merged, inMemoryDependencies, id);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  Object.assign(current, validation.sanitized, { updated_at: new Date() });
  return current;
}

function deleteDependency(id) {
  const index = inMemoryDependencies.findIndex(d => parseInt(d.id, 10) === parseInt(id, 10));
  if (index === -1) {
    return false;
  }
  inMemoryDependencies.splice(index, 1);
  return true;
}

function deleteDependenciesForWorkItem(workItemId) {
  const targetId = parseInt(workItemId, 10);
  const beforeCount = inMemoryDependencies.length;
  inMemoryDependencies = inMemoryDependencies.filter(
    d => parseInt(d.predecessor_id, 10) !== targetId && parseInt(d.successor_id, 10) !== targetId
  );
  return beforeCount - inMemoryDependencies.length;
}

function resetInMemoryDependencies(initialData = null) {
  if (initialData) {
    inMemoryDependencies = [...initialData];
  } else {
    inMemoryDependencies = [];
  }
}

module.exports = {
  DEPENDENCY_TYPES,
  ALLOWED_TYPE_CODES,
  validateDependency,
  inMemoryDependencies,
  getAllDependencies,
  getDependencyById,
  createDependency,
  updateDependency,
  deleteDependency,
  deleteDependenciesForWorkItem,
  resetInMemoryDependencies
};
