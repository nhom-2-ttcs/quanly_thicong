# Hệ Thống Quản Lý Thi Công Công Trình (quanly_thicong)

> **Môn học:** Thực tập cơ sở (TTCS) - Nhóm 2  
> **Trường:** Đại học Công nghệ Thông tin & Truyền thông (ICTU) - Thái Nguyên  
> **Nhiệm vụ Sprint S-02:** `[S-02] Cài đặt đăng nhập bằng email, mật khẩu và khoá tạm khi sai nhiều lần` (SCRUM-19)  
> **Người thực hiện:** **Trần Mạnh Dũng** (`TRAN MANH DUNG` - `dtc245160020@ictu.edu.vn`)  

---

## 📌 Các Nhiệm Vụ Hoàn Thành Trong Sprint S-02

### 1. `SCRUM-29 (T-04)`: Bảng `users` và `roles` kèm migration, seed 6 vai trò
Đã thiết kế bảng và seed đủ 6 vai trò thi công xây dựng theo đúng yêu cầu dự án:
1. `admin`: Quản trị viên hệ thống
2. `project_manager`: Chỉ huy trưởng công trình
3. `supervisor`: Kỹ sư giám sát thi công
4. `contractor`: Đội trưởng thi công
5. `accountant`: Kế toán & Quản lý vật tư
6. `client`: Chủ đầu tư

### 2. `SCRUM-30 (T-05)`: Form đăng nhập, tạo phiên, đếm lần sai và khóa 15 phút
Đáp ứng đầy đủ 100% tiêu chí chấp nhận (Acceptance Criteria):
* **Tiêu chí 1:** Đăng nhập đúng email & mật khẩu -> vào màn hình chính và nhìn thấy đúng họ tên của mình.
* **Tiêu chí 2:** Khi nhập sai thông tin -> hiển thị `"Email hoặc mật khẩu không đúng"`, bảo mật tuyệt đối không tiết lộ email có tồn tại hay không.
* **Tiêu chí 3:** Khi nhập sai mật khẩu 5 lần liên tiếp -> lần thứ 6 bị khóa trong 15 phút (có đồng hồ đếm ngược `15:00` thời gian thực).
* **Tiêu chí 4:** Khi đăng xuất -> hủy phiên đăng nhập hoàn toàn và quay lại trang đăng nhập.
* **Tiêu chí 5:** Sau khi đăng xuất -> dùng nút Back (quay lại) của trình duyệt cũng bị chặn và không thể xem màn hình được bảo vệ.
* **Yêu cầu kỹ thuật:** Mật khẩu lưu dưới dạng hash PBKDF2/SHA-512 với Salt ngẫu nhiên, phiên làm việc hết hạn sau 12 giờ không hoạt động, không ghi mật khẩu hay token vào log.

---

## 🚀 Hướng Dẫn Khởi Chạy Và Kiểm Thử

### Cách 1: Khởi chạy bằng Docker Compose (Khuyến nghị)

```bash
docker-compose up -d --build
```
* **Frontend:** [http://localhost:8080](http://localhost:8080)
* **Backend Health Check:** [http://localhost:5000/api/health](http://localhost:5000/api/health)
* **Trang Đăng Nhập:** [http://localhost:5000/login.html](http://localhost:5000/login.html) hoặc qua port 8080.
* **Trang Đăng Ký:** [http://localhost:5000/register.html](http://localhost:5000/register.html)

### Cách 2: Khởi chạy trực tiếp (Development Mode)

1. Cài đặt thư viện:
   ```bash
   cd backend
   npm install
   ```
2. Khởi chạy server:
   ```bash
   node server.js
   ```
3. Truy cập: [http://localhost:5000/login.html](http://localhost:5000/login.html)

---

## 🔑 Tài Khoản Mẫu Để Kiểm Thử Nhanh

| Họ và tên | Email | Mật khẩu | Vai trò |
|---|---|---|---|
| **Trần Mạnh Dũng** | `dtc245160020@ictu.edu.vn` | `Dung@123` | Chỉ huy trưởng công trình |
| **Nguyễn Quản Trị** | `admin@thicong.vn` | `Admin@123` | Quản trị viên hệ thống |
