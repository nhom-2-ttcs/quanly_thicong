'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const MAX_IMAGE_BYTES = 1024 * 1024 - 1;
const MAX_IMAGES_PER_UPLOAD = 10;
const UPLOAD_DIRECTORY = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'uploads',
  'journal'
);
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

fs.mkdirSync(UPLOAD_DIRECTORY, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, UPLOAD_DIRECTORY),
  filename: (req, file, callback) => {
    const extensionByMime = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp'
    };
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extensionByMime[file.mimetype]}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: MAX_IMAGES_PER_UPLOAD
  },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      const error = new Error('Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.');
      error.code = 'LIMIT_UNEXPECTED_FILE_TYPE';
      callback(error);
      return;
    }
    callback(null, true);
  }
});

const uploadJournalImages = upload.array('images', MAX_IMAGES_PER_UPLOAD);

function saveJournalImages(req, res) {
  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length === 0) {
    return res.status(400).json({
      message: 'Vui lòng gửi ít nhất một ảnh trong trường "images".'
    });
  }

  return res.status(201).json({
    message: 'Ảnh nhật ký đã được tải lên.',
    images: files.map(file => ({
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      url: `/uploads/journal/${encodeURIComponent(file.filename)}`
    }))
  });
}

module.exports = {
  uploadJournalImages,
  saveJournalImages,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_UPLOAD,
  UPLOAD_DIRECTORY
};
