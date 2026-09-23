# Quản Lý Thi Công

## Khởi chạy hệ thống bằng Docker Compose (Khuyến nghị)
1. Khởi động toàn bộ dịch vụ (Backend, Frontend, Database):
```bash
docker-compose up -d --build
http://localhost:8080
http://localhost:5000/api/health
http://localhost:5000/api/db-check
