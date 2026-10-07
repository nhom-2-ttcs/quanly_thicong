const { createBackup } = require('../src/services/backupService');

(async () => {
  try {
    console.log('====================================================');
    console.log('📌 LỆNH SAO LƯU CƠ SỞ DỮ LIỆU [T-46 / S-20]');
    console.log('====================================================');
    const result = await createBackup();
    console.log(`✅ Sao lưu hoàn tất! Tệp sao lưu: ${result.filename}`);
    console.log(`📁 Đường dẫn: ${result.filePath}`);
    console.log(`📊 Kích thước: ${result.fileSizeFormatted}`);
    if (result.removedFiles && result.removedFiles.length > 0) {
      console.log(`🧹 Đã dọn dẹp các bản sao lưu cũ hơn 7 ngày: ${result.removedFiles.join(', ')}`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`❌ SAO LƯU THẤT BẠI: ${err.message}`);
    process.exit(1);
  }
})();
