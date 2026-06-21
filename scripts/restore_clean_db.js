/**
 * restore_clean_db.js — استبدال traffic.db الحالي (الذي يفشل بخطأ malformed)
 * بأحدث نسخة احتياطية سليمة ومؤكدة (pre_reindex)، بعد التحقق من سلامتها فعلاً.
 *
 * لا يحذف أي شيء: يعيد تسمية الملف الحالي المشتبه به (suspect) بدل حذفه.
 *
 * شغّل (والسيرفر متوقف تماماً):
 *   node scripts\restore_clean_db.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '../database');
const DB_PATH = path.join(DB_DIR, 'traffic.db');
const GOOD_BACKUP = path.join(DB_DIR, 'traffic.db.pre_reindex_1782006738300.bak');
const SUSPECT_PATH = DB_PATH + '.suspect_' + Date.now();

if (!fs.existsSync(GOOD_BACKUP)) {
  console.error('❌ لم أجد النسخة الاحتياطية السليمة:', GOOD_BACKUP);
  process.exit(1);
}

console.log('🔍 فحص النسخة الاحتياطية قبل الاستخدام...');
const checkDb = new Database(GOOD_BACKUP, { readonly: true });
const integrity = checkDb.pragma('integrity_check');
const usersCount = checkDb.prepare('SELECT COUNT(*) AS n FROM users').get().n;
checkDb.close();

const isOk = integrity.length === 1 && integrity[0].integrity_check === 'ok';
console.log(`   integrity_check: ${isOk ? 'ok' : integrity.length + ' مشكلة'} — عدد المستخدمين: ${usersCount}`);

if (!isOk || usersCount < 1000) {
  console.error('❌ النسخة الاحتياطية نفسها تبدو غير سليمة — توقفت دون أي تغيير.');
  process.exit(1);
}

console.log('📦 نقل الملف الحالي (المشتبه به) إلى:', SUSPECT_PATH);
fs.renameSync(DB_PATH, SUSPECT_PATH);
for (const ext of ['-wal', '-shm']) {
  if (fs.existsSync(DB_PATH + ext)) fs.renameSync(DB_PATH + ext, SUSPECT_PATH + ext);
}

console.log('📥 نسخ الملف السليم إلى مكانه:', DB_PATH);
fs.copyFileSync(GOOD_BACKUP, DB_PATH);

console.log('🔍 التحقق النهائي من الملف الجديد...');
const finalDb = new Database(DB_PATH);
const finalIntegrity = finalDb.pragma('integrity_check');
const finalCount = finalDb.prepare('SELECT COUNT(*) AS n FROM users').get().n;
finalDb.pragma('wal_checkpoint(TRUNCATE)');
finalDb.close();

const finalOk = finalIntegrity.length === 1 && finalIntegrity[0].integrity_check === 'ok';
console.log(`   integrity_check: ${finalOk ? 'ok ✅' : finalIntegrity.length + ' مشكلة ⚠️'} — عدد المستخدمين: ${finalCount}`);

if (finalOk) {
  console.log('\n✅ تم استبدال قاعدة البيانات بنسخة سليمة بنجاح. يمكنك الآن تشغيل anonymize_sensitive_data.js');
} else {
  console.log('\n⚠️ ظهرت مشكلة حتى مع الملف الجديد — قد يكون السبب خارجياً (مزامنة/حماية) يتدخل فوراً. أعد المحاولة بعد إيقاف OneDrive أو إضافة استثناء حماية لهذا المجلد.');
}
