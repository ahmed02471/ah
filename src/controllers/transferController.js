/**
 * transferController.js — نقل الملكية
 * المسار: تعليق → REG_CHIEF → ADMIN → REG_CHIEF (بيانات مشتري) → ADMIN → PLATE_DEPT
 */
const db     = require('../config/database');
const crypto = require('crypto');

function generatePlate(vehicleType) {
  const isTransport = ['سيارة نقل بضائع','سيارة جرارة','مركبة مقطورة'].includes(vehicleType);
  for (let i=0; i<30; i++) {
    const num   = Math.floor(10000 + Math.random()*89999);
    const plate = `${num} - 1 - LBY${isTransport?' - TR':''}`;
    if (!db.prepare('SELECT id FROM vehicles WHERE plate_number=?').get(plate)) return plate;
  }
  throw new Error('تعذّر توليد لوحة فريدة');
}

function notify(uid, title, body, type, refId) {
  try { db.prepare('INSERT INTO notifications(user_id,title,body,type,reference_id)VALUES(?,?,?,?,?)').run(uid,title,body,type,refId); } catch(_){}
}
function notifyRole(role, title, body, type, refId) {
  try { const s=db.prepare('INSERT INTO notifications(user_id,title,body,type,reference_id)VALUES(?,?,?,?,?)');
    db.prepare('SELECT id FROM users WHERE role=? AND is_active=1').all(role).forEach(u=>s.run(u.id,title,body,type,refId)); } catch(_){}
}

