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
      return res.status(result.hasCycle ? 422 : 200).json(result);
    } catch (error) {
      const validation = /không hợp lệ|không tồn tại|thiếu|trùng|phải là/.test(error.message);
      return res.status(validation ? 400 : 500).json({
        success: false,
        message: validation ? error.message : 'Không thể tính lịch thi công từ dữ liệu hiện tại'
      });
    }
  }

  router.get('/projects/:projectId/scheduling/schedule', getSchedule);
  router.get('/projects/:projectId/scheduling/order', getSchedule);

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
