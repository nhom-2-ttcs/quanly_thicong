-- ===================================================================
-- MIGRATION DOWN S-48 (SCRUM-224 / SCRUM-232 / SCRUM-233)
-- Hoàn tác các cột dự toán và thực chi trên work_items
-- ===================================================================

USE quanly_thicong;

ALTER TABLE work_items
  DROP COLUMN IF EXISTS khoi_luong_thu_duoc,
  DROP COLUMN IF EXISTS thuc_chi,
  DROP COLUMN IF EXISTS thanh_tien_du_toan,
  DROP COLUMN IF EXISTS don_gia_du_toan,
  DROP COLUMN IF EXISTS khoi_luong_du_toan;
