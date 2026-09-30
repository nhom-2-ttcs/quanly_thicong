const express = require('express');
const { SchedulerService } = require('../domain/scheduling/schedulerService');

module.exports = (db) => {
  const router = express.Router();
  const schedulerService = new SchedulerService(db);

  // 1. Lấy thứ tự sắp xếp phụ thuộc công việc của dự án (S-07 / SCRUM-62)
  router.get('/projects/:projectId/scheduling/order', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ' });
    }

    try {
      const result = await schedulerService.getProjectSchedule(projectId);

      if (result.hasCycle) {
        // HTTP 422: Unprocessable Entity khi phát hiện chu trình/vòng lặp
        return res.status(422).json(result);
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 2. Xác thực cấu trúc đồ thị và kiểm tra vòng lặp theo tập dữ liệu tùy chỉnh (phục vụ test và mô phỏng)
  router.post('/projects/:projectId/scheduling/verify-order', (req, res) => {
    const { tasks, dependencies } = req.body;

    if (!Array.isArray(tasks)) {
      return res.status(400).json({ success: false, message: 'Danh sách tasks phải là một mảng' });
    }
    if (dependencies !== undefined && !Array.isArray(dependencies)) {
      return res.status(400).json({ success: false, message: 'Danh sách dependencies phải là một mảng' });
    }

    try {
      const result = schedulerService.computeSchedule(tasks, dependencies || []);

      if (result.hasCycle) {
        return res.status(422).json(result);
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};
