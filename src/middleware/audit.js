/**
 * middleware/audit.js — تسجيل سجل التدقيق
 * نظام إدارة مرور سبها
 */

const db = require('../config/database');

/**
 * تسجيل عملية في سجل التدقيق
 */
function logAction({ userId, userName, action, tableName, recordId, oldValues, newValues, req }) {
  try {
    db.prepare(`
      INSERT INTO audit_log (user_id, user_name, action, table_name, record_id, old_values, new_values, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId || null,
      userName || null,
      action,
      tableName || null,
      recordId || null,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      req ? (req.ip || req.connection?.remoteAddress) : null,
      req ? req.headers['user-agent'] : null
    );
  } catch (err) {
    console.error('خطأ في سجل التدقيق:', err.message);
  }
}

module.exports = { logAction };
