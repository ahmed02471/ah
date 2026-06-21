/**
 * login.js — صفحة تسجيل الدخول
 * نظام إدارة مرور سبها
 */

(function () {

  // إذا كان المستخدم مسجَّل الدخول مسبقاً، حوِّله للوحة التحكم
  if (Auth.isLoggedIn()) {
    _redirectByRole(Auth.getRole());
    return;
  }

  // ─── العناصر ────────────────────────────────────────────────────
  const form       = document.getElementById('loginForm');
  const errorDiv   = document.getElementById('login-error');
  const errorMsg   = document.getElementById('error-message');
  const btn        = document.getElementById('loginBtn');
  const btnText    = document.getElementById('loginBtnText');
  const btnLoading = document.getElementById('loginBtnLoading');

  // ─── إظهار/إخفاء كلمة المرور ────────────────────────────────────
  window.togglePassword = function () {
    const input = document.getElementById('password');
    input.type = input.type === 'password' ? 'text' : 'password';
    const toggleBtn = document.querySelector('.toggle-password');
    if (toggleBtn) toggleBtn.textContent = input.type === 'password' ? '👁' : '🙈';
  };

  // ─── معالجة النموذج ─────────────────────────────────────────────
  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const nationalId = document.getElementById('national_id').value.trim();
    const password   = document.getElementById('password').value;

    // تحقق بسيط على الواجهة
    if (!nationalId) {
      showError('الرجاء إدخال الرقم الوطني');
      return;
    }
    if (!password) {
      showError('الرجاء إدخال كلمة المرور');
      return;
    }

    setLoading(true);
    hideError();

    try {
      const data = await Auth.api('POST', '/api/v1/auth/login', {
        national_id: nationalId,
        password
      });

      if (data.success) {
        Auth.saveSession(data.data);
        _redirectByRole(data.data.role);
      } else {
        showError(data.message || 'الرقم الوطني أو كلمة المرور غير صحيحة');
      }
    } catch (err) {
      showError('خطأ في الاتصال بالخادم. تأكد من اتصالك بالإنترنت وحاول مجدداً.');
    } finally {
      setLoading(false);
    }
  });

  // ─── مساعدات ─────────────────────────────────────────────────────

  function setLoading(loading) {
    btn.disabled    = loading;
    btnText.style.display    = loading ? 'none'   : 'inline';
    btnLoading.style.display = loading ? 'inline' : 'none';
  }

  function showError(msg) {
    errorMsg.textContent  = msg;
    errorDiv.style.display = 'block';
  }

  function hideError() {
    errorDiv.style.display = 'none';
  }

  function _redirectByRole(role) {
    const routes = {
      ADMIN:      '/dashboard',
      REG_CHIEF:  '/dashboard',
      INSP_CHIEF: '/dashboard',
      PLATE_DEPT: '/dashboard',
      OFFICER:    '/officer/scan',
      CITIZEN:    '/citizen/home'
    };
    window.location.href = routes[role] || '/dashboard';
  }

  // مسح رسالة الخطأ عند الكتابة
  document.getElementById('national_id').addEventListener('input', hideError);
  document.getElementById('password').addEventListener('input', hideError);

})();