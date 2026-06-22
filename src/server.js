require('dotenv').config();
const express   = require('express');
const path      = require('path');
const cors      = require('cors');
const helmet    = require('helmet');
const https     = require('https');
const http      = require('http');
const selfsigned = require('selfsigned');

const app       = express();
const PORT      = process.env.PORT  || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const VIEWS  = path.join(__dirname, 'views');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── إضافة أعمدة جديدة بأمان (إذا لم تكن موجودة) ──────────────────
try {
  const db = require('./config/database');

  // ── إنشاء الجداول والمستخدمين الأساسيين إذا كانت القاعدة فارغة تماماً ──
  const hasUsersTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
  ).get();
  if (!hasUsersTable) {
    console.log('[DB] لا توجد جداول — تشغيل الترحيل (migration) والبذر (seed)...');
    const { migrate } = require('../database/migrations/001_create_tables');
    migrate();

    const bcrypt = require('bcryptjs');
    const h = (p) => bcrypt.hashSync(p, 12);
    const staff = [
      { national_id: '100000000001', username: 'admin',           full_name: 'مدير نظام مرور سبها',        full_name_en: 'Admin Sabha Traffic',   role: 'ADMIN',           phone: '0910000001', gender: 'ذكر', password: 'Admin@2026' },
      { national_id: '100000000002', username: 'reg.chief',       full_name: 'رئيس قسم التسجيل',           full_name_en: 'Registration Chief',    role: 'REG_CHIEF',       phone: '0910000002', gender: 'ذكر', password: 'Reg@2026' },
      { national_id: '100000000003', username: 'insp.chief',      full_name: 'رئيس قسم الفحص الفني',        full_name_en: 'Inspection Chief',      role: 'INSP_CHIEF',      phone: '0910000003', gender: 'ذكر', password: 'Insp@2026' },
      { national_id: '100000000004', username: 'violations.dept', full_name: 'رئيس قسم المخالفات',          full_name_en: 'Violations Department', role: 'VIOLATIONS_DEPT', phone: '0910000004', gender: 'ذكر', password: 'Viol@2026' },
      { national_id: '100000000005', username: 'plate.dept',      full_name: 'موظف قسم اللوحات',            full_name_en: 'Plate Department',      role: 'PLATE_DEPT',      phone: '0910000005', gender: 'ذكر', password: 'Plate@2026' },
      { national_id: '100000000006', username: 'officer.001',     full_name: 'النقيب أحمد الورفلي',         full_name_en: 'Ahmed Warfali',         role: 'OFFICER',         phone: '0910000006', gender: 'ذكر', password: 'Officer@2026' },
    ];
    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users
        (national_id, username, full_name, full_name_en, role, phone, gender, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const u of staff) {
      insertUser.run(u.national_id, u.username, u.full_name, u.full_name_en, u.role, u.phone, u.gender, h(u.password));
    }
    const adminRow = db.prepare('SELECT id FROM users WHERE role=?').get('ADMIN');
    const adminId = adminRow ? adminRow.id : null;
    const cw = db.prepare(`INSERT OR IGNORE INTO contract_writers (name,court_number,phone,added_by) VALUES(?,?,?,?)`);
    cw.run('المحرر أحمد الورفلي',  'SBH-001', '0911111111', adminId);
    cw.run('المحرر علي المنصوري',  'SBH-002', '0912222222', adminId);
    cw.run('المحررة فاطمة الشريف', 'SBH-003', '0913333333', adminId);
    console.log('[DB] ✅ تم إنشاء الجداول والمستخدمين الأساسيين بنجاح');
  }

  const tryAdd = (table, col, type) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
    if (!cols.includes(col)) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
      console.log(`[DB] ✅ أُضيف العمود ${col} إلى ${table}`);
    }
  };
  tryAdd('pending_vehicle_data', 'photo_path', 'TEXT');
  tryAdd('pending_vehicle_data', 'notes', 'TEXT');
  tryAdd('pending_vehicle_data', 'admin_number', 'TEXT');
  tryAdd('pending_vehicle_data', 'citizen_review_number', 'TEXT');

  // ── إضافة أنواع المخالفات إذا كانت القاعدة فارغة ──────────────
  const vtCount = db.prepare('SELECT COUNT(*) as c FROM violation_types').get()?.c || 0;
  if (vtCount === 0) {
    const ins = db.prepare(
      'INSERT OR IGNORE INTO violation_types (code,name_ar,fine_amount,legal_reference,requires_prosecutor) VALUES(?,?,?,?,?)'
    );
    const ref = 'القانون 11/1984';
    const vts = [
      ['INS_EXP',    'انتهاء التأمين',                              100.5, 0],
      ['INSP_EXP',   'انتهاء الفحص الفني',                          100.5, 0],
      ['NO_LIC',     'قيادة بدون رخصة',                             100.5, 0],
      ['LIC_EXP',    'انتهاء رخصة القيادة',                          100.5, 0],
      ['SHOES',      'حذاء غير مناسب للقيادة',                       10.5, 0],
      ['NO_BELT',    'عدم استعمال حزام الأمان',                     100.5, 0],
      ['NO_BEL',     'عدم إبراز دمغة التجول (البل)',                 100.5, 0],
      ['NO_BOOKLET', 'بدون كتيب المركبة',                             20.5, 0],
      ['NO_ORDER',   'شاحنة بدون أمر شحن',                           20.5, 0],
      ['NO_TRAILER', 'بدون كتيب المقطورة',                           20.5, 0],
      ['NO_HELPER',  'بدون مساعد سائق',                              20.5, 0],
      ['OVERLOAD',   'ارتفاع في الحمولة',                            20.5, 0],
      ['BLOCK',      'عرقلة حركة السير',                             20.5, 0],
      ['OVERPASS',   'الزيادة في عدد الركاب',                        20.5, 0],
      ['SPEED',      'عدم تخفيض السرعة المقررة',                     20.5, 0],
      ['DANGER',     'تعريض السلامة العامة للخطر',                   20.5, 0],
      ['MOD_VEH',    'تعديل المركبة (تغيير جوهري)',                  100.5, 0],
      ['PHONE',      'استعمال الهاتف النقال أثناء القيادة',          100.5, 0],
      ['NO_LIC_PSG', 'نقل ركاب بدون ترخيص',                         100.5, 0],
      ['RED_LIGHT',  'خرق الإشارة الضوئية الحمراء',                  500.5, 1],
      ['NO_PLATE',   'قيادة بدون لوحات/جمرك',                        100.5, 0],
      ['BEL_EXP',    'انتهاء دمغة التجول (البل)',                     20.5, 0],
      ['OUTSIDE',    'ركاب على الجزء الخارجي للمركبة',               20.5, 0],
      ['NO_SIGNAL',  'عدم استخدام إشارة الانعطاف',                   20.5, 0],
      ['REAR_CRASH', 'اصطدام من الخلف',                              20.5, 0],
      ['NO_F_PLATE', 'بدون لوحة من الأمام أو الخلف',                20.5, 0],
      ['TINT',       'زجاج ملون بدون ترخيص',                         20.5, 0],
      ['BAD_PLATE',  'لوحة غير قانونية',                              20.5, 0],
      ['PLATE_POS',  'تركيب اللوحة في غير مكانها المخصص',           100.5, 0],
      ['BLOCK_INT',  'عرقلة حركة السير عمدا',                        20.5, 0],
      ['WRONG_WAY',  'السير في الاتجاه المعاكس',                     20.5, 0],
      ['NO_STAMP',   'عدم ختم رخصة القيادة',                         20.5, 0],
    ];
    const insertAll = db.transaction(() => {
      for (const v of vts) ins.run(v[0], v[1], v[2], ref, v[3]);
    });
    insertAll();
    console.log(`[DB] ✅ أُضيف ${vts.length} نوع مخالفة`);
  }
} catch(e) { console.warn('[DB Migration]', e.message); }

