/**
 * Module trích xuất siêu dữ liệu EXIF (S-40 / SCRUM-194 / T-85)
 * Hỗ trợ trích xuất thời điểm chụp (taken_at) và toạ độ GPS (latitude, longitude)
 * Hoàn toàn thuần JavaScript, an toàn tuyệt đối, không crash khi gặp ảnh không có EXIF
 */

function parseExifMetadata(buffer) {
  const result = {
    has_metadata: false,
    taken_at: null,
    latitude: null,
    longitude: null,
    altitude: null,
    camera_make: null,
    camera_model: null,
    raw_metadata: null
  };

  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 32) {
    return result;
  }

  // 1. Kiểm tra header JPEG (SOI: 0xFFD8)
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
    return result;
  }

  try {
    let offset = 2;
    const length = buffer.length;

    while (offset < length - 4) {
      if (buffer[offset] !== 0xFF) {
        offset++;
        continue;
      }

      const marker = buffer[offset + 1];

      // Đánh dấu kết thúc header hoặc bắt đầu dữ liệu nén ảnh (SOS: 0xFFDA)
      if (marker === 0xDA || marker === 0xD9) {
        break;
      }

      const blockLength = buffer.readUInt16BE(offset + 2);
      if (blockLength < 2 || offset + 2 + blockLength > length) {
        break;
      }

      // Marker APP1 (0xFFE1) chứa thông tin EXIF
      if (marker === 0xE1) {
        const exifHeader = buffer.slice(offset + 4, offset + 10);
        if (exifHeader.toString('ascii', 0, 4) === 'Exif' && exifHeader[4] === 0x00 && exifHeader[5] === 0x00) {
          const tiffOffset = offset + 10;
          parseTiff(buffer, tiffOffset, result);
          break;
        }
      }

      offset += 2 + blockLength;
    }
  } catch (err) {
    // Nếu ảnh có header lỗi, trả về kết quả an toàn không metadata
  }

  if (result.taken_at || (result.latitude !== null && result.longitude !== null)) {
    result.has_metadata = true;
  }

  // Trích xuất kích thước ảnh (width, height) từ JPEG
  extractJpegDimensions(buffer, result);

  return result;
}

