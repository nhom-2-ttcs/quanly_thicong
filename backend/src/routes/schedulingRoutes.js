const express = require('express');
const { SchedulerService } = require('../domain/scheduling/schedulerService');
const { checkProjectReadAccess } = require('../utils/rbac');

module.exports = (db) => {
  const router = express.Router();
  const schedulerService = new SchedulerService(db);

  async function getSchedule(req, res) {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    try {
      const result = await schedulerService.getProjectSchedule(projectId);
      if (req.query?.critical === 'true' || req.query?.critical === '1') {
        if (Array.isArray(result.tasks)) {
          result.tasks = result.tasks.filter(t => t.isCritical);
        }
      }
      return res.status(result.hasCycle ? 422 : 200).json(result);
    } catch (error) {
      const validation = /không hợp lệ|không tồn tại|thiếu|trùng|phải là/.test(error.message);
      return res.status(validation ? 400 : 500).json({
        success: false,
        message: validation ? error.message : 'Không thể tính lịch thi công từ dữ liệu hiện tại'
      });
    }
  }

  // T-27 (SCRUM-84): API trả về bảng kết quả tiến độ và việc găng
  async function getScheduleResults(req, res) {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    const criticalOnly = req.query?.critical === 'true' || req.query?.critical === '1';
    const forceRecalculate = req.query?.recalculate === 'true' || req.query?.force === 'true';

    try {
      const result = await schedulerService.getProjectScheduleResults(projectId, {
        criticalOnly,
        forceRecalculate
      });
      return res.status(result.hasCycle ? 422 : 200).json(result);
    } catch (error) {
      const validation = /không hợp lệ|không tồn tại|thiếu|trùng|phải là/.test(error.message);
      return res.status(validation ? 400 : 500).json({
        success: false,
        message: validation ? error.message : 'Không thể lấy bảng kết quả tiến độ từ dữ liệu hiện tại'
      });
    }
  }

  router.get('/projects/:projectId/scheduling/results', getScheduleResults);
  router.get('/projects/:projectId/scheduling/schedule', getSchedule);
  router.get('/projects/:projectId/scheduling/order', getSchedule);

  // T-44: API truy vấn danh sách cảnh báo vượt mốc tiến độ
  router.get('/projects/:projectId/milestone-alerts', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const statusFilter = req.query?.status;
      const alerts = await schedulerService.milestoneAlertService.getProjectAlerts(projectId, { status: statusFilter });
      return res.json({ success: true, projectId, data: alerts });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  router.post('/projects/:projectId/scheduling/verify-order', (req, res) => {
    const { tasks, dependencies } = req.body;
    if (!Array.isArray(tasks) || (dependencies !== undefined && !Array.isArray(dependencies))) {
      return res.status(400).json({ success: false, message: 'tasks và dependencies phải là mảng' });
    }
    try {
      const result = schedulerService.computeSchedule(tasks, dependencies || []);
      return res.status(result.hasCycle ? 422 : 200).json(result);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  });

  return router;
};
