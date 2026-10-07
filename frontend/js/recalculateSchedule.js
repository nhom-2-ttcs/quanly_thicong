/**
 * Thuật toán tính lại tiến độ CPM khi có mốc thực tế (S-16, AC 1, 2, 3, 4)
 */
function parseDateStr(str) {
  const parts = str.split('-');
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function calcDiffDays(startStr, endStr) {
  const d1 = parseDateStr(startStr);
  const d2 = parseDateStr(endStr);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function calcAddDays(dateStr, days) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + days);
  return formatDateStr(d);
}

function recalculateProjectSchedule(projectData, todayStr = "2026-10-25") {
  const tasks = JSON.parse(JSON.stringify(projectData.tasks));
  const initialProjectEnd = projectData.projectEndDate;
  let latestFinish = initialProjectEnd;

  tasks.forEach(task => {
    const totalFloat = Number(task.totalFloat) || 0;
    // 1. Việc có mốc kết thúc thực tế
    if (task.actualFinish) {
      task.currentFinish = task.actualFinish;
      const delayDaysOfTask = calcDiffDays(task.earlyFinish, task.actualFinish);
      const projectDelay = Math.max(0, delayDaysOfTask - (task.isCritical ? 0 : totalFloat));
      task.projectedProjectEnd = calcAddDays(initialProjectEnd, projectDelay);
      // AC 3: Việc không găng ban đầu nhưng trễ > độ trễ cho phép (totalFloat) -> Trở thành găng mới
      if (!task.isCritical && delayDaysOfTask > totalFloat) {
        task.isNewCritical = true;
        task.isCriticalNow = true;
      }
    } 
    // 2. Việc đang dở dang (AC 4)
    else if (task.progress > 0 && task.progress < 100) {
      const remainingRatio = (100 - task.progress) / 100;
      const originalDuration = calcDiffDays(task.earlyStart, task.earlyFinish);
      const remainingDays = Math.ceil(originalDuration * remainingRatio);
      const projectedFinish = calcAddDays(todayStr, remainingDays);
      task.currentFinish = projectedFinish > task.earlyFinish ? projectedFinish : task.earlyFinish;
      const delayDaysOfTask = calcDiffDays(task.earlyFinish, task.currentFinish);
      const projectDelay = Math.max(0, delayDaysOfTask - (task.isCritical ? 0 : totalFloat));
      task.projectedProjectEnd = calcAddDays(initialProjectEnd, projectDelay);
      if (!task.isCritical && task.currentFinish > task.lateFinish) {
        task.isNewCritical = true;
        task.isCriticalNow = true;
      }
    } 
    // 3. Chưa thực hiện
    else {
      task.currentFinish = task.earlyFinish;
      task.projectedProjectEnd = initialProjectEnd;
    }

    if (task.projectedProjectEnd > latestFinish) latestFinish = task.projectedProjectEnd;
  });

  const delayDays = Math.max(0, calcDiffDays(initialProjectEnd, latestFinish));

  tasks.forEach(task => {
    if (task.isCritical) {
      task.isCriticalNow = true;
    }
  });

  return {
    originalEndDate: initialProjectEnd,
    currentEndDate: latestFinish,
    delayDays: delayDays,
    statusText: delayDays > 0 ? `Chậm ${delayDays} ngày` : 'Đúng tiến độ',
    tasks: tasks
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { recalculateProjectSchedule };
}
