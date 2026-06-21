/**
 * violationController.js — نظام مرور سبها
 * FR_03: OFFICER يُحرر، VIOLATIONS_DEPT يستلم الدفع
 * FR_05: لا تعديل ولا حذف بعد التحرير (سلسلة الأدلة)
 * FR_07: منع النقل إذا توجد مخالفات غير مدفوعة
 */
const db = require('../config/database');

// ── قائمة المخالفات ───────────────────────────────────────────────
exports.list = (req, res) => {
  try {
    const { q, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const where  = []; const params = [];

    if (q) {
      where.push(`(v.plate_number LIKE ? OR vo.owner_name LIKE ? OR vio.id = ?)`);
      params.push(`%${q}%`, `%${q}%`, parseInt(q) || 0);
    }
    if (status) { where.push(`vio.status = ?`); params.push(status); }

    // OFFICER يرى مخالفاته فقط
    if (req.user.role === 'OFFICER') {
      where.push(`vio.officer_id = ?`);
      params.push(req.user.id);
    }

    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const base = `
      FROM violations vio
      LEFT JOIN vehicles v        ON v.id  = vio.vehicle_id
      LEFT JOIN vehicle_owners vo ON vo.vehicle_id = vio.vehicle_id AND vo.is_current = 1
      LEFT JOIN violation_types vt ON vt.id = vio.violation_type_id
      LEFT JOIN users u            ON u.id  = vio.officer_id
    `;

    const total = db.prepare(`SELECT COUNT(*) as cnt ${base} ${w}`).get(...params).cnt;
    const violations = db.prepare(`
      SELECT vio.id, vio.fine_amount, vio.status, vio.issued_at, vio.paid_at,
             vio.location_note, vio.evidence_photo,
             v.plate_number, v.make, v.model,
             vt.name_ar as type_name, vt.code as type_code,
             vo.owner_name,
             u.full_name as officer_name
      ${base} ${w}
      ORDER BY vio.issued_at DESC LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), parseInt(offset));

    res.json({ success: true, data: { violations, total } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── تفاصيل مخالفة ────────────────────────────────────────────────
exports.getById = (req, res) => {
  try {
    const vio = db.prepare(`
      SELECT vio.*, v.plate_number, v.make, v.model, v.year, v.color,
             vt.name_ar as type_name, vt.fine_amount as type_fine, vt.legal_reference,
             vo.owner_name, vo.owner_national_id, vo.phone as owner_phone,
             off.full_name as officer_name, off.phone as officer_phone,
             pay.full_name as paid_by_name
      FROM violations vio
      LEFT JOIN vehicles v         ON v.id  = vio.vehicle_id
      LEFT JOIN vehicle_owners vo  ON vo.vehicle_id = vio.vehicle_id AND vo.is_current = 1
      LEFT JOIN violation_types vt ON vt.id = vio.violation_type_id
      LEFT JOIN users off          ON off.id = vio.officer_id
      LEFT JOIN users pay          ON pay.id = vio.paid_by
      WHERE vio.id = ?
    `).get(req.params.id);

    if (!vio) return res.status(404).json({ success: false, message: 'المخالفة غير موجودة' });
    res.json({ success: true, data: vio });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── تحرير مخالفة — OFFICER فقط ───────────────────────────────────
exports.create = async (req, res) => {
  const { vehicle_id, violation_type_id, location_note, description } = req.body;

  if (!vehicle_id || !violation_type_id)
    return res.status(400).json({ success: false, message: 'رقم المركبة ونوع المخالفة مطلوبان' });

  try {
    // تحقق من المركبة
    const vehicle = db.prepare('SELECT id, status, plate_number FROM vehicles WHERE id = ?').get(vehicle_id);
    if (!vehicle)
      return res.status(404).json({ success: false, message: 'المركبة غير موجودة' });

    // لا مخالفات على المركبة المعلّقة (FR_07)
    if (vehicle.status === 'suspended')
      return res.status(400).json({ success: false, message: 'لا يمكن تحرير مخالفة على مركبة مُعلَّقة' });
    if (vehicle.status === 'transferred')
      return res.status(400).json({ success: false, message: 'هذه المركبة منقولة الملكية' });

    // نوع المخالفة والغرامة
    const vt = db.prepare('SELECT * FROM violation_types WHERE id = ?').get(violation_type_id);
    if (!vt)
      return res.status(404).json({ success: false, message: 'نوع المخالفة غير موجود' });

    // صورة الدليل إن وُجدت
    const evidence_photo = req.file ? `/uploads/${req.file.filename}` : (req.body.evidence_photo || null);

    const info = db.prepare(`
      INSERT INTO violations
        (vehicle_id, violation_type_id, officer_id, fine_amount,
         description, evidence_photo, location_note, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'unpaid')
    `).run(
      vehicle_id, violation_type_id, req.user.id,
      vt.fine_amount, description || null,
      evidence_photo, location_note || null
    );

    // إشعار المواطن فوراً
    const owner = db.prepare(`
      SELECT u.id FROM vehicle_owners vo
      JOIN users u ON u.national_id = vo.owner_national_id
      WHERE vo.vehicle_id = ? AND vo.is_current = 1
    `).get(vehicle_id);

    if (owner) {
      db.prepare(`INSERT INTO notifications (user_id,title,body,type,reference_id) VALUES(?,?,?,?,?)`)
        .run(owner.id,
          `⚠️ تم تحرير مخالفة — ${vehicle.plate_number}`,
          `نوع المخالفة: ${vt.name_ar}\nقيمة الغرامة: ${vt.fine_amount} د.ل\nموقع: ${location_note || 'غير محدد'}\n\nتوجه لقسم المخالفات لتسديد الغرامة.`,
          'violation', info.lastInsertRowid
        );

      // إرسال إيميل للمواطن من citizen_registrations
      try {
        const citizenUser = db.prepare('SELECT u.*, cr.email as citizen_email FROM users u LEFT JOIN citizen_registrations cr ON cr.user_id=u.id WHERE u.id=? ORDER BY cr.id DESC LIMIT 1').get(owner.id);
        const emailTo = citizenUser?.citizen_email;
        if (emailTo) {
          const { sendEmail } = require('../services/emailService');
          sendEmail(emailTo, 'violationIssued',
            citizenUser.full_name,
            vt.fine_amount,
            vt.name_ar
          );
          console.log(`[Email] مخالفة أُرسلت لـ ${emailTo}`);
        }
      } catch(emailErr) {
        console.error('[Email Violation]', emailErr.message);
      }
    }

    // تسجيل في سجل التدقيق
    _audit(req, 'CREATE_VIOLATION', 'violations', info.lastInsertRowid,
      `مخالفة ${vt.name_ar} — ${vehicle.plate_number} — ${vt.fine_amount} د.ل`);

    res.status(201).json({
      success: true,
      data: {
        id:          info.lastInsertRowid,
        fine_amount: vt.fine_amount,
        type_name:   vt.name_ar,
        plate:       vehicle.plate_number
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── تسديد مخالفة — VIOLATIONS_DEPT فقط (FR_05) ──────────────────
exports.pay = (req, res) => {
  try {
    const vio = db.prepare('SELECT * FROM violations WHERE id = ?').get(req.params.id);
    if (!vio)
      return res.status(404).json({ success: false, message: 'المخالفة غير موجودة' });
    if (vio.status === 'paid')
      return res.status(400).json({ success: false, message: 'هذه المخالفة مدفوعة مسبقاً' });
    if (vio.status === 'referred_to_prosecutor')
      return res.status(400).json({ success: false, message: 'هذه المخالفة أُحيلت للنيابة' });

    db.prepare(`
      UPDATE violations SET status='paid', paid_at=datetime('now'), paid_by=? WHERE id=?
    `).run(req.user.id, vio.id);

    // إشعار المواطن بتأكيد الدفع
    const owner = db.prepare(`
      SELECT u.id FROM vehicle_owners vo
      JOIN users u ON u.national_id = vo.owner_national_id
      WHERE vo.vehicle_id = ? AND vo.is_current = 1
    `).get(vio.vehicle_id);

    if (owner) {
      db.prepare(`INSERT INTO notifications (user_id,title,body,type,reference_id) VALUES(?,?,?,?,?)`)
        .run(owner.id,
          '✅ تم تسديد المخالفة',
          `تم تسجيل سداد المخالفة بمبلغ ${vio.fine_amount} د.ل بنجاح. شكراً.`,
          'violation', vio.id
        );
    }

    _audit(req, 'PAY_VIOLATION', 'violations', vio.id,
      `تسديد مخالفة ${vio.id} — ${vio.fine_amount} د.ل`);

    res.json({ success: true, message: 'تم تسجيل السداد بنجاح' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── إحالة للنيابة — المخالفات الجسيمة ───────────────────────────
exports.referToProsecutor = (req, res) => {
  try {
    const vio = db.prepare('SELECT * FROM violations WHERE id = ?').get(req.params.id);
    if (!vio)       return res.status(404).json({ success: false, message: 'المخالفة غير موجودة' });
    if (vio.status !== 'unpaid')
      return res.status(400).json({ success: false, message: 'لا يمكن إحالة مخالفة مدفوعة' });

    db.prepare(`UPDATE violations SET status='referred_to_prosecutor' WHERE id=?`).run(vio.id);
    _audit(req, 'REFER_TO_PROSECUTOR', 'violations', vio.id, `إحالة مخالفة للنيابة`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── مخالفات مركبة معيّنة ──────────────────────────────────────────
exports.byVehicle = (req, res) => {
  try {
    const violations = db.prepare(`
      SELECT vio.*, vt.name_ar as type_name, u.full_name as officer_name
      FROM violations vio
      LEFT JOIN violation_types vt ON vt.id = vio.violation_type_id
      LEFT JOIN users u ON u.id = vio.officer_id
      WHERE vio.vehicle_id = ?
      ORDER BY vio.issued_at DESC
    `).all(req.params.vehicleId);
    res.json({ success: true, data: violations });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

function _audit(req, action, table, id, details) {
  try {
    db.prepare('INSERT INTO audit_log (user_id,user_name,user_role,action,table_name,record_id,details,ip_address) VALUES(?,?,?,?,?,?,?,?)')
      .run(req.user.id, req.user.name, req.user.role, action, table, id, details, req.ip || '');
  } catch (_) {}
}
