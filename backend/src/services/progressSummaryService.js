/**
 * S-49 (SCRUM-225): Trang tổng hợp tiến trình
 * - T-115 (SCRUM-234): Tổng hợp các tiến trình
 * - T-116 (SCRUM-235): Hiển thị tổng hợp trang cho Chủ đầu tư
 * 
 * Phụ thuộc: S-16 (tính lại tiến độ CPM khi trễ hạn), S-19 (mốc tiến độ & cảnh báo vượt mốc)
 * NFR: Không làm thay đổi kết quả tiến trình của nguồn câu chuyện (Read-only aggregation)
 */

const { SchedulerService } = require('../domain/scheduling/schedulerService');
const BudgetVarianceService = require('./budgetVarianceService');
const { getProjectStartDate } = require('../utils/projectStartDate');
const store = require('../models/store');

class ProgressSummaryService {
  constructor(db) {
    this.db = db;
    this.pool = db?.pool || db;
    this.schedulerService = new SchedulerService(db);
    this.budgetVarianceService = new BudgetVarianceService(db);
  }

  get isConnected() {
    return Boolean(this.db && this.db.isConnected !== false && this.pool?.query);
  }

  /**
   * Lấy thông tin cơ bản của dự án
   */
  async getProjectMeta(projectId) {
    const pId = Number(projectId);
    if (this.isConnected) {
      try {
        const [rows] = await this.pool.query(
          'SELECT id, name, code, description, start_date, status, created_at FROM projects WHERE id = ?',
          [pId]
        );
        if (rows && rows.length > 0) {
          return rows[0];
        }
      } catch (err) {
        // Fallback to in-memory store
      }
    }
    const inMem = (store.inMemoryProjects || []).find(p => Number(p.id) === pId);
    return inMem || { id: pId, name: `Dự án #${pId}`, code: `DA-${pId}`, start_date: null, status: 'active' };
  }

  /**
   * Tính ngày cộng thêm số ngày dương lịch (YYYY-MM-DD)
   */
  addDays(dateStr, days) {
    if (!dateStr) return null;
    try {
      const parts = String(dateStr).split('T')[0].split('-');
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      d.setDate(d.getDate() + Number(days));
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch {
      return null;
    }
  }

  /**
   * Tính chênh lệch ngày dương lịch giữa 2 chuỗi YYYY-MM-DD
   */
  diffDays(startStr, endStr) {
    if (!startStr || !endStr) return 0;
    try {
      const p1 = String(startStr).split('T')[0].split('-');
      const p2 = String(endStr).split('T')[0].split('-');
      const d1 = new Date(Number(p1[0]), Number(p1[1]) - 1, Number(p1[2]));
      const d2 = new Date(Number(p2[0]), Number(p2[1]) - 1, Number(p2[2]));
      return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    } catch {
      return 0;
    }
  }

  /**
   * T-115 (SCRUM-234): Tổng hợp 4 chỉ số tiến trình cho dự án
   * 1. Phần trăm hoàn thành theo giá trị hợp đồng / sản lượng và khối lượng/thời lượng
   * 2. Hoàn thành sai lệch theo kế hoạch gốc (Schedule / Baseline variance)
   * 3. Các mốc tiến độ đang bị vượt qua (Milestones breached)
   * 4. Luồng công việc chậm lại (Delayed workflows & tasks)
   */
  async getProjectProgressSummary(projectId) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) {
      const err = new Error('projectId không hợp lệ');
      err.status = 400;
      throw err;
    }

    // 1. Lấy metadata dự án & ngày khởi công
    const project = await this.getProjectMeta(pId);
    const projectStartDate = await getProjectStartDate(this.db, pId) || project.start_date || '2026-10-01';

    // 2. Lấy Kế hoạch gốc (Baseline Schedule) - S-18
    let baselineData = null;
    try {
      baselineData = await this.schedulerService.getProjectBaseline(pId);
    } catch (bErr) {
      baselineData = { hasBaseline: false, baseline: null, tasks: [] };
    }

