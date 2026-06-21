/**
 * src/controllers/notificationController.js
 * نظام إدارة مرور سبها
 */

const db = require('../config/database');

exports.unreadCount = (req, res) => {
  try {
    const count = db.prepare(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
    ).get(req.user.id).count;
    res.json({ success: true, data: { count } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
};

exports.list = (req, res) => {
  try {
    const notifs = db.prepare(
      `SELECT id, title, body as message, type, is_read, created_at
       FROM notifications WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 50`
    ).all(req.user.id);
    res.json({ success: true, data: notifs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
};

exports.markRead = (req, res) => {
  try {
    db.prepare(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?'
    ).run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
};

exports.markAllRead = (req, res) => {
  try {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
};
