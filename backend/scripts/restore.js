const path = require('path');
const { restoreBackup } = require('../src/services/backupService');

(async () => {
  try {
    console.log('====================================================');
    console.log('📌 KỊCH BẢN KHÔI PHỤC CƠ SỞ DỮ LIỆU [T-47 / S-20]');
    console.log('====================================================');
    
    // Tham số đường dẫn tệp sao lưu (nếu truyền vào)
    const targetFile = process.argv[2] ? path.resolve(process.argv[2]) : null;

    const result = await restoreBackup(targetFile);

    console.log(`✅ Khôi phục CSDL thành công từ tệp: ${result.filename}`);
    console.log(`📊 Số bản ghi trên từng bảng sau khôi phục:`);
    for (const [table, count] of Object.entries(result.restoredCounts)) {
      console.log(`   - Bảng [${table}]: ${count} bản ghi`);
    }
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    console.error(`❌ KHÔI PHỤC CƠ SỞ DỮ LIỆU THẤT BẠI: ${err.message}`);
    process.exit(1);
  }
})();
