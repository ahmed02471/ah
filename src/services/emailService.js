/**
 * emailService.js — إشعارات الإيميل الرسمية
 * مديرية أمن سبها — قسم مرور سبها
 */

let transporter = null;
let mockMode    = false;

// ── Brevo HTTP API (مفتاح API — لا يتطلب موافقة IP، خلافاً لـ SMTP) ──
// إن وُجد BREVO_API_KEY في .env يُستخدم كطريقة الإرسال الأساسية (الأكثر موثوقية).
// SMTP يبقى فقط كخطة احتياطية إن لم يتوفر مفتاح API.
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';

async function sendViaBrevoApi(to, subject, html) {
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: 'مرور سبها', email: process.env.EMAIL_FROM || 'no-reply@sabha-traffic.ly' },
      to: [{ email: to }],
      subject,
      htmlContent: html
    })
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(()=> '');
    throw new Error(`Brevo API ${resp.status}: ${errText.slice(0,300)}`);
  }
}

try {
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER || '',
      pass: process.env.EMAIL_PASS || '',
    },
    tls: { rejectUnauthorized: false }
  });
  console.log(BREVO_API_KEY ? '[Email] Brevo API جاهز ✅ (SMTP احتياطي)' : '[Email] Brevo SMTP جاهز ✅ (لا يوجد BREVO_API_KEY — قد يُرفض من IP غير موثّق)');
} catch(e) {
  console.log('[Email] Nodemailer not available — Mock mode');
  mockMode = true;
}