function parseTiff(buffer, tiffOffset, result) {
  if (tiffOffset + 8 > buffer.length) return;

  const byteOrderStr = buffer.toString('ascii', tiffOffset, tiffOffset + 2);
  const isLittleEndian = byteOrderStr === 'II'; // 'II' = Intel, 'MM' = Motorola
  if (!isLittleEndian && byteOrderStr !== 'MM') return;

  const readU16 = (o) => isLittleEndian ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o);
  const readU32 = (o) => isLittleEndian ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o);

  const fortyTwo = readU16(tiffOffset + 2);
  if (fortyTwo !== 42) return;

  const ifd0Offset = readU32(tiffOffset + 4);
  let currentIfd = tiffOffset + ifd0Offset;

  let exifSubIfdOffset = null;
  let gpsSubIfdOffset = null;

  // Đọc IFD0
  if (currentIfd + 2 <= buffer.length) {
    const numEntries = readU16(currentIfd);
    currentIfd += 2;

    for (let i = 0; i < numEntries && currentIfd + 12 <= buffer.length; i++) {
      const tag = readU16(currentIfd);
      const type = readU16(currentIfd + 2);
      const count = readU32(currentIfd + 4);
      const valueOffset = currentIfd + 8;

      if (tag === 0x010F) { // Make
        result.camera_make = readString(buffer, tiffOffset, valueOffset, count, readU32);
      } else if (tag === 0x0110) { // Model
        result.camera_model = readString(buffer, tiffOffset, valueOffset, count, readU32);
      } else if (tag === 0x0132) { // DateTime (ModifyDate)
        const dtStr = readString(buffer, tiffOffset, valueOffset, count, readU32);
        if (dtStr && !result.taken_at) {
          result.taken_at = formatExifDate(dtStr);
        }
      } else if (tag === 0x8769) { // ExifSubIFD Pointer
        exifSubIfdOffset = tiffOffset + readU32(valueOffset);
      } else if (tag === 0x8825) { // GPSInfo Pointer
        gpsSubIfdOffset = tiffOffset + readU32(valueOffset);
      }

      currentIfd += 12;
    }
  }

  // Đọc ExifSubIFD (tìm DateTimeOriginal / 0x9003)
  if (exifSubIfdOffset && exifSubIfdOffset + 2 <= buffer.length) {
    let subIfd = exifSubIfdOffset;
    const numEntries = readU16(subIfd);
    subIfd += 2;

    for (let i = 0; i < numEntries && subIfd + 12 <= buffer.length; i++) {
      const tag = readU16(subIfd);
      const count = readU32(subIfd + 4);
      const valueOffset = subIfd + 8;

      if (tag === 0x9003 || tag === 0x9004) { // DateTimeOriginal / DateTimeDigitized
        const dtStr = readString(buffer, tiffOffset, valueOffset, count, readU32);
        if (dtStr) {
          result.taken_at = formatExifDate(dtStr);
        }
      }
      subIfd += 12;
    }
  }

  // Đọc GPSInfo IFD (toạ độ latitude, longitude)
  if (gpsSubIfdOffset && gpsSubIfdOffset + 2 <= buffer.length) {
    let gpsIfd = gpsSubIfdOffset;
    const numEntries = readU16(gpsIfd);
    gpsIfd += 2;

    let latRef = 'N';
    let lonRef = 'E';
    let latCoords = null;
    let lonCoords = null;
    let altVal = null;

    for (let i = 0; i < numEntries && gpsIfd + 12 <= buffer.length; i++) {
      const tag = readU16(gpsIfd);
      const count = readU32(gpsIfd + 4);
      const valueOffset = gpsIfd + 8;

      if (tag === 0x0001) { // GPSLatitudeRef
        latRef = buffer.toString('ascii', valueOffset, valueOffset + 1);
      } else if (tag === 0x0002) { // GPSLatitude (3 RATIONALs)
        latCoords = readRationals(buffer, tiffOffset, valueOffset, 3, isLittleEndian, readU32);
      } else if (tag === 0x0003) { // GPSLongitudeRef
        lonRef = buffer.toString('ascii', valueOffset, valueOffset + 1);
      } else if (tag === 0x0004) { // GPSLongitude (3 RATIONALs)
        lonCoords = readRationals(buffer, tiffOffset, valueOffset, 3, isLittleEndian, readU32);
      } else if (tag === 0x0006) { // GPSAltitude (1 RATIONAL)
        const alts = readRationals(buffer, tiffOffset, valueOffset, 1, isLittleEndian, readU32);
        if (alts && alts.length > 0) altVal = alts[0];
      }

      gpsIfd += 12;
    }

    if (latCoords && latCoords.length === 3) {
      let lat = latCoords[0] + latCoords[1] / 60 + latCoords[2] / 3600;
      if (latRef === 'S') lat = -lat;
      result.latitude = Number(lat.toFixed(7));
    }

    if (lonCoords && lonCoords.length === 3) {
      let lon = lonCoords[0] + lonCoords[1] / 60 + lonCoords[2] / 3600;
      if (lonRef === 'W') lon = -lon;
      result.longitude = Number(lon.toFixed(7));
    }

    if (altVal !== null) {
      result.altitude = Number(altVal.toFixed(2));
    }
  }

  // Raw metadata tóm tắt
  const raw = {};
  if (result.camera_make) raw.make = result.camera_make;
  if (result.camera_model) raw.model = result.camera_model;
  if (result.taken_at) raw.taken_at = result.taken_at;
  if (result.latitude !== null) raw.latitude = result.latitude;
  if (result.longitude !== null) raw.longitude = result.longitude;
  if (result.altitude !== null) raw.altitude = result.altitude;
  result.raw_metadata = Object.keys(raw).length > 0 ? JSON.stringify(raw) : null;
}

function readString(buffer, tiffOffset, valueOffset, count, readU32) {
  if (count <= 4) {
    return buffer.toString('ascii', valueOffset, valueOffset + count).replace(/\0+$/, '').trim();
  }
  const realOffset = tiffOffset + readU32(valueOffset);
  if (realOffset + count <= buffer.length) {
    return buffer.toString('ascii', realOffset, realOffset + count).replace(/\0+$/, '').trim();
  }
  return null;
}

function readRationals(buffer, tiffOffset, valueOffset, count, isLittleEndian, readU32) {
  const realOffset = tiffOffset + readU32(valueOffset);
  if (realOffset + count * 8 > buffer.length) return null;

  const result = [];
  for (let i = 0; i < count; i++) {
    const pos = realOffset + i * 8;
    const num = isLittleEndian ? buffer.readUInt32LE(pos) : buffer.readUInt32BE(pos);
    const den = isLittleEndian ? buffer.readUInt32LE(pos + 4) : buffer.readUInt32BE(pos + 4);
    result.push(den === 0 ? 0 : num / den);
  }
  return result;
}

/**
 * Chuyển định dạng EXIF 'YYYY:MM:DD HH:MM:SS' thành ISO Datetime 'YYYY-MM-DD HH:MM:SS'
 */
