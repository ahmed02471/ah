/**
 * config/database.js — اتصال قاعدة البيانات
 * نظام إدارة مرور سبها
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './database/traffic.db';
const dbDir = path.dirname(path.resolve(DB_PATH));

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.resolve(DB_PATH), {
  verbose: process.env.NODE_ENV === 'development' ? null : null
});

// تحسينات الأداء
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// ──────────────────────────────────────────────────────────────
// ترحيل إضافي: أعمدة موافقة رئيس قسم المرور وقسم التسجيل على بلاغات
// المواطنين (سرقة / ضياع لوحة) — إضافة آمنة لا تؤثر على البيانات الحالية
// ──────────────────────────────────────────────────────────────
try {
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='citizen_reports'").get();
  if (hasTable) {
    const cols = db.prepare("PRAGMA table_info(citizen_reports)").all().map(c => c.name);
    const addCol = (name, def) => {
      if (!cols.includes(name)) {
        db.exec(`ALTER TABLE citizen_reports ADD COLUMN ${name} ${def}`);
      }
    };
    addCol('admin_decision',     "TEXT DEFAULT 'pending'");
    addCol('admin_decided_by',   'INTEGER');
    addCol('admin_decided_at',   'TEXT');
    addCol('admin_notes',        'TEXT');
    addCol('regchief_decision',  "TEXT DEFAULT 'pending'");
    addCol('regchief_decided_by','INTEGER');
    addCol('regchief_decided_at','TEXT');
    addCol('regchief_notes',     'TEXT');
    addCol('citizen_cancelled_at',  'TEXT');
    addCol('citizen_cancel_reason', 'TEXT');
  }
} catch (e) {
  console.error('[DB Migration] citizen_reports approval columns:', e.message);
}

// ──────────────────────────────────────────────────────────────
// ترحيل إضافي: تمييز سبب إغلاق بلاغ ضياع/سرقة (تم إيجادها بلا رسوم،
// أو استخراج لوحة بديلة برسم يحصّله ويصدرها قسم اللوحات) — إضافة
// آمنة لا تؤثر على البيانات الحالية
// ──────────────────────────────────────────────────────────────
try {
  const hasTable2 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='citizen_reports'").get();
  if (hasTable2) {
    const cols2 = db.prepare("PRAGMA table_info(citizen_reports)").all().map(c => c.name);
    const addCol2 = (name, def) => {
      if (!cols2.includes(name)) {
        db.exec(`ALTER TABLE citizen_reports ADD COLUMN ${name} ${def}`);
      }
    };
    // قيم resolution_type: 'found' (وُجدت بلا رسوم) | 'reissue_requested' (طلب لوحة بديلة قيد المعالجة)
    // | 'reissued' (تم تحصيل الرسم وإصدار اللوحة البديلة) | NULL (لم يُحسم بعد)
    addCol2('resolution_type',       'TEXT');
    addCol2('reissue_fee_amount',    'REAL');
    addCol2('reissue_paid_at',       'TEXT');
    addCol2('reissue_paid_by',       'INTEGER');
    addCol2('reissue_completed_at',  'TEXT');
  }
} catch (e) {
  console.error('[DB Migration] citizen_reports resolution/reissue columns:', e.message);
}

module.exports = db;