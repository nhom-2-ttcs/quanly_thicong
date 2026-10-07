const DEPENDENCY_TYPES = Object.freeze({ FS: 'FS', SS: 'SS', FF: 'FF', SF: 'SF' });

function validateDependencyContract(dependency) {
  if (!dependency || typeof dependency !== 'object') {
    return { valid: false, error: 'Dữ liệu quan hệ phụ thuộc không hợp lệ' };
  }
  const predecessorId = dependency.predecessorId;
  const successorId = dependency.successorId;
  if (predecessorId === undefined || predecessorId === null || predecessorId === '') {
    return { valid: false, error: 'predecessorId không hợp lệ' };
  }
  if (successorId === undefined || successorId === null || successorId === '') {
    return { valid: false, error: 'successorId không hợp lệ' };
  }
  if (String(predecessorId) === String(successorId)) {
    return { valid: false, error: 'Công việc không thể tự phụ thuộc chính nó (Self-loop)' };
  }
  const type = String(dependency.type ?? '').toUpperCase();
  if (!DEPENDENCY_TYPES[type]) {
    return { valid: false, error: `Loại quan hệ '${type}' không hợp lệ. Phải là FS, SS, FF hoặc SF` };
  }
  const lag = Number(dependency.lag ?? 0);
  if (!Number.isFinite(lag)) {
    return { valid: false, error: 'Độ trễ lag phải là số hữu hạn' };
  }
  return { valid: true };
}

module.exports = { DEPENDENCY_TYPES, validateDependencyContract };
