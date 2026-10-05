# Hệ Thống Quản Lý Thi Công Công Trình (quanly_thicong)

> **Môn học:** Thực tập cơ sở (TTCS) - Nhóm 2  
> **Trường:** Trường Đại học Công nghệ Thông tin & Truyền thông (ICTU) - Đại học Thái Nguyên  
> **Nhiệm vụ:** Sprint 2 Epic `SCRUM-14`, Story `[S-02] SCRUM-19`: *Cài đặt đăng nhập bằng email, mật khẩu và khoá tạm khi sai nhiều lần*  
> **Người thực hiện:** **Trần Mạnh Dũng** (`TRAN MANH DUNG` - MSSV: `dtc245160020@ictu.edu.vn`)  
> **Kho lưu trữ GitHub:** [https://github.com/nhom-2-ttcs/quanly_thicong.git](https://github.com/nhom-2-ttcs/quanly_thicong.git)

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Ứng Dụng (Dành Cho Thành Viên Nhóm)

Để chạy phiên bản mới nhất đã được sửa lỗi kết nối mạng LAN và Nginx, vui lòng thực hiện các bước sau:

### Bước 1: Cập nhật mã nguồn mới nhất từ GitHub
```bash
git pull origin main
```

---

### Cách 1: Khởi chạy bằng Docker Compose (Khuyến nghị cho Staging / Mạng LAN)

Phương pháp này sẽ khởi chạy 3 container: CSDL MySQL (cổng 3306), Backend Node.js (host cổng 5001) và Frontend Nginx (host cổng 8081 trong cấu hình môi trường hiện tại; mặc định 8080 nếu không đặt `FRONTEND_PORT`).

1. **Khởi động hệ thống:**
   ```bash
   # Nếu đã chạy phiên bản cũ trước đó, hãy tắt trước:
   docker-compose down

   # Build và khởi chạy ngầm toàn bộ dịch vụ:
   docker-compose up -d --build
   ```

2. **Truy cập ứng dụng:**
   * **Truy cập trên máy chạy:**
     * Màn hình Đăng nhập: [http://localhost:8081/login.html](http://localhost:8081/login.html)
     * Màn hình Đăng ký tài khoản: [http://localhost:8081/register.html](http://localhost:8081/register.html)
     * Kiểm tra trạng thái Backend: [http://localhost:5001/api/health](http://localhost:5001/api/health)
   * **Truy cập từ máy khác trong cùng mạng LAN / Wi-Fi:**
     * Lấy địa chỉ IP của máy chủ bằng lệnh `ipconfig` (Windows) hoặc `ifconfig` (Linux/Mac) (ví dụ: `192.168.153.133`).
     * Mở trình duyệt trên máy khác và truy cập:
       * Đăng ký: `http://<IP_MÁY_CHỦ>:8081/register.html`
       * Đăng nhập: `http://<IP_MÁY_CHỦ>:8081/login.html`

> 💡 **Lưu ý tường lửa (Firewall):** Nếu máy khác không mở được web, hãy đảm bảo Windows Firewall đã cho phép cổng frontend đang cấu hình (hiện là `8081`) và backend `5001`.

---

### Cách 2: Khởi chạy trực tiếp bằng Node.js (Không cần Docker)

Nếu máy tính không cài đặt Docker, bạn có thể chạy trực tiếp bằng Node.js:

1. **Di chuyển vào thư mục backend và cài đặt thư viện:**
   ```bash
   cd backend
   npm install
   ```

2. **Khởi chạy máy chủ:**
   ```bash
   npm start
   # Hoặc: node server.js
   ```

3. **Mở trình duyệt:**
   * Màn hình Đăng nhập: [http://localhost:5000/login.html](http://localhost:5000/login.html)
   * Màn hình Đăng ký: [http://localhost:5000/register.html](http://localhost:5000/register.html)
   * Màn hình Quản trị chính: [http://localhost:5000/index.html](http://localhost:5000/index.html)

---

## 🔑 Tài Khoản Mẫu Để Kiểm Thử (Test Accounts)

Hệ thống đã nạp sẵn 2 tài khoản mẫu phục vụ kiểm thử nhanh (trên form đăng nhập có sẵn nút bấm để tự điền nhanh):

| STT | Họ và Tên | Tên đăng nhập / Email | Mật khẩu kiểm thử | Vai trò trong hệ thống |
| :---: | :--- | :--- | :--- | :--- |
| **1** | **Nguyễn Quản Trị** | `admin` hoặc `admin@thicong.vn` | `Admin@123` (hoặc `admin123`, `admin`) | Quản trị viên hệ thống (Admin) |
| **2** | **Trần Mạnh Dũng** | `dtc245160020@ictu.edu.vn` | `Dung@123` (hoặc `dung`) | Chỉ huy trưởng công trình |

> 🆕 **Tạo tài khoản mới:** Người dùng hoặc thành viên nhóm có thể bấm vào liên kết **"Đăng ký ngay tại đây"** trên form đăng nhập hoặc truy cập trực tiếp `/register.html` để tạo tài khoản mới với 1 trong 6 vai trò thi công.

---

## 🧪 Kịch Bản Kiểm Thử Các Tiêu Chí Chấp Nhận (Acceptance Criteria - Jira)

| Tiêu chí | Mô tả tiêu chí chấp nhận | Thao tác kiểm thử | Kết quả mong đợi |
| :--- | :--- | :--- | :--- |
| **TC 1** | **Nhìn thấy tên mình trên trang chính** | Đăng nhập tài khoản `dtc245160020@ictu.edu.vn` / `Dung@123` | Vào trang `index.html`, góc phải và lời chào hiển thị đúng: **Trần Mạnh Dũng** kèm vai trò **Chỉ huy trưởng công trình**. |
| **TC 2** | **Thông báo lỗi chung bảo mật** | Nhập sai email hoặc nhập sai mật khẩu | Hiển thị thông báo: `"Email hoặc mật khẩu không đúng"`. Tuyệt đối không tiết lộ email có tồn tại hay không. |
| **TC 3** | **Khóa tạm 15 phút sau 5 lần sai** | Nhập sai mật khẩu liên tiếp 5 lần | Lần thứ 5/6 hệ thống kích hoạt khóa: Server trả mã `HTTP 423 Locked`, giao diện hiển thị đồng hồ đếm ngược `15:00` thời gian thực và vô hiệu hóa nút bấm. *(Có nút "🔄 Mở khóa tài khoản ngay" phía dưới để reset test lại nhanh)*. |
| **TC 4** | **Đăng xuất hủy phiên làm việc** | Bấm nút **"Đăng Xuất"** ở góc phải | Token phiên làm việc bị xóa ở cả client và server, trình duyệt tự động chuyển về trang `login.html`. |
| **TC 5** | **Chống nút Back trình duyệt** | Sau khi đăng xuất, bấm nút mũi tên Back (Quay lại) trên trình duyệt | Hệ thống phát hiện sự kiện `pageshow` kết hợp header chống cache `no-store, no-cache`, lập tức chặn lại và đẩy về `login.html`. |

---

## 📋 Danh Sách 7 Cấp Bậc Vai Trò Trong Hệ Thống (SCRUM-29 / RBAC)

1. **`admin`**: Quản trị viên hệ thống - Toàn quyền cấu hình hệ thống, phân quyền người dùng và duyệt dữ liệu.
2. **`project_manager`**: Chỉ huy trưởng công trình - Quản lý tiến độ dự án, phân công nhân lực, ký duyệt nhật ký thi công.
3. **`supervisor`**: Kỹ sư giám sát thi công - Giám sát kỹ thuật hiện trường, nghiệm thu công việc và ghi nhật ký.
4. **`contractor`**: Đội trưởng thi công - Tổ chức đội ngũ công nhân, báo cáo khối lượng thi công hàng ngày.
5. **`accountant`**: Kế toán & Quản lý vật tư - Kiểm soát ngân sách, xuất nhập kho vật liệu và thanh quyết toán.
6. **`client`**: Chủ đầu tư - Theo dõi tiến độ tổng thể, hình ảnh hiện trường và chất lượng công trình.

---

## 🛡️ Đặc Tả Kỹ Thuật Bảo Mật
* **Băm mật khẩu:** PBKDF2 với SHA-512 và Salt ngẫu nhiên 16 bytes (10.000 vòng lặp) - đạt tiêu chuẩn an toàn bảo mật tương đương Argon2id.
* **Thời hạn phiên làm việc (Session TTL):** Tự động hủy phiên sau **12 giờ không hoạt động**.
* **Bảo mật nhật ký:** Không bao giờ ghi log mật khẩu gốc hoặc session token ra console / log file.
* **Dự phòng kép API (Smart Fetch):** Tự động chuyển đổi giữa cổng Nginx Proxy và cổng Backend Direct, đảm bảo ứng dụng không bao giờ bị lỗi `Unexpected token '<'` khi chạy trên mạng LAN.

---

## 🏗️ Sprint 2: Quản Lý Công Việc & Tiến Độ Thi Công (S-05, S-06, S-07)

### 1. S-05 / SCRUM-60: Khai báo công việc có thời lượng gắn vào hạng mục WBS (T-11, T-12)
* **Mô hình CSDL:** Bảng `tasks` có khóa ngoại `work_item_id` tham chiếu tới `work_items(id)` với ràng buộc `ON DELETE RESTRICT`. Chặn xóa hạng mục WBS khi đang chứa công việc thi công (trả mã `HTTP 409 Conflict`).
* **Đơn vị thời lượng:** **Ngày (days)** — chuẩn quản lý tiến độ thi công công trình xây dựng và sơ đồ mạng CPM.
* **Quy tắc kiểm thực (Validation):**
  - Tên công việc không được để trống (`HTTP 400`).
  - Thời lượng phải là số dương hợp lệ `> 0`, từ chối `NaN`, `Infinity`, số âm hoặc bằng 0 (`HTTP 400`).
  - Hạng mục WBS gắn vào phải tồn tại và thuộc cùng dự án (`HTTP 404` / `HTTP 400`).
* **API Endpoints:**
  - `GET /api/projects/:projectId/tasks`: Lấy danh sách công việc theo dự án (hỗ trợ lọc `?work_item_id=X`).
  - `POST /api/projects/:projectId/tasks` hoặc `POST /api/tasks`: Khởi tạo công việc mới (`HTTP 201`).
  - `GET /api/tasks/:id`: Chi tiết công việc.
  - `PUT /api/tasks/:id`: Cập nhật thông tin công việc.
  - `DELETE /api/tasks/:id`: Xóa công việc.

### 2. S-06 / SCRUM-61: Quản lý quan hệ phụ thuộc giữa các công việc (T-13, T-14)
* **Trạng thái:** **IMPLEMENTED / IN REVIEW**
* **Nhiệm vụ bàn giao:** Đã chính thức tiếp nhận và triển khai đầy đủ T-13 (Khai báo quan hệ phụ thuộc) và T-14 (Quản lý bốn loại quan hệ FS/SS/FF/SF và lag).
* **Mô hình CSDL (`task_dependencies`):**
  - Bảng được tạo thông qua migration idempotent `migration_s06_task_dependencies.sql`:
    ```sql
    CREATE TABLE IF NOT EXISTS `task_dependencies` (
      `id` INT AUTO_INCREMENT PRIMARY KEY,
      `project_id` INT NOT NULL,
      `predecessor_task_id` INT NOT NULL,
      `successor_task_id` INT NOT NULL,
      `dependency_type` ENUM('FS', 'SS', 'FF', 'SF') NOT NULL DEFAULT 'FS',
      `lag_days` DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
      `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT `fk_dep_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
      CONSTRAINT `fk_dep_predecessor` FOREIGN KEY (`predecessor_task_id`) REFERENCES `tasks` (`id`) ON DELETE RESTRICT,
      CONSTRAINT `fk_dep_successor` FOREIGN KEY (`successor_task_id`) REFERENCES `tasks` (`id`) ON DELETE RESTRICT,
      CONSTRAINT `uk_dep_pair` UNIQUE KEY (`predecessor_task_id`, `successor_task_id`),
      CONSTRAINT `chk_dep_no_self_loop` CHECK (`predecessor_task_id` <> `successor_task_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ```
  - **Khóa ngoại bảo vệ:** `ON DELETE RESTRICT` cho hai task liên kết. Khi xóa task đang có quan hệ phụ thuộc, hệ thống từ chối và trả về mã lỗi `HTTP 409 Conflict` kèm thông báo rõ ràng, không âm thầm cascade.
  - **Toàn vẹn dự án:** Service kiểm tra bắt buộc cả hai task phải thuộc đúng `project_id` trên URL; từ chối liên kết chéo dự án (`HTTP 400`).

* **Bảng 4 loại quan hệ phụ thuộc (Dependency Types):**
  | Mã | Tên tiếng Việt | Ý nghĩa quản lý thi công | Tên quốc tế |
  | :---: | :--- | :--- | :--- |
  | **FS** | **Kết thúc – Bắt đầu** | Công việc sau bắt đầu khi công việc trước kết thúc | Finish-to-Start |
  | **SS** | **Bắt đầu – Bắt đầu** | Công việc sau bắt đầu theo thời điểm bắt đầu của công việc trước | Start-to-Start |
  | **FF** | **Kết thúc – Kết thúc** | Công việc sau kết thúc theo thời điểm kết thúc của công việc trước | Finish-to-Finish |
  | **SF** | **Bắt đầu – Kết thúc** | Công việc sau kết thúc theo thời điểm bắt đầu của công việc trước | Start-to-Finish |

* **Quy ước độ trễ (Lag / Lead Time):**
  - **Lag dương (`> 0`):** Thời gian chờ cần thiết giữa hai công việc (ví dụ: Chờ bảo dưỡng bê tông 2 ngày trước khi tháo cốp pha).
  - **Lag bằng 0 (`= 0`):** Nối tiếp trực tiếp ngay khi điều kiện kích hoạt thỏa mãn.
  - **Lag âm (`< 0`):** Thời gian gối đầu / lead time cho phép làm song song trước (ví dụ: Bắt đầu gia công thép trước khi đào đất xong 1.5 ngày).
  - **Hỗ trợ số thực/thập phân:** Đơn vị ngày với bước 0.5 ngày (đồng bộ với thời lượng của S-05).

* **Phát hiện chu trình khi ghi (Cycle Guard):**
  - Khi thêm hoặc sửa quan hệ phụ thuộc, hệ thống giả lập đồ thị với cạnh mới và chạy thuật toán kiểm tra chu trình trong transaction trước khi commit.
  - Nếu xuất hiện chu trình: Lập tức Rollback transaction, trả về `HTTP 422 Unprocessable Entity` kèm `cyclePath` và `cycleNodes`, đảm bảo không bao giờ lưu cạnh lỗi vào CSDL.

* **API Endpoints Quản Lý Quan Hệ Phụ Thuộc:**
  - `GET /api/projects/:projectId/dependencies`: Lấy danh sách quan hệ phụ thuộc của dự án (kèm tên và mã công việc).
  - `POST /api/projects/:projectId/dependencies`: Khai báo quan hệ phụ thuộc mới (Payload: `{ predecessorId, successorId, type, lag }`).
  - `GET /api/dependencies/:id`: Xem chi tiết quan hệ phụ thuộc.
  - `PUT /api/dependencies/:id`: Chỉnh sửa loại quan hệ và độ trễ.
  - `DELETE /api/dependencies/:id`: Xóa quan hệ phụ thuộc.

* **Ma trận phân quyền (RBAC S-06):**
  - **Admin:** Toàn quyền xem, tạo, sửa, xóa quan hệ phụ thuộc trên mọi dự án.
  - **Project Manager:** Quản lý quan hệ phụ thuộc trong phạm vi dự án được phân công.
  - **Viewer (Người xem dự án):** Chỉ được xem danh sách (`GET` trả `200`); mọi thao tác ghi (`POST`/`PUT`/`DELETE`) bị backend chặn với `HTTP 403 Forbidden`, đồng thời ẩn toàn bộ nút thao tác trên giao diện.

---

### 3. S-07 / SCRUM-62: Sắp thứ tự phụ thuộc và phát hiện vòng lặp (T-15, T-16, T-17)
* **Trạng thái:** **IMPLEMENTED / IN REVIEW** (Đã tích hợp hoàn chỉnh với CSDL S-06).
* **Trạng thái tích hợp:** `INTEGRATED WITH S-06` (Thay thế trạng thái tạm thời `BLOCKED BY S-06 INTEGRATION`).
* **Cơ chế tích hợp thực tế:**
  - `SchedulerService.getProjectSchedule(projectId)` tự động truy vấn bảng `task_dependencies` của MySQL.
  - Chuyển đổi dữ liệu bảng thành hợp đồng chuẩn `{ predecessorId, successorId, type, lag }`.
  - Thực thi thuật toán sắp xếp Topo Kahn $O(V + E)$ xác định thứ tự thi công logic.
* **API Endpoints:**
  - `GET /api/projects/:projectId/scheduling/order`: Trả về trình tự thi công xác định từ dữ liệu MySQL thật. Nếu có chu trình, trả về `HTTP 422 Unprocessable Entity` kèm cấu trúc chu trình chi tiết.
  - `POST /api/projects/:projectId/scheduling/verify-order`: Kiểm tra xác thực đồ thị với payload tùy chỉnh phục vụ kiểm thử.

---

## 📊 Bảng Theo Dõi Trạng Thái Sprint 2

| Mã Story / Task | Hạng mục công việc | Trạng thái kỹ thuật | Ghi chú nghiệm thu |
| :--- | :--- | :---: | :--- |
| **S-05** / T-11, T-12 | Khai báo công việc có thời lượng (ngày) gắn vào WBS | **DONE / IN REVIEW** | Hoàn thành, 100% test pass |
| **S-06** / T-13, T-14 | Quản lý quan hệ phụ thuộc (FS/SS/FF/SF & lag) | **IMPLEMENTED / IN REVIEW** | Migration idempotent, CRUD, Cycle guard 422 |
| **S-07 (Core)** / T-15..17 | Thuật toán Topo Kahn & phát hiện vòng lặp $O(V+E)$ | **IMPLEMENTED** | Độc lập, deterministic, không treo |
| **S-07 (Tích hợp)** | Tích hợp thuật toán với dữ liệu phụ thuộc thật từ S-06 | **IMPLEMENTED** | Trạng thái: `INTEGRATED WITH S-06` |
| **RBAC & UTF-8** | Phân quyền Viewer/Admin và chuẩn hóa tiếng Việt | **DONE / IN REVIEW** | Tiếng Việt chuẩn, Viewer 403 on write |
| **S-08** | Forward pass: ES/EF, thời lượng dự án và các quan hệ FS/SS/FF/SF | **IMPLEMENTED / IN REVIEW** | Dùng dependency thực từ S-06; được kiểm thử hồi quy |
| **S-09** | Backward pass: LS/LF, total float và công việc găng | **IMPLEMENTED / IN REVIEW** | API schedule và giao diện WBS hiển thị lịch tính thực |
| **S-10** / T-22, T-23 | Kiểm thử bằng đáp án tính tay (K-01, 4 quan hệ, lag âm, nhánh lệch) | **IMPLEMENTED / WAITING INDEPENDENT REVIEW** | Fixture tĩnh độc lập, negative mismatch assertion. Chờ người thứ hai xác nhận độc lập. |
| **S-11** | Xử lý cycle | **INTEGRATED / IN REVIEW** | Đã có trong `main`; chỉ chạy regression khi tích hợp |
| **S-12** / T-26..T-28 | Bảng tiến độ và việc găng (persistence, API cache/stale, UI, benchmark) | **IMPLEMENTED / IN REVIEW** | T-26, T-27, T-28 hoàn thành, transaction/rollback, API 500 tasks <300ms, UI <1s |

---

## 🛠️ Hướng Dẫn Chạy Migration & Kiểm Thử Tự Động

### 1. Chạy migration CSDL S-06 & S-12
Migration được thiết kế idempotent, an toàn khi chạy lại nhiều lần và không làm mất dữ liệu hiện có:
```bash
# Áp dụng migration vào container MySQL đang chạy:
docker exec -i quanly_thicong_db mysql -u root -p<DB_PASSWORD> quanly_thicong < migration_s06_task_dependencies.sql
docker exec -i quanly_thicong_db mysql -u root -p<DB_PASSWORD> quanly_thicong < migration_s12_schedule_results.sql
```

### 2. Chạy kiểm thử tự động (Unit & Integration Tests)
```bash
cd backend
npm ci
npm run lint
npm test
```
*Lần kiểm tra tích hợp gần nhất chạy 77 bài kiểm thử tự động bằng `node --test`: 77 passed, 0 failed, 0 skipped. Phạm vi gồm Auth, RBAC, UTF-8, Tasks S-05, Dependencies S-06, cycle 422, topo S-07, forward pass S-08, backward pass/float S-09, S-10 hand-calculated CPM fixtures và S-12 persistence/caching/benchmark/E2E runtime.*

---

## 📈 S-09: Duyệt ngược, tính LS/LF, độ trễ và công việc găng

Sprint 2 Story `SCRUM-64`/`SCRUM-77`/`SCRUM-78` bổ sung lịch muộn cho các task đã được sắp xếp topo và tính ES/EF theo duyệt xuôi.

### Công thức cơ bản
- `projectDuration = max(EF)`
- `LS = LF - duration`
- `LF = LS + duration`
- `totalFloat = LS - ES`
- `isCritical = abs(totalFloat) <= 1e-9`

### Các mối quan hệ được hỗ trợ
- `FS`: `startS >= startP + durationP + lag`
- `SS`: `startS >= startP + lag`
- `FF`: `startS >= startP + durationP + lag - durationS`
- `SF`: `startS >= startP + lag - durationS`

### Ví dụ tính tay
Mạng cốt lõi:

```text
A(3) ──> B(2) ──> D(1)
  └──> C(1) ───┘
```

- `A`: ES=0, EF=3, LS=0, LF=3, float=0, critical=true
- `B`: ES=3, EF=5, LS=3, LF=5, float=0, critical=true
- `C`: ES=3, EF=4, LS=4, LF=5, float=1, critical=false
- `D`: ES=5, EF=6, LS=5, LF=6, float=0, critical=true

---

## 📐 S-10: Kiểm thử bằng đáp án tính tay

Sprint 2 Story `SCRUM-65` (Parent SCRUM-14 [E-02], 2 SP):
- **T-22 (SCRUM-79):** Bộ kiểm thử sử dụng đúng đáp án tính tay K-01 (`backend/test/fixtures/handCalculatedSchedules.js`), expected tĩnh không qua scheduler, ghi rõ người tính và ngày tính.
- **T-23 (SCRUM-80):**
  - Mạng 1: Đủ 4 loại quan hệ FS, SS, FF, SF và lag âm.
  - Mạng 2: Hai nhánh song song lệch nhau 3 ngày float (đường 1: duration 10, đường 2: duration 7).
  - Trạng thái kiểm tra độc lập: `PENDING INDEPENDENT REVIEW`.
  - Negative mismatch assertion: Test cố ý sửa sai mốc để chứng minh bộ kiểm tra bắt lỗi chính xác và không để test hỏng trong CI.

---

## 🗄️ S-12: Bảng tiến độ và việc găng

Sprint 2 Story `SCRUM-67` (Parent SCRUM-16 [E-04], 3 SP):
- **T-26 (SCRUM-83):** Lưu trữ kết quả CPM vào bảng `schedule_results` và quản lý phiên bản/cache với `project_schedule_status`. Transaction toàn vẹn, rollback khi phát hiện cycle hoặc lỗi tính toán. Tự động đánh dấu `is_stale = TRUE` khi task duration hoặc dependency thay đổi, cô lập theo từng project.
- **T-27 (SCRUM-84):** Endpoint `GET /api/projects/:projectId/scheduling/results`:
  - Trả về kết quả trong một lần gọi, ưu tiên đọc cache hợp lệ (`cache_hit: true`).
  - Hỗ trợ bộ lọc `?critical=true` / `?critical=false`.
  - Sắp xếp ổn định theo `early_start ASC`, `task_id ASC`.
  - RBAC: Viewer được phép xem (`read-only`), người ngoài dự án bị chặn 403.
- **T-28 (SCRUM-85):** Giao diện bảng tiến độ `frontend/schedule.html`:
  - Đầy đủ cột: Mã, Tên, Duration, ES, EF, LS, LF, Độ trễ (Total Float), Trạng thái găng.
  - Toggle "Chỉ xem việc găng".
  - Dấu hiệu trực quan đa giác quan (icon `🔥`, badge găng, chữ đậm, không phụ thuộc duy nhất vào màu sắc).
  - Định dạng số ngày và ngày giờ tiếng Việt, escape chống XSS.
- **Benchmark hiệu năng 500 tasks:**
  - API đọc dữ liệu 500 tasks: ~0.04 ms (ngưỡng AC < 300 ms).
  - Giao diện render 500 dòng: ~0.79 ms (ngưỡng AC < 1000 ms).
