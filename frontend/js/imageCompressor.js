(function (root, factory) {
  'use strict';

  const compressor = factory(root);
  root.ImageCompressor = compressor;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = compressor;
  }
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const ONE_MEGABYTE = 1024 * 1024;

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = root.URL.createObjectURL(file);
      const image = new root.Image();

      image.onload = () => {
        root.URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        root.URL.revokeObjectURL(objectUrl);
        reject(new Error('Không thể đọc ảnh đã chọn.'));
      };
      image.src = objectUrl;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Trình duyệt không thể mã hóa ảnh.'));
        }
      }, type, quality);
    });
  }

  function createThumbnail(image, type) {
    const size = 200;
    const canvas = root.document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');
    }

    canvas.width = size;
    canvas.height = size;

    const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - cropSize) / 2;
    const sourceY = (image.naturalHeight - cropSize) / 2;
    context.drawImage(
      image,
      sourceX,
      sourceY,
      cropSize,
      cropSize,
      0,
      0,
      size,
      size
    );

    return canvasToBlob(canvas, type, 0.85);
  }

  function makeFile(blob, sourceFile, type) {
    const extension = type === 'image/webp'
      ? 'webp'
      : type === 'image/png'
        ? 'png'
        : 'jpg';
    const baseName = sourceFile.name.replace(/\.[^.]+$/, '') || 'image';

    return new root.File(
      [blob],
      `${baseName}.${extension}`,
      { type, lastModified: sourceFile.lastModified }
    );
  }

  async function compressImage(file, options) {
    if (!file || typeof file.size !== 'number' || !/^image\//i.test(file.type)) {
      throw new TypeError('Vui lòng chọn một tệp ảnh hợp lệ.');
    }

    const settings = Object.assign({
      maxBytes: ONE_MEGABYTE - 1,
      maxDimension: 2560
    }, options || {});

    if (!Number.isInteger(settings.maxBytes) || settings.maxBytes < 1) {
      throw new RangeError('maxBytes phải là số nguyên dương.');
    }
    if (!Number.isInteger(settings.maxDimension) || settings.maxDimension < 1) {
      throw new RangeError('maxDimension phải là số nguyên dương.');
    }

    const image = await loadImage(file);
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error('Ảnh không có kích thước hợp lệ.');
    }

    const outputType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    const canvas = root.document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');
    }

    const initialScale = Math.min(
      1,
      settings.maxDimension / Math.max(image.naturalWidth, image.naturalHeight)
    );
    let scale = initialScale;

    for (let dimensionAttempt = 0; dimensionAttempt < 18; dimensionAttempt += 1) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      for (let qualityAttempt = 0; qualityAttempt < 6; qualityAttempt += 1) {
        const quality = 0.92 - qualityAttempt * 0.1;
        const blob = await canvasToBlob(canvas, outputType, quality);
        if (blob.size <= settings.maxBytes) {
          const thumbnailBlob = await createThumbnail(image, outputType);
          return {
            compressedFile: makeFile(blob, file, blob.type || outputType),
            thumbnailBlob,
            width: canvas.width,
            height: canvas.height
          };
        }
      }

      scale *= 0.8;
    }

    throw new Error(
      `Không thể nén ảnh xuống dưới ${settings.maxBytes} byte mà vẫn giữ kích thước sử dụng được.`
    );
  }

  return { compressImage };
}));
