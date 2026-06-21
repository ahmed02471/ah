/**
 * adminController.js — إدارة المستخدمين
 * ADMIN يدير الموظفين + ينشئ حسابات المواطنين
 */
const bcrypt = require('bcryptjs');
const db     = require('../config/database');
const { validateNationalId, generateCitizenUsername, generateTempPassword } = require('./authController');

const ROLES = ['ADMIN','REG_CHIEF','INSP_CHIEF','VIOLATIONS_DEPT','PLATE_DEPT','OFFICER','CITIZEN'];
const ROLE_AR = {
  ADMIN:'مدير النظام', REG_CHIEF:'رئيس التسجيل',
  INSP_CHIEF:'رئيس الفحص الفني', VIOLATIONS_DEPT:'قسم المخالفات',
  PLATE_DEPT:'قسم اللوحات', OFFICER:'ضابط ميداني', CITIZEN:'مواطن'
};

// ── قائمة الموظفين (بدون المواطنين) ─────────────────────────────
exports.listStaff = (req, res) => {
  try {
    const { q, role, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const where = ["role != 'CITIZEN'"]; const params = [];
    if (q)    { where.push(`(full_name LIKE ? OR username LIKE ? OR phone LIKE ?)`); params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
    if (role && role !== 'CITIZEN') { where.push('role = ?'); params.push(role); }
    const w = 'WHERE ' + where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) as cnt FROM users ${w}`).get(...params).cnt;
    const users = db.prepare(
      `SELECT id, national_id, username, full_name, role, phone, gender, is_active, last_login, created_at
       FROM users ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, parseInt(limit), parseInt(offset));
    res.json({ success: true, data: { users, total } });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
};

// ── قائمة المواطنين (منفصلة) ─────────────────────────────────────
exports.listCitizens = (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const where = ["role = 'CITIZEN'"]; const params = [];
    if (q) { where.push(`(full_name LIKE ? OR username LIKE ? OR national_id LIKE ? OR phone LIKE ?)`); params.push(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`); }
    const w = 'WHERE ' + where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) as cnt FROM users ${w}`).get(...params).cnt;
    const users = db.prepare(
      `SELECT u.id, u.national_id, u.username, u.full_name, u.phone, u.gender,
              u.id_card_number, u.passport_number, u.photo_path,
              u.is_active, u.must_change_password, u.created_at,
              (SELECT COUNT(*) FROM vehicles v
               JOIN vehicle_owners vo ON vo.vehicle_id = v.id AND vo.is_current = 1
               WHERE vo.owner_national_id = u.national_id) as vehicle_count
       FROM users u ${w} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, parseInt(limit), parseInt(offset));
    res.json({ success: true, data: { users, total } });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: e.message }); }
};

// ── إنشاء موظف (ADMIN يختار username وكلمة المرور) ───────────────
exports.createStaff = async (req, res) => {
  const { national_id, username, full_name, role, phone, gender, password } = req.body;

  if (!national_id || !username || !full_name || !role || !password)
    return res.status(400).json({ success: false, message: 'جميع الحقول المطلوبة يجب ملؤها' });

  if (!ROLES.includes(role) || role === 'CITIZEN')
    return res.status(400).json({ success: false, message: 'الدور غير صحيح' });

  if (password.length < 6)
    return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });

  // التحقق من الرقم الوطني
  const nidCheck = validateNationalId(national_id);
  if (!nidCheck.valid)
    return res.status(400).json({ success: false, message: nidCheck.msg });

  // التحقق من عدم التكرار
  if (db.prepare('SELECT id FROM users WHERE national_id = ?').get(national_id))
    return res.status(409).json({ success: false, message: 'الرقم الوطني مسجل مسبقاً' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username))
    return res.status(409).json({ success: false, message: 'اسم المستخدم مستخدم مسبقاً' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const info = db.prepare(`
      INSERT INTO users (national_id, username, full_name, role, phone, gender, password_hash, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(national_id, username.trim(), full_name, role, phone || null,
           gender || nidCheck.gender, hash, req.user.id);

    _audit(req, 'CREATE_STAFF', 'users', info.lastInsertRowid, `إنشاء موظف: ${full_name} (${ROLE_AR[role]})`);
    res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── إنشاء مواطن (username تلقائي + كلمة مرور عشوائية) ────────────
exports.createCitizen = async (req, res) => {
  const {
    national_id, full_name, full_name_en,
    phone, id_card_number, passport_number,
    birth_cert_number, address
  } = req.body;

  if (!national_id || !full_name)
    return res.status(400).json({ success: false, message: 'الرقم الوطني والاسم مطلوبان' });

  // التحقق من الرقم الوطني
  const nidCheck = validateNationalId(national_id);
  if (!nidCheck.valid)
    return res.status(400).json({ success: false, message: nidCheck.msg });

  if (db.prepare('SELECT id FROM users WHERE national_id = ?').get(national_id))
    return res.status(409).json({ success: false, message: 'الرقم الوطني مسجل مسبقاً' });

  try {
    // توليد username من الاسم الإنجليزي
    let username;
    if (full_name_en && full_name_en.trim()) {
      username = generateCitizenUsername(full_name_en);
    } else if (phone) {
      // إذا لم يُدخل الاسم الإنجليزي نستخدم رقم الهاتف
      username = phone.trim();
      // تأكد فريد
      let c = 1;
      while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
        username = `${phone}_${c++}`;
      }
    } else {
      return res.status(400).json({ success: false, message: 'يرجى إدخال الاسم بالإنجليزي أو رقم الهاتف لتوليد اسم المستخدم' });
    }

    // توليد كلمة المرور العشوائية
    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 12);

    // رفع صورة المواطن إذا وُجدت
    const photo_path = req.file ? `/uploads/${req.file.filename}` : null;

    const info = db.prepare(`
      INSERT INTO users
        (national_id, username, full_name, full_name_en, role, phone,
         gender, id_card_number, passport_number, birth_cert_number,
         photo_path, password_hash, must_change_password, created_by)
      VALUES (?, ?, ?, ?, 'CITIZEN', ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      national_id, username, full_name, full_name_en || null,
      phone || null, nidCheck.gender,
      id_card_number || null, passport_number || null,
      birth_cert_number || null, photo_path,
      hash, req.user.id
    );

    _audit(req, 'CREATE_CITIZEN', 'users', info.lastInsertRowid, `إنشاء مواطن: ${full_name}`);

    // إرجاع كلمة المرور المؤقتة مرة واحدة فقط
    res.status(201).json({
      success: true,
      data: {
        id:            info.lastInsertRowid,
        username,
        temp_password: tempPassword,
        gender:        nidCheck.gender,
        message:       `تم إنشاء الحساب. سلّم المواطن: اسم المستخدم (${username}) وكلمة المرور (${tempPassword})`
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── تفعيل/تعطيل مستخدم ───────────────────────────────────────────
exports.toggleUser = (req, res) => {
  try {
    if (Number(req.params.id) === req.user.id)
      return res.status(400).json({ success: false, message: 'لا يمكنك تعطيل حسابك الخاص' });

    const user = db.prepare('SELECT is_active, full_name, role FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

    const newStatus = user.is_active ? 0 : 1;
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newStatus, req.params.id);
    _audit(req, newStatus ? 'ACTIVATE_USER' : 'DEACTIVATE_USER', 'users', req.params.id,
           `${newStatus ? 'تفعيل' : 'تعطيل'} المستخدم: ${user.full_name}`);

    res.json({ success: true, is_active: newStatus });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── إعادة تعيين كلمة المرور ───────────────────────────────────────
exports.resetPassword = async (req, res) => {
  try {
    const user = db.prepare('SELECT id, full_name, role FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

    // للمواطن: كلمة مرور عشوائية جديدة
    // للموظف: يجب تحديد كلمة مرور
    let newPass, isCitizen = user.role === 'CITIZEN';

    if (isCitizen) {
      newPass = generateTempPassword();
    } else {
      newPass = req.body.new_password;
      if (!newPass || newPass.length < 6)
        return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    const hash = await bcrypt.hash(newPass, 12);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?')
      .run(hash, isCitizen ? 1 : 0, user.id);

    _audit(req, 'RESET_PASSWORD', 'users', user.id, `إعادة تعيين كلمة مرور: ${user.full_name}`);

    res.json({
      success: true,
      data: isCitizen
        ? { temp_password: newPass, message: 'سلّم المواطن كلمة المرور الجديدة' }
        : { message: 'تم تغيير كلمة المرور بنجاح' }
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── سجل التدقيق ───────────────────────────────────────────────────
exports.auditLogs = (req, res) => {
  try {
    const { page = 1, limit = 30, action, role } = req.query;
    const offset = (page - 1) * limit;
    const where = []; const params = [];
    if (action) { where.push('action LIKE ?'); params.push(action + '%'); }
    if (role)   { where.push('user_role = ?'); params.push(role); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) as cnt FROM audit_log ${w}`).get(...params).cnt;
    const logs  = db.prepare(
      `SELECT * FROM audit_log ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, parseInt(limit), parseInt(offset));
    res.json({ success: true, data: { logs, total } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── أنواع المخالفات ───────────────────────────────────────────────
exports.listViolationTypes = (req, res) => {
  try {
    const types = db.prepare('SELECT * FROM violation_types ORDER BY fine_amount DESC').all();
    res.json({ success: true, data: types });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createViolationType = (req, res) => {
  const { code, name_ar, fine_amount, legal_reference, requires_prosecutor } = req.body;
  if (!code || !name_ar || !fine_amount)
    return res.status(400).json({ success: false, message: 'الكود والاسم والغرامة مطلوبة' });
  try {
    if (db.prepare('SELECT id FROM violation_types WHERE code = ?').get(code))
      return res.status(409).json({ success: false, message: 'الكود مستخدم مسبقاً' });
    const info = db.prepare(
      'INSERT INTO violation_types (code,name_ar,fine_amount,legal_reference,requires_prosecutor) VALUES(?,?,?,?,?)'
    ).run(code, name_ar, parseFloat(fine_amount), legal_reference || 'القانون 11/1984', requires_prosecutor ? 1 : 0);
    res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateViolationType = (req, res) => {
  const { name_ar, fine_amount, legal_reference, requires_prosecutor } = req.body;
  try {
    const vt = db.prepare('SELECT id FROM violation_types WHERE id = ?').get(req.params.id);
    if (!vt) return res.status(404).json({ success: false, message: 'نوع المخالفة غير موجود' });
    db.prepare(`UPDATE violation_types SET name_ar=?,fine_amount=?,legal_reference=?,requires_prosecutor=? WHERE id=?`)
      .run(name_ar, parseFloat(fine_amount), legal_reference || null, requires_prosecutor ? 1 : 0, vt.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── محررو العقود ──────────────────────────────────────────────────
exports.listContractWriters = (req, res) => {
  try {
    const writers = db.prepare('SELECT * FROM contract_writers WHERE is_active = 1 ORDER BY name').all();
    res.json({ success: true, data: writers });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.addContractWriter = (req, res) => {
  const { name, court_number, phone } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'اسم المحرر مطلوب' });
  try {
    const info = db.prepare(
      'INSERT INTO contract_writers (name,court_number,phone,added_by) VALUES(?,?,?,?)'
    ).run(name, court_number || null, phone || null, req.user.id);
    res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.removeContractWriter = (req, res) => {
  try {
    db.prepare('UPDATE contract_writers SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── دالة مساعدة: تسجيل في سجل التدقيق ────────────────────────────
function _audit(req, action, table, id, details) {
  try {
    db.prepare(`INSERT INTO audit_log (user_id,user_name,user_role,action,table_name,record_id,details,ip_address)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(req.user.id, req.user.name, req.user.role, action, table, id, details, req.ip || 'unknown');
  } catch (_) {}
}

exports.createContractWriter = (req, res) => {
  try {
    const db = require('../config/database');
    const { name, national_id, phone, address, notes } = req.body;
    if (!name || !national_id) return res.status(400).json({ success:false, message:'الاسم والرقم الوطني مطلوبان' });
    const info = db.prepare('INSERT INTO contract_writers(name,national_id,phone,address,notes,added_by)VALUES(?,?,?,?,?,?)').run(name,national_id,phone||null,address||null,notes||null,req.user.id);
    res.status(201).json({ success:true, data:{ id: info.lastInsertRowid } });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};
