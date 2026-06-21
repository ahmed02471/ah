/**
 * src/controllers/inspectionController.js
 * الفحص الفني — INSP_CHIEF فقط يسجّل الفحوصات
 */

const db = require('../config/database');

exports.list = (req, res) => {
  try {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const plate  = req.query.plate;
    const result = req.query.result;

    const where = []; const params = [];
    if (plate)  { where.push(`veh.plate_number LIKE ?`); params.push(`%${plate}%`); }
    if (result) { where.push(`ti.result = ?`); params.push(result); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = db.prepare(
      `SELECT COUNT(*) as cnt FROM technical_inspections ti
       LEFT JOIN vehicles veh ON veh.id = ti.vehicle_id ${w}`
    ).get(...params).cnt;

    const inspections = db.prepare(
      `SELECT ti.*, veh.plate_number, veh.make, veh.model,
              u.full_name as inspector_user_name
       FROM technical_inspections ti
       LEFT JOIN vehicles veh ON veh.id = ti.vehicle_id
       LEFT JOIN users u      ON u.id = ti.inspector_id
       ${w}
       ORDER BY ti.inspection_date DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({ success: true, data: { inspections, total } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
};

exports.byVehicle = (req, res) => {
  try {
    const inspections = db.prepare(
      `SELECT ti.*, u.full_name as inspector_user_name
       FROM technical_inspections ti
       LEFT JOIN users u ON u.id = ti.inspector_id
       WHERE ti.vehicle_id = ?
       ORDER BY ti.inspection_date DESC`
    ).all(req.params.vehicleId);
    res.json({ success: true, data: { inspections } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
};

exports.create = (req, res) => {
  const { vehicle_id, result, inspector_name, notes, valid_until } = req.body;
  if (!vehicle_id || !result)
    return res.status(400).json({ success: false, message: 'بيانات الفحص ناقصة' });

  const VALID_RESULTS = ['صالحة', 'غير صالحة'];
  if (!VALID_RESULTS.includes(result))
    return res.status(400).json({ success: false, message: 'نتيجة الفحص غير صحيحة' });

  try {
    const veh = db.prepare('SELECT id FROM vehicles WHERE id = ?').get(vehicle_id);
    if (!veh) return res.status(404).json({ success: false, message: 'المركبة غير موجودة' });

    // تاريخ الانتهاء: إذا لم يُحدَّد، سنة من الآن للمركبة الصالحة
    let expiry = valid_until || null;
    if (!expiry && result === 'صالحة') {
      expiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

    const info = db.prepare(
      `INSERT INTO technical_inspections
         (vehicle_id, inspector_id, inspector_name, result, notes, valid_until, valid_from)
       VALUES (?, ?, ?, ?, ?, ?, date('now'))`
    ).run(vehicle_id, req.user.id, inspector_name || req.user.full_name || null,
          result, notes || null, expiry);

    // إشعار المواطن
    const owner = db.prepare(
      `SELECT u.id FROM vehicle_owners vo
       JOIN users u ON u.national_id = vo.owner_national_id
       WHERE vo.vehicle_id = ? AND vo.is_current = 1`
    ).get(vehicle_id);

    if (owner) {
      const msg = result === 'صالحة'
        ? `تم تسجيل الفحص الفني لمركبتك بنجاح. الفحص صالح حتى ${expiry}.`
        : `نتيجة الفحص الفني لمركبتك: غير صالحة. يُرجى إجراء الإصلاحات اللازمة.`;
      db.prepare(
        `INSERT INTO notifications (user_id, title, body, type, reference_id) VALUES (?, ?, ?, 'inspection', ?)`
      ).run(owner.id, `نتيجة الفحص الفني: ${result}`, msg, info.lastInsertRowid);
    }

    res.status(201).json({ success: true, data: { id: info.lastInsertRowid, valid_until: expiry } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
};
