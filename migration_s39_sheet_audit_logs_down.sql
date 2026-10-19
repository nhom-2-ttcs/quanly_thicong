-- ========================================================
-- DOWN MIGRATION S-39: ROLLBACK NHẬT KÝ THAO TÁC TRÊN PHIẾU (SCRUM-168)
-- ========================================================

USE `quanly_thicong`;

DROP TABLE IF EXISTS `sheet_audit_logs`;
