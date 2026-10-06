const crypto = require('crypto');

const SESSION_ALGORITHM = 'sha256';
const SESSION_ALGORITHM_NAME = 'HS256';

function getSessionSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET phải được cấu hình trước khi tạo phiên đăng nhập.');
  }
  return process.env.JWT_SECRET;
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

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

function generateSessionToken(payload) {
  const header = encodeBase64Url(JSON.stringify({ alg: SESSION_ALGORITHM_NAME, typ: 'JWT' }));
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac(SESSION_ALGORITHM, getSessionSecret())
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifySessionToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, providedSignature] = parts;
  const expectedSignature = crypto
    .createHmac(SESSION_ALGORITHM, getSessionSecret())
    .update(`${header}.${body}`)
    .digest('base64url');
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (providedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(body));
  } catch {
    return null;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  verifySessionToken
};
