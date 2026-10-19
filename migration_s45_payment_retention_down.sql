-- ========================================================
-- ROLLBACK MIGRATION S-45: XÓA BẢNG ĐỀ NGHỊ THANH TOÁN & CỘT TẠM GIỮ
-- ========================================================

USE `quanly_thicong`;

DROP TABLE IF EXISTS `payment_request_items`;
DROP TABLE IF EXISTS `payment_requests`;

ALTER TABLE `projects`
    DROP COLUMN IF EXISTS `retention_rate`;
