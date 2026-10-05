## Sprint 2 integration: S-05 đến S-12

### Phạm vi đã đối chiếu

| Story | Trạng thái | Bằng chứng |
| --- | --- | --- |
| S-05 | Integrated / verified | Task, WBS ownership, validation và RBAC regression |
| S-06 | Integrated / verified | `task_dependencies`, migration idempotent, CRUD và RBAC |
| S-07 | Integrated / verified | Kahn topo, cycle handling 422, dữ liệu dependency thật |
| S-08 | Integrated / verified | Forward pass ES/EF, FS/SS/FF/SF và lag |
| S-09 | Integrated / verified | Backward pass LS/LF, float, critical task, API/UI schedule |
| S-10 | **BLOCKED BY MISSING REQUIREMENT** | Không tìm thấy Jira/AC, tài liệu hoặc branch/PR nguồn để triển khai hợp lệ |
| S-11 | Integrated / regression verified | Đã nằm trong `main`; regression cycle/API/UI được giữ |
| S-12 | **BLOCKED BY MISSING REQUIREMENT** | Không tìm thấy Jira/AC, tài liệu hoặc branch/PR nguồn để triển khai hợp lệ |

Không suy diễn task con hay acceptance criteria cho S-10/S-12. Quan hệ cha-con chỉ được ghi khi có nguồn thực: S-05 (`SCRUM-60`, T-11/T-12), S-06 (`SCRUM-61`, T-13/T-14), S-07 (`SCRUM-62`, T-15–T-17), S-09 (PR #4: T-20/T-21). Không có nguồn Jira để xác nhận đầy đủ quan hệ còn lại.

### Thay đổi chính

- Tích hợp quan hệ dependency thực từ S-06 vào topo, forward pass, backward pass và endpoint schedule.
- Chuẩn hóa ID số/chuỗi; từ chối duration, lag và dependency không hợp lệ thay vì âm thầm đổi thành `0`.
- Sửa backward pass/float/critical-path cho FS, SS, FF, SF và lag; chuẩn hóa `-0`.
- Thêm `GET /api/projects/:projectId/scheduling/schedule`; giữ alias `/order`; cycle trả 422 không lộ stack trace.
- Cập nhật WBS schedule UI với ES/EF/LS/LF/float/công việc găng và escape tên công việc.
- Cập nhật README theo port runtime đã kiểm chứng và trạng thái S-08/S-09/S-10/S-11/S-12.

### Database và migration

- Sử dụng bảng dependency S-06 duy nhất `task_dependencies`; không tạo bảng/API trùng.
- Migration S-06 đã được kiểm tra theo thiết kế idempotent; không xóa volume hay dữ liệu.

### Xác minh đã chạy

- `npm ci` (đã chạy trước đó): thành công, không báo vulnerability.
- `npm run lint`: PASS.
- `npm test`: **60 passed, 0 failed, 0 skipped**.
- `docker compose config`: PASS; đã bỏ khóa Compose `version` lỗi thời để không còn cảnh báo cấu hình.
- Docker runtime: health `OK`, db-check `Connected`; `login.html`, `index.html`, `wbs.html` đều HTTP 200.
- API smoke: admin/viewer login 200; project/task/dependency/schedule 200; schedule dự án 1 có 14 task và duration 30; cycle verify trả 422; Viewer chỉ đọc dự án được gán và bị chặn 403 khi xem dự án khác hoặc ghi dependency.
- `git diff --check`: sẽ được chạy lại trước khi push.

### Browser smoke

AutoGLM/Chrome không hoàn tất vì extension không kết nối trong thời gian chờ. Không đánh dấu browser E2E là PASS; phần xác minh runtime ở trên là HTTP/API smoke. Cần bật/kết nối extension rồi chạy lại luồng UI trực quan (admin, project manager, viewer, refresh và mobile) trước khi PR được review là hoàn tất UI E2E.

### Nguồn tích hợp

- Base hiện tại: `494117ddb0765e64de3ea236af06f3ca738d9a14` (`origin/main`).
- Commits trên branch này: `9554a7f`, `236534f`, `9ef3389`, `17a7232` và commit tài liệu của PR này.
- S-09 mainline được đồng bộ qua PR #4 (`cd67fdd`); xung đột add/add ở backward pass được review và giữ phiên bản có validation đầy đủ.

### Giới hạn / việc còn lại

1. S-10 và S-12 bị chặn bởi thiếu yêu cầu/acceptance criteria nguồn.
2. Browser smoke trực quan chưa chạy được do AutoGLM extension chưa kết nối.
3. Đây là Draft PR, không tự merge vào `main`.
