/**
 * vehicleController.js — نظام مرور سبها
 * المسار الصحيح النهائي (7 خطوات)
 */
const db     = require('../config/database');
const crypto = require('crypto');

// ── مساعدات ───────────────────────────────────────────────────────
function generatePlate(vehicleType) {
  const isTransport = ['سيارة نقل بضائع','سيارة جرارة','مركبة مقطورة'].includes(vehicleType);
  for (let i = 0; i < 30; i++) {
    const num   = Math.floor(10000 + Math.random() * 89999);
    const plate = `${num} - 1 - LBY${isTransport ? ' - TR' : ''}`;
    if (!db.prepare('SELECT id FROM vehicles WHERE plate_number=?').get(plate)) return plate;
  }
  throw new Error('تعذّر توليد رقم لوحة فريد');
}

function notify(userId, title, body, type='general', refId=null) {
  try { db.prepare('INSERT INTO notifications(user_id,title,body,type,reference_id)VALUES(?,?,?,?,?)').run(userId,title,body,type,refId); } catch(_){}
}

function notifyRole(role, title, body, type='general', refId=null) {
  try {
    const stmt = db.prepare('INSERT INTO notifications(user_id,title,body,type,reference_id)VALUES(?,?,?,?,?)');
    db.prepare("SELECT id FROM users WHERE role=? AND is_active=1").all(role)
      .forEach(u => stmt.run(u.id, title, body, type, refId));
  } catch(_){}
}

function sendMsg(fromId, toId, toRole, subject, body, type='general', refId=null) {
  return db.prepare(`INSERT INTO internal_messages(from_user_id,to_user_id,to_role,subject,body,msg_type,reference_id)VALUES(?,?,?,?,?,?,?)`)
    .run(fromId, toId||null, toRole||null, subject, body, type, refId||null);
}

function audit(req, action, table, id, details) {
  try { db.prepare('INSERT INTO audit_log(user_id,user_name,user_role,action,table_name,record_id,details,ip_address)VALUES(?,?,?,?,?,?,?,?)').run(req.user.id,req.user.name,req.user.role,action,table,id,details,req.ip||''); } catch(_){}
}

// ════════════════════════════════════════════════════════════════════
// STEP 1 — REG_CHIEF: تحقق من وثائق المالك وإرسال طلب للـ ADMIN
// ════════════════════════════════════════════════════════════════════
exports.step1_submitRequest = (req, res) => {
  const body = req.body || {};
  const citizen_national_id = (body.citizen_national_id || '').trim();
  const admin_number        = (body.admin_number || '').trim();
  const citizen_name        = (body.citizen_name || '').trim();
  const owner_id_card       = (body.owner_id_card || '').trim();
  const owner_passport      = (body.owner_passport || '').trim();
  const driving_license     = (body.driving_license || '').trim();
  const owner_phone         = (body.owner_phone || '').trim();
  const address             = (body.address || '').trim();
  const notes               = (body.notes || '').trim();
  const photo_base64            = body.photo_base64 || null;
  const citizen_review_number   = (body.citizen_review_number || '').trim();

  // قبول الرقم الوطني أو الرقم الإداري
  const id_number = citizen_national_id || admin_number;
  if (!id_number || !citizen_name)
    return res.status(400).json({ success:false, message:'الاسم الكامل ورقم التعريف (الوطني أو الإداري) مطلوبان' });

  // التحقق من الرقم الوطني فقط إذا تم إدخاله
  if (citizen_national_id && !/^\d{12}$/.test(citizen_national_id))
    return res.status(400).json({ success:false, message:'الرقم الوطني يجب أن يكون 12 رقماً' });

  // حفظ الصورة من Base64 إن وجدت
  let photo_path = null;
  if (photo_base64 && photo_base64.startsWith('data:image')) {
    try {
      const fs     = require('fs');
      const path   = require('path');
      const crypto = require('crypto');
      const UPLOAD_PATH = process.env.UPLOAD_PATH || './uploads';
      if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH, { recursive: true });
      const ext  = photo_base64.match(/data:image\/(\w+);/)?.[1] || 'jpg';
      const filename = crypto.randomUUID() + '.' + ext;
      const base64Data = photo_base64.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(path.join(UPLOAD_PATH, filename), base64Data, 'base64');
      photo_path = `/uploads/${filename}`;
    } catch(e) { console.error('Photo save error:', e.message); }
  }

  try {
    const admin = db.prepare("SELECT id FROM users WHERE role='ADMIN' AND is_active=1 LIMIT 1").get();
    if (!admin) return res.status(404).json({ success:false, message:'لا يوجد مدير نشط' });

    // إذا وُجد رقم مراجعة، استرجع الرقم الوطني من بيانات المواطن
    let linked_national_id = id_number;
    if (citizen_review_number) {
      const cr = db.prepare('SELECT national_id FROM citizen_registrations WHERE review_number=?').get(citizen_review_number);
      if (cr?.national_id) linked_national_id = cr.national_id;
    }

    // حفظ بيانات المالك مؤقتاً
    const pending = db.prepare(`
      INSERT INTO pending_vehicle_data
        (from_user_id, to_role, owner_national_id, owner_name, owner_id_card,
         owner_passport, driving_license, address, owner_phone, notes, photo_path,
         citizen_review_number, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'step1_pending_admin')
    `).run(req.user.id,'ADMIN',linked_national_id,citizen_name,
          owner_id_card||null,owner_passport||null,driving_license||null,
          address||null,owner_phone||null,notes||null,photo_path||null,
          citizen_review_number||null);

    // رسالة رسمية للـ ADMIN
    const msg = sendMsg(req.user.id, admin.id, 'ADMIN',
      `📋 طلب تسجيل مركبة — ${citizen_name}`,
      `تقدّم المواطن ${citizen_name} (${citizen_national_id}) بطلب تسجيل مركبة.\n\nالوثائق المستلمة:\n• البطاقة: ${owner_id_card||'—'}\n• جواز السفر: ${owner_passport||'—'}\n• رخصة القيادة: ${driving_license||'—'}\n\nملاحظات: ${notes||'لا توجد'}\n\nرقم الطلب: #${pending.lastInsertRowid}`,
      'registration_request'
    );
    notify(admin.id,'📋 طلب تسجيل مركبة جديد',`${citizen_name} — يرجى المراجعة والموافقة`,'registration',pending.lastInsertRowid);
    audit(req,'STEP1_SUBMIT','pending_vehicle_data',pending.lastInsertRowid,`طلب تسجيل: ${citizen_name}`);

    res.status(201).json({ success:true, data:{ pending_id: pending.lastInsertRowid } });
  } catch(e) { console.error(e); res.status(500).json({ success:false, message:e.message }); }
};

