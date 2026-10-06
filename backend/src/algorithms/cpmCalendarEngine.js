/**
 * CPM Calendar Engine (S-17 / SCRUM-105 / T-40)
 * 
 * Tích hợp lịch làm việc công trường và ngày nghỉ lễ vào thuật toán CPM:
 * - Sử dụng Kahn topological sort (T-16) để xác định thứ tự tính toán và phát hiện chu trình.
 * - Duyệt xuôi (Forward Pass) tính các mốc sớm theo ngày làm việc thực tế (trừ CN/Lễ).
 * - Duyệt ngược (Backward Pass) tính các mốc muộn, totalFloat và Critical Path.
 * - Tự động tính lại khi thay đổi lịch (5 ngày/6 ngày) hoặc thêm/xóa ngày lễ (AC 2, AC 3).
 */

const { topologicalSort } = require('./topologicalSort');
const {
  formatDate,
  parseDate,
  getNextWorkingDay,
  calculateFinishDate,
  calculateStartDate,
  countWorkingDays,
  addWorkingDaysLag,
  getSuccessorStartFromFS
} = require('../services/workingCalendarService');

/**
 * Tính toán toàn bộ mạng công việc theo CPM kết hợp Lịch làm việc thực tế.
 * 
 * @param {Array} tasks Danh sách tasks: [{ id, name, duration, predecessors: [{ id, type, lag }] }]
 * @param {object} options Cấu hình: { projectStartDate, calendarConfig: { work_days_per_week: 6|5 }, holidays: [...] }
 * @returns {object} { projectStartDate, projectEndDate, tasks: [...], criticalPath: [...] }
 */
