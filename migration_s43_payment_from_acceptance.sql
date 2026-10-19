-- ========================================================
-- MIGRATION S-43: SINH ĐỀ NGHỊ THANH TOÁN TỪ PHIẾU NGHIỆM THU ĐÃ DUYỆT
-- Epic: E-08 (Thanh toán theo tiến độ)
-- Story S-43: T-97, T-98, T-99, T-100
-- Phụ thuộc: S-36 (acceptance_sheets), S-45 (payment_requests, payment_request_items)
--
-- Mục tiêu:
--   (T-97) Chỉ lấy phiếu NT đã duyệt, thuộc đúng project+period, chưa liên kết với đề nghị khác
--   (T-98) Tính line_total = period_quantity * unit_price; tổng = SUM(line_total)
--   (T-99) Khoá liên kết: một phiếu NT chỉ vào được một đề nghị (UNIQUE ở tầng DB)
--   (T-100) Test hiển thị + phép tính + chống trùng
--
-- NFR: Tiền lưu bằng DECIMAL(18,2); làm tròn HALF_UP; ghi rõ quy tắc trong comment.
-- ========================================================

USE `quanly_thicong`;

-- -------------------------------------------------------
-- T-99 (AC: "Ràng buộc bảo vệ ở tầng lưu trữ"):
-- Thêm cột liên kết ngược từ acceptance_sheets sang payment_request.
-- Giá trị NULL = chưa được đưa vào đề nghị nào.
-- Ràng buộc UNIQUE đảm bảo một phiếu chỉ vào MỘT đề nghị.
-- -------------------------------------------------------
ALTER TABLE `acceptance_sheets`
    ADD COLUMN IF NOT EXISTS `payment_request_id` INT NULL
        COMMENT 'FK → payment_requests.id; NULL = chưa đưa vào đề nghị nào (S-43 T-99)',
    ADD CONSTRAINT `fk_as_payment_request`
        FOREIGN KEY IF NOT EXISTS (`payment_request_id`)
        REFERENCES `payment_requests` (`id`)
        ON DELETE SET NULL,
    ADD UNIQUE KEY IF NOT EXISTS `uq_acceptance_sheet_payment` (`payment_request_id`, `id`);

-- -------------------------------------------------------
-- T-97 (AC: "Kết quả có đủ hạng mục, khối lượng đợt và đơn giá hợp đồng"):
-- View tiện truy vấn phiếu NT đã duyệt CÒN HIỆU LỰC lập đề nghị:
--   • status = 'approved'
--   • payment_request_id IS NULL  → chưa được đưa vào bất kỳ đề nghị nào
-- -------------------------------------------------------
CREATE OR REPLACE VIEW `v_approved_sheets_available` AS
SELECT
    s.id                AS sheet_id,
    s.project_id,
    s.sheet_code,
    s.name              AS sheet_name,
    s.period_number,
    s.from_date,
    s.to_date,
    s.approved_at,
    i.id                AS item_id,
    i.work_item_id,
    i.item_name,
    i.unit,
    i.period_quantity,  -- khối lượng đợt (T-98 đầu vào)
    COALESCE(w.don_gia_hop_dong, 0) AS unit_price,  -- đơn giá hợp đồng (T-97 AC)
    -- T-98: Thành tiền từng dòng = period_quantity * unit_price (DECIMAL chính xác, làm tròn HALF_UP 2 chữ số)
    ROUND(i.period_quantity * COALESCE(w.don_gia_hop_dong, 0), 2) AS line_total
FROM acceptance_sheets s
JOIN acceptance_sheet_items i  ON i.sheet_id = s.id
LEFT JOIN work_items w         ON w.id = i.work_item_id
WHERE s.status = 'approved'
  AND s.payment_request_id IS NULL;  -- T-99: chỉ phiếu chưa liên kết