// ════════════════════════════════════════════════════════════════════
// STEP 2 — ADMIN: موافقة أو رفض
// ════════════════════════════════════════════════════════════════════
exports.step2_adminDecision = (req, res) => {
  const { pending_id, decision, reason } = req.body;
  if (!pending_id || !['approved','rejected'].includes(decision))
    return res.status(400).json({ success:false, message:'بيانات غير صحيحة' });

  try {
    const pending = db.prepare('SELECT * FROM pending_vehicle_data WHERE id=?').get(pending_id);
    if (!pending) return res.status(404).json({ success:false, message:'الطلب غير موجود' });
    // قبول الحالات المختلفة الممكنة
    const validStatuses = ['step1_pending_admin', 'pending', 'new', null, ''];
    if (pending.status && !validStatuses.includes(pending.status) && pending.status.includes('step2')) {
      return res.status(400).json({ success:false, message:'تمت معالجة هذا الطلب مسبقاً' });
    }
    if (pending.status && !validStatuses.includes(pending.status) && !pending.status.includes('step1')) {
      return res.status(400).json({ success:false, message:`الطلب في مرحلة: ${pending.status}` });
    }

    const newStatus = decision==='approved' ? 'step2_approved' : 'rejected';
    db.prepare("UPDATE pending_vehicle_data SET status=?,actioned_at=datetime('now') WHERE id=?")
      .run(newStatus, pending_id);

    // إشعار REG_CHIEF بالنتيجة
    const regChief = db.prepare('SELECT id FROM users WHERE id=?').get(pending.from_user_id);
    if (regChief) {
      if (decision==='approved') {
        sendMsg(req.user.id, regChief.id, 'REG_CHIEF',
          `✅ تمت الموافقة — أرسل بيانات المالك لقسم الفحص`,
          `وافق المدير على طلب تسجيل المواطن ${pending.owner_name}.\n\nاضغط الزر أدناه لإرسال بيانات المالك لقسم الفحص الفني.\nرقم الطلب: #${pending_id}`,
          'step2_approved', pending_id
        );
        notify(regChief.id,'✅ موافقة على طلب التسجيل',`${pending.owner_name} — أرسل بيانات المالك لقسم الفحص`,'registration',pending_id);
      } else {
        sendMsg(req.user.id, regChief.id, 'REG_CHIEF',
          `❌ رفض طلب تسجيل — ${pending.owner_name}`,
          `تم رفض طلب تسجيل المواطن ${pending.owner_name}.\nالسبب: ${reason||'—'}`
        );
        notify(regChief.id,'❌ رفض طلب التسجيل',`${pending.owner_name} — ${reason||''}`, 'registration', pending_id);
      }
    }
    audit(req,'STEP2_DECISION','pending_vehicle_data',pending_id,`${decision}: ${pending.owner_name}`);
    res.json({ success:true, data:{ decision, pending_id } });
  } catch(e) { console.error(e); res.status(500).json({ success:false, message:e.message }); }
};

// ════════════════════════════════════════════════════════════════════
// STEP 3 — REG_CHIEF: إرسال بيانات المالك لـ INSP_CHIEF
// ════════════════════════════════════════════════════════════════════
exports.step3_sendToInspection = (req, res) => {
  const { pending_id } = req.body;
  if (!pending_id) return res.status(400).json({ success:false, message:'رقم الطلب مطلوب' });

  try {
    const pending = db.prepare('SELECT * FROM pending_vehicle_data WHERE id=?').get(pending_id);
    if (!pending) return res.status(404).json({ success:false, message:'الطلب غير موجود' });
    if (pending.status !== 'step2_approved')
      return res.status(400).json({ success:false, message:'يجب أن يحصل الطلب على موافقة المدير أولاً' });

    const insp = db.prepare("SELECT id FROM users WHERE role='INSP_CHIEF' AND is_active=1 LIMIT 1").get();
    if (!insp) return res.status(404).json({ success:false, message:'لا يوجد رئيس فحص نشط' });

    db.prepare("UPDATE pending_vehicle_data SET to_user_id=?,status='step3_at_inspection',actioned_at=datetime('now') WHERE id=?")
      .run(insp.id, pending_id);

    // رسالة لـ INSP_CHIEF ببيانات المالك
    sendMsg(req.user.id, insp.id, 'INSP_CHIEF',
      `🔧 طلب فحص فني — ${pending.owner_name}`,
      `بيانات المالك:\n• الاسم: ${pending.owner_name}\n• الرقم الوطني: ${pending.owner_national_id}\n• رخصة القيادة: ${pending.driving_license||'—'}\n• الهاتف: ${pending.owner_phone||'—'}\n• العنوان: ${pending.address||'—'}\n\nيرجى إجراء الفحص الفني وإدخال بيانات المركبة وإرسالها لقسم التسجيل.\nرقم الطلب: #${pending_id}`,
      'inspection_request'
    );
    // إشعار INSP_CHIEF
    notify(insp.id,'🔧 طلب فحص فني جديد',`${pending.owner_name} — أدخل بيانات المركبة وأرسلها لقسم التسجيل`,'inspection',pending_id);

    audit(req,'STEP3_SEND_TO_INSP','pending_vehicle_data',pending_id,`إرسال لـ INSP_CHIEF: ${pending.owner_name}`);
    res.json({ success:true, data:{ pending_id } });
  } catch(e) { console.error(e); res.status(500).json({ success:false, message:e.message }); }
};

