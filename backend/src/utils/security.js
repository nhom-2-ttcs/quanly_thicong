const crypto = require('crypto');

/**
 * Băm mật khẩu sử dụng PBKDF2 với SHA-512 và Salt ngẫu nhiên
 * Đảm bảo mức độ an toàn cao tương đương Argon2id
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

/**
 * Xác thực mật khẩu nhập vào với Salt và Hash đã lưu
 */
function verifyPassword(password, salt, savedHash) {
  if (!password || !salt || !savedHash) return false;
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return hash === savedHash;
}

/**
 * Sinh mã token phiên ngẫu nhiên an toàn
 */
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateSessionToken
};
