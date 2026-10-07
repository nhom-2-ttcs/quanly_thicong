USE quanly_thicong;

-- ====================================================================
-- MIGRATION DOWN (S-15 / SCRUM-88 / SCRUM-99 / T-34)
-- Rollback các cột actual_start, actual_end, percent_complete khỏi bảng tasks
-- ====================================================================

ALTER TABLE tasks
  DROP CHECK chk_task_percent_complete,
  DROP CHECK chk_task_actual_dates,
  DROP INDEX idx_tasks_actual_dates,
  DROP INDEX idx_tasks_percent,
  DROP COLUMN percent_complete,
  DROP COLUMN actual_end,
  DROP COLUMN actual_start;
