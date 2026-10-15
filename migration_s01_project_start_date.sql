-- S-01: Lưu ngày khởi công dự án. Dữ liệu cũ để NULL, không gán ngày giả.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date DATE NULL AFTER description;
