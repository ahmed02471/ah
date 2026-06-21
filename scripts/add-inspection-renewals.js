/**
 * add-inspection-renewals.js
 * نفس فكرة تجديد "البل" — لكن لجدول الفحص الفني (technical_inspections).
 * يضيف لكل مركبة سجل/سجلين فحص فني سابقين منتهيي الصلاحية (فحص دوري سابق)
 * دون التأثير على الفحص الحالي الساري، لأن التطبيق يأخذ آخر سجل دائماً عبر
 * ORDER BY inspection_date DESC (نفس منطق vehicleController.js getVehicleDetail).
 *
 * شغّل: node scripts/add-inspection-renewals.js
 */
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../database/traffic.db'));
db.pragma('journal_mode = WAL');

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const inspChiefs = db.prepare("SELECT id, full_name FROM users WHERE role='INSP_CHIEF'").all();
if (!inspChiefs.length) inspChiefs.push({ id: 3, full_name: 'رئيس الفحص' });

function isoDate(d) { return d.toISOString().split('T')[0]; }

const insInsp = db.prepare(`
  INSERT INTO technical_inspections(vehicle_id, inspector_id, inspector_name, result, notes, fee_paid, fee, valid_from, valid_until, inspection_date)
  VALUES(?,?,?,?,?,?,?,?,?,?)
`);

// كل مركبة لها فحص فني حالي — نبني لها تاريخ فحوصات سابقة
const vehicles = db.prepare(`
  SELECT v.id as vehicle_id, MIN(t.valid_from) as first_valid_from, MIN(t.inspection_date) as first_inspection_date
  FROM vehicles v JOIN technical_inspections t ON t.vehicle_id = v.id
  GROUP BY v.id
`).all();

console.log(`⏳ جارٍ إضافة تاريخ فحص فني سابق لـ ${vehicles.length} مركبة...`);
const t0 = Date.now();

const run = db.transaction(() => {
  for (const v of vehicles) {
    const firstValidFrom = new Date(v.first_valid_from || v.first_inspection_date);
    // الفحص الفني سنوي عادة — نولّد 0-2 فحوصات سابقة
    const numRenewals = Math.random() < 0.3 ? 2 : (Math.random() < 0.85 ? 1 : 0);

    let cursor = firstValidFrom;
    for (let r = numRenewals; r >= 1; r--) {
      const oldValidUntil = new Date(cursor); oldValidUntil.setDate(oldValidUntil.getDate() - 1);
      const oldValidFrom  = new Date(oldValidUntil); oldValidFrom.setFullYear(oldValidFrom.getFullYear() - 1); oldValidFrom.setDate(oldValidFrom.getDate() + 1);
      const inspectionDate = new Date(oldValidFrom); inspectionDate.setDate(inspectionDate.getDate() + randInt(0, 3));

      // بعض الفحوصات القديمة قد تكون "غير صالحة" أول مرة ثم أُعيد فحصها — تنويع واقعي بسيط
      const result = Math.random() < 0.08 ? 'غير صالحة' : 'صالحة';
      const notes = result === 'صالحة' ? 'مركبة سليمة وتجاوزت الفحص الفني' : 'تحتاج إصلاح وإعادة فحص';
      const fee = randInt(20, 80);
      const inspector = rand(inspChiefs);

      insInsp.run(
        v.vehicle_id,
        inspector.id, inspector.full_name, result, notes,
        fee, fee,
        isoDate(oldValidFrom), isoDate(oldValidUntil),
        isoDate(inspectionDate)
      );
      cursor = oldValidFrom;
    }
  }
});
run();

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const total = db.prepare('SELECT COUNT(*) c FROM technical_inspections').get().c;
console.log(`✅ تم في ${elapsed} ثانية. إجمالي سجلات الفحص الفني الآن: ${total}`);

db.close();
