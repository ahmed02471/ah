/**
 * restore_and_fix_db.js
 * 1) يستبدل traffic.db الحالي (يفشل بخطأ malformed) بنسخة احتياطية سليمة معروفة.
 * 2) يصلح فجوة فهارس معروفة وضيّقة (أول 15 صفاً في users غير مفهرسة بشكل صحيح
 *    على username/national_id — لا يوجد أي تكرار حقيقي في القيم، تم التأكد من ذلك)
 *    عبر REINDEX.
 * لا يحذف أي شيء؛ الملف القديم يُنقل لا يُحذف.
 *
 * شغّل (والسيرفر متوقف تماماً):
 *   node scripts\restore_and_fix_db.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '../database');
const DB_PATH = path.join(DB_DIR, 'traffic.db');
const GOOD_BACKUP = path.join(DB_DIR, 'traffic.db.pre_reindex_1782006738300.bak');
const SUSPECT_PATH = DB_PATH + '.suspect_' + Date.now();

function main() {
  if (!fs.existsSync(GOOD_BACKUP)) {
    console.error('❌ لم أجد النسخة الاحتياطية:', GOOD_BACKUP);
    process.exit(1);
  }

  console.log('🔍 فحص النسخة الاحتياطية قبل الاستخدام (بدون لمس الملف الحالي بعد)...');
  const check = new Database(GOOD_BACKUP, { readonly: true });
  const usersCount = check.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const dupUsername = check.prepare('SELECT username, COUNT(*) c FROM users GROUP BY username HAVING c>1').all();
  const dupNid = check.prepare('SELECT national_id, COUNT(*) c FROM users GROUP BY national_id HAVING c>1').all();
  check.close();
  console.log(`   عدد المستخدمين: ${usersCount} — تكرار username: ${dupUsername.length} — تكرار national_id: ${dupNid.length}`);

  if (usersCount < 1000 || dupUsername.length > 0 || dupNid.length > 0) {
    console.error('❌ توجد مشكلة حقيقية (تكرار فعلي أو عدد صفوف غير منطقي) — توقفت دون أي تغيير.');
    if (dupUsername.length) console.error('أسماء مستخدمين مكررة:', dupUsername);
    if (dupNid.length) console.error('أرقام وطنية مكررة:', dupNid);
    process.exit(1);
  }

  console.log('📦 نقل الملف الحالي إلى:', SUSPECT_PATH);
  fs.renameSync(DB_PATH, SUSPECT_PATH);
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(DB_PATH + ext)) fs.renameSync(DB_PATH + ext, SUSPECT_PATH + ext);
  }

  console.log('📥 نسخ النسخة السليمة إلى مكانها:', DB_PATH);
  fs.copyFileSync(GOOD_BACKUP, DB_PATH);

  const db = new Database(DB_PATH);

  console.log('🔄 تنفيذ REINDEX لإصلاح فجوة الفهارس...');
  try {
    db.exec('REINDEX;');
    console.log('✅ نجح REINDEX.');
  } catch (e) {
    console.error('❌ فشل REINDEX:', e.message);
    console.error('الملف القديم محفوظ في:', SUSPECT_PATH, '— لم تفقد أي بيانات.');
    db.close();
    process.exit(1);
  }

  const integrity = db.pragma('integrity_check');
  const ok = integrity.length === 1 && integrity[0].integrity_check === 'ok';
  console.log('🔍 integrity_check النهائي:', ok ? 'ok ✅' : `${integrity.length} مشكلة ⚠️`);
  if (!ok) console.log(integrity.slice(0, 10));

  db.pragma('wal_checkpoint(TRUNCATE)');
  const finalCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  db.close();

  console.log(`📊 عدد المستخدمين النهائي: ${finalCount}`);
  if (ok && finalCount === usersCount) {
    console.log('\n✅ القاعدة سليمة الآن وجاهزة. يمكنك تشغيل: node scripts\\anonymize_sensitive_data.js');
  } else {
    console.log('\n⚠️ راجع النتائج أعلاه قبل المتابعة.');
  }
}

main();
