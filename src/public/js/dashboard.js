/**
 * dashboard.js — لوحة التحكم
 * نظام إدارة مرور سبها
 */

(function () {

    // حارس الصفحة
    if (!Auth.requireAuth()) return;

    const role = Auth.getRole();
    const userName = Auth.getName();

    // ─── إظهار اسم المستخدم ──────────────────────────────────────────
    const nameEl = document.getElementById('user-display-name');
    if (nameEl) nameEl.textContent = userName;

    // ─── إظهار القسم المناسب للدور ──────────────────────────────────
    const sectionMap = {
        ADMIN: 'section-admin',
        REG_CHIEF: 'section-reg',
        INSP_CHIEF: 'section-insp',
        PLATE_DEPT: 'section-plate'
    };

    const sectionId = sectionMap[role];
    if (sectionId) {
        const section = document.getElementById(sectionId);
        if (section) section.style.display = 'block';
    }

    // ─── جلب إحصاءات لوحة التحكم ────────────────────────────────────
    async function loadDashboardStats() {
        const data = await Auth.api('GET', '/api/v1/stats/dashboard');
        if (!data.success) return;
        const s = data.data;

        const { setText, formatNumber, formatCurrency } = Utils;

        if (role === 'ADMIN') {
            setText('stat-total-vehicles', formatNumber(s.total_vehicles));
            setText('stat-unpaid-violations', formatNumber(s.unpaid_violations));
            setText('stat-revenue-month', s.revenue_month != null
                ? Number(s.revenue_month).toLocaleString('ar-LY') : '—');
            setText('stat-active-users', formatNumber(s.active_users));
            setText('stat-pending-transfers', formatNumber(s.pending_transfers));
            setText('stat-today-actions', formatNumber(s.today_actions));

            loadViolationsByType();
            loadRecentAudit();

        } else if (role === 'REG_CHIEF') {
            setText('reg-stat-vehicles', formatNumber(s.total_vehicles));
            setText('reg-stat-unpaid', formatNumber(s.unpaid_violations));
            setText('reg-stat-transfers', formatNumber(s.pending_transfers));
            setText('reg-stat-expiring-insurance', formatNumber(s.expiring_insurance));

        } else if (role === 'INSP_CHIEF') {
            setText('insp-stat-passed', formatNumber(s.inspections_passed_month));
            setText('insp-stat-failed', formatNumber(s.inspections_failed_month));
            setText('insp-stat-due', formatNumber(s.inspections_due_soon));

        } else if (role === 'PLATE_DEPT') {
            setText('plate-stat-pending', formatNumber(s.pending_plate_requests));
            setText('plate-stat-issued-today', formatNumber(s.plates_issued_today));
        }
    }

    // ─── جدول المخالفات حسب النوع (ADMIN) ──────────────────────────
    async function loadViolationsByType() {
        const tbody = document.querySelector('#violations-by-type-table tbody');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">جارٍ التحميل...</td></tr>';

        const data = await Auth.api('GET', '/api/v1/stats/violations-by-type');
        if (!data.success || !data.data.length) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">لا توجد بيانات</td></tr>';
            return;
        }

        tbody.innerHTML = data.data.map(row => `
      <tr>
        <td>${row.name_ar || row.violation_type || '—'}</td>
        <td class="text-center">${Utils.formatNumber(row.count)}</td>
        <td class="text-center">${Utils.formatCurrency(row.total_amount)}</td>
      </tr>
    `).join('');
    }

    // ─── آخر نشاطات التدقيق (ADMIN) ─────────────────────────────────
    async function loadRecentAudit() {
        const list = document.getElementById('audit-recent-list');
        if (!list) return;

        list.innerHTML = '<div class="text-muted text-center">جارٍ التحميل...</div>';

        const data = await Auth.api('GET', '/api/v1/admin/audit?limit=8');
        if (!data.success || !data.data.length) {
            list.innerHTML = '<div class="text-muted text-center">لا توجد نشاطات</div>';
            return;
        }

        // تسميات الإجراءات بالعربية
        const actionLabels = {
            CREATE_VEHICLE: 'تسجيل مركبة جديدة',
            UPDATE_VEHICLE: 'تعديل بيانات مركبة',
            CREATE_VIOLATION: 'تحرير مخالفة',
            PAY_VIOLATION: 'تسجيل دفع مخالفة',
            TRANSFER_START: 'بدء نقل ملكية',
            TRANSFER_COMPLETE: 'إتمام نقل ملكية',
            TRANSFER_CANCEL: 'إلغاء نقل ملكية',
            CREATE_INSPECTION: 'تسجيل فحص فني',
            ISSUE_PLATE: 'إصدار لوحة',
            CREATE_USER: 'إنشاء مستخدم',
            UPDATE_USER: 'تعديل مستخدم',
            DISABLE_USER: 'تعطيل مستخدم',
            RESET_PASSWORD: 'إعادة تعيين كلمة مرور'
        };

        list.innerHTML = data.data.map(entry => `
      <div class="activity-item">
        <span class="activity-action">${actionLabels[entry.action] || entry.action}</span>
        <span class="activity-user text-muted">${entry.user_name || '—'}</span>
        <span class="activity-time text-muted text-sm">${Utils.timeAgo(entry.created_at)}</span>
      </div>
    `).join('');
    }

    // ─── polling الإشعارات ───────────────────────────────────────────
    async function pollNotifications() {
        if (!Auth.isLoggedIn()) return;
        try {
            const data = await Auth.api('GET', '/api/v1/notifications/unread-count');
            if (data.success && data.data.count > 0) {
                const badge = document.getElementById('notif-badge');
                const countEl = document.getElementById('notif-count');
                if (badge) badge.style.display = 'flex';
                if (countEl) countEl.textContent = data.data.count;
            }
        } catch (_) { /* تجاهُل */ }
    }

    // ─── تشغيل ───────────────────────────────────────────────────────
    loadDashboardStats();
    pollNotifications();
    setInterval(pollNotifications, 60000);

})();