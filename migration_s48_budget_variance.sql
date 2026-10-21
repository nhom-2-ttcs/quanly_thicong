-- ===================================================================
-- MIGRATION S-48 (SCRUM-224 / SCRUM-232 / SCRUM-233)
-- So sánh và cảnh báo: Dự toán, thực chi và cảnh báo vượt ngưỡng 80%
-- ===================================================================

USE quanly_thicong;

-- Bổ sung các cột dự toán (S-46), thực chi (S-47) và khối lượng thu được vào bảng work_items
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS khoi_luong_du_toan DECIMAL(15, 4) DEFAULT 0.0000 COMMENT 'Khối lượng dự toán kế hoạch (S-46)',
  ADD COLUMN IF NOT EXISTS don_gia_du_toan DECIMAL(18, 2) DEFAULT 0.00 COMMENT 'Đơn giá dự toán (S-46)',
  ADD COLUMN IF NOT EXISTS thanh_tien_du_toan DECIMAL(18, 2) DEFAULT 0.00 COMMENT 'Thành tiền dự toán = khối lượng x đơn giá (S-46)',
  ADD COLUMN IF NOT EXISTS thuc_chi DECIMAL(18, 2) DEFAULT 0.00 COMMENT 'Chi phí thực tế đã giải ngân (S-47)',
  ADD COLUMN IF NOT EXISTS khoi_luong_thu_duoc DECIMAL(15, 4) DEFAULT 0.0000 COMMENT 'Khối lượng hoàn thành thu được thực tế (S-47/S-48)';
