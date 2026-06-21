/**
 * utils.js — أدوات مساعدة مشتركة
 * نظام إدارة مرور سبها
 */

const Utils = (() => {

    // ─── التنسيق ────────────────────────────────────────────────────

    /** تنسيق رقم كعملة دينار ليبي */
    function formatCurrency(n) {
        if (n == null || n === '') return '—';
        return Number(n).toLocaleString('ar-LY', {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1
        }) + ' د.ل';
    }

    /** تنسيق رقم عادي */
    function formatNumber(n) {
        if (n == null || n === '') return '—';
        return Number(n).toLocaleString('ar-LY');
    }

    /** تنسيق تاريخ ISO إلى نص عربي */
    function formatDate(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleDateString('ar-LY', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    /** تنسيق تاريخ ووقت ISO إلى نص عربي */
    function formatDateTime(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('ar-LY', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    /**
     * تنسيق تاريخ نسبي (منذ ...)
     * @param {string} iso
     * @returns {string}
     */
    function timeAgo(iso) {
        if (!iso) return '—';
        const diff = Date.now() - new Date(iso).getTime();
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        if (mins < 1) return 'الآن';
        if (mins < 60) return `منذ ${mins} دقيقة`;
        if (hours < 24) return `منذ ${hours} ساعة`;
        if (days < 30) return `منذ ${days} يوم`;
        return formatDate(iso);
    }

    // ─── تسميات الحالات ─────────────────────────────────────────────

    const VEHICLE_STATUS = {
        active: { text: 'نشطة', cls: 'badge-green' },
        suspended: { text: 'معلقة', cls: 'badge-yellow' },
        transferred: { text: 'منقولة', cls: 'badge-gray' },
        reported_stolen: { text: 'مسروقة', cls: 'badge-red' }
    };

    const VIOLATION_STATUS = {
        unpaid: { text: 'غير مدفوعة', cls: 'badge-red' },
        paid: { text: 'مدفوعة', cls: 'badge-green' },
        referred_to_prosecutor: { text: 'أُحيلت للنيابة', cls: 'badge-yellow' }
    };

    const TRANSFER_STATUS = {
        pending: { text: 'معلّق', cls: 'badge-yellow' },
        plate_suspended: { text: 'اللوحة معلقة', cls: 'badge-orange' },
        completed: { text: 'مكتمل', cls: 'badge-green' },
        cancelled: { text: 'ملغى', cls: 'badge-gray' }
    };

    const ROLE_NAMES = {
        ADMIN: 'مدير النظام',
        REG_CHIEF: 'رئيس قسم التسجيل',
        INSP_CHIEF: 'رئيس قسم الفحص الفني',
        PLATE_DEPT: 'قسم اللوحات المعدنية',
        OFFICER: 'ضابط المرور الميداني',
        CITIZEN: 'مواطن'
    };

    /** HTML لشارة الحالة */
    function statusBadge(statusMap, key) {
        const s = statusMap[key] || { text: key, cls: 'badge-gray' };
        return `<span class="badge ${s.cls}">${s.text}</span>`;
    }

    // ─── DOM ─────────────────────────────────────────────────────────

    /** تعيين نص عنصر بأمان */
    function setText(id, val) {
        const el = typeof id === 'string' ? document.getElementById(id) : id;
        if (el) el.textContent = val ?? '—';
    }

    /** تعيين HTML عنصر بأمان */
    function setHTML(id, html) {
        const el = typeof id === 'string' ? document.getElementById(id) : id;
        if (el) el.innerHTML = html;
    }

    /** إظهار عنصر */
    function show(id) {
        const el = typeof id === 'string' ? document.getElementById(id) : id;
        if (el) el.style.display = '';
    }

    /** إخفاء عنصر */
    function hide(id) {
        const el = typeof id === 'string' ? document.getElementById(id) : id;
        if (el) el.style.display = 'none';
    }

    // ─── الإشعارات (Toast) ──────────────────────────────────────────

    let _toastContainer = null;

    function _getToastContainer() {
        if (_toastContainer) return _toastContainer;
        _toastContainer = document.createElement('div');
        _toastContainer.id = 'toast-container';
        _toastContainer.style.cssText = `
      position:fixed; bottom:1.5rem; left:50%; transform:translateX(-50%);
      z-index:9999; display:flex; flex-direction:column; gap:.5rem;
      align-items:center; pointer-events:none;
    `;
        document.body.appendChild(_toastContainer);
        return _toastContainer;
    }

    /**
     * عرض رسالة Toast مؤقتة
     * @param {string} message
     * @param {'success'|'error'|'info'|'warning'} type
     * @param {number} duration بالميلي ثانية
     */
    function toast(message, type = 'info', duration = 3500) {
        const container = _getToastContainer();
        const el = document.createElement('div');
        const colors = {
            success: '#2d6a4f',
            error: '#c0392b',
            warning: '#d68910',
            info: '#1a5276'
        };
        el.style.cssText = `
      background:${colors[type] || colors.info};
      color:#fff; padding:.75rem 1.5rem; border-radius:.5rem;
      font-size:.95rem; pointer-events:auto; box-shadow:0 4px 12px rgba(0,0,0,.25);
      direction:rtl; max-width:90vw; text-align:center;
      animation: fadeInUp .25s ease;
    `;
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, duration);
        setTimeout(() => el.remove(), duration + 350);
    }

    // ─── Debounce ────────────────────────────────────────────────────

    /**
     * تأخير تنفيذ دالة حتى يتوقف المستخدم عن الكتابة
     * @param {Function} fn
     * @param {number} wait بالميلي ثانية
     */
    function debounce(fn, wait = 400) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), wait);
        };
    }

    // ─── تحقق من صحة المدخلات ────────────────────────────────────────

    /** هل الرقم الوطني الليبي صحيح؟ (12 رقماً) */
    function isValidNationalId(id) {
        return /^\d{12}$/.test(String(id).trim());
    }

    /** هل رقم اللوحة بالتنسيق الصحيح؟ */
    function isValidPlateNumber(plate) {
        return /^\d+-[^-]+-ليبيا$/.test(String(plate).trim());
    }

    // ─── مساعدات الصفحات ────────────────────────────────────────────

    /**
     * استخراج معامل من URL الحالي
     * @param {string} name
     */
    function getUrlParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    /**
     * استخراج جزء من مسار الـ URL (مثل معرف المركبة)
     * مثال: /vehicles/42 → getPathSegment(-1) → "42"
     * @param {number} index — رقم سالب للعد من الآخر
     */
    function getPathSegment(index = -1) {
        const parts = window.location.pathname.split('/').filter(Boolean);
        return index < 0 ? parts[parts.length + index] : parts[index];
    }

    // ─── تصدير ──────────────────────────────────────────────────────

    return {
        formatCurrency,
        formatNumber,
        formatDate,
        formatDateTime,
        timeAgo,
        VEHICLE_STATUS,
        VIOLATION_STATUS,
        TRANSFER_STATUS,
        ROLE_NAMES,
        statusBadge,
        setText,
        setHTML,
        show,
        hide,
        toast,
        debounce,
        isValidNationalId,
        isValidPlateNumber,
        getUrlParam,
        getPathSegment
    };
})();

if (typeof module !== 'undefined') module.exports = Utils;