// ── [مؤقت] استرجاع قاعدة بيانات حقيقية مرة واحدة من جهاز المسؤول ────
// يُحذف هذا المسار بعد الاستخدام لأسباب أمنية.
try {
  const multer = require('multer');
  const fs     = require('fs');
  const uploadDb = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
  app.post('/api/admin/restore-db', uploadDb.single('db'), (req, res) => {
    const token = process.env.DB_RESTORE_TOKEN;
    if (!token || req.headers['x-restore-token'] !== token) {
      return res.status(403).json({ success: false, message: 'ممنوع' });
    }
    if (!req.file) return res.status(400).json({ success: false, message: 'لم يتم إرسال ملف' });
    const DB_PATH = path.resolve(process.env.DB_PATH || './database/traffic.db');
    for (const suffix of ['', '-wal', '-shm']) {
      const p = DB_PATH + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    fs.writeFileSync(DB_PATH, req.file.buffer);
    res.json({ success: true, message: 'تم الاستيراد — سيعاد تشغيل الخادم الآن' });
    // كود خروج غير صفري (1) ليتوافق مع سياسة إعادة التشغيل "On Failure"
    setTimeout(() => process.exit(1), 500);
  });
} catch (e) { console.warn('[restore-db]', e.message); }

const sendView = (f) => (req, res) => res.sendFile(path.join(VIEWS, f));

// ── الصفحات العامة ────────────────────────────────────────────────
app.get(['/', '/login'],  sendView('login.html'));
app.get('/dashboard',     sendView('dashboard.html'));
app.get('/profile',  sendView('profile.html'));
app.get('/pending',           sendView('pending-requests.html'));
app.get('/vehicles/request-pdf/:id', sendView('request-pdf.html'));
app.get('/messages',        sendView('messages.html'));
app.get('/change-password', sendView('change-password.html'));
app.get('/inspections',sendView('inspection-history.html'));

// ── إدارة المستخدمين ──────────────────────────────────────────────
app.get('/admin/staff',            sendView('admin-staff.html'));
app.get('/admin/citizens',         sendView('admin-citizens.html'));
app.get('/admin/violation-types',  sendView('admin-violation-types.html'));
app.get('/admin/contract-writers', sendView('admin-contract-writers.html'));
app.get('/admin/audit',            sendView('admin-audit.html'));
app.get('/admin/stats',            sendView('admin-stats.html'));

// ── المركبات ──────────────────────────────────────────────────────
app.get('/vehicles',        sendView('vehicles-list.html'));
app.get('/vehicles/new',             sendView('reg-step1-owner.html'));
app.get('/vehicles/pending',          sendView('reg-pending.html'));
app.get('/vehicles/inspect/:id',      sendView('insp-vehicle-data.html'));
app.get('/vehicles/step5/:id',        sendView('reg-step5-plate.html'));
app.get('/vehicles/approve/:id',      sendView('admin-approve-vehicle.html'));
app.get('/vehicles/inspect/:id',   sendView('insp-vehicle-data.html'));
app.get('/vehicles/approve/:id',   sendView('admin-approve-vehicle.html'));
app.get('/vehicles/plate/:id',     sendView('reg-step5-plate.html'));
app.get('/plates/pending',         sendView('plates-pending.html'));
app.get('/admin/camera',           sendView('camera-settings.html'));
app.get('/vehicles/:id',    sendView('vehicle-detail.html'));

// ── المخالفات ─────────────────────────────────────────────────────
app.get('/violations',      sendView('violations.html'));
app.get('/violations/new',  sendView('violation-new.html'));
app.get('/violations/:id',  sendView('violation-detail.html'));

// ── نقل الملكية ───────────────────────────────────────────────────
app.get('/liens',     sendView('liens.html'));
app.get('/transfers',       sendView('transfers.html'));
app.get('/transfers/new',   sendView('transfer-new.html'));
app.get('/transfers/:id',   sendView('transfer-detail.html'));

// ── الفحص الفني ───────────────────────────────────────────────────
app.get('/inspections',     sendView('inspection-history.html'));
app.get('/inspections/new', sendView('inspection-new.html'));

// ── الضابط الميداني ───────────────────────────────────────────────
app.get('/officer/scan',      sendView('officer-scan.html'));
app.get('/patrol/static',     sendView('patrol-static.html'));
app.get('/patrol/mobile',     sendView('patrol-mobile.html'));
app.get('/camera-settings',   sendView('camera-settings.html'));

// ── قسم اللوحات ───────────────────────────────────────────────────
app.get('/plates/pending',  sendView('plates-pending.html'));

// ── المواطن ───────────────────────────────────────────────────────
app.get('/citizen-requests', sendView('citizen-requests.html'));
app.get('/citizen',          sendView('citizen-login.html'));
app.get('/citizen/login',    sendView('citizen-login.html'));
app.get('/citizen/home',     sendView('citizen-home.html'));
app.get('/citizen/violations',   sendView('citizen-violations.html'));
app.get('/citizen/vehicles',     sendView('citizen-vehicles.html'));
app.get('/citizen/reports',      sendView('citizen-reports.html'));
app.get('/citizen/notifications',sendView('citizen-notifications.html'));
app.get('/citizen/signs',         sendView('citizen-signs.html'));

// ── API ───────────────────────────────────────────────────────────
const apiRoutes = require('./routes/index');
app.use('/api', apiRoutes);

// ── 404 ───────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.accepts('html')) res.status(404).sendFile(path.join(VIEWS, '404.html'));
  else res.status(404).json({ success: false, message: 'الصفحة غير موجودة' });
});

