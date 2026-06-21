(function () {
  const role = localStorage.getItem('user_role') || '';
  const name = localStorage.getItem('user_name') || 'المستخدم';
  const path = location.pathname;

  const ROLE_AR = {
    ADMIN:'مدير النظام', REG_CHIEF:'رئيس التسجيل',
    INSP_CHIEF:'رئيس الفحص الفني', VIOLATIONS_DEPT:'قسم المخالفات',
    PLATE_DEPT:'قسم اللوحات', OFFICER:'ضابط ميداني', CITIZEN:'مواطن'
  };

  // sec = data-section value for color theming
  const MENUS = {
    ADMIN: [
      { section:'الرئيسية', color:'blue' },
      { href:'/dashboard',             icon:'grid',    label:'لوحة التحكم',          sec:'main' },
      { href:'/pending',               icon:'clock',   label:'الطلبات المعلّقة',      sec:'main' },
      { href:'/citizen-requests',      icon:'person',  label:'طلبات المواطنين',       sec:'main' },
      { section:'المركبات والمخالفات', color:'green' },
      { href:'/vehicles',              icon:'car',     label:'المركبات',              sec:'reg' },
      { href:'/violations',            icon:'warning', label:'المخالفات',             sec:'viol' },
      { href:'/transfers',             icon:'swap',    label:'نقل الملكية',           sec:'reg' },
      { section:'التواصل', color:'sky' },
      { href:'/messages',              icon:'msg',     label:'الرسائل الداخلية',      sec:'admin', badge:'msg_count' },
      { section:'الإدارة', color:'sky' },
      { href:'/admin/staff',           icon:'staff',   label:'الموظفون',              sec:'admin' },
      { href:'/admin/citizens',        icon:'users',   label:'المواطنون',             sec:'admin' },
      { href:'/admin/violation-types', icon:'list',    label:'أنواع المخالفات',       sec:'admin' },
      { href:'/admin/contract-writers',icon:'pen',     label:'محررو العقود',          sec:'admin' },
      { href:'/liens',                 icon:'lock',    label:'الرهونات',              sec:'admin' },
      { href:'/admin/camera',          icon:'cam',     label:'إعدادات الكاميرا',      sec:'admin' },
      { href:'/admin/audit',           icon:'log',     label:'سجل التدقيق',           sec:'admin' },
    ],
    REG_CHIEF: [
      { section:'الرئيسية', color:'blue' },
      { href:'/dashboard',             icon:'grid',    label:'لوحة التحكم',           sec:'main' },
      { href:'/pending',               icon:'clock',   label:'الطلبات المعلّقة',      sec:'main' },
      { href:'/citizen-requests',      icon:'person',  label:'طلبات المواطنين',       sec:'main' },
      { section:'التسجيل', color:'green' },
      { href:'/vehicles/new',          icon:'plus',    label:'تسجيل مركبة جديدة',    sec:'reg' },
      { href:'/vehicles',              icon:'car',     label:'المركبات',              sec:'reg' },
      { href:'/transfers',             icon:'swap',    label:'نقل الملكية',           sec:'reg' },
      { section:'العمليات', color:'red' },
      { href:'/violations',            icon:'warning', label:'المخالفات',             sec:'viol' },
      { href:'/admin/contract-writers',icon:'pen',     label:'محررو العقود',          sec:'reg' },
      { href:'/patrol/static',         icon:'cam',     label:'الدورية الثابتة',       sec:'main' },
      { href:'/messages',              icon:'msg',     label:'الرسائل الداخلية',      sec:'admin', badge:'msg_count' },
    ],
    INSP_CHIEF: [
      { section:'الرئيسية', color:'blue' },
      { href:'/dashboard',             icon:'grid',    label:'لوحة التحكم',           sec:'main' },
      { href:'/pending',               icon:'clock',   label:'الطلبات المعلّقة',      sec:'main' },
      { href:'/citizen-requests',      icon:'person',  label:'طلبات المواطنين',       sec:'main' },
      { section:'الفحص الفني', color:'amber' },
      { href:'/admin/camera',          icon:'cam',     label:'إعدادات الكاميرا',      sec:'insp' },
      { href:'/messages',              icon:'msg',     label:'الرسائل الداخلية',      sec:'admin', badge:'msg_count' },
    ],
    VIOLATIONS_DEPT: [
      { section:'الرئيسية', color:'blue' },
      { href:'/dashboard',             icon:'grid',    label:'لوحة التحكم',           sec:'main' },
      { href:'/citizen-requests',      icon:'person',  label:'طلبات المواطنين',       sec:'main' },
      { section:'المخالفات', color:'red' },
      { href:'/violations',            icon:'warning', label:'المخالفات',             sec:'viol' },
      { href:'/messages',              icon:'msg',     label:'الرسائل الداخلية',      sec:'admin', badge:'msg_count' },
    ],
    PLATE_DEPT: [
      { section:'الرئيسية', color:'blue' },
      { href:'/dashboard',             icon:'grid',    label:'لوحة التحكم',           sec:'main' },
      { href:'/citizen-requests',      icon:'person',  label:'طلبات المواطنين',       sec:'main' },
      { section:'اللوحات', color:'purple' },
      { href:'/vehicles/pending',      icon:'clock',   label:'طلبات الطباعة',         sec:'plates' },
      { href:'/plates/pending',        icon:'tag',     label:'طلبات إصدار اللوحات',   sec:'plates' },
      { href:'/transfers',             icon:'swap',    label:'طلبات النقل',           sec:'plates' },
      { href:'/messages',              icon:'msg',     label:'الرسائل',               sec:'admin', badge:'msg_count' },
    ],
    OFFICER: [
      { section:'الرئيسية', color:'blue' },
      { href:'/dashboard',             icon:'grid',    label:'لوحة التحكم',           sec:'main' },
      { href:'/citizen-requests',      icon:'person',  label:'طلبات المواطنين',       sec:'main' },
      { section:'الدورية', color:'amber' },
      { href:'/patrol/mobile',         icon:'qr',      label:'الدورية المتحركة',      sec:'insp' },
      { href:'/patrol/static',         icon:'cam',     label:'الدورية الثابتة',       sec:'insp' },
      { section:'المخالفات', color:'red' },
      { href:'/violations',            icon:'warning', label:'مخالفاتي',              sec:'viol' },
    ],
    CITIZEN: [
      { section:'بوابة المواطن', color:'blue' },
      { href:'/citizen',               icon:'grid',    label:'الرئيسية',              sec:'main' },
      { href:'/citizen/vehicles',      icon:'car',     label:'مركباتي',               sec:'reg' },
      { href:'/citizen/violations',    icon:'warning', label:'مخالفاتي',              sec:'viol' },
      { href:'/citizen/signs',         icon:'sign',    label:'العلامات المرورية',     sec:'main' },
      { href:'/citizen/reports',       icon:'report',  label:'تقديم بلاغ',            sec:'viol' },
      { href:'/citizen/notifications', icon:'bell',    label:'الإشعارات',             sec:'main' },
    ],
  };

  const IC = {
    grid:    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    car:     '<path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v7a2 2 0 0 1-2 2h-1"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    swap:    '<path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>',
    msg:     '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    staff:   '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    users:   '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    list:    '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    pen:     '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    log:     '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    cam:     '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    qr:      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><line x1="14" y1="14" x2="20" y2="20"/>',
    plus:    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
    tag:     '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    sign:    '<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>',
    bell:    '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    report:  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>',
    lock:    '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    user:    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    out:     '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    clock:   '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    person:  '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  };

  function ico(k) {
    return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" style="display:block;">${IC[k]||''}</svg>`;
  }

  function isActive(href) {
    if (href === '/dashboard') return path === '/dashboard';
    if (href === '/citizen')   return path === '/citizen';
    return path.startsWith(href) && href !== '/';
  }

  const menu = MENUS[role] || MENUS.CITIZEN;
  let nav = '';

  menu.forEach(item => {
    if (item.section) {
      nav += `<div class="sidebar-section" ${item.color ? `data-color="${item.color}"` : ''}>${item.section}</div>`;
    } else {
      const act = isActive(item.href) ? 'active' : '';
      const badge = item.badge
        ? `<span id="${item.badge}" style="margin-right:auto;background:#ef4444;color:#fff;font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;display:none;min-width:20px;text-align:center;"></span>`
        : '';
      nav += `<a href="${item.href}" class="sidebar-link ${act}" data-section="${item.sec||'main'}">
        <div class="sl-icon">${ico(item.icon)}</div>
        <span>${item.label}</span>
        ${badge}
      </a>`;
    }
  });

  // Role color / initial
  const ROLE_COLORS = {
    ADMIN:'135deg,#2563EB,#7c3aed',
    REG_CHIEF:'135deg,#059669,#0891b2',
    INSP_CHIEF:'135deg,#D97706,#EA580C',
    VIOLATIONS_DEPT:'135deg,#DC2626,#DB2777',
    PLATE_DEPT:'135deg,#7c3aed,#4f46e5',
    OFFICER:'135deg,#0891b2,#0284c7',
    CITIZEN:'135deg,#2563EB,#0891b2',
  };

  const aside = document.createElement('aside');
  aside.className = 'sidebar';
  aside.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-logo">
        <div class="sidebar-logo-mark">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2">
            <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v7a2 2 0 0 1-2 2h-1"/>
            <circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>
          </svg>
        </div>
        <div class="sidebar-brand">
          <div class="sidebar-brand-name">نظام مرور سبها</div>
          <div class="sidebar-brand-sub">Sabha Traffic · v8</div>
        </div>
      </div>
      <div class="sidebar-gold-line"></div>
      <div class="sidebar-user">
        <div class="sidebar-avatar" style="background:linear-gradient(${ROLE_COLORS[role]||ROLE_COLORS.CITIZEN})">
          ${(name[0]||'م')}
        </div>
        <div>
          <div class="sidebar-user-name">${name}</div>
          <div class="sidebar-user-role">${ROLE_AR[role]||role}</div>
        </div>
      </div>
    </div>
    <nav class="sidebar-nav">
      ${nav}
      <div class="sidebar-divider" style="margin-top:8px;"></div>
      <a href="/profile" class="sidebar-link ${path==='/profile'?'active':''}" data-section="admin">
        <div class="sl-icon">${ico('user')}</div>
        <span>الملف الشخصي</span>
      </a>
    </nav>
    <div class="sidebar-footer">
      <button class="sidebar-logout" onclick="localStorage.clear();location.href='/login'">
        <div class="sl-icon">${ico('out')}</div>
        <span>تسجيل الخروج</span>
      </button>
    </div>`;

  const c = document.getElementById('sidebar-container');
  if (c) c.replaceWith(aside);
  else document.body.prepend(aside);

  if (!localStorage.getItem('auth_token') && !location.pathname.includes('/login')) location.href = '/login';

  // ─── Mobile topbar + hamburger ────────────────────────────────
  // ─── Mobile: expose open/close globally so onclick works ────────
  window._sidebarOpen  = function() { aside.classList.add('open');    document.getElementById('sb-overlay').classList.add('open'); };
  window._sidebarClose = function() { aside.classList.remove('open'); document.getElementById('sb-overlay').classList.remove('open'); };

  // Overlay
  const overlay = document.createElement('div');
  overlay.id = 'sb-overlay';
  overlay.className = 'sidebar-overlay';
  overlay.setAttribute('onclick', '_sidebarClose()');
  document.body.appendChild(overlay);

  // Mobile topbar
  const topbar = document.createElement('div');
  topbar.className = 'mobile-topbar';
  topbar.innerHTML = `
    <div class="mobile-topbar-brand">
      <div class="mobile-topbar-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
          <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v7a2 2 0 0 1-2 2h-1"/>
          <circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>
        </svg>
      </div>
      <span class="mobile-topbar-name">مرور سبها</span>
    </div>
    <button class="hamburger-btn" onclick="_sidebarOpen()" aria-label="القائمة">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>`;
  document.body.appendChild(topbar);

  // Close on sidebar link tap (mobile)
  aside.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', () => { if (window.innerWidth <= 768) window._sidebarClose(); });
  });

  // عداد الرسائل
  setInterval(() => {
    if (!localStorage.getItem('auth_token')) return;
    fetch('/api/v1/messages/unread-count', {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('auth_token') }
    }).then(r => r.json()).then(d => {
      const el = document.getElementById('msg_count');
      if (el && d.data?.count > 0) { el.textContent = d.data.count; el.style.display = 'inline-block'; }
      else if (el) el.style.display = 'none';
    }).catch(() => {});
  }, 30000);
})();
