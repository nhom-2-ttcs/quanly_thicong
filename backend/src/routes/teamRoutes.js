const express = require('express');
const TeamService = require('../services/teamService');
const { checkViewerForbidden, checkProjectReadAccess } = require('../utils/rbac');

module.exports = (db) => {
  const router = express.Router();
  const teamService = new TeamService(db);
  const pool = db?.pool || db;

  // 1. Lấy danh sách đội thi công thuộc dự án
  router.get('/projects/:projectId/teams', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const teams = await teamService.getProjectTeams(projectId);
      res.json({ success: true, data: teams });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 2. Tạo đội thi công mới (Chỉ huy trưởng / Admin)
  router.post('/projects/:projectId/teams', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    try {
      const created = await teamService.createTeam(projectId, req.body);
      res.status(201).json({ success: true, message: 'Đã tạo đội thi công thành công.', data: created });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 3. Lấy chi tiết một đội thi công
  router.get('/projects/:projectId/teams/:teamId', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const teamId = Number(req.params.teamId);
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const team = await teamService.getTeamById(projectId, teamId);
      if (!team) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy đội thi công.' });
      }
      res.json({ success: true, data: team });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 4. Cập nhật thông tin đội thi công
  router.put('/projects/:projectId/teams/:teamId', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const teamId = Number(req.params.teamId);
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    try {
      const updated = await teamService.updateTeam(projectId, teamId, req.body);
      res.json({ success: true, message: 'Đã cập nhật đội thi công thành công.', data: updated });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 5. Xóa đội thi công
  router.delete('/projects/:projectId/teams/:teamId', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const teamId = Number(req.params.teamId);
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    try {
      const result = await teamService.deleteTeam(projectId, teamId);
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 6. S-25 / SCRUM-125 / T-50: Chỉ huy trưởng giao công việc cho đội thi công (Kèm tính toán cảnh báo quá tải)
  router.post('/projects/:projectId/tasks/:taskId/assign', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const taskId = Number(req.params.taskId);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(taskId) || taskId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc taskId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    const { team_id, teamId, note } = req.body;
    const targetTeamId = team_id || teamId;
    if (!targetTeamId) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn đội thi công (team_id).' });
    }

    const assignedBy = req.user?.id || 2; // mặc định Chỉ huy trưởng nếu không xác thực

    try {
      const result = await teamService.assignTaskToTeam({
        projectId,
        taskId,
        teamId: targetTeamId,
        assignedBy,
        note
      });

      res.json({
        success: true,
        message: result.is_overloaded 
          ? 'Đã giao việc cho đội thi công (Lưu ý: Đội đang trong tình trạng quá tải).'
          : 'Đã giao việc cho đội thi công thành công.',
        ...result
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 7. Hủy giao việc (Gỡ đội thi công khỏi công việc)
  router.post('/projects/:projectId/tasks/:taskId/unassign', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const taskId = Number(req.params.taskId);
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    const assignedBy = req.user?.id || 2;

    try {
      const result = await teamService.unassignTask({
        projectId,
        taskId,
        assignedBy
      });
      res.json({ success: true, message: 'Đã hủy phân công đội thi công.', data: result.task });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 8. T-51: Báo cáo phân bổ tải trọng và cảnh báo quá tải toàn dự án
  router.get('/projects/:projectId/team-workload', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const workload = await teamService.getTeamWorkloadSummary(projectId);
      res.json(workload);
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 9. Lấy danh sách toàn bộ các task kèm thông tin đội thi công được gán
  router.get('/projects/:projectId/assigned-tasks', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      if (!teamService.isConnected) {
        const store = require('../models/store');
        const tasks = store.getTasks(projectId);
        const teams = store.getTeams(projectId);

        const mapped = tasks.map(t => {
          const team = teams.find(tm => tm.id === t.team_id);
          return {
            ...t,
            team_name: team ? team.name : null,
            team_code: team ? team.code : null,
            team_leader: team ? team.leader_name : null,
            team_is_overloaded: team ? team.is_overloaded : false,
            team_workload_status: team ? team.workload_status : null
          };
        });
        return res.json({ success: true, data: mapped });
      }

      const query = `
        SELECT 
          t.*, 
          w.name AS work_item_name, 
          w.code AS work_item_code,
          pt.name AS team_name,
          pt.code AS team_code,
          pt.leader_name AS team_leader,
          pt.max_parallel_tasks AS team_max_parallel_tasks
        FROM tasks t
        LEFT JOIN work_items w ON t.work_item_id = w.id
        LEFT JOIN project_teams pt ON t.team_id = pt.id
        WHERE t.project_id = ?
        ORDER BY t.id ASC
      `;
      const [rows] = await pool.query(query, [projectId]);
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 10. S-26 / SCRUM-118: Đội trưởng xem công việc của đội mình (sắp xếp start_date ASC, găng, luỹ kế)
  router.get('/projects/:projectId/contractor/tasks', async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const user = req.user || { id: Number(req.query.user_id) || 4, role_name: req.query.role || 'contractor' };
      const teamId = req.query.team_id || req.query.teamId;
      const tasks = await teamService.getContractorTasks(projectId, user, teamId);
      res.json({ success: true, data: tasks });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 11. S-26 / SCRUM-118: Báo cáo khối lượng hoàn thành theo ngày (lưu thời điểm, tính luỹ kế, cảnh báo vượt)
  router.post('/projects/:projectId/contractor/tasks/:taskId/daily-progress', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const taskId = Number(req.params.taskId);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(taskId) || taskId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc taskId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;
    if (checkViewerForbidden(req, res)) return;

    try {
      const user = req.user || { id: Number(req.body.user_id || req.query.user_id) || 4, role_name: req.body.role || req.query.role || 'contractor' };
      const result = await teamService.reportDailyProgress(projectId, taskId, req.body, user);
      res.status(201).json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  // 12. S-26: Lấy lịch sử báo cáo khối lượng hàng ngày của một công việc
  router.get('/projects/:projectId/contractor/tasks/:taskId/daily-progress', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const taskId = Number(req.params.taskId);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(taskId) || taskId <= 0) {
      return res.status(400).json({ success: false, message: 'projectId hoặc taskId không hợp lệ.' });
    }
    if (checkProjectReadAccess(req, res, projectId)) return;

    try {
      const user = req.user;
      const result = await teamService.getTaskDailyProgress(projectId, taskId, user);
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  });

  return router;
};
