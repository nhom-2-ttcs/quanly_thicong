const { getSession } = require('../src/models/store');

function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : req.query.token;

  const session = getSession(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.'
    });
  }

  req.user = session;
  return next();
}

module.exports = authMiddleware;
