'use strict';
const router = require('express').Router();
const db     = require('../config/database');
const path   = require('path');
const multer = require('multer');

const upload = multer({
  dest: path.join(__dirname,'../public/uploads/tmp'),
  limits: { fileSize: 10*1024*1024 }
});

const { authenticate, authorize } = require('../middleware/auth');

// ── Controllers ────────────────────────────────────────────────
const auth     = require('../controllers/authController');
const admin    = require('../controllers/adminController');
const vehicle  = require('../controllers/vehicleController');
const viol     = require('../controllers/violationController');
const transfer = require('../controllers/transferController');
const citizen  = require('../controllers/citizenController');
const stats    = require('../controllers/statsController');
const camera   = require('../controllers/cameraController');

// ══════════════════════════════════════════════════════════════
// المصادقة
// ══════════════════════════════════════════════════════════════
router.post('/v1/auth/login',           auth.login);
router.post('/v1/auth/logout',          authenticate, auth.logout);
router.get ('/v1/auth/me',              authenticate, auth.me);
router.post('/v1/auth/change-password', authenticate, auth.changePassword);

// ══════════════════════════════════════════════════════════════
// الإدارة
// ══════════════════════════════════════════════════════════════
router.get ('/v1/admin/staff',                    authenticate, authorize('ADMIN'), admin.listStaff);
router.post('/v1/admin/staff',                    authenticate, authorize('ADMIN'), admin.createStaff);
router.get ('/v1/admin/citizens',                 authenticate, authorize('ADMIN','REG_CHIEF'), admin.listCitizens);
router.post('/v1/admin/citizens',                 authenticate, authorize('ADMIN','REG_CHIEF'), upload.single('photo'), admin.createCitizen);
router.post('/v1/admin/users/:id/toggle',         authenticate, authorize('ADMIN'), admin.toggleUser);
router.post('/v1/admin/users/:id/reset-password', authenticate, authorize('ADMIN'), admin.resetPassword);
router.get ('/v1/admin/audit',                    authenticate, authorize('ADMIN'), admin.auditLogs);
router.get ('/v1/admin/violation-types',          authenticate, admin.listViolationTypes);
router.post('/v1/admin/violation-types',          authenticate, authorize('ADMIN'), admin.createViolationType);
router.get ('/v1/contract-writers',               authenticate, admin.listContractWriters);
router.post('/v1/contract-writers',               authenticate, authorize('ADMIN','REG_CHIEF'), admin.createContractWriter);

// ══════════════════════════════════════════════════════════════
// المركبات — مسار التسجيل 7 خطوات
// ══════════════════════════════════════════════════════════════
router.get ('/v1/vehicles',                   authenticate, vehicle.list);
router.get ('/v1/vehicles/types',             vehicle.getVehicleTypes);
router.get ('/v1/vehicles/qr/:token',         vehicle.getByQr);
router.get ('/v1/vehicles/pending/list',      authenticate, vehicle.listPending);
router.get ('/v1/vehicles/pending/:id',       authenticate, vehicle.getPendingById);
router.get ('/v1/vehicles/:id',               authenticate, vehicle.getById);
router.put   ('/v1/vehicles/:id',             authenticate, authorize('ADMIN','REG_CHIEF'),  vehicle.update);
router.delete('/v1/vehicles/:id',             authenticate, authorize('ADMIN'),               vehicle.remove);
router.post  ('/v1/vehicles/permit/renew',     authenticate, authorize('ADMIN','REG_CHIEF'),  vehicle.renewPermit);
router.post  ('/v1/vehicles/inspection/renew', authenticate, authorize('ADMIN','INSP_CHIEF'), vehicle.renewInspection);

