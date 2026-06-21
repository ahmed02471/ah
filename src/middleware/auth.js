/**
 * middleware/auth.js
 */
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'Sabha_Traffic_2026_SECRET';

exports.authenticate = (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);
    if (!token)
      return res.status(401).json({ success: false, message: 'يجب تسجيل الدخول أولاً' });

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'الجلسة منتهية — يرجى تسجيل الدخول مجدداً' });
  }
};

exports.authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ success: false, message: 'ليس لديك صلاحية للوصول لهذه الصفحة' });
  next();
};
