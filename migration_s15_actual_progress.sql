USE quanly_thicong;

-- ====================================================================
-- MIGRATION UP (S-15 / SCRUM-88 / SCRUM-99 / T-34)
-- Thêm cột actual_start, actual_end, percent_complete vào bảng tasks
-- NFR: Số liệu thực tế lưu tách cột khỏi số liệu kế hoạch, không ghi đè
-- ====================================================================

ALTER TABLE tasks
  ADD COLUMN actual_start DATE NULL AFTER duration,
  ADD COLUMN actual_end DATE NULL AFTER actual_start,
  ADD COLUMN percent_complete DECIMAL(5, 2) NOT NULL DEFAULT 0.00 AFTER actual_end;

-- Ràng buộc kiểm tra phần trăm hoàn thành trong khoảng 0 đến 100% (AC 3)
ALTER TABLE tasks
  ADD CONSTRAINT chk_task_percent_complete CHECK (percent_complete >= 0.00 AND percent_complete <= 100.00);

-- Chỉ mục hỗ trợ truy vấn lọc tiến độ thực tế
ALTER TABLE tasks
  ADD INDEX idx_tasks_actual_dates (actual_start, actual_end),
  ADD INDEX idx_tasks_percent (percent_complete);
