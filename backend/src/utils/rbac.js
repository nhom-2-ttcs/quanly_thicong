const { getSession, canUserAccessProject } = require('../models/store');

/**
 * Middleware trích xuất và xác thực token phiên đăng nhập (nếu có)
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : (req.query?.token || null);

  if (!token) {
    req.user = null;
    return next();
  }

  const session = getSession(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.'
    });
  }

  req.user = session;
  next();
}

/**
 * Middleware bắt buộc phải đăng nhập
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Yêu cầu xác thực: Vui lòng đăng nhập để tiếp tục.'
    });
  }
  next();
}

/**
 * Kiểm tra quyền thao tác ghi (POST/PUT/DELETE)
 * Người xem dự án (viewer) tuyệt đối không được tạo, sửa hoặc xóa dữ liệu -> Trả về HTTP 403
 */
function checkViewerForbidden(req, res) {
  const authHeader = req.headers?.['authorization'] || req.headers?.['Authorization'];
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : (req.query?.token || null);

  let user = req.user;
  if (token) {
    const session = getSession(token);
    if (!session) {
      res.status(401).json({
        success: false,
        message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.'
      });
      return true; // đã phản hồi
    }
    user = session;
    req.user = session;
  }

  if (user && (user.role_name === 'viewer' || user.role_id === 7 || user.role === 'viewer')) {
    res.status(403).json({
      success: false,
      message: 'Quyền truy cập bị từ chối: Tài khoản Người xem dự án không được phép tạo, sửa hoặc xóa dữ liệu.'
    });
    return true; // đã phản hồi 403
  }

  return false;
}

/**
 * Kiểm tra quyền xem dự án của người dùng
 */
function checkProjectReadAccess(req, res, projectId) {
  const authHeader = req.headers?.['authorization'] || req.headers?.['Authorization'];
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : (req.query?.token || null);

  let user = req.user;
  if (token) {
    const session = getSession(token);
    if (!session) {
      res.status(401).json({
        success: false,
        message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.'
      });
      return true;
    }
    user = session;
    req.user = session;
  }

  if (user) {
    if (!canUserAccessProject(user, projectId)) {
      res.status(403).json({
        success: false,
        message: 'Quyền truy cập bị từ chối: Bạn không được cấp quyền xem dự án này.'
      });
      return true;
    }
  }

  return false;
}

module.exports = {
  authenticate,
  requireAuth,
  checkViewerForbidden,
  checkProjectReadAccess
};
