/**
 * Calendar & Holiday API Routes (S-17 / SCRUM-105 / T-40)
 */

const express = require('express');
const router = express.Router();
const calendarStore = require('../models/calendarStore');
const { calculateCPMWithCalendar } = require('../algorithms/cpmCalendarEngine');
const { isWorkingDay, parseDate, formatDate } = require('../services/workingCalendarService');

// Dữ liệu mẫu các công việc dự án mẫu để mô phỏng và tính toán CPM
const defaultSampleTasks = [
  { id: 'CV01', name: 'Đào đất hố móng', duration: 4, predecessors: [] },
  { id: 'CV02', name: 'Đổ bê tông lót móng', duration: 3, predecessors: [{ id: 'CV01', type: 'FS', lag: 0 }] },
  { id: 'CV03', name: 'Gia công lắp dựng cốt thép móng', duration: 5, predecessors: [{ id: 'CV02', type: 'FS', lag: 0 }] },
  { id: 'CV04', name: 'Lắp dựng ván khuôn móng', duration: 3, predecessors: [{ id: 'CV02', type: 'FS', lag: 1 }] },
  { id: 'CV05', name: 'Đổ bê tông móng', duration: 2, predecessors: [
    { id: 'CV03', type: 'FS', lag: 0 },
    { id: 'CV04', type: 'FS', lag: 0 }
  ]},
  { id: 'CV06', name: 'Bảo dưỡng và tháo dỡ ván khuôn', duration: 3, predecessors: [{ id: 'CV05', type: 'FS', lag: 2 }] }
];

// 1. Lấy cấu hình lịch của dự án
router.get('/projects/:projectId/calendar', async (req, res) => {
  try {
    const projectId = req.params.projectId || 1;
    const calendar = await calendarStore.getCalendar(projectId);
    const holidays = await calendarStore.getHolidays(projectId);
    res.json({
      success: true,
      calendar,
      holidays
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. Cập nhật cấu hình lịch dự án (5 ngày hoặc 6 ngày/tuần)
router.put('/projects/:projectId/calendar', async (req, res) => {
  try {
    const projectId = req.params.projectId || 1;
    const { work_days_per_week, working_days_mask, description } = req.body;
    
    const updated = await calendarStore.saveCalendar(projectId, {
      work_days_per_week,
      working_days_mask,
      description
    });

    res.json({
      success: true,
      message: `Đã cập nhật lịch làm việc dự án thành công (${updated.work_days_per_week} ngày/tuần)!`,
      calendar: updated
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 3. Lấy danh sách ngày nghỉ lễ
router.get('/projects/:projectId/holidays', async (req, res) => {
  try {
    const projectId = req.params.projectId || 1;
    const holidays = await calendarStore.getHolidays(projectId);
    res.json({
      success: true,
      holidays
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Thêm ngày nghỉ lễ mới
router.post('/projects/:projectId/holidays', async (req, res) => {
  try {
    const projectId = req.params.projectId || 1;
    const { name, holiday_date } = req.body;

    if (!name || !holiday_date) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp tên ngày lễ và ngày nghỉ (YYYY-MM-DD)' });
    }

    const newHoliday = await calendarStore.addHoliday(projectId, { name, holiday_date });
    const calendar = await calendarStore.getCalendar(projectId);

    // Kiểm tra xem ngày lễ có trùng ngày nghỉ cuối tuần không để gửi phản hồi thông minh (AC 4)
    const isSun = parseDate(holiday_date).getDay() === 0;
    const isSat = parseDate(holiday_date).getDay() === 6;
    let note = '';
    if (isSun) {
      note = ' (Lưu ý: Ngày lễ trùng Chủ Nhật - Hệ thống tự động không trừ 2 lần theo AC 4)';
    } else if (isSat && calendar.work_days_per_week === 5) {
      note = ' (Lưu ý: Ngày lễ trùng Thứ Bảy trong lịch 5 ngày/tuần - Hệ thống tự động không trừ 2 lần theo AC 4)';
    }

    res.json({
      success: true,
      message: `Thêm ngày nghỉ lễ "${newHoliday.name}" thành công!${note}`,
      holiday: newHoliday
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 5. Xóa ngày nghỉ lễ
router.delete('/projects/:projectId/holidays/:id', async (req, res) => {
  try {
    const projectId = req.params.projectId || 1;
    const holidayId = req.params.id;
    const success = await calendarStore.deleteHoliday(holidayId, projectId);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy ngày lễ cần xóa' });
    }
    res.json({
      success: true,
      message: 'Đã xóa ngày nghỉ lễ thành công!'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. Tính toán tiến độ CPM áp dụng Lịch làm việc và Ngày nghỉ lễ (AC 1, AC 2, AC 3, AC 4, AC 5)
router.post('/projects/:projectId/schedule/calculate', async (req, res) => {
  try {
    const projectId = req.params.projectId || 1;
    const calendar = await calendarStore.getCalendar(projectId);
    const holidays = await calendarStore.getHolidays(projectId);

    const tasks = req.body.tasks && Array.isArray(req.body.tasks) && req.body.tasks.length > 0
      ? req.body.tasks
      : defaultSampleTasks;

    const projectStartDate = req.body.projectStartDate || '2026-10-08';

    const schedule = calculateCPMWithCalendar(tasks, {
      projectStartDate,
      calendarConfig: calendar,
      holidays
    });

    res.json({
      success: true,
      message: 'Tính toán tiến độ CPM theo lịch làm việc thành công!',
      schedule
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 7. Lấy tiến độ mặc định
router.get('/projects/:projectId/schedule', async (req, res) => {
  try {
    const projectId = req.params.projectId || 1;
    const calendar = await calendarStore.getCalendar(projectId);
    const holidays = await calendarStore.getHolidays(projectId);

    const schedule = calculateCPMWithCalendar(defaultSampleTasks, {
      projectStartDate: '2026-10-08',
      calendarConfig: calendar,
      holidays
    });

    res.json({
      success: true,
      schedule
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
