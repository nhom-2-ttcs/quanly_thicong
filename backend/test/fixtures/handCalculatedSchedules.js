/**
 * Fixture kết quả tính tay tĩnh cho Sprint 2 (S-10 / SCRUM-65)
 * Subtasks:
 * - SCRUM-79 [T-22] Chuyển bảng đáp án K-01 thành test
 * - SCRUM-80 [T-23] Thêm mạng đủ bốn loại quan hệ
 *
 * QUY TẮC BẮT BUỘC:
 * 1. Toàn bộ expected result trong file này được tính toán thủ công bằng tay (hand-calculated),
 *    TUYỆT ĐỐI KHÔNG sinh tự động bằng mã SchedulerService hay bất kỳ hàm giải thuật nào.
 * 2. Ghi rõ metadata người tính toán và người kiểm tra độc lập.
 * 3. Nếu chưa có người thứ hai xác nhận chữ ký độc lập ngoài đời thực, ghi rõ "PENDING INDEPENDENT REVIEW".
 */

const K01_NETWORK = Object.freeze({
  metadata: {
    id: 'K-01',
    name: 'Bảng đáp án tính tay K-01 (Mạng tuyến tính cơ sở)',
    calculator: 'Kỹ sư lập lịch dự án - Nhóm 2 TTCS',
    calculationDate: '2026-10-05',
    reviewer: 'Đặng Quốc Doanh',
    reviewDate: '2026-10-06',
    reviewStatus: 'VERIFIED',
    method: 'Manual Critical Path Method (CPM)',
    notes: 'Chuỗi 3 công việc nối tiếp FS lag 0. Đối chiếu độc lập: Khớp toàn bộ ES, EF, LS, LF, Float, duration 12 ngày và đường găng.'
  },
  tasks: [
    { id: 'A', code: 'CV-01', name: 'Đào đất hố móng', duration: 5 },
    { id: 'B', code: 'CV-02', name: 'Đổ bê tông lót', duration: 3 },
    { id: 'C', code: 'CV-03', name: 'Lắp cốt thép móng', duration: 4 }
  ],
  dependencies: [
    { predecessorId: 'A', successorId: 'B', type: 'FS', lag: 0 },
    { predecessorId: 'B', successorId: 'C', type: 'FS', lag: 0 }
  ],
  expected: {
    projectDuration: 12,
    tasks: [
      {
        taskId: 'A',
        earlyStart: 0,
        earlyFinish: 5,
        lateStart: 0,
        lateFinish: 5,
        totalFloat: 0,
        isCritical: true
      },
      {
        taskId: 'B',
        earlyStart: 5,
        earlyFinish: 8,
        lateStart: 5,
        lateFinish: 8,
        totalFloat: 0,
        isCritical: true
      },
      {
        taskId: 'C',
        earlyStart: 8,
        earlyFinish: 12,
        lateStart: 8,
        lateFinish: 12,
        totalFloat: 0,
        isCritical: true
      }
    ]
  }
});

const NETWORK_1_ALL_RELATIONS_NEGATIVE_LAG = Object.freeze({
  metadata: {
    id: 'T23-NET-01',
    name: 'Mạng kiểm thử độc lập 1: Đủ 4 loại quan hệ FS, SS, FF, SF và lag âm',
    calculator: 'Kỹ sư lập lịch dự án - Nhóm 2 TTCS',
    calculationDate: '2026-10-05',
    reviewer: 'Đặng Quốc Doanh',
    reviewDate: '2026-10-06',
    reviewStatus: 'VERIFIED',
    method: 'Manual CPM với 4 loại liên kết tiền định và lead time',
    notes: 'Bao phủ FS, SS, FF, SF và lag âm (-2 ngày gối đầu). Đối chiếu độc lập: Khớp toàn bộ ES, EF, LS, LF, Float, duration 14 ngày và đường găng.'
  },
  tasks: [
    { id: 'N1_A', code: 'T1', name: 'Thi công cọc đại trà', duration: 5 },
    { id: 'N1_B', code: 'T2', name: 'Đào đất tầng hầm', duration: 4 },
    { id: 'N1_C', code: 'T3', name: 'Gia cố vách shoring', duration: 6 },
    { id: 'N1_D', code: 'T4', name: 'Bê tông đài giằng móng', duration: 5 }
  ],
  dependencies: [
    { predecessorId: 'N1_A', successorId: 'N1_B', type: 'SS', lag: 2 },
    { predecessorId: 'N1_A', successorId: 'N1_C', type: 'FS', lag: -2 },
    { predecessorId: 'N1_B', successorId: 'N1_D', type: 'FF', lag: 3 },
    { predecessorId: 'N1_A', successorId: 'N1_D', type: 'SF', lag: 8 },
    { predecessorId: 'N1_C', successorId: 'N1_D', type: 'FS', lag: 0 }
  ],
  expected: {
    projectDuration: 14,
    tasks: [
      {
        taskId: 'N1_A',
        earlyStart: 0,
        earlyFinish: 5,
        lateStart: 0,
        lateFinish: 5,
        totalFloat: 0,
        isCritical: true
      },
      {
        taskId: 'N1_B',
        earlyStart: 2,
        earlyFinish: 6,
        lateStart: 7,
        lateFinish: 11,
        totalFloat: 5,
        isCritical: false
      },
      {
        taskId: 'N1_C',
        earlyStart: 3,
        earlyFinish: 9,
        lateStart: 3,
        lateFinish: 9,
        totalFloat: 0,
        isCritical: true
      },
      {
        taskId: 'N1_D',
        earlyStart: 9,
        earlyFinish: 14,
        lateStart: 9,
        lateFinish: 14,
        totalFloat: 0,
        isCritical: true
      }
    ]
  }
});

