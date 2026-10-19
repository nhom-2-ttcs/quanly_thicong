-- ========================================================
-- MIGRATION S-30 (SCRUM-143): BẢO VỆ IDEMPOTENCY BẰNG UNIQUE CONSTRAINT Ở CSDL
-- Đảm bảo gửi lặp cùng mã client không tạo bản ghi trùng lặp
-- ========================================================

USE quanly_thicong;

-- 1. Bổ sung client_diary_id với ràng buộc UNIQUE cho site_diaries
ALTER TABLE `site_diaries`
ADD COLUMN `client_diary_id` VARCHAR(64) NULL AFTER `project_id`,
ADD CONSTRAINT `uq_diary_client_id` UNIQUE KEY (`client_diary_id`);

-- 2. Bổ sung client_item_id với ràng buộc UNIQUE cho site_diary_items
ALTER TABLE `site_diary_items`
ADD COLUMN `client_item_id` VARCHAR(64) NULL AFTER `diary_id`,
ADD CONSTRAINT `uq_item_client_id` UNIQUE KEY (`client_item_id`);

-- 3. Đảm bảo client_photo_id có ràng buộc UNIQUE trong site_diary_photos
-- (Nếu trước đó đã có INDEX thường thì nâng cấp lên UNIQUE KEY)
ALTER TABLE `site_diary_photos`
ADD CONSTRAINT `uq_photo_client_id` UNIQUE KEY (`client_photo_id`);
