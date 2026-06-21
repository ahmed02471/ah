/**
 * cameraController.js
 * يدعم Digest Auth لكاميرات Hikvision الحديثة
 */
const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const db     = require('../config/database');

// ── Digest Auth Helper ─────────────────────────────────────────
function parseWWWAuth(header) {
  const result = {};
  const regex  = /(\w+)="([^"]+)"/g;
  let m;
  while ((m = regex.exec(header)) !== null) result[m[1]] = m[2];
  // qop قد لا يكون بين quotes
  const qopM = header.match(/qop=([^,\s"]+)/);
  if (qopM && !result.qop) result.qop = qopM[1];
  return result;
}

function buildDigestAuth(method, uri, username, password, authParams, ncNum = 1) {
  const { realm, nonce, qop } = authParams;
  const nc = String(ncNum).padStart(8, '0');
  const cnonce = crypto.randomBytes(8).toString('hex');

  const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
  const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');

  let response;
  if (qop === 'auth' || qop === 'auth-int') {
    response = crypto.createHash('md5').update(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`).digest('hex');
    return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=auth, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
  } else {
    response = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
    return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
  }
}

// ── طلب HTTP مع دعم Digest Auth تلقائياً ──────────────────────────
// (تمت إزالة تخزين nonce المؤقت الذي أُضيف لتسريع الطلبات — رغم أنه كان
//  يعمل نظرياً، تبيّن أنه قد يكون مرتبطاً بفشل قراءة QR لدى هذه الكاميرا
//  تحديداً. رجوع كامل للطريقة الأصلية المضمونة: تحدٍ Digest جديد مع كل طلب.)
function fetchWithDigest(options, username, password, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const lib = options.port === 443 ? https : http;

    // المحاولة الأولى — بدون auth، لاستخراج nonce جديد
    const req1 = lib.request({ ...options, headers: {} }, res1 => {
      if (res1.statusCode !== 401) {
        resolve(res1);
        return;
      }

      const wwwAuth = res1.headers['www-authenticate'] || '';
      res1.resume();

      if (wwwAuth.toLowerCase().startsWith('digest')) {
        const authParams = parseWWWAuth(wwwAuth);
        const digestHeader = buildDigestAuth('GET', options.path, username, password, authParams, 1);

        const req2 = lib.request({ ...options, headers: { 'Authorization': digestHeader } }, res2 => {
          resolve(res2);
        });
        req2.on('error', reject);
        req2.setTimeout(timeout, () => { req2.destroy(); reject(new Error('TIMEOUT')); });
        req2.end();

      } else if (wwwAuth.toLowerCase().startsWith('basic')) {
        const basicHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
        const req2 = lib.request({ ...options, headers: { 'Authorization': basicHeader } }, res2 => {
          resolve(res2);
        });
        req2.on('error', reject);
        req2.setTimeout(timeout, () => { req2.destroy(); reject(new Error('TIMEOUT')); });
        req2.end();
      } else {
        reject(new Error('AUTH_UNKNOWN: ' + wwwAuth));
      }
    });

    req1.on('error', reject);
    req1.setTimeout(timeout, () => { req1.destroy(); reject(new Error('TIMEOUT')); });
    req1.end();
  });
}

// ═══════════════════════════════════════════════════════════════
exports.saveSettings = (req, res) => {
  const { ip_address, port, username, password, snapshot_path, stream_path } = req.body;
  if (!ip_address) return res.status(400).json({ success:false, message:'عنوان IP مطلوب' });
  try {
    const ex = db.prepare('SELECT id FROM camera_settings LIMIT 1').get();
    if (ex) {
      db.prepare('UPDATE camera_settings SET ip_address=?,port=?,username=?,password=?,snapshot_path=?,stream_path=?,updated_by=? WHERE id=?')
        .run(ip_address, parseInt(port)||80, username||'admin', password||null,
             snapshot_path||'/ISAPI/Streaming/channels/101/picture',
             stream_path  ||'/ISAPI/Streaming/channels/101/httpPreview',
             req.user.id, ex.id);
    } else {
      db.prepare('INSERT INTO camera_settings(ip_address,port,username,password,snapshot_path,stream_path,updated_by)VALUES(?,?,?,?,?,?,?)')
        .run(ip_address, parseInt(port)||80, username||'admin', password||null,
             snapshot_path||'/ISAPI/Streaming/channels/101/picture',
             stream_path  ||'/ISAPI/Streaming/channels/101/httpPreview',
             req.user.id);
    }
    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.getSettings = (req, res) => {
  try {
    const s = db.prepare('SELECT id,ip_address,port,username,snapshot_path,stream_path FROM camera_settings LIMIT 1').get();
    res.json({ success:true, data: s||null });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ── Snapshot Proxy ──────────────────────────────────────────────
exports.snapshot = async (req, res) => {
  try {
    const s = db.prepare('SELECT * FROM camera_settings LIMIT 1').get();
    if (!s) return res.status(404).send('لم يتم حفظ إعدادات الكاميرا');

    const options = {
      hostname: s.ip_address,
      port:     parseInt(s.port) || 80,
      path:     s.snapshot_path || '/ISAPI/Streaming/channels/101/picture',
      method:   'GET',
    };

    const camRes = await fetchWithDigest(options, s.username||'admin', s.password||'').catch(e => { throw e; });

    const ct = camRes.headers['content-type'] || '';
    if (camRes.statusCode === 200 && ct.includes('image')) {
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'no-cache, no-store');
      camRes.pipe(res);
    } else if (camRes.statusCode === 401) {
      res.status(401).send('كلمة المرور خاطئة — تحقق من البيانات');
    } else if (camRes.statusCode === 404) {
      res.status(404).send(`المسار غير موجود: ${options.path}`);
    } else {
      let body = '';
      camRes.on('data', d => body += d);
      camRes.on('end',  () => res.status(camRes.statusCode).send(`${camRes.statusCode} | ${ct} | ${body.substring(0,200)}`));
    }
  } catch(e) {
    const msg = e.message === 'TIMEOUT'      ? `انتهت مهلة الاتصال بـ الكاميرا` :
                e.code === 'ECONNREFUSED'    ? `الكاميرا غير متصلة على هذا العنوان/المنفذ` :
                e.code === 'EHOSTUNREACH'    ? `لا يمكن الوصول للكاميرا — تحقق من الشبكة` :
                e.message;
    if (!res.headersSent) res.status(502).send(msg);
  }
};

// ── Live Stream Proxy (MJPEG حقيقي — اتصال واحد، بدون Digest Auth مكرر) ──
exports.stream = async (req, res) => {
  try {
    const s = db.prepare('SELECT * FROM camera_settings LIMIT 1').get();
    if (!s) return res.status(404).send('لم يتم حفظ إعدادات الكاميرا');

    const options = {
      hostname: s.ip_address,
      port:     parseInt(s.port) || 80,
      path:     s.stream_path || '/ISAPI/Streaming/channels/101/httpPreview',
      method:   'GET',
    };

    const camRes = await fetchWithDigest(options, s.username||'admin', s.password||'', 8000);

    if (camRes.statusCode === 401) {
      camRes.resume();
      return res.status(401).send('كلمة المرور خاطئة — تحقق من البيانات');
    }
    if (camRes.statusCode !== 200) {
      let body = '';
      camRes.on('data', d => body += d);
      return camRes.on('end', () => res.status(camRes.statusCode).send(`${camRes.statusCode} | ${body.substring(0,200)}`));
    }

    res.setHeader('Content-Type', camRes.headers['content-type'] || 'multipart/x-mixed-replace');
    res.setHeader('Cache-Control', 'no-cache, no-store');

    const cleanup = () => { try { camRes.destroy(); } catch(_){} };
    req.on('close', cleanup);
    res.on('close', cleanup);
    camRes.on('error', cleanup);

    camRes.pipe(res);
  } catch(e) {
    const msg = e.message === 'TIMEOUT'      ? `انتهت مهلة الاتصال بالكاميرا` :
                e.code === 'ECONNREFUSED'    ? `الكاميرا غير متصلة على هذا العنوان/المنفذ` :
                e.code === 'EHOSTUNREACH'    ? `لا يمكن الوصول للكاميرا — تحقق من الشبكة` :
                e.message;
    if (!res.headersSent) res.status(502).send(msg);
  }
};

// ── اختبار الاتصال ──────────────────────────────────────────────
exports.testConnection = async (req, res) => {
  const { ip_address, port, username, password, snapshot_path } = req.body;
  if (!ip_address) return res.status(400).json({ success:false, message:'عنوان IP مطلوب' });

  const options = {
    hostname: ip_address,
    port:     parseInt(port) || 80,
    path:     snapshot_path || '/ISAPI/Streaming/channels/101/picture',
    method:   'GET',
  };

  try {
    const camRes = await fetchWithDigest(options, username||'admin', password||'', 5000);
    const ct = camRes.headers['content-type'] || '';
    camRes.resume();

    if (camRes.statusCode === 200 && ct.includes('image')) {
      res.json({ success:true,  message:`✅ نجح الاتصال — الكاميرا ترسل صورة بنجاح (${ct})` });
    } else if (camRes.statusCode === 200) {
      res.json({ success:false, message:`⚠️ اتصال OK لكن المسار لا يُعيد صورة (${ct}) — جرّب مساراً آخر` });
    } else if (camRes.statusCode === 401) {
      res.json({ success:false, message:`❌ 401 — كلمة المرور خاطئة بعد Digest Auth` });
    } else if (camRes.statusCode === 404) {
      res.json({ success:false, message:`❌ 404 — المسار غير موجود: ${options.path}` });
    } else {
      res.json({ success:false, message:`❌ الكاميرا ردّت بـ ${camRes.statusCode}` });
    }
  } catch(e) {
    const msg = e.message === 'TIMEOUT'   ? `❌ انتهت مهلة 5 ثوانٍ — ${ip_address} لا يستجيب` :
                e.code==='ECONNREFUSED'   ? `❌ مرفوض — ${ip_address}:${port||80} غير متاح` :
                e.code==='EHOSTUNREACH'   ? `❌ لا يمكن الوصول — ${ip_address}` :
                `❌ ${e.message}`;
    res.json({ success:false, message: msg });
  }
};
