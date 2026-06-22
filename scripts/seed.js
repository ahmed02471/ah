/**
 * scripts/seed.js — نظام مرور سبها
 * يُنشئ قاعدة البيانات + المستخدمين الأساسيين + أنواع المخالفات
 * (تحديث: إعادة بناء بدون cache على Railway)
 */
require('dotenv').config();
const bcrypt   = require('bcryptjs');
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = process.env.DB_PATH || './database/traffic.db';
const dbDir   = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// إن كانت قاعدة البيانات موجودة ولديها بيانات حقيقية بالفعل لا تُنشئ من جديد
let dbAlreadyHasUsers = false;
if (fs.existsSync(path.resolve(DB_PATH))) {
  try {
    const check = new Database(path.resolve(DB_PATH), { readonly: true });
    const row = check.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).get();
    if (row) {
      const count = check.prepare('SELECT COUNT(*) AS c FROM users').get();
      if (count && count.c > 0) dbAlreadyHasUsers = true;
    }
    check.close();
  } catch (e) {
    // قاعدة بيانات تالفة أو غير صالحة — سيتم إعادة إنشائها
  }
}

if (dbAlreadyHasUsers) {
  console.log('ℹ️  قاعدة البيانات موجودة بالفعل وتحتوي على مستخدمين — تخطي seed.');
  process.exit(0);
}

const db = new Database(path.resolve(DB_PATH));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const { migrate } = require('../src/migrations/001_create_tables');
migrate();

const h = (p) => bcrypt.hashSync(p, 12);

// ── توليد username للموظف ────────────────────────────────────────
function genEmployeeUsername(base) {
  const existing = db.prepare('SELECT username FROM users WHERE username LIKE ?').all(base + '%');
  if (!existing.length) return base;
  return `${base}_${existing.length + 1}`;
}

// ── المستخدمون الأساسيون ─────────────────────────────────────────
const staff = [
  {
    national_id: '100000000001',
    username:    'admin',
    full_name:   'مدير نظام مرور سبها',
    full_name_en:'Admin Sabha Traffic',
    role:        'ADMIN',
    phone:       '0910000001',
    gender:      'ذكر',
    password:    'Admin@2026',
  },
  {
    national_id: '100000000002',
    username:    'reg.chief',
    full_name:   'رئيس قسم التسجيل',
    full_name_en:'Registration Chief',
    role:        'REG_CHIEF',
    phone:       '0910000002',
    gender:      'ذكر',
    password:    'Reg@2026',
  },
  {
    national_id: '100000000003',
    username:    'insp.chief',
    full_name:   'رئيس قسم الفحص الفني',
    full_name_en:'Inspection Chief',
    role:        'INSP_CHIEF',
    phone:       '0910000003',
    gender:      'ذكر',
    password:    'Insp@2026',
  },
  {
    national_id: '100000000004',
    username:    'violations.dept',
    full_name:   'رئيس قسم المخالفات',
    full_name_en:'Violations Department',
    role:        'VIOLATIONS_DEPT',
    phone:       '0910000004',
    gender:      'ذكر',
    password:    'Viol@2026',
  },
  {
    national_id: '100000000005',
    username:    'plate.dept',
    full_name:   'موظف قسم اللوحات',
    full_name_en:'Plate Department',
    role:        'PLATE_DEPT',
    phone:       '0910000005',
    gender:      'ذكر',
    password:    'Plate@2026',
  },
  {
    national_id: '100000000006',
    username:    'officer.001',
    full_name:   'النقيب أحمد الورفلي',
    full_name_en:'Ahmed Warfali',
    role:        'OFFICER',
    phone:       '0910000006',
    gender:      'ذكر',
    password:    'Officer@2026',
  },
];

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users
    (national_id, username, full_name, full_name_en, role, phone, gender, password_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const u of staff) {
  insertUser.run(u.national_id, u.username, u.full_name,
    u.full_name_en, u.role, u.phone, u.gender, h(u.password));
}