// ── HTTP ─────────────────────────────────────────────────────────────
http.createServer(app).listen(PORT, () => {
  console.log(`\n🚀 HTTP  → http://localhost:${PORT}`);
});

// ── HTTPS (شهادة محلية للكاميرا على الهاتف) ─────────────────────────
try {
  const attrs = [
    { name: 'commonName',       value: 'localhost' },
    { name: 'organizationName', value: 'Traffic Sabha' }
  ];
  const pems = selfsigned.generate(attrs, {
    days:      365,
    keySize:   2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: '192.168.0.101' }
      ]}
    ]
  });
  const sslOpts = { key: pems.private, cert: pems.cert };

  https.createServer(sslOpts, app).listen(HTTPS_PORT, () => {
    console.log(`🔒 HTTPS → https://localhost:${HTTPS_PORT}`);
    console.log(`📱 من الهاتف: https://<IP_جهازك>:${HTTPS_PORT}`);
    console.log(`   (اقبل تحذير الشهادة غير الموثوقة في المتصفح)`);
    console.log(`📋 تسجيل الدخول: admin / Admin@2026\n`);
  });
} catch(e) {
  console.warn('⚠️ تعذّر تشغيل HTTPS:', e.message);
  console.log(`📋 تسجيل الدخول: admin / Admin@2026\n`);
}

// فحص مهل نقل الملكية كل ساعة
const transferCtrl = require('./controllers/transferController');
setInterval(() => {
  transferCtrl.checkDeadlines();
}, 60 * 60 * 1000); // كل ساعة
transferCtrl.checkDeadlines(); // فحص عند البدء
