USE quanly_thicong;

-- ====================================================================
-- MIGRATION DOWN (S-05 / SCRUM-60 / T-11)
-- Gỡ bỏ bảng tasks khi rollback migration S-05
-- ====================================================================
DROP TABLE IF EXISTS tasks;
