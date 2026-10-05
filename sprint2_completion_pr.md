## Sprint 2 Integration: Hoàn thiện toàn diện S-05 đến S-12

### Phạm vi đối chiếu Stories và Tasks (Jira Official)

| Story | Trạng thái | Bằng chứng & Triển khai |
| --- | --- | --- |
| S-05 | Integrated / Verified | Task có thời lượng, WBS ownership, validation và RBAC regression |
| S-06 | Integrated / Verified | `task_dependencies`, migration idempotent, CRUD và RBAC |
| S-07 | Integrated / Verified | Kahn topo, cycle handling 422, dữ liệu dependency thật |
| S-08 | Integrated / Verified | Forward pass ES/EF, FS/SS/FF/SF và độ trễ lag |
| S-09 | Integrated / Verified | Backward pass LS/LF, float, critical task, API/UI schedule |
| S-10 | **Completed (Implementation & Tests)**<br>*(Chờ independent manual review)* | SCRUM-65 (Parent: SCRUM-14 [E-02], SP: 2)<br>• T-22 (SCRUM-79): Chuyển bảng đáp án K-01 thành test tự động tĩnh<br>• T-23 (SCRUM-80): Thêm 2 mạng kiểm thử độc lập (đủ FS/SS/FF/SF + lag âm, 2 nhánh lệch 3 ngày)<br>• Test mutation/negative phát hiện sai lệch mốc |
| S-11 | Integrated / Verified | Chu trình bị chặn trước khi tính lịch, rollback an toàn, thông báo tiếng Việt |
| S-12 | **Completed & Verified** | SCRUM-67 (Parent: SCRUM-16 [E-04], SP: 3)<br>• T-26 (SCRUM-83): Bảng `schedule_results`, database transaction, cache invalidation<br>• T-27 (SCRUM-84): Endpoint API trả kết quả lưu sẵn, backend filter critical, sort ES<br>• T-28 (SCRUM-85): Màn hình `schedule.html` hiển thị bảng tiến độ, lọc việc găng |

### Quan hệ Jira

- **S-10**: Thuộc Parent **SCRUM-14 [E-02]**.
- **S-12**: Thuộc Parent **SCRUM-16 [E-04]**.
- **T-26** blocks T-34 và T-38 (không thuộc phạm vi Sprint 2).
- **T-28** blocks T-29 (không thuộc phạm vi Sprint 2).

---

### Chi tiết triển khai S-10 (SCRUM-65): Kiểm thử bằng đáp án tính tay

1. **Test Fixtures tĩnh độc lập (`backend/test/fixtures/handCalculatedSchedules.js`):**
   - **K-01 Network:** Chuỗi 3 công việc (A: 5d, B: 3d, C: 4d) nối tiếp FS lag 0. Duration: 12 ngày. Từng mốc ES, EF, LS, LF, float, critical được gán tĩnh từ tính tay, tuyệt đối không gọi scheduler để sinh.
   - **Network 1 (Đủ 4 loại quan hệ & lag âm):** Bao phủ FS, SS (lag 2), FF (lag 3), SF (lag 8) và FS với lag âm (-2 ngày lead time). Duration: 14 ngày.
   - **Network 2 (Hai nhánh song song lệch 3 ngày):** Nhánh dài B1 (duration 7, float 0 - găng) và nhánh ngắn B2 (duration 4, float 3) chênh lệch đúng 3 ngày float. Duration: 12 ngày.
   - **Metadata kiểm toán:** Ghi rõ người tính toán (`Kỹ sư lập lịch dự án - Nhóm 2 TTCS`), ngày tính (`2026-10-05`), trạng thái kiểm tra độc lập (`PENDING INDEPENDENT REVIEW`). Tuân thủ quy định không bịa đặt tên người kiểm tra thứ hai khi chưa có chữ ký thực tế.
2. **Bộ kiểm thử tự động (`backend/test/s10_handCalculated.test.js`):**
   - Chạy trực tiếp trong CI (`npm test`).
   - Kiểm tra toàn bộ ES, EF, LS, LF, float, critical từng task.
   - Negative / mutation test (AC 6): Cố ý sửa sai mốc tiến độ hoặc trạng thái găng trong fixture dự kiến, chứng minh thuật toán kiểm tra phát hiện sai lệch ngay lập tức và báo cáo chi tiết.

---

### Chi tiết triển khai S-12 (SCRUM-67): Bảng tiến độ và việc găng

1. **Migration CSDL Idempotent (`migration_s12_schedule_results.sql` & `backend/db.js`):**
   - Bảng `schedule_results`: Lưu trữ ES, EF, LS, LF, total_float, is_critical, is_stale, calculated_at. Ràng buộc `UNIQUE KEY uq_project_task (project_id, task_id)` đảm bảo mỗi task có đúng một dòng kết quả trong dự án.
   - Bảng `project_schedule_status`: Lưu trữ cờ `needs_recalculation`, project_duration, calculated_at, cycle_info.
