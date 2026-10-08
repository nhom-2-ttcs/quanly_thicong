-- ==========================================================
-- MIGRATION LÙI (DOWN): Xóa bảng milestone_alerts (Rollback)
-- ==========================================================
DROP INDEX IF EXISTS idx_ma_project_status ON milestone_alerts;
DROP INDEX IF EXISTS idx_ma_milestone ON milestone_alerts;
DROP TABLE IF EXISTS milestone_alerts;
