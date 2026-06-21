/**
 * fix-inspector-names.js
 * يصلح حقل "اسم الفاحص" الفارغ (—) الذي ظهر في صفحة تفاصيل المركبة.
 * السبب: سكريبت seed-citizens.js أدرج inspector_id بدون inspector_name،
 * وصفحة vehicle-detail.html تعرض inspector_name مباشرة (لا تربطه بجدول users).
 * هذا السكريبت يعبّئ الاسم من جدول users عبر inspector_id لكل السجلات الفارغة.
 *
 * شغّل: node scripts/fix-inspector-names.js
 */
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../database/traffic.db'));
db.pragma('journal_mode = WAL');

const before = db.prepare(`
  SELECT COUNT(*) c FROM technical_inspections
  WHERE (inspector_name IS NULL OR inspector_name='') AND inspector_id IS NOT NULL
`).get().c;

const result = db.prepare(`
  UPDATE technical_inspections
  SET inspector_name = (SELECT full_name FROM users WHERE id = technical_inspections.inspector_id)
  WHERE (inspector_name IS NULL OR inspector_name='') AND inspector_id IS NOT NULL
`).run();

console.log(`✅ تم تعبئة اسم الفاحص في ${result.changes} سجل (كان ${before} سجلاً فارغاً).`);

const stillEmpty = db.prepare(`SELECT COUNT(*) c FROM technical_inspections WHERE inspector_name IS NULL OR inspector_name=''`).get().c;
console.log(`   متبقٍ فارغ (بلا inspector_id أصلاً): ${stillEmpty}`);

db.close();
