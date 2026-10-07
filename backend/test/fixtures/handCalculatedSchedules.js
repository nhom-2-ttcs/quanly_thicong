/**
 * Fixture kết quả tính tay tĩnh cho Sprint 2 (S-10 / SCRUM-65)
 * Subtasks:
 * - SCRUM-79 [T-22] Chuyển bảng đáp án K-01 thành test
 * - SCRUM-80 [T-23] Thêm mạng đủ bốn loại quan hệ (6–8 việc)
 *
 * QUY TẮC BẮT BUỘC:
 * 1. Toàn bộ expected result trong file này được tính toán thủ công bằng tay (hand-calculated),
 *    TUYỆT ĐỐI KHÔNG sinh tự động bằng mã SchedulerService hay bất kỳ hàm giải thuật nào.
 * 2. Ghi rõ metadata người tính toán và người kiểm tra độc lập.
 * 3. Tuân thủ nguyên tắc không tự ghi VERIFIED, tên người kiểm chéo hoặc ngày xác nhận
 *    khi chưa có chữ ký thực tế ngoài đời thực -> Đánh dấu rõ ràng "PENDING_INDEPENDENT_REVIEW".
 * 4. T-23 yêu cầu hai mạng, mỗi mạng từ 6–8 công việc.
 */

const K01_NETWORK = Object.freeze({
  metadata: {
    id: 'K-01',
    name: 'Bảng đáp án tính tay K-01 (Mạng tuyến tính cơ sở)',
    calculator: 'Kỹ sư lập lịch dự án - Nhóm 2 TTCS',
    calculationDate: '2026-10-05',
    reviewer: null,
    reviewDate: null,
    reviewStatus: 'PENDING_INDEPENDENT_REVIEW',
    method: 'Manual Critical Path Method (CPM)',
    notes: 'Chuỗi 3 công việc nối tiếp FS lag 0. Cần người thứ hai đối chiếu độc lập ngoài đời thực.'
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
    name: 'Mạng kiểm thử độc lập 1: Đủ 4 loại quan hệ FS, SS, FF, SF và lag âm (7 công việc)',
    calculator: 'Kỹ sư lập lịch dự án - Nhóm 2 TTCS',
    calculationDate: '2026-10-05',
    reviewer: null,
    reviewDate: null,
    reviewStatus: 'PENDING_INDEPENDENT_REVIEW',
    method: 'Manual CPM với 4 loại liên kết tiền định và lead time',
    notes: 'Mạng 7 công việc bao phủ đủ 4 loại quan hệ FS, SS, FF, SF và lag âm (-1 ngày lead time). Từng quan hệ đều có tính chất ràng buộc tích cực (binding). Cần người thứ hai đối chiếu độc lập ngoài đời thực.'
  },
  tasks: [
    { id: 'N1_1', code: 'T1', name: 'Khởi công - Đào móng', duration: 4 },
    { id: 'N1_2', code: 'T2', name: 'Gia công cốt thép', duration: 5 },
    { id: 'N1_3', code: 'T3', name: 'Đổ bê tông lót', duration: 3 },
    { id: 'N1_4', code: 'T4', name: 'Lắp dựng ván khuôn', duration: 4 },
    { id: 'N1_5', code: 'T5', name: 'Lắp đặt cốt thép móng', duration: 6 },
    { id: 'N1_6', code: 'T6', name: 'Đổ bê tông móng', duration: 5 },
    { id: 'N1_7', code: 'T7', name: 'Bảo dưỡng và nghiệm thu', duration: 2 }
  ],
  dependencies: [
    { predecessorId: 'N1_1', successorId: 'N1_2', type: 'SS', lag: 2 },
    { predecessorId: 'N1_1', successorId: 'N1_3', type: 'FS', lag: -1 },
    { predecessorId: 'N1_1', successorId: 'N1_4', type: 'FS', lag: 0 },
    { predecessorId: 'N1_2', successorId: 'N1_4', type: 'FF', lag: 2 },
    { predecessorId: 'N1_3', successorId: 'N1_5', type: 'SF', lag: 12 },
    { predecessorId: 'N1_4', successorId: 'N1_6', type: 'FS', lag: 1 },
    { predecessorId: 'N1_5', successorId: 'N1_6', type: 'FS', lag: 0 },
    { predecessorId: 'N1_6', successorId: 'N1_7', type: 'FS', lag: 0 }
  ],
  expected: {
    projectDuration: 22,
    tasks: [
      {
        taskId: 'N1_1',
        earlyStart: 0,
        earlyFinish: 4,
        lateStart: 0,
        lateFinish: 4,
        totalFloat: 0,
        isCritical: true
      },
      {
        taskId: 'N1_2',
        earlyStart: 2,
        earlyFinish: 7,
        lateStart: 7,
        lateFinish: 12,
        totalFloat: 5,
        isCritical: false
      },
      {
        taskId: 'N1_3',
        earlyStart: 3,
        earlyFinish: 6,
        lateStart: 3,
        lateFinish: 6,
        totalFloat: 0,
        isCritical: true
      },
      {
        taskId: 'N1_4',
        earlyStart: 5,
        earlyFinish: 9,
        lateStart: 10,
        lateFinish: 14,
        totalFloat: 5,
        isCritical: false
      },
      {
        taskId: 'N1_5',
        earlyStart: 9,
        earlyFinish: 15,
        lateStart: 9,
        lateFinish: 15,
        totalFloat: 0,
        isCritical: true
      },
      {
        taskId: 'N1_6',
        earlyStart: 15,
        earlyFinish: 20,
        lateStart: 15,
        lateFinish: 20,
        totalFloat: 0,
        isCritical: true
      },
      {
        taskId: 'N1_7',
        earlyStart: 20,
        earlyFinish: 22,
        lateStart: 20,
        lateFinish: 22,
        totalFloat: 0,
        isCritical: true
      }
    ]
  }
});

