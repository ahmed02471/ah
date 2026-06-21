/**
 * verify_anonymize.js — فحص سريع للتأكد من نتيجة التزييف (بدون أي تعديل)
 * شغّل (والسيرفر متوقف يفضّل، لكن لا ضرر إن كان يعمل لأن هذا قراءة فقط):
 *   node scripts\verify_anonymize.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const DB_PATH = path.join(__dirname, '../database/traffic.db');

const db = new Database(DB_PATH, { readonly: true });

console.log('عدد المستخدمين:', db.prepare('SELECT COUNT(*) n FROM users').get().n);
console.log('تكرار username:', db.prepare('SELECT username, COUNT(*) c FROM users GROUP BY username HAVING c>1').all());
console.log('تكرار national_id:', db.prepare('SELECT national_id, COUNT(*) c FROM users GROUP BY national_id HAVING c>1').all());

console.log('\n--- نموذج من users (أول 5) ---');
for (const r of db.prepare('SELECT id, username, national_id, phone FROM users LIMIT 5').all()) {
  console.log(r);
}

console.log('\n--- مركبة 1528 (نفس الصفحة التي صوّرتها سابقاً) ---');
const owner = db.prepare(`
  SELECT vo.owner_national_id, vo.owner_id_card, vo.driving_license, vo.phone, vo.address, vo.owner_name
  FROM vehicle_owners vo
  WHERE vo.vehicle_id = (SELECT id FROM vehicles WHERE id = 1528)
  ORDER BY vo.id DESC LIMIT 1
`).get();
console.log(owner);

db.close();