// ── إرسال خام (موضوع + HTML مباشرة بدون قالب) ───────────────────
async function sendRawEmail(to, subject, html) {
  if (!to || !to.includes('@')) return;

  if (mockMode || (!process.env.EMAIL_USER && !BREVO_API_KEY)) {
    console.log(`[Email Mock] To: ${to} | Subject: ${subject}`);
    return;
  }

  try {
    if (BREVO_API_KEY && typeof fetch === 'function') {
      await sendViaBrevoApi(to, subject, html);
    } else {
      await transporter.sendMail({
        from: `"مرور سبها" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
        to, subject, html
      });
    }
    console.log(`[Email] ✅ أُرسل لـ ${to}`);
  } catch(e) {
    console.error('[Email] Error:', e.message);
  }
}

// ── القالب الرئيسي ─────────────────────────────────────────────
function baseTemplate(title, content, refNum = '') {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, 'Segoe UI', sans-serif; background:#f4f6f9; direction:rtl; }
  .wrap { max-width:600px; margin:30px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,.1); }

  /* الترويسة */
  .header { background:linear-gradient(135deg,#1a237e,#283593); padding:24px 28px; text-align:center; }
  .header-logo { width:70px; height:70px; border-radius:50%; border:3px solid rgba(255,255,255,.3); margin:0 auto 12px; display:block; object-fit:cover; }
  .header-title { color:#fff; font-size:18px; font-weight:700; margin-bottom:4px; }
  .header-sub { color:rgba(255,255,255,.7); font-size:12px; }
  .header-line { width:60px; height:3px; background:linear-gradient(90deg,#c5a028,#f0c040); margin:10px auto 0; border-radius:2px; }

  /* المحتوى */
  .body { padding:28px; }
  .greeting { font-size:15px; font-weight:600; color:#1a237e; margin-bottom:16px; }
  .content-text { font-size:14px; color:#333; line-height:2; margin-bottom:16px; }

  /* بطاقة المعلومات */
  .info-card { background:#f8f9ff; border:1px solid #e0e4ff; border-radius:8px; padding:16px; margin:16px 0; }
  .info-row { display:flex; justify-content:space-between; padding:7px 0; border-bottom:1px solid #eee; font-size:13px; }
  .info-row:last-child { border:none; }
  .info-label { color:#666; }
  .info-val { font-weight:700; color:#1a237e; }

  /* رقم المراجعة */
  .review-box { background:linear-gradient(135deg,#1a237e,#283593); border-radius:10px; padding:16px; text-align:center; margin:16px 0; }
  .review-label { color:rgba(255,255,255,.7); font-size:11px; margin-bottom:6px; }
  .review-num { color:#f0c040; font-size:28px; font-weight:900; font-family:monospace; letter-spacing:4px; }

  /* تحذير */
  .alert-box { border-radius:8px; padding:12px 16px; margin:14px 0; font-size:13px; }
  .alert-warning { background:#fff8e1; border:1px solid #f0c040; color:#7a5c00; }
  .alert-danger  { background:#ffeaea; border:1px solid #f44336; color:#b71c1c; }
  .alert-success { background:#e8f5e9; border:1px solid #4caf50; color:#1b5e20; }

  /* الزر */
  .btn-area { text-align:center; margin:20px 0; }
  .btn { display:inline-block; background:linear-gradient(135deg,#1a237e,#283593); color:#fff; padding:12px 28px; border-radius:8px; text-decoration:none; font-size:14px; font-weight:700; }

  /* التذييل */
  .footer { background:#f0f2f8; padding:16px 28px; text-align:center; border-top:1px solid #e0e4ff; }
  .footer-title { font-size:12px; font-weight:700; color:#1a237e; margin-bottom:4px; }
  .footer-sub { font-size:11px; color:#888; line-height:1.8; }
  .footer-line { width:40px; height:2px; background:#c5a028; margin:8px auto; border-radius:2px; }
  .badge { display:inline-block; background:#1a237e; color:#f0c040; padding:3px 10px; border-radius:20px; font-size:10px; font-weight:700; margin-bottom:8px; }
</style>
</head>
<body>
<div class="wrap">

  <!-- الترويسة -->
  <div class="header">
    <img class="header-logo" src="https://i.imgur.com/placeholder.png" alt="شعار" onerror="this.style.display='none'">
    <div class="badge">وزارة الداخلية — ليبيا</div>
    <div class="header-title">مديرية أمن سبها</div>
    <div class="header-sub">إدارة مرور سبها · قسم التسجيل والترخيص</div>
    <div class="header-line"></div>
  </div>

  <!-- المحتوى -->
  <div class="body">
    ${content}
  </div>

  <!-- التذييل -->
  <div class="footer">
    <div class="footer-line"></div>
    <div class="footer-title">إدارة مرور سبها</div>
    <div class="footer-sub">
      هذه رسالة رسمية آلية — لا تقم بالرد عليها<br>
      للاستفسار: تفضل بزيارة مقر إدارة مرور سبها<br>
      ${refNum ? `رقم المرجع: <strong>${refNum}</strong>` : ''}
    </div>
  </div>

</div>
</body>
</html>`;
}

// ── القوالب ─────────────────────────────────────────────────────
const templates = {

  // تسجيل حساب جديد + رقم المراجعة
  registrationReceived: (name, reviewNumber) => ({
    subject: `طلب تسجيل مركبة — رقم المراجعة: ${reviewNumber}`,
    html: baseTemplate('استلام طلب التسجيل', `
      <div class="greeting">السيد/ة ${name}، تحية طيبة وبعد،</div>
      <p class="content-text">
        تم استلام طلب تسجيل مركبتكم في منظومة إدارة مرور سبها بنجاح.
        يُرجى الاحتفاظ برقم المراجعة التالي للمتابعة مع قسم التسجيل:
      </p>
      <div class="review-box">
        <div class="review-label">رقم المراجعة الخاص بطلبك</div>
        <div class="review-num">${reviewNumber}</div>
      </div>
      <div class="alert-box alert-warning">
        ⚠️ يُرجى التوجه لمقر إدارة مرور سبها بهذا الرقم لاستكمال إجراءات التسجيل.
      </div>
      <div class="info-card">
        <div class="info-row"><span class="info-label">اسم مقدم الطلب</span><span class="info-val">${name}</span></div>
        <div class="info-row"><span class="info-label">رقم المراجعة</span><span class="info-val">${reviewNumber}</span></div>
        <div class="info-row"><span class="info-label">حالة الطلب</span><span class="info-val">✅ تم الاستلام — قيد المراجعة</span></div>
      </div>
      <p class="content-text" style="font-size:12px;color:#888;">
        ستصلك رسالة إيميل عند الموافقة على طلبك أو عند الحاجة لمعلومات إضافية.
      </p>`, reviewNumber),
  }),

  // موافقة على الطلب
  requestApproved: (name, plateNumber) => ({
    subject: `✅ تمت الموافقة على طلب التسجيل — لوحة: ${plateNumber}`,
    html: baseTemplate('موافقة على طلب التسجيل', `
      <div class="greeting">السيد/ة ${name}، تحية طيبة وبعد،</div>
      <p class="content-text">
        يسعدنا إبلاغكم بأنه تمت الموافقة على طلب تسجيل مركبتكم وإصدار اللوحة المعدنية.
      </p>
      <div class="alert-box alert-success">
        ✅ تمت الموافقة على طلبكم بنجاح
      </div>
      <div class="info-card">
        <div class="info-row"><span class="info-label">رقم اللوحة</span><span class="info-val" style="font-family:monospace;font-size:16px;">${plateNumber}</span></div>
        <div class="info-row"><span class="info-label">الحالة</span><span class="info-val">✅ مسجلة وفعالة</span></div>
      </div>
      <div class="alert-box alert-warning">
        ⚠️ يُرجى التوجه لقسم اللوحات باستلام لوحتكم المعدنية مع سداد رسم الإصدار.
      </div>`),
  }),

  // مخالفة جديدة
  violationIssued: (name, amount, type) => ({
    subject: `⚠️ إشعار مخالفة مرورية — ${amount} دينار`,
    html: baseTemplate('إشعار مخالفة مرورية', `
      <div class="greeting">السيد/ة ${name}، تحية طيبة وبعد،</div>
      <div class="alert-box alert-danger">
        ⚠️ تم تسجيل مخالفة مرورية بحق مركبتكم
      </div>
      <div class="info-card">
        <div class="info-row"><span class="info-label">نوع المخالفة</span><span class="info-val">${type}</span></div>
        <div class="info-row"><span class="info-label">مبلغ الغرامة</span><span class="info-val" style="color:#dc2626;">${amount} دينار ليبي</span></div>
        <div class="info-row"><span class="info-label">طريقة السداد</span><span class="info-val">حضورياً في مقر الإدارة</span></div>
      </div>
      <p class="content-text">
        يُرجى التوجه لإدارة مرور سبها لسداد قيمة المخالفة في أقرب وقت ممكن.
      </p>`),
  }),

  // تنبيه انتهاء وثيقة
  expiryAlert: (name, docType, expiryDate, daysLeft) => ({
    subject: `⏰ تنبيه: ${docType} سينتهي خلال ${daysLeft} يوم`,
    html: baseTemplate('تنبيه انتهاء وثيقة', `
      <div class="greeting">السيد/ة ${name}، تحية طيبة وبعد،</div>
      <div class="alert-box alert-warning">
        ⏰ تنبيه مهم: ${docType} الخاص بمركبتكم على وشك الانتهاء
      </div>
      <div class="info-card">
        <div class="info-row"><span class="info-label">نوع الوثيقة</span><span class="info-val">${docType}</span></div>
        <div class="info-row"><span class="info-label">تاريخ الانتهاء</span><span class="info-val">${expiryDate}</span></div>
        <div class="info-row"><span class="info-label">الأيام المتبقية</span><span class="info-val" style="color:#d97706;">${daysLeft} يوم</span></div>
      </div>
      <p class="content-text">
        يُرجى التوجه لإدارة مرور سبها لتجديد ${docType} قبل انتهاء الصلاحية تفادياً للمخالفات.
      </p>`),
  }),

  // قبول بلاغ
  reportAccepted: (name, reportType, reportNum) => ({
    subject: `📋 تم استلام بلاغك — ${reportType}`,
    html: baseTemplate('استلام البلاغ', `
      <div class="greeting">السيد/ة ${name}، تحية طيبة وبعد،</div>
      <p class="content-text">
        تم استلام بلاغكم وقيده رسمياً في منظومة إدارة مرور سبها.
      </p>
      <div class="info-card">
        <div class="info-row"><span class="info-label">نوع البلاغ</span><span class="info-val">${reportType}</span></div>
        <div class="info-row"><span class="info-label">رقم البلاغ</span><span class="info-val">#${reportNum}</span></div>
        <div class="info-row"><span class="info-label">الحالة</span><span class="info-val">✅ قيد المراجعة</span></div>
      </div>
      <div class="alert-box alert-warning">
        ⚠️ لديك 7 أيام لاستكمال الإجراءات اللازمة وإلا ستصدر مخالفة آلية.
      </div>`),
  }),

  // الموافقة على بلاغ سرقة/ضياع لوحة (بعد موافقة رئيس قسم المرور وقسم التسجيل معاً)
  reportApproved: (name, reportType, plateNumber, reportNum) => ({
    subject: `🚨 تمت الموافقة على بلاغك — ${reportType}`,
    html: baseTemplate('الموافقة على البلاغ', `
      <div class="greeting">السيد/ة ${name}، تحية طيبة وبعد،</div>
      <p class="content-text">
        تمت موافقة رئيس قسم المرور وقسم التسجيل على بلاغكم، وتم تحديث حالة المركبة في النظام رسمياً.
      </p>
      <div class="alert-box alert-danger">
        🚨 تم تسجيل حالة المركبة: ${reportType}
      </div>
      <div class="info-card">
        <div class="info-row"><span class="info-label">نوع البلاغ</span><span class="info-val">${reportType}</span></div>
        <div class="info-row"><span class="info-label">رقم اللوحة</span><span class="info-val" style="font-family:monospace;">${plateNumber||'—'}</span></div>
        <div class="info-row"><span class="info-label">رقم البلاغ</span><span class="info-val">#${reportNum}</span></div>
        <div class="info-row"><span class="info-label">الحالة</span><span class="info-val">✅ تمت الموافقة من الجهتين</span></div>
      </div>
      <div class="alert-box alert-warning">
        ⚠️ يُرجى التوجه لإدارة مرور سبها لاستكمال أي إجراءات إضافية مطلوبة.
      </div>`, reportNum),
  }),

  // رفض بلاغ سرقة/ضياع لوحة
  reportRejected: (name, reportType, reportNum, reason) => ({
    subject: `❌ تم رفض بلاغك — ${reportType}`,
    html: baseTemplate('رفض البلاغ', `
      <div class="greeting">السيد/ة ${name}، تحية طيبة وبعد،</div>
      <p class="content-text">
        نأسف لإبلاغكم بأنه تم رفض بلاغكم بعد المراجعة.
      </p>
      <div class="info-card">
        <div class="info-row"><span class="info-label">نوع البلاغ</span><span class="info-val">${reportType}</span></div>
        <div class="info-row"><span class="info-label">رقم البلاغ</span><span class="info-val">#${reportNum}</span></div>
        <div class="info-row"><span class="info-label">الحالة</span><span class="info-val">❌ مرفوض</span></div>
        ${reason ? `<div class="info-row"><span class="info-label">سبب الرفض</span><span class="info-val">${reason}</span></div>` : ''}
      </div>
      <p class="content-text">
        لمزيد من الاستفسار يُرجى التوجه لإدارة مرور سبها.
      </p>`, reportNum),
  }),

  // إنشاء حساب
  accountCreated: (name, username) => ({
    subject: `🎉 تم إنشاء حسابك في منظومة مرور سبها`,
    html: baseTemplate('إنشاء حساب جديد', `
      <div class="greeting">مرحباً ${name}،</div>
      <p class="content-text">
        تم إنشاء حسابك في منظومة مرور سبها الإلكترونية بنجاح.
      </p>
      <div class="info-card">
        <div class="info-row"><span class="info-label">اسم المستخدم</span><span class="info-val" style="font-family:monospace;">${username}</span></div>
        <div class="info-row"><span class="info-label">الحالة</span><span class="info-val">✅ حساب فعال</span></div>
      </div>
      <div class="alert-box alert-warning">
        🔒 احتفظ ببيانات دخولك وعدم مشاركتها مع أي أحد.
      </div>`),
  }),

};

// ── دالة الإرسال (بالقوالب) ───────────────────────────────────────
async function sendEmail(to, templateName, ...args) {
  if (!to || !to.includes('@')) return;

  const tpl = templates[templateName];
  if (!tpl) { console.error('[Email] Unknown template:', templateName); return; }

  const { subject, html } = tpl(...args);
  return sendRawEmail(to, subject, html);
}



// إضافة template للوحة
templates.plateIssued = (name, plate) => ({
  subject: `🎉 تم إصدار لوحة مركبتك — ${plate}`,
  html: baseTemplate('إصدار اللوحة', `
    <div class="greeting">مرحباً ${name}،</div>
    <p class="content-text">تهانينا! تم إصدار لوحة مركبتك بنجاح.</p>
    <div class="info-card">
      <div class="info-row"><span class="info-label">رقم اللوحة</span>
      <span class="info-val" style="font-family:monospace;font-size:18px;">${plate}</span></div>
    </div>
    <div class="alert-box alert-warning">
      ⚠️ يرجى التوجه لقسم اللوحات لاستلام اللوحة المعدنية وملصق QR.
    </div>`)
});

module.exports = { sendEmail, sendRawEmail, templates };