// ════════════════════════════════════════════════════════════════════
// STEP 4 — INSP_CHIEF: إدخال بيانات المركبة والفحص → إرسال لـ REG_CHIEF
// ════════════════════════════════════════════════════════════════════
exports.step4_inspectionComplete = (req, res) => {
  const {
    pending_id,
    // بيانات المركبة
    chassis_number, engine_number, vehicle_type, make, model, year,
    color, country_of_origin, fuel_type, cylinders, passenger_count, usage_type,
    // بيانات الفحص
    inspection_result, inspection_notes, inspection_fee,
    inspection_valid_until, inspector_name
  } = req.body;

  if (!pending_id || !chassis_number || !vehicle_type || !make || !model || !year || !inspection_result)
    return res.status(400).json({ success:false, message:'بيانات المركبة والفحص مطلوبة' });

  try {
    const pending = db.prepare('SELECT * FROM pending_vehicle_data WHERE id=?').get(pending_id);
    if (!pending) return res.status(404).json({ success:false, message:'الطلب غير موجود' });
    if (pending.status !== 'step3_at_inspection')
      return res.status(400).json({ success:false, message:'الطلب ليس في مرحلة الفحص' });

    // تحقق من عدم تكرار رقم الهيكل
    if (db.prepare('SELECT id FROM vehicles WHERE chassis_number=?').get(chassis_number))
      return res.status(400).json({ success:false, message:'رقم الهيكل مسجل مسبقاً' });

    // حفظ بيانات المركبة والفحص
    const vehicleData = JSON.stringify({ chassis_number, engine_number, vehicle_type, make, model, year, color, country_of_origin, fuel_type, cylinders, passenger_count, usage_type });
    const inspData    = JSON.stringify({ inspection_result, inspection_notes, inspection_fee, inspection_valid_until, inspector_name });

    db.prepare(`UPDATE pending_vehicle_data SET vehicle_data=?,inspection_data=?,status='step4_back_to_reg',actioned_at=datetime('now') WHERE id=?`)
      .run(vehicleData, inspData, pending_id);

    // إرسال لـ REG_CHIEF مع كل البيانات
    const regUser = db.prepare('SELECT id FROM users WHERE id=?').get(pending.from_user_id);
    if (regUser) {
      sendMsg(req.user.id, regUser.id, 'REG_CHIEF',
        `✅ اكتمل الفحص الفني — ${pending.owner_name}`,
        `اكتمل الفحص الفني للمواطن ${pending.owner_name}.\n\nنتيجة الفحص: ${inspection_result}\nالمركبة: ${make} ${model} ${year} (${color})\nرقم الهيكل: ${chassis_number}\n\nيرجى مراجعة البيانات وإدخال البل وتوليد اللوحة.\nرقم الطلب: #${pending_id}`,
        'inspection_result'
      );
      // إشعار REG_CHIEF
      notify(regUser.id,'✅ اكتمل الفحص الفني',`${pending.owner_name} — أدخل البل وولّد اللوحة`,'inspection',pending_id);
    }

    audit(req,'STEP4_INSPECTION','pending_vehicle_data',pending_id,`فحص: ${inspection_result} — ${make} ${model}`);
    res.json({ success:true, data:{ pending_id } });
  } catch(e) { console.error(e); res.status(500).json({ success:false, message:e.message }); }
};

