/**
 * check_and_checkpoint_db.js — تشخيص بسيط + دمج ملف WAL داخل قاعدة البيانات
 *
 * يفتح قاعدة البيانات فقط (بدون أي تعديل على البيانات)، يطبع فحص السلامة،
 * ثم يدمج ملف WAL (wal_checkpoint) لتنظيف الحالة قبل تشغيل أي سكربت آخر.
 *
 * شغّل (والسيرفر متوقف):
 *   node scripts\check_and_checkpoint_db.js
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../database/traffic.db');

try {
  console.log('🔍 فتح قاعدة البيانات:', DB_PATH);
  const db = new Database(DB_PATH);
  console.log('✅ تم الفتح بنجاح.');

  console.log('🔍 فحص السلامة (integrity_check)...');
  const integrity = db.pragma('integrity_check');
  if (integrity.length === 1 && integrity[0].integrity_check === 'ok') {
    console.log('✅ سليمة: ok');
  } else {
    console.log('⚠️ نتائج الفحص:', integrity.length, 'سطر');
    console.log(integrity.slice(0, 10));
  }

  console.log('🔄 دمج WAL (checkpoint)...');
  const cp = db.pragma('wal_checkpoint(TRUNCATE)');
  console.log('نتيجة checkpoint:', cp);

  console.log('📊 عدد المستخدمين:', db.prepare('SELECT COUNT(*) AS n FROM users').get());

  db.close();
  console.log('✅ تم بنجاح. القاعدة جاهزة لتشغيل سكربت التزييف.');
} catch (err) {
  console.error('❌ فشل:', err.message);
  console.error(err);
  process.exit(1);
}
