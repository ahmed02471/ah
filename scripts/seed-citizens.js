/**
 * seed-citizens.js — إدراج عشرة آلاف (10,000) مواطن حقيقي + مركباتهم بكل بياناتها
 *
 * لكل مواطن:
 *   - حساب مستخدم (users, role=CITIZEN)
 *   - طلب تسجيل (citizen_registrations)
 *   - مركبة واحدة على الأقل مسجّلة باسمه (نسبة ~15% يملكون مركبة ثانية)، ولكل مركبة:
 *       • vehicles            (بيانات المركبة الكاملة)
 *       • vehicle_owners      (ربط المالك الحالي بالمركبة)
 *       • vehicle_insurance   (تأمين ساري)
 *       • vehicle_travel_permits (تصريح/بل ساري)
 *       • technical_inspections  (فحص فني)
 *
 * كل الصيغ (رقم اللوحة، QR، الرقم الوطني، إلخ) مطابقة لمنطق التطبيق الفعلي في:
 *   src/controllers/citizenController.js  (تسجيل المواطن)
 *   src/controllers/vehicleController.js  (generatePlate, qr_token, vehicle types)
 *
 * شغّل: node scripts/seed-citizens.js
 */
const Database = require('better-sqlite3');
const bcrypt    = require('bcryptjs');
const crypto    = require('crypto');
const path      = require('path');
const fs        = require('fs');

