/**
 * seed-vehicles.js — إدراج 10,000 مركبة بجميع بياناتها
 * شغّل: node scripts/seed-vehicles.js
 */
const Database = require('better-sqlite3');
const path     = require('path');
const crypto   = require('crypto');

const db = new Database(path.join(__dirname, '../database/traffic.db'));
db.pragma('journal_mode = WAL');

const makes  = ['Toyota','Hyundai','Kia','Nissan','Mitsubishi','Honda','Ford','BMW','Mercedes','Chevrolet'];
const models = {
  Toyota:     ['Camry','Corolla','Land Cruiser','Prado','Hilux','Yaris','RAV4'],
  Hyundai:    ['Sonata','Elantra','Tucson','Santa Fe','Accent','i10'],
  Kia:        ['Sportage','Sorento','Cerato','Picanto','Optima'],
  Nissan:     ['Patrol','Altima','Sunny','X-Trail','Navara','Tiida'],
  Mitsubishi: ['Pajero','L200','Lancer','Galant','Eclipse'],
  Honda:      ['Civic','Accord','CR-V','Pilot','Jazz'],
  Ford:       ['Explorer','F-150','Fusion','Edge','Mustang'],
  BMW:        ['X5','X3','520','730','320'],
  Mercedes:   ['C200','E200','GLE','S500','Vito'],
  Chevrolet:  ['Tahoe','Silverado','Malibu','Aveo','Captiva'],
};
const colors       = ['أبيض','أسود','فضي','رمادي','أحمر','أزرق','بيج','بني','أخضر','ذهبي'];
const fuel_types   = ['بنزين','ديزل','غاز'];
const vtypes       = ['سيارة خاصة','سيارة ركوب عامة','سيارة نقل بضائع','سيارة حافلة','دراجة نارية'];
const origins      = {Toyota:'اليابان',Nissan:'اليابان',Honda:'اليابان',Mitsubishi:'اليابان',
                      Hyundai:'كوريا',Kia:'كوريا',BMW:'ألمانيا',Mercedes:'ألمانيا',
                      Ford:'أمريكا',Chevrolet:'أمريكا'};
const names_first  = ['أحمد','محمد','علي','عمر','خالد','سالم','مصطفى','إبراهيم','يوسف','عبدالله',
                      'فاطمة','عائشة','مريم','سارة','نور','هند','رقية','زينب'];
const names_last   = ['الشريف','القذافي','الفيتوري','المبروك','العربي','البوسيفي',
                      'الهاشمي','العجيلي','الدرسي','الورفلي','المغربي','السنوسي'];
const ins_companies = ['الوطنية','السهل','المتحدة','الأمان','ليبيا للتأمين'];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const genNID = () => rand(['1','2']) + Array.from({length:11}, () => randInt(0,9)).join('');
const genPlate = (seq) => {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return `${L[randInt(0,L.length-1)]}${L[randInt(0,L.length-1)]}-${String(seq).padStart(4,'0')}-LBY`;
};
const genChassis = (seq) => `VIN${String(seq).padStart(5,'0')}${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
const genQR = () => crypto.randomBytes(20).toString('hex');
const dateAgo = (maxDays) => {
  const d = new Date(); d.setDate(d.getDate() - randInt(30, maxDays)); return d.toISOString().split('T')[0];
};
const dateFuture = (minDays, maxDays) => {
  const d = new Date(); d.setDate(d.getDate() + randInt(minDays, maxDays)); return d.toISOString().split('T')[0];
};

// تحضير الـ statements
const insVehicle = db.prepare(`
  INSERT INTO vehicles(vehicle_type,chassis_number,engine_number,make,model,year,color,
    country_of_origin,fuel_type,plate_number,qr_token,status)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,'active')
`);

const insOwner = db.prepare(`
  INSERT INTO vehicle_owners(vehicle_id,owner_name,owner_national_id,owner_id_card,
    driving_license,phone,address,is_current,created_at)
  VALUES(?,?,?,?,?,?,?,1,datetime('now'))
`);

const insIns = db.prepare(`
  INSERT INTO vehicle_insurance(vehicle_id,company_name,policy_number,valid_from,valid_until,recorded_by)
  VALUES(?,?,?,?,?,1)
`);

const insBel = db.prepare(`
  INSERT INTO vehicle_travel_permits(vehicle_id,permit_number,valid_from,valid_until,recorded_by)
  VALUES(?,?,?,?,1)
`);

// تحقق من عمود valid_until في technical_inspections
const inspCols = db.prepare("PRAGMA table_info(technical_inspections)").all().map(r=>r.name);
const insInsp = inspCols.includes('valid_until')
  ? db.prepare(`INSERT INTO technical_inspections(vehicle_id,inspection_date,result,notes,valid_until,recorded_by) VALUES(?,date('now'),?,?,?,1)`)
  : db.prepare(`INSERT INTO technical_inspections(vehicle_id,inspection_date,result,notes,recorded_by) VALUES(?,date('now'),?,?,1)`);

// إدراج بـ transactions للسرعة
const TOTAL = 10000;
const BATCH = 500;

console.log(`⏳ جارٍ إدراج ${TOTAL} مركبة...`);
const startTime = Date.now();

const insertBatch = db.transaction((startSeq, count) => {
  for (let i = 0; i < count; i++) {
    const seq   = startSeq + i;
    const make  = rand(makes);
    const model = rand(models[make]);
    const year  = randInt(2005, 2024);

    const vehResult = insVehicle.run(
      rand(vtypes),
      genChassis(seq),
      `ENG${String(seq).padStart(6,'0')}`,
      make, model, year,
      rand(colors),
      origins[make] || 'غير محدد',
      rand(fuel_types),
      genPlate(seq),
      genQR()
    );

    const vid = vehResult.lastInsertRowid;
    const fname = rand(names_first);
    const lname = rand(names_last);

    insOwner.run(vid,
      `${fname} ${lname}`,
      genNID(),
      `BK${randInt(100000,999999)}`,
      `LIC${randInt(100000,999999)}`,
      `09${randInt(10000000,99999999)}`,
      'سبها'
    );

    insIns.run(vid,
      rand(ins_companies),
      `POL${randInt(100000,999999)}`,
      dateAgo(365), dateFuture(30, 365)
    );

    insBel.run(vid,
      `BEL${randInt(10000,99999)}`,
      dateAgo(365), dateFuture(30, 365)
    );

    if (inspCols.includes('valid_until')) {
      insInsp.run(vid, 'صالحة', 'مركبة سليمة', dateFuture(30, 365));
    } else {
      insInsp.run(vid, 'صالحة', 'مركبة سليمة');
    }
  }
});

for (let start = 1; start <= TOTAL; start += BATCH) {
  const count = Math.min(BATCH, TOTAL - start + 1);
  insertBatch(start, count);
  process.stdout.write(`\r  ✅ ${Math.min(start + count - 1, TOTAL)}/${TOTAL} مركبة`);
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
const total_v = db.prepare("SELECT COUNT(*) as c FROM vehicles").get().c;
const total_o = db.prepare("SELECT COUNT(*) as c FROM vehicle_owners").get().c;

console.log(`\n\n✅ اكتمل في ${elapsed} ثانية!`);
console.log(`   🚗 المركبات:  ${total_v}`);
console.log(`   👤 الملاك:    ${total_o}`);
console.log(`   🛡️ التأمين:   ${db.prepare("SELECT COUNT(*) as c FROM vehicle_insurance").get().c}`);

db.close();
