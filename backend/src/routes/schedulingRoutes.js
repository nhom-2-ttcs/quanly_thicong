const express = require('express');
const { SchedulerService } = require('../domain/scheduling/schedulerService');
const { checkProjectReadAccess, checkViewerForbidden } = require('../utils/rbac');

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

  // S-18 / SCRUM-91: Chốt kế hoạch gốc (AC 1 & AC 3)
  async function lockBaseline(req, res) {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    try {
      const userId = req.user?.id || null;
      const userName = req.user?.full_name || req.user?.name || req.body?.authorName || 'Ban Quản Lý Dự Án';
      const reason = req.body?.reason || null;

      const result = await schedulerService.lockProjectBaseline(projectId, {
        userId,
        userName,
        reason
      });
      return res.status(200).json(result);
    } catch (error) {
      const validation = /không hợp lệ|không tồn tại|thiếu|trùng|phải là|chu trình|vòng lặp/.test(error.message);
      return res.status(validation ? 400 : 500).json({
        success: false,
        message: error.message || 'Không thể chốt kế hoạch gốc từ dữ liệu hiện tại'
      });
    }
  }

  // S-18 / SCRUM-91: Lấy kế hoạch gốc hiện hành (AC 2 & AC 4)
  async function getBaseline(req, res) {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const result = await schedulerService.getProjectBaseline(projectId);
      return res.status(200).json({
        success: true,
        projectId,
        ...result
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || 'Không thể tải kế hoạch gốc của dự án'
      });
    }
  }

  // S-18 / SCRUM-91: Lấy lịch sử các lần chốt kế hoạch gốc (AC 3)
  async function getBaselineHistory(req, res) {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const history = await schedulerService.getProjectBaselineHistory(projectId);
      return res.status(200).json({
        success: true,
        projectId,
        history
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || 'Không thể tải lịch sử chốt kế hoạch gốc'
      });
    }
  }

  router.get('/projects/:projectId/scheduling/results', getScheduleResults);
  router.get('/projects/:projectId/scheduling/schedule', getSchedule);
  router.get('/projects/:projectId/scheduling/order', getSchedule);

  // Endpoints chốt và xem kế hoạch gốc (S-18)
  router.post('/projects/:projectId/scheduling/baseline', lockBaseline);
  router.post('/projects/:projectId/baseline', lockBaseline);
  router.get('/projects/:projectId/scheduling/baseline', getBaseline);
  router.get('/projects/:projectId/baseline', getBaseline);
  router.get('/projects/:projectId/scheduling/baseline/history', getBaselineHistory);
  router.get('/projects/:projectId/baseline/history', getBaselineHistory);

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
