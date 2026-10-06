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

Phương pháp này sẽ khởi chạy 3 container: CSDL MySQL, Backend Node.js (cổng 5000) và Frontend Nginx (cổng 8080 có Reverse Proxy):

1. **Khởi động hệ thống:**
   ```bash
   # Nếu đã chạy phiên bản cũ trước đó, hãy tắt trước:
   docker-compose down

   # Build và khởi chạy ngầm toàn bộ dịch vụ:
   docker-compose up -d --build
   ```

2. **Truy cập ứng dụng:**
   * **Truy cập trên máy chạy:**
     * Màn hình Đăng nhập: [http://localhost:8080/login.html](http://localhost:8080/login.html) hoặc [http://localhost:5000/login.html](http://localhost:5000/login.html)
     * Màn hình Đăng ký tài khoản: [http://localhost:8080/register.html](http://localhost:8080/register.html)
     * Kiểm tra trạng thái Backend: [http://localhost:5000/api/health](http://localhost:5000/api/health)
   * **Truy cập từ máy khác trong cùng mạng LAN / Wi-Fi:**
     * Lấy địa chỉ IP của máy chủ bằng lệnh `ipconfig` (Windows) hoặc `ifconfig` (Linux/Mac) (ví dụ: `192.168.153.133`).
     * Mở trình duyệt trên máy khác và truy cập:
       * Đăng ký: `http://<IP_MÁY_CHỦ>:8080/register.html`
       * Đăng nhập: `http://<IP_MÁY_CHỦ>:8080/login.html`

> 💡 **Lưu ý tường lửa (Firewall):** Nếu máy khác không mở được web, hãy đảm bảo Windows Firewall đã cho phép cổng `8080` và `5000`.

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

## 📋 Danh Sách 6 Vai Trò Thi Công Đã Seed (SCRUM-29 / T-04)

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
* **Dự phòng kép API (Smart Fetch):** Tự động chuyển đổi giữa cổng 8080 (Nginx Proxy) và cổng 5000 (Backend Direct), đảm bảo ứng dụng không bao giờ bị lỗi `Unexpected token '<'` khi chạy trên mạng LAN.

## Quyết định kỹ thuật: Lựa chọn giải pháp vẽ cho sơ đồ tiến độ S-13 (T-29)

1. Thử nghiệm đánh giá trên 500 thanh công việc:
- Canvas: Tốc độ vẽ nhanh (~45ms) nhưng việc bắt sự kiện bấm, chạm, hiển thị chú giải và xử lý cố định cột tên công việc khi cuộn hai chiều rất phức tạp.
- SVG: Thời gian hiển thị lần đầu khoảng 80ms (đạt yêu cầu dưới 3 giây), đạt 60 khung hình/giây khi cuộn ngang và dọc trên điện thoại tầm trung, dễ dàng tùy biến giao diện và tương tác.

2. Kết luận lựa chọn:
Nhóm quyết định chọn SVG tự vẽ, không dùng thư viện Gantt có sẵn, nhằm đáp ứng đầy đủ yêu cầu phi chức năng và làm nền tảng cho việc hiển thị đường găng và kế hoạch gốc sau này.

---

## 💾 Khôi phục khi mất dữ liệu (Nightly DB Backup & Data Restore - S-20, T-46, T-47)

Hệ thống cung cấp cơ chế sao lưu tự động hằng đêm và khôi phục dữ liệu toàn diện khi xảy ra sự cố mất mát thông tin.

### 1. Cơ Chế Sao Lưu Tự Động Hằng Đêm (Nightly Backup)
* **Thời gian thực hiện:** Hệ thống tự động kích hoạt tiến trình sao lưu lúc **00:00:00 hằng đêm**.
* **Vị trí lưu trữ ngoài container (NFR):** Các tệp `.sql` được lưu trữ tại thư mục volume bên ngoài container (`./backups`) để tránh mất mát dữ liệu khi hỏng ổ đĩa container MySQL.
* **Định dạng tên tệp:** `backup_quanly_thicong_YYYYMMDD_HHmmss.sql` (Tuân thủ NFR: Tuyệt đối **không chứa mật khẩu** trong tên tệp hoặc nhật ký).
* **Quản lý thời hạn (Retention Policy - NFR):** Tự động dọn dẹp các tệp cũ, **chỉ giữ lại 7 bản sao lưu mới nhất**, xóa các bản cũ hơn ngay trong cùng lệnh/tiến trình sao lưu.
* **Ghi nhật ký (Non-silent logging):** Ghi rõ thời gian thực hiện, tên tệp, kích thước tệp (bytes/KB) và số lượng bản ghi trên từng bảng. Nếu thất bại, ghi log lỗi chi tiết và không im lặng.

### 2. Hướng Dẫn Thực Hiện Lệnh Sao Lưu & Khôi Phục Thủ Công

#### A. Thực hiện Sao lưu thủ công:
```bash
# Trong thư mục backend:
npm run backup

# Hoặc chạy trực tiếp kịch bản CLI:
node scripts/backup.js

# Hoặc gửi HTTP POST request đến API backend:
curl -X POST http://localhost:5000/api/backup/run
```

#### B. Khôi phục dữ liệu từ bản sao lưu qua đêm vào cơ sở dữ liệu trống:
```bash
# Khôi phục từ bản sao lưu mới nhất:
npm run restore

# Hoặc chỉ định rõ tệp sao lưu cần khôi phục:
node scripts/restore.js backups/backup_quanly_thicong_20261006_194838.sql

# Hoặc qua HTTP API:
curl -X POST http://localhost:5000/api/backup/restore -H "Content-Type: application/json" -d "{\"filename\": \"backup_quanly_thicong_20261006_194838.sql\"}"
```

#### C. Kiểm tra số lượng bản ghi sau khôi phục:
Sau khi kịch bản khôi phục chạy hoàn tất, hệ thống tự động kiểm đếm và in ra danh sách số bản ghi trên từng bảng (`users`, `roles`,...) đảm bảo số lượng bản ghi khớp 100% với thời điểm sao lưu.

#### D. Chạy bộ kiểm thử tự động cho tính năng Sao lưu & Khôi phục:
```bash
cd backend
npm test
```

