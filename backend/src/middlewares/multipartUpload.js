const fs = require('fs');
const path = require('path');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILES = 10;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif'
]);

const UPLOAD_DIR = path.join(__dirname, '../../uploads/diaries');

// Đảm bảo thư mục upload tồn tại
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/**
 * Sinh tên file ngẫu nhiên an toàn, ngăn chặn path traversal
 */
function generateSafeFilename(projectId, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.jpg';
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 10);
  const safePId = Number.isInteger(Number(projectId)) ? Number(projectId) : 'proj';
  return `diary_${safePId}_${timestamp}_${randomSuffix}${safeExt}`;
}

/**
 * Phân tích header Content-Type multipart boundary
 */
function getBoundary(contentType) {
  if (!contentType) return null;
  const match = contentType.match(/boundary=([^;]+)/i);
  if (!match) return null;
  let boundary = match[1].trim();
  if (boundary.startsWith('"') && boundary.endsWith('"')) {
    boundary = boundary.slice(1, -1);
  }
  return boundary;
}

/**
 * Parser thủ công RFC 7578 Multipart/Form-Data sử dụng native Buffer
 * Không phụ thuộc thư viện ngoài, tối ưu và kiểm soát 100% dung lượng / MIME.
 */
function parseMultipartBuffer(buffer, boundary, projectId) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const endBoundaryBuffer = Buffer.from(`--${boundary}--`);

  const fields = {};
  const files = [];

  let start = 0;

  while (start < buffer.length) {
    const nextBoundary = buffer.indexOf(boundaryBuffer, start);
    if (nextBoundary === -1) break;

    // Tìm ranh giới kết thúc part
    const partStart = nextBoundary + boundaryBuffer.length;
    let partEnd = buffer.indexOf(boundaryBuffer, partStart);
    if (partEnd === -1) {
      const isEnd = buffer.indexOf(endBoundaryBuffer, start);
      if (isEnd !== -1) break;
      partEnd = buffer.length;
    }

    const partBuffer = buffer.subarray(partStart, partEnd);
    start = partEnd;

    // Tách header và body của part (ngăn cách bởi \r\n\r\n)
    const headerSeparator = Buffer.from('\r\n\r\n');
    const headerSepIdx = partBuffer.indexOf(headerSeparator);
    if (headerSepIdx === -1) continue;

    const rawHeaders = partBuffer.subarray(0, headerSepIdx).toString('utf8');
    let partData = partBuffer.subarray(headerSepIdx + headerSeparator.length);

    // Cắt bỏ trailing \r\n ở cuối data nếu có
    if (partData.length >= 2 && partData[partData.length - 2] === 13 && partData[partData.length - 1] === 10) {
      partData = partData.subarray(0, partData.length - 2);
    }

    // Đọc Content-Disposition
    const dispositionMatch = rawHeaders.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    if (!dispositionMatch) continue;

    const fieldName = dispositionMatch[1];
    const filename = dispositionMatch[2];

    if (filename !== undefined && filename !== '') {
      // Đây là file upload
      const contentTypeMatch = rawHeaders.match(/Content-Type:\s*([^\r\n;]+)/i);
      const mimeType = contentTypeMatch ? contentTypeMatch[1].trim().toLowerCase() : 'application/octet-stream';

      // Kiểm tra rỗng
      if (partData.length === 0) continue;

      // Kiểm tra kích thước
      if (partData.length > MAX_FILE_SIZE) {
        const err = new Error(`File "${filename}" vượt quá kích thước cho phép tối đa 5MB (${(partData.length / 1024 / 1024).toFixed(1)}MB)`);
        err.status = 400;
        throw err;
      }

      // Kiểm tra MIME Type
      const ext = path.extname(filename).toLowerCase();
      if (!ALLOWED_MIME_TYPES.has(mimeType) && !ALLOWED_EXTENSIONS.has(ext)) {
        const err = new Error(`Định dạng file "${filename}" không được hỗ trợ (${mimeType}). Chỉ chấp nhận ảnh: JPG, PNG, WEBP, GIF`);
        err.status = 400;
        throw err;
      }

      // Giới hạn số lượng ảnh
      if (files.length >= MAX_FILES) {
        const err = new Error(`Số lượng ảnh đính kèm vượt quá giới hạn tối đa ${MAX_FILES} ảnh/lần`);
        err.status = 400;
        throw err;
      }

      ensureUploadDir();
      const safeFilename = generateSafeFilename(projectId, filename);
      const targetPath = path.join(UPLOAD_DIR, safeFilename);
      const tempPath = `${targetPath}.part`;

      try {
        fs.writeFileSync(tempPath, partData);
        fs.renameSync(tempPath, targetPath);
      } catch (writeErr) {
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch (_) {}
        }
        throw writeErr;
      }

      files.push({
        fieldname: fieldName,
        originalname: filename,
        originalName: filename,
        filename: safeFilename,
        path: targetPath,
        size: partData.length,
        mimetype: mimeType,
        mimeType: mimeType,
        url: `/uploads/diaries/${safeFilename}`,
        data: partData
      });
    } else {
      // Đây là regular text field
      const value = partData.toString('utf8');
      fields[fieldName] = value;
    }
  }

  return { fields, files };
}

