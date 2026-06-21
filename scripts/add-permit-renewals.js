/**
 * add-permit-renewals.js
 * يضيف سجل/سجلين تجديد سابقين (بل منتهية الصلاحية) لكل مركبة، بحيث يظهر "البل"
 * وكأنه مرّ بعملية تحديث/تجديد صلاحية حقيقية بمرور الوقت — دون التأثير على
 * البل الحالي الساري (لأن التطبيق يأخذ دائماً آخر سجل عبر ORDER BY recorded_at DESC).
 *
 * كما يطبع 5 حسابات مواطنين عشوائية (رقم وطني + كلمة السر) لتسجيل الدخول
 * عبر بوابة المواطن مباشرة.
 *
 * شغّل: node scripts/add-permit-renewals.js
 */
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../database/traffic.db'));
db.pragma('journal_mode = WAL');

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const admins = db.prepare("SELECT id FROM users WHERE role='ADMIN'").all().map(r => r.id);
if (!admins.length) admins.push(1);

function isoDate(d) { return d.toISOString().split('T')[0]; }
function isoDateTime(d) { return d.toISOString().replace('T', ' ').split('.')[0]; }

const insPermit = db.prepare(`
  INSERT INTO vehicle_travel_permits(vehicle_id, permit_number, fee_paid, fee, valid_from, valid_until, recorded_by, recorded_at)
  VALUES(?,?,?,?,?,?,?,?)
`);

// كل مركبة لها بل حالي ساري — نجلبها لنبني تاريخاً سابقاً لها
const vehicles = db.prepare(`
  SELECT v.id as vehicle_id, MIN(p.recorded_at) as first_recorded_at, MIN(p.valid_from) as first_valid_from
  FROM vehicles v JOIN vehicle_travel_permits p ON p.vehicle_id = v.id
  GROUP BY v.id
`).all();

console.log(`⏳ جارٍ إضافة تاريخ تجديد لـ ${vehicles.length} مركبة...`);
const t0 = Date.now();

const run = db.transaction(() => {
  for (const v of vehicles) {
    const firstValidFrom = new Date(v.first_valid_from || v.first_recorded_at);
    const numRenewals = Math.random() < 0.3 ? 2 : (Math.random() < 0.85 ? 1 : 0);

    let cursor = firstValidFrom;
    for (let r = numRenewals; r >= 1; r--) {
      // فترة سابقة منتهية الصلاحية (سنة كاملة قبل كل تجديد)
      const oldValidUntil = new Date(cursor); oldValidUntil.setDate(oldValidUntil.getDate() - 1);
      const oldValidFrom  = new Date(oldValidUntil); oldValidFrom.setFullYear(oldValidFrom.getFullYear() - 1); oldValidFrom.setDate(oldValidFrom.getDate() + 1);
      const recordedAt    = new Date(oldValidFrom); recordedAt.setDate(recordedAt.getDate() + randInt(0, 5));

      const fee = randInt(50, 200);
      insPermit.run(
        v.vehicle_id,
        `BEL${randInt(10000, 99999)}`,
        fee, fee,
        isoDate(oldValidFrom), isoDate(oldValidUntil),
        rand(admins), isoDateTime(recordedAt)
      );
      cursor = oldValidFrom;
    }
  }
});
run();

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const totalPermits = db.prepare('SELECT COUNT(*) c FROM vehicle_travel_permits').get().c;
console.log(`✅ تم في ${elapsed} ثانية. إجمالي سجلات البل الآن: ${totalPermits}`);

// ── عرض 5 حسابات مواطنين جاهزة لتسجيل الدخول ─────────────────────────
const samples = db.prepare(`
  SELECT u.national_id, u.full_name
  FROM users u WHERE u.role='CITIZEN'
  ORDER BY RANDOM() LIMIT 5
`).all();

console.log('\n🔑 حسابات جاهزة لتسجيل الدخول إلى بوابة المواطن (national_id كاسم مستخدم):');
samples.forEach(s => console.log(`   • ${s.national_id}  —  ${s.full_name}`));
console.log('   كلمة السر لجميعها: Citizen@2026  (سيُطلب تغييرها عند أول دخول)');

db.close();