function calculateCPMWithCalendar(tasks = [], options = {}) {
  if (!tasks || tasks.length === 0) {
    return {
      projectStartDate: options.projectStartDate || formatDate(new Date()),
      projectEndDate: options.projectStartDate || formatDate(new Date()),
      tasks: [],
      criticalPath: []
    };
  }

  const calendarConfig = options.calendarConfig || { work_days_per_week: 6 };
  const holidays = options.holidays || [];
  const rawProjectStart = options.projectStartDate || formatDate(new Date());

  // Ngày bắt đầu dự án phải là một ngày làm việc hợp lệ
  const projectStartDate = formatDate(getNextWorkingDay(rawProjectStart, calendarConfig, holidays));

  // 1. Tô-pô sắp xếp & phát hiện chu trình (Kahn)
  // Chuẩn hóa predecessors thành mảng ID chuỗi để tương thích với topologicalSort T-16
  const tasksForTopo = tasks.map(t => ({
    id: t.id,
    predecessors: (t.predecessors || []).map(p => typeof p === 'string' ? p : p.id)
  }));
  const topologicalOrder = topologicalSort(tasksForTopo);

  // 2. Chuẩn bị Map lưu thông tin task
  const taskMap = new Map();
  for (const t of tasks) {
    taskMap.set(t.id, {
      id: t.id,
      name: t.name || `Task ${t.id}`,
      duration: Math.max(1, parseInt(t.duration, 10) || 1), // Tối thiểu 1 ngày làm việc
      predecessors: t.predecessors || [],
      earlyStartDate: null,
      earlyFinishDate: null,
      lateStartDate: null,
      lateFinishDate: null,
      totalFloat: 0,
      isCritical: false
    });
  }

  // Map lưu danh sách successors cho backward pass
  const successorsMap = new Map();
  for (const taskId of topologicalOrder) {
    successorsMap.set(taskId, []);
  }

  for (const t of tasks) {
    const preds = t.predecessors || [];
    for (const dep of preds) {
      if (successorsMap.has(dep.id)) {
        successorsMap.get(dep.id).push({
          successorId: t.id,
          type: dep.type || 'FS',
          lag: parseInt(dep.lag, 10) || 0
        });
      }
    }
  }

  // 3. DUYỆT XUÔI (FORWARD PASS) THEO LỊCH LÀM VIỆC
  for (const taskId of topologicalOrder) {
    const task = taskMap.get(taskId);
    const preds = task.predecessors || [];

    if (preds.length === 0) {
      // Task không có việc trước: Bắt đầu từ ngày khởi công dự án
      task.earlyStartDate = projectStartDate;
      task.earlyFinishDate = calculateFinishDate(task.earlyStartDate, task.duration, calendarConfig, holidays);
    } else {
      let latestEarlyStart = projectStartDate;

      for (const dep of preds) {
        const pred = taskMap.get(dep.id);
        if (!pred) {
          throw new Error(`Predecessor "${dep.id}" không tồn tại trong danh sách công việc`);
        }

        const lag = parseInt(dep.lag, 10) || 0;
        let constraintStartDate = projectStartDate;

        switch (dep.type) {
          case 'FS':
            // Finish-to-Start: Bắt đầu sau khi pred hoàn thành + lag (AC 5)
            constraintStartDate = getSuccessorStartFromFS(pred.earlyFinishDate, lag, calendarConfig, holidays);
            break;

          case 'SS':
            // Start-to-Start: Bắt đầu sau khi pred bắt đầu + lag
            if (lag === 0) {
              constraintStartDate = pred.earlyStartDate;
            } else {
              constraintStartDate = addWorkingDaysLag(pred.earlyStartDate, lag, calendarConfig, holidays);
            }
            break;

          case 'FF':
            // Finish-to-Finish: Hoàn thành sau khi pred hoàn thành + lag
            {
              const targetFinish = addWorkingDaysLag(pred.earlyFinishDate, lag, calendarConfig, holidays);
              constraintStartDate = calculateStartDate(targetFinish, task.duration, calendarConfig, holidays);
            }
            break;

          case 'SF':
            // Start-to-Finish: Hoàn thành sau khi pred bắt đầu + lag
            {
              const targetFinish = addWorkingDaysLag(pred.earlyStartDate, lag, calendarConfig, holidays);
              constraintStartDate = calculateStartDate(targetFinish, task.duration, calendarConfig, holidays);
            }
            break;

          default:
            throw new Error(`Loại quan hệ "${dep.type}" không hợp lệ`);
        }

        // Lấy mốc bắt đầu trễ nhất do các ràng buộc đòi hỏi
        if (constraintStartDate > latestEarlyStart) {
          latestEarlyStart = constraintStartDate;
        }
      }

      task.earlyStartDate = latestEarlyStart;
      task.earlyFinishDate = calculateFinishDate(task.earlyStartDate, task.duration, calendarConfig, holidays);
    }
  }

  // 4. MỐC HOÀN THÀNH TOÀN BỘ DỰ ÁN
  let projectEndDate = projectStartDate;
  for (const t of taskMap.values()) {
    if (t.earlyFinishDate > projectEndDate) {
      projectEndDate = t.earlyFinishDate;
    }
  }

  // 5. DUYỆT NGƯỢC (BACKWARD PASS) THEO LỊCH LÀM VIỆC
  const reverseOrder = [...topologicalOrder].reverse();

  for (const taskId of reverseOrder) {
    const task = taskMap.get(taskId);
    const succs = successorsMap.get(taskId) || [];

    if (succs.length === 0) {
      // Task cuối cùng trong nhánh: Late Finish là mốc kết thúc dự án
      task.lateFinishDate = projectEndDate;
      task.lateStartDate = calculateStartDate(task.lateFinishDate, task.duration, calendarConfig, holidays);
    } else {
      let earliestLateFinish = projectEndDate;

      for (const dep of succs) {
        const succ = taskMap.get(dep.successorId);
        if (!succ) {
          throw new Error(`Successor "${dep.successorId}" không tồn tại`);
        }

        const lag = parseInt(dep.lag, 10) || 0;
        let constraintFinishDate = projectEndDate;

        switch (dep.type) {
          case 'FS':
            // LF(u) phải trước LS(v) trừ đi lag
            {
              // Nếu succ bắt đầu vào succ.lateStartDate, mốc kết thúc muộn nhất của pred là ngày làm việc ngay trước đó trừ lag
              const lagBack = (lag >= 0) ? -lag : Math.abs(lag);
              const dayBeforeSucc = calculateStartDate(succ.lateStartDate, 2, calendarConfig, holidays);
              constraintFinishDate = addWorkingDaysLag(dayBeforeSucc, lagBack, calendarConfig, holidays);
            }
            break;

          case 'SS':
            // LS(u) <= LS(v) - lag => tính LF(u) từ LS(u)
            {
              const lagBack = (lag >= 0) ? -lag : Math.abs(lag);
              const maxLateStart = addWorkingDaysLag(succ.lateStartDate, lagBack, calendarConfig, holidays);
              constraintFinishDate = calculateFinishDate(maxLateStart, task.duration, calendarConfig, holidays);
            }
            break;

          case 'FF':
            // LF(u) <= LF(v) - lag
            {
              const lagBack = (lag >= 0) ? -lag : Math.abs(lag);
              constraintFinishDate = addWorkingDaysLag(succ.lateFinishDate, lagBack, calendarConfig, holidays);
            }
            break;

          case 'SF':
            // LS(u) <= LF(v) - lag
            {
              const lagBack = (lag >= 0) ? -lag : Math.abs(lag);
              const maxLateStart = addWorkingDaysLag(succ.lateFinishDate, lagBack, calendarConfig, holidays);
              constraintFinishDate = calculateFinishDate(maxLateStart, task.duration, calendarConfig, holidays);
            }
            break;

          default:
            throw new Error(`Loại quan hệ "${dep.type}" không hợp lệ`);
        }

        if (constraintFinishDate < earliestLateFinish) {
          earliestLateFinish = constraintFinishDate;
        }
      }

      task.lateFinishDate = earliestLateFinish;
      task.lateStartDate = calculateStartDate(task.lateFinishDate, task.duration, calendarConfig, holidays);
    }

    // 6. TÍNH TOTAL FLOAT VÀ ĐƯỜNG GĂNG (CRITICAL PATH)
    // Total float là số ngày làm việc chênh lệch giữa Late Start và Early Start
    if (task.lateStartDate >= task.earlyStartDate) {
      task.totalFloat = Math.max(0, countWorkingDays(task.earlyStartDate, task.lateStartDate, calendarConfig, holidays) - 1);
    } else {
      task.totalFloat = 0;
    }

    task.isCritical = (task.totalFloat === 0);
  }

  const resultTasks = topologicalOrder.map(id => taskMap.get(id));
  const criticalPath = resultTasks.filter(t => t.isCritical).map(t => t.id);

  return {
    projectStartDate,
    projectEndDate,
    calendarConfig,
    holidaysCount: holidays.length,
    tasks: resultTasks,
    criticalPath
  };
}

module.exports = {
  calculateCPMWithCalendar
};
