/**
 * CẤU HÌNH DANH MỤC THỜI TIẾT VÀ THIẾT BỊ CHO NHẬT KÝ THI CÔNG (S-22 / SCRUM-114)
 * NFR S-22: "Danh sách thiết bị và loại thời tiết là dữ liệu cấu hình, không ghi cứng rải rác"
 */

const DIARY_CONFIG = {
  weather_types: [
    { id: 'sunny', name: 'Nắng tốt', icon: '☀️', is_rain: false, description: 'Trời nắng ráo, điều kiện thi công tốt' },
    { id: 'cloudy', name: 'Nhiều mây', icon: '⛅', is_rain: false, description: 'Nhiều mây, râm mát, thi công bình thường' },
    { id: 'rain_intermittent', name: 'Mưa rải rác', icon: '🌦️', is_rain: true, description: 'Mưa từng đợt, thi công gián đoạn' },
    { id: 'rain_all_day', name: 'Mưa cả ngày', icon: '🌧️', is_rain: true, description: 'Mưa lớn kéo dài cả ngày, tạm dừng việc ngoài trời' }
  ],
  equipment_list: [
    { id: 'excavator', name: 'Máy đào' },
    { id: 'crane', name: 'Cần trục' },
    { id: 'pump', name: 'Máy bơm bê tông' },
    { id: 'concrete_mixer', name: 'Xe bồn trộn bê tông' },
    { id: 'roller', name: 'Xe lu rung' },
    { id: 'generator', name: 'Máy phát điện' },
    { id: 'pile_driver', name: 'Máy ép cọc' }
  ]
};

function getAllowedWeatherConditions() {
  return DIARY_CONFIG.weather_types.map(w => w.id);
}

function isValidWeatherCondition(condition) {
  return getAllowedWeatherConditions().includes(condition);
}

function isRainCondition(condition) {
  const found = DIARY_CONFIG.weather_types.find(w => w.id === condition);
  return found ? Boolean(found.is_rain) : false;
}

module.exports = {
  DIARY_CONFIG,
  getAllowedWeatherConditions,
  isValidWeatherCondition,
  isRainCondition
};