    const hasBaseline = Boolean(baselineData && baselineData.hasBaseline && baselineData.baseline);
    const baseline = hasBaseline ? baselineData.baseline : null;
    const baselineTasks = hasBaseline ? (baselineData.tasks || []) : [];
    const baselineDuration = hasBaseline ? Number(baseline.projectDuration || 0) : null;
    const baselineEndDate = (hasBaseline && projectStartDate && baselineDuration !== null)
      ? this.addDays(projectStartDate, baselineDuration)
      : null;

    // 3. Lấy Tiến độ hiện hành từ CPM & SchedulerService (Read-Only)
    let scheduleResults = null;
    try {
      scheduleResults = await this.schedulerService.getProjectScheduleResults(pId, { forceRecalculate: false });
    } catch (sErr) {
      scheduleResults = {
        success: false,
        tasks: [],
        projectDuration: 0,
        totalTasks: 0,
        criticalTasksCount: 0
      };
    }

    const currentTasks = scheduleResults.tasks || [];
    const currentDuration = Number(scheduleResults.projectDuration || 0);
    const forecastEndDate = projectStartDate ? this.addDays(projectStartDate, currentDuration) : null;

    // 4. CHỈ SỐ 2: Hoàn thành sai lệch theo kế hoạch gốc (Schedule / Baseline Variance)
    let scheduleVariance = {
      hasBaseline,
      baselineVersion: hasBaseline ? (baseline.version || 'v1.0') : null,
      baselineLockedAt: hasBaseline ? baseline.createdAt : null,
      baselineLockedByName: hasBaseline ? (baseline.createdByName || 'Ban Quản Lý') : null,
      baselineDuration,
      baselineEndDate,
      currentDuration,
      forecastEndDate,
      varianceDays: 0,
      status: 'no_baseline', // 'ahead' | 'ontime' | 'delayed' | 'no_baseline'
      statusText: 'Chưa chốt kế hoạch gốc (Baseline)'
    };

    if (hasBaseline) {
      const diff = currentDuration - baselineDuration;
      scheduleVariance.varianceDays = diff;
      if (diff > 0) {
        scheduleVariance.status = 'delayed';
        scheduleVariance.statusText = `Chậm ${diff} ngày so với kế hoạch gốc`;
      } else if (diff < 0) {
        scheduleVariance.status = 'ahead';
        scheduleVariance.statusText = `Vượt tiến độ ${Math.abs(diff)} ngày so với kế hoạch gốc`;
      } else {
        scheduleVariance.status = 'ontime';
        scheduleVariance.statusText = 'Đúng tiến độ theo kế hoạch gốc';
      }
    }

    // 5. CHỈ SỐ 1: Phần trăm hoàn thành theo Giá trị hợp đồng / Dự toán (EVM) và Khối lượng / Công việc
    // Lấy báo cáo chi phí & dự toán từ S-48
    let budgetReport = null;
    try {
      budgetReport = await this.budgetVarianceService.getProjectBudgetVarianceReport(pId);
    } catch (_) {
      budgetReport = { summary: null, flatList: [] };
    }

    const totalBudget = Number(budgetReport.summary?.total_budget || 0);
    const totalEarnedValue = Number(budgetReport.summary?.total_earned_value || 0);
    const totalActualCost = Number(budgetReport.summary?.total_actual_cost || 0);
    const valueCompletionPercentage = budgetReport.summary?.overall_quantity_percentage !== undefined
      ? Number(budgetReport.summary.overall_quantity_percentage)
      : (totalBudget > 0 ? Number(((totalEarnedValue / totalBudget) * 100).toFixed(2)) : 0);
    const costPercentage = budgetReport.summary?.overall_cost_percentage !== undefined
      ? Number(budgetReport.summary.overall_cost_percentage)
      : (totalBudget > 0 ? Number(((totalActualCost / totalBudget) * 100).toFixed(2)) : 0);

    // Tính phần trăm hoàn thành theo Khối lượng / Thời lượng (Volume / Duration Weighted)
    let totalDurationWeight = 0;
    let completedDurationWeight = 0;
    let completedTasksCount = 0;
    let inProgressTasksCount = 0;
    let pendingTasksCount = 0;
    let criticalTasksCount = 0;