-- -------------------------------------------------------
-- T-99 (AC: "Nếu tạo đề nghị thất bại, không để lại liên kết dở dang"):
-- Stored Procedure atomic tạo đề nghị + khoá liên kết trong một transaction.
-- Dùng SELECT ... FOR UPDATE để phát hiện race condition đồng thời (S-43 NFR).
-- -------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_create_payment_from_acceptance`;
DELIMITER $$
CREATE PROCEDURE `sp_create_payment_from_acceptance`(
    IN  p_project_id      INT,
    IN  p_request_code    VARCHAR(50),
    IN  p_name            VARCHAR(255),
    IN  p_period_number   INT,
    IN  p_from_date       DATE,
    IN  p_to_date         DATE,
    IN  p_retention_rate  DECIMAL(5,2),
    IN  p_notes           TEXT,
    IN  p_created_by      INT,
    OUT o_request_id      INT,
    OUT o_gross_amount    DECIMAL(18,2),
    OUT o_retention_amount DECIMAL(18,2),
    OUT o_net_payable     DECIMAL(18,2),
    OUT o_error_msg       VARCHAR(500)
)
BEGIN
    DECLARE v_gross      DECIMAL(18,2) DEFAULT 0.00;
    DECLARE v_retention  DECIMAL(18,2) DEFAULT 0.00;
    DECLARE v_net        DECIMAL(18,2) DEFAULT 0.00;
    DECLARE v_req_id     INT DEFAULT 0;
    DECLARE v_locked_count INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET o_request_id = 0;
        SET o_error_msg = 'Lỗi nội bộ khi tạo đề nghị thanh toán';
    END;

    START TRANSACTION;

    -- Kiểm tra trùng mã đề nghị
    IF EXISTS (
        SELECT 1 FROM payment_requests
        WHERE project_id = p_project_id AND request_code = p_request_code
    ) THEN
        ROLLBACK;
        SET o_request_id = 0;
        SET o_error_msg = CONCAT('Mã đề nghị "', p_request_code, '" đã tồn tại trong dự án này');
        LEAVE sp_create_payment_from_acceptance;
    END IF;

    -- T-99 Race condition: khoá tất cả phiếu NT đã duyệt, chưa liên kết
    SELECT COUNT(*) INTO v_locked_count
    FROM acceptance_sheets
    WHERE project_id = p_project_id
      AND status = 'approved'
      AND payment_request_id IS NULL
    FOR UPDATE;

    IF v_locked_count = 0 THEN
        ROLLBACK;
        SET o_request_id = 0;
        SET o_error_msg = 'Không có phiếu nghiệm thu đã duyệt nào chưa được đưa vào đề nghị';
        LEAVE sp_create_payment_from_acceptance;
    END IF;

    -- T-98: Tính gross_amount = SUM(period_quantity * unit_price) DECIMAL chính xác
    -- Quy tắc làm tròn: ROUND(..., 2) = HALF_UP (mặc định MySQL), áp dụng từng dòng rồi cộng tổng
    SELECT ROUND(SUM(ROUND(i.period_quantity * COALESCE(w.don_gia_hop_dong, 0), 2)), 2)
    INTO v_gross
    FROM acceptance_sheets s
    JOIN acceptance_sheet_items i ON i.sheet_id = s.id
    LEFT JOIN work_items w ON w.id = i.work_item_id
    WHERE s.project_id = p_project_id
      AND s.status = 'approved'
      AND s.payment_request_id IS NULL;

    SET v_gross = COALESCE(v_gross, 0.00);

    -- T-98: retention_amount = ROUND(gross * rate / 100, 2) — làm tròn HALF_UP 2 chữ số
    SET v_retention = ROUND(v_gross * p_retention_rate / 100, 2);

    -- T-98: net = gross - retention (không làm tròn thêm → đảm bảo gross = retention + net)
    SET v_net = ROUND(v_gross - v_retention, 2);

    -- Tạo payment_request
    INSERT INTO payment_requests
        (project_id, request_code, name, period_number, from_date, to_date,
         gross_amount, retention_rate, retention_amount, net_payable_amount,
         status, notes, created_by)
    VALUES
        (p_project_id, p_request_code, p_name, p_period_number, p_from_date, p_to_date,
         v_gross, p_retention_rate, v_retention, v_net,
         'draft', p_notes, p_created_by);

    SET v_req_id = LAST_INSERT_ID();

    -- Tạo payment_request_items từ từng dòng phiếu NT (T-97 + T-98)
    INSERT INTO payment_request_items
        (payment_request_id, acceptance_sheet_id, work_item_id,
         item_name, unit, period_quantity, unit_price, line_total)
    SELECT
        v_req_id,
        s.id,
        i.work_item_id,
        i.item_name,
        i.unit,
        i.period_quantity,
        COALESCE(w.don_gia_hop_dong, 0),
        ROUND(i.period_quantity * COALESCE(w.don_gia_hop_dong, 0), 2)
    FROM acceptance_sheets s
    JOIN acceptance_sheet_items i ON i.sheet_id = s.id
    LEFT JOIN work_items w ON w.id = i.work_item_id
    WHERE s.project_id = p_project_id
      AND s.status = 'approved'
      AND s.payment_request_id IS NULL;

    -- T-99: Khoá liên kết — cập nhật acceptance_sheets.payment_request_id
    UPDATE acceptance_sheets
    SET payment_request_id = v_req_id
    WHERE project_id = p_project_id
      AND status = 'approved'
      AND payment_request_id IS NULL;

    COMMIT;

    SET o_request_id      = v_req_id;
    SET o_gross_amount    = v_gross;
    SET o_retention_amount = v_retention;
    SET o_net_payable     = v_net;
    SET o_error_msg       = NULL;
END$$
DELIMITER ;