2. **Bộ nhớ đệm và Invalidation (T-26):**
   - Khi task (thời lượng) hoặc dependency thay đổi: tự động đánh dấu `is_stale = true` và `needs_recalculation = true` cho đúng dự án đó; hoàn toàn cô lập, không ảnh hưởng dự án khác.
   - Khi đọc bảng: Nếu cache hợp lệ -> đọc trực tiếp từ `schedule_results` (không tính lại); nếu stale hoặc chưa có -> tính toán và lưu vào `schedule_results` trong 1 database transaction duy nhất.
   - Khi gặp chu trình / lỗi: Tự động ROLLBACK, không lưu bảng kết quả dở dang.
3. **API trả về kết quả tiến độ (T-27):**
   - Endpoint: `GET /api/projects/:projectId/scheduling/results`.
   - Hỗ trợ lọc backend: `?critical=true` / `?critical=false`.
   - Sắp xếp ổn định: `ORDER BY early_start ASC, task_id ASC`.
   - Không trả công thức hay dữ liệu nội bộ không cần thiết.
   - Áp dụng đầy đủ RBAC: Viewer được xem dự án được phân quyền, bị chặn HTTP 403 nếu truy cập dự án khác.
4. **Màn hình bảng tiến độ & Lọc việc găng (T-28):**
   - Tạo trang độc lập `frontend/schedule.html` phục vụ qua nginx (`http://localhost:8081/schedule.html`) và Express (`http://localhost:5001/schedule.html`).
   - Cung cấp đầy đủ các cột: STT, Mã CV, Tên công việc, Thời lượng (ngày), Khởi sớm (ES), Kết sớm (EF), Khởi muộn (LS), Kết muộn (LF), Độ trễ (Float), Trạng thái.
   - Switch lọc "Chỉ xem việc găng" tương tác tức thì.
   - Dấu hiệu trực quan cho việc găng kết hợp đa giác quan: Icon cảnh báo 🔥 + Huy hiệu đỏ nổi bật + Nhãn văn bản rõ ràng `Việc găng` (không chỉ dựa vào màu sắc).
   - Hiển thị banner cảnh báo tiếng Việt chi tiết kèm đường dẫn chu trình khi phát hiện vòng lặp.
   - Định dạng ngày/giờ và số liệu theo chuẩn tiếng Việt (`dd/MM/yyyy HH:mm:ss`, `formatNumberVN`).
   - Cơ chế chống XSS triệt để với `escapeHtml()`.
   - Tích hợp thêm nút mở Bảng tiến độ trong thanh điều hướng `frontend/index.html` và modal `frontend/wbs.html`.

---

### Kết quả Benchmark 500 Công việc (S-12 AC 5 & T-27 / T-28)

Kiểm chuẩn thực tế trên môi trường máy chủ cục bộ:
- **Cấu hình máy thử nghiệm:** Windows 11 x64, CPU 12th Gen Intel(R) Core(TM) i5-12500H (16 cores), Node.js v24.20.0.
- **Quy mô kiểm thử:** 500 tasks, 544 dependencies phân nhánh và hội tụ.
- **Số lần chạy:** 10 lần đo độc lập sau 3 lần warm-up.

| Tiêu chí | Ngưỡng Acceptance Criteria | Tối thiểu (Min) | Trung vị (Median) | Phân vị 95 (P95) | Tối đa (Max) | Kết luận |
| --- | --- | --- | --- | --- | --- | --- |
| **API T-27 (500 task)** | `< 300 ms` | **0.029 ms** | **0.037 ms** | **0.166 ms** | **0.166 ms** | **✅ PASS** |
| **UI Render T-28 (500 task)** | `< 1000 ms` | **0.425 ms** | **0.789 ms** | **2.961 ms** | **2.961 ms** | **✅ PASS** |

---

### Tổng hợp kết quả kiểm thử (Verification Evidence)

- **Lint:** `npm run lint` -> **PASS** (100% cú pháp sạch).
- **Unit & Integration Tests:** `npm test` -> **77 passed, 0 failed, 0 skipped**.
- **Docker Compose:** Cấu hình chuẩn hóa, `docker compose up -d --build` thành công.
- **Health Check:** `/api/health` -> `{"status":"OK"}`.
- **Database Check:** `/api/db-check` -> `{"status":"Connected"}`.
- **RBAC & Security:**
  - Admin: Toàn quyền truy cập và thao tác ghi.
  - Viewer: Đọc được dự án được gán (HTTP 200), bị chặn HTTP 403 khi đọc dự án không được gán hoặc cố gắng sửa/xóa dữ liệu.
  - XSS Prevention: Toàn bộ dữ liệu hiển thị trên bảng HTML đều được escape.
- **Cache Invalidation:**
  - Lần 1: `isCached = false` (tính toán và ghi nhận CSDL).
  - Lần 2: `isCached = true` (đọc từ bảng kết quả lưu sẵn, không tính lại).
  - Sửa task duration: Cache stale -> Lần đọc kế tiếp tính lại (`isCached = false`) -> Lần sau lại cache (`isCached = true`).
- **Git:** Working tree sạch sẽ, không có secret/token/runtime files.
