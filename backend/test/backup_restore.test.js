const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  getBackupDir,
  getTimestampString,
  cleanOldBackups,
  createBackup,
  restoreBackup,
  getBackupList
} = require('../src/services/backupService');

// Thư mục lưu trữ sao lưu tạm thời dành riêng cho test runner
const TEST_BACKUP_DIR = path.join(__dirname, 'temp_backups');

function setupTestDir() {
  if (fs.existsSync(TEST_BACKUP_DIR)) {
    fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_BACKUP_DIR, { recursive: true });
}

function cleanupTestDir() {
  if (fs.existsSync(TEST_BACKUP_DIR)) {
    fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
  }
}

test('S-20 AC1 & T-46 AC: Tạo tệp sao lưu mới kèm theo ngày trong tên và ghi log kích thước', async () => {
  setupTestDir();
  try {
    const result = await createBackup({ backupDir: TEST_BACKUP_DIR });

    assert.ok(result.success, 'Quá trình sao lưu phải thành công');
    assert.ok(fs.existsSync(result.filePath), 'Tệp sao lưu SQL phải được sinh ra trên đĩa');
    
    // Kiểm tra tên tệp có chứa định dạng ngày YYYYMMDD_HHmmss
    const datePattern = /backup_quanly_thicong_\d{8}_\d{6}\.sql/;
    assert.match(result.filename, datePattern, 'Tên tệp phải có ngày tháng năm và giờ phút giây');

    // Kiểm tra kích thước và thời gian ghi log
    assert.ok(result.fileSize > 0, 'Kích thước tệp sao lưu phải lớn hơn 0');
    assert.ok(result.timestamp, 'Phải ghi nhận thời gian sao lưu');
  } finally {
    cleanupTestDir();
  }
});

test('S-20 AC4 & T-46 NFR: Chỉ giữ tối đa 7 bản sao lưu gần nhất, xóa các bản cũ hơn', async () => {
  setupTestDir();
  try {
    // Tạo 10 tệp sao lưu giả lập với thời gian mtime khác nhau
    const createdFiles = [];
    for (let i = 1; i <= 10; i++) {
      const fileName = `backup_quanly_thicong_20261001_00000${i < 10 ? '0' + i : i}.sql`;
      const filePath = path.join(TEST_BACKUP_DIR, fileName);
      fs.writeFileSync(filePath, `-- Fake backup content ${i}`, 'utf8');
      
      // Giả lập mtime chênh lệch từng giây
      const pastTime = new Date(2026, 9, 1, 0, 0, i).getTime() / 1000;
      fs.utimesSync(filePath, pastTime, pastTime);
      createdFiles.push(fileName);
    }

    let filesInDir = fs.readdirSync(TEST_BACKUP_DIR);
    assert.strictEqual(filesInDir.length, 10, 'Ban đầu phải có 10 tệp giả lập');

    // Thực hiện dọn dẹp giữ tối đa 7 bản
    const removed = cleanOldBackups(TEST_BACKUP_DIR, 7);

    assert.strictEqual(removed.length, 3, 'Phải xóa chính xác 3 tệp cũ nhất');
    
    filesInDir = fs.readdirSync(TEST_BACKUP_DIR);
    assert.strictEqual(filesInDir.length, 7, 'Thư mục chỉ còn lại đúng 7 bản sao lưu mới nhất');

    // Đảm bảo 3 tệp cũ nhất (i = 1, 2, 3) đã bị xóa
    assert.ok(!fs.existsSync(path.join(TEST_BACKUP_DIR, 'backup_quanly_thicong_20261001_0000001.sql')));
    assert.ok(!fs.existsSync(path.join(TEST_BACKUP_DIR, 'backup_quanly_thicong_20261001_0000002.sql')));
    assert.ok(!fs.existsSync(path.join(TEST_BACKUP_DIR, 'backup_quanly_thicong_20261001_0000003.sql')));
  } finally {
    cleanupTestDir();
  }
});

test('S-20 AC2 & T-47 AC: Khôi phục CSDL trống và kiểm tra khớp số bản ghi trên từng bảng', async () => {
  setupTestDir();
  try {
    // 1. Tạo bản sao lưu
    const backupRes = await createBackup({ backupDir: TEST_BACKUP_DIR });
    assert.ok(backupRes.success);
    assert.ok(backupRes.recordCounts['roles'] > 0, 'Số bản ghi vai trò phải > 0');
    assert.ok(backupRes.recordCounts['users'] > 0, 'Số bản ghi người dùng phải > 0');

    // 2. Chạy kịch bản khôi phục
    const restoreRes = await restoreBackup(backupRes.filePath, { backupDir: TEST_BACKUP_DIR });

    assert.ok(restoreRes.success, 'Khôi phục dữ liệu phải thành công');
    
    // 3. Kiểm tra số bản ghi sau khôi phục bằng chính xác số bản ghi lúc sao lưu
    assert.strictEqual(restoreRes.restoredCounts['roles'], backupRes.recordCounts['roles'], 'Số bản ghi bảng roles phải khớp');
    assert.strictEqual(restoreRes.restoredCounts['users'], backupRes.recordCounts['users'], 'Số bản ghi bảng users phải khớp');
  } finally {
    cleanupTestDir();
  }
});

test('S-20 AC3: Ghi nhật ký lỗi khi sao lưu/khôi phục thất bại (Non-silent failure)', async () => {
  try {
    // Truyền đường dẫn không tồn tại hoặc không có quyền ghi để kích hoạt lỗi
    const invalidPath = path.join(__dirname, 'non_existent_dir_99999/invalid/sub');
    
    await assert.rejects(
      async () => {
        await restoreBackup(invalidPath);
      },
      (err) => {
        assert.ok(err.message.includes('không tồn tại'), 'Thông báo lỗi phải rõ ràng');
        return true;
      },
      'Không được im lặng khi khôi phục từ tệp không tồn tại'
    );
  } catch (e) {
    throw e;
  }
});

test('S-20 & T-47 NFR: Mật khẩu không nằm trong tên file sao lưu và nhật ký', async () => {
  setupTestDir();
  try {
    const backupRes = await createBackup({ backupDir: TEST_BACKUP_DIR });
    const dbPassword = process.env.DB_PASSWORD || 'secret';

    // 1. Tên tệp sao lưu không chứa mật khẩu
    assert.strictEqual(backupRes.filename.includes(dbPassword), false, 'Tên file sao lưu KHÔNG được chứa mật khẩu');

    // 2. Nội dung tệp SQL không chứa mật khẩu kết nối DB dạng thô
    const content = fs.readFileSync(backupRes.filePath, 'utf8');
    assert.strictEqual(content.includes(`DB_PASSWORD=${dbPassword}`), false, 'File sao lưu không chứa mật khẩu kết nối DB');
  } finally {
    cleanupTestDir();
  }
});
