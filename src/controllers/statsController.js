/**
 * statsController.js — إحصاءات لوحة التحكم
 */
const db = require('../config/database');

exports.dashboard = (req, res) => {
  try {
    const role = req.user.role;
    const stats = {};

    if (['ADMIN','REG_CHIEF'].includes(role)) {
      stats.vehicles_total    = db.prepare(`SELECT COUNT(*) as c FROM vehicles`).get().c;
      stats.vehicles_active   = db.prepare(`SELECT COUNT(*) as c FROM vehicles WHERE status='active'`).get().c;
      stats.vehicles_pending  = db.prepare(`SELECT COUNT(*) as c FROM vehicles WHERE registration_status='pending_approval'`).get().c;
      stats.citizens_total    = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='CITIZEN'`).get().c;
    }

    if (['ADMIN','VIOLATIONS_DEPT','REG_CHIEF'].includes(role)) {
      stats.violations_total  = db.prepare(`SELECT COUNT(*) as c FROM violations`).get().c;
      stats.violations_unpaid = db.prepare(`SELECT COUNT(*) as c FROM violations WHERE status='unpaid'`).get().c;
      stats.violations_paid   = db.prepare(`SELECT COUNT(*) as c FROM violations WHERE status='paid'`).get().c;
      stats.fines_collected   = db.prepare(`SELECT COALESCE(SUM(fine_amount),0) as s FROM violations WHERE status='paid'`).get().s;
    }

    if (['ADMIN','REG_CHIEF','PLATE_DEPT'].includes(role)) {
      stats.transfers_pending  = db.prepare(`SELECT COUNT(*) as c FROM ownership_transfers WHERE status NOT IN ('completed','cancelled','overdue')`).get().c;
      stats.transfers_overdue  = db.prepare(`SELECT COUNT(*) as c FROM ownership_transfers WHERE status='overdue'`).get().c;
    }

    if (role === 'INSP_CHIEF') {
      stats.inspections_today = db.prepare(`SELECT COUNT(*) as c FROM technical_inspections WHERE date(inspection_date)=date('now')`).get().c;
      stats.inspections_total = db.prepare(`SELECT COUNT(*) as c FROM technical_inspections`).get().c;
      stats.pass_rate = db.prepare(`SELECT COUNT(*) as c FROM technical_inspections WHERE result='صالحة'`).get().c;
    }

    if (role === 'OFFICER') {
      stats.my_violations        = db.prepare(`SELECT COUNT(*) as c FROM violations WHERE officer_id=?`).get(req.user.id).c;
      stats.my_violations_today  = db.prepare(`SELECT COUNT(*) as c FROM violations WHERE officer_id=? AND date(issued_at)=date('now')`).get(req.user.id).c;
    }

    // المراسلات غير المقروءة — للجميع
    try {
      stats.unread_messages = db.prepare(`
        SELECT COUNT(*) as c FROM internal_messages
        WHERE (to_user_id=? OR to_role=?) AND is_read=0
      `).get(req.user.id, role).c;
    } catch(_) { stats.unread_messages = 0; }

    // آخر النشاطات
    stats.recent_activity = db.prepare(`
      SELECT action, user_name, user_role, details, created_at
      FROM audit_log ORDER BY created_at DESC LIMIT 8
    `).all();

    res.json({ success: true, data: stats });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
};
