/**
 * S-49 (SCRUM-225): API Trang tổng hợp tiến trình
 * - T-115: Tổng hợp 4 chỉ số tiến trình
 * - T-116: Phục vụ dữ liệu cho trang hiển thị của Chủ đầu tư
 */

const express = require('express');
const ProgressSummaryService = require('../services/progressSummaryService');
const { checkProjectReadAccess } = require('../utils/rbac');

module.exports = (db) => {
  const router = express.Router();
  const service = new ProgressSummaryService(db);

  // GET /api/projects/:projectId/progress-summary
  // T-115 & T-116: Lấy 4 chỉ số tổng hợp tiến trình
  router.get('/projects/:projectId/progress-summary', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }

    // NFR T-116: Chỉ hiển thị dữ liệu của dự án mà người dùng được phép xem
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const summary = await service.getProjectProgressSummary(projectId);
      return res.status(200).json(summary);
    } catch (err) {
      return res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Không thể tổng hợp tiến trình dự án.'
      });
    }
  });

  return router;
};
