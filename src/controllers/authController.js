/**
 * authController.js
 * نظام مرور سبها — المصادقة
 */
require('dotenv').config();
const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db     = require('../config/database');

const JWT_SECRET     = process.env.JWT_SECRET || 'Sabha_Traffic_2026_SECRET';
const JWT_EXPIRES_IN = '10h';

// ── التحقق من الرقم الوطني الليبي ────────────────────────────────
function validateNationalId(id) {
  if (!id) return { valid: false, msg: 'الرقم الوطني مطلوب' };
  const s = String(id).trim();
  if (!/^\d{12}$/.test(s))
    return { valid: false, msg: 'الرقم الوطني يجب أن يتكون من 12 رقماً فقط (بدون حروف أو رموز)' };
  if (!['1','2'].includes(s[0]))
    return { valid: false, msg: 'الرقم الوطني يجب أن يبدأ بـ 1 (ذكر) أو 2 (أنثى)' };
  if (/^(\d)\1{11}$/.test(s))
    return { valid: false, msg: 'الرقم الوطني غير صالح — أرقام متكررة' };
  if (s === '123456789012' || s === '210987654321')
    return { valid: false, msg: 'الرقم الوطني غير صالح' };
  return { valid: true, gender: s[0] === '1' ? 'ذكر' : 'أنثى' };
}

// ── توليد username للمواطن من الاسم الإنجليزي ────────────────────
function generateCitizenUsername(fullNameEn) {
  if (!fullNameEn) return null;
  const parts = fullNameEn.trim().toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return null;

  let base = parts.length >= 2
    ? `${parts[0]}.${parts[1]}`
    : parts[0];

  // تأكد أنه فريد
  let username = base;
  let counter  = 1;
  while (true) {
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (!exists) break;
    counter++;
    username = `${base}${counter}`;
  }
  return username;
}

// ── توليد كلمة مرور عشوائية للمواطن ─────────────────────────────
function generateTempPassword(length = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#';
  let pass = '';
  for (let i = 0; i < length; i++)
    pass += chars[Math.floor(Math.random() * chars.length)];
  return pass;
}

// ── تسجيل الدخول ─────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'يرجى إدخال اسم المستخدم وكلمة المرور' });

    const u = username.trim();
    let user = null;
    try {
      user = db.prepare(
        `SELECT * FROM users WHERE (username = ? OR phone = ? OR national_id = ?) AND is_active = 1 LIMIT 1`
      ).get(u, u, u);
    } catch (_) {
      user = db.prepare(
        `SELECT * FROM users WHERE national_id = ? AND is_active = 1 LIMIT 1`
      ).get(u);
    }

    if (!user)
      return res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok)
      return res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });

    const token = jwt.sign(
      { id: user.id, national_id: user.national_id, role: user.role, name: user.full_name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    try { db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(user.id); } catch (_) {}

    // تسجيل في سجل التدقيق
    try {
      db.prepare(`INSERT INTO audit_log (user_id, user_name, user_role, action, details, ip_address)
                  VALUES (?, ?, ?, 'LOGIN', 'تسجيل دخول ناجح', ?)`)
        .run(user.id, user.full_name, user.role, req.ip || 'unknown');
    } catch (_) {}

    return res.json({
      success: true,
      data: {
        token,
        role:                 user.role,
        full_name:            user.full_name,
        id:                   user.id,
        must_change_password: user.must_change_password || 0
      }
    });
  } catch (err) {
    console.error('[Login]', err.message);
    return res.status(500).json({ success: false, message: 'خطأ في الخادم: ' + err.message });
  }
};

exports.getMe = (req, res) => {
  try {
    const user = db.prepare(
      'SELECT id, national_id, username, full_name, full_name_en, role, phone, gender, photo_path, last_login, must_change_password FROM users WHERE id = ?'
    ).get(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    return res.json({ success: true, data: user });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!new_password || new_password.length < 6)
      return res.status(400).json({ success: false, message: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);

    // إذا must_change_password لا نشترط كلمة المرور القديمة
    if (!req.user.must_change && current_password) {
      const ok = await bcrypt.compare(current_password, user.password_hash);
      if (!ok) return res.status(400).json({ success: false, message: 'كلمة المرور الحالية غير صحيحة' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(hash, req.user.id);

    return res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.logout = (req, res) => {
  try {
    db.prepare(`INSERT INTO audit_log (user_id, user_name, user_role, action) VALUES (?,?,?,'LOGOUT')`)
      .run(req.user.id, req.user.name, req.user.role);
  } catch (_) {}
  return res.json({ success: true });
};

// تصدير الدوال المساعدة
exports.validateNationalId    = validateNationalId;
exports.generateCitizenUsername = generateCitizenUsername;
exports.generateTempPassword  = generateTempPassword;

exports.me = (req, res) => {
  try {
    const db   = require('../config/database');
    const user = db.prepare('SELECT id,full_name,username,role,national_id,is_active FROM users WHERE id=?').get(req.user.id);
    if (!user) return res.status(404).json({ success:false, message:'المستخدم غير موجود' });
    res.json({ success:true, data: user });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};