    for (const t of currentTasks) {
      const dur = Number(t.duration || 1);
      const pct = Number(t.percentComplete ?? t.percent_complete ?? 0);
      totalDurationWeight += dur;
      completedDurationWeight += dur * (Math.min(100, Math.max(0, pct)) / 100);

      if (pct >= 100) {
        completedTasksCount++;
      } else if (pct > 0) {
        inProgressTasksCount++;
      } else {
        pendingTasksCount++;
      }

      if (t.isCritical) {
        criticalTasksCount++;
      }
    }

    const volumeCompletionPercentage = totalDurationWeight > 0
      ? Number(((completedDurationWeight / totalDurationWeight) * 100).toFixed(2))
      : 0;

    // Tỷ lệ hoàn thành chủ đạo (Primary completion rate):
    // Ưu tiên theo giá trị hợp đồng/dự toán nếu có dự toán; nếu không có dự toán (0 đồng) -> dùng khối lượng công việc
    const primaryPercentage = totalBudget > 0 ? valueCompletionPercentage : volumeCompletionPercentage;

    const completion = {
      primaryPercentage,
      valuePercentage: valueCompletionPercentage,
      volumePercentage: volumeCompletionPercentage,
      totalBudget,
      totalEarnedValue,
      totalActualCost,
      costPercentage,
      taskStats: {
        total: currentTasks.length,
        completed: completedTasksCount,
        inProgress: inProgressTasksCount,
        pending: pendingTasksCount,
        critical: criticalTasksCount
      },
      formulas: {
        value: 'Tỷ lệ hoàn thành theo Giá trị = (Tổng giá trị sản lượng hoàn thành / Tổng giá trị hợp đồng & dự toán) × 100%',
        volume: 'Tỷ lệ hoàn thành theo Khối lượng = (Tổng thời lượng hoàn thành theo trọng số / Tổng thời lượng toàn bộ công việc) × 100%',
        description: 'Chủ đầu tư có thể theo dõi song song cả tiến độ giải ngân / sản lượng (Giá trị) và tiến độ thi công thực tế tại công trường (Khối lượng).'
      }
    };

    // 6. CHỈ SỐ 3: Các bảng / mốc tiến độ đang bị vượt qua (Milestones Breached - S-19 / T-44 & T-45)
    let milestoneAlerts = [];
    try {
      milestoneAlerts = await this.schedulerService.milestoneAlertService.getProjectAlertsWithChain(pId, {
        status: 'all',
        scheduledTasks: currentTasks
      });
    } catch (_) {
      milestoneAlerts = [];
    }

    const activeBreachedMilestones = milestoneAlerts.filter(a => a.status === 'active' && Number(a.overdue_days || a.overdueWorkdays || 0) > 0);
    const closedAlerts = milestoneAlerts.filter(a => a.status === 'closed');

    const milestonesBreached = {
      breachedCount: activeBreachedMilestones.length,
      activeAlertsCount: activeBreachedMilestones.length,
      closedAlertsCount: closedAlerts.length,
      totalMilestonesAlerted: milestoneAlerts.length,
      items: activeBreachedMilestones.map(a => ({
        id: a.id,
        milestoneId: a.milestoneId || a.milestone_id,
        milestoneTitle: a.milestoneTitle || a.milestone_title,
        workItemId: a.workItemId || a.work_item_id,
        dueDate: a.dueDate || a.due_date,
        maxEarlyFinish: a.maxEarlyFinish || a.max_early_finish,
        overdueDays: Number(a.overdueDays || a.overdue_days || a.overdueWorkdays || 0),
        status: a.status,
        openedAt: a.openedAt || a.opened_at,
        chain: Array.isArray(a.chain) ? a.chain : []
      })),
      historyItems: closedAlerts.slice(0, 5).map(a => ({
        id: a.id,
        milestoneTitle: a.milestoneTitle || a.milestone_title,
        dueDate: a.dueDate || a.due_date,
        overdueDays: Number(a.overdueDays || a.overdue_days || 0),
        closedAt: a.closedAt || a.closed_at
      }))
    };

    // 7. CHỈ SỐ 4: Luồng công việc chậm lại (Delayed Workflows & Tasks - S-16 & S-19)
    // Map baseline task để so sánh ngày mốc ban đầu của từng task
    const baselineTaskMap = new Map();
    baselineTasks.forEach(bt => {
      baselineTaskMap.set(Number(bt.taskId), bt);
    });