// ════════════════════════════════════════════════════════════════════
// STEP 5 — REG_CHIEF: إدخال البل + توليد اللوحة + QR → إرسال للـ ADMIN
// ════════════════════════════════════════════════════════════════════
exports.step5_generatePlate = (req, res) => {
  const { pending_id, bel_number, bel_fee, bel_valid_until, insurance, reserved_plate } = req.body;

  if (!pending_id || !bel_valid_until)
    return res.status(400).json({ success:false, message:'رقم الطلب وتاريخ انتهاء البل مطلوبان' });

  try {
    const pending = db.prepare('SELECT * FROM pending_vehicle_data WHERE id=?').get(pending_id);
    if (!pending) return res.status(404).json({ success:false, message:'الطلب غير موجود' });
    if (pending.status !== 'step4_back_to_reg')
      return res.status(400).json({ success:false, message:'الطلب لم يصل بعد من قسم الفحص' });

    const vehicleData = JSON.parse(pending.vehicle_data || '{}');
    const belData     = JSON.stringify({ bel_number, bel_fee, bel_valid_until });

    // توليد اللوحة + QR
    let plate_number;
    if (reserved_plate) {
      // التحقق من صحة اللوحة المحجوزة
      const res_ = db.prepare(`
        SELECT id FROM plate_reservations
        WHERE old_plate_number=? AND owner_national_id=? AND status='active'
          AND expires_at > datetime('now')
      `).get(reserved_plate, pending.owner_national_id);
      if (!res_) return res.status(400).json({ success:false, message:'اللوحة المحجوزة غير صالحة أو انتهت مدتها' });
      const conflict = db.prepare('SELECT id FROM vehicles WHERE plate_number=?').get(reserved_plate);
      if (conflict) return res.status(400).json({ success:false, message:'رقم اللوحة مستخدم مسبقاً' });
      plate_number = reserved_plate;
      // تحديث حالة الحجز
      db.prepare(`UPDATE plate_reservations SET status='used', used_for_vehicle=NULL WHERE old_plate_number=? AND owner_national_id=?`)
        .run(reserved_plate, pending.owner_national_id);
    } else {
      plate_number = generatePlate(vehicleData.vehicle_type);
    }
    // توليد qr_token فريد
    let qr_token;
    for (let i = 0; i < 20; i++) {
      qr_token = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 أحرف فقط
      if (!db.prepare('SELECT id FROM vehicles WHERE qr_token=?').get(qr_token)) break;
    }

    db.prepare(`UPDATE pending_vehicle_data SET bel_data=?,plate_number=?,qr_token=?,status='step5_pending_final_approval',actioned_at=datetime('now') WHERE id=?`)
      .run(belData, plate_number, qr_token, pending_id);

    // رسالة للـ ADMIN للموافقة النهائية
    const admin = db.prepare("SELECT id FROM users WHERE role='ADMIN' AND is_active=1 LIMIT 1").get();
    const inspData = JSON.parse(pending.inspection_data || '{}');
    if (admin) {
      sendMsg(req.user.id, admin.id, 'ADMIN',
        `📋 طلب موافقة نهائية — ${pending.owner_name}`,
        `اكتملت إجراءات تسجيل المركبة:\n\n👤 المالك: ${pending.owner_name} (${pending.owner_national_id})\n🚗 المركبة: ${vehicleData.make} ${vehicleData.model} ${vehicleData.year}\n🔩 الهيكل: ${vehicleData.chassis_number}\n🏁 اللوحة المولَّدة: ${plate_number}\n🔍 الفحص: ${inspData.inspection_result}\n📄 البل حتى: ${bel_valid_until}\n\nرقم الطلب: #${pending_id}\n\nيرجى مراجعة البيانات والموافقة النهائية.`,
        'final_approval'
      );
      notify(admin.id,'📋 طلب موافقة نهائية',`${pending.owner_name} — لوحة: ${plate_number}`,'registration',pending_id);
    }

    audit(req,'STEP5_GENERATE_PLATE','pending_vehicle_data',pending_id,`لوحة: ${plate_number}`);
    res.json({ success:true, data:{ pending_id, plate_number, qr_token } });
  } catch(e) { console.error(e); res.status(500).json({ success:false, message:e.message }); }
};

// ════════════════════════════════════════════════════════════════════
// STEP 6 — ADMIN: موافقة نهائية → إرسال لـ PLATE_DEPT
// ════════════════════════════════════════════════════════════════════
exports.step6_finalApproval = (req, res) => {
  const { pending_id, decision, reason } = req.body;
  if (!pending_id || !['approved','rejected'].includes(decision))
    return res.status(400).json({ success:false, message:'بيانات غير صحيحة' });

  try {
    const pending = db.prepare('SELECT * FROM pending_vehicle_data WHERE id=?').get(pending_id);
    if (!pending) return res.status(404).json({ success:false, message:'الطلب غير موجود' });
    if (pending.status !== 'step5_pending_final_approval')
      return res.status(400).json({ success:false, message:'الطلب ليس في مرحلة الموافقة النهائية' });

    if (decision === 'rejected') {
      db.prepare("UPDATE pending_vehicle_data SET status='rejected',actioned_at=datetime('now') WHERE id=?").run(pending_id);
      const regUser = db.prepare('SELECT id FROM users WHERE id=?').get(pending.from_user_id);
      if (regUser) notify(regUser.id,'❌ رُفض الطلب',`${pending.owner_name} — ${reason||''}`, 'registration', pending_id);
      return res.json({ success:true, data:{ decision:'rejected' } });
    }

    // موافقة — إرسال لـ PLATE_DEPT
    db.prepare("UPDATE pending_vehicle_data SET status='step6_approved_for_plate',actioned_at=datetime('now') WHERE id=?").run(pending_id);
    const vData = JSON.parse(pending.vehicle_data||'{}');

    sendMsg(req.user.id, null, 'PLATE_DEPT',
      `🖨️ أمر طباعة لوحة — ${pending.owner_name}`,
      `صدر أمر طباعة اللوحة:\n\n🏁 رقم اللوحة: ${pending.plate_number}\n👤 المالك: ${pending.owner_name}\n🚗 المركبة: ${vData.make} ${vData.model} ${vData.year}\n\nيرجى استلام رسم الطباعة (30 دينار) وطباعة اللوحة.\nرقم الطلب: #${pending_id}`,
      'plate_request'
    );
    notifyRole('PLATE_DEPT','🖨️ أمر طباعة لوحة جديد',`${pending.owner_name} — ${pending.plate_number} — استلم 30 دينار`,'registration',pending_id);
    notifyRole('REG_CHIEF','✅ اعتماد نهائي',`${pending.owner_name} — ${pending.plate_number} — تم إرسال أمر الطباعة`,'registration',pending_id);

    audit(req,'STEP6_FINAL_APPROVAL','pending_vehicle_data',pending_id,`موافقة نهائية: ${pending.plate_number}`);
    res.json({ success:true, data:{ pending_id, plate_number: pending.plate_number } });
  } catch(e) { console.error(e); res.status(500).json({ success:false, message:e.message }); }
};

