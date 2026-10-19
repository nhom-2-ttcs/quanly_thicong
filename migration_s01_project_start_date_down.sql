-- Rollback S-01: bỏ cột ngày khởi công dự án.
ALTER TABLE projects DROP COLUMN IF EXISTS start_date;
