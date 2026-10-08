-- ==============================================================================
-- MIGRATION DOWN S-18: ROLLBACK BẢNG BASELINE KẾ HOẠCH GỐC
-- ==============================================================================

USE quanly_thicong;

DROP TABLE IF EXISTS baseline_history;
DROP TABLE IF EXISTS baseline_tasks;
DROP TABLE IF EXISTS baseline_schedules;
