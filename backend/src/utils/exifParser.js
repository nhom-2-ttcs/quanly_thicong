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

module.exports = {
  parseExifMetadata,
  formatExifDate
};