// ════════════════════════════════════════════════════════════════════
// STEP 7 — PLATE_DEPT: إصدار اللوحة وحفظ المركبة نهائياً
// ════════════════════════════════════════════════════════════════════
exports.step7_issuePlate = (req, res) => {
  const { pending_id, fee_paid } = req.body;
  if (!pending_id) return res.status(400).json({ success:false, message:'رقم الطلب مطلوب' });

  try {
    const pending = db.prepare('SELECT * FROM pending_vehicle_data WHERE id=?').get(pending_id);
    if (!pending) return res.status(404).json({ success:false, message:'الطلب غير موجود' });
    if (pending.status !== 'step6_approved_for_plate')
      return res.status(400).json({ success:false, message:'الطلب لم يحصل على موافقة نهائية بعد' });

    const vData    = JSON.parse(pending.vehicle_data   || '{}');
    const inspData = JSON.parse(pending.inspection_data|| '{}');
    const belData  = JSON.parse(pending.bel_data       || '{}');

    // تحقق إذا المركبة موجودة مسبقاً (تجنب UNIQUE constraint)
    const existingVehicle = db.prepare('SELECT id FROM vehicles WHERE qr_token=? OR plate_number=?').get(pending.qr_token, pending.plate_number);
    
    let vehicleId;
    if (existingVehicle) {
      // تحديث بدل INSERT
      vehicleId = existingVehicle.id;
      db.prepare(`UPDATE vehicles SET status='active',registration_status='approved',registered_by=?,registered_at=datetime('now') WHERE id=?`)
        .run(req.user.id, vehicleId);
    } else {
      // إنشاء مركبة جديدة
      const vehicle = db.prepare(`
        INSERT INTO vehicles
          (chassis_number,engine_number,vehicle_type,make,model,year,color,
           country_of_origin,fuel_type,cylinders,passenger_count,usage_type,
           plate_number,qr_token,status,registration_status,registered_by,registered_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active','approved',?,datetime('now'))
      `).run(
        vData.chassis_number, vData.engine_number||null, vData.vehicle_type,
        vData.make, vData.model, vData.year, vData.color,
        vData.country_of_origin||null, vData.fuel_type||null,
        vData.cylinders||null, vData.passenger_count||null, vData.usage_type||null,
        pending.plate_number, pending.qr_token,
        req.user.id
      );
      vehicleId = vehicle.lastInsertRowid;
    }

    // ربط المالك
    db.prepare(`INSERT INTO vehicle_owners(vehicle_id,owner_national_id,owner_name,owner_id_card,owner_passport,driving_license,address,phone,is_current)VALUES(?,?,?,?,?,?,?,?,1)`)
      .run(vehicleId,pending.owner_national_id,pending.owner_name,pending.owner_id_card||null,pending.owner_passport||null,pending.driving_license||null,pending.address||null,pending.owner_phone||null);

    // حفظ الفحص
    if (inspData.inspection_result) {
      // إدخال بيانات الفحص مع التحقق من الأعمدة الموجودة
      const inspCols = db.prepare('PRAGMA table_info(technical_inspections)').all().map(r=>r.name);
      if (inspCols.includes('fee')) {
        db.prepare(`INSERT INTO technical_inspections(vehicle_id,inspection_date,result,notes,fee,valid_until,inspector_name)VALUES(?,date('now'),?,?,?,?,?)`)
          .run(vehicleId,inspData.inspection_result,inspData.inspection_notes||null,inspData.inspection_fee||null,inspData.inspection_valid_until||null,inspData.inspector_name||null);
      } else {
        db.prepare(`INSERT INTO technical_inspections(vehicle_id,inspection_date,result,notes,valid_until,inspector_name)VALUES(?,date('now'),?,?,?,?)`)
          .run(vehicleId,inspData.inspection_result,inspData.inspection_notes||null,inspData.inspection_valid_until||null,inspData.inspector_name||null);
      }
    }

    // حفظ البل
    if (belData.bel_valid_until) {
      db.prepare(`INSERT INTO vehicle_travel_permits(vehicle_id,permit_number,valid_from,valid_until,recorded_by)VALUES(?,?,date('now'),?,?)`)
        .run(vehicleId,belData.bel_number||null,belData.bel_valid_until,req.user.id);
    }

    // حفظ التأمين
    if (belData.insurance && belData.insurance.company_name && belData.insurance.valid_until) {
      db.prepare(`INSERT INTO vehicle_insurance(vehicle_id,company_name,policy_number,valid_from,valid_until,recorded_by)VALUES(?,?,?,?,?,?)`)
        .run(vehicleId, belData.insurance.company_name, belData.insurance.policy_number||null,
             belData.insurance.valid_from||null, belData.insurance.valid_until, req.user.id);
    }

    // إغلاق الطلب المؤقت
    db.prepare("UPDATE pending_vehicle_data SET status='completed',actioned_at=datetime('now') WHERE id=?").run(pending_id);

    // إشعار المواطن بإصدار اللوحة
    try {
      const citizenUser = db.prepare(
        "SELECT u.id, u.full_name, cr.email as citizen_email FROM users u LEFT JOIN citizen_registrations cr ON cr.user_id=u.id WHERE u.national_id=? AND u.role='CITIZEN' ORDER BY cr.id DESC LIMIT 1"
      ).get(pending.owner_national_id);

      if (citizenUser) {
        // إشعار داخلي
        db.prepare(`INSERT INTO notifications(user_id,title,body,type,reference_id,created_at) VALUES(?,?,?,?,?,datetime('now'))`)
          .run(citizenUser.id,
            '🎉 تم إصدار لوحة مركبتك!',
            `تهانينا ${pending.owner_name}! تم إصدار لوحة مركبتك بنجاح.\nرقم اللوحة: ${pending.plate_number}\nيمكنك الآن رؤية بيانات مركبتك في تطبيقك.`,
            'registration', vehicleId
          );

        // إيميل من citizen_registrations
        const emailTo = citizenUser.citizen_email;
        if (emailTo) {
          const { sendEmail } = require('../services/emailService');
          sendEmail(emailTo, 'plateIssued', citizenUser.full_name, pending.plate_number);
          console.log(`[Email] لوحة أُرسلت لـ ${emailTo}`);
        }
      }
    } catch(notifErr) {
      console.error('[Notify Citizen]', notifErr.message);
    }

    // إشعار المواطن إن كان مسجلاً
    const citizen = db.prepare("SELECT id FROM users WHERE national_id=? AND role='CITIZEN'").get(pending.owner_national_id);
    if (citizen) notify(citizen.id,'🎉 مركبتك جاهزة',`تم إصدار اللوحة ${pending.plate_number} — تفضل باستلامها`,'registration',vehicleId);

    audit(req,'STEP7_ISSUE_PLATE','vehicles',vehicleId,`لوحة: ${pending.plate_number}`);
    res.status(201).json({ success:true, data:{ vehicle_id:vehicleId, plate_number:pending.plate_number } });
  } catch(e) { console.error(e); res.status(500).json({ success:false, message:e.message }); }
};

