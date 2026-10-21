# 📖 HƯỚNG DẪN KHỞI CHẠY DỰ ÁN QUẢN LÝ THI CÔNG

> **Hệ thống điều hành thi công công trình xây dựng (quanly_thicong)**  
> **Kho lưu trữ:** [https://github.com/nhom-2-ttcs/quanly_thicong.git](https://github.com/nhom-2-ttcs/quanly_thicong.git)

---

## 📌 1. Yêu Cầu Môi Trường (Prerequisites)

* **Node.js**: Phiên bản 18.x trở lên (khuyên dùng Node.js 20 hoặc 22 LTS).
* **NPM**: Đi kèm với Node.js.
* **Hệ điều hành**: Windows, macOS, hoặc Linux.
* **Docker & Docker Compose** *(Tùy chọn)*: Chỉ cần nếu muốn chạy qua container với MySQL và Nginx.

---

## 🚀 2. Cách Khởi Chạy Nhanh Nhất (Node.js Trực Tiếp - Khuyên Dùng)

Phương pháp này không yêu cầu cài đặt Docker hay cấu hình MySQL phức tạp. Máy chủ backend Node.js sẽ tự động phục vụ cả API và toàn bộ giao diện web frontend, kèm theo cơ chế lưu trữ dữ liệu thông minh trong bộ nhớ (In-Memory Engine) với tốc độ phản hồi cực nhanh (0.1ms).

### Bước 1: Mở Terminal tại thư mục dự án

```bash
cd backend
```

### Bước 2: Cài đặt các thư viện cần thiết (nếu là lần đầu)

```bash
npm install
```

### Bước 3: Khởi chạy máy chủ

```bash
npm start
```
*(Hoặc chạy lệnh: `node server.js`)*

Sau khi khởi chạy thành công, terminal sẽ hiển thị thông báo:
```text
===================================================
🚀 Backend Quản lý thi công đang chạy tại port 5000
👉 Link giao diện Lịch Làm Việc: http://localhost:5000/calendar.html
👉 Link giao diện đăng nhập: http://localhost:5000/login.html
👉 Link trang chính: http://localhost:5000/index.html
===================================================
```

---

## 🐳 3. Cách Khởi Chạy Bằng Docker Compose (Môi Trường Staging)

Phương pháp này sẽ khởi chạy 3 container độc lập:
1. **`mysql`**: CSDL MySQL (Cổng `3306`)
2. **`backend`**: Node.js Express API (Cổng `5001`)
3. **`frontend`**: Nginx Web Server (Cổng `8081`)

### Lệnh khởi chạy:

```bash
# Tắt container cũ nếu có
docker-compose down

# Build và khởi chạy ngầm toàn bộ dịch vụ
docker-compose up -d --build
```

---

## 🌐 4. Danh Sách Các Đường Dẫn Truy Cập Giao Diện (URLs)

### Khi chạy theo Cách 1 (Node.js - Cổng 5000):

| Phân hệ / Chức năng | Đường dẫn (URL) | Mô tả |
| :--- | :--- | :--- |
| 🔑 **Đăng nhập** | [http://localhost:5000/login.html](http://localhost:5000/login.html) | Đăng nhập tài khoản điều hành (có nút tự điền nhanh tài khoản mẫu) |
| 📝 **Đăng ký** | [http://localhost:5000/register.html](http://localhost:5000/register.html) | Đăng ký tài khoản mới với các vai trò thi công |
| 🏠 **Bảng điều khiển chính** | [http://localhost:5000/index.html](http://localhost:5000/index.html) | Tổng quan, Dự án & Quản lý thành viên (S-28), Ma trận phân quyền |
| 🌳 **Cơ cấu WBS** | [http://localhost:5000/wbs.html](http://localhost:5000/wbs.html) | Phân rã cây đa tầng hạng mục công trình, khối lượng dự toán |
| ⚡ **Tiến độ CPM & Đường găng** | [http://localhost:5000/schedule.html](http://localhost:5000/schedule.html) | Thuật toán CPM tính ES, EF, LS, LF, Float và xác định đường găng |
| 📊 **Sơ đồ Gantt** | [http://localhost:5000/gantt.html](http://localhost:5000/gantt.html) | Trực quan hóa tiến độ thi công, đường găng màu đỏ, so sánh Baseline |
| 👷‍♂️ **Đội thi công & Giao việc** | [http://localhost:5000/teams.html](http://localhost:5000/teams.html) | Giao việc cho đội thi công, kiểm soát định mức và cảnh báo quá tải (S-25) |
| 📅 **Lịch làm việc & Ngày nghỉ** | [http://localhost:5000/calendar.html](http://localhost:5000/calendar.html) | Cấu hình chế độ 5/6 ngày, khai báo ngày lễ trừ trùng (S-17) |
| 🌧️ **Nhật ký & Ngày mưa** | [http://localhost:5000/diary.html](http://localhost:5000/diary.html) | Ghi nhật ký thi công, đính kèm ảnh hiện trường, khóa sổ nhật ký (S-24) |
| 📋 **Nghiệm thu khối lượng đợt** | [http://localhost:5000/acceptance.html](http://localhost:5000/acceptance.html) | Lập phiếu nghiệm thu theo đợt, tính khối lượng phát sinh (S-36) |
| 💰 **Đề nghị thanh toán** | [http://localhost:5000/payment.html](http://localhost:5000/payment.html) | Sinh đề nghị thanh toán từ phiếu nghiệm thu, khấu trừ tiền tạm giữ (S-43, S-45) |
| 📊 **So sánh dự toán & Cảnh báo** | [http://localhost:5000/budget.html](http://localhost:5000/budget.html) | So sánh dự toán, thực chi theo cây WBS, cảnh báo chi phí >80% & khối lượng <80% (S-48 / SCRUM-224) |
| 🩺 **Kiểm tra trạng thái API** | [http://localhost:5000/api/health](http://localhost:5000/api/health) | API kiểm tra sức khỏe máy chủ backend |

*(Lưu ý: Nếu chạy bằng Docker Compose, đổi cổng `5000` thành `8081` đối với frontend và `5001` đối với backend)*.

---

## 🔑 5. Danh Sách Tài Khoản Thử Nghiệm (Test Accounts)

Trên form đăng nhập `login.html` đã tích hợp sẵn **các nút bấm để tự động điền nhanh**:

| STT | Họ và Tên | Email / Tên đăng nhập | Mật khẩu mẫu | Vai trò trong hệ thống |
| :---: | :--- | :--- | :--- | :--- |
| **1** | **Nguyễn Quản Trị** | `admin@thicong.vn` *(hoặc `admin`)* | `Admin@123` *(hoặc `admin`)* | **Quản trị viên hệ thống (Admin)** |
| **2** | **Trần Mạnh Dũng** | `dtc245160020@ictu.edu.vn` | `Dung@123` *(hoặc `dung`)* | **Chỉ huy trưởng / Ban quản lý dự án** |
| **3** | **Người xem dự án** | `viewer@thicong.vn` | `Viewer@123` *(hoặc `viewer`)* | **Người xem (Chỉ đọc)** |

> 💡 **Thành viên được mời vào dự án (S-28):**  
> Khi Ban quản lý gửi lời mời tới email chưa có tài khoản, người được mời chỉ cần truy cập [http://localhost:5000/login.html](http://localhost:5000/login.html), nhập email nhận lời mời và đặt mật khẩu mới ($\ge 6$ ký tự) ở ô mật khẩu để kích hoạt tài khoản ngay.

---

## 🧪 6. Hướng Dẫn Chạy Kiểm Thử Tự Động (Test Suite)

Để xác minh toàn bộ các ca kiểm thử nghiệp vụ của tất cả các Sprint:

```bash
cd backend

# Chạy toàn bộ 195 bài test tự động
npm test

# Chạy kiểm tra cú pháp và code quality
npm run lint
```

---

## 🛠️ 7. Xử Lý Các Sự Cố Thường Gặp (Troubleshooting)

### 1. Cổng 5000 đang bị ứng dụng khác chiếm dụng (Port 5000 in use):
- **Windows (PowerShell):**
  ```powershell
  # Tìm PID của tiến trình chiếm cổng 5000
  netstat -ano | findstr :5000
  # Tắt tiến trình (thay PID bằng số tìm được)
  taskkill /PID <PID> /F
  ```
- Hoặc đổi cổng bằng biến môi trường trước khi chạy:
  ```powershell
  $env:PORT=5002; npm start
  ```

### 2. Tài khoản bị tạm khóa 15 phút do nhập sai mật khẩu 5 lần:
- Hệ thống có cơ chế bảo mật tự động khóa tạm tài khoản khi sai liên tiếp 5 lần.
- **Cách mở khóa nhanh trong môi trường phát triển/kiểm thử:**  
  Trên giao diện `login.html`, bấm vào nút **"🔄 Reset bộ đếm thử nghiệm"** ở cuối form để mở khóa ngay lập tức.

### 3. Kết nối CSDL MySQL không khả dụng:
- Nếu máy tính chưa khởi động MySQL Server, backend sẽ tự động chuyển sang chế độ **Standalone Mode (In-Memory Engine)**. Mọi tính năng đăng nhập, WBS, CPM, Gantt, Lịch làm việc và Quản lý thành viên vẫn hoạt động bình thường và ổn định.
