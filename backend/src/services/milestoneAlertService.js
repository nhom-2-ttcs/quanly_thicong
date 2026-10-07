const { countWorkingDays } = require('../utils/workday');
const {
  inMemoryWorkItems,
  inMemoryMilestones,
  getMilestones,
  getMilestoneAlerts,
  saveMilestoneAlert,
  closeMilestoneAlert
} = require('../models/store');

class MilestoneAlertService {
  constructor(db) {
    this.pool = db?.pool || db;
  }

  /**
   * Recursive helper to gather a work item ID and all its descendant work item IDs.
   */
  getWorkItemSubtreeIds(rootWorkItemId, allWorkItems) {
    const ids = new Set([Number(rootWorkItemId)]);
    let added = true;
    while (added) {
      added = false;
      for (const item of allWorkItems) {
        if (item.parent_id && ids.has(Number(item.parent_id)) && !ids.has(Number(item.id))) {
          ids.add(Number(item.id));
          added = true;
        }
      }
    }
    return ids;
  }

  /**
   * Main T-44 logic: Check Early Finish of tasks against active milestones.
   * Runs in the same execution flow as T-36.
   *
   * @param {number} projectId 
   * @param {Array} scheduledTasks - Array of tasks output by SchedulerService with earlyFinish
   */
  async checkProjectMilestoneAlerts(projectId, scheduledTasks = []) {
    const pId = Number(projectId);
    if (!Number.isInteger(pId) || pId <= 0) return [];

    let milestones = [];
    let workItems = [];

    if (this.pool?.query) {
      try {
        const [mRows] = await this.pool.query(
          `SELECT m.*, w.project_id
           FROM milestones m
           JOIN work_items w ON m.work_item_id = w.id
           WHERE w.project_id = ? AND m.is_active = 1`,
          [pId]
        );
        milestones = mRows || [];

        const [wRows] = await this.pool.query(
          'SELECT id, project_id, parent_id, name, code FROM work_items WHERE project_id = ?',
          [pId]
        );
        workItems = wRows || [];
      } catch (err) {
        // Fallback to store if DB error occurs
        milestones = getMilestones({ is_active: 1 });
        workItems = inMemoryWorkItems.filter(w => w.project_id === pId);
      }
    } else {
      milestones = getMilestones({ is_active: 1 });
      workItems = inMemoryWorkItems.filter(w => w.project_id === pId);
    }

    if (!Array.isArray(milestones) || milestones.length === 0) {
      return [];
    }

    const processedAlerts = [];

    for (const milestone of milestones) {
      const subtreeIds = this.getWorkItemSubtreeIds(milestone.work_item_id, workItems);

      // Filter tasks belonging to the work item or any of its descendant work items
      const targetTasks = scheduledTasks.filter(task => {
        const wId = Number(task.work_item_id ?? task.workItemId);
        return subtreeIds.has(wId);
      });

      if (targetTasks.length === 0) {
        // No tasks under this work item tree, close any existing active alert
        await this.closeAlertForMilestone(pId, milestone.id);
        continue;
      }

      // 3. Find max Early Finish among these tasks (handling both numeric and date string earlyFinish)
      let maxEarlyFinish = null;
      for (const t of targetTasks) {
        const ef = t.earlyFinish ?? t.early_finish ?? t.early_end;
        if (ef === null || ef === undefined) continue;
        if (maxEarlyFinish === null) {
          maxEarlyFinish = ef;
        } else {
          const efVal = typeof ef === 'number' ? ef : (new Date(ef).getTime() || ef);
          const maxVal = typeof maxEarlyFinish === 'number' ? maxEarlyFinish : (new Date(maxEarlyFinish).getTime() || maxEarlyFinish);
          if (efVal > maxVal) {
            maxEarlyFinish = ef;
          }
        }
      }

      if (maxEarlyFinish === null) {
        await this.closeAlertForMilestone(pId, milestone.id);
        continue;
      }

      // 4 & 5. Compare max Early Finish with milestone due_date and calculate working days overrun
      const overdueDays = countWorkingDays(milestone.due_date, maxEarlyFinish);

      if (overdueDays > 0) {
        // 6 & 7. Record/update alert (prevents duplicate active alerts)
        const alertRecord = await this.upsertActiveAlert({
          project_id: pId,
          milestone_id: milestone.id,
          work_item_id: milestone.work_item_id,
          due_date: milestone.due_date,
          max_early_finish: maxEarlyFinish,
          overdue_days: overdueDays
        });
        processedAlerts.push(alertRecord);
      } else {
        // 8. If no longer overrun, close active alert and record closing timestamp
        await this.closeAlertForMilestone(pId, milestone.id);
      }
    }

    return processedAlerts;
  }

  async upsertActiveAlert(data) {
    if (this.pool?.query) {
      try {
        const [existing] = await this.pool.query(
          'SELECT id FROM milestone_alerts WHERE milestone_id = ? AND status = "active" LIMIT 1',
          [data.milestone_id]
        );

        if (existing && existing.length > 0) {
          const alertId = existing[0].id;
          await this.pool.query(
            `UPDATE milestone_alerts 
             SET due_date = ?, max_early_finish = ?, overdue_days = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [data.due_date, data.max_early_finish, data.overdue_days, alertId]
          );
          return { id: alertId, ...data, status: 'active' };
        } else {
          const [res] = await this.pool.query(
            `INSERT INTO milestone_alerts 
             (project_id, milestone_id, work_item_id, due_date, max_early_finish, overdue_days, status, opened_at)
             VALUES (?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)`,
            [data.project_id, data.milestone_id, data.work_item_id, data.due_date, data.max_early_finish, data.overdue_days]
          );
          return { id: res.insertId, ...data, status: 'active' };
        }
      } catch (err) {
        return saveMilestoneAlert(data);
      }
    } else {
      return saveMilestoneAlert(data);
    }
  }

  async closeAlertForMilestone(projectId, milestoneId) {
    if (this.pool?.query) {
      try {
        await this.pool.query(
          `UPDATE milestone_alerts 
           SET status = 'closed', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE milestone_id = ? AND status = 'active'`,
          [milestoneId]
        );
      } catch (err) {
        closeMilestoneAlert(milestoneId);
      }
    } else {
      closeMilestoneAlert(milestoneId);
    }
  }

  async getProjectAlerts(projectId, { status } = {}) {
    const pId = Number(projectId);
    if (this.pool?.query) {
      try {
        let sql = 'SELECT * FROM milestone_alerts WHERE project_id = ?';
        const params = [pId];
        if (status) {
          sql += ' AND status = ?';
          params.push(status);
        }
        sql += ' ORDER BY id DESC';
        const [rows] = await this.pool.query(sql, params);
        return rows || [];
      } catch (err) {
        return getMilestoneAlerts({ project_id: pId, status });
      }
    } else {
      return getMilestoneAlerts({ project_id: pId, status });
    }
  }
}

module.exports = { MilestoneAlertService };
