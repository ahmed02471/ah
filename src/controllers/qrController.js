const QRCode = require('qrcode');
const db     = require('../config/database');

// QR كـ SVG (للعرض inline في الصفحة)
exports.generateSVG = async (req, res) => {
  try {
    const { token } = req.params;
    // نشفّر التوكن فقط (لا URL) → QR أبسط وأسهل مسحاً
    const svg = await QRCode.toString(token, {
      type:       'svg',
      width:      200,
      margin:     2,
      color:      { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M'
    });

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  } catch(e) {
    res.status(500).send(`<svg viewBox="0 0 100 100"><text y="50" x="10" font-size="12">QR Error</text></svg>`);
  }
};

// QR كـ PNG base64 (للطباعة)
exports.generatePNG = async (req, res) => {
  try {
    const { token } = req.params;
    const buffer = await QRCode.toBuffer(token, {
      type:   'png',
      width:  300,
      margin: 2,
      errorCorrectionLevel: 'M'
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
};

// صفحة ملصق QR كاملة للطباعة
exports.printSticker = async (req, res) => {
  try {
    const { token } = req.params;
    const v = db.prepare(`
      SELECT v.*, vo.owner_name, vo.owner_national_id
      FROM vehicles v
      LEFT JOIN vehicle_owners vo ON vo.vehicle_id=v.id AND vo.is_current=1
      WHERE v.qr_token=?`).get(token);

    const qrDataUrl = await QRCode.toDataURL(token, {
      width:  300,
      margin: 2,
      errorCorrectionLevel: 'M',
      color:  { dark: '#000000', light: '#ffffff' }
    });

    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>ملصق QR — ${v?.plate_number||token}</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Arial',sans-serif; background:#f5f5f5; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; gap:16px; }
    .sticker { background:#fff; border:3px solid #000; border-radius:12px; padding:20px 24px; text-align:center; width:260px; box-shadow:0 4px 20px rgba(0,0,0,.15); }
    .header  { font-size:11px; font-weight:bold; color:#333; margin-bottom:10px; padding-bottom:8px; border-bottom:2px solid #000; }
    .plate   { font-size:18px; font-weight:900; font-family:monospace; letter-spacing:3px; border:3px solid #000; padding:8px 16px; border-radius:6px; margin:10px auto; display:inline-block; background:#f9f9f9; }
    .qr-img  { width:180px; height:180px; margin:10px auto; display:block; }
    .owner   { font-size:13px; font-weight:bold; margin-top:8px; }
    .nid     { font-size:11px; color:#555; margin-top:3px; }
    .footer  { font-size:9px; color:#777; margin-top:10px; padding-top:8px; border-top:1px solid #ddd; line-height:1.5; }
    .print-btn { padding:12px 28px; background:#1d4ed8; color:#fff; border:none; border-radius:8px; cursor:pointer; font-size:15px; font-family:Arial; }
    .print-btn:hover { background:#1e40af; }
    @media print { body{background:#fff;} .no-print{display:none!important;} }
  </style>
</head>
<body>
  <div class="sticker">
    <div class="header">
      🚗 مديرية مرور سبها<br>
      <span style="font-size:9px;font-weight:normal;">إدارة التسجيل والترخيص</span>
    </div>
    <div class="plate">${v?.plate_number || '—'}</div>
    <img class="qr-img" src="${qrDataUrl}" alt="QR Code">
    <div class="owner">${v?.owner_name || '—'}</div>
    <div class="nid">رقم وطني: ${v?.owner_national_id || '—'}</div>
    <div class="footer">
      امسح الرمز للتحقق من المركبة<br>
      نظام إدارة مرور سبها<br>
      <span style="font-family:monospace;font-size:8px;">${token.substring(0,20)}...</span>
    </div>
  </div>

  <button class="print-btn no-print" onclick="window.print()">🖨️ طباعة الملصق</button>
</body>
</html>`);
  } catch(e) {
    res.status(500).send('خطأ في توليد QR: ' + e.message);
  }
};
