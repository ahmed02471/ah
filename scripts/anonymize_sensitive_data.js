/**
 * anonymize_sensitive_data.js — إخفاء/تزييف البيانات الحساسة في قاعدة البيانات
 *
 * يستبدل القيم الحقيقية بقيم وهمية تسلسلية فريدة (1111, 2222, 3333 ...) في:
 *   - الرقم الوطني      (users.national_id, vehicle_owners.owner_national_id,
 *                         citizen_registrations.national_id,
 *                         ownership_transfers.from_owner_national_id / to_owner_national_id,
 *                         pending_vehicle_data.owner_national_id)
 *   - رقم الهاتف        (users.phone, vehicle_owners.phone, citizen_registrations.phone,
 *                         ownership_transfers.to_owner_phone, pending_vehicle_data.owner_phone)
 *   - رقم رخصة القيادة  (vehicle_owners.driving_license, ownership_transfers.to_driving_license,
 *                         pending_vehicle_data.driving_license)
 *   - رقم بطاقة الهوية  (users.id_card_number, vehicle_owners.owner_id_card,
 *                         ownership_transfers.to_owner_id_card, pending_vehicle_data.owner_id_card)
 *   - رقم جواز السفر    (users.passport_number, vehicle_owners.owner_passport,
 *                         ownership_transfers.to_owner_passport, pending_vehicle_data.owner_passport)
 *   - رقم شهادة الميلاد (users.birth_cert_number)
 *   - العنوان           (vehicle_owners.address, ownership_transfers.to_address,
 *                         pending_vehicle_data.address)
 *
 * - الرقم الوطني الوهمي يبقى 12 رقماً، يبدأ بـ1 أو 2 (نفس جنس الرقم الأصلي إن وُجد)،
 *   وليس كل أرقامه متكررة وليس من القائمة المرفوضة — أي يحقق كل شروط
 *   التحقق الموجودة في authController.js / vehicleController_plate.js.
 * - نفس القيمة الحقيقية تُترجم دائماً لنفس القيمة الوهمية في كل الجداول، لذلك
 *   تبقى الروابط بين السجلات (نفس المالك = نفس الرقم في كل مكان) سليمة.
 * - لا تُمس: كلمات المرور (password_hash)، أسماء الأشخاص، أرقام اللوحات/الشاصي/الـQR
 *   (qr_token ضروري لميزة قراءة QR)، بيانات كاميرا المراقبة، سجل المراجعة (audit_log).
 *
 * شغّل من جذر المشروع (والسيرفر متوقف يفضّل):
 *   node scripts/anonymize_sensitive_data.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../database/traffic.db');
const BACKUP_PATH = DB_PATH + '.pre_anonymize_' + Date.now() + '.bak';

if (!fs.existsSync(DB_PATH)) {
  console.error('❌ لم يتم العثور على قاعدة البيانات في:', DB_PATH);
  process.exit(1);
}

const FIELD_GROUPS = {
  national_id: [
    ['users', 'national_id'],
    ['vehicle_owners', 'owner_national_id'],
    ['citizen_registrations', 'national_id'],
    ['ownership_transfers', 'from_owner_national_id'],
    ['ownership_transfers', 'to_owner_national_id'],
    ['pending_vehicle_data', 'owner_national_id'],
  ],
  phone: [
    ['users', 'phone'],
    ['vehicle_owners', 'phone'],
    ['citizen_registrations', 'phone'],
    ['ownership_transfers', 'to_owner_phone'],
    ['pending_vehicle_data', 'owner_phone'],
  ],
  license: [
    ['vehicle_owners', 'driving_license'],
    ['ownership_transfers', 'to_driving_license'],
    ['pending_vehicle_data', 'driving_license'],
  ],
  id_card: [
    ['users', 'id_card_number'],
    ['vehicle_owners', 'owner_id_card'],
    ['ownership_transfers', 'to_owner_id_card'],
    ['pending_vehicle_data', 'owner_id_card'],
  ],
  passport: [
    ['users', 'passport_number'],
    ['vehicle_owners', 'owner_passport'],
    ['ownership_transfers', 'to_owner_passport'],
    ['pending_vehicle_data', 'owner_passport'],
  ],
  birth_cert: [
    ['users', 'birth_cert_number'],
  ],
  address: [
    ['vehicle_owners', 'address'],
    ['ownership_transfers', 'to_address'],
    ['pending_vehicle_data', 'address'],
  ],
};

const NID_BLACKLIST = new Set(['123456789012', '210987654321', '012345678901']);

function isValidNationalId(s) {
  if (!/^\d{12}$/.test(s)) return false;
  if (!['1', '2'].includes(s[0])) return false;
  if (/^(\d)\1{11}$/.test(s)) return false;
  if (NID_BLACKLIST.has(s)) return false;
  return true;
}

function makeNationalId(original, n) {
  const prefix = original && ['1', '2'].includes(original[0]) ? original[0] : '1';
  const body = String(1111 * n).padStart(11, '0').slice(-11);
  const fake = prefix + body;
  if (!isValidNationalId(fake)) throw new Error('رقم وطني وهمي غير صالح: ' + fake);
  return fake;
}

function makePhone(n) {
  return '09' + String(1111 * n).padStart(8, '0').slice(-8);
}

function makeGeneric(n) {
  return String(1111 * n); // 1111, 2222, 3333 ...
}

function makeAddress(n) {
  return `عنوان تجريبي رقم ${n}`;
}

const MAKERS = {
  national_id: (orig, n) => makeNationalId(orig, n),
  phone: (orig, n) => makePhone(n),
  license: (orig, n) => makeGeneric(n),
  id_card: (orig, n) => makeGeneric(n),
  passport: (orig, n) => makeGeneric(n),
  birth_cert: (orig, n) => makeGeneric(n),
  address: (orig, n) => makeAddress(n),
};

function norm(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function tableHasColumn(db, table, col) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  return info.some((c) => c.name === col);
}

async function main() {
  console.log('📦 إنشاء نسخة احتياطية قبل التعديل:', BACKUP_PATH);
  fs.copyFileSync(DB_PATH, BACKUP_PATH);
  // نسخ ملفات WAL/SHM المرافقة إن وُجدت (لإتمام نسخة متناسقة عند الفحص اليدوي)
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(DB_PATH + ext)) {
      fs.copyFileSync(DB_PATH + ext, BACKUP_PATH + ext);
    }
  }
  console.log('✅ تم حفظ النسخة الاحتياطية.');

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const report = [];
  let totalUpdates = 0;

  const tx = db.transaction(() => {
    for (const [group, columns] of Object.entries(FIELD_GROUPS)) {
      const existingCols = columns.filter(([t, c]) => tableHasColumn(db, t, c));
      if (existingCols.length === 0) continue;

      // 1) بناء قاموس التعيين: القيمة الحقيقية -> القيمة الوهمية
      const mapping = new Map();
      let counter = 0;
      for (const [table, col] of existingCols) {
        const rows = db.prepare(`SELECT id, ${col} as val FROM ${table} ORDER BY id ASC`).all();
        for (const row of rows) {
          const nv = norm(row.val);
          if (nv === null) continue;
          if (!mapping.has(nv)) {
            counter += 1;
            mapping.set(nv, MAKERS[group](nv, counter));
          }
        }
      }
      if (mapping.size === 0) {
        report.push(`[${group}] لا توجد قيم لتزييفها.`);
        continue;
      }

      // تحقق من عدم وجود تكرار في القيم الوهمية المولّدة
      const fakeValues = Array.from(mapping.values());
      if (new Set(fakeValues).size !== fakeValues.length) {
        throw new Error(`تعارض/تكرار في القيم الوهمية لعائلة ${group}!`);
      }

      // 2) تطبيق التحديثات
      let groupUpdates = 0;
      for (const [table, col] of existingCols) {
        const updateStmt = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE id = ?`);
        const rows = db.prepare(`SELECT id, ${col} as val FROM ${table} ORDER BY id ASC`).all();
        for (const row of rows) {
          const nv = norm(row.val);
          if (nv === null) continue;
          const fake = mapping.get(nv);
          if (fake !== row.val) {
            updateStmt.run(fake, row.id);
            groupUpdates += 1;
          }
        }
      }
      totalUpdates += groupUpdates;
      report.push(
        `[${group}] قيم حقيقية فريدة: ${mapping.size} — صفوف محدّثة: ${groupUpdates} — نموذج: ${fakeValues[0]} -> ${fakeValues[1] || fakeValues[0]}`
      );
    }
  });

  tx();

  // فحص نهائي
  const nidRows = db.prepare(`SELECT national_id FROM users WHERE national_id IS NOT NULL`).all();
  const nids = nidRows.map((r) => r.national_id);
  const invalid = nids.filter((n) => !isValidNationalId(n));
  const dupCount = nids.length - new Set(nids).size;

  report.push('---');
  report.push(`إجمالي عمليات التحديث: ${totalUpdates}`);
  report.push(`users.national_id: عدد=${nids.length} غير صالح=${invalid.length} مكرر=${dupCount}`);
  if (invalid.length) report.push('أمثلة غير صالحة: ' + invalid.slice(0, 5).join(', '));

  db.close();

  console.log('\n' + report.join('\n'));
  console.log('\n✅ تم الانتهاء. إن ظهرت أي مشكلة يمكنك استرجاع النسخة الاحتياطية من:\n   ' + BACKUP_PATH);
}

main().catch((err) => {
  console.error('❌ فشل التنفيذ:', err.message);
  console.error('النسخة الاحتياطية محفوظة في:', BACKUP_PATH, '— لم يتم فقد أي بيانات.');
  process.exit(1);
});