function formatExifDate(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.match(/^(\d{4})[:/-](\d{2})[:/-](\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
  }
  return null;
}

/**
 * Trích xuất kích thước Width/Height từ JPEG markers (SOF0..SOF2)
 */
function extractJpegDimensions(buffer, targetResult = null) {
  const result = targetResult || {};
  if (!buffer || buffer.length < 10) return result;
  try {
    let offset = 2;
    const len = buffer.length;
    while (offset < len - 8) {
      if (buffer[offset] !== 0xFF) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xDA || marker === 0xD9) break; // SOS / EOI

      const blockLength = buffer.readUInt16BE(offset + 2);
      if (blockLength < 2 || offset + 2 + blockLength > len) break;

      // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
      if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
        result.height = buffer.readUInt16BE(offset + 5);
        result.width = buffer.readUInt16BE(offset + 7);
        if (result.width && result.height) {
          result.aspect_ratio = Number((Math.max(result.width, result.height) / Math.min(result.width, result.height)).toFixed(3));
        }
        break;
      }
      offset += 2 + blockLength;
    }
  } catch (_) {}
  return result;
}

/**
 * Tính khoảng cách trắc địa giữa hai điểm toạ độ (WGS84) theo công thức Haversine (S-41 / SCRUM-170 / T-73)
 * @param {number} lat1 Vĩ độ điểm 1 (độ thập phân)
 * @param {number} lon1 Kinh độ điểm 1 (độ thập phân)
 * @param {number} lat2 Vĩ độ điểm 2 (độ thập phân)
 * @param {number} lon2 Kinh độ điểm 2 (độ thập phân)
 * @returns {number|null} Khoảng cách tính bằng mét, làm tròn 2 chữ số thập phân, hoặc null nếu toạ độ không hợp lệ
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lat1 === undefined || lon1 === null || lon1 === undefined ||
      lat2 === null || lat2 === undefined || lon2 === null || lon2 === undefined) {
    return null;
  }

  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);

  if (isNaN(nLat1) || isNaN(nLon1) || isNaN(nLat2) || isNaN(nLon2)) {
    return null;
  }

  // Toạ độ phải nằm trong giới hạn địa lý hợp lệ
  if (nLat1 < -90 || nLat1 > 90 || nLat2 < -90 || nLat2 > 90 ||
      nLon1 < -180 || nLon1 > 180 || nLon2 < -180 || nLon2 > 180) {
    return null;
  }

  const R = 6371000; // Bán kính trung bình Trái Đất theo WGS84 (mét)
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(nLat2 - nLat1);
  const dLon = toRad(nLon2 - nLon1);
  const phi1 = toRad(nLat1);
  const phi2 = toRad(nLat2);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return Number(distance.toFixed(2));
}

/**
 * SCRUM-E07 / S-42 & S-41: Phát hiện dấu hiệu ảnh chụp lại màn hình, thiếu siêu dữ liệu hoặc ngoài bán kính công trường
 * AC S-42: Ảnh thiếu siêu dữ liệu máy ảnh, có kích thước đúng bằng màn hình điện thoại,
 * hoặc thời điểm chụp cách ngày nghiệm thu quá xa thì bị đánh dấu để người duyệt xem kỹ.
 * AC S-41: Ảnh có tọa độ nằm ngoài bán kính công trường bị đánh dấu nghi vấn và kèm khoảng cách.
 * NFR: Không coi ảnh thiếu GPS là ngoài bán kính; ghi rõ mức độ tin cậy.
 */