// ════════════════════════════════════════════════════════════════════
// قائمة الطلبات المعلّقة (حسب الدور)
// ════════════════════════════════════════════════════════════════════
exports.listPending = (req, res) => {
  try {
    const role = req.user.role;
    let where = '';
    if      (role==='ADMIN')       where = "status IN ('step1_pending_admin','step5_pending_final_approval')";
    else if (role==='REG_CHIEF')   where = "status IN ('step2_approved','step4_back_to_reg')";
    else if (role==='INSP_CHIEF')  where = "status IN ('step3_at_inspection')";
    else if (role==='PLATE_DEPT')  where = "status IN ('step6_approved_for_plate')";
    else return res.json({ success:true, data:[] });

    const items = db.prepare(`SELECT pv.*, u.full_name as submitted_by_name FROM pending_vehicle_data pv LEFT JOIN users u ON u.id=pv.from_user_id WHERE ${where} ORDER BY pv.created_at DESC`).all();
    res.json({ success:true, data: items });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.getPendingById = (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM pending_vehicle_data WHERE id=?').get(req.params.id);
    if (!item) return res.status(404).json({ success:false, message:'الطلب غير موجود' });
    if (item.vehicle_data)    item.vehicle_data_parsed    = JSON.parse(item.vehicle_data);
    if (item.inspection_data) item.inspection_data_parsed = JSON.parse(item.inspection_data);
    if (item.bel_data)        item.bel_data_parsed        = JSON.parse(item.bel_data);
    res.json({ success:true, data: item });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ════════════════════════════════════════════════════════════════════
// باقي الدوال
// ════════════════════════════════════════════════════════════════════
exports.list = (req, res) => {
  try {
    const { q, page=1, limit=20, status, vehicle_type } = req.query;
    const offset = (page-1)*limit;
    let where='', params=[];
    if (req.user.role==='CITIZEN') {
      where='WHERE vo.owner_national_id=?'; params.push(req.user.national_id);
    } else {
      const conds=[];
      if (q)            { conds.push('(v.plate_number LIKE ? OR v.chassis_number LIKE ? OR vo.owner_name LIKE ?)'); params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
      if (status)        { conds.push('v.status=?'); params.push(status); }
      if (vehicle_type)  { conds.push('v.vehicle_type=?'); params.push(vehicle_type); }
      if (conds.length) where = 'WHERE ' + conds.join(' AND ');
    }

    const base = `FROM vehicles v LEFT JOIN vehicle_owners vo ON vo.vehicle_id=v.id AND vo.is_current=1`;
    const vehicles = db.prepare(`
      SELECT v.*, vo.owner_name, vo.owner_national_id,
        (SELECT COUNT(*) FROM violations WHERE vehicle_id=v.id AND status='unpaid') as unpaid_count,
        (SELECT SUM(fine_amount) FROM violations WHERE vehicle_id=v.id AND status='unpaid') as unpaid_total,
        (SELECT valid_until FROM vehicle_insurance WHERE vehicle_id=v.id ORDER BY recorded_at DESC LIMIT 1) as ins_expiry,
        (SELECT valid_until FROM vehicle_travel_permits WHERE vehicle_id=v.id ORDER BY recorded_at DESC LIMIT 1) as bel_expiry,
        (SELECT valid_until FROM technical_inspections WHERE vehicle_id=v.id ORDER BY inspection_date DESC LIMIT 1) as insp_expiry,
        (SELECT COUNT(*) FROM liens WHERE vehicle_id=v.id AND is_active=1) as active_liens
      ${base} ${where} ORDER BY v.registered_at DESC LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), parseInt(offset));
    res.json({ success:true, data:{ vehicles, total: vehicles.length } });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.getById = (req, res) => {
  try {
    const v = db.prepare(`
      SELECT v.*, vo.owner_name, vo.owner_national_id, vo.owner_id_card,
             vo.owner_passport, vo.driving_license, vo.address, vo.phone as owner_phone,
             (SELECT COUNT(*) FROM violations WHERE vehicle_id=v.id AND status='unpaid') as unpaid_count,
             (SELECT SUM(fine_amount) FROM violations WHERE vehicle_id=v.id AND status='unpaid') as unpaid_total
      FROM vehicles v LEFT JOIN vehicle_owners vo ON vo.vehicle_id=v.id AND vo.is_current=1
      WHERE v.id=?`).get(req.params.id);
    if (!v) return res.status(404).json({ success:false, message:'المركبة غير موجودة' });
    v.insurance  = db.prepare('SELECT * FROM vehicle_insurance WHERE vehicle_id=? ORDER BY recorded_at DESC LIMIT 1').get(v.id);
    v.bel        = db.prepare('SELECT * FROM vehicle_travel_permits WHERE vehicle_id=? ORDER BY recorded_at DESC LIMIT 1').get(v.id);
    v.inspection = db.prepare('SELECT * FROM technical_inspections WHERE vehicle_id=? ORDER BY inspection_date DESC LIMIT 1').get(v.id);
    v.violations = db.prepare(`SELECT vio.*,vt.name_ar as type_name FROM violations vio LEFT JOIN violation_types vt ON vt.id=vio.violation_type_id WHERE vio.vehicle_id=? ORDER BY vio.issued_at DESC`).all(v.id);

    const alerts=[];
    if (v.unpaid_count>0)                 alerts.push({level:'danger', msg:`${v.unpaid_count} مخالفة غير مدفوعة — ${v.unpaid_total||0} د.ل`});
    if (v.status==='suspended')           alerts.push({level:'warning',msg:`المركبة مُعلَّقة — قيد نقل الملكية`});
    if (v.status==='reported_stolen')     alerts.push({level:'danger', msg:`مُبلَّغ عن سرقة`});
    if (v.status==='reported_lost_plate') alerts.push({level:'danger', msg:`مُبلَّغ عن ضياع اللوحة`});
    v.alerts = alerts;

    res.json({ success:true, data:v });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.getByQr = (req, res) => {
  try {
    const v = db.prepare(`
      SELECT v.*, vo.owner_name, vo.owner_national_id, vo.owner_id_card,
             vo.driving_license, vo.photo_path as owner_photo,
             (SELECT valid_until FROM vehicle_insurance WHERE vehicle_id=v.id ORDER BY recorded_at DESC LIMIT 1) as ins_expiry,
             (SELECT valid_until FROM vehicle_travel_permits WHERE vehicle_id=v.id ORDER BY recorded_at DESC LIMIT 1) as bel_expiry,
             (SELECT valid_until FROM technical_inspections WHERE vehicle_id=v.id ORDER BY inspection_date DESC LIMIT 1) as insp_expiry,
             (SELECT COUNT(*) FROM violations WHERE vehicle_id=v.id AND status='unpaid') as unpaid_count,
             (SELECT SUM(fine_amount) FROM violations WHERE vehicle_id=v.id AND status='unpaid') as unpaid_total,
             (SELECT COUNT(*) FROM liens WHERE vehicle_id=v.id AND is_active=1) as active_liens
      FROM vehicles v LEFT JOIN vehicle_owners vo ON vo.vehicle_id=v.id AND vo.is_current=1
      WHERE v.qr_token=?`).get(req.params.token);
    if (!v) return res.status(404).json({ success:false, message:'QR غير صالح' });

    // آخر 5 مخالفات مع التواريخ
    const recent_violations = db.prepare(`
      SELECT vl.id, vl.fine_amount, vl.status, vl.issued_at, vl.paid_at,
             vt.name_ar as type_name
      FROM violations vl
      LEFT JOIN violation_types vt ON vt.id = vl.violation_type_id
      WHERE vl.vehicle_id=?
      ORDER BY vl.issued_at DESC LIMIT 5
    `).all(v.id);

    // تاريخ آخر نقل ملكية مكتمل
    const last_transfer = db.prepare(`
      SELECT to_owner_name, final_admin_at, new_plate_number
      FROM ownership_transfers
      WHERE vehicle_id=? AND status='completed'
      ORDER BY final_admin_at DESC LIMIT 1
    `).get(v.id);

    const today = new Date().toISOString().split('T')[0];
    const alerts=[];
    if (v.unpaid_count>0)                        alerts.push({level:'danger', msg:`${v.unpaid_count} مخالفة غير مدفوعة — ${v.unpaid_total} د.ل`});
    if (v.ins_expiry  && v.ins_expiry <today)    alerts.push({level:'danger', msg:`التأمين منتهٍ منذ ${v.ins_expiry}`});
    if (v.bel_expiry  && v.bel_expiry <today)    alerts.push({level:'danger', msg:`البل منتهٍ منذ ${v.bel_expiry}`});
    if (v.insp_expiry && v.insp_expiry<today)    alerts.push({level:'danger', msg:`الفحص الفني منتهٍ منذ ${v.insp_expiry}`});
    if (v.active_liens>0)                        alerts.push({level:'warning',msg:`يوجد حق امتياز نشط`});
    if (v.status==='suspended')                  alerts.push({level:'warning',msg:`المركبة مُعلَّقة — قيد نقل الملكية`});
    if (v.status==='reported_stolen')             alerts.push({level:'danger', msg:`مُبلَّغ عن سرقة`});
    if (v.status==='reported_lost_plate')         alerts.push({level:'danger', msg:`مُبلَّغ عن ضياع اللوحة`});

    global._lastQrScan = {...v, alerts};
    res.json({ success:true, data:{...v, alerts, recent_violations, last_transfer} });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.getVehicleTypes = (req, res) => {
  res.json({ success:true, data:['سيارة خاصة','سيارة ركوب عامة','سيارة حافلة','سيارة نقل بضائع','سيارة جرارة','مركبة مقطورة','دراجة نارية'] });
};

exports.addInsurance = (req, res) => {
  try {
    const db = require('../config/database');
    const { vehicle_id, company_name, policy_number, valid_from, valid_until } = req.body;
    if (!vehicle_id || !company_name || !valid_until)
      return res.status(400).json({ success:false, message:'بيانات التأمين ناقصة' });
    db.prepare('INSERT INTO vehicle_insurance(vehicle_id,company_name,policy_number,valid_from,valid_until,recorded_by)VALUES(?,?,?,?,?,?)').run(vehicle_id,company_name,policy_number||null,valid_from||null,valid_until,req.user.id);
    res.status(201).json({ success:true });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.suspendForTransfer = (req, res) => {
  try {
    const db = require('../config/database');
    const { vehicle_id } = req.body;
    if (!vehicle_id) return res.status(400).json({ success:false, message:'رقم المركبة مطلوب' });
    const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(vehicle_id);
    if (!v) return res.status(404).json({ success:false, message:'المركبة غير موجودة' });
    const unpaid = db.prepare('SELECT COUNT(*) as c FROM violations WHERE vehicle_id=? AND status="unpaid"').get(vehicle_id).c;
    if (unpaid > 0) return res.status(400).json({ success:false, message:'لا يمكن تعليق اللوحة — يوجد مخالفات غير مدفوعة' });
    const lien = db.prepare('SELECT id FROM liens WHERE vehicle_id=? AND is_active=1').get(vehicle_id);
    if (lien) return res.status(400).json({ success:false, message:'لا يمكن التعليق — يوجد حق امتياز نشط' });
    db.prepare("UPDATE vehicles SET status='suspended' WHERE id=?").run(vehicle_id);
    res.json({ success:true, message:'تم تعليق اللوحة — مهلة 7 أيام' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ════════════════════════════════════════════════════════════════════
// تعديل / حذف بيانات المركبة
// ════════════════════════════════════════════════════════════════════
exports.update = (req, res) => {
  try {
    const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.params.id);
    if (!v) return res.status(404).json({ success:false, message:'المركبة غير موجودة' });

    const fields = ['vehicle_type','make','model','year','color','fuel_type','cylinders','usage_type','country_of_origin'];
    const updates = [], params = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f}=?`); params.push(req.body[f] || null); }
    });
    if (!updates.length) return res.status(400).json({ success:false, message:'لا توجد بيانات للتحديث' });

    db.prepare(`UPDATE vehicles SET ${updates.join(',')} WHERE id=?`).run(...params, v.id);
    audit(req, 'update', 'vehicles', v.id, `تعديل بيانات المركبة ${v.plate_number}`);
    res.json({ success:true, message:'تم تحديث بيانات المركبة' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.remove = (req, res) => {
  try {
    const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.params.id);
    if (!v) return res.status(404).json({ success:false, message:'المركبة غير موجودة' });

    const del = db.transaction(() => {
      db.prepare('DELETE FROM vehicle_owners WHERE vehicle_id=?').run(v.id);
      db.prepare('DELETE FROM vehicle_insurance WHERE vehicle_id=?').run(v.id);
      db.prepare('DELETE FROM vehicle_travel_permits WHERE vehicle_id=?').run(v.id);
      db.prepare('DELETE FROM technical_inspections WHERE vehicle_id=?').run(v.id);
      db.prepare('DELETE FROM violations WHERE vehicle_id=?').run(v.id);
      db.prepare('DELETE FROM liens WHERE vehicle_id=?').run(v.id);
      try { db.prepare('DELETE FROM ownership_transfers WHERE vehicle_id=?').run(v.id); } catch(_){}
      db.prepare('DELETE FROM vehicles WHERE id=?').run(v.id);
    });
    del();

    audit(req, 'delete', 'vehicles', v.id, `حذف المركبة ${v.plate_number}`);
    res.json({ success:true, message:'تم حذف المركبة وكل سجلاتها المرتبطة' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ════════════════════════════════════════════════════════════════════
// تحديث/تجديد البل والفحص الفني
// ════════════════════════════════════════════════════════════════════
exports.renewPermit = (req, res) => {
  try {
    const { vehicle_id, valid_from, valid_until, fee } = req.body;
    if (!vehicle_id || !valid_until) return res.status(400).json({ success:false, message:'بيانات البل ناقصة' });
    const v = db.prepare('SELECT id FROM vehicles WHERE id=?').get(vehicle_id);
    if (!v) return res.status(404).json({ success:false, message:'المركبة غير موجودة' });

    const permitNumber = `BEL${Math.floor(10000 + Math.random()*89999)}`;
    const feeVal = fee ? parseInt(fee) : 0;
    db.prepare(`
      INSERT INTO vehicle_travel_permits(vehicle_id, permit_number, fee_paid, fee, valid_from, valid_until, recorded_by, recorded_at)
      VALUES(?,?,?,?,?,?,?,datetime('now'))
    `).run(vehicle_id, permitNumber, feeVal, feeVal, valid_from || new Date().toISOString().split('T')[0], valid_until, req.user.id);

    audit(req, 'create', 'vehicle_travel_permits', vehicle_id, `تجديد البل — رقم ${permitNumber}`);
    res.status(201).json({ success:true, message:'تم تجديد البل بنجاح' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.renewInspection = (req, res) => {
  try {
    const { vehicle_id, result, notes, valid_from, valid_until, fee } = req.body;
    if (!vehicle_id || !result || !valid_until) return res.status(400).json({ success:false, message:'بيانات الفحص الفني ناقصة' });
    const v = db.prepare('SELECT id FROM vehicles WHERE id=?').get(vehicle_id);
    if (!v) return res.status(404).json({ success:false, message:'المركبة غير موجودة' });

    const feeVal = fee ? parseInt(fee) : 0;
    db.prepare(`
      INSERT INTO technical_inspections(vehicle_id, inspector_id, inspector_name, result, notes, fee_paid, fee, valid_from, valid_until, inspection_date)
      VALUES(?,?,?,?,?,?,?,?,?,date('now'))
    `).run(vehicle_id, req.user.id, req.user.name, result, notes || null, feeVal, feeVal, valid_from || new Date().toISOString().split('T')[0], valid_until);

    audit(req, 'create', 'technical_inspections', vehicle_id, `تجديد الفحص الفني — النتيجة ${result}`);
    res.status(201).json({ success:true, message:'تم تجديد الفحص الفني بنجاح' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};
