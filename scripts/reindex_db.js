/**
 * reindex_db.js — إعادة بناء كل الفهارس (indexes) من بيانات الجداول الحالية
 * لا يغيّر أي قيمة بيانات إطلاقاً — يعالج فقط فهارس غير متزامنة مع الجداول.
 *
 * شغّل (والسيرفر متوقف):
 *   node scripts\reindex_db.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../database/traffic.db');
const BACKUP_PATH = DB_PATH + '.pre_reindex_' + Date.now() + '.bak';

console.log('📦 نسخة احتياطية:', BACKUP_PATH);
fs.copyFileSync(DB_PATH, BACKUP_PATH);

const db = new Database(DB_PATH);

console.log('🔍 integrity_check قبل REINDEX:');
const before = db.pragma('integrity_check');
console.log(before.length === 1 && before[0].integrity_check === 'ok' ? '✅ ok' : `⚠️ ${before.length} مشكلة`);

console.log('🔄 تنفيذ REINDEX...');
db.exec('REINDEX;');

console.log('🔍 integrity_check بعد REINDEX:');
const after = db.pragma('integrity_check');
if (after.length === 1 && after[0].integrity_check === 'ok') {
  console.log('✅ ok — الفهارس سليمة الآن.');
} else {
  console.log(`⚠️ ما زال هناك ${after.length} مشكلة:`);
  console.log(after.slice(0, 10));
}

db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log('✅ تم.');