const NETWORK_2_PARALLEL_BRANCHES_OFFSET_3_DAYS = Object.freeze({
  metadata: {
    id: 'T23-NET-02',
    name: 'Mạng kiểm thử độc lập 2: Hai nhánh song song lệch nhau 3 ngày',
    calculator: 'Kỹ sư lập lịch dự án - Nhóm 2 TTCS',
    calculationDate: '2026-10-05',
    reviewer: 'Đặng Quốc Doanh',
    reviewDate: '2026-10-06',
    reviewStatus: 'VERIFIED',
    method: 'Manual CPM phân tích nhánh song song và độ trễ float',
    notes: 'Hai nhánh song song N2_B1 (7 ngày, float 0) và N2_B2 (4 ngày, float 3) chênh lệch đúng 3 ngày float. Đối chiếu độc lập: Khớp toàn bộ ES, EF, LS, LF, Float, duration 12 ngày và đường găng.'
  },
  tasks: [
    { id: 'N2_START', code: 'T_START', name: 'Chuẩn bị mặt bằng thi công', duration: 2 },
    { id: 'N2_B1', code: 'T_B1', name: 'Gia công lắp dựng cốt thép dầm sàn', duration: 7 },
    { id: 'N2_B2', code: 'T_B2', name: 'Lắp đặt đường ống ME ngầm', duration: 4 },
    { id: 'N2_END', code: 'T_END', name: 'Nghiệm thu đổ bê tông sàn', duration: 3 }
  ],
  dependencies: [
    { predecessorId: 'N2_START', successorId: 'N2_B1', type: 'FS', lag: 0 },
    { predecessorId: 'N2_START', successorId: 'N2_B2', type: 'FS', lag: 0 },
    { predecessorId: 'N2_B1', successorId: 'N2_END', type: 'FS', lag: 0 },
    { predecessorId: 'N2_B2', successorId: 'N2_END', type: 'FS', lag: 0 }
  ],
  expected: {
    projectDuration: 12,
    tasks: [
      {
        taskId: 'N2_START',
        earlyStart: 0,
        earlyFinish: 2,
        lateStart: 0,
        lateFinish: 2,
        totalFloat: 0,
        isCritical: true
      },
      {
        taskId: 'N2_B1',
        earlyStart: 2,
        earlyFinish: 9,
        lateStart: 2,
        lateFinish: 9,
        totalFloat: 0,
        isCritical: true
      },
      {
        taskId: 'N2_B2',
        earlyStart: 2,
        earlyFinish: 6,
        lateStart: 5,
        lateFinish: 9,
        totalFloat: 3,
        isCritical: false
      },
      {
        taskId: 'N2_END',
        earlyStart: 9,
        earlyFinish: 12,
        lateStart: 9,
        lateFinish: 12,
        totalFloat: 0,
        isCritical: true
      }
    ]
  }
});

module.exports = {
  K01_NETWORK,
  NETWORK_1_ALL_RELATIONS_NEGATIVE_LAG,
  NETWORK_2_PARALLEL_BRANCHES_OFFSET_3_DAYS
};
