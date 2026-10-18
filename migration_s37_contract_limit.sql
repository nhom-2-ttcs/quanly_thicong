-- ========================================================
-- MIGRATION S-37: CHẶN NGHIỆM THU VƯỢT HỢP ĐỒNG Ở TẦNG CƠ SỞ DỮ LIỆU (SCRUM-E06)
-- Epic: E-06 (Nghiệm thu khối lượng luỹ kế)
-- Story S-37: Luỹ kế nghiệm thu không vượt khối lượng hợp đồng, bảo đảm ở tầng cơ sở dữ liệu
-- ========================================================

USE `quanly_thicong`;

-- 1. Trigger kiểm tra khối lượng hợp đồng khi thêm mới dòng chi tiết nghiệm thu
DROP TRIGGER IF EXISTS `trg_check_acceptance_contract_qty_insert`;

DELIMITER $$
CREATE TRIGGER `trg_check_acceptance_contract_qty_insert`
BEFORE INSERT ON `acceptance_sheet_items`
FOR EACH ROW
BEGIN
    DECLARE contract_qty DECIMAL(15, 4);
    DECLARE item_name_str VARCHAR(255);

    IF NEW.work_item_id IS NOT NULL THEN
        SELECT khoi_luong_hop_dong, name INTO contract_qty, item_name_str
        FROM work_items
        WHERE id = NEW.work_item_id
        LIMIT 1;

        IF contract_qty IS NOT NULL AND NEW.cumulative_quantity > contract_qty THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Lỗi CSDL: Khối lượng nghiệm thu luỹ kế vượt quá khối lượng hợp đồng';
        END IF;
    END IF;
END$$
DELIMITER ;

-- 2. Trigger kiểm tra khối lượng hợp đồng khi cập nhật dòng chi tiết nghiệm thu
DROP TRIGGER IF EXISTS `trg_check_acceptance_contract_qty_update`;

DELIMITER $$
CREATE TRIGGER `trg_check_acceptance_contract_qty_update`
BEFORE UPDATE ON `acceptance_sheet_items`
FOR EACH ROW
BEGIN
    DECLARE contract_qty DECIMAL(15, 4);

    IF NEW.work_item_id IS NOT NULL THEN
        SELECT khoi_luong_hop_dong INTO contract_qty
        FROM work_items
        WHERE id = NEW.work_item_id
        LIMIT 1;

        IF contract_qty IS NOT NULL AND NEW.cumulative_quantity > contract_qty THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Lỗi CSDL: Khối lượng nghiệm thu luỹ kế vượt quá khối lượng hợp đồng';
        END IF;
    END IF;
END$$
DELIMITER ;
