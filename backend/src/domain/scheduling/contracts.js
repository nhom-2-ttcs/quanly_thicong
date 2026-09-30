/**
 * HỢP ĐỒNG GIAO DIỆN TÍCH HỢP NỘI BỘ (S-06 / SCRUM-61 -> S-07 / SCRUM-62)
 * 
 * Tài liệu kỹ thuật giao tiếp giữa Story S-06 (Quan hệ phụ thuộc FS, SS, FF, SF và độ trễ)
 * do thành viên khác thực hiện và Story S-07 (Sắp thứ tự phụ thuộc & phát hiện vòng).
 * 
 * Lưu ý: File này chỉ định nghĩa Interface Contract theo Quy tắc 2, KHÔNG tự ý tạo bảng
 * hay ghi đè phần việc của thành viên đang làm S-06.
 */

const DEPENDENCY_TYPES = Object.freeze({
  FS: 'FS', // Finish-to-Start (Hoàn thành - Bắt đầu, phổ biến nhất)
  SS: 'SS', // Start-to-Start (Bắt đầu - Bắt đầu)
  FF: 'FF', // Finish-to-Finish (Hoàn thành - Hoàn thành)
  SF: 'SF'  // Start-to-Finish (Bắt đầu - Hoàn thành)
});

/**
 * Validate một dependency record nhận từ S-06
 * @param {Object} dep
 * @returns {{ valid: boolean, error?: string }}
 */
function validateDependencyContract(dep) {
  if (!dep) {
    return { valid: false, error: 'Dữ liệu quan hệ phụ thuộc không được để trống' };
  }

  const predId = Number(dep.predecessorId ?? dep.predecessor_id);
  const succId = Number(dep.successorId ?? dep.successor_id);

  if (!Number.isInteger(predId) || predId <= 0) {
    return { valid: false, error: 'predecessorId phải là số nguyên dương hợp lệ' };
  }

  if (!Number.isInteger(succId) || succId <= 0) {
    return { valid: false, error: 'successorId phải là số nguyên dương hợp lệ' };
  }

  if (predId === succId) {
    return { valid: false, error: 'Công việc không thể tự phụ thuộc chính nó (Self-loop)' };
  }

  const type = (dep.type || 'FS').toUpperCase();
  if (!DEPENDENCY_TYPES[type]) {
    return { valid: false, error: `Loại quan hệ '${type}' không hợp lệ. Phải là một trong: FS, SS, FF, SF` };
  }

  const lag = dep.lag !== undefined && dep.lag !== null ? Number(dep.lag) : 0;
  if (!Number.isFinite(lag)) {
    return { valid: false, error: 'Độ trễ lag phải là số hữu hạn (hỗ trợ số âm, 0 hoặc dương)' };
  }

  return { valid: true };
}

module.exports = {
  DEPENDENCY_TYPES,
  validateDependencyContract
};