const NETWORK_2_PARALLEL_BRANCHES_OFFSET_3_DAYS = Object.freeze({
  metadata: {
    id: 'T23-NET-02',
    name: 'Mạng kiểm thử độc lập 2: Hai nhánh song song lệch nhau 3 ngày (6 công việc)',
    calculator: 'Kỹ sư lập lịch dự án - Nhóm 2 TTCS',
    calculationDate: '2026-10-05',
    reviewer: null,
    reviewDate: null,
    reviewStatus: 'PENDING_INDEPENDENT_REVIEW',
    method: 'Manual CPM phân tích nhánh song song và độ trễ float',
    notes: 'Mạng 6 công việc gồm 2 nhánh song song: nhánh găng N2_2->N2_3 (float 0) và nhánh N2_4->N2_5 (float 3) chênh lệch đúng 3 ngày float. Cần người thứ hai đối chiếu độc lập ngoài đời thực.'
  },
  tasks: [
    { id: 'N2_1', code: 'T_START', name: 'Chuẩn bị mặt bằng', duration: 3 },
    { id: 'N2_2', code: 'T_B1_1', name: 'Gia công cốt thép dầm sàn', duration: 5 },
    { id: 'N2_3', code: 'T_B1_2', name: 'Lắp dựng ván khuôn dầm sàn', duration: 4 },
    { id: 'N2_4', code: 'T_B2_1', name: 'Lắp đặt ống kỹ thuật ngầm', duration: 3 },
    { id: 'N2_5', code: 'T_B2_2', name: 'Kéo cáp điện và kiểm thử ống', duration: 3 },
    { id: 'N2_6', code: 'T_END', name: 'Đổ bê tông dầm sàn', duration: 2 }
  ],
  dependencies: [
    { predecessorId: 'N2_1', successorId: 'N2_2', type: 'FS', lag: 0 },
    { predecessorId: 'N2_2', successorId: 'N2_3', type: 'FS', lag: 0 },
    { predecessorId: 'N2_3', successorId: 'N2_6', type: 'FS', lag: 0 },
    { predecessorId: 'N2_1', successorId: 'N2_4', type: 'FS', lag: 0 },
    { predecessorId: 'N2_4', successorId: 'N2_5', type: 'FS', lag: 0 },
    { predecessorId: 'N2_5', successorId: 'N2_6', type: 'FS', lag: 0 }
  ],
  expected: {
    projectDuration: 14,
    tasks: [
      {
        taskId: 'N2_1',
        earlyStart: 0,
        earlyFinish: 3,
        lateStart: 0,
        lateFinish: 3,
        totalFloat: 0,
        isCritical: true
      },
      {
        taskId: 'N2_2',
        earlyStart: 3,
        earlyFinish: 8,
        lateStart: 3,
        lateFinish: 8,
        totalFloat: 0,
        isCritical: true
      },
      {
        taskId: 'N2_3',
        earlyStart: 8,
        earlyFinish: 12,
        lateStart: 8,
        lateFinish: 12,
        totalFloat: 0,
        isCritical: true
      },
      {
        taskId: 'N2_4',
        earlyStart: 3,
        earlyFinish: 6,
        lateStart: 6,
        lateFinish: 9,
        totalFloat: 3,
        isCritical: false
      },
      {
        taskId: 'N2_5',
        earlyStart: 6,
        earlyFinish: 9,
        lateStart: 9,
        lateFinish: 12,
        totalFloat: 3,
        isCritical: false
      },
      {
        taskId: 'N2_6',
        earlyStart: 12,
        earlyFinish: 14,
        lateStart: 12,
        lateFinish: 14,
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