    const delayedTasks = [];
    const bottleneckMap = new Map(); // task id -> lý do và mức độ trễ

    for (const t of currentTasks) {
      const tId = Number(t.id ?? t.taskId);
      const pct = Number(t.percentComplete ?? t.percent_complete ?? 0);
      const bTask = baselineTaskMap.get(tId);

      let isDelayed = false;
      let delayReason = '';
      let taskVarianceDays = 0;

      // So sánh với baseline nếu có
      if (bTask) {
        const earlyFinishCurrent = Number(t.earlyFinish || 0);
        const earlyFinishBaseline = Number(bTask.earlyFinish ?? bTask.early_finish ?? 0);
        taskVarianceDays = earlyFinishCurrent - earlyFinishBaseline;
        if (taskVarianceDays > 0 && pct < 100) {
          isDelayed = true;
          delayReason = `Dự kiến kết thúc chậm hơn kế hoạch gốc ${taskVarianceDays} ngày`;
        }
      }

      // Kiểm tra công việc găng dở dang
      if (t.isCritical && pct < 100 && !isDelayed) {
        if (currentDuration > (baselineDuration || currentDuration)) {
          isDelayed = true;
          delayReason = 'Công việc trên đường găng (Critical Path) chưa hoàn thành và kéo lùi tổng tiến độ';
        }
      }

      // Kiểm tra việc dở dang bị trôi mốc (S-16)
      if (t.isNewCritical || t.isCriticalNow) {
        isDelayed = true;
        delayReason = 'Độ trễ thực tế vượt quá float cho phép, phát sinh thành đường găng mới (S-16)';
      }

      if (isDelayed || taskVarianceDays > 0) {
        delayedTasks.push({
          id: tId,
          code: t.code || `CV-${tId}`,
          name: t.name || `Công việc #${tId}`,
          duration: Number(t.duration || 0),
          percentComplete: pct,
          status: t.status || (pct >= 100 ? 'completed' : pct > 0 ? 'in_progress' : 'pending'),
          earlyStart: Number(t.earlyStart || 0),
          earlyFinish: Number(t.earlyFinish || 0),
          lateFinish: Number(t.lateFinish || 0),
          totalFloat: Number(t.totalFloat || 0),
          isCritical: Boolean(t.isCritical),
          isNewCritical: Boolean(t.isNewCritical),
          delayReason: delayReason || 'Chậm so với mốc tiến độ ban đầu',
          varianceDays: taskVarianceDays
        });
      }
    }

    // Thu thập các chuỗi công việc gây chậm (driving chains) từ các mốc bị vượt
    const uniqueChains = [];
    activeBreachedMilestones.forEach(alert => {
      if (Array.isArray(alert.chain) && alert.chain.length > 0) {
        uniqueChains.push({
          milestoneTitle: alert.milestoneTitle || alert.milestone_title,
          overdueDays: alert.overdueDays || alert.overdue_days,
          tasks: alert.chain
        });
      }
    });

    const delayedWorkflows = {
      delayedTasksCount: delayedTasks.length,
      criticalDelayedCount: delayedTasks.filter(t => t.isCritical).length,
      bottlenecksCount: uniqueChains.length,
      items: delayedTasks.sort((a, b) => b.varianceDays - a.varianceDays),
      drivingChains: uniqueChains
    };

    // 8. Trả về cấu trúc tổng hợp hoàn chỉnh (Read-only)
    return {
      success: true,
      projectId: pId,
      project: {
        id: pId,
        name: project.name || `Dự án #${pId}`,
        code: project.code || `DA-${pId}`,
        startDate: projectStartDate,
        status: project.status || 'active'
      },
      summary: {
        primaryPercentage,
        varianceDays: scheduleVariance.varianceDays,
        varianceStatus: scheduleVariance.status,
        varianceStatusText: scheduleVariance.statusText,
        breachedMilestonesCount: milestonesBreached.breachedCount,
        delayedTasksCount: delayedWorkflows.delayedTasksCount
      },
      // 4 chỉ số cốt lõi theo tiêu chí S-49
      metrics: {
        completion,
        scheduleVariance,
        milestonesBreached,
        delayedWorkflows
      },
      // Đảm bảo không làm thay đổi nguồn dữ liệu
      readOnly: true,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = ProgressSummaryService;
