## Sprint 2: triển khai S-09 lịch muộn và độ trễ

- Story: SCRUM-64 — [S-09] Tính khởi muộn, kết muộn và độ trễ
- Subtask: SCRUM-77 / T-20, SCRUM-78 / T-21
- Base branch: main
- Base commit: ca47393
- Dependency: S-06, S-07, S-08, S-11 already verified in the branch history and merged into the current integration branch.

### Cơ sở toán học

- FS: `startS >= startP + durationP + lag`
- SS: `startS >= startP + lag`
- FF: `startS >= startP + durationP + lag - durationS`
- SF: `startS >= startP + lag - durationS`
- `projectDuration = max(EF)`
- `lateStart = lateFinish - duration`
- `totalFloat = lateStart - earlyStart`
- `isCritical = abs(totalFloat) <= 1e-9`

### Backward pass

Module mới trong `backend/src/algorithms/backwardPass.js` thực hiện duyệt ngược theo thứ tự topo, áp dụng mỗi ràng buộc thành công từ node hiện tại sang successor, và tính `LS/LF/totalFloat/isCritical` cho từng task. Tất cả kết quả đều dựa trên ES/EF đã tính bằng duyệt xuôi, không thay đổi logic S-06/S-07/S-08/S-11.

### File thay đổi

- `backend/src/algorithms/backwardPass.js`
- `backend/test/backwardPass.test.js`
- `backend/test/run.js`
- `backend/package.json`
- `README.md`

### Kiểm thử thực tế

- `npm ci`: PASS
- `npm run lint`: PASS
- `npm test`: PASS

### Dữ liệu tính tay

Mạng chuẩn:

```text
A(3) ─→ B(2) ─→ D(1)
  └──→ C(1) ───┘
```

Kết quả:

- A: ES=0, EF=3, LS=0, LF=3, float=0, critical=true
- B: ES=3, EF=5, LS=3, LF=5, float=0, critical=true
- C: ES=3, EF=4, LS=4, LF=5, float=1, critical=false
- D: ES=5, EF=6, LS=5, LF=6, float=0, critical=true

### Giới hạn còn lại

- GitHub CLI chưa được xác thực trong môi trường hiện tại, nên không thể tạo Draft PR từ CLI ở thời điểm này.
- Docker không có sẵn trên máy này, nên bước `docker compose` chưa được thực hiện.
- Không có secret được ghi vào source, diff, commit hoặc PR body.

### Jira

- SCRUM-64
- SCRUM-77
- SCRUM-78
