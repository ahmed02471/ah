/**
 * fix_duplicate_users.js
 *
 * يصلح تكرار 7 حسابات (admin, reg.chief, insp.chief, violations.dept,
 * plate.dept, officer.001, ahmad515) الموجودة 3 مرات في جدول users
 * بسبب تشغيل سكربت التهيئة أكثر من مرة بالخطأ.
 *
 * لا يحذف أي صف. يحافظ على النسخة الأصلية المستخدمة فعلياً (id 1-7، لها
 * last_login حقيقي) كما هي، ويعيد تسمية النسختين غير المستخدمتين فقط:
 *   - username:    يضاف له "_dup1" أو "_dup2"
 *   - national_id: يُولَّد له رقم وطني وهمي صالح وفريد (فقط إن كان مكرراً)
 *
 * يفحص كل القاعدة بمسح كامل (بدون WHERE/GROUP BY على أعمدة الفهارس
 * المعطوبة) لتفادي نتائج مضللة، ثم يعالج التكرار، ثم يشغّل REINDEX،
 * ثم integrity_check نهائي.
 *
 * شغّل (والسيرفر متوقف تماماً):
 *   node scripts\fix_duplicate_users.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../database/traffic.db');
const BACKUP_PATH = DB_PATH + '.pre_fix_dup_' + Date.now() + '.bak';

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

  console.log('📦 نسخة احتياطية قبل أي تعديل:', BACKUP_PATH);
  fs.copyFileSync(DB_PATH, BACKUP_PATH);
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(DB_PATH + ext)) fs.copyFileSync(DB_PATH + ext, BACKUP_PATH + ext);
  }

  const db = new Database(DB_PATH);

  console.log('🔍 مسح كامل لجدول users (بدون أي فلترة على أعمدة مفهرسة)...');
  const allRows = db.prepare('SELECT id, username, national_id, full_name, created_at, last_login FROM users').all();
  console.log(`   عدد الصفوف: ${allRows.length}`);

  // تجميع حسب username
  const byUsername = new Map();
  for (const r of allRows) {
    if (!byUsername.has(r.username)) byUsername.set(r.username, []);
    byUsername.get(r.username).push(r);
  }

  // تجميع حسب national_id
  const byNid = new Map();
  for (const r of allRows) {
    if (r.national_id === null) continue;
    if (!byNid.has(r.national_id)) byNid.set(r.national_id, []);
    byNid.get(r.national_id).push(r);
  }

  const existingNids = new Set(allRows.map((r) => r.national_id).filter((v) => v !== null));

  const usernameUpdates = []; // {id, oldUsername, newUsername}
  const nidUpdates = []; // {id, oldNid, newNid}

  // 1) حل تكرار username: أبقِ أقدم id (الأصلي المستخدم فعلياً) بدون تغيير،
  //    وأعد تسمية الباقي بترتيب الإنشاء.
  for (const [username, rows] of byUsername.entries()) {
    if (rows.length <= 1) continue;
    const sorted = rows.slice().sort((a, b) => a.id - b.id);
    sorted.forEach((row, idx) => {
      if (idx === 0) return; // الأصلي — لا يُغيَّر
      const suffix = `_dup${idx}`;
      let candidate = username + suffix;
      // تأكد من عدم تعارض الاسم الجديد مع أي username موجود فعلاً
      let n = idx;
      while (byUsername.has(candidate)) {
        n += 1;
        candidate = username + `_dup${n}`;
      }
      usernameUpdates.push({ id: row.id, oldUsername: username, newUsername: candidate, createdAt: row.created_at, lastLogin: row.last_login });
    });
  }

  // 2) حل تكرار national_id: أبقِ أقدم id بدون تغيير، ولّد رقماً وطنياً
  //    وهمياً صالحاً وفريداً للباقي.
  let nidCounter = 900000000; // قاعدة بداية بعيدة عن أي رقم حقيقي محتمل
  function generateUniqueFakeNid(originalPrefix) {
    let attempt;
    do {
      nidCounter += 1;
      const body = String(nidCounter).padStart(11, '0').slice(-11);
      attempt = originalPrefix + body;
    } while (!isValidNationalId(attempt) || existingNids.has(attempt));
    existingNids.add(attempt);
    return attempt;
  }

  for (const [nid, rows] of byNid.entries()) {
    if (rows.length <= 1) continue;
    const sorted = rows.slice().sort((a, b) => a.id - b.id);
    sorted.forEach((row, idx) => {
      if (idx === 0) return; // الأصلي — لا يُغيَّر
      const prefix = ['1', '2'].includes(nid[0]) ? nid[0] : '1';
      const fake = generateUniqueFakeNid(prefix);
      nidUpdates.push({ id: row.id, oldNid: nid, newNid: fake });
    });
  }

  console.log(`\n📝 تعديلات username: ${usernameUpdates.length}`);
  usernameUpdates.forEach((u) => console.log(`   id=${u.id}  ${u.oldUsername} -> ${u.newUsername}   (created_at=${u.createdAt}, last_login=${u.lastLogin})`));

  console.log(`\n📝 تعديلات national_id: ${nidUpdates.length}`);
  nidUpdates.forEach((u) => console.log(`   id=${u.id}  ${u.oldNid} -> ${u.newNid}`));

  if (usernameUpdates.length === 0 && nidUpdates.length === 0) {
    console.log('\n✅ لا يوجد أي تكرار حقيقي — لا حاجة لأي تعديل.');
  } else {
    const tx = db.transaction(() => {
      const upU = db.prepare('UPDATE users SET username = ? WHERE id = ?');
      for (const u of usernameUpdates) upU.run(u.newUsername, u.id);
      const upN = db.prepare('UPDATE users SET national_id = ? WHERE id = ?');
      for (const u of nidUpdates) upN.run(u.newNid, u.id);
    });
    tx();
    console.log('\n✅ تم تطبيق التعديلات.');
  }

  console.log('\n🔄 تنفيذ REINDEX للتأكد من سلامة الفهارس الآن...');
  try {
    db.exec('REINDEX;');
    console.log('✅ نجح REINDEX.');
  } catch (e) {
    console.error('❌ فشل REINDEX:', e.message);
    console.error('النسخة الاحتياطية قبل هذا السكربت محفوظة في:', BACKUP_PATH);
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
  if (ok) {
    console.log('\n✅ القاعدة سليمة الآن وجاهزة. الخطوة التالية: node scripts\\anonymize_sensitive_data.js');
  } else {
    console.log('\n⚠️ ما زالت هناك مشكلة — لا تشغّل سكربت التزييف قبل مراجعة هذا.');
  }
}

main();