function evaluatePhotoSuspicion({
  metadata = null,
  fileName = '',
  width = null,
  height = null,
  inspectionDate = null,
  projectLocation = null
} = {}) {
  const reasons = [];
  const details = [];

  const meta = metadata || {};
  const photoWidth = width || meta.width || null;
  const photoHeight = height || meta.height || null;
  const photoName = String(fileName || '').toLowerCase();

  // 1. Dấu hiệu: Thiếu siêu dữ liệu máy ảnh (Camera Make/Model) hoặc thiếu toàn bộ EXIF
  const hasCameraInfo = Boolean(meta.camera_make || meta.camera_model || meta.make || meta.model);
  if (!hasCameraInfo && !meta.has_metadata) {
    reasons.push('missing_camera_metadata');
    details.push('Ảnh thiếu toàn bộ siêu dữ liệu EXIF máy ảnh');
  } else if (!hasCameraInfo) {
    reasons.push('missing_camera_metadata');
    details.push('Ảnh không có thông tin hãng/kiểu máy ảnh (Make/Model)');
  }

  // 2. Dấu hiệu: Kích thước hoặc tỷ lệ khung hình đúng bằng màn hình điện thoại (Screenshot)
  const PHONE_RESOLUTIONS = [
    [1080, 2400], [1080, 2340], [1080, 2408], [1080, 2460],
    [1170, 2532], [1284, 2778], [1290, 2796], [1179, 2556],
    [390, 844],   [393, 852],   [414, 896],   [430, 932],
    [750, 1334],  [1242, 2688], [1080, 1920], [720, 1600],
    [720, 1560],  [720, 1520],  [1440, 3120], [1440, 3200], [1440, 3088]
  ];

  let isPhoneScreenSize = false;
  if (photoWidth && photoHeight) {
    const minDim = Math.min(photoWidth, photoHeight);
    const maxDim = Math.max(photoWidth, photoHeight);
    isPhoneScreenSize = PHONE_RESOLUTIONS.some(([w, h]) =>
      (minDim === Math.min(w, h) && maxDim === Math.max(w, h))
    );

    const ratio = maxDim / minDim;
    // Tỷ lệ màn hình điện thoại phổ biến: 19.5:9 (~2.167), 20:9 (~2.222), 20.5:9 (~2.278)
    const isScreenRatio = (ratio >= 2.05 && ratio <= 2.35);

    if (isPhoneScreenSize || (isScreenRatio && !hasCameraInfo)) {
      reasons.push('screenshot_detected');
      details.push(`Kích thước ảnh (${photoWidth}x${photoHeight}) hoặc tỷ lệ ${ratio.toFixed(2)}:1 khớp đặc trưng chụp lại màn hình điện thoại`);
    }
  }

  // Kiểm tra tên file có chứa từ khóa chụp màn hình
  const isScreenshotFilename = /(screenshot|screen_shot|screen-shot|capture|chup_man_hinh)/i.test(photoName);
  if (isScreenshotFilename && !reasons.includes('screenshot_detected')) {
    reasons.push('screenshot_detected');
    details.push(`Tên tập tin "${fileName}" chứa dấu hiệu ảnh chụp màn hình`);
  }

  // 3. Dấu hiệu: Thời điểm chụp cách ngày nghiệm thu quá xa (> 30 ngày) hoặc trong tương lai
  if (meta.taken_at) {
    try {
      const takenDate = new Date(meta.taken_at);
      const targetDate = inspectionDate ? new Date(inspectionDate) : new Date();

      if (!isNaN(takenDate.getTime()) && !isNaN(targetDate.getTime())) {
        const diffMs = targetDate.getTime() - takenDate.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays > 30) {
          reasons.push('taken_time_too_far');
          details.push(`Thời điểm chụp ảnh (${meta.taken_at.slice(0, 10)}) cách ngày nghiệm thu (${targetDate.toISOString().slice(0, 10)}) hơn ${diffDays} ngày (> 30 ngày)`);
        } else if (diffDays < -1) {
          reasons.push('taken_time_too_far');
          details.push(`Thời điểm chụp ảnh (${meta.taken_at}) là thời điểm tương lai so với ngày nghiệm thu`);
        }
      }
    } catch (_) {}
  }

  // 4. SCRUM-170 / S-41: Kiểm tra toạ độ ảnh nằm ngoài bán kính công trường
  let distanceToCenter = null;
  const siteLat = projectLocation?.site_latitude ?? projectLocation?.latitude;
  const siteLon = projectLocation?.site_longitude ?? projectLocation?.longitude;
  const siteRadius = projectLocation?.site_radius_meters ?? projectLocation?.radius_meters ?? projectLocation?.radius;

  if (siteLat !== null && siteLat !== undefined &&
      siteLon !== null && siteLon !== undefined &&
      siteRadius !== null && siteRadius !== undefined) {
    const numRadius = Number(siteRadius);
    if (!isNaN(numRadius) && numRadius > 0) {
      if (meta.latitude !== null && meta.latitude !== undefined &&
          meta.longitude !== null && meta.longitude !== undefined) {
        distanceToCenter = calculateHaversineDistance(siteLat, siteLon, meta.latitude, meta.longitude);
        if (distanceToCenter !== null && distanceToCenter > numRadius) {
          reasons.push('outside_site_radius');
          details.push(`Tọa độ chụp (${Number(meta.latitude).toFixed(6)}, ${Number(meta.longitude).toFixed(6)}) cách tâm công trường ${distanceToCenter}m, vượt quá bán kính cho phép (${numRadius}m)`);
        }
      }
    }
  }

  const isSuspicious = reasons.length > 0;
  let confidenceLevel = 'none';

  if (isSuspicious) {
    if (reasons.includes('outside_site_radius') || reasons.length >= 2 || (reasons.includes('screenshot_detected') && reasons.includes('missing_camera_metadata'))) {
      confidenceLevel = 'high';
    } else if (reasons.includes('screenshot_detected') || reasons.includes('taken_time_too_far')) {
      confidenceLevel = 'medium';
    } else {
      confidenceLevel = 'low';
    }
  }

  return {
    is_suspicious: isSuspicious,
    suspicious_reasons: reasons,
    confidence_level: confidenceLevel,
    suspicious_details: details.length > 0 ? details.join('; ') : null,
    distance_to_center_meters: distanceToCenter
  };
}

module.exports = {
  parseExifMetadata,
  formatExifDate,
  extractJpegDimensions,
  calculateHaversineDistance,
  evaluatePhotoSuspicion
};
