/**
 * rebuild_users_table.js
 *
 * السبب: السكربت السابق (fix_duplicate_users.js) اكتشف أن أي UPDATE على
 * عمودي username أو national_id يفشل بـ "database disk image is malformed".
 * هذا يعني أن صفحات الفهرس (index) لهذين العمودين معطوبة فعلياً على القرص
 * (وليس فقط "ناقصة منطقياً" كما بدا من integrity_check) — وهذا أيضاً يفسّر
 * كيف تكرر إدراج نفس username/national_id 3 مرات دون أن يرفضه قيد UNIQUE.
 *
 * الحل القياسي لهذا النوع من العطب: إعادة بناء الجدول من الصفر.
 *   1) قراءة كل الصفوف بمسح كامل (لا يستخدم الفهرس المعطوب).
 *   2) حساب نفس تصحيحات التكرار المعتمدة سابقاً (إعادة تسمية النسخ غير
 *      المستخدمة فقط: username + "_dupN"، وتوليد national_id وهمي صالح
 *      وفريد فقط لنسخ ahmad515 المكررة). الحساب نفسه المستخدم في
 *      fix_duplicate_users.js، لم يتغيّر شيء في القرار.
 *   3) إعادة تسمية الجدول القديم، إنشاء جدول users جديد بنفس البنية
 *      تماماً، إدخال كل الصفوف (المصححة) فيه — هذا يبني فهارس جديدة
 *      سليمة من الصفر.
 *   4) حذف الجدول القديم المعطوب (بعد التأكد من نجاح الإدخال الكامل).
 *
 * لا تُفقد أي بيانات: نسخة احتياطية كاملة تُؤخذ أولاً، ولا يُحذف أي صف،
 * فقط يُعاد تسمية username/national_id للنسخ غير المستخدمة كما تمت
 * الموافقة عليه.
 *
 * شغّل (والسيرفر متوقف تماماً):
 *   node scripts\rebuild_users_table.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../database/traffic.db');
const BACKUP_PATH = DB_PATH + '.pre_rebuild_users_' + Date.now() + '.bak';

const NID_BLACKLIST = new Set(['123456789012', '210987654321', '012345678901']);
function isValidNationalId(s) {
  if (!/^\d{12}$/.test(s)) return false;
  if (!['1', '2'].includes(s[0])) return false;
  if (/^(\d)\1{11}$/.test(s)) return false;
  if (NID_BLACKLIST.has(s)) return false;
  return true;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('❌ لم يتم العثور على قاعدة البيانات في:', DB_PATH);
    process.exit(1);
  }

  console.log('📦 نسخة احتياطية كاملة قبل أي تعديل:', BACKUP_PATH);
  fs.copyFileSync(DB_PATH, BACKUP_PATH);
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(DB_PATH + ext)) fs.copyFileSync(DB_PATH + ext, BACKUP_PATH + ext);
  }

  const db = new Database(DB_PATH);

  // بنية الجدول والفهارس الحالية (لإعادة إنشائها بالضبط)
  const tableSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`).get();
  const indexRows = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='users' AND sql IS NOT NULL`).all();
  if (!tableSql) {
    console.error('❌ لم أجد تعريف جدول users.');
    process.exit(1);
  }
  console.log('📐 تعريف الجدول الحالي محفوظ. عدد الفهارس الصريحة (غير autoindex):', indexRows.length);

  console.log('🔍 مسح كامل لجدول users (لا يلمس الفهرس المعطوب)...');
  const allRows = db.prepare(`SELECT * FROM users`).all();
  console.log(`   عدد الصفوف: ${allRows.length}`);

  // نفس حساب التصحيح المعتمد من fix_duplicate_users.js
  const byUsername = new Map();
  for (const r of allRows) {
    if (!byUsername.has(r.username)) byUsername.set(r.username, []);
    byUsername.get(r.username).push(r);
  }
  const byNid = new Map();
  for (const r of allRows) {
    if (r.national_id === null) continue;
    if (!byNid.has(r.national_id)) byNid.set(r.national_id, []);
    byNid.get(r.national_id).push(r);
  }
  const existingNids = new Set(allRows.map((r) => r.national_id).filter((v) => v !== null));

  const usernameFix = new Map(); // id -> newUsername
  for (const [username, rows] of byUsername.entries()) {
    if (rows.length <= 1) continue;
    const sorted = rows.slice().sort((a, b) => a.id - b.id);
    sorted.forEach((row, idx) => {
      if (idx === 0) return;
      let n = idx;
      let candidate = username + `_dup${n}`;
      while (byUsername.has(candidate)) {
        n += 1;
        candidate = username + `_dup${n}`;
      }
      usernameFix.set(row.id, candidate);
    });
  }

  let nidCounter = 900000000;
  function generateUniqueFakeNid(prefix) {
    let attempt;
    do {
      nidCounter += 1;
      const body = String(nidCounter).padStart(11, '0').slice(-11);
      attempt = prefix + body;
    } while (!isValidNationalId(attempt) || existingNids.has(attempt));
    existingNids.add(attempt);
    return attempt;
  }
  const nidFix = new Map(); // id -> newNid
  for (const [nid, rows] of byNid.entries()) {
    if (rows.length <= 1) continue;
    const sorted = rows.slice().sort((a, b) => a.id - b.id);
    sorted.forEach((row, idx) => {
      if (idx === 0) return;
      const prefix = ['1', '2'].includes(nid[0]) ? nid[0] : '1';
      nidFix.set(row.id, generateUniqueFakeNid(prefix));
    });
  }

  console.log(`\n📝 تصحيحات username: ${usernameFix.size} — تصحيحات national_id: ${nidFix.size}`);
  for (const [id, v] of usernameFix.entries()) console.log(`   id=${id} username -> ${v}`);
  for (const [id, v] of nidFix.entries()) console.log(`   id=${id} national_id -> ${v}`);

  const columns = Object.keys(allRows[0]);
  const placeholders = columns.map(() => '?').join(',');
  const colList = columns.join(',');

  console.log('\n🔧 إعادة بناء الجدول (إعادة تسمية -> إنشاء جديد -> إدخال -> حذف القديم)...');

  const OLD_NAME = 'users_old_corrupt_' + Date.now();

  try {
    db.exec('PRAGMA foreign_keys = OFF;'); // مؤقتاً فقط أثناء إعادة البناء

    const tx = db.transaction(() => {
      db.exec(`ALTER TABLE users RENAME TO ${OLD_NAME};`);

      // الفهارس الصريحة تبقى مرتبطة بالجدول القديم بعد إعادة التسمية
      // (أسماؤها لا تُعاد تسميتها تلقائياً) — يجب حذفها هنا قبل إنشاء
      // فهارس جديدة بنفس الاسم على الجدول الجديد.
      for (const idx of indexRows) {
        db.exec(`DROP INDEX IF EXISTS ${idx.name};`);
      }

      const newTableSql = tableSql.sql.replace(/CREATE TABLE\s+users\b/i, 'CREATE TABLE users');
      db.exec(newTableSql);

      const insertStmt = db.prepare(`INSERT INTO users (${colList}) VALUES (${placeholders})`);
      for (const row of allRows) {
        const fixedRow = { ...row };
        if (usernameFix.has(row.id)) fixedRow.username = usernameFix.get(row.id);
        if (nidFix.has(row.id)) fixedRow.national_id = nidFix.get(row.id);
        insertStmt.run(columns.map((c) => fixedRow[c]));
      }

      for (const idx of indexRows) {
        db.exec(idx.sql);
      }

      const newCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
      if (newCount !== allRows.length) {
        throw new Error(`عدد الصفوف بعد الإدخال (${newCount}) لا يطابق العدد الأصلي (${allRows.length})!`);
      }

      db.exec(`DROP TABLE ${OLD_NAME};`);
      db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(OLD_NAME);
    });

    tx();
    db.exec('PRAGMA foreign_keys = ON;');
    console.log('✅ تم إعادة بناء الجدول بنجاح.');
  } catch (e) {
    console.error('❌ فشلت إعادة البناء:', e.message);
    console.error('النسخة الاحتياطية قبل هذا السكربت محفوظة في:', BACKUP_PATH, '— لم تُفقد أي بيانات (لم يُحذف الجدول القديم إن وصل الخطأ هنا).');
    db.close();
    process.exit(1);
  }

  console.log('\n🔍 integrity_check نهائي...');
  const integrity = db.pragma('integrity_check');
  const ok = integrity.length === 1 && integrity[0].integrity_check === 'ok';
  console.log(ok ? '✅ ok' : `⚠️ ${integrity.length} مشكلة`);
  if (!ok) console.log(integrity.slice(0, 10));

  db.pragma('wal_checkpoint(TRUNCATE)');
  const finalCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const dupCheckU = db.prepare('SELECT username, COUNT(*) c FROM users GROUP BY username HAVING c>1').all();
  const dupCheckN = db.prepare('SELECT national_id, COUNT(*) c FROM users GROUP BY national_id HAVING c>1').all();
  db.close();

  console.log(`📊 عدد المستخدمين النهائي: ${finalCount} — تكرار username متبقٍ: ${dupCheckU.length} — تكرار national_id متبقٍ: ${dupCheckN.length}`);

  if (ok && dupCheckU.length === 0 && dupCheckN.length === 0) {
    console.log('\n✅ القاعدة سليمة تماماً الآن. الخطوة التالية: node scripts\\anonymize_sensitive_data.js');
  } else {
    console.log('\n⚠️ راجع النتائج أعلاه قبل المتابعة.');
  }
}

main();