// ── أنواع المخالفات — القانون 11/1984 ────────────────────────────
const vtypes = [
  ['INS_EXP',    'انتهاء التأمين',                           100.5, 0],
  ['NO_LIC',     'قيادة بدون رخصة',                          100.5, 0],
  ['LIC_EXP',    'انتهاء رخصة القيادة',                       10.5, 0],
  ['NO_BELT',    'عدم استعمال حزام الأمان',                  100.5, 0],
  ['NO_BEL',     'عدم إبراز دمغة التجول (البل)',              100.5, 0],
  ['BEL_EXP',    'انتهاء دمغة التجول (البل)',                  20.5, 0],
  ['INSP_EXP',   'انتهاء الفحص الفني',                       100.5, 0],
  ['PHONE',      'استعمال الهاتف أثناء القيادة',              100.5, 0],
  ['RED_LIGHT',  'خرق الإشارة الحمراء',                      500.5, 1],
  ['NO_PLATE',   'قيادة بدون لوحات مرخصة',                   100.5, 0],
  ['WRONG_WAY',  'السير في الاتجاه المعاكس',                   20.5, 0],
  ['OVERLOAD',   'تجاوز الحمولة المقررة',                      10.5, 0],
  ['OVERPASS',   'الزيادة في عدد الركاب',                      10.5, 0],
  ['TINT',       'زجاج ملون بدون ترخيص',                      20.5, 0],
  ['BAD_PLATE',  'لوحة غير قانونية',                           20.5, 0],
  ['NO_SIGNAL',  'عدم استخدام إشارة الانعطاف',                 20.5, 0],
  ['SPEEDING',   'تجاوز السرعة المقررة',                      100.5, 0],
  ['SHOES',      'حذاء غير مناسب للقيادة',                     10.5, 0],
  ['BLOCK',      'عرقلة حركة السير',                           20.5, 0],
  ['MOD_VEH',    'تعديل المركبة بدون ترخيص',                 100.5, 0],
  ['NO_STAMP',   'عدم ختم رخصة القيادة',                      20.5, 0],
  ['PLATE_POS',  'تركيب اللوحة في غير مكانها المخصص',        100.5, 0],
  ['OUTSIDE',    'ركاب على الجزء الخارجي للمركبة',             20.5, 0],
  ['DANGER',     'تعريض السلامة العامة للخطر',               100.5, 0],
  ['NO_ORDER',   'شاحنة بدون أمر شحن',                         10.5, 0],
  ['REAR_CRASH', 'اصطدام من الخلف',                            20.5, 0],
];

db.prepare('DELETE FROM violation_types').run();
const ivt = db.prepare(
  'INSERT INTO violation_types (code,name_ar,fine_amount,legal_reference,requires_prosecutor) VALUES(?,?,?,?,?)'
);
for (const v of vtypes) ivt.run(v[0], v[1], v[2], 'القانون 11/1984', v[3]);

// ── محررو العقود الأوليون ─────────────────────────────────────────
const adminId = db.prepare('SELECT id FROM users WHERE role=?').get('ADMIN').id;
db.prepare(`INSERT OR IGNORE INTO contract_writers (name,court_number,phone,added_by) VALUES(?,?,?,?)`)
  .run('المحرر أحمد الورفلي',   'SBH-001', '0911111111', adminId);
db.prepare(`INSERT OR IGNORE INTO contract_writers (name,court_number,phone,added_by) VALUES(?,?,?,?)`)
  .run('المحرر علي المنصوري',   'SBH-002', '0912222222', adminId);
db.prepare(`INSERT OR IGNORE INTO contract_writers (name,court_number,phone,added_by) VALUES(?,?,?,?)`)
  .run('المحررة فاطمة الشريف',  'SBH-003', '0913333333', adminId);

// ── ملخص ─────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(65));
console.log('  نظام إدارة مرور سبها — بيانات الدخول');
console.log('═'.repeat(65));
console.log('');
console.log('  الدور              │ اسم المستخدم       │ كلمة المرور');
console.log('  ' + '─'.repeat(60));
const rows = [
  ['ADMIN',          'admin',           'Admin@2026'],
  ['REG_CHIEF',      'reg.chief',       'Reg@2026'],
  ['INSP_CHIEF',     'insp.chief',      'Insp@2026'],
  ['VIOLATIONS_DEPT','violations.dept', 'Viol@2026'],
  ['PLATE_DEPT',     'plate.dept',      'Plate@2026'],
  ['OFFICER',        'officer.001',     'Officer@2026'],
];
rows.forEach(([r,u,p]) =>
  console.log(`  ${r.padEnd(18)} │ ${u.padEnd(18)} │ ${p}`)
);
console.log('\n  ✅ قاعدة البيانات جاهزة — ' + vtypes.length + ' نوع مخالفة');
console.log('  🌐 npm start → http://localhost:3000\n');
