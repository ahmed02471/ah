/**
 * citizenController.js
 * تسجيل المواطن + البلاغات + التعليق للبيع
 */
const db     = require('../config/database');
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
const bcrypt = require('bcryptjs');

const { sendEmail, sendRawEmail } = require('../services/emailService');

// مجلد الرفع
const UPLOAD_DIR = path.join(__dirname,'../public/uploads/citizens');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive:true });

function now() { return new Date().toISOString().replace('T',' ').split('.')[0]; }
function deadline7() { const d=new Date(); d.setDate(d.getDate()+7); return d.toISOString().replace('T',' ').split('.')[0]; }

// توليد رقم مراجعة فريد 6 أرقام
function genReviewNumber() {
  for (let i=0; i<20; i++) {
    const n = Math.floor(100000 + Math.random()*900000).toString();
    if (!db.prepare('SELECT id FROM citizen_registrations WHERE review_number=?').get(n)) return n;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// ── مخزن OTP مؤقت (5 دقائق) ──────────────────────────────────
const otpStore = new Map(); // national_id → { otp, expiry, email }

// ══════════════════════════════════════════════════════════════
// تسجيل مواطن جديد
// ══════════════════════════════════════════════════════════════
exports.register = async (req, res) => {
  const { full_name, national_id, email, phone, password } = req.body;
  const username = national_id; // الرقم الوطني = اسم المستخدم تلقائياً

  if (!full_name || !national_id || !email || !password)
    return res.status(400).json({ success:false, message:'أكمل جميع الحقول الإلزامية' });

  if (!/^\d{12}$/.test(national_id))
    return res.status(400).json({ success:false, message:'الرقم الوطني يجب أن يكون 12 رقماً' });

  try {
    // تحقق من التكرار
    if (db.prepare('SELECT id FROM users WHERE username=?').get(username))
      return res.status(400).json({ success:false, message:'اسم المستخدم مستخدم مسبقاً' });
    if (db.prepare('SELECT id FROM users WHERE national_id=?').get(national_id))
      return res.status(400).json({ success:false, message:'هذا الرقم الوطني مسجل مسبقاً' });

    // حفظ الملفات
    const files = req.files || {};
    const saveFile = (key) => {
      if (!files[key]) return null;
      const f   = files[key][0];
      const ext = path.extname(f.originalname) || '';
      const nm  = `${key}_${Date.now()}${ext}`;
      const dst = path.join(UPLOAD_DIR, nm);
      fs.renameSync(f.path, dst);
      return `/uploads/citizens/${nm}`;
    };

    const photoPath = saveFile('photo');
    const birthPath = saveFile('birth_cert');
    const idPath    = saveFile('id_doc');

    if (!photoPath || !birthPath || !idPath)
      return res.status(400).json({ success:false, message:'يرجى رفع جميع الوثائق المطلوبة' });

    // إنشاء حساب المستخدم
    const hash = await bcrypt.hash(password, 10);
    const nowStr2 = new Date().toISOString().replace('T',' ').split('.')[0];

    // تحقق من الأعمدة الموجودة في الجدول
    const userCols = db.prepare("PRAGMA table_info(users)").all().map(r=>r.name);
    
    let userInsert, userValues;
    if (userCols.includes('phone') && userCols.includes('created_at')) {
      userInsert = `INSERT INTO users(national_id,username,full_name,role,password_hash,phone,is_active,created_at) VALUES(?,?,?,'CITIZEN',?,?,1,?)`;
      userValues = [national_id, username, full_name, hash, phone||null, nowStr2];
    } else if (userCols.includes('phone')) {
      userInsert = `INSERT INTO users(national_id,username,full_name,role,password_hash,phone,is_active) VALUES(?,?,?,'CITIZEN',?,?,1)`;
      userValues = [national_id, username, full_name, hash, phone||null];
    } else {
      userInsert = `INSERT INTO users(national_id,username,full_name,role,password_hash,is_active) VALUES(?,?,?,'CITIZEN',?,1)`;
      userValues = [national_id, username, full_name, hash];
    }
    const user = db.prepare(userInsert).run(...userValues);

    const reviewNumber = genReviewNumber();

    // حفظ طلب التسجيل
    db.prepare(`
      INSERT INTO citizen_registrations
        (review_number,user_id,full_name,national_id,phone,email,
         photo_path,birth_cert_path,id_doc_path,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,'pending',?)
    `).run(reviewNumber, user.lastInsertRowid, full_name, national_id,
           phone||null, email, photoPath, birthPath, idPath, now());

    // إشعار REG_CHIEF
    db.prepare(`
      INSERT INTO internal_messages(from_user_id,to_role,subject,body,msg_type)
      VALUES(?,'REG_CHIEF',?,?,'citizen_request')
    `).run(user.lastInsertRowid,
      `طلب تسجيل مواطن جديد — ${full_name}`,
      `تقدم المواطن ${full_name} (${national_id}) بطلب تسجيل مركبة.\nرقم المراجعة: ${reviewNumber}\nالإيميل: ${email}\nالهاتف: ${phone||'—'}`
    );

    // إيميل للمواطن
    await sendEmail(email, 'registrationReceived', full_name, reviewNumber);

    // توليد token للدخول المباشر
    const jwt   = require('jsonwebtoken');
    const token = jwt.sign({ id:user.lastInsertRowid, role:'CITIZEN' }, process.env.JWT_SECRET||'secret', { expiresIn:'30d' });

    res.status(201).json({ success:true, data:{ review_number:reviewNumber, token } });
  } catch(e) {
    console.error('[Citizen Register]', e);
    res.status(500).json({ success:false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════════
// بيانات الرئيسية للمواطن
// ══════════════════════════════════════════════════════════════
exports.home = (req, res) => {
  try {
    const uid = req.user.id;

    // بيانات المواطن
    const citizen = db.prepare('SELECT * FROM citizen_registrations WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid);

    // مركباته
    const vehicles = db.prepare(`
      SELECT v.*, vo.owner_name,
        (SELECT valid_until FROM vehicle_insurance WHERE vehicle_id=v.id ORDER BY id DESC LIMIT 1) as ins_expiry,
        (SELECT valid_until FROM vehicle_travel_permits WHERE vehicle_id=v.id ORDER BY id DESC LIMIT 1) as bel_expiry,
        (SELECT valid_until FROM technical_inspections WHERE vehicle_id=v.id ORDER BY id DESC LIMIT 1) as insp_expiry,
        (SELECT COUNT(*) FROM violations WHERE vehicle_id=v.id AND status='unpaid') as unpaid_count
      FROM vehicles v
      LEFT JOIN vehicle_owners vo ON vo.vehicle_id=v.id AND vo.is_current=1
      WHERE vo.owner_national_id=(SELECT national_id FROM users WHERE id=?)
    `).all(uid);

    // مخالفاته
    const violations = db.prepare(`
      SELECT vio.*, vt.name_ar as type_name, v.plate_number
      FROM violations vio
      LEFT JOIN violation_types vt ON vt.id=vio.violation_type_id
      LEFT JOIN vehicles v ON v.id=vio.vehicle_id
      LEFT JOIN vehicle_owners vo ON vo.vehicle_id=v.id AND vo.is_current=1
      WHERE vo.owner_national_id=(SELECT national_id FROM users WHERE id=?)
      ORDER BY vio.issued_at DESC LIMIT 10
    `).all(uid);

    // إشعارات
    const notifs = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 10').all(uid);

    // بلاغاته
    const reports = db.prepare(`
      SELECT cr.*, v.plate_number
      FROM citizen_reports cr
      LEFT JOIN vehicles v ON v.id=cr.vehicle_id
      WHERE cr.citizen_user_id=? ORDER BY cr.created_at DESC LIMIT 5
    `).all(uid);

    res.json({ success:true, data:{ citizen, vehicles, violations, notifs, reports } });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
};

// ══════════════════════════════════════════════════════════════
// تقديم بلاغ (ضياع لوحة أو سرقة مركبة)
// يُرسل البلاغ إلى رئيس قسم المرور (ADMIN) وقسم التسجيل (REG_CHIEF) معاً.
// لا تُغيَّر حالة المركبة فوراً — فقط بعد موافقة الطرفين (decideReport).
// ══════════════════════════════════════════════════════════════
exports.submitReport = (req, res) => {
  // الواجهة الحالية ترسل الحقل باسم "type" بقيمة "stolen_vehicle"/"lost_plate"
  const report_type = req.body.report_type || req.body.type;
  const { vehicle_id, description } = req.body;

  if (!vehicle_id || !report_type)
    return res.status(400).json({ success:false, message:'بيانات البلاغ ناقصة' });
  if (!['lost_plate','stolen_vehicle'].includes(report_type))
    return res.status(400).json({ success:false, message:'نوع البلاغ غير صحيح' });

  try {
    const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(vehicle_id);
    if (!v) return res.status(404).json({ success:false, message:'المركبة غير موجودة' });

    // حفظ صورة تقرير الشرطة (الواجهة ترسلها باسم "photo")
    let policePath = null;
    if (req.file) {
      const ext = path.extname(req.file.originalname)||'';
      const nm  = `report_${Date.now()}${ext}`;
      const dst = path.join(UPLOAD_DIR, nm);
      fs.renameSync(req.file.path, dst);
      policePath = `/uploads/citizens/${nm}`;
    }

    const dl = deadline7();
    const report = db.prepare(`
      INSERT INTO citizen_reports
        (citizen_user_id,vehicle_id,report_type,description,police_report_path,
         status,deadline_at,created_at)
      VALUES(?,?,?,?,?,'pending',?,?)
    `).run(req.user.id, vehicle_id, report_type, description||null, policePath, dl, now());

    // إشعار رئيس قسم المرور (ADMIN) وقسم التسجيل (REG_CHIEF) — يلزم موافقة كلاهما
    const typeLabel = report_type==='lost_plate' ? 'ضياع لوحة' : 'سرقة مركبة';
    const msgBody = `تقدم المواطن ببلاغ ${typeLabel}.\nاللوحة: ${v.plate_number}\nالوصف: ${description||'—'}\n\nيلزم موافقة رئيس قسم المرور وقسم التسجيل معاً لتفعيل حالة البلاغ على المركبة.\nيجب المراجعة خلال 7 أيام من تاريخ البلاغ.`;
    for (const toRole of ['ADMIN','REG_CHIEF']) {
      db.prepare(`
        INSERT INTO internal_messages(from_user_id,to_role,subject,body,msg_type,reference_id)
        VALUES(?,?,?,?,'citizen_report',?)
      `).run(req.user.id, toRole, `بلاغ ${typeLabel} — لوحة ${v.plate_number}`, msgBody, report.lastInsertRowid);
    }

    // إشعار المواطن بإيميل استلام البلاغ
    const reporter = db.prepare(`
      SELECT u.full_name,
        (SELECT email FROM citizen_registrations WHERE national_id=u.national_id ORDER BY created_at DESC LIMIT 1) as email
      FROM users u WHERE u.id=?
    `).get(req.user.id);
    if (reporter?.email) {
      sendEmail(reporter.email, 'reportAccepted', reporter.full_name||'', typeLabel, report.lastInsertRowid);
    }

    res.status(201).json({ success:true, data:{ report_id:report.lastInsertRowid, deadline:dl } });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
};

// ══════════════════════════════════════════════════════════════
// ADMIN (رئيس قسم المرور) أو REG_CHIEF (قسم التسجيل) — اتخاذ قرار بشأن بلاغ
// لا تُفعَّل حالة "مسروقة/ضياع اللوحة" على المركبة إلا بعد موافقة كلا الجهتين.
// رفض أي جهة منهما يُغلق البلاغ فوراً برفض.
// ══════════════════════════════════════════════════════════════
exports.decideReport = (req, res) => {
  const { decision, notes } = req.body;
  if (!['approve','reject'].includes(decision))
    return res.status(400).json({ success:false, message:'القرار غير صحيح' });

  const role = req.user.role;
  if (!['ADMIN','REG_CHIEF'].includes(role))
    return res.status(403).json({ success:false, message:'لا تملك صلاحية اتخاذ قرار على هذا البلاغ' });

  try {
    const report = db.prepare('SELECT * FROM citizen_reports WHERE id=?').get(req.params.id);
    if (!report) return res.status(404).json({ success:false, message:'البلاغ غير موجود' });
    if (report.status !== 'pending')
      return res.status(400).json({ success:false, message:'تم اتخاذ قرار نهائي بشأن هذا البلاغ مسبقاً' });

    const prefix = role === 'ADMIN' ? 'admin' : 'regchief';
    if (report[`${prefix}_decision`] && report[`${prefix}_decision`] !== 'pending')
      return res.status(400).json({ success:false, message:'لقد اتخذت قراراً بشأن هذا البلاغ مسبقاً' });

    const decisionVal = decision === 'approve' ? 'approved' : 'rejected';
    const nowStr = now();
    db.prepare(`
      UPDATE citizen_reports
      SET ${prefix}_decision=?, ${prefix}_decided_by=?, ${prefix}_decided_at=?, ${prefix}_notes=?
      WHERE id=?
    `).run(decisionVal, req.user.id, nowStr, notes||null, report.id);

    const updated = db.prepare('SELECT * FROM citizen_reports WHERE id=?').get(report.id);
    const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(report.vehicle_id);
    const typeLabel = report.report_type==='lost_plate' ? 'ضياع اللوحة' : 'سرقة المركبة';
    const citizen = db.prepare('SELECT * FROM users WHERE id=?').get(report.citizen_user_id);
    const citizenEmail = db.prepare(`
      SELECT email FROM citizen_registrations WHERE national_id=(SELECT national_id FROM users WHERE id=?)
      ORDER BY created_at DESC LIMIT 1
    `).get(report.citizen_user_id)?.email;

    let finalStatus = null;

    if (decisionVal === 'rejected') {
      // رفض أي جهة يُغلق البلاغ فوراً
      finalStatus = 'rejected';
      db.prepare("UPDATE citizen_reports SET status='rejected' WHERE id=?").run(report.id);
      if (citizenEmail) sendEmail(citizenEmail, 'reportRejected', citizen?.full_name||'', typeLabel, report.id, notes||'');
    } else if (updated.admin_decision === 'approved' && updated.regchief_decision === 'approved') {
      // موافقة الطرفين — تفعيل حالة المركبة وإشعار المواطن بالإيميل
      finalStatus = 'approved';
      const newVehicleStatus = report.report_type === 'lost_plate' ? 'reported_lost_plate' : 'reported_stolen';
      db.prepare("UPDATE citizen_reports SET status='approved' WHERE id=?").run(report.id);
      db.prepare("UPDATE vehicles SET status=? WHERE id=?").run(newVehicleStatus, report.vehicle_id);
      if (citizenEmail) sendEmail(citizenEmail, 'reportApproved', citizen?.full_name||'', typeLabel, v?.plate_number||'', report.id);
    }

    try {
      db.prepare(`INSERT INTO audit_log(user_id,user_name,user_role,action,table_name,record_id,details,ip_address)VALUES(?,?,?,?,?,?,?,?)`)
        .run(req.user.id, req.user.name, req.user.role, `citizen_report_${decision}`, 'citizen_reports', report.id, notes||'', req.ip||'');
    } catch(_){}

    res.json({ success:true, data:{ report_id:report.id, final_status: finalStatus||'pending' } });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
};

// ══════════════════════════════════════════════════════════════
// ADMIN / REG_CHIEF — قائمة بلاغات المواطنين (سرقة/ضياع لوحة) للمراجعة
// ══════════════════════════════════════════════════════════════
exports.listReportsForReview = (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT cr.*, v.plate_number, v.make, v.model, u.full_name as citizen_name, u.national_id as citizen_national_id
      FROM citizen_reports cr
      LEFT JOIN vehicles v ON v.id=cr.vehicle_id
      LEFT JOIN users u ON u.id=cr.citizen_user_id
      WHERE cr.report_type IN ('lost_plate','stolen_vehicle')
      ORDER BY cr.created_at DESC LIMIT 100
    `).all();
    res.json({ success:true, data:rows });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
};

// ══════════════════════════════════════════════════════════════
// المواطن — إلغاء بلاغه (وُجدت المركبة / استُلمت لوحة جديدة / تراجع عن نقل الملكية)
// يعيد حالة المركبة لطبيعتها إن كانت قد تغيّرت، ويُشعر رئيس قسم المرور وقسم التسجيل.
// ══════════════════════════════════════════════════════════════
exports.cancelReport = (req, res) => {
  try {
    const report = db.prepare('SELECT * FROM citizen_reports WHERE id=?').get(req.params.id);
    if (!report) return res.status(404).json({ success:false, message:'البلاغ غير موجود' });
    if (report.citizen_user_id !== req.user.id)
      return res.status(403).json({ success:false, message:'لا تملك صلاحية إلغاء هذا البلاغ' });
    if (!['pending','approved'].includes(report.status))
      return res.status(400).json({ success:false, message:'لا يمكن إلغاء بلاغ بهذه الحالة' });
    if (!['lost_plate','stolen_vehicle','sale_suspension'].includes(report.report_type))
      return res.status(400).json({ success:false, message:'لا يمكن إلغاء هذا النوع من البلاغات' });

    const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(report.vehicle_id);

    // تعليق للبيع: امنع الإلغاء إذا كان قسم التسجيل قد بدأ إجراءات النقل الرسمية فعلاً
    if (report.report_type === 'sale_suspension') {
      const activeTransfer = db.prepare(`
        SELECT id FROM ownership_transfers
        WHERE vehicle_id=? AND status NOT IN ('rejected','expired','completed')
        ORDER BY id DESC LIMIT 1
      `).get(report.vehicle_id);
      if (activeTransfer)
        return res.status(400).json({ success:false, message:'بدأ قسم التسجيل إجراءات النقل الرسمية — يرجى التواصل مع القسم مباشرة لإلغاء الطلب' });
    }

    const nowStr = now();
    const reason = (req.body.reason || '').trim() || null;
    // resolution_type='found' فقط عندما يقدّمها الواجهة صراحةً (تم العثور على اللوحة/المركبة بلا أي رسم)
    const resolutionType = req.body.resolution_type === 'found' ? 'found' : null;
    db.prepare(`UPDATE citizen_reports SET status='cancelled', citizen_cancelled_at=?, citizen_cancel_reason=?, resolution_type=? WHERE id=?`)
      .run(nowStr, reason, resolutionType, report.id);

    // إعادة المركبة لحالتها الطبيعية إن كانت قد تغيّرت بسبب هذا البلاغ
    if (['reported_stolen','reported_lost_plate','suspended'].includes(v?.status)) {
      db.prepare("UPDATE vehicles SET status='active' WHERE id=?").run(report.vehicle_id);
    }

    // إشعار رئيس قسم المرور (ADMIN) وقسم التسجيل (REG_CHIEF) — معلوماتي
    const typeLabel = report.report_type==='lost_plate' ? 'ضياع لوحة'
                     : report.report_type==='stolen_vehicle' ? 'سرقة مركبة'
                     : 'تعليق للبيع / نقل ملكية';
    const msgBody = `قام المواطن بإلغاء بلاغه (${typeLabel}) — اللوحة: ${v?.plate_number||'—'}.${reason ? `\nالسبب: ${reason}` : ''}`;
    for (const toRole of ['ADMIN','REG_CHIEF']) {
      db.prepare(`
        INSERT INTO internal_messages(from_user_id,to_role,subject,body,msg_type,reference_id)
        VALUES(?,?,?,?,'citizen_report_cancelled',?)
      `).run(req.user.id, toRole, `🔓 إلغاء بلاغ ${typeLabel} — ${v?.plate_number||''}`, msgBody, report.id);
    }

    try {
      db.prepare(`INSERT INTO audit_log(user_id,user_name,user_role,action,table_name,record_id,details,ip_address)VALUES(?,?,?,?,?,?,?,?)`)
        .run(req.user.id, req.user.name||uName_safe(req.user.id), 'CITIZEN', 'citizen_report_cancel', 'citizen_reports', report.id, reason||'', req.ip||'');
    } catch(_){}

    res.json({ success:true });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
};

// ══════════════════════════════════════════════════════════════
// المواطن — طلب استخراج لوحة بديلة (الفقدان/السرقة حقيقي ولم تُستَرجَع)
// لا يُغلق البلاغ فوراً ولا يُعيد حالة المركبة — يبقى البلاغ "approved"
// وتبقى المركبة بحالتها (reported_lost_plate/reported_stolen) حتى يحصّل
// قسم اللوحات الرسم فعلياً ويُصدر اللوحة البديلة (completePlateReissue).
// ══════════════════════════════════════════════════════════════
exports.requestPlateReissue = (req, res) => {
  try {
    const report = db.prepare('SELECT * FROM citizen_reports WHERE id=?').get(req.params.id);
    if (!report) return res.status(404).json({ success:false, message:'البلاغ غير موجود' });
    if (report.citizen_user_id !== req.user.id)
      return res.status(403).json({ success:false, message:'لا تملك صلاحية على هذا البلاغ' });
    if (!['lost_plate','stolen_vehicle'].includes(report.report_type))
      return res.status(400).json({ success:false, message:'هذا الإجراء متاح فقط لبلاغات ضياع اللوحة أو سرقة المركبة' });
    if (report.status !== 'approved')
      return res.status(400).json({ success:false, message:'لا يمكن طلب لوحة بديلة قبل تفعيل البلاغ' });
    if (report.resolution_type)
      return res.status(400).json({ success:false, message:'تم اتخاذ إجراء بشأن هذا البلاغ مسبقاً' });

    const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(report.vehicle_id);
    db.prepare(`UPDATE citizen_reports SET resolution_type='reissue_requested' WHERE id=?`).run(report.id);

    const typeLabel = report.report_type==='lost_plate' ? 'ضياع لوحة' : 'سرقة مركبة';
    db.prepare(`
      INSERT INTO internal_messages(from_user_id,to_role,subject,body,msg_type,reference_id)
      VALUES(?,'PLATE_DEPT',?,?,'plate_reissue_request',?)
    `).run(req.user.id,
      `🏷️ طلب لوحة بديلة — ${v?.plate_number||''}`,
      `أكّد المواطن استمرار فقدان/سرقة اللوحة (${typeLabel}) ويطلب استخراج لوحة بديلة بنفس رقم اللوحة (${v?.plate_number||'—'}).\nيرجى تحصيل الرسم وإصدار اللوحة البديلة.`,
      report.id
    );

    try {
      db.prepare(`INSERT INTO audit_log(user_id,user_name,user_role,action,table_name,record_id,details,ip_address)VALUES(?,?,?,?,?,?,?,?)`)
        .run(req.user.id, req.user.name||uName_safe(req.user.id), 'CITIZEN', 'citizen_report_request_reissue', 'citizen_reports', report.id, '', req.ip||'');
    } catch(_){}

    res.json({ success:true });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
};

// ══════════════════════════════════════════════════════════════
// PLATE_DEPT — تأكيد تحصيل رسم اللوحة البديلة وإصدارها فعلياً
// نفس رقم اللوحة القديم — إصدار بديل مطابق فقط. يُغلق البلاغ ويُعيد
// المركبة لحالة "active".
// ══════════════════════════════════════════════════════════════
exports.completePlateReissue = (req, res) => {
  try {
    const feeAmount = parseFloat(req.body.fee_amount);
    if (!Number.isFinite(feeAmount) || feeAmount < 0)
      return res.status(400).json({ success:false, message:'أدخل مبلغ الرسم المحصَّل' });

    const report = db.prepare('SELECT * FROM citizen_reports WHERE id=?').get(req.params.id);
    if (!report) return res.status(404).json({ success:false, message:'البلاغ غير موجود' });
    if (!['lost_plate','stolen_vehicle'].includes(report.report_type))
      return res.status(400).json({ success:false, message:'هذا الإجراء متاح فقط لبلاغات ضياع اللوحة أو سرقة المركبة' });
    if (report.resolution_type !== 'reissue_requested')
      return res.status(400).json({ success:false, message:'لا يوجد طلب لوحة بديلة قيد المعالجة لهذا البلاغ' });

    const nowStr = now();
    const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(report.vehicle_id);

    db.prepare(`
      UPDATE citizen_reports
      SET resolution_type='reissued', status='cancelled',
          reissue_fee_amount=?, reissue_paid_at=?, reissue_paid_by=?, reissue_completed_at=?
      WHERE id=?
    `).run(feeAmount, nowStr, req.user.id, nowStr, report.id);

    if (['reported_stolen','reported_lost_plate'].includes(v?.status)) {
      db.prepare("UPDATE vehicles SET status='active' WHERE id=?").run(report.vehicle_id);
    }

    db.prepare(`
      INSERT INTO internal_messages(from_user_id,to_user_id,subject,body,msg_type,reference_id)
      VALUES(?,?,?,?,'citizen_report_cancelled',?)
    `).run(req.user.id, report.citizen_user_id,
      `🏷️ تم إصدار لوحتك البديلة — ${v?.plate_number||''}`,
      `تم تحصيل رسم اللوحة البديلة (${feeAmount} د.ل) وإصدار اللوحة بنفس الرقم (${v?.plate_number||'—'}). يمكنك استلامها من قسم اللوحات.`,
      report.id
    );

    try {
      db.prepare(`INSERT INTO audit_log(user_id,user_name,user_role,action,table_name,record_id,details,ip_address)VALUES(?,?,?,?,?,?,?,?)`)
        .run(req.user.id, req.user.name||uName_safe(req.user.id), 'PLATE_DEPT', 'citizen_report_reissue_complete', 'citizen_reports', report.id, `fee=${feeAmount}`, req.ip||'');
    } catch(_){}

    res.json({ success:true, data:{ fee_amount:feeAmount, plate_number:v?.plate_number||null } });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
};

// ══════════════════════════════════════════════════════════════
// ADMIN / REG_CHIEF — فك تعليق مركبة معلَّقة للبيع (فشلت الصفقة، أو تراجع المواطن
// ولم يتمكن من الإلغاء بنفسه). يعمل فقط إذا لم تبدأ إجراءات نقل الملكية الرسمية.
// ══════════════════════════════════════════════════════════════
exports.unsuspendVehicle = (req, res) => {
  try {
    const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.params.id);
    if (!v) return res.status(404).json({ success:false, message:'المركبة غير موجودة' });
    if (v.status !== 'suspended')
      return res.status(400).json({ success:false, message:'المركبة ليست معلَّقة حالياً' });

    const nowStr  = now();
    const reason  = (req.body.reason || '').trim() || null;
    const byLabel = req.user.role === 'ADMIN' ? 'رئيس قسم المرور' : 'قسم التسجيل';
    const force   = req.body.force === true || req.body.force === 'true';

    const activeTransfer = db.prepare(`
      SELECT * FROM ownership_transfers
      WHERE vehicle_id=? AND status NOT IN ('rejected','expired','completed')
      ORDER BY id DESC LIMIT 1
    `).get(v.id);

    if (activeTransfer && !force)
      return res.status(400).json({
        success:false,
        message:'يوجد إجراء نقل ملكية رسمي قيد التنفيذ لهذه المركبة — يجب رفض/إنهاء طلب النقل أولاً من صفحة نقل الملكية',
        data:{ active_transfer:true }
      });

    // إلغاء قسري لطلب نقل الملكية العالق (بطلب صريح من ADMIN/REG_CHIEF)
    if (activeTransfer && force) {
      const cancelNote = reason
        ? `(أُلغي عند فك التعليق من ${byLabel}) ${reason}`
        : `(أُلغي عند فك التعليق من ${byLabel})`;

      if (['step4_pending_final','step5_approved_for_plate'].includes(activeTransfer.status)) {
        db.prepare("UPDATE ownership_transfers SET status='rejected',rejection_reason=?,final_admin_by=?,final_admin_at=? WHERE id=?")
          .run(cancelNote, req.user.id, nowStr, activeTransfer.id);
      } else {
        db.prepare("UPDATE ownership_transfers SET status='rejected',rejection_reason=?,admin_decision_by=?,admin_decision_at=? WHERE id=?")
          .run(cancelNote, req.user.id, nowStr, activeTransfer.id);
      }

      if (activeTransfer.reg_user_id) {
        db.prepare(`
          INSERT INTO internal_messages(from_user_id,to_user_id,subject,body,msg_type,reference_id)
          VALUES(?,?,?,?,'transfer_request',?)
        `).run(req.user.id, activeTransfer.reg_user_id,
          `❌ أُلغي طلب نقل الملكية — ${v.plate_number}`,
          `قام ${byLabel} بإلغاء طلب نقل ملكية ${v.plate_number} عند فك تعليق المركبة.${reason ? `\nالسبب: ${reason}` : ''}`,
          activeTransfer.id);
      }

      try {
        db.prepare(`INSERT INTO audit_log(user_id,user_name,user_role,action,table_name,record_id,details,ip_address)VALUES(?,?,?,?,?,?,?,?)`)
          .run(req.user.id, req.user.name||uName_safe(req.user.id), req.user.role, 'transfer_force_cancel', 'ownership_transfers', activeTransfer.id, reason||'', req.ip||'');
      } catch(_){}
    }

    const report = db.prepare(`
      SELECT * FROM citizen_reports
      WHERE vehicle_id=? AND report_type='sale_suspension' AND status IN ('pending','approved')
      ORDER BY id DESC LIMIT 1
    `).get(v.id);

    if (report) {
      db.prepare(`UPDATE citizen_reports SET status='cancelled', citizen_cancelled_at=?, citizen_cancel_reason=? WHERE id=?`)
        .run(nowStr, reason ? `(فك تعليق من ${byLabel}) ${reason}` : `(فك تعليق من ${byLabel})`, report.id);
    }

    db.prepare("UPDATE vehicles SET status='active' WHERE id=?").run(v.id);

    if (report?.citizen_user_id) {
      db.prepare(`
        INSERT INTO internal_messages(from_user_id,to_user_id,subject,body,msg_type,reference_id)
        VALUES(?,?,?,?,'citizen_report_cancelled',?)
      `).run(req.user.id, report.citizen_user_id,
        `🔓 تم فك تعليق مركبتك للبيع — ${v.plate_number}`,
        `قام ${byLabel} بفك تعليق مركبتك (${v.plate_number}) للبيع.${reason ? `\nالسبب: ${reason}` : ''}`,
        report.id);
    }

    try {
      db.prepare(`INSERT INTO audit_log(user_id,user_name,user_role,action,table_name,record_id,details,ip_address)VALUES(?,?,?,?,?,?,?,?)`)
        .run(req.user.id, req.user.name||uName_safe(req.user.id), req.user.role, 'vehicle_unsuspend', 'vehicles', v.id, reason||'', req.ip||'');
    } catch(_){}

    res.json({
      success:true,
      message: (activeTransfer && force) ? 'تم إلغاء طلب نقل الملكية وفك التعليق بنجاح' : 'تم فك التعليق عن المركبة بنجاح'
    });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
};

function uName_safe(uid) {
  try { return db.prepare('SELECT full_name FROM users WHERE id=?').get(uid)?.full_name || ''; } catch(_) { return ''; }
}

// ══════════════════════════════════════════════════════════════
// تعليق المركبة للبيع
// ══════════════════════════════════════════════════════════════
exports.suspendForSale = (req, res) => {
  const { vehicle_id } = req.body;
  if (!vehicle_id) return res.status(400).json({ success:false, message:'رقم المركبة مطلوب' });

  try {
    const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(vehicle_id);
    if (!v) return res.status(404).json({ success:false, message:'المركبة غير موجودة' });
    if (v.status === 'suspended') return res.status(400).json({ success:false, message:'المركبة مُعلَّقة مسبقاً' });

    // تحقق: لا مخالفات + لا امتياز
    const unpaid = db.prepare("SELECT COUNT(*) as c FROM violations WHERE vehicle_id=? AND status='unpaid'").get(vehicle_id).c;
    if (unpaid > 0) return res.status(400).json({ success:false, message:`لا يمكن التعليق — يوجد ${unpaid} مخالفة غير مدفوعة` });
    const lien = db.prepare('SELECT id FROM liens WHERE vehicle_id=? AND is_active=1').get(vehicle_id);
    if (lien) return res.status(400).json({ success:false, message:'لا يمكن التعليق — يوجد حق امتياز نشط' });

    // حفظ صورة العقد
    let contractPath = null;
    if (req.file) {
      const ext = path.extname(req.file.originalname)||'';
      const nm  = `contract_${Date.now()}${ext}`;
      const dst = path.join(UPLOAD_DIR, nm);
      fs.renameSync(req.file.path, dst);
      contractPath = `/uploads/citizens/${nm}`;
    }

    const dl = deadline7();
    db.prepare("UPDATE vehicles SET status='suspended' WHERE id=?").run(vehicle_id);

    const report = db.prepare(`
      INSERT INTO citizen_reports
        (citizen_user_id,vehicle_id,report_type,description,contract_path,status,deadline_at,created_at)
      VALUES(?,?,'sale_suspension','تعليق للبيع من المواطن',?,'pending',?,?)
    `).run(req.user.id, vehicle_id, contractPath, dl, now());

    // إشعار REG_CHIEF لبدء إجراءات نقل الملكية
    db.prepare(`
      INSERT INTO internal_messages(from_user_id,to_role,subject,body,msg_type,reference_id)
      VALUES(?,'REG_CHIEF',?,?,'transfer_request',?)
    `).run(req.user.id,
      `طلب تعليق للبيع — لوحة ${v.plate_number}`,
      `طلب المواطن تعليق مركبته للبيع.\nاللوحة: ${v.plate_number}\nالمهلة: 7 أيام (حتى ${dl.split(' ')[0]})\nصورة العقد: ${contractPath?'مرفقة':'غير مرفقة'}`,
      report.lastInsertRowid
    );

    res.status(201).json({ success:true, data:{ deadline:dl } });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
};

// ══════════════════════════════════════════════════════════════
// REG_CHIEF — قائمة طلبات المواطنين
// ══════════════════════════════════════════════════════════════
exports.listRequests = (req, res) => {
  try {
    const { q } = req.query;
    let rows;
    if (q) {
      rows = db.prepare(`
        SELECT cr.*, u.username, u.national_id as user_nid
        FROM citizen_registrations cr
        LEFT JOIN users u ON u.id=cr.user_id
        WHERE cr.review_number=? OR cr.national_id LIKE ? OR cr.full_name LIKE ?
        ORDER BY cr.created_at DESC LIMIT 20
      `).all(q, `%${q}%`, `%${q}%`);
    } else {
      rows = db.prepare(`
        SELECT cr.*, u.username
        FROM citizen_registrations cr
        LEFT JOIN users u ON u.id=cr.user_id
        ORDER BY cr.created_at DESC LIMIT 50
      `).all();
    }
    res.json({ success:true, data:rows });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
};

// ══════════════════════════════════════════════════════════════
// نسيان كلمة المرور — خطوة 1: إرسال OTP
// ══════════════════════════════════════════════════════════════
exports.forgotPassword = async (req, res) => {
  const { national_id } = req.body;
  if (!national_id) return res.status(400).json({ success:false, message:'أدخل رقمك الوطني' });

  try {
    const user = db.prepare(
      `SELECT u.id, u.full_name, u.national_id,
              (SELECT email FROM citizen_registrations WHERE national_id=u.national_id ORDER BY created_at DESC LIMIT 1) as email
       FROM users u WHERE u.national_id=? AND u.role='CITIZEN' AND u.is_active=1`
    ).get(national_id.trim());

    if (!user || !user.email)
      return res.status(404).json({ success:false, message:'لا يوجد حساب مرتبط بهذا الرقم الوطني أو البريد الإلكتروني غير مسجل' });

    // توليد OTP 6 أرقام
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = Date.now() + 5 * 60 * 1000; // 5 دقائق
    otpStore.set(national_id.trim(), { otp, expiry, email: user.email });

    await sendRawEmail(
      user.email,
      'رمز إعادة تعيين كلمة المرور — مرور سبها',
      `
        <div dir="rtl" style="font-family:Cairo,Arial;max-width:480px;margin:auto;background:#f8fafc;padding:32px;border-radius:16px;">
          <h2 style="color:#1d4ed8;margin:0 0 8px;">مرور سبها</h2>
          <p style="color:#475569;">السيد/ة <strong>${user.full_name}</strong>،</p>
          <p style="color:#475569;">رمز التحقق لإعادة تعيين كلمة المرور:</p>
          <div style="background:#fff;border:2px solid #bfdbfe;border-radius:12px;padding:24px;text-align:center;margin:20px 0;">
            <span style="font-size:42px;font-weight:900;letter-spacing:12px;color:#1d4ed8;font-family:monospace;">${otp}</span>
          </div>
          <p style="color:#94a3b8;font-size:12px;">الرمز صالح لمدة <strong>5 دقائق</strong> فقط. لا تشاركه مع أحد.</p>
        </div>`
    );

    res.json({ success:true, message:`تم إرسال رمز التحقق إلى ${user.email.replace(/(.{2}).+(@.+)/, '$1***$2')}` });
  } catch(e) {
    res.status(500).json({ success:false, message:'خطأ في إرسال الرمز: ' + e.message });
  }
};

// خطوة 2: التحقق من OTP
exports.verifyOtp = (req, res) => {
  const { national_id, otp } = req.body;
  if (!national_id || !otp) return res.status(400).json({ success:false, message:'بيانات ناقصة' });

  const record = otpStore.get(national_id.trim());
  if (!record) return res.status(400).json({ success:false, message:'لم يتم طلب رمز لهذا الرقم الوطني' });
  if (Date.now() > record.expiry) {
    otpStore.delete(national_id.trim());
    return res.status(400).json({ success:false, message:'انتهت صلاحية الرمز — أعد المحاولة' });
  }
  if (record.otp !== otp.trim())
    return res.status(400).json({ success:false, message:'الرمز غير صحيح' });

  // منح رمز إعادة تعيين مؤقت
  const resetToken = crypto.randomBytes(16).toString('hex');
  otpStore.set('reset_' + national_id.trim(), { resetToken, expiry: Date.now() + 10 * 60 * 1000 });
  otpStore.delete(national_id.trim());

  res.json({ success:true, reset_token: resetToken });
};

// خطوة 3: تغيير كلمة المرور
exports.resetPassword = async (req, res) => {
  const { national_id, reset_token, new_password } = req.body;
  if (!national_id || !reset_token || !new_password)
    return res.status(400).json({ success:false, message:'بيانات ناقصة' });
  if (new_password.length < 8)
    return res.status(400).json({ success:false, message:'كلمة المرور 8 أحرف على الأقل' });

  const record = otpStore.get('reset_' + national_id.trim());
  if (!record || record.resetToken !== reset_token || Date.now() > record.expiry)
    return res.status(400).json({ success:false, message:'انتهت الجلسة — أعد عملية نسيان كلمة المرور' });

  try {
    const hash = await bcrypt.hash(new_password, 10);
    db.prepare(`UPDATE users SET password_hash=? WHERE national_id=? AND role='CITIZEN'`).run(hash, national_id.trim());
    otpStore.delete('reset_' + national_id.trim());
    res.json({ success:true, message:'تم تغيير كلمة المرور بنجاح' });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
};

// REG_CHIEF — تفاصيل طلب مواطن
exports.getRequest = (req, res) => {
  try {
    const cr = db.prepare(`
      SELECT cr.*, u.username, u.national_id as user_nid
      FROM citizen_registrations cr
      LEFT JOIN users u ON u.id=cr.user_id
      WHERE cr.id=? OR cr.review_number=?
    `).get(req.params.id, req.params.id);
    if (!cr) return res.status(404).json({ success:false, message:'الطلب غير موجود' });
    res.json({ success:true, data:cr });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
};

// Cron: فحص مهل 7 أيام
exports.checkReportDeadlines = () => {
  try {
    const nowStr = now();
    const expired = db.prepare(`
      SELECT * FROM citizen_reports
      WHERE status='pending' AND deadline_at < ? AND violation_issued=0
    `).all(nowStr);

    for (const r of expired) {
      // إصدار مخالفة تلقائية
      const noPlateType = db.prepare("SELECT id,fine_amount FROM violation_types WHERE code IN ('NO_PLATE','EXPIRED') LIMIT 1").get();
      if (noPlateType) {
        db.prepare(`INSERT INTO violations(vehicle_id,violation_type_id,description,status,issued_at)VALUES(?,?,?,?,?)`)
          .run(r.vehicle_id, noPlateType.id, `انتهاء مهلة ${r.report_type==='lost_plate'?'ضياع اللوحة':r.report_type==='sale_suspension'?'تعليق البيع':'البلاغ'}`, 'unpaid', nowStr);
      }
      db.prepare('UPDATE citizen_reports SET violation_issued=1,status="expired" WHERE id=?').run(r.id);

      // إعادة المركبة للحالة الطبيعية
      if (r.report_type === 'sale_suspension') {
        db.prepare("UPDATE vehicles SET status='active' WHERE id=?").run(r.vehicle_id);
      }
    }
    if (expired.length > 0) console.log(`[Cron] ${expired.length} report deadlines expired`);
  } catch(e) {
    console.error('[Cron Reports]', e.message);
  }
};

// تحديث حالة طلب المواطن إلى مكتمل
exports.completeRequest = (req, res) => {
  try {
    db.prepare("UPDATE citizen_registrations SET status='completed',reviewed_by=?,reviewed_at=? WHERE id=?")
      .run(req.user.id, new Date().toISOString().replace('T',' ').split('.')[0], req.params.id);
    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};