router.post('/v1/vehicles/step1/request',             authenticate, authorize('REG_CHIEF','ADMIN'),  vehicle.step1_submitRequest);
router.post('/v1/vehicles/step2/decision',            authenticate, authorize('ADMIN'),               vehicle.step2_adminDecision);
router.post('/v1/vehicles/step3/send-to-inspection',  authenticate, authorize('REG_CHIEF','ADMIN'),  vehicle.step3_sendToInspection);
router.post('/v1/vehicles/step4/inspection',          authenticate, authorize('INSP_CHIEF','ADMIN'), vehicle.step4_inspectionComplete);
router.post('/v1/vehicles/step5/generate-plate',      authenticate, authorize('REG_CHIEF','ADMIN'),  vehicle.step5_generatePlate);
router.post('/v1/vehicles/step6/final-approval',      authenticate, authorize('ADMIN'),               vehicle.step6_finalApproval);
router.post('/v1/vehicles/step7/issue-plate',         authenticate, authorize('PLATE_DEPT','ADMIN'), vehicle.step7_issuePlate);
router.post('/v1/vehicles/insurance',                 authenticate, authorize('ADMIN','REG_CHIEF'), vehicle.addInsurance);

// ══════════════════════════════════════════════════════════════
// المخالفات
// ══════════════════════════════════════════════════════════════
router.get ('/v1/violations',                    authenticate, viol.list);
router.post('/v1/violations',                    authenticate, authorize('ADMIN','OFFICER'), upload.single('evidence'), viol.create);
router.get ('/v1/violations/:id',                authenticate, viol.getById);
router.post('/v1/violations/:id/pay',            authenticate, authorize('ADMIN','VIOLATIONS_DEPT'), viol.pay);
router.post('/v1/violations/:id/prosecutor',     authenticate, authorize('ADMIN','VIOLATIONS_DEPT'), viol.referToProsecutor);
router.get ('/v1/violations/vehicle/:vehicleId', authenticate, viol.byVehicle);
router.post('/v1/violations/exceptional',        authenticate, authorize('ADMIN','OFFICER'), (req,res) => {
  const { vehicle_id, description, location_note } = req.body;
  if (!vehicle_id) return res.status(400).json({success:false,message:'رقم المركبة مطلوب'});
  try {
    db.prepare(`INSERT INTO internal_messages(from_user_id,to_role,subject,body,vehicle_id,msg_type)VALUES(?,'VIOLATIONS_DEPT',?,?,?,'general')`).run(
      req.user.id,`مخالفة استثنائية`,`${description||'—'} | ${location_note||'—'} | مركبة #${vehicle_id}`,vehicle_id);
    res.status(201).json({success:true});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});

// ══════════════════════════════════════════════════════════════
// نقل الملكية + حق الامتياز
// ══════════════════════════════════════════════════════════════
router.get ('/v1/transfers',                          authenticate, authorize('ADMIN','REG_CHIEF','PLATE_DEPT'), transfer.list);
router.get ('/v1/transfers/:id',                      authenticate, authorize('ADMIN','REG_CHIEF','PLATE_DEPT'), transfer.getById);
router.post('/v1/transfers/suspend',                  authenticate, authorize('ADMIN','REG_CHIEF'), transfer.suspend);
router.post('/v1/transfers/submit',                   authenticate, authorize('ADMIN','REG_CHIEF'), transfer.submitToAdmin);
router.post('/v1/transfers/admin-decision',           authenticate, authorize('ADMIN'),             transfer.adminDecision);
router.post('/v1/transfers/buyer-data',               authenticate, authorize('ADMIN','REG_CHIEF'), transfer.submitBuyerData);
router.post('/v1/transfers/final-approval',           authenticate, authorize('ADMIN'),             transfer.finalApproval);
router.post('/v1/transfers/issue-plate',              authenticate, authorize('ADMIN','PLATE_DEPT'),transfer.issuePlate);
router.get ('/v1/liens',                              authenticate, authorize('ADMIN','REG_CHIEF'), transfer.listLiens);
router.post('/v1/liens',                              authenticate, authorize('ADMIN','REG_CHIEF'), transfer.addLien);
router.post('/v1/liens/release',                      authenticate, authorize('ADMIN','REG_CHIEF'), transfer.releaseLien);

// ══════════════════════════════════════════════════════════════
// تطبيق المواطن
// ══════════════════════════════════════════════════════════════
const uploadCitizen = multer({
  dest: path.join(__dirname,'../public/uploads/citizens'),
  limits:{fileSize:10*1024*1024}
});

router.post('/v1/citizen/register',
  uploadCitizen.fields([{name:'photo',maxCount:1},{name:'birth_cert',maxCount:1},{name:'id_doc',maxCount:1}]),
  citizen.register);
router.post('/v1/citizen/forgot-password', citizen.forgotPassword);
router.post('/v1/citizen/verify-otp',      citizen.verifyOtp);
router.post('/v1/citizen/reset-password',  citizen.resetPassword);
router.get ('/v1/citizen/home',         authenticate, authorize('CITIZEN'), citizen.home);
router.get ('/v1/citizen/vehicles',     authenticate, authorize('CITIZEN'), (req, res) => {
  try {
    const uid = req.user.id;
    const vehicles = db.prepare(`
      SELECT v.id, v.plate_number, v.make, v.model, v.year, v.color,
             v.vehicle_type, v.usage_type, v.chassis_number, v.country_of_origin,
             v.status,
             (SELECT valid_until FROM vehicle_insurance      WHERE vehicle_id=v.id ORDER BY id DESC LIMIT 1) as ins_expiry,
             (SELECT valid_until FROM vehicle_travel_permits WHERE vehicle_id=v.id ORDER BY id DESC LIMIT 1) as bel_expiry,
             (SELECT valid_until FROM technical_inspections  WHERE vehicle_id=v.id ORDER BY id DESC LIMIT 1) as insp_expiry,
             (SELECT COUNT(*) FROM violations WHERE vehicle_id=v.id AND status='unpaid')        as unpaid_count,
             (SELECT COALESCE(SUM(fine_amount),0) FROM violations WHERE vehicle_id=v.id AND status='unpaid') as unpaid_total,
             (SELECT COUNT(*) FROM liens WHERE vehicle_id=v.id AND is_active=1)                as active_liens
      FROM vehicles v
      LEFT JOIN vehicle_owners vo ON vo.vehicle_id=v.id AND vo.is_current=1
      WHERE vo.owner_national_id=(SELECT national_id FROM users WHERE id=?)
      ORDER BY v.id DESC
    `).all(uid);
    res.json({ success:true, data: vehicles });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});
// حجوزات اللوحات — للادارة (لاستخدامها في الخطوة 5)
router.get('/v1/citizen/plate-reservations-admin', authenticate, authorize('ADMIN','REG_CHIEF'), (req, res) => {
  try {
    const nid = (req.query.national_id || '').trim();
    if (!nid) return res.json({ success:true, data:[] });
    db.prepare(`UPDATE plate_reservations SET status='expired' WHERE owner_national_id=? AND status='active' AND expires_at < datetime('now')`).run(nid);
    const rows = db.prepare(`
      SELECT * FROM plate_reservations
      WHERE owner_national_id=? AND status='active'
      ORDER BY expires_at ASC
    `).all(nid);
    res.json({ success:true, data: rows });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});
router.post('/v1/citizen/reports',      authenticate, authorize('CITIZEN'), uploadCitizen.single('photo'), citizen.submitReport);
router.post('/v1/citizen/suspend',      authenticate, authorize('CITIZEN'), uploadCitizen.single('contract'),      citizen.suspendForSale);

// بلاغات السرقة/ضياع اللوحة — مراجعة رئيس قسم المرور وقسم التسجيل
router.get ('/v1/citizen-reports',              authenticate, authorize('ADMIN','REG_CHIEF'), citizen.listReportsForReview);
router.post('/v1/citizen-reports/:id/decision', authenticate, authorize('ADMIN','REG_CHIEF'), citizen.decideReport);
router.post('/v1/citizen/reports/:id/cancel',    authenticate, authorize('CITIZEN'),          citizen.cancelReport);
router.post('/v1/citizen/reports/:id/request-reissue',  authenticate, authorize('CITIZEN'),    citizen.requestPlateReissue);
router.post('/v1/citizen-reports/:id/complete-reissue', authenticate, authorize('PLATE_DEPT'), citizen.completePlateReissue);
router.post('/v1/vehicles/:id/unsuspend',        authenticate, authorize('ADMIN','REG_CHIEF'), citizen.unsuspendVehicle);
router.get ('/v1/citizen/plate-reservations', authenticate, authorize('CITIZEN'), (req, res) => {
  try {
    const nid = db.prepare('SELECT national_id FROM users WHERE id=?').get(req.user.id)?.national_id;
    if (!nid) return res.json({ success:true, data:[] });
    // تحديث الحجوزات المنتهية
    db.prepare(`UPDATE plate_reservations SET status='expired' WHERE owner_national_id=? AND status='active' AND expires_at < datetime('now')`).run(nid);
    const rows = db.prepare(`
      SELECT * FROM plate_reservations
      WHERE owner_national_id=? AND status='active'
      ORDER BY expires_at ASC
    `).all(nid);
    res.json({ success:true, data: rows });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});
// البحث عن مواطن برقم المراجعة (لقسم التسجيل)
router.get('/v1/citizen/lookup', authenticate, authorize('ADMIN','REG_CHIEF'), (req, res) => {
  const review = (req.query.review || '').trim();
  const nid    = (req.query.national_id || '').trim();
  if (!review && !nid) return res.json({ success:false });

  let row;
  if (nid) {
    row = db.prepare(`
      SELECT cr.full_name, cr.national_id, cr.review_number, cr.phone, cr.email
      FROM citizen_registrations cr
      WHERE cr.national_id = ?
      ORDER BY cr.created_at DESC LIMIT 1
    `).get(nid);
  } else {
    row = db.prepare(`
      SELECT cr.full_name, cr.national_id, cr.review_number, cr.phone, cr.email
      FROM citizen_registrations cr
      WHERE cr.review_number = ?
      LIMIT 1
    `).get(review);
  }

  if (!row) return res.json({ success:false, message: nid ? 'الرقم الوطني غير مسجّل في البوابة' : 'رقم المراجعة غير موجود' });
  res.json({ success:true, data: row });
});
router.get ('/v1/citizen/requests',     authenticate, authorize('ADMIN','REG_CHIEF'), citizen.listRequests);
router.post('/v1/citizen/requests/:id/complete', authenticate, authorize('ADMIN','REG_CHIEF'), citizen.completeRequest);
router.get ('/v1/citizen/requests/:id', authenticate, authorize('ADMIN','REG_CHIEF'), citizen.getRequest);

// ══════════════════════════════════════════════════════════════
// الرسائل الداخلية
// ══════════════════════════════════════════════════════════════
router.get('/v1/messages', authenticate, (req,res) => {
  try {
    const m = db.prepare(`SELECT m.*,u.full_name as from_name,u.role as from_role,
        CASE WHEN m.msg_type='citizen_report' THEN cr.police_report_path ELSE NULL END as report_photo
      FROM internal_messages m
      LEFT JOIN users u ON u.id=m.from_user_id
      LEFT JOIN citizen_reports cr ON cr.id=m.reference_id AND m.msg_type='citizen_report'
      WHERE m.to_user_id=? OR m.to_role=? ORDER BY m.created_at DESC LIMIT 100`).all(req.user.id,req.user.role);
    res.json({success:true,data:m});
  } catch(e){res.status(500).json({success:false,message:e.message});}
});
router.get('/v1/messages/unread-count', authenticate, (req,res) => {
  try{const c=db.prepare(`SELECT COUNT(*) as c FROM internal_messages WHERE (to_user_id=? OR to_role=?) AND is_read=0`).get(req.user.id,req.user.role).c;res.json({success:true,data:{count:c}});}
  catch(e){res.json({success:true,data:{count:0}});}
});
router.post('/v1/messages/:id/read', authenticate, (req,res) => {
  try{db.prepare('UPDATE internal_messages SET is_read=1 WHERE id=?').run(req.params.id);res.json({success:true});}
  catch(e){res.status(500).json({success:false});}
});

// ══════════════════════════════════════════════════════════════
// الإشعارات
// ══════════════════════════════════════════════════════════════
router.get('/v1/notifications', authenticate, (req,res) => {
  try{const n=db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.user.id);res.json({success:true,data:n});}
  catch(e){res.status(500).json({success:false,message:e.message});}
});
router.get('/v1/notifications/unread-count', authenticate, (req,res) => {
  try{const c=db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c;res.json({success:true,data:{count:c}});}
  catch(e){res.json({success:true,data:{count:0}});}
});
router.post('/v1/notifications/read-all', authenticate, (req,res) => {
  try{db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);res.json({success:true});}
  catch(e){res.status(500).json({success:false});}
});

// ══════════════════════════════════════════════════════════════
// الكاميرا + الإحصاءات + QR
// ══════════════════════════════════════════════════════════════
router.post('/v1/camera/settings', authenticate, authorize('ADMIN','REG_CHIEF','INSP_CHIEF'), camera.saveSettings);
router.get ('/v1/camera/settings', authenticate, camera.getSettings);
router.get ('/v1/camera/snapshot', authenticate, camera.snapshot);
router.get ('/v1/camera/stream',   authenticate, camera.stream);
router.post('/v1/camera/test',     authenticate, authorize('ADMIN','REG_CHIEF','INSP_CHIEF'), camera.testConnection);
router.get ('/v1/stats/dashboard', authenticate, stats.dashboard);

router.get('/v1/qr/:token', (req,res) => {
  const url = `http://localhost:3000/vehicles/qr/${req.params.token}`;
  res.redirect(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&format=svg&data=${encodeURIComponent(url)}`);
});

router.get('/v1/qr-print/:token', authenticate, (req,res) => {
  const token = req.params.token;
  const v = db.prepare(`SELECT v.*,vo.owner_name,vo.owner_national_id FROM vehicles v LEFT JOIN vehicle_owners vo ON vo.vehicle_id=v.id AND vo.is_current=1 WHERE v.qr_token=?`).get(token);
  const qrUrl = `http://localhost:3000/vehicles/qr/${token}`;
  const apiQR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&format=png&data=${encodeURIComponent(qrUrl)}`;
  res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>ملصق QR</title>
  <style>body{font-family:Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5;}
  .sticker{background:#fff;border:3px solid #000;border-radius:12px;padding:20px;text-align:center;width:280px;}
  .plate{font-size:20px;font-weight:900;font-family:monospace;letter-spacing:2px;border:3px solid #000;padding:8px 16px;border-radius:6px;margin:10px auto;display:inline-block;}
  @media print{body{background:#fff;}.no-print{display:none;}}</style></head><body>
  <div class="sticker">
    <div style="font-size:11px;font-weight:bold;margin-bottom:8px;">مديرية مرور سبها</div>
    <div class="plate">${v?.plate_number||token.substring(0,10)}</div>
    <img src="${apiQR}" width="200" height="200" style="display:block;margin:10px auto;border-radius:6px;">
    <div style="font-size:13px;font-weight:bold;">${v?.owner_name||'—'}</div>
    <div style="font-size:11px;color:#555;">${v?.owner_national_id||''}</div>
  </div>
  <div class="no-print" style="margin-top:16px;">
    <button onclick="window.print()" style="padding:10px 24px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;">🖨️ طباعة</button>
  </div></body></html>`);
});


// Debug: عرض حالة طلب معين
router.get('/v1/vehicles/debug/:id', authenticate, authorize('ADMIN','REG_CHIEF'), (req,res) => {
  try {
    const p = db.prepare('SELECT id,status,owner_name,owner_national_id,from_user_id FROM pending_vehicle_data WHERE id=?').get(req.params.id);
    res.json({success:true, data:p||'not found'});
  } catch(e) { res.json({success:false,error:e.message}); }
});

module.exports = router;