// ══════════════════════════════════════════════════════════════════
// STEP 1 — تعليق اللوحة (بداية طلب النقل)
// ══════════════════════════════════════════════════════════════════
exports.suspend = (req, res) => {
  const { vehicle_id, notes } = req.body;
  if (!vehicle_id) return res.status(400).json({ success:false, message:'رقم المركبة مطلوب' });

  try {
    const v = db.prepare(`
      SELECT v.*, vo.owner_name, vo.owner_national_id
      FROM vehicles v
      LEFT JOIN vehicle_owners vo ON vo.vehicle_id=v.id AND vo.is_current=1
      WHERE v.id=?`).get(vehicle_id);
    if (!v) return res.status(404).json({ success:false, message:'المركبة غير موجودة' });
    if (v.status === 'suspended') return res.status(400).json({ success:false, message:'اللوحة مُعلَّقة مسبقاً' });

    // تحقق: لا مخالفات غير مدفوعة
    const unpaid = db.prepare("SELECT COUNT(*) as c FROM violations WHERE vehicle_id=? AND status='unpaid'").get(vehicle_id).c;
    if (unpaid > 0) return res.status(400).json({ success:false, message:`لا يمكن التعليق — يوجد ${unpaid} مخالفة غير مدفوعة` });

    // تحقق: لا امتياز نشط
    const lien = db.prepare('SELECT id FROM liens WHERE vehicle_id=? AND is_active=1').get(vehicle_id);
    if (lien) return res.status(400).json({ success:false, message:'لا يمكن التعليق — يوجد حق امتياز نشط' });

    // حساب المهلة (7 أيام)
    const now      = new Date();
    const deadline = new Date(now.getTime() + 7*24*60*60*1000);
    const nowStr   = now.toISOString().replace('T',' ').split('.')[0];
    const dlStr    = deadline.toISOString().replace('T',' ').split('.')[0];

    // إنشاء طلب النقل
    const tr = db.prepare(`
      INSERT INTO ownership_transfers
        (vehicle_id,from_owner_national_id,from_owner_name,old_plate_number,
         status,suspended_by,suspended_at,deadline_at,notes,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(vehicle_id, v.owner_national_id, v.owner_name, v.plate_number,
           'step1_suspended', req.user.id, nowStr, dlStr, notes||null, nowStr);

    // تعليق المركبة
    db.prepare("UPDATE vehicles SET status='suspended' WHERE id=?").run(vehicle_id);

    notifyRole('ADMIN','🔒 طلب تعليق لوحة',`${v.plate_number} — ${v.owner_name} — مهلة 7 أيام`,'transfer',tr.lastInsertRowid);
    notifyRole('REG_CHIEF','🔒 لوحة مُعلَّقة',`${v.plate_number} — ${v.owner_name} — أرسل طلب النقل للمدير`,'transfer',tr.lastInsertRowid);

    res.status(201).json({ success:true, data:{ transfer_id: tr.lastInsertRowid, deadline: dlStr } });
  } catch(e) { console.error(e); res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════════════
// STEP 2 — REG_CHIEF يُرسل طلب نقل للـ ADMIN
// ══════════════════════════════════════════════════════════════════
exports.submitToAdmin = (req, res) => {
  const { transfer_id, contract_writer_id, contract_number, notes } = req.body;
  if (!transfer_id) return res.status(400).json({ success:false, message:'رقم الطلب مطلوب' });

  try {
    const tr = db.prepare('SELECT * FROM ownership_transfers WHERE id=?').get(transfer_id);
    if (!tr) return res.status(404).json({ success:false, message:'الطلب غير موجود' });
    if (tr.status !== 'step1_suspended') return res.status(400).json({ success:false, message:'الطلب في مرحلة خاطئة' });

    const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(tr.vehicle_id);
    const now = new Date().toISOString().replace('T',' ').split('.')[0];

    db.prepare(`UPDATE ownership_transfers SET status='step2_pending_admin',reg_user_id=?,reg_submitted_at=?,contract_writer_id=?,contract_number=?,notes=? WHERE id=?`)
      .run(req.user.id, now, contract_writer_id||null, contract_number||null, notes||null, transfer_id);

    // رسالة للـ ADMIN
    const admin = db.prepare("SELECT id FROM users WHERE role='ADMIN' AND is_active=1 LIMIT 1").get();
    if (admin) {
      db.prepare(`INSERT INTO internal_messages(from_user_id,to_user_id,to_role,subject,body,msg_type,reference_id)VALUES(?,?,'ADMIN',?,?,'transfer_request',?)`)
        .run(req.user.id, admin.id,
          `طلب نقل ملكية — ${v?.plate_number} — ${tr.from_owner_name}`,
          `طلب نقل ملكية للمركبة:\n• اللوحة: ${v?.plate_number}\n• المالك الحالي (البائع): ${tr.from_owner_name} (${tr.from_owner_national_id})\n• المهلة حتى: ${tr.deadline_at}\n• محرر العقد: #${contract_writer_id||'—'}\n• رقم العقد: ${contract_number||'—'}\n\nيرجى الموافقة لإكمال إجراءات النقل.`,
          transfer_id);
      notify(admin.id,'📋 طلب نقل ملكية',`${v?.plate_number} — ${tr.from_owner_name}`,'transfer',transfer_id);
    }

    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════════════
// STEP 3 — ADMIN يوافق → REG_CHIEF يُدخل بيانات المشتري
// ══════════════════════════════════════════════════════════════════
exports.adminDecision = (req, res) => {
  const { transfer_id, decision, reason } = req.body;
  if (!transfer_id || !['approved','rejected'].includes(decision))
    return res.status(400).json({ success:false, message:'بيانات غير صحيحة' });

  try {
    const tr  = db.prepare('SELECT * FROM ownership_transfers WHERE id=?').get(transfer_id);
    if (!tr) return res.status(404).json({ success:false, message:'الطلب غير موجود' });

    const now = new Date().toISOString().replace('T',' ').split('.')[0];

    if (decision === 'rejected') {
      db.prepare("UPDATE ownership_transfers SET status='rejected',rejection_reason=?,admin_decision_by=?,admin_decision_at=? WHERE id=?")
        .run(reason||'', req.user.id, now, transfer_id);
      // إلغاء التعليق
      db.prepare("UPDATE vehicles SET status='active' WHERE id=?").run(tr.vehicle_id);
      if (tr.reg_user_id) notify(tr.reg_user_id,'❌ رُفض طلب النقل',`السبب: ${reason||'—'}`,'transfer',transfer_id);
      return res.json({ success:true });
    }

    // موافقة → REG_CHIEF يُدخل بيانات المشتري
    db.prepare("UPDATE ownership_transfers SET status='step3_approved',admin_decision_by=?,admin_decision_at=? WHERE id=?")
      .run(req.user.id, now, transfer_id);

    if (tr.reg_user_id) {
      notify(tr.reg_user_id,'✅ موافقة على نقل الملكية',
        `وافق المدير — أدخل بيانات المشتري لإكمال النقل`,'transfer',transfer_id);
      db.prepare(`INSERT INTO internal_messages(from_user_id,to_user_id,to_role,subject,body,msg_type,reference_id)VALUES(?,?,'REG_CHIEF',?,?,'transfer_request',?)`)
        .run(req.user.id, tr.reg_user_id,
          `✅ موافقة — أدخل بيانات المشتري`,
          `وافق المدير على نقل ملكية ${tr.old_plate_number}.\n\nيرجى إدخال بيانات المشتري (المالك الجديد) لإكمال الإجراءات.`,
          transfer_id);
    }

    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════════════
// STEP 4 — REG_CHIEF يُدخل بيانات المشتري → ADMIN للاعتماد النهائي
// ══════════════════════════════════════════════════════════════════
exports.submitBuyerData = (req, res) => {
  const {
    transfer_id,
    to_owner_national_id, to_owner_name, to_owner_id_card,
    to_owner_passport, to_driving_license, to_owner_phone, to_address
  } = req.body;

  if (!transfer_id || !to_owner_national_id || !to_owner_name)
    return res.status(400).json({ success:false, message:'بيانات المشتري ناقصة' });

  try {
    const tr = db.prepare('SELECT * FROM ownership_transfers WHERE id=?').get(transfer_id);
    if (!tr) return res.status(404).json({ success:false, message:'الطلب غير موجود' });
    if (tr.status !== 'step3_approved') return res.status(400).json({ success:false, message:'الطلب في مرحلة خاطئة' });

    const v        = db.prepare('SELECT * FROM vehicles WHERE id=?').get(tr.vehicle_id);
    const newPlate = generatePlate(v?.vehicle_type || 'سيارة خاصة');
    let newQr;
    for (let i = 0; i < 20; i++) {
      newQr = crypto.randomBytes(4).toString('hex').toUpperCase();
      if (!db.prepare('SELECT id FROM vehicles WHERE qr_token=?').get(newQr)) break;
    }
    const now      = new Date().toISOString().replace('T',' ').split('.')[0];

    db.prepare(`UPDATE ownership_transfers SET
      to_owner_national_id=?,to_owner_name=?,to_owner_id_card=?,
      to_owner_passport=?,to_driving_license=?,to_owner_phone=?,to_address=?,
      new_plate_number=?,new_qr_token=?,status='step4_pending_final',reg_submitted_at=?
      WHERE id=?`).run(
      to_owner_national_id,to_owner_name,to_owner_id_card||null,
      to_owner_passport||null,to_driving_license||null,to_owner_phone||null,to_address||null,
      newPlate, newQr, now, transfer_id
    );

    // رسالة للـ ADMIN للاعتماد النهائي
    const admin = db.prepare("SELECT id FROM users WHERE role='ADMIN' AND is_active=1 LIMIT 1").get();
    if (admin) {
      db.prepare(`INSERT INTO internal_messages(from_user_id,to_user_id,to_role,subject,body,msg_type,reference_id)VALUES(?,?,'ADMIN',?,?,'transfer_final',?)`)
        .run(req.user.id, admin.id,
          `طلب اعتماد نقل ملكية — ${tr.old_plate_number}`,
          `اكتملت بيانات نقل الملكية:\n\n• البائع: ${tr.from_owner_name} (${tr.from_owner_national_id})\n• المشتري: ${to_owner_name} (${to_owner_national_id})\n• اللوحة القديمة: ${tr.old_plate_number}\n• اللوحة الجديدة: ${newPlate}\n\nيرجى الاعتماد النهائي لإصدار اللوحة الجديدة.`,
          transfer_id);
      notify(admin.id,'📋 اعتماد نهائي لنقل ملكية',`${tr.from_owner_name} → ${to_owner_name} | لوحة: ${newPlate}`,'transfer',transfer_id);
    }

    res.json({ success:true, data:{ new_plate: newPlate } });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════════════
// STEP 5 — ADMIN الاعتماد النهائي → PLATE_DEPT
// ══════════════════════════════════════════════════════════════════
exports.finalApproval = (req, res) => {
  const { transfer_id, decision, reason } = req.body;
  if (!transfer_id || !['approved','rejected'].includes(decision))
    return res.status(400).json({ success:false, message:'بيانات غير صحيحة' });

  try {
    const tr  = db.prepare('SELECT * FROM ownership_transfers WHERE id=?').get(transfer_id);
    if (!tr) return res.status(404).json({ success:false, message:'الطلب غير موجود' });

    const now = new Date().toISOString().replace('T',' ').split('.')[0];

    if (decision === 'rejected') {
      db.prepare("UPDATE ownership_transfers SET status='rejected',rejection_reason=?,final_admin_by=?,final_admin_at=? WHERE id=?")
        .run(reason||'', req.user.id, now, transfer_id);
      db.prepare("UPDATE vehicles SET status='active' WHERE id=?").run(tr.vehicle_id);
      if (tr.reg_user_id) notify(tr.reg_user_id,'❌ رُفض الاعتماد النهائي',reason||'',' transfer',transfer_id);
      return res.json({ success:true });
    }

    db.prepare("UPDATE ownership_transfers SET status='step5_approved_for_plate',final_admin_by=?,final_admin_at=? WHERE id=?")
      .run(req.user.id, now, transfer_id);

    // إشعار PLATE_DEPT
    db.prepare(`INSERT INTO internal_messages(from_user_id,to_role,subject,body,msg_type,reference_id)VALUES(?,'PLATE_DEPT',?,?,'plate_request',?)`)
      .run(req.user.id,
        `أمر إصدار لوحة نقل ملكية — ${tr.new_plate_number}`,
        `وافق المدير على نقل ملكية:\n• البائع: ${tr.from_owner_name}\n• المشتري: ${tr.to_owner_name}\n• اللوحة الجديدة: ${tr.new_plate_number}\n\nاستلم رسم اللوحة (30 دينار) وأصدر اللوحة الجديدة.`,
        transfer_id);
    notifyRole('PLATE_DEPT','🏷️ أمر إصدار لوحة نقل',`${tr.from_owner_name} → ${tr.to_owner_name} | ${tr.new_plate_number}`,'transfer',transfer_id);

    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════════════
// STEP 6 — PLATE_DEPT يُصدر اللوحة الجديدة
// ══════════════════════════════════════════════════════════════════
exports.issuePlate = (req, res) => {
  const { transfer_id, fee_paid } = req.body;
  if (!transfer_id) return res.status(400).json({ success:false, message:'رقم الطلب مطلوب' });

  try {
    const tr = db.prepare('SELECT * FROM ownership_transfers WHERE id=?').get(transfer_id);
    if (!tr) return res.status(404).json({ success:false, message:'الطلب غير موجود' });
    if (tr.status !== 'step5_approved_for_plate') return res.status(400).json({ success:false, message:'الطلب لم يحصل على اعتماد نهائي' });

    const now = new Date().toISOString().replace('T',' ').split('.')[0];

    db.transaction(() => {
      // 1. تحديث بيانات المركبة (لوحة جديدة + QR جديد)
      db.prepare(`UPDATE vehicles SET plate_number=?,qr_token=?,status='active' WHERE id=?`)
        .run(tr.new_plate_number, tr.new_qr_token, tr.vehicle_id);

      // 2. إلغاء المالك القديم (is_current = 0)
      db.prepare(`UPDATE vehicle_owners SET is_current=0,transfer_date=? WHERE vehicle_id=? AND is_current=1`)
        .run(now, tr.vehicle_id);

      // 3. إضافة المالك الجديد (is_current = 1)
      db.prepare(`INSERT INTO vehicle_owners
        (vehicle_id,owner_national_id,owner_name,owner_id_card,owner_passport,
         driving_license,phone,address,is_current)
        VALUES(?,?,?,?,?,?,?,?,1)`).run(
        tr.vehicle_id,tr.to_owner_national_id,tr.to_owner_name,
        tr.to_owner_id_card||null,tr.to_owner_passport||null,
        tr.to_driving_license||null,tr.to_owner_phone||null,tr.to_address||null
      );

      // 4. إغلاق طلب النقل
      db.prepare(`UPDATE ownership_transfers SET status='completed',plate_issued_by=?,plate_issued_at=? WHERE id=?`)
        .run(req.user.id, now, transfer_id);
    })();

    // ── حجز اللوحة القديمة للمالك البائع لمدة 90 يوماً ────────
    try {
      const expires = new Date();
      expires.setDate(expires.getDate() + 90);
      const expiresStr = expires.toISOString().replace('T',' ').split('.')[0];
      // إلغاء أي حجوزات سابقة لنفس اللوحة
      db.prepare(`UPDATE plate_reservations SET status='expired' WHERE old_plate_number=? AND status='active'`)
        .run(tr.old_plate_number);
      db.prepare(`
        INSERT INTO plate_reservations
          (owner_national_id, owner_name, old_plate_number, transfer_id, reserved_at, expires_at, status)
        VALUES (?, ?, ?, ?, ?, ?, 'active')
      `).run(
        tr.from_owner_national_id,
        tr.from_owner_name,
        tr.old_plate_number,
        transfer_id,
        now,
        expiresStr
      );
      // إشعار المالك القديم
      const oldUser = db.prepare("SELECT id FROM users WHERE national_id=? AND role='CITIZEN'").get(tr.from_owner_national_id);
      if (oldUser) notify(oldUser.id,
        '🏷️ لوحتك محجوزة لك',
        `تم حجز اللوحة ${tr.old_plate_number} باسمك لمدة 90 يوماً — يمكنك استخدامها عند تسجيل مركبة جديدة`,
        'transfer', tr.id
      );
    } catch(e) { console.warn('[PlateReservation]', e.message); }

    // إشعار المالك الجديد (إن كان له حساب)
    const newUser = db.prepare("SELECT id FROM users WHERE national_id=? AND role='CITIZEN'").get(tr.to_owner_national_id);
    if (newUser) notify(newUser.id,'🎉 تم نقل ملكية المركبة',`اللوحة الجديدة: ${tr.new_plate_number}`,'transfer',tr.id);

    res.json({ success:true, data:{ new_plate: tr.new_plate_number, transfer_id } });
  } catch(e) { console.error(e); res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════════════
// قائمة طلبات النقل
// ══════════════════════════════════════════════════════════════════
exports.list = (req, res) => {
  try {
    const { status } = req.query;
    let where = '';
    if (status) where = `WHERE t.status='${status}'`;
    else if (req.user.role === 'REG_CHIEF') where = `WHERE t.reg_user_id=${req.user.id} OR t.status='step1_suspended'`;
    else if (req.user.role === 'PLATE_DEPT') where = `WHERE t.status='step5_approved_for_plate'`;

    const items = db.prepare(`
      SELECT t.*, v.vehicle_type, v.make, v.model, v.year, v.color
      FROM ownership_transfers t
      LEFT JOIN vehicles v ON v.id=t.vehicle_id
      ${where} ORDER BY t.created_at DESC LIMIT 50`).all();
    res.json({ success:true, data: items });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.getById = (req, res) => {
  try {
    const tr = db.prepare(`
      SELECT t.*, v.vehicle_type,v.make,v.model,v.year,v.color,v.chassis_number,v.status as vehicle_status,
             u.full_name as reg_user_name
      FROM ownership_transfers t
      LEFT JOIN vehicles v ON v.id=t.vehicle_id
      LEFT JOIN users u ON u.id=t.reg_user_id
      WHERE t.id=?`).get(req.params.id);
    if (!tr) return res.status(404).json({ success:false, message:'الطلب غير موجود' });
    res.json({ success:true, data: tr });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════════════
// حق الامتياز
// ══════════════════════════════════════════════════════════════════
exports.listLiens = (req, res) => {
  try {
    const { vehicle_id } = req.query;
    const where = vehicle_id ? `WHERE l.vehicle_id=${vehicle_id}` : '';
    const liens = db.prepare(`
      SELECT l.*, v.plate_number, v.make, v.model,
             u1.full_name as added_by_name, u2.full_name as released_by_name
      FROM liens l
      LEFT JOIN vehicles v ON v.id=l.vehicle_id
      LEFT JOIN users u1 ON u1.id=l.added_by
      LEFT JOIN users u2 ON u2.id=l.released_by
      ${where} ORDER BY l.created_at DESC`).all();
    res.json({ success:true, data: liens });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.addLien = (req, res) => {
  const { vehicle_id, lien_holder_name, lien_holder_type, lien_amount, lien_date, notes } = req.body;
  if (!vehicle_id || !lien_holder_name) return res.status(400).json({ success:false, message:'اسم الجهة الدائنة ورقم المركبة مطلوبان' });
  try {
    const now = new Date().toISOString().replace('T',' ').split('.')[0];
    const info = db.prepare(`INSERT INTO liens(vehicle_id,lien_holder_name,lien_holder_type,lien_amount,lien_date,notes,is_active,added_by,created_at)VALUES(?,?,?,?,?,?,1,?,?)`)
      .run(vehicle_id, lien_holder_name, lien_holder_type||'بنك', lien_amount||null, lien_date||null, notes||null, req.user.id, now);

    const v = db.prepare('SELECT plate_number FROM vehicles WHERE id=?').get(vehicle_id);
    notifyRole('ADMIN','⚠️ حق امتياز جديد',`${v?.plate_number} — ${lien_holder_name}`,'lien',info.lastInsertRowid);

    res.status(201).json({ success:true, data:{ lien_id: info.lastInsertRowid } });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.releaseLien = (req, res) => {
  const { lien_id } = req.body;
  if (!lien_id) return res.status(400).json({ success:false, message:'رقم الامتياز مطلوب' });
  try {
    const now = new Date().toISOString().replace('T',' ').split('.')[0];
    const lien = db.prepare('SELECT * FROM liens WHERE id=?').get(lien_id);
    if (!lien) return res.status(404).json({ success:false, message:'الامتياز غير موجود' });

    db.prepare('UPDATE liens SET is_active=0,release_date=?,released_by=? WHERE id=?').run(now, req.user.id, lien_id);
    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// Cron: فحص انتهاء مهل التعليق كل ساعة
exports.checkDeadlines = () => {
  try {
    const now = new Date().toISOString().replace('T',' ').split('.')[0];
    const expired = db.prepare(`SELECT * FROM ownership_transfers WHERE status='step1_suspended' AND deadline_at < ?`).all(now);
    for (const tr of expired) {
      db.prepare("UPDATE ownership_transfers SET status='expired' WHERE id=?").run(tr.id);
      db.prepare("UPDATE vehicles SET status='active' WHERE id=?").run(tr.vehicle_id);
      // مخالفة NO_PLATE تلقائية
      const noPlateType = db.prepare("SELECT id FROM violation_types WHERE code='NO_PLATE' LIMIT 1").get();
      if (noPlateType) {
        db.prepare("INSERT INTO violations(vehicle_id,violation_type_id,description,status,issued_at)VALUES(?,?,?,?,?)")
          .run(tr.vehicle_id, noPlateType.id, 'انتهاء مهلة تعليق اللوحة دون إتمام النقل', 'unpaid', now);
      }
      notifyRole('REG_CHIEF','⚠️ انتهت مهلة التعليق',`${tr.old_plate_number} — ${tr.from_owner_name} — تم إصدار مخالفة`,'transfer',tr.id);
    }
  } catch(e) { console.error('[Cron Transfer]', e.message); }
};