/**
 * Middleware express xử lý multipart/form-data và JSON fallback
 */
function handleMultipartUpload(req, res, next) {
  const contentType = req.headers['content-type'] || '';

  if (contentType.toLowerCase().includes('multipart/form-data')) {
    const boundary = getBoundary(contentType);
    if (!boundary) {
      return res.status(400).json({
        success: false,
        message: 'Yêu cầu multipart/form-data không chứa boundary hợp lệ'
      });
    }

    const chunks = [];
    let totalSize = 0;
    const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB toàn bộ request

    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > MAX_TOTAL_SIZE) {
        req.destroy(new Error('Dung lượng toàn bộ request vượt quá giới hạn 50MB'));
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const fullBuffer = Buffer.concat(chunks);
        const projectId = req.params?.projectId || req.body?.project_id || 1;
        const { fields, files } = parseMultipartBuffer(fullBuffer, boundary, projectId);

        // Parse các trường dạng JSON nếu có (ví dụ items: '[{...}]')
        if (fields.items && typeof fields.items === 'string') {
          try {
            fields.items = JSON.parse(fields.items);
          } catch (e) {}
        }

        req.body = { ...req.body, ...fields };
        req.files = files;
        next();
      } catch (err) {
        return res.status(err.status || 400).json({
          success: false,
          message: err.message || 'Lỗi khi giải mã multipart/form-data'
        });
      }
    });

    req.on('error', (err) => {
      res.status(400).json({ success: false, message: err.message });
    });
  } else {
    // Không phải multipart (ví dụ application/json)
    // Nếu có req.body.photos dạng Base64 thì xử lý lưu ảnh
    req.files = req.files || [];
    if (Array.isArray(req.body?.photos)) {
      try {
        ensureUploadDir();
        const projectId = req.params?.projectId || req.body?.project_id || 1;
        req.body.photos.forEach((photoObj) => {
          if (photoObj && photoObj.data && typeof photoObj.data === 'string') {
            const matches = photoObj.data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            const mimeType = matches ? matches[1] : (photoObj.mimetype || 'image/jpeg');
            const base64Data = matches ? matches[2] : photoObj.data;
            const buffer = Buffer.from(base64Data, 'base64');

            if (buffer.length > MAX_FILE_SIZE) {
              const err = new Error(`Ảnh "${photoObj.filename || 'photo'}" vượt quá kích thước 5MB`);
              err.status = 400;
              throw err;
            }

            const safeFilename = generateSafeFilename(projectId, photoObj.filename || 'photo.jpg');
            const targetPath = path.join(UPLOAD_DIR, safeFilename);
            const tempPath = `${targetPath}.part`;
            try {
              fs.writeFileSync(tempPath, buffer);
              fs.renameSync(tempPath, targetPath);
            } catch (writeErr) {
              if (fs.existsSync(tempPath)) {
                try { fs.unlinkSync(tempPath); } catch (_) {}
              }
              throw writeErr;
            }

            req.files.push({
              fieldname: 'photos',
              originalname: photoObj.filename || 'photo.jpg',
              filename: safeFilename,
              path: targetPath,
              size: buffer.length,
              mimetype: mimeType,
              caption: photoObj.caption || '',
              url: `/uploads/diaries/${safeFilename}`
            });
          }
        });
      } catch (err) {
        return res.status(err.status || 400).json({
          success: false,
          message: err.message || 'Lỗi khi xử lý ảnh Base64'
        });
      }
    }
    next();
  }
}

function validateUploadedFile({ originalName, mimeType, size }) {
  if (size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File "${originalName}" vượt quá dung lượng cho phép tối đa 5MB`
    };
  }
  const ext = path.extname(originalName || '').toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType) && !ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Định dạng file "${originalName}" không được hỗ trợ (${mimeType}). Chỉ chấp nhận định dạng ảnh: JPG, PNG, WEBP, GIF`
    };
  }
  return { valid: true };
}

module.exports = {
  handleMultipartUpload,
  parseMultipartBuffer,
  generateSafeFilename,
  generateSafeFileName: generateSafeFilename,
  validateUploadedFile,
  MAX_FILE_SIZE,
  MAX_FILES,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  UPLOAD_DIR
};
