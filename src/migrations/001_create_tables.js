/**
 * src/migrations/001_create_tables.js
 * نظام إدارة مرور سبها — Schema النهائي
 * مبني على: البحث الأكاديمي + القانون 11/1984 + الكتيب الورقي + المحادثة
 *
 * ملاحظة مهمة: هذا الملف يجب أن يبقى خارج مجلد database/ لأن ذلك المجلد
 * هو مسار Volume الدائم على Railway — أي ملف كود يوضع داخله يصبح غير
 * مرئي وقت التشغيل لأن الـ Volume الفارغ "يُغطّي" محتوى الصورة المبنية.
 */

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = process.env.DB_PATH || './database/traffic.db';
const dbDir   = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.resolve(DB_PATH));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`

  -- ════════════════════════════════════════════════════════════
  -- 1. المستخدمون
  --    أدوار: ADMIN, REG_CHIEF, INSP_CHIEF, VIOLATIONS_DEPT,
  --           PLATE_DEPT, OFFICER, CITIZEN
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    national_id          TEXT    UNIQUE NOT NULL,
    username             TEXT    UNIQUE NOT NULL,
    full_name            TEXT    NOT NULL,
    full_name_en         TEXT,
    role                 TEXT    NOT NULL
      CHECK(role IN (
        'ADMIN','REG_CHIEF','INSP_CHIEF',
        'VIOLATIONS_DEPT','PLATE_DEPT','OFFICER','CITIZEN'
      )),
    password_hash        TEXT    NOT NULL,
    phone                TEXT,
    gender               TEXT    CHECK(gender IN ('ذكر','أنثى')),
    id_card_number       TEXT,
    passport_number      TEXT,
    birth_cert_number    TEXT,
    photo_path           TEXT,
    is_active            INTEGER DEFAULT 1,
    must_change_password INTEGER DEFAULT 0,
    created_at           TEXT    DEFAULT (datetime('now')),
    created_by           INTEGER REFERENCES users(id),
    last_login           TEXT
  );

  -- ════════════════════════════════════════════════════════════
  -- 2. المركبات
  --    الحالات: active, suspended, reported_stolen, transferred
  --    حالة التسجيل: draft, pending_approval, approved, rejected
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS vehicles (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    -- اللوحة: تتولد تلقائياً من النظام بتنسيق: 45892 - 1 - LBY
    plate_number        TEXT    UNIQUE NOT NULL,
    chassis_number      TEXT    UNIQUE NOT NULL,
    engine_number       TEXT,
    vehicle_type        TEXT    NOT NULL
      CHECK(vehicle_type IN (
        'سيارة خاصة','سيارة ركوب عامة','سيارة حافلة',
        'سيارة نقل بضائع','سيارة جرارة','مركبة مقطورة','دراجة نارية'
      )),
    make                TEXT    NOT NULL,
    model               TEXT    NOT NULL,
    year                INTEGER NOT NULL,
    color               TEXT    NOT NULL,
    country_of_origin   TEXT,
    fuel_type           TEXT    DEFAULT 'بنزين',
    cylinders           INTEGER,
    horsepower          REAL,
    passenger_count     INTEGER,
    weight              REAL,
    usage_type          TEXT    DEFAULT 'خاص'
      CHECK(usage_type IN ('خاص','تجاري','حكومي')),
    -- QR: رمز فريد 32 حرف، يُبنى URL منه
    qr_token            TEXT    UNIQUE NOT NULL,
    -- حالة المركبة
    status              TEXT    DEFAULT 'active'
      CHECK(status IN ('active','suspended','reported_stolen','transferred')),
    -- حالة التسجيل (سير الموافقة)
    registration_status TEXT    DEFAULT 'draft'
      CHECK(registration_status IN ('draft','pending_inspection','pending_approval','approved','rejected')),
    rejection_reason    TEXT,
    -- توثيق
    registered_at       TEXT    DEFAULT (datetime('now')),
    registered_by       INTEGER REFERENCES users(id),
    approved_by         INTEGER REFERENCES users(id),
    approved_at         TEXT
  );

  -- ════════════════════════════════════════════════════════════
  -- 3. الملاك (تاريخ الملكية)
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS vehicle_owners (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id        INTEGER NOT NULL REFERENCES vehicles(id),
    owner_national_id TEXT    NOT NULL,
    owner_name        TEXT    NOT NULL,
    owner_id_card     TEXT,
    owner_passport    TEXT,
    driving_license   TEXT,
    address           TEXT,
    phone             TEXT,
    photo_path        TEXT,
    ownership_start   TEXT    DEFAULT (datetime('now')),
    ownership_end     TEXT,
    is_current        INTEGER DEFAULT 1
  );

  -- ════════════════════════════════════════════════════════════
  -- 4. التأمين (FR_13)
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS vehicle_insurance (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id    INTEGER NOT NULL REFERENCES vehicles(id),
    company_name  TEXT    NOT NULL,
    policy_number TEXT    NOT NULL,
    valid_from    TEXT,
    valid_until   TEXT    NOT NULL,
    recorded_by   INTEGER REFERENCES users(id),
    recorded_at   TEXT    DEFAULT (datetime('now'))
  );

  -- ════════════════════════════════════════════════════════════
  -- 5. البل / رخصة التجول (FR_13)
  --    من صفحة التأمين في الكتيب الورقي
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS vehicle_travel_permits (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id    INTEGER NOT NULL REFERENCES vehicles(id),
    permit_number TEXT,
    fee_paid      REAL,
    valid_from    TEXT,
    valid_until   TEXT    NOT NULL,
    recorded_by   INTEGER REFERENCES users(id),
    recorded_at   TEXT    DEFAULT (datetime('now'))
  );

  -- ════════════════════════════════════════════════════════════
  -- 6. الفحص الفني (FR_13)
  --    INSP_CHIEF يُدخل بيانات المركبة + نتيجة الفحص + الضريبة
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS technical_inspections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id      INTEGER NOT NULL REFERENCES vehicles(id),
    inspector_id    INTEGER REFERENCES users(id),
    inspector_name  TEXT,
    result          TEXT    NOT NULL CHECK(result IN ('صالحة','غير صالحة')),
    notes           TEXT,
    fee_paid        REAL,
    valid_from      TEXT    DEFAULT (date('now')),
    valid_until     TEXT,
    inspection_date TEXT    DEFAULT (datetime('now'))
  );

  -- ════════════════════════════════════════════════════════════
  -- 7. حق الامتياز — المادة 17 (FR_15)
  --    يُسجَّل من REG_CHIEF، يظهر عند مسح QR
  --    يمنع نقل الملكية حتى الشطب
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS liens (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id       INTEGER NOT NULL REFERENCES vehicles(id),
    lien_holder_name TEXT    NOT NULL,
    lien_holder_id   TEXT,
    lien_amount      REAL,
    lien_description TEXT,
    is_active        INTEGER DEFAULT 1,
    created_at       TEXT    DEFAULT (datetime('now')),
    created_by       INTEGER REFERENCES users(id),
    released_at      TEXT,
    released_by      INTEGER REFERENCES users(id)
  );

  -- ════════════════════════════════════════════════════════════
  -- 8. أنواع المخالفات — القانون 11/1984
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS violation_types (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    code                TEXT    UNIQUE NOT NULL,
    name_ar             TEXT    NOT NULL,
    fine_amount         REAL    NOT NULL,
    legal_reference     TEXT,
    requires_prosecutor INTEGER DEFAULT 0
  );

  -- ════════════════════════════════════════════════════════════
  -- 9. المخالفات (FR_03, FR_05)
  --    OFFICER يُحرر، VIOLATIONS_DEPT يستلم الدفع
  --    لا يمكن تعديل أو حذف بعد التحرير
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS violations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id        INTEGER NOT NULL REFERENCES vehicles(id),
    violation_type_id INTEGER REFERENCES violation_types(id),
    officer_id        INTEGER NOT NULL REFERENCES users(id),
    fine_amount       REAL    NOT NULL,
    description       TEXT,
    evidence_photo    TEXT,
    location_note     TEXT,
    status            TEXT    DEFAULT 'unpaid'
      CHECK(status IN ('unpaid','paid','referred_to_prosecutor')),
    issued_at         TEXT    DEFAULT (datetime('now')),
    paid_at           TEXT,
    paid_by           INTEGER REFERENCES users(id)
  );

  -- ════════════════════════════════════════════════════════════
  -- 10. نقل الملكية (FR_07, FR_15)
  --     البائع أو REG_CHIEF يبدأ، مهلة 7 أيام
  --     مخالفة تلقائية عند انتهاء المهلة
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS ownership_transfers (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id         INTEGER NOT NULL REFERENCES vehicles(id),
    seller_national_id TEXT    NOT NULL,
    buyer_national_id  TEXT    NOT NULL,
    buyer_name         TEXT    NOT NULL,
    buyer_id_card      TEXT,
    buyer_license      TEXT,
    contract_number    TEXT,
    contract_date      TEXT,
    contract_writer    TEXT,
    new_plate_number   TEXT,
    status             TEXT    DEFAULT 'pending'
      CHECK(status IN (
        'pending','plate_collected','plate_issued','completed','cancelled','overdue'
      )),
    initiated_at       TEXT    DEFAULT (datetime('now')),
    deadline_at        TEXT,
    completed_at       TEXT,
    initiated_by       INTEGER REFERENCES users(id),
    initiated_by_role  TEXT,
    plate_confirmed_by TEXT,
    plate_issued_by    INTEGER REFERENCES users(id)
  );

  -- ════════════════════════════════════════════════════════════
  -- 11. محررو العقود
  --     ADMIN يضيف، REG_CHIEF يتحقق عند النقل
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS contract_writers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    court_number TEXT,
    phone        TEXT,
    is_active    INTEGER DEFAULT 1,
    added_by     INTEGER REFERENCES users(id),
    created_at   TEXT    DEFAULT (datetime('now'))
  );

  -- ════════════════════════════════════════════════════════════
  -- 12. المراسلات الداخلية (Section 8 & 9)
  --     سير الموافقات بين الأقسام
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS internal_messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL REFERENCES users(id),
    to_user_id   INTEGER REFERENCES users(id),
    to_role      TEXT,
    subject      TEXT    NOT NULL,
    body         TEXT    NOT NULL,
    vehicle_id   INTEGER REFERENCES vehicles(id),
    msg_type     TEXT    DEFAULT 'general'
      CHECK(msg_type IN (
        'general','registration_request','inspection_result',
        'approval_request','plate_request','transfer_notice'
      )),
    status       TEXT    DEFAULT 'pending'
      CHECK(status IN ('pending','approved','rejected','read')),
    rejection_reason TEXT,
    is_read      INTEGER DEFAULT 0,
    created_at   TEXT    DEFAULT (datetime('now')),
    actioned_at  TEXT,
    actioned_by  INTEGER REFERENCES users(id)
  );

  -- ════════════════════════════════════════════════════════════
  -- 13. الإشعارات (FR_19)
  --     polling كل 60 ثانية للمواطن
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS notifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    title        TEXT    NOT NULL,
    body         TEXT    NOT NULL,
    type         TEXT    NOT NULL
      CHECK(type IN (
        'violation','transfer','registration',
        'inspection','lien','expiry','report','general'
      )),
    reference_id INTEGER,
    is_read      INTEGER DEFAULT 0,
    created_at   TEXT    DEFAULT (datetime('now'))
  );

  -- ════════════════════════════════════════════════════════════
  -- 14. البلاغات — المادة 20 (FR_21)
  --     فقدان لوحة / سرقة مركبة
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS reports (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id   INTEGER REFERENCES vehicles(id),
    reporter_id  INTEGER NOT NULL REFERENCES users(id),
    type         TEXT    NOT NULL
      CHECK(type IN ('lost_plate','stolen_vehicle')),
    description  TEXT,
    photo_path   TEXT,
    status       TEXT    DEFAULT 'open'
      CHECK(status IN ('open','under_review','resolved','closed')),
    created_at   TEXT    DEFAULT (datetime('now')),
    resolved_at  TEXT,
    resolved_by  INTEGER REFERENCES users(id)
  );

  -- ════════════════════════════════════════════════════════════
  -- 15. سجل التدقيق (FR_10)
  --     كل عملية تُسجَّل: من، ماذا، متى
  -- ════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id),
    user_name  TEXT,
    user_role  TEXT,
    action     TEXT    NOT NULL,
    table_name TEXT,
    record_id  INTEGER,
    details    TEXT,
    ip_address TEXT,
    created_at TEXT    DEFAULT (datetime('now'))
  );

  -- ════════════════════════════════════════════════════════════
  -- الفهارس — لتحسين الأداء
  -- ════════════════════════════════════════════════════════════
  CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_plate    ON vehicles(plate_number);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_chassis  ON vehicles(chassis_number);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_qr       ON vehicles(qr_token);
  CREATE        INDEX IF NOT EXISTS idx_violations_vehicle ON violations(vehicle_id);
  CREATE        INDEX IF NOT EXISTS idx_violations_status  ON violations(status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_national_id  ON users(national_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username     ON users(username);
  CREATE        INDEX IF NOT EXISTS idx_users_phone        ON users(phone);
  CREATE        INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
  CREATE        INDEX IF NOT EXISTS idx_messages_to_role   ON internal_messages(to_role, is_read);
  CREATE        INDEX IF NOT EXISTS idx_transfers_vehicle  ON ownership_transfers(vehicle_id);
  CREATE        INDEX IF NOT EXISTS idx_audit_created      ON audit_log(created_at);

  `);


  // ─── جدول الطلبات المؤقتة بين الأقسام ────────────────────────────
  db.prepare(`CREATE TABLE IF NOT EXISTS pending_vehicle_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER, to_role TEXT,
    owner_national_id TEXT, owner_name TEXT,
    owner_id_card TEXT, owner_passport TEXT,
    driving_license TEXT, address TEXT, owner_phone TEXT,
    vehicle_data TEXT, inspection_data TEXT,
    bel_data TEXT, plate_number TEXT, qr_token TEXT,
    status TEXT DEFAULT 'step1_pending_admin',
    created_at TEXT DEFAULT (datetime('now')), actioned_at TEXT
  )`).run();

  // ─── جدول إعدادات الكاميرا IP ────────────────────────────────────
  db.prepare(`CREATE TABLE IF NOT EXISTS camera_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT NOT NULL, port INTEGER DEFAULT 80,
    username TEXT DEFAULT 'admin', password TEXT,
    stream_path TEXT DEFAULT '/ISAPI/Streaming/channels/101/httpPreview',
    snapshot_path TEXT DEFAULT '/ISAPI/Streaming/channels/101/picture',
    is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER
  )`).run();

  console.log('✅ Migration completed — 17 tables created');
}

module.exports = { migrate, db };
if (require.main === module) migrate();
