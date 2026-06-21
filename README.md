# نظام إدارة مرور سبها الرقمي
**Sabha Digital Traffic Management System v6.0**

## 🚀 التشغيل السريع

```bash
npm install
node scripts/seed.js
npm start
```

افتح: http://localhost:3000

## 👤 بيانات الدخول

| الدور | اسم المستخدم | كلمة المرور |
|-------|-------------|-------------|
| مدير النظام | `admin` | `Admin@2026` |
| رئيس التسجيل | `reg.chief` | `Reg@2026` |
| رئيس الفحص | `insp.chief` | `Insp@2026` |
| قسم المخالفات | `violations.dept` | `Viol@2026` |
| قسم اللوحات | `plate.dept` | `Plate@2026` |
| ضابط الميداني | `officer.001` | `Officer@2026` |

## 📋 مسار تسجيل مركبة جديدة

```
REG_CHIEF → ADMIN (موافقة) → REG_CHIEF (بيانات المالك)
→ INSP_CHIEF (فحص + بيانات المركبة) → REG_CHIEF (البل)
→ ADMIN (موافقة نهائية) → PLATE_DEPT (30 دينار + لوحة + QR)
```

## 🏷️ تنسيق اللوحة
- سيارات خاصة: `45892 - 1 - LBY`
- سيارات النقل: `45892 - 1 - LBY - TR`

## 📱 Electron (سطح المكتب)
```bash
npm run electron
```

## ⚙️ متطلبات
- Node.js 18+
- Windows / macOS / Linux