const DB_PATH = path.join(__dirname, '../database/traffic.db');
const BACKUP_PATH = DB_PATH + '.pre_seed_citizens.bak';
if (!fs.existsSync(BACKUP_PATH)) {
  fs.copyFileSync(DB_PATH, BACKUP_PATH);
  console.log(`✅ نسخة احتياطية: ${BACKUP_PATH}`);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const TOTAL = 10000;
const DEFAULT_PASSWORD = 'Citizen@2026';
const SECOND_VEHICLE_CHANCE = 0.15;

// ── أسماء ليبية واقعية ───────────────────────────────────────────────
const MALE_FIRST = [
  'أحمد','محمد','علي','عمر','خالد','سالم','مصطفى','إبراهيم','يوسف','عبدالله',
  'حسن','حسين','الطاهر','الصادق','عبدالرحمن','عبدالسلام','عبدالناصر','عبدالكريم',
  'فرج','رمضان','نوري','عادل','طارق','وليد','ياسين','معتز','أسامة','زياد',
  'بشير','صلاح','فيصل','ماجد','أنس','حمزة','سعيد','جمعة','الهادي','المهدي',
  'نصر','رضا','كمال','ناصر','عزالدين','صالح','جلال','منصور','فتحي','لطفي',
];
const FEMALE_FIRST = [
  'فاطمة','عائشة','مريم','سارة','نور','هند','رقية','زينب','خديجة','آمنة',
  'سلمى','هدى','سناء','ابتسام','وفاء','أمل','ليلى','سلوى','نجاة','حنان',
  'إيمان','رحمة','سمية','نادية','فوزية','صباح','انتصار','عبير','رانيا','دلال',
  'أسماء','منى','لمياء','شيرين','رجاء','نهلة','غادة','سهام','فضيلة','حياة',
];
const LAST_NAMES = [
  'الشريف','القذافي','الفيتوري','المبروك','العربي','البوسيفي','الهاشمي','العجيلي',
  'الدرسي','الورفلي','المغربي','السنوسي','الزوي','المنفي','الرياني','التارقي',
  'الفرجاني','المسماري','القطعاني','الجهني','الزنتاني','المجبري','الساعدي','البرعصي',
  'الطرابلسي','المصراتي','البنغازي','السبهاوي','الكيلاني','الشحومي','الورشفاني','الحاسي',
];
const EMAIL_DOMAINS = ['gmail.com','yahoo.com','hotmail.com'];
const CITIES = ['سبها','سبها — حي الصمود','سبها — حي المنشية','سبها — حي الفاتح','مرزق','تراغن','أم الأرانب','براك الشاطئ','القطرون','غات','ودان'];

// ── بيانات المركبات (مطابقة لقوائم vehicleController.js) ─────────────
const VEHICLE_TYPES = ['سيارة خاصة','سيارة ركوب عامة','سيارة حافلة','سيارة نقل بضائع','سيارة جرارة','مركبة مقطورة','دراجة نارية'];
const TRANSPORT_TYPES = new Set(['سيارة نقل بضائع','سيارة جرارة','مركبة مقطورة']);
const MAKES  = ['Toyota','Hyundai','Kia','Nissan','Mitsubishi','Honda','Ford','BMW','Mercedes','Chevrolet'];
const MODELS = {
  Toyota:     ['Camry','Corolla','Land Cruiser','Prado','Hilux','Yaris','RAV4'],
  Hyundai:    ['Sonata','Elantra','Tucson','Santa Fe','Accent','i10'],
  Kia:        ['Sportage','Sorento','Cerato','Picanto','Optima'],
  Nissan:     ['Patrol','Altima','Sunny','X-Trail','Navara','Tiida'],
  Mitsubishi: ['Pajero','L200','Lancer','Galant','Eclipse'],
  Honda:      ['Civic','Accord','CR-V','Pilot','Jazz'],
  Ford:       ['Explorer','F-150','Fusion','Edge','Mustang'],
  BMW:        ['X5','X3','520','730','320'],
  Mercedes:   ['C200','E200','GLE','S500','Vito'],
  Chevrolet:  ['Tahoe','Silverado','Malibu','Aveo','Captiva'],
};
const COLORS     = ['أبيض','أسود','فضي','رمادي','أحمر','أزرق','بيج','بني','أخضر','ذهبي'];
const FUEL_TYPES = ['بنزين','ديزل','غاز'];
const ORIGINS    = { Toyota:'اليابان',Nissan:'اليابان',Honda:'اليابان',Mitsubishi:'اليابان',
                      Hyundai:'كوريا',Kia:'كوريا',BMW:'ألمانيا',Mercedes:'ألمانيا',
                      Ford:'أمريكا',Chevrolet:'أمريكا' };
const INSURANCE_COMPANIES = ['الوطنية','السهل','المتحدة','الأمان','ليبيا للتأمين'];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function randFullName(gender) {
  const first  = rand(gender === 'male' ? MALE_FIRST : FEMALE_FIRST);
  const father = rand(MALE_FIRST);
  const family = rand(LAST_NAMES);
  return { full_name: `${first} ${father} ${family}`, first, family };
}

const usedNationalIds = new Set(db.prepare('SELECT national_id FROM users').all().map(r => r.national_id));
function genNationalId(gender) {
  const prefix = gender === 'male' ? '1' : '2';
  let nid;
  do { nid = prefix + Array.from({ length: 11 }, () => randInt(0, 9)).join(''); }
  while (usedNationalIds.has(nid));
  usedNationalIds.add(nid);
  return nid;
}

function genPhone() {
  return '0' + randInt(91, 96) + Array.from({ length: 7 }, () => randInt(0, 9)).join('');
}
function genEmail(first, family, seq) {
  return `${first}.${family}${seq}@${rand(EMAIL_DOMAINS)}`.replace(/\s/g, '');
}
function randomDateBetween(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}
function fmt(d) { return d.toISOString().replace('T', ' ').split('.')[0]; }

const usedReviewNumbers = new Set(db.prepare('SELECT review_number FROM citizen_registrations').all().map(r => r.review_number));
function genReviewNumber() {
  let n;
  do { n = String(randInt(100000, 999999)); } while (usedReviewNumbers.has(n));
  usedReviewNumbers.add(n);
  return n;
}

const usedPlates = new Set(db.prepare('SELECT plate_number FROM vehicles').all().map(r => r.plate_number));
function genPlate(vehicleType) {
  const isTransport = TRANSPORT_TYPES.has(vehicleType);
  let plate;
  do { plate = `${randInt(10000, 99999)} - 1 - LBY${isTransport ? ' - TR' : ''}`; }
  while (usedPlates.has(plate));
  usedPlates.add(plate);
  return plate;
}
const usedQR = new Set(db.prepare('SELECT qr_token FROM vehicles').all().map(r => r.qr_token));
function genQR() {
  let q;
  do { q = crypto.randomBytes(4).toString('hex').toUpperCase(); } while (usedQR.has(q));
  usedQR.add(q);
  return q;
}
function genChassis(seq) {
  return `VIN${String(seq).padStart(6, '0')}${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}
function dateAgo(maxDays) { const d = new Date(); d.setDate(d.getDate() - randInt(30, maxDays)); return d.toISOString().split('T')[0]; }
function dateFuture(minDays, maxDays) { const d = new Date(); d.setDate(d.getDate() + randInt(minDays, maxDays)); return d.toISOString().split('T')[0]; }

const regChiefs    = db.prepare("SELECT id FROM users WHERE role='REG_CHIEF'").all().map(r => r.id);
const plateDept    = db.prepare("SELECT id FROM users WHERE role='PLATE_DEPT'").all().map(r => r.id);
const inspChiefs   = db.prepare("SELECT id, full_name FROM users WHERE role='INSP_CHIEF'").all();
const admins       = db.prepare("SELECT id FROM users WHERE role='ADMIN'").all().map(r => r.id);
if (!regChiefs.length)  regChiefs.push(2);
if (!plateDept.length)  plateDept.push(5);
if (!inspChiefs.length) inspChiefs.push({ id: 3, full_name: 'رئيس الفحص' });
if (!admins.length)     admins.push(1);

console.log('⏳ جارٍ تجهيز كلمة السر الافتراضية...');
const passwordHash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);

// ── جمل الإدراج ────────────────────────────────────────────────────
const insUser = db.prepare(`
  INSERT INTO users(national_id, username, full_name, role, password_hash, phone, gender,
    is_active, must_change_password, created_at)
  VALUES(?,?,?,'CITIZEN',?,?,?,1,1,?)
`);
const insReg = db.prepare(`
  INSERT INTO citizen_registrations
    (review_number, user_id, full_name, national_id, phone, email,
     status, reviewed_by, reviewed_at, created_at)
  VALUES(?,?,?,?,?,?,?,?,?,?)
`);
const insVehicle = db.prepare(`
  INSERT INTO vehicles(plate_number, chassis_number, engine_number, vehicle_type, make, model,
    year, color, country_of_origin, fuel_type, qr_token, status, registration_status,
    registered_at, registered_by, approved_by, approved_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);
const insOwner = db.prepare(`
  INSERT INTO vehicle_owners(vehicle_id, owner_national_id, owner_name, owner_id_card,
    driving_license, phone, address, is_current, ownership_start)
  VALUES(?,?,?,?,?,?,?,1,?)
`);
const insIns = db.prepare(`
  INSERT INTO vehicle_insurance(vehicle_id, company_name, policy_number, valid_from, valid_until, recorded_by, recorded_at)
  VALUES(?,?,?,?,?,?,?)
`);
const insPermit = db.prepare(`
  INSERT INTO vehicle_travel_permits(vehicle_id, permit_number, fee_paid, fee, valid_from, valid_until, recorded_by, recorded_at)
  VALUES(?,?,?,?,?,?,?,?)
`);
const insInsp = db.prepare(`
  INSERT INTO technical_inspections(vehicle_id, inspector_id, inspector_name, result, notes, fee_paid, fee, valid_from, valid_until, inspection_date)
  VALUES(?,?,?,?,?,?,?,?,?,?)
`);

function insertVehicleFor(ownerNationalId, ownerName, ownerPhone, seq) {
  const make  = rand(MAKES);
  const model = rand(MODELS[make]);
  const vtype = rand(VEHICLE_TYPES);
  const plate = genPlate(vtype);
  const qr    = genQR();
  const status = Math.random() < 0.9 ? 'active' : 'suspended';
  const registeredAt = dateAgo(700);

  const vRes = insVehicle.run(
    plate, genChassis(seq), `ENG${String(seq).padStart(6, '0')}`, vtype, make, model,
    randInt(2005, 2025), rand(COLORS), ORIGINS[make] || 'غير محدد', rand(FUEL_TYPES),
    qr, status, 'approved', registeredAt, rand(plateDept), rand(admins), registeredAt
  );
  const vid = vRes.lastInsertRowid;

  insOwner.run(vid, ownerNationalId, ownerName, `BK${randInt(100000, 999999)}`,
    `LIC${randInt(100000, 999999)}`, ownerPhone, rand(CITIES), registeredAt);

  insIns.run(vid, rand(INSURANCE_COMPANIES), `POL${randInt(100000, 999999)}`,
    dateAgo(365), dateFuture(30, 365), rand(admins), registeredAt);

  const feePermit = randInt(50, 200);
  insPermit.run(vid, `BEL${randInt(10000, 99999)}`, feePermit, feePermit,
    dateAgo(365), dateFuture(30, 365), rand(admins), registeredAt);

  const inspector = rand(inspChiefs);
  insInsp.run(vid, inspector.id, inspector.full_name, 'صالحة', 'مركبة سليمة وتجاوزت الفحص الفني',
    randInt(20, 80), randInt(20, 80), dateAgo(365), dateFuture(30, 365), registeredAt);
}

const startDate = new Date('2025-01-01T00:00:00Z');
const endDate   = new Date('2026-06-17T00:00:00Z');

console.log(`⏳ جارٍ إدراج ${TOTAL} مواطن مع مركباتهم...`);
const t0 = Date.now();
let vehicleSeq = 1;

const insertBatch = db.transaction((count, offset) => {
  for (let i = 0; i < count; i++) {
    const seq = offset + i + 1;
    const gender = Math.random() < 0.55 ? 'male' : 'female';
    const { full_name, first, family } = randFullName(gender);
    const national_id = genNationalId(gender);
    const phone = genPhone();
    const email = genEmail(first, family, 1000 + seq);
    const created = randomDateBetween(startDate, endDate);
    const createdStr = fmt(created);

    const userResult = insUser.run(national_id, national_id, full_name, passwordHash, phone, gender, createdStr);
    const userId = userResult.lastInsertRowid;

    const reviewNumber = genReviewNumber();
    const isCompleted = Math.random() < 0.85;
    let status, reviewedBy, reviewedAt;
    if (isCompleted) {
      status = 'completed';
      reviewedBy = rand(regChiefs);
      reviewedAt = fmt(new Date(created.getTime() + randInt(1, 72) * 3600 * 1000));
    } else { status = 'pending'; reviewedBy = null; reviewedAt = null; }

    insReg.run(reviewNumber, userId, full_name, national_id, phone, email, status, reviewedBy, reviewedAt, createdStr);

    // كل مواطن يملك مركبة واحدة على الأقل
    insertVehicleFor(national_id, full_name, phone, vehicleSeq++);
    if (Math.random() < SECOND_VEHICLE_CHANCE) {
      insertVehicleFor(national_id, full_name, phone, vehicleSeq++);
    }
  }
});

const BATCH = 250;
for (let start = 0; start < TOTAL; start += BATCH) {
  const count = Math.min(BATCH, TOTAL - start);
  insertBatch(count, start);
  process.stdout.write(`\r  ✅ ${Math.min(start + count, TOTAL)}/${TOTAL} مواطن`);
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const totalUsers   = db.prepare("SELECT COUNT(*) c FROM users WHERE role='CITIZEN'").get().c;
const totalRegs    = db.prepare('SELECT COUNT(*) c FROM citizen_registrations').get().c;
const completed    = db.prepare("SELECT COUNT(*) c FROM citizen_registrations WHERE status='completed'").get().c;
const pending      = db.prepare("SELECT COUNT(*) c FROM citizen_registrations WHERE status='pending'").get().c;
const totalVehicles = db.prepare('SELECT COUNT(*) c FROM vehicles').get().c;
const totalOwners   = db.prepare('SELECT COUNT(*) c FROM vehicle_owners').get().c;
const totalIns       = db.prepare('SELECT COUNT(*) c FROM vehicle_insurance').get().c;
const totalPermits   = db.prepare('SELECT COUNT(*) c FROM vehicle_travel_permits').get().c;
const totalInsp       = db.prepare('SELECT COUNT(*) c FROM technical_inspections').get().c;

console.log(`\n\n✅ اكتمل في ${elapsed} ثانية!`);
console.log(`   👤 إجمالي مستخدمي CITIZEN: ${totalUsers}`);
console.log(`   📋 طلبات التسجيل: ${totalRegs}  (مكتملة: ${completed} — قيد الانتظار: ${pending})`);
console.log(`   🚗 إجمالي المركبات: ${totalVehicles}`);
console.log(`   🔗 سجلات الملاك: ${totalOwners}`);
console.log(`   🛡️ التأمين: ${totalIns}   📄 تصاريح/بل: ${totalPermits}   🔧 الفحص الفني: ${totalInsp}`);
console.log(`\n🔑 كلمة السر الافتراضية لجميع المواطنين الجدد: ${DEFAULT_PASSWORD}`);
console.log('   (يجب تغييرها عند أول تسجيل دخول لأن must_change_password=1)');

db.close();
