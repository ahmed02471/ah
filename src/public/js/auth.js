/**
 * auth.js — وحدة المصادقة المشتركة
 * نظام إدارة مرور سبها
 */

const Auth = (() => {

    const TOKEN_KEY = 'token';
    const ROLE_KEY = 'role';
    const NAME_KEY = 'user_name';
    const USER_ID_KEY = 'user_id';

    /** الحصول على التوكن المخزَّن */
    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    /** الحصول على دور المستخدم */
    function getRole() {
        return localStorage.getItem(ROLE_KEY);
    }

    /** الحصول على الاسم المعروض */
    function getName() {
        return localStorage.getItem(NAME_KEY) || '';
    }

    /** هل المستخدم مسجَّل الدخول؟ */
    function isLoggedIn() {
        return !!getToken();
    }

    /**
     * رؤوس الطلب القياسية (تحتوي دائماً على التوكن)
     * @returns {HeadersInit}
     */
    function headers(extra = {}) {
        return {
            'Authorization': 'Bearer ' + getToken(),
            'Content-Type': 'application/json',
            ...extra
        };
    }

    /**
     * رؤوس بدون Content-Type (لرفع الملفات Multipart)
     */
    function headersMultipart() {
        return { 'Authorization': 'Bearer ' + getToken() };
    }

    /**
     * حفظ بيانات الجلسة بعد تسجيل الدخول
     * @param {{ token, role, full_name, id }} data
     */
    function saveSession(data) {
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(ROLE_KEY, data.role);
        localStorage.setItem(NAME_KEY, data.full_name);
        localStorage.setItem(USER_ID_KEY, data.id ?? '');
    }

    /** مسح الجلسة وإعادة التوجيه لصفحة الدخول */
    function clearSession(redirect = true) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(ROLE_KEY);
        localStorage.removeItem(NAME_KEY);
        localStorage.removeItem(USER_ID_KEY);
        if (redirect) window.location.href = '/login';
    }

    /**
     * تسجيل الخروج: يُبلِّغ الخادم ثم يمسح الجلسة
     */
    async function logout() {
        try {
            await fetch('/api/v1/auth/logout', {
                method: 'POST',
                headers: headers()
            });
        } catch (_) { /* تجاهُل أخطاء الشبكة */ }
        clearSession();
    }

    /**
     * حارس الصفحة — يُعاد التوجيه لصفحة الدخول إذا لم يكن المستخدم مسجَّلاً
     * استدعِه في بداية كل صفحة محمية
     * @param {string[]} [allowedRoles] — إذا أُعطي، يتحقق أن الدور مسموح به
     */
    function requireAuth(allowedRoles = null) {
        if (!isLoggedIn()) {
            window.location.href = '/login';
            return false;
        }
        if (allowedRoles && !allowedRoles.includes(getRole())) {
            window.location.href = '/403';
            return false;
        }
        return true;
    }

    /**
     * استدعاء API مُوحَّد مع معالجة الأخطاء التلقائية
     * يُعيد { success, data, message } أو يرمي خطأ
     */
    async function api(method, url, body = null, isMultipart = false) {
        const opts = {
            method,
            headers: isMultipart ? headersMultipart() : headers()
        };
        if (body) {
            opts.body = isMultipart ? body : JSON.stringify(body);
        }

        const res = await fetch(url, opts);

        // جلسة منتهية الصلاحية
        if (res.status === 401) {
            clearSession();
            return { success: false, message: 'انتهت جلستك. سيتم تحويلك لصفحة الدخول.' };
        }

        const data = await res.json();
        return data;
    }

    return {
        getToken,
        getRole,
        getName,
        isLoggedIn,
        headers,
        headersMultipart,
        saveSession,
        clearSession,
        logout,
        requireAuth,
        api
    };
})();

// تصدير للاستخدام في Node.js (اختياري)
if (typeof module !== 'undefined') module.exports = Auth;