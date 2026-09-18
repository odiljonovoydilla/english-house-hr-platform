// ============================================================
// English House HR Platform — frontend (brauzer ilovasi)
// Auth login (teacher_id) + parol orqali olingan sessiya cookie'siga
// asoslanadi (server.py: /login, /api/login).
// ============================================================

const appEl = document.getElementById("app");

// ============================================================
// TUNGI / KUNDUZGI REJIM
// ============================================================

function getTheme() {
  const saved = (() => {
    try { return localStorage.getItem("eh-theme"); } catch (e) { return null; }
  })();
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem("eh-theme", next); } catch (e) { /* localStorage yo'q bo'lsa ham ilova ishlayversin */ }
  return next;
}

applyTheme(getTheme());

function fmt(n) {
  if (n === null || n === undefined) return "-";
  return Number(n).toLocaleString("uz-UZ", { maximumFractionDigits: 0 }) + " so'm";
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function lastNMonths(n) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    out.push(`${y}-${m}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function _monthDateRange(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const start = `${monthStr}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${monthStr}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function _nextNMonths(n) {
  const out = [];
  const d = new Date();
  for (let i = 1; i <= n; i++) {
    d.setMonth(d.getMonth() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    out.push(`${y}-${m}`);
  }
  return out;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.detail || body.error || `Xato: ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

// ============================================================
// UMUMIY YORDAMCHI UI: tasdiqlash oynasi, parol oynasi, nusxalash
// ============================================================

function showAmountChoiceModal(title, message, autoAmount, onConfirm) {
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal-box">
        <h3>${title}</h3>
        <div class="modal-message">${message}</div>
        <div class="amount-choice-row">
          <label class="amount-choice-option">
            <input type="radio" name="amountMode" value="auto" checked />
            <span>Avtomatik hisoblangan: <b>${fmt(autoAmount)}</b></span>
          </label>
          <label class="amount-choice-option">
            <input type="radio" name="amountMode" value="manual" />
            <span>Qo'lda kiritish</span>
          </label>
        </div>
        <input type="text" inputmode="numeric" id="amountChoiceManualInput" placeholder="Summani kiriting" style="display:none;" />
        <div class="modal-actions">
          <button class="secondary" id="modalCancel">Bekor qilish</button>
          <button class="primary danger" id="modalOk">Ha, tasdiqlayman</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);

  const manualInput = overlay.querySelector("#amountChoiceManualInput");
  _attachMoneyFormatting(manualInput);
  overlay.querySelectorAll('input[name="amountMode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      manualInput.style.display = radio.value === "manual" && radio.checked ? "block" : "none";
      if (radio.value === "manual" && radio.checked && !manualInput.value) {
        manualInput.value = _formatThousands(String(Math.round(autoAmount)));
      }
    });
  });

  overlay.querySelector("#modalCancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#modalOk").addEventListener("click", () => {
    const mode = overlay.querySelector('input[name="amountMode"]:checked').value;
    const manualAmount = mode === "manual" ? _parseFormattedNumber(manualInput.value) : null;
    overlay.remove();
    onConfirm(manualAmount);
  });
}

function showToast(message, type = "info") {
  // Brauzerning odatiy alert() o'rniga — bloklamaydigan mini-bildirishnoma.
  const toast = el(`<div class="app-toast app-toast-${type}">${message}</div>`);
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("app-toast-visible"));
  setTimeout(() => {
    toast.classList.remove("app-toast-visible");
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function safeAlert(message, type = "info") {
  showToast(message, type);
}

function showTextPromptModal(title, placeholder, onSubmit) {
  // Brauzerning odatiy prompt() o'rniga — yaxshiroq uslub va nazorat uchun.
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal-box">
        <h3>${title}</h3>
        <textarea id="textPromptInput" rows="3" placeholder="${placeholder || ""}" style="width:100%;box-sizing:border-box;"></textarea>
        <div class="modal-actions">
          <button class="secondary" id="modalCancel">Bekor qilish</button>
          <button class="primary danger" id="modalOk">Tasdiqlash</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  overlay.querySelector("#modalCancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#modalOk").addEventListener("click", () => {
    const text = overlay.querySelector("#textPromptInput").value.trim();
    overlay.remove();
    onSubmit(text || null);
  });
}

function showConfirm(title, message, onConfirm) {
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal-box">
        <h3>${title}</h3>
        <div class="modal-message">${message}</div>
        <div class="modal-actions">
          <button class="secondary" id="modalCancel">Bekor qilish</button>
          <button class="primary danger" id="modalOk">Ha, tasdiqlayman</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  overlay.querySelector("#modalCancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#modalOk").addEventListener("click", () => {
    overlay.remove();
    onConfirm();
  });
}

function showSuccessModal(title, message) {
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal-box">
        <h3>${title}</h3>
        <div class="modal-message">${message}</div>
        <div class="modal-actions">
          <button class="primary" id="modalOk">Yopish</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  overlay.querySelector("#modalOk").addEventListener("click", () => overlay.remove());
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (e) { /* jim */ }
  ta.remove();
}

function showPasswordModal(password, name) {
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal-box">
        <h3>${name ? name + " uchun parol" : "Yangi parol"}</h3>
        <div class="modal-message">
          <p style="font-size:13px;color:var(--hint);margin-top:0;">
            Bu parolni xodimga yetkazing — u o'z logini bilan birga tizimga kirishda ishlatiladi.
            Parol shu yerda faqat <b>bir marta</b> ko'rsatiladi — keyinroq qayta ko'rish imkoni yo'q.
          </p>
          <input readonly value="${password}" id="pwInput" onclick="this.select()" />
        </div>
        <div class="modal-actions">
          <button class="secondary" id="modalClose">Yopish</button>
          <button class="primary" id="modalCopy">Nusxalash</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  overlay.querySelector("#modalClose").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#modalCopy").addEventListener("click", () => {
    copyText(password);
    overlay.querySelector("#modalCopy").textContent = "✅ Nusxalandi";
  });
}

// ============================================================
// APP SHELL — chap tomondagi doimiy menyu (sidebar) + kontent maydoni.
// Barcha rollar (Teacher, SubjectTeacher, Staff, Admin, EduManager) shu
// bitta komponentdan foydalanadi — faqat items/dispatch/hero farqlanadi.
// ============================================================

// "Profilim" har bir rolda bo'ladi — shu sabab u shell darajasida qo'shiladi,
// har bir rolning o'z ro'yxatiga alohida yozilmaydi.
const MY_PROFILE_NAV_ITEM = { id: "myprofile", icon: "⚙️", label: "Profilim" };

// Topshiriqlar ro'yxati ochilganda qo'ng'iroqcha hisoblagichini yangilash uchun
let _refreshUnreadBell = () => {};
let _unreadBellTimer = null;

// Bildirishnomadan kelinganda ochilishi kerak bo'lgan topshiriq:
// {taskId, subtab} — Topshiriqlar bo'limi yuklangach shu kartochkaga o'tadi.
let _pendingTaskFocus = null;

function renderSidebarShell(me, { items, activeId, dispatch, heroIcon, heroGradient, heroLabel }) {
  document.body.classList.add("shell-active");
  appEl.classList.add("shell-mode");
  appEl.innerHTML = "";

  const navItems = [...items, MY_PROFILE_NAV_ITEM];
  const dispatchTab = (tab, contentBox, currentMe) => {
    if (tab === MY_PROFILE_NAV_ITEM.id) return renderMyProfileTab(contentBox, currentMe);
    return dispatch(tab, contentBox, currentMe);
  };

  const theme = getTheme();
  const shell = el(`
    <div class="app-shell">
      <div class="sidebar-overlay" id="sidebarOverlay"></div>
      <aside class="sidebar" id="appSidebar">
        <div class="sidebar-brand">
          <span class="sidebar-brand-mark">🏫</span>
          <span>English House</span>
        </div>
        <div class="sidebar-user">
          <div class="sidebar-user-avatar" style="background:${heroGradient};">${heroIcon}</div>
          <div>
            <div class="sidebar-user-name">${me.full_name}</div>
            <div class="sidebar-user-role">${heroLabel}</div>
          </div>
        </div>
        <nav class="sidebar-nav">
          ${navItems.map((it) => `
            <button class="sidebar-item${it.id === activeId ? " active" : ""}" data-tab="${it.id}">
              <span class="sidebar-icon">${it.icon}</span>
              <span class="sidebar-label">${it.label}</span>
            </button>
          `).join("")}
        </nav>
        <div class="sidebar-footer">
          <button class="sidebar-action" id="themeToggleBtn">
            <span class="sidebar-icon" id="themeToggleIcon">${theme === "dark" ? "☀️" : "🌙"}</span>
            <span class="sidebar-label" id="themeToggleLabel">${theme === "dark" ? "Kunduzgi rejim" : "Tungi rejim"}</span>
          </button>
          <button class="sidebar-action" id="sidebarLogoutBtn">
            <span class="sidebar-icon">⎋</span>
            <span class="sidebar-label">Chiqish</span>
          </button>
        </div>
      </aside>
      <div class="app-content">
        <header class="app-topbar">
          <button class="icon-btn" id="sidebarOpenBtn" title="Menyu">☰</button>
          <span class="app-topbar-brand">🏫 English House</span>
          <span class="app-topbar-spacer"></span>
          <div class="notif-wrap">
            <button class="notif-bell" id="notifBell" title="Bildirishnomalar">
              🔔<span class="notif-badge" id="notifBadge"></span>
            </button>
            <div class="notif-panel" id="notifPanel" hidden>
              <div class="notif-panel-head">
                <span>Bildirishnomalar</span>
                <button class="notif-mark-all" id="notifMarkAll">Barchasini o'qilgan deb belgilash</button>
              </div>
              <div class="notif-list" id="notifList"></div>
            </div>
          </div>
        </header>
        <main class="app-main">
          <div class="app-main-inner" id="shellContent"></div>
        </main>
      </div>
    </div>
  `);
  appEl.appendChild(shell);

  const contentBox = shell.querySelector("#shellContent");
  const sidebar = shell.querySelector("#appSidebar");

  function closeMobileSidebar() {
    shell.classList.remove("sidebar-open");
  }

  shell.querySelector("#sidebarOpenBtn").addEventListener("click", () => shell.classList.add("sidebar-open"));
  shell.querySelector("#sidebarOverlay").addEventListener("click", closeMobileSidebar);

  shell.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      shell.querySelectorAll("[data-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      closeMobileSidebar();
      dispatchTab(btn.dataset.tab, contentBox, me);
    });
  });

  shell.querySelector("#themeToggleBtn").addEventListener("click", () => {
    const t = toggleTheme();
    shell.querySelector("#themeToggleIcon").textContent = t === "dark" ? "☀️" : "🌙";
    shell.querySelector("#themeToggleLabel").textContent = t === "dark" ? "Kunduzgi rejim" : "Tungi rejim";
  });

  shell.querySelector("#sidebarLogoutBtn").addEventListener("click", async () => {
    try { await api("/api/logout", { method: "POST" }); } catch (e) { /* baribir chiqamiz */ }
    window.location.href = "/";
  });

  // ---- Qo'ng'iroqcha va bildirishnomalar ro'yxati ----
  const bell = shell.querySelector("#notifBell");
  const badge = shell.querySelector("#notifBadge");
  const panel = shell.querySelector("#notifPanel");
  const list = shell.querySelector("#notifList");

  function setBadge(n) {
    badge.textContent = n > 99 ? "99+" : String(n);
    bell.classList.toggle("has-unread", n > 0);
    bell.title = n > 0 ? `${n} ta yangi bildirishnoma` : "Bildirishnomalar";
  }

  async function refreshUnreadBell() {
    try {
      const res = await api("/api/notifications/unread-count");
      setBadge(res.count || 0);
    } catch (e) {
      // hisoblagichni olib bo'lmasa ham ilova ishlayversin
    }
  }

  function openTaskFromNotification(item) {
    _pendingTaskFocus = { taskId: item.task_id, subtab: item.subtab };
    const tasksBtn = shell.querySelector('[data-tab="tasks"]');
    if (tasksBtn) tasksBtn.click();
  }

  async function loadNotifications() {
    list.innerHTML = `<div class="center-box" style="min-height:90px;"><div class="spinner"></div></div>`;
    try {
      const res = await api("/api/notifications");
      setBadge(res.unread_count || 0);

      if (!res.items.length) {
        list.innerHTML = `<div class="notif-empty">Hozircha bildirishnoma yo'q</div>`;
        return;
      }

      list.innerHTML = res.items.map((it) => {
        const who = it.from_full_name;
        const num = it.task_number ? `№${it.task_number}` : `topshiriq`;
        const title = it.type === "comment"
          ? `<b>${who}</b> sizning ${num} topshirig'ingizga izoh yozdi`
          : `<b>${who}</b> sizga yangi topshiriq berdi (${num})`;
        return `
          <button class="notif-item${it.is_unread ? " notif-item-unread" : ""}" data-notif="${it.id}">
            <span class="notif-item-icon">${it.type === "comment" ? "💬" : it.urgent ? "🔴" : "📋"}</span>
            <span class="notif-item-body">
              <span class="notif-item-title">${title}</span>
              <span class="notif-item-preview">${it.preview || ""}</span>
              <span class="notif-item-time">${_formatTaskCreatedAt(it.created_at)}</span>
            </span>
          </button>
        `;
      }).join("");

      list.querySelectorAll("[data-notif]").forEach((btn) => {
        const item = res.items.find((x) => x.id === btn.dataset.notif);
        btn.addEventListener("click", async () => {
          panel.hidden = true;
          try {
            const r = await api("/api/notifications/read", {
              method: "POST",
              body: JSON.stringify(
                item.type === "comment"
                  ? { type: "comment", comment_id: item.comment_id }
                  : { type: "task", task_id: item.task_id }
              ),
            });
            setBadge(r.unread_count || 0);
          } catch (e) { /* belgilay olmasak ham ochaveramiz */ }
          openTaskFromNotification(item);
        });
      });
    } catch (err) {
      list.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) loadNotifications();
  });

  panel.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => { panel.hidden = true; });

  shell.querySelector("#notifMarkAll").addEventListener("click", async () => {
    try {
      await api("/api/notifications/read-all", { method: "POST" });
      setBadge(0);
      loadNotifications();
    } catch (err) {
      safeAlert("Xato: " + err.message);
    }
  });

  // Topshiriqlar ro'yxati ochilganda hisoblagich darhol tozalansin
  _refreshUnreadBell = refreshUnreadBell;
  if (_unreadBellTimer) clearInterval(_unreadBellTimer);
  _unreadBellTimer = setInterval(refreshUnreadBell, 60000);
  refreshUnreadBell();

  dispatchTab(activeId, contentBox, me);
}

// ============================================================
// PROFILIM — har bir xodim o'z login va parolini shu yerdan o'zgartiradi
// ============================================================

const ROLE_LABELS = {
  CEO: "Bosh direktor",
  Director: "Direktor",
  EduManager: "Ta'lim menejeri",
  Teacher: "O'qituvchi",
  SubjectTeacher: "Fan o'qituvchisi",
  Administrator: "Administrator",
  SalesManager: "Sotuv menejeri",
};

async function renderMyProfileTab(box, me) {
  box.innerHTML = `
    <h2>⚙️ Profilim</h2>
    <div class="card">
      <div class="row"><span class="label">Ism familiya</span><span class="value">${me.full_name}</span></div>
      <div class="row"><span class="label">Lavozim</span><span class="value">${ROLE_LABELS[me.role] || me.role}</span></div>
      <div class="row"><span class="label">Joriy login</span><span class="value" id="mpCurrentLogin">...</span></div>
    </div>

    <h2>🔑 Login va parolni o'zgartirish</h2>
    <div class="card">
      <p style="font-size:13px;color:var(--hint);margin-top:0;">
        Xavfsizlik uchun avval joriy parolingizni kiriting. Keyin faqat o'zgartirmoqchi
        bo'lgan maydonni to'ldiring — qolgani bo'sh qolsa, o'zgarmaydi.
      </p>

      <label>Joriy parol</label>
      <input id="mpCurrentPw" type="password" autocomplete="current-password" />

      <label>Yangi login</label>
      <input id="mpNewLogin" type="text" autocomplete="username" placeholder="Bo'sh qoldirsangiz, o'zgarmaydi" />

      <label>Yangi parol</label>
      <input id="mpNewPw" type="password" autocomplete="new-password" placeholder="Bo'sh qoldirsangiz, o'zgarmaydi" />

      <label>Yangi parolni takrorlang</label>
      <input id="mpNewPw2" type="password" autocomplete="new-password" />

      <button class="primary" id="mpSaveBtn">Saqlash</button>
      <div id="mpMsg" style="margin-top:8px;font-size:13px;"></div>
    </div>
  `;

  const loginEl = box.querySelector("#mpCurrentLogin");
  try {
    const p = await api("/api/me/profile");
    loginEl.textContent = p.login || p.teacher_id;
  } catch (err) {
    loginEl.textContent = "—";
  }

  box.querySelector("#mpSaveBtn").addEventListener("click", async () => {
    const msg = box.querySelector("#mpMsg");
    const currentPw = box.querySelector("#mpCurrentPw").value;
    const newLogin = box.querySelector("#mpNewLogin").value.trim();
    const newPw = box.querySelector("#mpNewPw").value;
    const newPw2 = box.querySelector("#mpNewPw2").value;

    if (!currentPw) {
      msg.innerHTML = `<span class="badge warn">❌ Joriy parolni kiriting</span>`;
      return;
    }
    if (!newLogin && !newPw) {
      msg.innerHTML = `<span class="badge warn">❌ Yangi login yoki yangi parolni kiriting</span>`;
      return;
    }
    if (newPw && newPw !== newPw2) {
      msg.innerHTML = `<span class="badge warn">❌ Yangi parollar mos kelmadi</span>`;
      return;
    }

    msg.textContent = "Saqlanmoqda...";
    try {
      const res = await api("/api/me/credentials", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPw,
          login: newLogin || null,
          new_password: newPw || null,
        }),
      });
      loginEl.textContent = res.login;
      box.querySelectorAll("#mpCurrentPw, #mpNewLogin, #mpNewPw, #mpNewPw2").forEach((i) => { i.value = ""; });
      msg.innerHTML = `<span class="badge ok">✅ Saqlandi. Keyingi safar yangi ma'lumotlar bilan kiring.</span>`;
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
    }
  });
}

// ============================================================
// BOOT
// ============================================================

async function boot() {
  try {
    const me = await api("/api/auth", { method: "POST" });
    await renderTestModeBanner();
    if (me.role === "Teacher") {
      renderTeacherView(me);
    } else if (me.role === "SubjectTeacher") {
      renderSubjectTeacherView(me);
    } else if (me.role === "Administrator" || me.role === "SalesManager") {
      renderStaffView(me);
    } else {
      renderAdminView(me);
    }
  } catch (err) {
    if (err.status === 401) {
      // Sessiya yo'q yoki tugagan — login sahifasiga yo'naltiramiz
      window.location.href = "/login";
      return;
    }
    appEl.innerHTML = "";
    appEl.appendChild(el(`
      <div class="error-box">
        <b>Kirish rad etildi</b><br/>
        ${err.message}
      </div>
    `));
  }
}

async function renderTestModeBanner() {
  try {
    const status = await api("/api/me/test-mode-status");
    const existing = document.getElementById("testModeBanner");
    if (existing) existing.remove();

    if (status.in_test_mode) {
      const banner = el(`
        <div id="testModeBanner" class="test-mode-banner">
          <span>🧪 Sinov rejimi: <b>${status.original_role}</b> (${status.original_full_name}) sifatida asl hisob kutmoqda</span>
          <button id="exitTestModeBtn">Asl hisobga qaytish</button>
        </div>
      `);
      document.body.insertBefore(banner, appEl);
      banner.querySelector("#exitTestModeBtn").addEventListener("click", async () => {
        try {
          await api("/api/admin/exit-test-mode", { method: "POST" });
          window.location.reload();
        } catch (err) {
          safeAlert("Xato: " + err.message);
        }
      });
    }
  } catch (err) {
    // sinov holatini tekshirib bo'lmasa ham, asosiy ilova ishlashda davom etsin
  }
}

// ============================================================
// TEACHER VIEW — menyu asosida: Teacher / KPI / Ish haqi
// ============================================================

const TEACHER_NAV_ITEMS = [
  { id: "teacher", icon: "🧑‍🏫", label: "Teacher" },
  { id: "kpi", icon: "📊", label: "KPI" },
  { id: "salary", icon: "💰", label: "Ish haqi" },
  { id: "tasks", icon: "📋", label: "Topshiriqlar" },
  { id: "rules", icon: "📜", label: "Asosiy qoidalar" },
];

function renderTeacherView(me) {
  renderSidebarShell(me, {
    items: TEACHER_NAV_ITEMS,
    activeId: "teacher",
    dispatch: renderTeacherTab,
    heroIcon: "🧑‍🏫",
    heroGradient: "var(--primary-grad)",
    heroLabel: `${me.grade ? me.grade + " · " : ""}${me.role}`,
  });
}

function renderTeacherTab(tab, box, me) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  if (tab === "teacher") renderTeacherProfileSection(box);
  else if (tab === "kpi") renderTeacherKpiSection(box);
  else if (tab === "salary") renderTeacherSalarySection(box);
  else if (tab === "tasks") renderTasksTab(box, me);
  else if (tab === "rules") renderKpiRulesTab(box);
}

function _monthSelectHtml(id) {
  return `
    <div class="month-picker">
      <label style="margin:0;">Oy:</label>
      <select id="${id}">
        ${lastNMonths(6).map((m) => `<option value="${m}">${m}</option>`).join("")}
      </select>
    </div>
  `;
}

async function renderTeacherProfileSection(box) {
  box.innerHTML = `
    <h2>🧑‍🏫 Teacher</h2>
    ${_monthSelectHtml("tpMonth")}
    <div id="tpResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;
  const select = box.querySelector("#tpMonth");

  async function load() {
    const resultBox = box.querySelector("#tpResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const p = await api("/api/me/profile");
      resultBox.innerHTML = `
        <div class="card">
          <div class="row"><span class="label">Oy</span><span class="value">${select.value}</span></div>
          <div class="row"><span class="label">Ism familiya</span><span class="value">${p.full_name}</span></div>
          <div class="row"><span class="label">Grade</span><span class="value">${p.grade || "-"}</span></div>
          <div class="row"><span class="label">Stavka</span><span class="value">${p.workload_rate}</span></div>
        </div>
        <div class="total-box">
          <div class="caption">Fix summasi (stavkaga nisbatan)</div>
          <div class="amount">${fmt(p.fix)}</div>
        </div>
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  select.addEventListener("change", load);
  load();
}

async function renderTeacherKpiSection(box) {
  box.innerHTML = `
    <h2>📊 KPI</h2>
    ${_monthSelectHtml("tkMonth")}
    <div id="tkResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;
  const select = box.querySelector("#tkMonth");

  async function load() {
    const resultBox = box.querySelector("#tkResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const d = await api(`/api/me/payroll?month=${select.value}`);

      if (!d.kpi_available) {
        resultBox.innerHTML = `
          <div class="card">
            <p style="color:var(--hint);font-size:13px;margin:0;">
              📋 ${d.month} uchun hali Scorecard kiritilmagan. KPI ma'lumotlari kiritilgach shu yerda ko'rinadi.
            </p>
          </div>
        `;
        return;
      }

      const gateHtml = d.gate_notes.length
        ? d.gate_notes.map((n) => `<div class="gate-warning">⚠️ ${n}</div>`).join("")
        : "";
      resultBox.innerHTML = `
        <div class="total-box">
          <div class="caption">${d.month} — Umumiy KPI foizi</div>
          <div class="amount">${d.effective_kpi_percent}%</div>
          <div style="font-size:12px;opacity:0.85;margin-top:4px;">Ball: ${d.kpi_percent}% (KPI fondidan)</div>
        </div>
        ${gateHtml}
        <div class="card">
          <div class="row"><span class="label">Retention (${d.raw_scores.retention ?? "-"}%)</span><span class="value">${d.breakdown.retention.toFixed(1)} / 25</span></div>
          <div class="row"><span class="label">Student Progress (${d.raw_scores.progress ?? "-"}%)</span><span class="value">${d.breakdown.progress.toFixed(1)} / 25</span></div>
          <div class="row"><span class="label">Attendance (${d.raw_scores.attendance ?? "-"}%)</span><span class="value">${d.breakdown.attendance.toFixed(1)} / 10</span></div>
          <div class="row"><span class="label">Homework (${d.raw_scores.homework ?? "-"}%)</span><span class="value">${d.breakdown.homework.toFixed(1)} / 10</span></div>
          <div class="row"><span class="label">Observation (${d.raw_scores.observation ?? "-"}/25)</span><span class="value">${d.breakdown.observation.toFixed(1)} / 15</span></div>
          <div class="row"><span class="label">Student Feedback (${d.raw_scores.feedback ?? "-"}/10)</span><span class="value">${d.breakdown.feedback.toFixed(1)} / 10</span></div>
          <div class="row"><span class="label">Platforma intizomi (${d.raw_scores.lms ?? "-"}/5)</span><span class="value">${d.breakdown.lms.toFixed(1)} / 5</span></div>
        </div>
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  select.addEventListener("change", load);
  load();
}

async function renderTeacherSalarySection(box) {
  box.innerHTML = `
    <h2>💰 Ish haqi</h2>
    ${_monthSelectHtml("tsMonth")}
    <div id="tsResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;
  const select = box.querySelector("#tsMonth");

  async function load() {
    const resultBox = box.querySelector("#tsResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const d = await api(`/api/me/payroll?month=${select.value}`);
      const kpiNote = !d.kpi_available
        ? `<p style="font-size:11px;color:var(--hint);margin:8px 0 0;">⚠️ Bu oy uchun hali Scorecard kiritilmagan, shuning uchun KPI summasi 0 deb hisoblangan — Scorecard kiritilgach yakuniy summa yangilanadi.</p>`
        : "";
      resultBox.innerHTML = `
        <div class="total-box">
          <div class="caption">${d.month} — Yakuniy hisob-kitob (Rashchyot)${d.is_settled ? " (to\'landi)" : ""}</div>
          <div class="amount">${d.is_settled ? fmt(d.settled_amount) : fmt(d.rashchyot)}</div>
        </div>
        <div class="card">
          <div class="row"><span class="label">Fix summa</span><span class="value">${fmt(d.fix)}</span></div>
          <div class="row"><span class="label">Avans</span><span class="value" style="color:var(--red);">-${fmt(d.advance_given)}</span></div>
          <div class="row"><span class="label">KPI summasi</span><span class="value">${d.kpi_available ? fmt(d.kpi_amount) : "—"}</span></div>
          <div class="row"><span class="label">Bonus summasi</span><span class="value">${fmt(d.bonus)}</span></div>
        </div>
        ${kpiNote}
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  select.addEventListener("change", load);
  load();
}

// ============================================================
// STAFF VIEW — Administrator / Sotuv menejeri kabi rollar uchun
// (Teacher menyusiga o'xshash, lekin soddalashtirilgan: 7 mezonli scorecard o'rniga
//  bitta umumiy samaradorlik foizi)
// ============================================================

const STAFF_ROLE_LABELS = {
  Administrator: "Administrator",
  SalesManager: "Sotuv menejeri",
};

function renderStaffView(me) {
  const roleLabel = STAFF_ROLE_LABELS[me.role] || me.role;
  const isSalesManager = me.role === "SalesManager";
  const isAdministrator = me.role === "Administrator";
  const hasDayTab = isSalesManager || isAdministrator;

  const items = [
    ...(hasDayTab ? [{ id: "day", icon: "📅", label: "Kun" }] : []),
    { id: "profile", icon: "👤", label: "Ma'lumotim" },
    { id: "salary", icon: "💰", label: "Ish haqi" },
    { id: "tasks", icon: "📋", label: "Topshiriqlar" },
    ...(isSalesManager ? [{ id: "kpi", icon: "🚀", label: "KPI" }] : []),
  ];

  renderSidebarShell(me, {
    items,
    activeId: items[0].id,
    dispatch: renderStaffTab,
    heroIcon: "🧑‍💼",
    heroGradient: "linear-gradient(135deg, #607d8b, #37474f)",
    heroLabel: roleLabel,
  });
}

function renderStaffTab(tab, box, me) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  if (tab === "profile") renderStaffProfileSection(box, me);
  else if (tab === "salary") renderStaffSalarySection(box, me);
  else if (tab === "kpi") renderSalesManagerOwnKpiTab(box, me);
  else if (tab === "tasks") renderTasksTab(box, me);
  else if (tab === "day") {
    if (me.role === "SalesManager") renderSalesManagerDayTab(box, me);
    else if (me.role === "Administrator") renderAdministratorDayTab(box, me);
  }
}

async function renderStaffProfileSection(box, me) {
  const roleLabel = STAFF_ROLE_LABELS[me.role] || me.role;
  box.innerHTML = `
    <h2>👤 Ma'lumotim</h2>
    <div id="stpResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;
  const resultBox = box.querySelector("#stpResult");
  try {
    const p = await api("/api/me/profile");
    resultBox.innerHTML = `
      <div class="card">
        <div class="row"><span class="label">Ism familiya</span><span class="value">${p.full_name}</span></div>
        <div class="row"><span class="label">Lavozim</span><span class="value">${roleLabel}</span></div>
      </div>
      <div class="total-box">
        <div class="caption">Oylik maosh</div>
        <div class="amount">${fmt(p.fix)}</div>
      </div>
    `;
  } catch (err) {
    resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}

async function renderStaffSalarySection(box, me) {
  box.innerHTML = `
    <h2>💰 Ish haqi</h2>
    ${_monthSelectHtml("stsMonth")}
    <div id="stsResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;
  const select = box.querySelector("#stsMonth");

  async function load() {
    const resultBox = box.querySelector("#stsResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const d = await api(`/api/me/payroll?month=${select.value}`);
      const isSalesManager = me && me.role === "SalesManager";
      resultBox.innerHTML = `
        <div class="total-box">
          <div class="caption">${d.month} — Yakuniy hisob-kitob (Rashchyot)${d.is_settled ? " (to\'landi)" : ""}</div>
          <div class="amount">${d.is_settled ? fmt(d.settled_amount) : fmt(d.rashchyot)}</div>
        </div>
        <div class="card">
          <div class="row"><span class="label">Fix summa${isSalesManager ? " (kunlik ishlangan)" : ""}</span><span class="value">${fmt(d.fix)}</span></div>
          <div class="row"><span class="label">Avans</span><span class="value" style="color:var(--red);">-${fmt(d.advance_given)}</span></div>
          ${isSalesManager ? `<div class="row"><span class="label">KPI summasi</span><span class="value">${d.kpi_available ? fmt(d.kpi_amount) : "—"}</span></div>` : ""}
          <div class="row"><span class="label">Bonus summasi</span><span class="value">${fmt(d.bonus)}</span></div>
        </div>
        ${isSalesManager && d.kpi_available ? _smKpiBreakdownHtml(d.breakdown) : ""}
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  select.addEventListener("change", load);
  load();
}

// ============================================================
// SUBJECT TEACHER VIEW — Fan o'qituvchilari uchun (tushum ulushi asosida)
// ============================================================

const SUBJECT_TEACHER_NAV_ITEMS = [
  { id: "profile", icon: "👤", label: "Ma'lumotim" },
  { id: "salary", icon: "💰", label: "Ish haqi" },
  { id: "tasks", icon: "📋", label: "Topshiriqlar" },
];

function renderSubjectTeacherView(me) {
  renderSidebarShell(me, {
    items: SUBJECT_TEACHER_NAV_ITEMS,
    activeId: "profile",
    dispatch: renderSubjectTeacherTab,
    heroIcon: "📖",
    heroGradient: "linear-gradient(135deg, #8e44ad, #5b2c6f)",
    heroLabel: `${me.subject ? me.subject + " · " : ""}Fan o'qituvchisi`,
  });
}

function renderSubjectTeacherTab(tab, box, me) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  if (tab === "profile") renderSubjectTeacherProfileSection(box);
  else if (tab === "salary") renderSubjectTeacherSalarySection(box);
  else if (tab === "tasks") renderTasksTab(box, me);
}

async function renderSubjectTeacherProfileSection(box) {
  box.innerHTML = `
    <h2>👤 Ma'lumotim</h2>
    <div id="stpResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;
  const resultBox = box.querySelector("#stpResult");
  try {
    const p = await api("/api/me/profile");
    resultBox.innerHTML = `
      <div class="card">
        <div class="row"><span class="label">Ism familiya</span><span class="value">${p.full_name}</span></div>
        <div class="row"><span class="label">Fan</span><span class="value">${p.subject || "-"}</span></div>
        <div class="row"><span class="label">Tushumdan ulush</span><span class="value">${p.revenue_percent ?? "-"}%</span></div>
      </div>
    `;
  } catch (err) {
    resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}

async function renderSubjectTeacherSalarySection(box) {
  box.innerHTML = `
    <h2>💰 Ish haqi</h2>
    ${_monthSelectHtml("stSalaryMonth")}
    <div id="stSalaryResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;
  const select = box.querySelector("#stSalaryMonth");

  async function load() {
    const resultBox = box.querySelector("#stSalaryResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const d = await api(`/api/me/payroll?month=${select.value}`);
      const revenueNote = !d.kpi_available
        ? `<p style="font-size:11px;color:var(--hint);margin:8px 0 0;">⚠️ ${d.month} uchun hali tushum kiritilmagan — kiritilgach ulush summasi hisoblanadi.</p>`
        : "";
      resultBox.innerHTML = `
        <div class="total-box">
          <div class="caption">${d.month} — Yakuniy hisob-kitob (Rashchyot)${d.is_settled ? " (to\'landi)" : ""}</div>
          <div class="amount">${d.is_settled ? fmt(d.settled_amount) : fmt(d.rashchyot)}</div>
        </div>
        <div class="card">
          <div class="row"><span class="label">Ulush foizi</span><span class="value">${d.revenue_percent ?? "-"}%</span></div>
          <div class="row"><span class="label">Oylik tushum</span><span class="value">${d.revenue_amount !== null && d.revenue_amount !== undefined ? fmt(d.revenue_amount) : "—"}</span></div>
          <div class="row"><span class="label">Ulush summasi</span><span class="value">${fmt(d.fix)}</span></div>
          <div class="row"><span class="label">Avans</span><span class="value" style="color:var(--red);">-${fmt(d.advance_given)}</span></div>
          <div class="row"><span class="label">Bonus summasi</span><span class="value">${fmt(d.bonus)}</span></div>
        </div>
        ${revenueNote}
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  select.addEventListener("change", load);
  load();
}

// ============================================================
// SOTUV MENEJERI: KUN (kunlik ish vazifalari)
// ============================================================

function _todayDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const SM_DAILY_FIELDS = [
  { id: "repeat_calls_archive", label: "🔁 Kunlik Arxivdan qayta sotuv qo'ng'iroqlari" },
  { id: "reinvite_count", label: "✉️ Re-invite soni" },
  { id: "new_admissions", label: "🆕 Yangi qabul soni" },
  { id: "trial_booked", label: "📝 Sinov darsiga yozilganlar soni" },
  { id: "trial_attended", label: "🚶 Sinov darsiga kelganlar soni" },
  { id: "activated_count", label: "⚡ Faollashtirilganlar soni" },
  { id: "new_sales", label: "💼 Yangi sotuv soni" },
  { id: "waiting_contact_count", label: "☎️ Kutishda turganlar bilan aloqa soni" },
];

// calc_sales_manager_daily formulasining frontend nusxasi (jonli oldindan ko'rish uchun)
function _smScoreRepeatCallsPercent(count) {
  const c = count || 0;
  if (c >= 25) return 0.30;
  if (c >= 20) return 0.25;
  if (c >= 15) return 0.20;
  if (c >= 10) return 0.10;
  if (c >= 5) return 0.05;
  return 0.0;
}

function _smCalcDaily(dayFix, repeatCalls, waitingContacted, maxWaiting, reinviteCount) {
  const REINVITE_TARGET = 2.5;
  const repeatPct = _smScoreRepeatCallsPercent(repeatCalls);
  const repeatAmount = dayFix * repeatPct;

  const wc = waitingContacted || 0;
  let waitingPct;
  if (maxWaiting > 0) waitingPct = Math.min(1, wc / maxWaiting);
  else waitingPct = wc === 0 ? 1 : 0;
  const waitingAmount = dayFix * 0.50 * waitingPct;

  const ri = reinviteCount || 0;
  const reinvitePct = Math.min(1, ri / REINVITE_TARGET);
  const reinviteAmount = dayFix * 0.20 * reinvitePct;

  return {
    repeatAmount, waitingAmount, reinviteAmount,
    total: repeatAmount + waitingAmount + reinviteAmount,
    repeatPct: repeatPct * 100, waitingPct: waitingPct * 100, reinvitePct: reinvitePct * 100,
  };
}

async function renderSalesManagerDayTab(box, me) {
  const today = _todayDateStr();
  box.innerHTML = `
    <div class="card">
      <label>Sana</label>
      <input type="date" id="smDateInput" value="${today}" max="${today}" />
    </div>
    <div id="smDayContent"><div class="center-box"><div class="spinner"></div></div></div>
  `;

  const dateInput = box.querySelector("#smDateInput");
  const contentBox = box.querySelector("#smDayContent");

  dateInput.addEventListener("change", () => loadSalesManagerDay(contentBox, me, dateInput.value));
  await loadSalesManagerDay(contentBox, me, today);
}

async function loadSalesManagerDay(box, me, selectedDate) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;

  try {
    const res = await api(`/api/sales-manager-daily/me?date=${selectedDate}`);
    const data = res.data || {};
    const status = data.status || null;
    const isLocked = status === "pending" || status === "approved";
    const isToday = selectedDate === _todayDateStr();

    const fieldsHtml = SM_DAILY_FIELDS.map((f) => `
      <div class="sc-field">
        <label>${f.label}</label>
        <input id="sm_${f.id}" type="number" step="1" min="0" value="${data[f.id] ?? ""}" ${isLocked ? "disabled" : ""} />
      </div>
    `).join("");

    let statusBannerHtml = "";
    if (status === "pending") {
      statusBannerHtml = `
        <div class="sm-status-banner sm-status-pending">
          <span class="sm-status-spinner"></span>
          <span>Jarayonda — Direktor tomonidan ko'rib chiqilmoqda</span>
        </div>`;
    } else if (status === "approved") {
      statusBannerHtml = `
        <div class="sm-status-banner sm-status-approved">
          <span>✅ Tasdiqlandi</span>
        </div>`;
    } else if (status === "rejected") {
      statusBannerHtml = `
        <div class="sm-status-banner sm-status-rejected">
          <span>❌ Otkaz qilindi${data.rejection_note ? ": " + data.rejection_note : ""} — ma'lumotlarni tahrirlab qayta yuboring</span>
        </div>`;
    }

    box.innerHTML = `
      <h2>📅 ${selectedDate}</h2>

      ${isToday ? `
        <div class="sm-reminder-card">
          <div class="sm-reminder-title">👋 Hurmatli ${me.full_name.split(" ")[0]}, bugungi ishlar:</div>
          <div class="sm-reminder-item">1. Kunlik Arxivdan qayta sotuv qo'ng'iroqlari — <b>${res.targets.repeat_calls_archive}</b></div>
          <div class="sm-reminder-item">2. Kutishda turganlar bilan aloqa soni — <b>${res.targets.waiting_contact_count}</b></div>
          <div class="sm-reminder-item">3. Re-invite — <b>${Math.floor(res.targets.reinvite_count)}</b></div>
          <div class="sm-reminder-item">4. Kunlik ma'lumotlarni to'ldirish</div>
        </div>
      ` : `
        <p style="font-size:12px;color:var(--hint);">O'tgan kun uchun majburiyatlar: qo'ng'iroqlar — <b>${res.targets.repeat_calls_archive}</b>, kutishdagilar — <b>${res.targets.waiting_contact_count}</b>, re-invite — <b>${Math.floor(res.targets.reinvite_count)}</b></p>
      `}

      <p style="font-size:11px;color:var(--hint);margin:-4px 0 10px;">
        💡 Bu ma'lumotlar KPI (bonus)ingizga oy oxirida avtomatik hisobga olinadi — batafsilini Scorecard bo'limidan ko'rishingiz mumkin.
      </p>

      ${statusBannerHtml}

      <div class="card sc-form">
        ${fieldsHtml}
      </div>

      ${!isLocked ? `
        <button class="primary" id="smSaveBtn">💾 Saqlash</button>
        <button class="secondary" id="smSubmitBtn">📤 Yuborish</button>
        <div id="smMsg" style="margin-top:8px;font-size:13px;"></div>
      ` : ""}
    `;

    if (!isLocked) {
      box.querySelector("#smSaveBtn").addEventListener("click", async () => {
        const msg = box.querySelector("#smMsg");
        msg.textContent = "Saqlanmoqda...";
        try {
          const body = { date: selectedDate };
          SM_DAILY_FIELDS.forEach((f) => {
            const v = parseFloat(box.querySelector(`#sm_${f.id}`).value);
            body[f.id] = isNaN(v) ? null : v;
          });
          await api("/api/sales-manager-daily/me", { method: "POST", body: JSON.stringify(body) });
          msg.innerHTML = `<span class="badge ok">✅ Saqlandi (qoralama)</span>`;
        } catch (err) {
          msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
        }
      });

      box.querySelector("#smSubmitBtn").addEventListener("click", () => {
        showConfirm(
          "Ma'lumotlarni yuborish",
          `<b>${selectedDate}</b> kuni uchun ma'lumotlar Direktorga ko'rib chiqish uchun yuborilsinmi? Yuborilgandan so'ng Direktor tasdiqlamaguncha tahrirlab bo'lmaydi.`,
          async () => {
            const msg = box.querySelector("#smMsg");
            msg.textContent = "Yuborilmoqda...";
            try {
              const body = { date: selectedDate };
              SM_DAILY_FIELDS.forEach((f) => {
                const v = parseFloat(box.querySelector(`#sm_${f.id}`).value);
                body[f.id] = isNaN(v) ? null : v;
              });
              await api("/api/sales-manager-daily/me", { method: "POST", body: JSON.stringify(body) });
              await api("/api/sales-manager-daily/me/submit", { method: "POST", body: JSON.stringify({ date: selectedDate }) });
              loadSalesManagerDay(box, me, selectedDate);
            } catch (err) {
              msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
            }
          }
        );
      });
    }
  } catch (err) {
    box.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}

// ============================================================
// ADMINISTRATOR: KUN (kunlik ish vazifalari)
// ============================================================

const CHURN_REASON_OPTIONS = ["Narx", "Sifat", "Jadval mos kelmasligi", "Ko'chib ketish", "Boshqa"];

const ADMIN_DAILY_FIELDS = [
  { id: "admin_contacted_clients", label: "📞 Mijozlar bilan bog'lanish soni", type: "number" },
  { id: "risky_contacted_count", label: "☎️ Xavfli o'quvchilar bilan aloqa soni", type: "number" },
  { id: "frozen_count", label: "🧊 Muzlatilgan o'quvchilar soni", type: "number" },
  { id: "frozen_reason", label: "🧊 Muzlatish sababi (agar bo'lsa)", type: "select" },
  { id: "left_count", label: "🚪 Chiqib ketgan o'quvchilar soni", type: "number" },
  { id: "left_reason", label: "🚪 Chiqib ketish sababi (agar bo'lsa)", type: "select" },
  { id: "complaints_count", label: "😠 Mijoz shikoyatlari soni", type: "number" },
];

async function renderAdministratorDayTab(box, me) {
  const today = _todayDateStr();
  box.innerHTML = `
    <div class="card">
      <label>Sana</label>
      <input type="date" id="admDateInput" value="${today}" max="${today}" />
    </div>
    <div id="admDayContent"><div class="center-box"><div class="spinner"></div></div></div>
  `;

  const dateInput = box.querySelector("#admDateInput");
  const contentBox = box.querySelector("#admDayContent");

  dateInput.addEventListener("change", () => loadAdministratorDay(contentBox, me, dateInput.value));
  await loadAdministratorDay(contentBox, me, today);
}

async function loadAdministratorDay(box, me, selectedDate) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;

  try {
    const res = await api(`/api/administrator-daily/me?date=${selectedDate}`);
    const data = res.data || {};
    const status = data.status || null;
    const isLocked = status === "pending" || status === "approved";

    const fieldsHtml = ADMIN_DAILY_FIELDS.map((f) => {
      if (f.type === "select") {
        return `
          <div class="sc-field">
            <label>${f.label}</label>
            <select id="adm_${f.id}" ${isLocked ? "disabled" : ""}>
              <option value="">-</option>
              ${CHURN_REASON_OPTIONS.map((opt) => `<option value="${opt}" ${data[f.id] === opt ? "selected" : ""}>${opt}</option>`).join("")}
            </select>
          </div>
        `;
      }
      return `
        <div class="sc-field">
          <label>${f.label}</label>
          <input id="adm_${f.id}" type="number" step="1" min="0" value="${data[f.id] ?? ""}" ${isLocked ? "disabled" : ""} />
        </div>
      `;
    }).join("");

    let statusBannerHtml = "";
    if (status === "pending") {
      statusBannerHtml = `
        <div class="sm-status-banner sm-status-pending">
          <span class="sm-status-spinner"></span>
          <span>Jarayonda — Direktor tomonidan ko'rib chiqilmoqda</span>
        </div>`;
    } else if (status === "approved") {
      statusBannerHtml = `<div class="sm-status-banner sm-status-approved"><span>✅ Tasdiqlandi</span></div>`;
    } else if (status === "rejected") {
      statusBannerHtml = `
        <div class="sm-status-banner sm-status-rejected">
          <span>❌ Otkaz qilindi${data.rejection_note ? ": " + data.rejection_note : ""} — ma'lumotlarni tahrirlab qayta yuboring</span>
        </div>`;
    }

    box.innerHTML = `
      <h2>📅 ${selectedDate}</h2>
      ${statusBannerHtml}
      <div class="card sc-form">${fieldsHtml}</div>
      ${!isLocked ? `
        <button class="primary" id="admSaveBtn">💾 Saqlash</button>
        <button class="secondary" id="admSubmitBtn">📤 Yuborish</button>
        <div id="admMsg" style="margin-top:8px;font-size:13px;"></div>
      ` : ""}
    `;

    if (!isLocked) {
      function collectBody() {
        const body = { date: selectedDate };
        ADMIN_DAILY_FIELDS.forEach((f) => {
          const el = box.querySelector(`#adm_${f.id}`);
          if (f.type === "select") {
            body[f.id] = el.value || null;
          } else {
            const v = parseFloat(el.value);
            body[f.id] = isNaN(v) ? null : v;
          }
        });
        return body;
      }

      box.querySelector("#admSaveBtn").addEventListener("click", async () => {
        const msg = box.querySelector("#admMsg");
        msg.textContent = "Saqlanmoqda...";
        try {
          await api("/api/administrator-daily/me", { method: "POST", body: JSON.stringify(collectBody()) });
          msg.innerHTML = `<span class="badge ok">✅ Saqlandi (qoralama)</span>`;
        } catch (err) {
          msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
        }
      });

      box.querySelector("#admSubmitBtn").addEventListener("click", () => {
        showConfirm(
          "Ma'lumotlarni yuborish",
          `<b>${selectedDate}</b> kuni uchun ma'lumotlar Direktorga ko'rib chiqish uchun yuborilsinmi?`,
          async () => {
            const msg = box.querySelector("#admMsg");
            msg.textContent = "Yuborilmoqda...";
            try {
              await api("/api/administrator-daily/me", { method: "POST", body: JSON.stringify(collectBody()) });
              await api("/api/administrator-daily/me/submit", { method: "POST", body: JSON.stringify({ date: selectedDate }) });
              loadAdministratorDay(box, me, selectedDate);
            } catch (err) {
              msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
            }
          }
        );
      });
    }
  } catch (err) {
    box.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}

// ============================================================
// EDU MANAGER: KUN (kunlik ish vazifalari)
// ============================================================

const EDU_DAILY_FIELDS = [
  { id: "start_active", label: "🌅 Kun boshidagi faol o'quvchilar soni" },
  { id: "end_active", label: "🌇 Kun oxiridagi faol o'quvchilar soni" },
  { id: "attendance_percent", label: "📅 Davomat foizi (%)" },
  { id: "risky_count", label: "⚠️ Xavfli o'quvchilar soni" },
];

async function renderEduManagerDayTab(box, me) {
  const today = _todayDateStr();
  box.innerHTML = `
    <div class="card">
      <label>Sana</label>
      <input type="date" id="eduDateInput" value="${today}" max="${today}" />
    </div>
    <div id="eduDayContent"><div class="center-box"><div class="spinner"></div></div></div>
  `;

  const dateInput = box.querySelector("#eduDateInput");
  const contentBox = box.querySelector("#eduDayContent");

  dateInput.addEventListener("change", () => loadEduManagerDay(contentBox, me, dateInput.value));
  await loadEduManagerDay(contentBox, me, today);
}

async function loadEduManagerDay(box, me, selectedDate) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;

  try {
    const res = await api(`/api/edu-manager-daily/me?date=${selectedDate}`);
    const data = res.data || {};
    const status = data.status || null;
    const isLocked = status === "pending" || status === "approved";

    const fieldsHtml = EDU_DAILY_FIELDS.map((f) => `
      <div class="sc-field">
        <label>${f.label}</label>
        <input id="edu_${f.id}" type="number" step="${f.id === "attendance_percent" ? "0.1" : "1"}" min="0" value="${data[f.id] ?? ""}" ${isLocked ? "disabled" : ""} />
      </div>
    `).join("");

    let statusBannerHtml = "";
    if (status === "pending") {
      statusBannerHtml = `
        <div class="sm-status-banner sm-status-pending">
          <span class="sm-status-spinner"></span>
          <span>Jarayonda — Direktor tomonidan ko'rib chiqilmoqda</span>
        </div>`;
    } else if (status === "approved") {
      statusBannerHtml = `<div class="sm-status-banner sm-status-approved"><span>✅ Tasdiqlandi</span></div>`;
    } else if (status === "rejected") {
      statusBannerHtml = `
        <div class="sm-status-banner sm-status-rejected">
          <span>❌ Otkaz qilindi${data.rejection_note ? ": " + data.rejection_note : ""} — ma'lumotlarni tahrirlab qayta yuboring</span>
        </div>`;
    }

    box.innerHTML = `
      <h2>📅 ${selectedDate}</h2>
      ${statusBannerHtml}
      <div class="card sc-form">${fieldsHtml}</div>
      ${!isLocked ? `
        <button class="primary" id="eduSaveBtn">💾 Saqlash</button>
        <button class="secondary" id="eduSubmitBtn">📤 Yuborish</button>
        <div id="eduDayMsg" style="margin-top:8px;font-size:13px;"></div>
      ` : ""}
    `;

    if (!isLocked) {
      function collectBody() {
        const body = { date: selectedDate };
        EDU_DAILY_FIELDS.forEach((f) => {
          const v = parseFloat(box.querySelector(`#edu_${f.id}`).value);
          body[f.id] = isNaN(v) ? null : v;
        });
        return body;
      }

      box.querySelector("#eduSaveBtn").addEventListener("click", async () => {
        const msg = box.querySelector("#eduDayMsg");
        msg.textContent = "Saqlanmoqda...";
        try {
          await api("/api/edu-manager-daily/me", { method: "POST", body: JSON.stringify(collectBody()) });
          msg.innerHTML = `<span class="badge ok">✅ Saqlandi (qoralama)</span>`;
        } catch (err) {
          msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
        }
      });

      box.querySelector("#eduSubmitBtn").addEventListener("click", () => {
        showConfirm(
          "Ma'lumotlarni yuborish",
          `<b>${selectedDate}</b> kuni uchun ma'lumotlar Direktorga ko'rib chiqish uchun yuborilsinmi?`,
          async () => {
            const msg = box.querySelector("#eduDayMsg");
            msg.textContent = "Yuborilmoqda...";
            try {
              await api("/api/edu-manager-daily/me", { method: "POST", body: JSON.stringify(collectBody()) });
              await api("/api/edu-manager-daily/me/submit", { method: "POST", body: JSON.stringify({ date: selectedDate }) });
              loadEduManagerDay(box, me, selectedDate);
            } catch (err) {
              msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
            }
          }
        );
      });
    }
  } catch (err) {
    box.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}

// ============================================================
// ADMIN VIEW
// ============================================================

const ADMIN_TABS = [
  { id: "dashboard", icon: "📊", label: "Dashboard", desc: "Xarajat, KPI reytingi va kompaniya ko'rsatkichlari" },
  { id: "company", icon: "🏢", label: "Kompaniya", desc: "Kunlik ko'rsatkichlar va xodimlar tasdiqlashi" },
  { id: "moliya", icon: "💰", label: "Moliya", desc: "Ish haqi, tushum va kompaniya moliyasi" },
  { id: "scorecard", icon: "✏️", label: "Scorecard", desc: "Xodimlarni KPI bo'yicha baholash" },
  { id: "employees", icon: "👥", label: "Xodimlar", desc: "Xodimlarni qo'shish va boshqarish" },
  { id: "talabalar", icon: "🎒", label: "Talabalar", desc: "Barcha o'qituvchilarning talabalari — filtr, guruh, holat" },
  { id: "reports", icon: "📑", label: "Hisobotlar", desc: "O'qituvchi, Scorecard va Kompaniya hisobotlari" },
  { id: "tasks", icon: "📋", label: "Topshiriqlar", desc: "Xodimlar orasidagi buyruq va xabarlar" },
  { id: "rules", icon: "📜", label: "Asosiy qoidalar", desc: "Teacher va Edu Manager KPI qanday hisoblanadi" },
  { id: "settings", icon: "⚙️", label: "Sozlamalar", desc: "Grade narxlari, foizlar va sinov rejimi" },
];

function _roleHeroConfig(role) {
  if (role === "CEO") {
    return { icon: "👑", gradient: "linear-gradient(135deg, #f5a623, #c77800)", label: "Bosh direktor" };
  }
  if (role === "Director") {
    return { icon: "🏛️", gradient: "linear-gradient(135deg, #17a589, #0e6655)", label: "Direktor" };
  }
  return { icon: "🧑‍💼", gradient: "linear-gradient(135deg, var(--button), #1a5f9e)", label: role };
}

function renderAdminView(me) {
  if (me.role === "EduManager") {
    renderEduManagerView(me);
    return;
  }
  renderAdminHome(me);
}

function renderAdminHome(me) {
  const hero = _roleHeroConfig(me.role);

  // Sozlamalar bo'limi faqat CEO uchun ko'rinadi — Direktor kompaniya ma'lumotlarining
  // barchasini ko'radi va boshqaradi, lekin tizim sozlamalarini (grade narxlari, foizlar) o'zgartira olmaydi.
  const tabsToShow = me.role === "CEO" ? ADMIN_TABS : ADMIN_TABS.filter((t) => t.id !== "settings");

  renderSidebarShell(me, {
    items: tabsToShow,
    activeId: tabsToShow[0].id,
    dispatch: renderAdminTab,
    heroIcon: hero.icon,
    heroGradient: hero.gradient,
    heroLabel: hero.label,
  });
}

async function renderAdminTab(tab, box, me) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  try {
    if (tab === "dashboard") await renderDashboardTab(box);
    else if (tab === "company") await renderCompanyTab(box);
    else if (tab === "moliya") await renderMoliyaTab(box);
    else if (tab === "scorecard") await renderScorecardTab(box, me);
    else if (tab === "employees") await renderEmployeesTab(box, me);
    else if (tab === "talabalar") await renderStudentsAdminTab(box, me);
    else if (tab === "reports") await renderReportsTab(box);
    else if (tab === "tasks") await renderTasksTab(box, me);
    else if (tab === "rules") await renderKpiRulesTab(box);
    else if (tab === "settings") await renderSettingsTab(box);
  } catch (err) {
    box.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}

// ============================================================
// TALABALAR (kompaniya darajasida) — CEO / Direktor
// Barcha o'qituvchilarning students/student_groups yozuvlarini birlashtirib ko'rsatadi.
// ============================================================

const STUDENT_STATUS_LABELS = { faol: "Faol", qarzdor: "Qarzdor", sinov: "Sinov", muzlatilgan: "Muzlatilgan" };

const SA_ALL_COLUMNS = [
  { key: "idx", label: "T/R", alwaysOn: true },
  { key: "full_name", label: "FISH", alwaysOn: true },
  { key: "phone", label: "Telefon raqam" },
  { key: "group", label: "Guruh" },
  { key: "status", label: "Holat" },
  { key: "teacher", label: "O'qituvchi" },
];

function _saHiddenCols() {
  try { return JSON.parse(localStorage.getItem("saHiddenCols") || "[]"); } catch { return []; }
}
function _saSaveHiddenCols(hidden) {
  try { localStorage.setItem("saHiddenCols", JSON.stringify(hidden)); } catch {}
}

function _saStatusCell(s) {
  if (!s.active) return `<span class="badge neutral">Arxivlangan</span>`;
  const label = STUDENT_STATUS_LABELS[s.status] || "—";
  return s.status
    ? `<span class="status-dot status-${s.status}"></span> ${label}`
    : `<span class="badge neutral">Belgilanmagan</span>`;
}

function _saCell(key, s, i, state) {
  if (key === "idx") return String((state.page - 1) * state.pageSize + i + 1);
  if (key === "full_name") return s.full_name;
  if (key === "phone") return s.phone || "-";
  if (key === "group") return s.group_name || "-";
  if (key === "status") return _saStatusCell(s);
  if (key === "teacher") return s.teacher_name || "-";
  return "-";
}

async function renderStudentsAdminTab(box, me) {
  const state = {
    page: 1,
    pageSize: 20,
    filters: { q: "", phone: "", parent_phone: "", group_id: "", course: "", teacher_id: "", tag_ids: [], status: "faol" },
    total: 0,
    groups: [],
    courses: [],
    teachers: [],
    tags: [],
    hiddenCols: _saHiddenCols(),
  };

  box.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-weight:700;font-size:15px;">Talabalar ro'yxati</span>
        <select id="saPageSize" style="width:auto;margin:0;">
          <option value="20">20 / sahifa</option>
          <option value="50">50 / sahifa</option>
          <option value="100">100 / sahifa</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="secondary" id="saSummaryBtn" style="width:auto;margin-top:0;">📊 Aktiv talabalar hisoboti</button>
        <button class="primary" id="saAddBtn" style="width:auto;margin-top:0;">+ Yangi talaba qo'shish</button>
      </div>
    </div>

    <div class="card" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;">
      <div style="flex:1;min-width:130px;">
        <label>Ism orqali qidirish</label>
        <input type="text" id="saFq" placeholder="Ism..." />
      </div>
      <div style="flex:1;min-width:130px;">
        <label>Telefon raqam</label>
        <input type="text" id="saFphone" placeholder="90 123 45 67" />
      </div>
      <div style="flex:1;min-width:130px;">
        <label>Ota-ona raqami</label>
        <input type="text" id="saFparentPhone" placeholder="90 123 45 67" />
      </div>
      <div style="flex:1;min-width:150px;">
        <label>Guruhni tanlang</label>
        <select id="saFgroup"><option value="">Barchasi</option></select>
      </div>
      <div style="flex:1;min-width:150px;">
        <label>Kurs bo'yicha</label>
        <select id="saFcourse"><option value="">Barchasi</option></select>
      </div>
      <div style="flex:1;min-width:150px;">
        <label>O'qituvchi bo'yicha</label>
        <select id="saFteacher"><option value="">Barchasi</option></select>
      </div>
      <div style="flex:1;min-width:150px;">
        <label>Teglar bo'yicha</label>
        <select id="saFtags" multiple size="3"></select>
      </div>
      <div style="flex:1;min-width:150px;">
        <label>Holat</label>
        <select id="saFstatus">
          <option value="all">Barcha talabalar</option>
          <option value="faol" selected>Faol</option>
          <option value="qarzdor">Qarzdor</option>
          <option value="sinov">Sinov</option>
          <option value="muzlatilgan">Muzlatilgan</option>
          <option value="archived">Arxivlangan</option>
        </select>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="secondary" id="saClearBtn" style="width:auto;margin-top:0;">Tozalash</button>
        <button class="icon-btn" id="saColsBtn" title="Ustunlar">⚙</button>
      </div>
    </div>
    <div id="saColsPanel" class="card" style="display:none;"></div>

    <div id="saTotalLine" style="margin:10px 2px;font-size:13px;color:var(--text-muted);">Jami: —</div>
    <div id="saTableWrap"><div class="center-box"><div class="spinner"></div></div></div>
    <div id="saPagerWrap" style="display:flex;justify-content:center;gap:10px;align-items:center;margin:10px 0;"></div>
    <div id="saFormWrap"></div>
  `;

  const tableWrap = box.querySelector("#saTableWrap");
  const pagerWrap = box.querySelector("#saPagerWrap");
  const totalLine = box.querySelector("#saTotalLine");
  const formWrap = box.querySelector("#saFormWrap");
  const colsPanel = box.querySelector("#saColsPanel");

  function renderColsPanel() {
    colsPanel.innerHTML = SA_ALL_COLUMNS.filter((c) => !c.alwaysOn).map((c) => `
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:6px;font-weight:400;">
        <input type="checkbox" data-col="${c.key}" ${state.hiddenCols.includes(c.key) ? "" : "checked"} />
        ${c.label}
      </label>
    `).join("");
    colsPanel.querySelectorAll("input[data-col]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const key = cb.dataset.col;
        state.hiddenCols = cb.checked
          ? state.hiddenCols.filter((k) => k !== key)
          : [...state.hiddenCols, key];
        _saSaveHiddenCols(state.hiddenCols);
        renderTable();
      });
    });
  }
  renderColsPanel();
  box.querySelector("#saColsBtn").addEventListener("click", () => {
    colsPanel.style.display = colsPanel.style.display === "none" ? "block" : "none";
  });

  function renderTable(items) {
    items = items || state._lastItems || [];
    state._lastItems = items;
    const visible = SA_ALL_COLUMNS.filter((c) => c.alwaysOn || !state.hiddenCols.includes(c.key));
    if (!items.length) {
      tableWrap.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);">Talaba topilmadi</div>`;
      return;
    }
    tableWrap.innerHTML = `
      <div class="card" style="padding:0;overflow-x:auto;">
        <table>
          <thead><tr>${visible.map((c) => `<th style="padding:10px 12px;">${c.label}</th>`).join("")}</tr></thead>
          <tbody>
            ${items.map((s, i) => `
              <tr data-id="${s.id}" style="cursor:pointer;">
                ${visible.map((c) => `<td style="padding:10px 12px;">${_saCell(c.key, s, i, state)}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    tableWrap.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.addEventListener("click", () => openStudentAdminForm(Number(tr.dataset.id)));
    });
  }

  function renderPager() {
    const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    pagerWrap.innerHTML = `
      <button class="mini-btn" id="saPrev" ${state.page <= 1 ? "disabled" : ""}>‹ Oldingi</button>
      <span style="font-size:13px;color:var(--text-muted);">${state.page} / ${pages}</span>
      <button class="mini-btn" id="saNext" ${state.page >= pages ? "disabled" : ""}>Keyingi ›</button>
    `;
    pagerWrap.querySelector("#saPrev").addEventListener("click", () => { state.page--; loadList(); });
    pagerWrap.querySelector("#saNext").addEventListener("click", () => { state.page++; loadList(); });
  }

  async function loadRefData() {
    const [groups, courses, teachers, tags] = await Promise.all([
      api("/api/admin/groups"),
      api("/api/admin/courses"),
      api("/api/admin/teachers"),
      api("/api/admin/tags"),
    ]);
    state.groups = groups;
    state.courses = courses;
    state.teachers = teachers;
    state.tags = tags;

    const gSel = box.querySelector("#saFgroup");
    const prevG = gSel.value;
    gSel.innerHTML = `<option value="">Barchasi</option>` + groups.map((g) => `<option value="${g.id}">${g.name}${g.teacher_name ? " (" + g.teacher_name + ")" : ""}</option>`).join("");
    gSel.value = prevG;

    const cSel = box.querySelector("#saFcourse");
    const prevC = cSel.value;
    cSel.innerHTML = `<option value="">Barchasi</option>` + courses.map((c) => `<option value="${c.course}">${c.course}</option>`).join("");
    cSel.value = prevC;

    const tSel = box.querySelector("#saFteacher");
    const prevT = tSel.value;
    tSel.innerHTML = `<option value="">Barchasi</option>` + teachers.map((t) => `<option value="${t.teacher_id}">${t.full_name}</option>`).join("");
    tSel.value = prevT;

    const tagSel = box.querySelector("#saFtags");
    tagSel.innerHTML = tags.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
  }

  async function loadList() {
    tableWrap.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    const params = new URLSearchParams();
    params.set("page", state.page);
    params.set("page_size", state.pageSize);
    params.set("status", state.filters.status);
    if (state.filters.q) params.set("q", state.filters.q);
    if (state.filters.phone) params.set("phone", state.filters.phone);
    if (state.filters.parent_phone) params.set("parent_phone", state.filters.parent_phone);
    if (state.filters.group_id) params.set("group_id", state.filters.group_id);
    if (state.filters.course) params.set("course", state.filters.course);
    if (state.filters.teacher_id) params.set("teacher_id", state.filters.teacher_id);
    if (state.filters.tag_ids.length) params.set("tag_ids", state.filters.tag_ids.join(","));

    try {
      const res = await api(`/api/admin/students?${params.toString()}`);
      state.total = res.total;
      totalLine.textContent = `Jami: ${res.total}`;
      renderTable(res.items);
      renderPager();
    } catch (err) {
      tableWrap.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  let debounceTimer;
  function debouncedReload() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { state.page = 1; loadList(); }, 350);
  }

  box.querySelector("#saFq").addEventListener("input", (e) => { state.filters.q = e.target.value.trim(); debouncedReload(); });
  box.querySelector("#saFphone").addEventListener("input", (e) => { state.filters.phone = e.target.value.trim(); debouncedReload(); });
  box.querySelector("#saFparentPhone").addEventListener("input", (e) => { state.filters.parent_phone = e.target.value.trim(); debouncedReload(); });
  box.querySelector("#saFgroup").addEventListener("change", (e) => { state.filters.group_id = e.target.value; state.page = 1; loadList(); });
  box.querySelector("#saFcourse").addEventListener("change", (e) => { state.filters.course = e.target.value; state.page = 1; loadList(); });
  box.querySelector("#saFteacher").addEventListener("change", (e) => { state.filters.teacher_id = e.target.value; state.page = 1; loadList(); });
  box.querySelector("#saFtags").addEventListener("change", (e) => {
    state.filters.tag_ids = [...e.target.selectedOptions].map((o) => o.value);
    state.page = 1; loadList();
  });
  box.querySelector("#saFstatus").addEventListener("change", (e) => { state.filters.status = e.target.value; state.page = 1; loadList(); });
  box.querySelector("#saPageSize").addEventListener("change", (e) => { state.pageSize = Number(e.target.value); state.page = 1; loadList(); });
  box.querySelector("#saClearBtn").addEventListener("click", () => {
    state.filters = { q: "", phone: "", parent_phone: "", group_id: "", course: "", teacher_id: "", tag_ids: [], status: "faol" };
    box.querySelector("#saFq").value = "";
    box.querySelector("#saFphone").value = "";
    box.querySelector("#saFparentPhone").value = "";
    box.querySelector("#saFgroup").value = "";
    box.querySelector("#saFcourse").value = "";
    box.querySelector("#saFteacher").value = "";
    [...box.querySelector("#saFtags").options].forEach((o) => (o.selected = false));
    box.querySelector("#saFstatus").value = "faol";
    state.page = 1;
    loadList();
  });

  async function showStudentsSummaryModal() {
    const overlay = el(`
      <div class="modal-overlay">
        <div class="modal-box">
          <h3>📊 Aktiv talabalar hisoboti</h3>
          <div id="saSummaryContent"><div class="center-box"><div class="spinner"></div></div></div>
          <div class="modal-actions">
            <button class="secondary" id="saSummaryClose">Yopish</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(overlay);
    overlay.querySelector("#saSummaryClose").addEventListener("click", () => overlay.remove());
    try {
      const summary = await api("/api/admin/students/summary");
      overlay.querySelector("#saSummaryContent").innerHTML = `
        <p style="font-size:15px;">Jami faol talabalar: <b>${summary.total_active}</b></p>
        ${summary.by_course.length ? `
          <table>
            <thead><tr><th>Kurs</th><th>Soni</th></tr></thead>
            <tbody>
              ${summary.by_course.map((c) => `<tr><td>${c.course}</td><td>${c.c}</td></tr>`).join("")}
            </tbody>
          </table>
        ` : `<p style="color:var(--text-muted);">Guruhga biriktirilgan faol talaba yo'q</p>`}
      `;
    } catch (err) {
      overlay.querySelector("#saSummaryContent").innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }
  box.querySelector("#saSummaryBtn").addEventListener("click", showStudentsSummaryModal);

  async function openStudentAdminForm(studentId) {
    let student = null;
    if (studentId) {
      try {
        student = await api(`/api/admin/students/${studentId}`);
      } catch (err) {
        showToast(err.message, "error");
        return;
      }
    }
    _renderStudentAdminForm(formWrap, student, state, {
      onSaved: async () => { formWrap.innerHTML = ""; await loadRefData(); await loadList(); },
      onCancel: () => { formWrap.innerHTML = ""; },
      onArchived: async () => { formWrap.innerHTML = ""; await loadList(); },
    });
    formWrap.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  box.querySelector("#saAddBtn").addEventListener("click", () => openStudentAdminForm(null));

  await loadRefData();
  await loadList();
}

function _renderStudentAdminForm(container, student, state, callbacks) {
  const isEdit = !!student;
  const selectedTagIds = isEdit ? student.tags.map((t) => String(t.id)) : [];
  const currentGroupId = isEdit ? student.group_id : null;

  container.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">${isEdit ? "✏️ Talabani tahrirlash" : "+ Yangi talaba qo'shish"}</h3>
      <label>FISH *</label>
      <input type="text" id="saf_full_name" value="${isEdit ? student.full_name : ""}" />

      <label>O'qituvchi (ro'yxat egasi) *</label>
      <select id="saf_teacher">
        <option value="">Tanlanmagan</option>
        ${state.teachers.map((t) => `<option value="${t.teacher_id}" ${isEdit && student.teacher_id === t.teacher_id ? "selected" : ""}>${t.full_name}</option>`).join("")}
      </select>

      <label>Telefon raqam</label>
      <input type="text" id="saf_phone" placeholder="+998 XX XXX XX XX" value="${isEdit && student.phone ? student.phone : ""}" />
      <label>Qo'shimcha / ota-ona raqami</label>
      <input type="text" id="saf_phone2" placeholder="+998 XX XXX XX XX" value="${isEdit && student.phone2 ? student.phone2 : ""}" />
      <label>Ota-onasi ismi</label>
      <input type="text" id="saf_parent_name" value="${isEdit && student.parent_name ? student.parent_name : ""}" />
      <label>Kurs</label>
      <input type="text" id="saf_course" list="saf_course_list" value="${isEdit && student.course ? student.course : ""}" />
      <datalist id="saf_course_list">
        ${state.courses.map((c) => `<option value="${c.course}"></option>`).join("")}
      </datalist>

      <label>Holat</label>
      <select id="saf_status">
        <option value="faol" ${!isEdit || student.status === "faol" ? "selected" : ""}>Faol</option>
        <option value="qarzdor" ${isEdit && student.status === "qarzdor" ? "selected" : ""}>Qarzdor</option>
        <option value="sinov" ${isEdit && student.status === "sinov" ? "selected" : ""}>Sinov</option>
        <option value="muzlatilgan" ${isEdit && student.status === "muzlatilgan" ? "selected" : ""}>Muzlatilgan</option>
      </select>

      <label>Guruh <span style="font-weight:400;">(avval o'qituvchi tanlang)</span></label>
      <select id="saf_group">
        <option value="">Guruhsiz</option>
      </select>
      <button type="button" class="mini-btn" id="saf_newGroupToggle">+ Yangi guruh</button>
      <div id="saf_newGroupBox" style="display:none;margin-top:6px;">
        <input type="text" id="saf_newGroupName" placeholder="Guruh nomi" />
        <select id="saf_newGroupCourse">
          <option value="">Kurs tanlanmagan</option>
          ${state.courses.map((c) => `<option value="${c.course}">${c.course}</option>`).join("")}
        </select>
        <button type="button" class="secondary" id="saf_newGroupSave" style="width:auto;">Guruh qo'shish</button>
      </div>

      <label style="margin-top:10px;">Teglar</label>
      <select id="saf_tags" multiple size="3">
        ${state.tags.map((t) => `<option value="${t.id}" ${selectedTagIds.includes(String(t.id)) ? "selected" : ""}>${t.name}</option>`).join("")}
      </select>
      <button type="button" class="mini-btn" id="saf_newTagToggle">+ Yangi teg</button>
      <div id="saf_newTagBox" style="display:none;margin-top:6px;gap:6px;">
        <input type="text" id="saf_newTagName" placeholder="Teg nomi" style="flex:1;" />
        <button type="button" class="secondary" id="saf_newTagSave" style="width:auto;">Qo'shish</button>
      </div>

      <div class="modal-actions" style="margin-top:14px;">
        ${isEdit ? `<button type="button" class="primary danger" id="saf_archiveBtn" style="width:auto;">${student.active ? "Arxivlash" : "Arxivdan chiqarish"}</button>` : ""}
        <button type="button" class="secondary" id="saf_cancelBtn" style="width:auto;">Bekor qilish</button>
        <button type="button" class="primary" id="saf_saveBtn" style="width:auto;">Saqlash</button>
      </div>
    </div>
  `;

  const groupSel = container.querySelector("#saf_group");
  const tagsSel = container.querySelector("#saf_tags");
  const phoneInput = container.querySelector("#saf_phone");
  const phone2Input = container.querySelector("#saf_phone2");

  phoneInput.addEventListener("input", () => { phoneInput.value = _formatUzPhone(phoneInput.value); });
  phone2Input.addEventListener("input", () => { phone2Input.value = _formatUzPhone(phone2Input.value); });

  const teacherSel = container.querySelector("#saf_teacher");

  // Guruh tanlovi doim JORIY tanlangan o'qituvchining guruhlariga cheklanadi — guruh egasi
  // bilan talabaning ro'yxat egasi mos kelmasligi (chalkashlik) oldini olish uchun.
  function refreshGroupOptions(preserveId) {
    const teacherId = teacherSel.value;
    const own = state.groups.filter((g) => g.teacher_id === teacherId);
    groupSel.innerHTML = `<option value="">Guruhsiz</option>` +
      own.map((g) => `<option value="${g.id}" ${preserveId && String(preserveId) === String(g.id) ? "selected" : ""}>${g.name}${g.course ? " — " + g.course : ""}</option>`).join("");
  }
  refreshGroupOptions(currentGroupId);
  teacherSel.addEventListener("change", () => refreshGroupOptions(null));

  container.querySelector("#saf_newGroupToggle").addEventListener("click", () => {
    if (!teacherSel.value) { showToast("Avval o'qituvchini tanlang", "error"); return; }
    const b = container.querySelector("#saf_newGroupBox");
    b.style.display = b.style.display === "none" ? "block" : "none";
  });
  container.querySelector("#saf_newGroupSave").addEventListener("click", async () => {
    const name = container.querySelector("#saf_newGroupName").value.trim();
    const teacher_id = teacherSel.value;
    if (!name) { showToast("Guruh nomini kiriting", "error"); return; }
    if (!teacher_id) { showToast("Avval o'qituvchini tanlang", "error"); return; }
    try {
      const course = container.querySelector("#saf_newGroupCourse").value || null;
      const res = await api("/api/admin/groups", { method: "POST", body: JSON.stringify({ name, course, teacher_id }) });
      const teacherName = (state.teachers.find((t) => t.teacher_id === teacher_id) || {}).full_name || "";
      state.groups.push({ id: res.id, name, course, teacher_id, teacher_name: teacherName });
      refreshGroupOptions(res.id);
      container.querySelector("#saf_newGroupName").value = "";
      showToast("Guruh qo'shildi", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  container.querySelector("#saf_newTagToggle").addEventListener("click", () => {
    const b = container.querySelector("#saf_newTagBox");
    b.style.display = b.style.display === "none" ? "flex" : "none";
  });
  container.querySelector("#saf_newTagSave").addEventListener("click", async () => {
    const name = container.querySelector("#saf_newTagName").value.trim();
    if (!name) { showToast("Teg nomini kiriting", "error"); return; }
    try {
      const res = await api("/api/admin/tags", { method: "POST", body: JSON.stringify({ name }) });
      state.tags.push({ id: res.id, name });
      tagsSel.appendChild(el(`<option value="${res.id}" selected>${name}</option>`));
      container.querySelector("#saf_newTagName").value = "";
      showToast("Teg qo'shildi", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  container.querySelector("#saf_cancelBtn").addEventListener("click", () => callbacks.onCancel());

  if (isEdit) {
    container.querySelector("#saf_archiveBtn").addEventListener("click", async () => {
      try {
        if (student.active) {
          await api(`/api/admin/students/${student.id}`, { method: "DELETE" });
        } else {
          await api(`/api/admin/students/${student.id}/unarchive`, { method: "POST" });
        }
        showToast("Bajarildi", "success");
        callbacks.onArchived();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  container.querySelector("#saf_saveBtn").addEventListener("click", async () => {
    const full_name = container.querySelector("#saf_full_name").value.trim();
    if (!full_name) { showToast("FIO to'ldirilishi shart", "error"); return; }
    const teacher_id = container.querySelector("#saf_teacher").value;
    if (!teacher_id) { showToast("O'qituvchi tanlanishi shart", "error"); return; }
    const groupVal = groupSel.value;
    const payload = {
      full_name,
      teacher_id,
      phone: _parseUzPhone(phoneInput.value),
      phone2: _parseUzPhone(phone2Input.value),
      parent_name: container.querySelector("#saf_parent_name").value.trim() || null,
      course: container.querySelector("#saf_course").value.trim() || null,
      status: container.querySelector("#saf_status").value,
      group_id: groupVal ? Number(groupVal) : null,
      tag_ids: [...tagsSel.selectedOptions].map((o) => Number(o.value)),
    };
    try {
      if (isEdit) {
        await api(`/api/admin/students/${student.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/admin/students", { method: "POST", body: JSON.stringify(payload) });
      }
      showToast("Saqlandi", "success");
      callbacks.onSaved();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

// ============================================================
// EDU MANAGER VIEW — moliyaviy ma'lumotlarsiz, faqat KPI/o'quv jarayoni
// ============================================================

const EDU_TABS = [
  { id: "day", icon: "📅", label: "Kun", desc: "Kunlik ish vazifalarini kiritish" },
  { id: "teachers", icon: "👨‍🏫", label: "O'qituvchilar", desc: "O'qituvchilar ro'yxati va ma'lumotlari" },
  { id: "kpi", icon: "📊", label: "KPI", desc: "O'qituvchilar reytingi (yashil/sariq/qizil)" },
  { id: "scorecard", icon: "✏️", label: "Scorecard", desc: "O'qituvchilarni oylik baholash" },
  { id: "reports", icon: "📑", label: "Hisobotlar", desc: "KPI xulosasi (moliyaviy ma'lumotsiz)" },
  { id: "myPay", icon: "💰", label: "Mening ish haqim", desc: "Fix, KPI va bonus" },
  { id: "tasks", icon: "📋", label: "Topshiriqlar", desc: "Kelgan va yuborilgan topshiriqlar" },
  { id: "rules", icon: "📜", label: "Asosiy qoidalar", desc: "KPI qanday hisoblanishini bilib oling" },
];

function renderEduManagerView(me) {
  renderSidebarShell(me, {
    items: EDU_TABS,
    activeId: EDU_TABS[0].id,
    dispatch: renderEduTab,
    heroIcon: "🎓",
    heroGradient: "linear-gradient(135deg, #7c5cff, #4b2ee0)",
    heroLabel: "Ta'lim menejeri",
  });
}

async function renderEduTab(tab, box, me) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  try {
    if (tab === "teachers") await renderEduTeachersTab(box);
    else if (tab === "kpi") await renderEduKpiTab(box);
    else if (tab === "scorecard") await renderScorecardTab(box, me);
    else if (tab === "reports") await renderEduReportsTab(box);
    else if (tab === "myPay") await renderEduMyPayTab(box);
    else if (tab === "day") await renderEduManagerDayTab(box, me);
    else if (tab === "tasks") await renderTasksTab(box, me);
    else if (tab === "rules") await renderKpiRulesTab(box);
  } catch (err) {
    box.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}

async function renderEduMyPayTab(box) {
  box.innerHTML = `
    ${_monthSelectHtml("emMyMonth")}
    <div id="emMyResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;
  const select = box.querySelector("#emMyMonth");

  async function load() {
    const resultBox = box.querySelector("#emMyResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const d = await api(`/api/me/payroll?month=${select.value}`);

      const gateHtml = d.gate_notes && d.gate_notes.length
        ? d.gate_notes.map((n) => `<div class="gate-warning">⚠️ ${n}</div>`).join("")
        : "";

      let breakdownHtml = "";
      if (d.kpi_available && d.breakdown) {
        breakdownHtml = `
          <h2>📊 KPI mezonlari</h2>
          <div class="card">
            <div class="row"><span class="label">🔁 Retention</span><span class="value">${Math.round(d.breakdown.retention * 100)}%</span></div>
            <div class="row"><span class="label">👨‍🏫 Teacher Performance</span><span class="value">${Math.round(d.breakdown.teacher_performance * 100)}%</span></div>
            <div class="row"><span class="label">📈 Student Results</span><span class="value">${Math.round(d.breakdown.student_results * 100)}%</span></div>
            <div class="row"><span class="label">🗓️ Attendance</span><span class="value">${Math.round(d.breakdown.attendance * 100)}%</span></div>
            <div class="row"><span class="label">📝 Homework</span><span class="value">${Math.round(d.breakdown.homework * 100)}%</span></div>
            <div class="row"><span class="label">🏫 Group Occupancy</span><span class="value">${Math.round(d.breakdown.occupancy * 100)}%</span></div>
          </div>
        `;
      } else if (!d.kpi_available) {
        breakdownHtml = `<p style="font-size:12px;color:var(--hint);">📋 ${d.month} uchun hali KPI kiritilmagan.</p>`;
      }

      resultBox.innerHTML = `
        <div class="total-box">
          <div class="caption">${d.month} — Yakuniy hisob-kitob (Rashchyot)${d.is_settled ? " (to\'landi)" : ""}</div>
          <div class="amount">${d.is_settled ? fmt(d.settled_amount) : fmt(d.rashchyot)}</div>
        </div>
        ${gateHtml}
        <div class="card">
          <div class="row"><span class="label">Oylik maosh (Fix)</span><span class="value">${fmt(d.fix)}</span></div>
          <div class="row"><span class="label">Avans</span><span class="value" style="color:var(--red);">-${fmt(d.advance_given)}</span></div>
          <div class="row"><span class="label">Umumiy KPI foizi</span><span class="value">${d.kpi_available ? d.effective_kpi_percent + "%" : "—"}</span></div>
          <div class="row"><span class="label">KPI summasi</span><span class="value">${d.kpi_available ? fmt(d.kpi_amount) : "—"}</span></div>
          <div class="row"><span class="label">Bonus summasi</span><span class="value">${fmt(d.bonus)}</span></div>
        </div>
        ${breakdownHtml}
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  select.addEventListener("change", load);
  load();
}

// ============================================================
// TOPSHIRIQLAR (universal — barcha rollar uchun bitta komponent)
// ============================================================

const ROLE_LABELS_UZ_JS = {
  CEO: "CEO",
  Director: "Direktor",
  EduManager: "Ta'lim menejeri",
  Teacher: "O'qituvchi",
  SubjectTeacher: "Fan o'qituvchisi",
  Administrator: "Administrator",
  SalesManager: "Sotuv menejeri",
};

const STUDENT_PROBLEM_STATUSES = [
  "Muzlatildi", "Chiqib ketdi", "Darsga kelmadi", "Davomat qilinmadi",
  "Baholanmadi", "Qarzdor", "Yangi talaba qo'shildi", "Imtixon olinmadi", "Natijasi past",
];

function _studentTaskTextTemplate(status, name, group, phone) {
  const who = name || "O'quvchi";
  const grp = group ? ` (${group} guruhi)` : "";
  const tel = phone ? ` Tel: ${phone}` : "";
  const templates = {
    "Muzlatildi": `${who}${grp} muzlatildi.${tel}`,
    "Chiqib ketdi": `${who}${grp} chiqib ketdi.${tel}`,
    "Darsga kelmadi": `${who}${grp} darsga kelmadi.${tel}`,
    "Davomat qilinmadi": `${who}${grp} uchun davomat qilinmadi.${tel}`,
    "Baholanmadi": `${who}${grp} baholanmadi.${tel}`,
    "Qarzdor": `${who}${grp} qarzdor.${tel}`,
    "Yangi talaba qo'shildi": `${who}${grp}ga yangi talaba sifatida qo'shildi.${tel}`,
    "Imtixon olinmadi": `${who}${grp}dan imtixon olinmadi.${tel}`,
    "Natijasi past": `${who}${grp}ning natijasi past.${tel}`,
  };
  return templates[status] || "";
}

const TASK_STATUS_LABELS = {
  new: { label: "🆕 Yangi", cls: "task-status-new" },
  in_progress: { label: "🔄 Jarayonda", cls: "task-status-seen" },
  done: { label: "✅ Bajarildi", cls: "task-status-done" },
};

// "YYYY-MM-DD HH:MM:SS" -> "DD.MM.YYYY HH:MM".
// Qo'lda ajratamiz, chunki bu format (probelli, vaqt zonasiz) ba'zi brauzerlarda
// new Date() orqali noto'g'ri yoki umuman o'qilmaydi.
function _formatTaskCreatedAt(iso) {
  if (!iso) return "";
  const [datePart, timePart] = String(iso).split(" ");
  const parts = (datePart || "").split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  const hhmm = (timePart || "").slice(0, 5);
  return `${d}.${m}.${y}${hhmm ? " " + hhmm : ""}`;
}

// Muddatgacha qancha vaqt qolgani. Muddat kun aniqligida saqlanadi,
// shuning uchun o'sha kunning oxiri (23:59) chegara deb olinadi.
function _taskTimeLeftHtml(t) {
  if (!t.deadline || t.status === "done") return "";

  const end = new Date(`${t.deadline}T23:59:59`);
  if (isNaN(end)) return "";
  const diffMs = end - new Date();

  if (diffMs <= 0) {
    const lateDays = Math.max(1, Math.ceil(Math.abs(diffMs) / 86400000));
    return `<span class="task-time-chip task-time-overdue">⏰ ${lateDays} kun kechikdi</span>`;
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  let label;
  if (days > 0) label = `${days} kun ${hours} soat`;
  else if (hours > 0) label = `${hours} soat ${minutes} daqiqa`;
  else label = `${minutes} daqiqa`;

  const soonCls = diffMs < 86400000 ? " task-time-soon" : "";
  return `<span class="task-time-chip${soonCls}">⏳ ${label} qoldi</span>`;
}

function _formatTaskTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function loadMySummary(box) {
  try {
    const now = new Date();
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const end = _todayDateStr();
    const s = await api(`/api/tasks/my-summary?start=${start}&end=${end}`);

    if (s.total === 0) {
      box.innerHTML = "";
      return;
    }

    const completionRate = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
    const rateColor = completionRate >= 80 ? "var(--green)" : completionRate >= 50 ? "#e8a33d" : "var(--red)";

    const overdueHtml = s.overdue_count > 0
      ? `
        <div class="task-my-penalty-alert">
          ⚠️ Sizda <b>${s.overdue_count} ta</b> muddati o'tgan topshiriq bor — jami jarima: <b>${fmt(s.total_penalty)}</b>
        </div>
      `
      : s.total_penalty === 0 && s.penalty_rate > 0
        ? `<div class="task-my-penalty-ok">🎉 Ajoyib! Bu oy hech qanday muddati o'tgan topshirig'ingiz yo'q</div>`
        : "";

    box.innerHTML = `
      <div class="task-my-stats-card">
        <div class="task-my-stats-head">
          <span>📊 Shu oydagi natijangiz</span>
          <span class="task-my-stats-rate" style="color:${rateColor};">${completionRate}%</span>
        </div>
        <div class="task-my-stats-row">
          <span>🆕 ${s.not_done}</span>
          <span>🔄 ${s.in_progress}</span>
          <span>✅ ${s.done}</span>
          <span>📋 Jami: ${s.total}</span>
        </div>
        ${overdueHtml}
      </div>
    `;
  } catch (err) {
    box.innerHTML = "";
  }
}

// ============================================================
// MENING O'QUVCHILARIM — o'qituvchining shaxsiy o'quvchilar bazasi
// ============================================================

function _studentInitials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

function _studentGenderIcon(gender) {
  if (gender === "Qiz bola") return "👧";
  if (gender === "O'g'il bola") return "👦";
  return "🎒";
}

function _studentAttr(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/"/g, "&quot;");
}

async function renderMyStudentsSection(box) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  try {
    const students = await api("/api/my-students");
    _renderStudentsList(box, students);
  } catch (err) {
    box.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
  }
}

function _renderStudentsList(box, students) {
  box.innerHTML = `
    <div class="students-head-row">
      <div class="students-count-chip">👥 ${students.length} ta o'quvchi</div>
    </div>
    <input id="studentSearchInput" type="text" placeholder="🔍 Ism yoki tel raqam bo'yicha qidirish..." />
    <button class="primary" id="addStudentBtn">➕ Yangi o'quvchi qo'shish</button>
    <div class="student-list" id="studentListContainer"></div>
  `;

  const listContainer = box.querySelector("#studentListContainer");

  function renderRows(filtered) {
    listContainer.innerHTML = filtered.length
      ? filtered.map((s) => `
          <div class="student-row" data-id="${s.id}">
            <div class="student-avatar">${_studentInitials(s.full_name)}</div>
            <div class="student-row-main">
              <div class="student-row-name">${s.full_name}</div>
              <div class="student-row-meta">${_studentGenderIcon(s.gender)}${s.age ? ` ${s.age} yosh` : ""}${s.class_grade ? ` · ${s.class_grade}-sinf` : ""}${s.course ? ` · ${s.course}` : ""}${s.group_name ? ` · 🏷️ ${s.group_name}` : ""}</div>
            </div>
            <div class="menu-arrow">›</div>
          </div>
        `).join("")
      : `<div class="students-empty">
          <div class="students-empty-icon">🎒</div>
          <div class="students-empty-text">${students.length ? "Hech narsa topilmadi" : "Hali o'quvchi qo'shilmagan"}</div>
          ${students.length ? "" : `<div class="students-empty-sub">Yuqoridagi tugma orqali birinchi o'quvchini qo'shing</div>`}
        </div>`;

    listContainer.querySelectorAll(".student-row").forEach((row) => {
      row.addEventListener("click", () => renderStudentDetail(box, Number(row.dataset.id)));
    });
  }

  renderRows(students);

  box.querySelector("#studentSearchInput").addEventListener("input", (e) => {
    const term = e.target.value.trim().toLowerCase();
    const filtered = term
      ? students.filter((s) => (s.full_name || "").toLowerCase().includes(term) || (s.phone || "").includes(term))
      : students;
    renderRows(filtered);
  });

  box.querySelector("#addStudentBtn").addEventListener("click", () => {
    renderStudentAddForm(box);
  });
}

function _studentFieldsHtml(s) {
  const g = s.gender || "";
  return `
    <div class="sf-group-label">👤 Shaxsiy ma'lumotlar</div>
    <label>FIO (to'liq)</label>
    <input id="sf_full_name" type="text" placeholder="masalan: Aliyev Alisher Bahodir o'g'li" value="${_studentAttr(s.full_name)}" />

    <label>Yoshi</label>
    <input id="sf_age" type="number" min="0" max="30" placeholder="masalan: 12" value="${_studentAttr(s.age)}" />

    <label>Jinsi</label>
    <select id="sf_gender">
      <option value="" ${g === "" ? "selected" : ""}>Tanlanmagan</option>
      <option value="O'g'il bola" ${g === "O'g'il bola" ? "selected" : ""}>👦 O'g'il bola</option>
      <option value="Qiz bola" ${g === "Qiz bola" ? "selected" : ""}>👧 Qiz bola</option>
    </select>

    <div class="sf-group-label">👪 Oila ma'lumotlari</div>
    <label>Ota-onasi ismi</label>
    <input id="sf_parent_name" type="text" placeholder="masalan: Aliyeva Malika" value="${_studentAttr(s.parent_name)}" />

    <label>Tel raqam</label>
    <input id="sf_phone" type="tel" placeholder="+998 XX XXX XX XX" value="${s.phone ? _studentAttr(s.phone) : "+998 "}" />

    <label>Qo'shimcha tel raqam</label>
    <input id="sf_phone2" type="tel" placeholder="+998 XX XXX XX XX (ixtiyoriy)" value="${_studentAttr(s.phone2)}" />

    <label>Oilada nechta farzand</label>
    <input id="sf_siblings_count" type="number" min="0" max="20" placeholder="masalan: 3" value="${_studentAttr(s.siblings_count)}" />

    <div class="sf-group-label">📍 Manzil</div>
    <label>Tumani</label>
    <input id="sf_district" type="text" placeholder="masalan: Chilonzor" value="${_studentAttr(s.district)}" />

    <label>MFY (mahalla)</label>
    <input id="sf_mahalla" type="text" placeholder="masalan: Oq oltin" value="${_studentAttr(s.mahalla)}" />

    <div class="sf-group-label">🎓 Ta'lim ma'lumotlari</div>
    <label>Maktab raqami</label>
    <input id="sf_school_number" type="text" placeholder="masalan: 267" value="${_studentAttr(s.school_number)}" />

    <label>Sinfi</label>
    <input id="sf_class_grade" type="text" placeholder="masalan: 7-A" value="${_studentAttr(s.class_grade)}" />

    <label>Kursi (English House)</label>
    <input id="sf_course" type="text" placeholder="masalan: Pre-Intermediate" value="${_studentAttr(s.course)}" />
  `;
}

function _studentFormHtml(s, opts) {
  const startOpen = !!(opts && opts.startOpen);
  const demoDisplay = startOpen ? "block" : "none";
  const demoChevron = startOpen ? "︿" : "⌄";
  return `
    <div class="rule-criterion-card">
      <div class="rule-criterion-head" data-toggle="sf_demo_body">
        <span class="rule-criterion-icon">📋</span>
        <div class="rule-criterion-titles">
          <div class="rule-criterion-label">Demografik ma'lumotlar</div>
          <div class="rule-criterion-sub">FIO, yoshi, oilasi, manzili va ta'lim ma'lumotlari</div>
        </div>
        <span class="rule-criterion-chevron">${demoChevron}</span>
      </div>
      <div class="rule-criterion-body" id="sf_demo_body" style="display:${demoDisplay};">
        ${_studentFieldsHtml(s)}
      </div>
    </div>

    <div class="rule-criterion-card">
      <div class="rule-criterion-head" data-toggle="sf_extra_body">
        <span class="rule-criterion-icon">➕</span>
        <div class="rule-criterion-titles">
          <div class="rule-criterion-label">Qo'shimcha ma'lumotlar</div>
          <div class="rule-criterion-sub">Anketa va boshqa qo'shimcha ma'lumotlar</div>
        </div>
        <span class="rule-criterion-chevron">⌄</span>
      </div>
      <div class="rule-criterion-body" id="sf_extra_body" style="display:none;">
        <div class="students-anketa-stub">
          <div class="students-anketa-icon">🗒️</div>
          <div class="students-anketa-text">Anketa savollari tez orada shu yerga qo'shiladi.</div>
        </div>
      </div>
    </div>
  `;
}

function _wireStudentForm(box) {
  const phone = box.querySelector("#sf_phone");
  const phone2 = box.querySelector("#sf_phone2");
  phone.addEventListener("input", () => { phone.value = _formatUzPhone(phone.value); });
  phone2.addEventListener("input", () => { phone2.value = _formatUzPhone(phone2.value); });
}

function _readStudentForm(box) {
  const val = (id) => box.querySelector(id).value.trim();
  const numOrNull = (id) => {
    const v = val(id);
    return v === "" ? null : Number(v);
  };
  const phoneOrNull = (id) => _parseUzPhone(box.querySelector(id).value);

  return {
    full_name: val("#sf_full_name"),
    age: numOrNull("#sf_age"),
    gender: box.querySelector("#sf_gender").value || null,
    parent_name: val("#sf_parent_name") || null,
    phone: phoneOrNull("#sf_phone"),
    phone2: phoneOrNull("#sf_phone2"),
    siblings_count: numOrNull("#sf_siblings_count"),
    district: val("#sf_district") || null,
    mahalla: val("#sf_mahalla") || null,
    school_number: val("#sf_school_number") || null,
    class_grade: val("#sf_class_grade") || null,
    course: val("#sf_course") || null,
  };
}

function renderStudentAddForm(box) {
  box.innerHTML = `
    <button class="back-btn" id="studentFormBackBtn">← Ro'yxatga qaytish</button>
    <div class="teacher-hero" style="padding-top:4px;">
      <div class="student-detail-avatar">🎒</div>
      <h1 style="margin-bottom:2px;">Yangi o'quvchi</h1>
      <div class="teacher-sub">Ma'lumotlarini to'ldiring</div>
    </div>
    ${_studentFormHtml({}, { startOpen: true })}
    <button class="primary" id="saveStudentBtn">✅ Saqlash</button>
    <div id="studentFormMsg" style="margin-top:8px;font-size:13px;"></div>
  `;

  box.querySelector("#studentFormBackBtn").addEventListener("click", () => renderMyStudentsSection(box));
  _wireStudentForm(box);
  _wireRuleToggles(box);

  box.querySelector("#saveStudentBtn").addEventListener("click", async () => {
    const msg = box.querySelector("#studentFormMsg");
    const data = _readStudentForm(box);
    if (!data.full_name) {
      msg.innerHTML = `<span class="badge warn">❌ FIO to'ldirilishi shart</span>`;
      return;
    }
    const btn = box.querySelector("#saveStudentBtn");
    btn.disabled = true;
    try {
      await api("/api/my-students", { method: "POST", body: JSON.stringify(data) });
      showToast("✅ O'quvchi qo'shildi");
      renderMyStudentsSection(box);
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
      btn.disabled = false;
    }
  });
}

async function renderStudentDetail(box, studentId) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  let s;
  try {
    s = await api(`/api/my-students/${studentId}`);
  } catch (err) {
    box.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
    return;
  }

  box.innerHTML = `
    <div class="students-head-row" style="justify-content:space-between;">
      <button class="back-btn" id="studentDetailBackBtn" style="margin-bottom:0;">← Ro'yxatga qaytish</button>
      <button class="secondary" id="transferGroupBtn" style="width:auto;margin-top:0;padding:8px 14px;font-size:13px;">🏷️ Guruhga ko'chirish</button>
    </div>
    <div class="teacher-hero" style="padding-top:4px;">
      <div class="student-detail-avatar">${_studentInitials(s.full_name)}</div>
      <h1 style="margin-bottom:2px;">${s.full_name}</h1>
      <div class="teacher-sub">${_studentGenderIcon(s.gender)} ${s.gender || "Jinsi kiritilmagan"}${s.age ? ` · ${s.age} yosh` : ""}${s.group_name ? ` · 🏷️ ${s.group_name}` : " · Guruhsiz"}</div>
    </div>

    ${_studentFormHtml(s, { startOpen: false })}

    <button class="primary" id="saveStudentDetailBtn">✅ O'zgarishlarni saqlash</button>
    <button class="secondary" id="deleteStudentBtn">🗑️ O'quvchini o'chirish</button>
    <div id="studentDetailMsg" style="margin-top:8px;font-size:13px;"></div>
  `;

  box.querySelector("#studentDetailBackBtn").addEventListener("click", () => renderMyStudentsSection(box));
  _wireStudentForm(box);
  _wireRuleToggles(box);

  box.querySelector("#transferGroupBtn").addEventListener("click", () => {
    showGroupTransferModal(s.group_id, async (newGroupId) => {
      try {
        await api(`/api/my-students/${studentId}/group`, { method: "PATCH", body: JSON.stringify({ group_id: newGroupId }) });
        showToast("✅ Guruh yangilandi");
        renderStudentDetail(box, studentId);
      } catch (err) {
        safeAlert("Xato: " + err.message);
      }
    });
  });

  box.querySelector("#saveStudentDetailBtn").addEventListener("click", async () => {
    const msg = box.querySelector("#studentDetailMsg");
    const data = _readStudentForm(box);
    if (!data.full_name) {
      msg.innerHTML = `<span class="badge warn">❌ FIO to'ldirilishi shart</span>`;
      return;
    }
    const btn = box.querySelector("#saveStudentDetailBtn");
    btn.disabled = true;
    try {
      await api(`/api/my-students/${studentId}`, { method: "PATCH", body: JSON.stringify(data) });
      showToast("✅ Saqlandi");
      btn.disabled = false;
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
      btn.disabled = false;
    }
  });

  box.querySelector("#deleteStudentBtn").addEventListener("click", () => {
    showConfirm(
      "O'quvchini o'chirish",
      `<b>${s.full_name}</b>ni ro'yxatdan o'chirmoqchimisiz? Bu amalni qaytarib bo'lmaydi.`,
      async () => {
        try {
          await api(`/api/my-students/${studentId}`, { method: "DELETE" });
          showToast("🗑️ O'quvchi o'chirildi");
          renderMyStudentsSection(box);
        } catch (err) {
          safeAlert("Xato: " + err.message);
        }
      }
    );
  });
}

// ============================================================
// GURUHLARIM — o'qituvchining shaxsiy guruhlari (dars jadvali)
// ============================================================

const WEEKDAYS = [
  { key: "mon", label: "Dush" },
  { key: "tue", label: "Sesh" },
  { key: "wed", label: "Chor" },
  { key: "thu", label: "Pay" },
  { key: "fri", label: "Juma" },
  { key: "sat", label: "Shan" },
  { key: "sun", label: "Yak" },
];

function _groupScheduleSummary(g) {
  const days = (g.lesson_days || "").split(",").filter(Boolean)
    .map((k) => (WEEKDAYS.find((w) => w.key === k) || {}).label || k)
    .join(", ");
  const time = g.start_time && g.end_time ? `${g.start_time}–${g.end_time}` : (g.start_time || g.end_time || "");
  return [days, time, g.day_period].filter(Boolean).join(" · ") || "Jadval belgilanmagan";
}

async function showGroupTransferModal(currentGroupId, onConfirm) {
  let groups;
  try {
    groups = await api("/api/my-groups");
  } catch (err) {
    safeAlert("Xato: " + err.message);
    return;
  }

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal-box">
        <h3>Guruhga ko'chirish</h3>
        <div class="modal-message">
          <label>Guruhni tanlang</label>
          <select id="groupTransferSelect">
            <option value="">— Guruhsiz —</option>
            ${groups.map((g) => `<option value="${g.id}" ${g.id === currentGroupId ? "selected" : ""}>${g.name} (${_groupScheduleSummary(g)})</option>`).join("")}
          </select>
        </div>
        <div class="modal-actions">
          <button class="secondary" id="modalCancel">Bekor qilish</button>
          <button class="primary" id="modalOk">Ko'chirish</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  overlay.querySelector("#modalCancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#modalOk").addEventListener("click", () => {
    const val = overlay.querySelector("#groupTransferSelect").value;
    overlay.remove();
    onConfirm(val ? Number(val) : null);
  });
}

async function renderMyGroupsSection(box) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  try {
    const groups = await api("/api/my-groups");
    _renderGroupsList(box, groups);
  } catch (err) {
    box.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
  }
}

function _renderGroupsList(box, groups) {
  box.innerHTML = `
    <div class="students-head-row">
      <div class="students-count-chip">👥 ${groups.length} ta guruh</div>
    </div>
    <button class="primary" id="addGroupBtn">➕ Yangi guruh yaratish</button>
    <div class="student-list" id="groupListContainer"></div>
  `;

  const listContainer = box.querySelector("#groupListContainer");
  listContainer.innerHTML = groups.length
    ? groups.map((g) => `
        <div class="student-row" data-id="${g.id}">
          <div class="student-avatar">👥</div>
          <div class="student-row-main">
            <div class="student-row-name">${g.name}</div>
            <div class="student-row-meta">${_groupScheduleSummary(g)} · 🎒 ${g.student_count} o'quvchi</div>
          </div>
          <div class="menu-arrow">›</div>
        </div>
      `).join("")
    : `<div class="students-empty">
        <div class="students-empty-icon">👨‍👩‍👧‍👦</div>
        <div class="students-empty-text">Hali guruh yaratilmagan</div>
        <div class="students-empty-sub">Yuqoridagi tugma orqali birinchi guruhni yarating</div>
      </div>`;

  listContainer.querySelectorAll(".student-row").forEach((row) => {
    row.addEventListener("click", () => renderGroupDetail(box, Number(row.dataset.id)));
  });

  box.querySelector("#addGroupBtn").addEventListener("click", () => renderGroupAddForm(box));
}

function _groupFormHtml(g) {
  const selectedDays = (g.lesson_days || "").split(",").filter(Boolean);
  const dp = g.day_period || "";
  return `
    <div class="card">
      <label>Guruh nomi</label>
      <input id="gf_name" type="text" placeholder="masalan: Beginner-A" value="${_studentAttr(g.name)}" />

      <label>Kurs</label>
      <input id="gf_course" type="text" placeholder="masalan: KIDS 1" value="${_studentAttr(g.course)}" />

      <label>Xona</label>
      <input id="gf_room" type="text" placeholder="masalan: Akvarium 5-room" value="${_studentAttr(g.room)}" />

      <label>Narx (so'm)</label>
      <input id="gf_price" type="number" min="0" step="1000" placeholder="masalan: 299000" value="${_studentAttr(g.price)}" />

      <label>Dars kunlari</label>
      <div class="weekday-grid">
        ${WEEKDAYS.map((w) => `
          <label class="weekday-chip ${selectedDays.includes(w.key) ? "checked" : ""}">
            <input type="checkbox" value="${w.key}" ${selectedDays.includes(w.key) ? "checked" : ""} style="width:auto;margin:0;" />
            ${w.label}
          </label>
        `).join("")}
      </div>

      <label>Boshlanish vaqti</label>
      <input id="gf_start_time" type="time" value="${_studentAttr(g.start_time)}" />

      <label>Tugash vaqti</label>
      <input id="gf_end_time" type="time" value="${_studentAttr(g.end_time)}" />

      <label>Kun vaqti</label>
      <select id="gf_day_period">
        <option value="" ${dp === "" ? "selected" : ""}>Tanlanmagan</option>
        <option value="Ertalab" ${dp === "Ertalab" ? "selected" : ""}>🌅 Ertalab</option>
        <option value="Tushlikdan keyin" ${dp === "Tushlikdan keyin" ? "selected" : ""}>🌇 Tushlikdan keyin</option>
      </select>

      <label>Boshlanish sanasi</label>
      <input id="gf_start_date" type="date" value="${_studentAttr(g.start_date)}" />

      <label>Tugash sanasi</label>
      <input id="gf_end_date" type="date" value="${_studentAttr(g.end_date)}" />
    </div>
  `;
}

function _wireGroupForm(box) {
  box.querySelectorAll(".weekday-chip").forEach((chip) => {
    const cb = chip.querySelector("input[type=checkbox]");
    cb.addEventListener("change", () => {
      chip.classList.toggle("checked", cb.checked);
    });
  });
}

function _readGroupForm(box) {
  const name = box.querySelector("#gf_name").value.trim();
  const lesson_days = Array.from(box.querySelectorAll(".weekday-chip input:checked")).map((cb) => cb.value);
  const priceVal = box.querySelector("#gf_price").value.trim();
  return {
    name,
    lesson_days,
    course: box.querySelector("#gf_course").value.trim() || null,
    room: box.querySelector("#gf_room").value.trim() || null,
    price: priceVal === "" ? null : Number(priceVal),
    start_time: box.querySelector("#gf_start_time").value || null,
    end_time: box.querySelector("#gf_end_time").value || null,
    day_period: box.querySelector("#gf_day_period").value || null,
    start_date: box.querySelector("#gf_start_date").value || null,
    end_date: box.querySelector("#gf_end_date").value || null,
  };
}

function renderGroupAddForm(box) {
  box.innerHTML = `
    <button class="back-btn" id="groupFormBackBtn">← Ro'yxatga qaytish</button>
    <div class="teacher-hero" style="padding-top:4px;">
      <div class="student-detail-avatar">👥</div>
      <h1 style="margin-bottom:2px;">Yangi guruh</h1>
      <div class="teacher-sub">Dars jadvalini kiriting</div>
    </div>
    ${_groupFormHtml({})}
    <button class="primary" id="saveGroupBtn">✅ Saqlash</button>
    <div id="groupFormMsg" style="margin-top:8px;font-size:13px;"></div>
  `;

  box.querySelector("#groupFormBackBtn").addEventListener("click", () => renderMyGroupsSection(box));
  _wireGroupForm(box);

  box.querySelector("#saveGroupBtn").addEventListener("click", async () => {
    const msg = box.querySelector("#groupFormMsg");
    const data = _readGroupForm(box);
    if (!data.name) {
      msg.innerHTML = `<span class="badge warn">❌ Guruh nomi to'ldirilishi shart</span>`;
      return;
    }
    const btn = box.querySelector("#saveGroupBtn");
    btn.disabled = true;
    try {
      await api("/api/my-groups", { method: "POST", body: JSON.stringify(data) });
      showToast("✅ Guruh yaratildi");
      renderMyGroupsSection(box);
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
      btn.disabled = false;
    }
  });
}

const MONTH_LABELS = ["Yan", "Fev", "Mar", "Apr", "May", "Iyun", "Iyul", "Avg", "Sen", "Okt", "Noy", "Dek"];

function _shortDate(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${d} ${MONTH_LABELS[Number(m) - 1].toLowerCase()}`;
}

function _monthNavHtml(idPrefix, year, month) {
  const curY = new Date().getFullYear();
  const years = [curY - 1, curY, curY + 1];
  return `
    <div class="month-picker" style="margin-bottom:14px;align-items:stretch;">
      <select id="${idPrefix}Year" style="width:auto;margin-bottom:0;">
        ${years.map((y) => `<option value="${y}" ${y === year ? "selected" : ""}>${y}</option>`).join("")}
      </select>
      <div class="tabs" style="margin-bottom:0;flex:1;">
        ${MONTH_LABELS.map((label, i) => `<div class="tab ${i + 1 === month ? "active" : ""}" data-month="${i + 1}">${label}</div>`).join("")}
      </div>
    </div>
  `;
}

const STUDENT_STATUS_OPTIONS = [
  { v: "faol", label: "🟢 Faol" },
  { v: "qarzdor", label: "🔴 Qarzdor" },
  { v: "sinov", label: "🔵 Sinov darsida" },
  { v: "muzlatilgan", label: "🟡 Muzlatilgan" },
];

async function renderGroupDetail(box, groupId) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  let g;
  try {
    g = await api(`/api/my-groups/${groupId}`);
  } catch (err) {
    box.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
    return;
  }

  box.innerHTML = `
    <button class="back-btn" id="groupDetailBackBtn">← Ro'yxatga qaytish</button>

    <div class="card group-info-card">
      <div class="group-info-head">
        <div>
          <h1 style="margin:0 0 2px;">${g.name}</h1>
          <div class="teacher-sub">${_groupScheduleSummary(g)}</div>
        </div>
        <button class="mini-btn" id="editGroupInfoBtn">✏️ Tahrirlash</button>
      </div>
      <div class="row"><span class="label">O'qituvchi</span><span class="value">${g.teacher_name}</span></div>
      <div class="row"><span class="label">Narx</span><span class="value">${g.price ? fmt(g.price) : "-"}</span></div>
      <div class="row"><span class="label">Vaqt</span><span class="value">${g.start_time && g.end_time ? `${g.start_time} - ${g.end_time}` : "-"}</span></div>
      <div class="row"><span class="label">Kurs</span><span class="value">${g.course || "-"}</span></div>
      <div class="row"><span class="label">Boshlanish sanasi</span><span class="value">${g.start_date || "-"}</span></div>
      <div class="row"><span class="label">Tugash sanasi</span><span class="value">${g.end_date || "-"}</span></div>
      <div class="row"><span class="label">Xona</span><span class="value">${g.room || "-"}</span></div>
      <div class="row"><span class="label">O'tilgan darslar</span><span class="value">${g.lessons_held}</span></div>
      <div id="groupEditFormWrap" style="display:none;margin-top:12px;"></div>
    </div>

    <div class="card roster-card">
      <div class="roster-legend">
        <span><span class="status-dot status-faol"></span>faol</span>
        <span><span class="status-dot status-qarzdor"></span>qarzdorlar</span>
        <span><span class="status-dot status-sinov"></span>sinov darsida</span>
        <span><span class="status-dot status-muzlatilgan"></span>muzlatilgan</span>
      </div>
      <div id="rosterList"></div>
      <button class="secondary" id="assignStudentsBtn">➕ O'quvchi biriktirish</button>
    </div>

    <div class="tabs" id="groupTabs">
      <div class="tab active" data-tab="attendance">Davomat</div>
      <div class="tab" data-tab="grades">Baholash</div>
      <div class="tab" data-tab="exercises">Mashqlar</div>
      <div class="tab" data-tab="discounts">Chegirma</div>
      <div class="tab" data-tab="rating">Reyting</div>
      <div class="tab" data-tab="exams">Imtihonlar</div>
      <div class="tab" data-tab="history">Tarix</div>
      <div class="tab" data-tab="comments">Izoh</div>
    </div>
    <div id="groupTabContent"><div class="center-box"><div class="spinner"></div></div></div>

    <h2>Guruhni boshqarish</h2>
    <button class="secondary" id="deleteGroupBtn">🗑️ Guruhni o'chirish</button>
  `;

  box.querySelector("#groupDetailBackBtn").addEventListener("click", () => renderMyGroupsSection(box));

  _renderRoster(box, g);

  box.querySelector("#editGroupInfoBtn").addEventListener("click", () => _toggleGroupEditForm(box, g, groupId));
  box.querySelector("#assignStudentsBtn").addEventListener("click", () => renderGroupAssignStudents(box, groupId));

  box.querySelector("#deleteGroupBtn").addEventListener("click", () => {
    showConfirm(
      "Guruhni o'chirish",
      `<b>${g.name}</b> guruhini o'chirmoqchimisiz? Unga biriktirilgan o'quvchilar guruhsiz holatga qaytadi.`,
      async () => {
        try {
          await api(`/api/my-groups/${groupId}`, { method: "DELETE" });
          showToast("🗑️ Guruh o'chirildi");
          renderMyGroupsSection(box);
        } catch (err) {
          safeAlert("Xato: " + err.message);
        }
      }
    );
  });

  const tabContent = box.querySelector("#groupTabContent");
  function switchTab(tab) {
    box.querySelectorAll("#groupTabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    _renderGroupTab(tabContent, g, groupId, tab);
  }
  box.querySelectorAll("#groupTabs .tab").forEach((t) => {
    t.addEventListener("click", () => switchTab(t.dataset.tab));
  });
  switchTab("attendance");
}

function _renderRoster(box, g) {
  const listEl = box.querySelector("#rosterList");
  if (!g.students.length) {
    listEl.innerHTML = `<div class="students-empty">
      <div class="students-empty-icon">🎒</div>
      <div class="students-empty-text">Hali o'quvchi biriktirilmagan</div>
    </div>`;
    return;
  }
  listEl.innerHTML = g.students.map((s, i) => `
    <div class="roster-row">
      <span class="status-dot status-${s.status || "faol"}"></span>
      <span class="roster-num">${i + 1}</span>
      <span class="roster-name">${s.full_name}</span>
      <span class="roster-phone">${s.phone || ""}</span>
      <button class="mini-btn" data-roster-menu="${s.id}">⋮</button>
    </div>
  `).join("");

  listEl.querySelectorAll("[data-roster-menu]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const student = g.students.find((s) => s.id === Number(btn.dataset.rosterMenu));
      _showRosterActionModal(box, g, student);
    });
  });
}

function _showRosterActionModal(box, g, student) {
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal-box">
        <h3>${student.full_name}</h3>
        <div class="modal-message">
          <label>Holati</label>
          <select id="rosterStatusSelect">
            ${STUDENT_STATUS_OPTIONS.map((o) => `<option value="${o.v}" ${(student.status || "faol") === o.v ? "selected" : ""}>${o.label}</option>`).join("")}
          </select>
        </div>
        <div class="modal-actions">
          <button class="secondary" id="modalCancel">Yopish</button>
          <button class="primary" id="modalSaveStatus">Saqlash</button>
        </div>
        <button class="secondary" id="modalRemoveFromGroup" style="margin-top:8px;">🗑️ Guruhdan chiqarish</button>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  overlay.querySelector("#modalCancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#modalSaveStatus").addEventListener("click", async () => {
    const status = overlay.querySelector("#rosterStatusSelect").value;
    try {
      await api(`/api/my-students/${student.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      overlay.remove();
      showToast("✅ Holat yangilandi");
      renderGroupDetail(box, g.id);
    } catch (err) {
      safeAlert("Xato: " + err.message);
    }
  });
  overlay.querySelector("#modalRemoveFromGroup").addEventListener("click", () => {
    overlay.remove();
    showConfirm("Guruhdan chiqarish", `<b>${student.full_name}</b> guruhdan chiqarilsinmi?`, async () => {
      try {
        await api(`/api/my-students/${student.id}/group`, { method: "PATCH", body: JSON.stringify({ group_id: null }) });
        showToast("✅ Guruhdan chiqarildi");
        renderGroupDetail(box, g.id);
      } catch (err) {
        safeAlert("Xato: " + err.message);
      }
    });
  });
}

function _toggleGroupEditForm(box, g, groupId) {
  const wrap = box.querySelector("#groupEditFormWrap");
  if (wrap.style.display === "block") {
    wrap.style.display = "none";
    wrap.innerHTML = "";
    return;
  }
  wrap.style.display = "block";
  wrap.innerHTML = `
    ${_groupFormHtml(g)}
    <button class="primary" id="saveGroupInfoBtn">✅ Saqlash</button>
    <div id="groupInfoMsg" style="margin-top:8px;font-size:13px;"></div>
  `;
  _wireGroupForm(wrap);
  wrap.querySelector("#saveGroupInfoBtn").addEventListener("click", async () => {
    const data = _readGroupForm(wrap);
    const msg = wrap.querySelector("#groupInfoMsg");
    if (!data.name) {
      msg.innerHTML = `<span class="badge warn">❌ Guruh nomi to'ldirilishi shart</span>`;
      return;
    }
    try {
      await api(`/api/my-groups/${groupId}`, { method: "PATCH", body: JSON.stringify(data) });
      showToast("✅ Saqlandi");
      renderGroupDetail(box, groupId);
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
    }
  });
}

function _renderGroupTab(tabContent, g, groupId, tab) {
  if (tab === "attendance") _renderAttendanceTab(tabContent, g, groupId);
  else if (tab === "grades") _renderGradesTab(tabContent, g, groupId);
  else if (tab === "exercises") _renderExercisesTab(tabContent, g, groupId);
  else if (tab === "discounts") _renderDiscountsTab(tabContent, g, groupId);
  else if (tab === "rating") _renderRatingTab(tabContent, g, groupId);
  else if (tab === "exams") _renderExamsTab(tabContent, g, groupId);
  else if (tab === "history") _renderHistoryTab(tabContent, g, groupId);
  else if (tab === "comments") _renderCommentsTab(tabContent, g, groupId);
}

const ATTENDANCE_CELL_HTML = {
  present: `<span class="pivot-flag pivot-flag-present">✓</span>`,
  late: `<span class="pivot-flag pivot-flag-late">⚑</span>`,
  absent: `<span class="pivot-flag pivot-flag-absent">⚑</span>`,
};

let _absenceReasonsCache = null;
async function _loadAbsenceReasons() {
  if (_absenceReasonsCache) return _absenceReasonsCache;
  _absenceReasonsCache = await api("/api/group-absence-reasons");
  return _absenceReasonsCache;
}

async function _showAttendanceCellModal(groupId, studentId, date, currentStatus, currentReason, onSaved) {
  const reasons = await _loadAbsenceReasons();
  let selected = currentStatus || null;

  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal-box">
        <h3>Davomat belgilash</h3>
        <div class="modal-message">
          <div class="attendance-choice-row">
            <button class="att-choice-btn ${selected === "present" ? "active" : ""}" data-choice="present">✅ Keldi</button>
            <button class="att-choice-btn ${selected === "late" ? "active" : ""}" data-choice="late">🚩 Kech qoldi</button>
            <button class="att-choice-btn ${selected === "absent" ? "active" : ""}" data-choice="absent">🚩 Kelmadi</button>
          </div>
          <div id="attReasonWrap" style="display:${selected === "absent" ? "block" : "none"};margin-top:12px;">
            <label>Kelmaganlik sababi</label>
            <select id="attReasonSelect">
              <option value="">Sababni tanlang</option>
              ${reasons.map((r) => `<option value="${r.label}" ${currentReason === r.label ? "selected" : ""}>${r.label}</option>`).join("")}
            </select>
            <div id="attReasonMsg" style="font-size:12px;"></div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="secondary" id="modalCancel">Bekor qilish</button>
          <button class="primary" id="modalSave">Saqlash</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);

  overlay.querySelectorAll(".att-choice-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selected = btn.dataset.choice;
      overlay.querySelectorAll(".att-choice-btn").forEach((b) => b.classList.toggle("active", b === btn));
      overlay.querySelector("#attReasonWrap").style.display = selected === "absent" ? "block" : "none";
    });
  });

  overlay.querySelector("#modalCancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#modalSave").addEventListener("click", async () => {
    if (!selected) { overlay.remove(); return; }
    let reason = null;
    if (selected === "absent") {
      reason = overlay.querySelector("#attReasonSelect").value;
      if (!reason) {
        overlay.querySelector("#attReasonMsg").innerHTML = `<span class="badge warn">❌ Sababni tanlang</span>`;
        return;
      }
    }
    try {
      await api(`/api/my-groups/${groupId}/attendance`, {
        method: "POST",
        body: JSON.stringify({ student_id: studentId, lesson_date: date, status: selected, reason }),
      });
      overlay.remove();
      onSaved(selected, reason);
    } catch (err) {
      overlay.remove();
      safeAlert("Xato: " + err.message);
    }
  });
}

async function _renderAttendanceTab(box, g, groupId) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  async function load() {
    box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    let data;
    try {
      data = await api(`/api/my-groups/${groupId}/attendance?year=${year}&month=${month}`);
    } catch (err) {
      box.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
      return;
    }
    renderTable(data);
  }

  function renderTable(data) {
    const dates = data.dates;
    const rows = g.students.map((s) => `
      <tr>
        <td class="pivot-name-cell">${s.full_name}</td>
        ${dates.map((d) => {
          const status = (data.values[s.id] || {})[d];
          return `<td><button class="pivot-cell" data-student="${s.id}" data-date="${d}">${status ? ATTENDANCE_CELL_HTML[status] || "" : ""}</button></td>`;
        }).join("")}
      </tr>
    `).join("");

    box.innerHTML = dates.length ? `
      ${_monthNavHtml("att", year, month)}
      <div class="card pivot-table-wrap">
        <table class="pivot-table">
          <thead><tr><th>Talabalar</th>${dates.map((d) => `<th>${_shortDate(d)}</th>`).join("")}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="legend-row">
        <div class="legend-item"><span class="pivot-flag pivot-flag-present" style="width:16px;height:16px;font-size:11px;">✓</span> Keldi</div>
        <div class="legend-item"><span class="pivot-flag pivot-flag-late" style="width:16px;height:16px;font-size:11px;">⚑</span> Kech qoldi</div>
        <div class="legend-item"><span class="pivot-flag pivot-flag-absent" style="width:16px;height:16px;font-size:11px;">⚑</span> Kelmadi</div>
      </div>
    ` : `${_monthNavHtml("att", year, month)}<div class="students-empty"><div class="students-empty-icon">📅</div><div class="students-empty-text">Bu oyda dars kuni yo'q</div></div>`;

    wireMonthNav();

    box.querySelectorAll(".pivot-cell").forEach((btn) => {
      btn.addEventListener("click", () => {
        const studentId = Number(btn.dataset.student);
        const date = btn.dataset.date;
        const currentStatus = (data.values[studentId] || {})[date] || null;
        const currentReason = (data.reasons[studentId] || {})[date] || null;
        _showAttendanceCellModal(groupId, studentId, date, currentStatus, currentReason, (status) => {
          btn.innerHTML = ATTENDANCE_CELL_HTML[status] || "";
          data.values[studentId] = data.values[studentId] || {};
          data.values[studentId][date] = status;
        });
      });
    });
  }

  function wireMonthNav() {
    box.querySelector(`#attYear`).addEventListener("change", (e) => { year = Number(e.target.value); load(); });
    box.querySelectorAll("[data-month]").forEach((m) => {
      m.addEventListener("click", () => { month = Number(m.dataset.month); load(); });
    });
  }

  load();
}

async function _renderGradesTab(box, g, groupId) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  async function load() {
    box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    let data;
    try {
      data = await api(`/api/my-groups/${groupId}/grades?year=${year}&month=${month}`);
    } catch (err) {
      box.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
      return;
    }
    renderTable(data);
  }

  function renderTable(data) {
    const dates = data.dates;
    const rows = g.students.map((s) => `
      <tr>
        <td class="pivot-name-cell">${s.full_name}</td>
        ${dates.map((d) => {
          const val = (data.values[s.id] || {})[d];
          return `<td><input class="pivot-input" type="number" min="0" max="5" step="0.5" data-student="${s.id}" data-date="${d}" value="${val !== undefined && val !== null ? val : ""}" /></td>`;
        }).join("")}
      </tr>
    `).join("");

    box.innerHTML = dates.length ? `
      ${_monthNavHtml("grd", year, month)}
      <div class="card pivot-table-wrap">
        <table class="pivot-table">
          <thead><tr><th>Talabalar</th>${dates.map((d) => `<th>${_shortDate(d)}</th>`).join("")}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    ` : `${_monthNavHtml("grd", year, month)}<div class="students-empty"><div class="students-empty-icon">📅</div><div class="students-empty-text">Bu oyda dars kuni yo'q</div></div>`;

    box.querySelector(`#grdYear`).addEventListener("change", (e) => { year = Number(e.target.value); load(); });
    box.querySelectorAll("[data-month]").forEach((m) => m.addEventListener("click", () => { month = Number(m.dataset.month); load(); }));

    box.querySelectorAll(".pivot-input").forEach((input) => {
      input.addEventListener("change", async () => {
        const studentId = Number(input.dataset.student);
        const date = input.dataset.date;
        const v = input.value === "" ? null : Number(input.value);
        try {
          await api(`/api/my-groups/${groupId}/grades`, {
            method: "POST",
            body: JSON.stringify({ student_id: studentId, lesson_date: date, score: v }),
          });
        } catch (err) {
          safeAlert("Xato: " + err.message);
        }
      });
    });
  }

  load();
}

async function _renderExercisesTab(box, g, groupId) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  async function load() {
    box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    let data;
    try {
      data = await api(`/api/my-groups/${groupId}/exercises?year=${year}&month=${month}`);
    } catch (err) {
      box.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
      return;
    }
    renderTable(data);
  }

  function renderTable(data) {
    const dates = data.dates;
    const rows = g.students.map((s) => `
      <tr>
        <td class="pivot-name-cell">${s.full_name}</td>
        ${dates.map((d) => {
          const val = (data.values[s.id] || {})[d];
          return `<td><input class="pivot-input" type="number" min="0" max="100" step="5" data-student="${s.id}" data-date="${d}" value="${val !== undefined && val !== null ? val : ""}" placeholder="%" /></td>`;
        }).join("")}
      </tr>
    `).join("");

    box.innerHTML = dates.length ? `
      ${_monthNavHtml("exr", year, month)}
      <div class="card pivot-table-wrap">
        <table class="pivot-table">
          <thead>
            <tr><th>Talabalar</th>${dates.map((d) => `<th>${_shortDate(d)}</th>`).join("")}</tr>
            <tr class="pivot-unit-row"><th>Unit</th>${dates.map((d) => `<th><input class="pivot-unit-input" type="text" data-date="${d}" value="${data.units[d] || ""}" placeholder="-" /></th>`).join("")}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    ` : `${_monthNavHtml("exr", year, month)}<div class="students-empty"><div class="students-empty-icon">📅</div><div class="students-empty-text">Bu oyda dars kuni yo'q</div></div>`;

    box.querySelector(`#exrYear`).addEventListener("change", (e) => { year = Number(e.target.value); load(); });
    box.querySelectorAll("[data-month]").forEach((m) => m.addEventListener("click", () => { month = Number(m.dataset.month); load(); }));

    box.querySelectorAll(".pivot-unit-input").forEach((input) => {
      input.addEventListener("change", async () => {
        try {
          await api(`/api/my-groups/${groupId}/exercises/unit`, {
            method: "POST",
            body: JSON.stringify({ lesson_date: input.dataset.date, unit_name: input.value.trim() || null }),
          });
        } catch (err) {
          safeAlert("Xato: " + err.message);
        }
      });
    });

    box.querySelectorAll(".pivot-input").forEach((input) => {
      input.addEventListener("change", async () => {
        const studentId = Number(input.dataset.student);
        const date = input.dataset.date;
        const v = input.value === "" ? null : Number(input.value);
        try {
          await api(`/api/my-groups/${groupId}/exercises`, {
            method: "POST",
            body: JSON.stringify({ student_id: studentId, lesson_date: date, percent: v }),
          });
        } catch (err) {
          safeAlert("Xato: " + err.message);
        }
      });
    });
  }

  load();
}

async function _renderDiscountsTab(box, g, groupId) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  let discounts;
  try {
    discounts = await api(`/api/my-groups/${groupId}/discounts`);
  } catch (err) {
    box.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
    return;
  }

  box.innerHTML = discounts.length ? `
    <div class="card" style="overflow-x:auto;">
      <table>
        <thead><tr><th>O'quvchi</th><th>Turi</th><th>Qiymati</th><th>Sababi</th><th></th></tr></thead>
        <tbody>
          ${discounts.map((d) => `
            <tr>
              <td>${d.full_name}</td>
              <td>
                <select class="dsc-type" data-student="${d.student_id}">
                  <option value="percent" ${d.discount_type === "percent" ? "selected" : ""}>%</option>
                  <option value="amount" ${d.discount_type === "amount" ? "selected" : ""}>so'm</option>
                </select>
              </td>
              <td><input class="dsc-value" type="number" min="0" data-student="${d.student_id}" value="${d.value || 0}" /></td>
              <td><input class="dsc-reason" type="text" data-student="${d.student_id}" value="${_studentAttr(d.reason)}" placeholder="sababi" /></td>
              <td><button class="mini-btn" data-save-discount="${d.student_id}">💾</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  ` : `<div class="students-empty"><div class="students-empty-icon">🎒</div><div class="students-empty-text">Guruhda o'quvchi yo'q</div></div>`;

  box.querySelectorAll("[data-save-discount]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const studentId = Number(btn.dataset.saveDiscount);
      const type = box.querySelector(`.dsc-type[data-student="${studentId}"]`).value;
      const value = Number(box.querySelector(`.dsc-value[data-student="${studentId}"]`).value || 0);
      const reason = box.querySelector(`.dsc-reason[data-student="${studentId}"]`).value.trim() || null;
      try {
        await api(`/api/my-groups/${groupId}/discounts`, {
          method: "POST",
          body: JSON.stringify({ student_id: studentId, discount_type: type, value, reason }),
        });
        showToast("✅ Saqlandi");
      } catch (err) {
        safeAlert("Xato: " + err.message);
      }
    });
  });
}

const RANK_MEDALS = ["🏆", "🥈", "🥉"];

async function _renderRatingTab(box, g, groupId) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  const now = new Date();
  let mode = "avg";
  const monthFilter = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  async function load() {
    let results;
    try {
      results = await api(`/api/my-groups/${groupId}/rating?mode=${mode}&month=${monthFilter}`);
    } catch (err) {
      box.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
      return;
    }
    render(results);
  }

  function render(results) {
    box.innerHTML = results.length ? `
      <div style="display:flex;gap:16px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:6px;margin:0;">
          <input type="radio" name="ratingMode" value="avg" ${mode === "avg" ? "checked" : ""} style="width:auto;margin:0;" /> O'rtacha bal
        </label>
        <label style="display:flex;align-items:center;gap:6px;margin:0;">
          <input type="radio" name="ratingMode" value="total" ${mode === "total" ? "checked" : ""} style="width:auto;margin:0;" /> Umumiy bal
        </label>
      </div>
      <div class="rank-list">
        ${results.map((r, i) => `
          <div class="rank-item ${i < 3 ? "rank-top" : ""}" data-student-rank="${r.student_id}" style="cursor:pointer;">
            <span class="rank-medal">${RANK_MEDALS[i] || (i + 1)}</span>
            <span class="rank-name">${r.full_name}</span>
            <span class="rank-percent ${r.value !== null ? "good" : ""}">${r.value !== null ? r.value.toFixed(1) : "—"}</span>
          </div>
        `).join("")}
      </div>
      <div id="ratingChartWrap" style="margin-top:16px;"></div>
    ` : `<div class="students-empty"><div class="students-empty-icon">🎒</div><div class="students-empty-text">Guruhda o'quvchi yo'q</div></div>`;

    box.querySelectorAll('input[name="ratingMode"]').forEach((r) => {
      r.addEventListener("change", (e) => { mode = e.target.value; load(); });
    });

    box.querySelectorAll("[data-student-rank]").forEach((row) => {
      row.addEventListener("click", () => {
        _loadRatingChart(box.querySelector("#ratingChartWrap"), groupId, Number(row.dataset.studentRank), row.querySelector(".rank-name").textContent, now.getFullYear());
      });
    });

    if (results.length) {
      _loadRatingChart(box.querySelector("#ratingChartWrap"), groupId, results[0].student_id, results[0].full_name, now.getFullYear());
    }
  }

  load();
}

async function _loadRatingChart(wrap, groupId, studentId, studentName, year) {
  wrap.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  let monthly;
  try {
    monthly = await api(`/api/my-groups/${groupId}/rating/${studentId}/monthly?year=${year}`);
  } catch (err) {
    wrap.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
    return;
  }
  const max = Math.max(5, ...monthly.map((m) => m.avg));
  wrap.innerHTML = `
    <div class="badge neutral" style="margin-bottom:10px;">${studentName}</div>
    <div class="bar-chart">
      ${monthly.map((m) => `
        <div class="bar-chart-col">
          <div class="bar-chart-bar" style="height:${max ? (m.avg / max) * 100 : 0}%;" title="${m.avg.toFixed(1)}"></div>
          <div class="bar-chart-label">${MONTH_LABELS[m.month - 1]}</div>
        </div>
      `).join("")}
    </div>
  `;
}

async function _renderExamsTab(box, g, groupId) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  let exams;
  try {
    exams = await api(`/api/my-groups/${groupId}/exams`);
  } catch (err) {
    box.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
    return;
  }

  function render(exams) {
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <h2 style="margin:0;">O'tkazilishi kerak bo'lgan imtihonlar</h2>
        <button class="primary" id="addExamBtn" style="width:auto;margin:0;padding:10px 16px;">➕ Yangi imtihon qo'shish</button>
      </div>
      <div id="examFormWrap" style="display:none;"></div>
      ${exams.length ? `
        <div class="card" style="overflow-x:auto;">
          <table>
            <thead><tr><th>Nomi</th><th>Sana</th><th>O'tish bali</th><th>Bo'lim</th><th>Umumiy bal</th><th>Baholangan</th><th></th></tr></thead>
            <tbody>
              ${exams.map((e) => `
                <tr>
                  <td>${e.name}</td>
                  <td>${e.exam_date || "-"}</td>
                  <td>${e.passing_score ?? "-"}</td>
                  <td>${e.section || "-"}</td>
                  <td>${e.total_score ?? "-"}</td>
                  <td>${e.graded_count}/${g.students.length}</td>
                  <td style="white-space:nowrap;">
                    <button class="mini-btn" data-grade-exam="${e.id}">📝</button>
                    <button class="mini-btn" data-delete-exam="${e.id}">🗑️</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : `<div class="students-empty"><div class="students-empty-icon">📄</div><div class="students-empty-text">Ma'lumot topilmadi</div></div>`}
      <div id="examResultsWrap"></div>
    `;

    box.querySelector("#addExamBtn").addEventListener("click", () => {
      const wrap = box.querySelector("#examFormWrap");
      const opening = wrap.style.display !== "block";
      wrap.style.display = opening ? "block" : "none";
      if (!opening) { wrap.innerHTML = ""; return; }
      wrap.innerHTML = `
        <div class="card">
          <label>Imtihon nomi</label>
          <input id="ex_name" type="text" placeholder="masalan: Midterm" />
          <label>Sana</label>
          <input id="ex_date" type="date" />
          <label>O'tish bali</label>
          <input id="ex_passing" type="number" min="0" />
          <label>Bo'lim</label>
          <input id="ex_section" type="text" placeholder="masalan: Grammar" />
          <label>Umumiy bal</label>
          <input id="ex_total" type="number" min="0" />
          <button class="primary" id="saveExamBtn">✅ Saqlash</button>
          <div id="examMsg" style="margin-top:8px;font-size:13px;"></div>
        </div>
      `;
      wrap.querySelector("#saveExamBtn").addEventListener("click", async () => {
        const msg = wrap.querySelector("#examMsg");
        const name = wrap.querySelector("#ex_name").value.trim();
        if (!name) {
          msg.innerHTML = `<span class="badge warn">❌ Imtihon nomi to'ldirilishi shart</span>`;
          return;
        }
        try {
          await api(`/api/my-groups/${groupId}/exams`, {
            method: "POST",
            body: JSON.stringify({
              name,
              exam_date: wrap.querySelector("#ex_date").value || null,
              passing_score: wrap.querySelector("#ex_passing").value ? Number(wrap.querySelector("#ex_passing").value) : null,
              section: wrap.querySelector("#ex_section").value.trim() || null,
              total_score: wrap.querySelector("#ex_total").value ? Number(wrap.querySelector("#ex_total").value) : null,
            }),
          });
          showToast("✅ Imtihon qo'shildi");
          exams = await api(`/api/my-groups/${groupId}/exams`);
          render(exams);
        } catch (err) {
          msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
        }
      });
    });

    box.querySelectorAll("[data-delete-exam]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const examId = Number(btn.dataset.deleteExam);
        showConfirm("Imtihonni o'chirish", "Bu imtihon butunlay o'chirilsinmi?", async () => {
          try {
            await api(`/api/my-groups/${groupId}/exams/${examId}`, { method: "DELETE" });
            showToast("🗑️ O'chirildi");
            exams = await api(`/api/my-groups/${groupId}/exams`);
            render(exams);
          } catch (err) {
            safeAlert("Xato: " + err.message);
          }
        });
      });
    });

    box.querySelectorAll("[data-grade-exam]").forEach((btn) => {
      btn.addEventListener("click", () => {
        _renderExamResults(box.querySelector("#examResultsWrap"), groupId, Number(btn.dataset.gradeExam));
      });
    });
  }

  render(exams);
}

async function _renderExamResults(wrap, groupId, examId) {
  wrap.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  let results;
  try {
    results = await api(`/api/my-groups/${groupId}/exams/${examId}/results`);
  } catch (err) {
    wrap.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
    return;
  }
  wrap.innerHTML = `
    <h2>Baholash</h2>
    <div class="card" style="overflow-x:auto;">
      <table>
        <thead><tr><th>O'quvchi</th><th>Bal</th><th>Tangalar</th><th></th></tr></thead>
        <tbody>
          ${results.map((r) => `
            <tr>
              <td>${r.full_name}</td>
              <td><input class="exam-score" type="number" min="0" data-student="${r.student_id}" value="${r.score ?? ""}" /></td>
              <td><input class="exam-coins" type="number" min="0" data-student="${r.student_id}" value="${r.coins ?? ""}" /></td>
              <td><button class="mini-btn" data-save-result="${r.student_id}">💾</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
  wrap.querySelectorAll("[data-save-result]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const studentId = Number(btn.dataset.saveResult);
      const score = wrap.querySelector(`.exam-score[data-student="${studentId}"]`).value;
      const coins = wrap.querySelector(`.exam-coins[data-student="${studentId}"]`).value;
      try {
        await api(`/api/my-groups/${groupId}/exams/${examId}/results`, {
          method: "POST",
          body: JSON.stringify({
            student_id: studentId,
            score: score === "" ? null : Number(score),
            coins: coins === "" ? null : Number(coins),
          }),
        });
        showToast("✅ Saqlandi");
      } catch (err) {
        safeAlert("Xato: " + err.message);
      }
    });
  });
}

async function _renderHistoryTab(box, g, groupId) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  let history;
  try {
    history = await api(`/api/my-groups/${groupId}/history`);
  } catch (err) {
    box.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
    return;
  }
  box.innerHTML = history.length
    ? `<div class="card">${history.map((h) => `
        <div class="row">
          <span class="label">${h.created_at}</span>
          <span class="value" style="text-align:right;">${h.event_text}</span>
        </div>
      `).join("")}</div>`
    : `<div class="students-empty"><div class="students-empty-icon">🕓</div><div class="students-empty-text">Hali tarix yo'q</div></div>`;
}

async function _renderCommentsTab(box, g, groupId) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  let comments;
  try {
    comments = await api(`/api/my-groups/${groupId}/comments`);
  } catch (err) {
    box.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
    return;
  }

  function render(comments) {
    box.innerHTML = `
      <div class="card">
        <textarea id="groupCommentInput" rows="3" placeholder="Izoh yozing..."></textarea>
        <button class="primary" id="addCommentBtn">➕ Qo'shish</button>
      </div>
      <div class="task-comments-list" style="margin-top:12px;">
        ${comments.length ? comments.map((c) => `
          <div class="task-comment-item">
            <div class="task-comment-text">${c.text}</div>
            <div class="task-comment-time">${c.created_at}</div>
          </div>
        `).join("") : ""}
      </div>
    `;
    box.querySelector("#addCommentBtn").addEventListener("click", async () => {
      const input = box.querySelector("#groupCommentInput");
      const text = input.value.trim();
      if (!text) return;
      try {
        await api(`/api/my-groups/${groupId}/comments`, { method: "POST", body: JSON.stringify({ text }) });
        comments = await api(`/api/my-groups/${groupId}/comments`);
        render(comments);
      } catch (err) {
        safeAlert("Xato: " + err.message);
      }
    });
  }

  render(comments);
}

async function renderGroupAssignStudents(box, groupId) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  let students;
  try {
    students = await api(`/api/my-groups/${groupId}/unassigned-students`);
  } catch (err) {
    box.innerHTML = `<div class="error-box">Xato: ${err.message}</div>`;
    return;
  }

  const listHtml = students.length
    ? students.map((s) => `
        <label class="check-row">
          <input type="checkbox" value="${s.id}" style="width:auto;margin:0;" />
          <span>${s.full_name}${s.class_grade ? ` · ${s.class_grade}-sinf` : ""}</span>
        </label>
      `).join("")
    : `<div class="students-empty">
        <div class="students-empty-icon">🎒</div>
        <div class="students-empty-text">Guruhsiz o'quvchi yo'q</div>
        <div class="students-empty-sub">Barcha o'quvchilar allaqachon biror guruhga biriktirilgan</div>
      </div>`;

  box.innerHTML = `
    <button class="back-btn" id="assignBackBtn">← Guruhga qaytish</button>
    <h1 style="margin-bottom:2px;">O'quvchi biriktirish</h1>
    <div class="teacher-sub" style="margin-bottom:14px;">Guruhga qo'shmoqchi bo'lgan o'quvchilarni tanlang</div>
    <div class="card" id="assignListCard">${listHtml}</div>
    <button class="primary" id="assignConfirmBtn" disabled>✅ Tanlanganlarni qo'shish (0)</button>
    <div id="assignMsg" style="margin-top:8px;font-size:13px;"></div>
  `;

  box.querySelector("#assignBackBtn").addEventListener("click", () => renderGroupDetail(box, groupId));

  const confirmBtn = box.querySelector("#assignConfirmBtn");
  function updateCount() {
    const n = box.querySelectorAll("#assignListCard input:checked").length;
    confirmBtn.textContent = `✅ Tanlanganlarni qo'shish (${n})`;
    confirmBtn.disabled = n === 0;
  }
  box.querySelectorAll("#assignListCard input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", updateCount);
  });

  confirmBtn.addEventListener("click", async () => {
    const ids = Array.from(box.querySelectorAll("#assignListCard input:checked")).map((cb) => Number(cb.value));
    const msg = box.querySelector("#assignMsg");
    confirmBtn.disabled = true;
    try {
      await api(`/api/my-groups/${groupId}/assign`, { method: "POST", body: JSON.stringify({ student_ids: ids }) });
      showToast("✅ Guruhga qo'shildi");
      renderGroupDetail(box, groupId);
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
      confirmBtn.disabled = false;
    }
  });
}

async function renderTasksTab(box, me) {
  const isOwner = me.role === "CEO" || me.role === "Director";

  box.innerHTML = `
    <div id="taskMySummaryWrap"><div class="center-box"><div class="spinner"></div></div></div>
    <div class="tabs" id="taskSubTabs">
      <div class="tab active" data-subtab="inbox">📥 Menga kelgan</div>
      <div class="tab" data-subtab="sent">📤 Men yuborgan</div>
      ${isOwner ? `<div class="tab" data-subtab="all">🗂️ Barchasi</div>` : ""}
    </div>
    <div style="display:flex;gap:8px;">
      <button class="primary" id="newTaskBtn" style="flex:1;">+ Yangi topshiriq</button>
      <button class="secondary" id="toggleFilterBtn" style="flex:0 0 auto;width:auto;padding:0 16px;">🔍 Filtr</button>
    </div>
    <div id="taskFilterWrap" style="display:none;"></div>
    <div id="taskFormWrap"></div>
    <div id="taskListWrap"><div class="center-box"><div class="spinner"></div></div></div>
  `;

  loadMySummary(box.querySelector("#taskMySummaryWrap"));

  let currentSubtab = "inbox";

  // Bildirishnomadan kelingan bo'lsa — kartochka qaysi ro'yxatda bo'lsa, o'shani ochamiz
  if (_pendingTaskFocus && _pendingTaskFocus.subtab && _pendingTaskFocus.subtab !== "inbox") {
    currentSubtab = _pendingTaskFocus.subtab;
    box.querySelectorAll("#taskSubTabs .tab").forEach((tabBtn) => {
      tabBtn.classList.toggle("active", tabBtn.dataset.subtab === currentSubtab);
    });
  }
  let filters = { sender: "all", status: "all" };
  const listWrap = box.querySelector("#taskListWrap");
  const formWrap = box.querySelector("#taskFormWrap");
  const filterWrap = box.querySelector("#taskFilterWrap");

  function renderFilterUI(tasks) {
    const senders = [...new Map(tasks.map((t) => [t.from_teacher_id, t.from_full_name])).entries()];
    filterWrap.innerHTML = `
      <div class="card" style="margin-top:0;">
        <label>Kim yubordi</label>
        <select id="filterSender">
          <option value="all">Barchasi</option>
          ${senders.map(([id, name]) => `<option value="${id}" ${filters.sender === id ? "selected" : ""}>${name}</option>`).join("")}
        </select>
        <label>Holat</label>
        <select id="filterStatus">
          <option value="all" ${filters.status === "all" ? "selected" : ""}>Barchasi</option>
          <option value="new" ${filters.status === "new" ? "selected" : ""}>🆕 Yangi</option>
          <option value="in_progress" ${filters.status === "in_progress" ? "selected" : ""}>🔄 Jarayonda</option>
          <option value="done" ${filters.status === "done" ? "selected" : ""}>✅ Bajarilgan</option>
          <option value="overdue" ${filters.status === "overdue" ? "selected" : ""}>⏰ Muddati o'tgan</option>
        </select>
      </div>
    `;
    filterWrap.querySelector("#filterSender").addEventListener("change", (e) => {
      filters.sender = e.target.value;
      renderList(tasks);
    });
    filterWrap.querySelector("#filterStatus").addEventListener("change", (e) => {
      filters.status = e.target.value;
      renderList(tasks);
    });
  }

  box.querySelector("#toggleFilterBtn").addEventListener("click", () => {
    filterWrap.style.display = filterWrap.style.display === "none" ? "block" : "none";
  });

  function applyFilters(tasks) {
    return tasks.filter((t) => {
      if (filters.sender !== "all" && t.from_teacher_id !== filters.sender) return false;
      if (filters.status === "overdue" && !t.is_overdue) return false;
      if (filters.status !== "all" && filters.status !== "overdue" && t.status !== filters.status) return false;
      return true;
    });
  }

  function renderList(allTasks) {
    const tasks = applyFilters(allTasks);

    if (!tasks.length) {
      listWrap.innerHTML = `<p style="color:var(--hint);font-size:13px;text-align:center;padding:20px 0;">Hozircha topshiriq yo'q</p>`;
      return;
    }

    listWrap.innerHTML = tasks.map((t) => {
      const statusInfo = TASK_STATUS_LABELS[t.status];
      const isRecipient = t.to_teacher_id === me.teacher_id || (!t.to_teacher_id && t.to_role === me.role);
      const canStart = isRecipient && t.status === "new" && currentSubtab !== "sent";
      const canMarkDone = isRecipient && t.status !== "done" && currentSubtab !== "sent";
      const createdLabel = _formatTaskCreatedAt(t.created_at);
      const studentInfoHtml = t.student_name ? `
        <div class="task-student-info">
          🎓 <b>${t.student_name}</b>${t.student_group ? ` · ${t.student_group} guruhi` : ""}${t.student_phone ? ` · ${t.student_phone}` : ""}
          ${t.student_problem_status ? `<span class="task-student-status">${t.student_problem_status}</span>` : ""}
        </div>
      ` : "";

      // Tezkorlik nishoni — o'yin elementi: tez javob bergan xodimlarni rag'batlantirish
      let speedBadge = "";
      if (t.in_progress_at && t.created_at) {
        const mins = (new Date(t.in_progress_at) - new Date(t.created_at)) / 60000;
        if (mins <= 15 && t.status !== "new") speedBadge = `<span class="task-speed-badge">⚡ Tezkor javob</span>`;
      }

      const penaltyHtml = t.is_overdue && t.penalty_amount > 0
        ? `<div class="task-penalty-row">⚠️ Muddati o'tgan — jarima: <b>${fmt(t.penalty_amount)}</b></div>`
        : "";

      return `
        <div class="task-card-v2 ${t.urgent ? "task-urgent" : ""} ${t.is_overdue ? "task-overdue-border" : ""}" id="taskCard_${t.id}">
          <div class="task-card-top">
            <span class="task-status-chip ${statusInfo.cls}">${statusInfo.label}</span>
            ${t.is_unread ? `<span class="task-unread-chip">${isRecipient ? "● O'qilmagan" : "◌ Hali ochilmagan"}</span>` : ""}
            ${t.urgent ? `<span class="task-urgent-chip">🔴 Shoshilinch</span>` : ""}
            ${speedBadge}
            <span class="task-daily-number">№${t.daily_number ?? "-"}</span>
          </div>

          <div class="task-card-parties">
            <span class="task-party-from">👤 ${t.from_full_name}</span>
            <span class="task-party-arrow">→</span>
            <span class="task-party-to">${t.to_display}</span>
          </div>

          <div class="task-text">${t.text}</div>
          ${studentInfoHtml}

          <div class="task-card-bottom-chips">
            ${t.category_label ? `<span class="task-category-chip">${t.category_label}</span>` : ""}
            <span class="task-created-chip">🕒 Yaratilgan: ${createdLabel}</span>
            ${t.deadline ? `<span class="task-deadline-chip ${t.is_overdue ? "task-deadline-overdue" : ""}">📅 Muddat: ${t.deadline}</span>` : ""}
            ${_taskTimeLeftHtml(t)}
          </div>
          ${penaltyHtml}

          <div class="task-actions-row">
            <button class="mini-btn task-comments-toggle" data-task-id="${t.id}">💬 Izohlar${t.comment_count > 0 ? " (" + t.comment_count + ")" : ""}</button>
            ${canStart ? `<button class="mini-btn task-start-btn" data-task-id="${t.id}">🔄 Jarayonda</button>` : ""}
            ${canMarkDone ? `<button class="mini-btn task-done-btn" data-task-id="${t.id}">✅ Bajarildi</button>` : ""}
          </div>
          <div class="task-comments-wrap" id="taskComments_${t.id}" style="display:none;"></div>
        </div>
      `;
    }).join("");

    listWrap.querySelectorAll(".task-comments-toggle").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const wrap = listWrap.querySelector(`#taskComments_${btn.dataset.taskId}`);
        if (wrap.style.display === "block") {
          wrap.style.display = "none";
          return;
        }
        wrap.style.display = "block";
        await renderTaskComments(wrap, btn.dataset.taskId, me);
      });
    });

    listWrap.querySelectorAll(".task-start-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/tasks/${btn.dataset.taskId}/start`, { method: "POST" });
          loadList();
          loadMySummary(box.querySelector("#taskMySummaryWrap"));
        } catch (err) {
          safeAlert("Xato: " + err.message);
        }
      });
    });

    listWrap.querySelectorAll(".task-done-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/tasks/${btn.dataset.taskId}/done`, { method: "POST" });
          loadList();
          loadMySummary(box.querySelector("#taskMySummaryWrap"));
        } catch (err) {
          safeAlert("Xato: " + err.message);
        }
      });
    });

    // Bildirishnoma bosilib kelingan bo'lsa — o'sha kartochkani ajratib ko'rsatamiz
    // va izohlarini darhol ochamiz.
    if (_pendingTaskFocus) {
      const { taskId } = _pendingTaskFocus;
      _pendingTaskFocus = null;
      const card = listWrap.querySelector(`#taskCard_${taskId}`);
      if (card) {
        card.classList.add("task-card-focused");
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        const commentsBtn = card.querySelector(".task-comments-toggle");
        if (commentsBtn) commentsBtn.click();
        setTimeout(() => card.classList.remove("task-card-focused"), 3000);
      }
    }
  }

  async function loadList() {
    listWrap.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const endpoint = currentSubtab === "inbox" ? "/api/tasks/inbox" : currentSubtab === "sent" ? "/api/tasks/sent" : "/api/tasks/all";
      const tasks = await api(endpoint);
      renderFilterUI(tasks);
      renderList(tasks);
      // Inbox ochilganda server topshiriqlarni "ko'rilgan" deb belgilaydi —
      // qo'ng'iroqcha hisoblagichi ham shu zahoti yangilansin.
      if (currentSubtab === "inbox") _refreshUnreadBell();
    } catch (err) {
      listWrap.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  box.querySelectorAll("#taskSubTabs .tab").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      box.querySelectorAll("#taskSubTabs .tab").forEach((x) => x.classList.remove("active"));
      tabBtn.classList.add("active");
      currentSubtab = tabBtn.dataset.subtab;
      formWrap.innerHTML = "";
      loadList();
    });
  });

  box.querySelector("#newTaskBtn").addEventListener("click", async () => {
    if (formWrap.innerHTML) { formWrap.innerHTML = ""; return; }
    try {
      await renderNewTaskForm(formWrap, me, () => {
        formWrap.innerHTML = "";
        currentSubtab = "sent";
        box.querySelectorAll("#taskSubTabs .tab").forEach((x) => x.classList.remove("active"));
        box.querySelector('[data-subtab="sent"]').classList.add("active");
        loadList();
      });
    } catch (err) {
      safeAlert("Forma ochilmadi: " + err.message);
    }
  });

  await loadList();
}

async function renderTaskComments(box, taskId, me) {
  box.innerHTML = `<div class="center-box" style="min-height:40px;"><div class="spinner" style="width:20px;height:20px;"></div></div>`;
  try {
    const comments = await api(`/api/tasks/${taskId}/comments`);
    const commentsHtml = comments.length
      ? comments.map((c) => `
          <div class="task-comment-item">
            <div class="task-comment-author">${c.from_full_name}</div>
            <div class="task-comment-text">${c.text}</div>
            <div class="task-comment-time">${_formatTaskTime(c.created_at)}</div>
          </div>
        `).join("")
      : `<p style="font-size:12px;color:var(--hint);margin:6px 0;">Hali izoh yo'q</p>`;

    box.innerHTML = `
      <div class="task-comments-list">${commentsHtml}</div>
      <div class="task-comment-add">
        <input type="text" id="taskCommentInput_${taskId}" placeholder="Izoh yozing..." />
        <button class="mini-btn" id="taskCommentSend_${taskId}">Yuborish</button>
      </div>
    `;

    box.querySelector(`#taskCommentSend_${taskId}`).addEventListener("click", async () => {
      const input = box.querySelector(`#taskCommentInput_${taskId}`);
      const text = input.value.trim();
      if (!text) return;
      try {
        await api(`/api/tasks/${taskId}/comments`, { method: "POST", body: JSON.stringify({ text }) });
        input.value = "";
        renderTaskComments(box, taskId, me);
      } catch (err) {
        safeAlert("Xato: " + err.message);
      }
    });
  } catch (err) {
    box.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}

async function renderNewTaskForm(box, me, onCreated) {
  const employees = (await api("/api/employees/directory")).filter((e) => e.teacher_id !== me.teacher_id);
  const roles = [...new Set(employees.map((e) => e.role))];
  const categories = await api("/api/task-categories");
  const problemStatuses = await api("/api/task-problem-statuses");

  box.innerHTML = `
    <div class="card">
      <label>Kimga yuborilsin?</label>
      <select id="taskTargetType">
        <option value="person">Aniq xodimga</option>
        <option value="role">Butun rolga</option>
      </select>

      <div id="taskTargetPersonWrap">
        <label>Xodim</label>
        <select id="taskTargetPerson">
          ${employees.map((e) => `<option value="${e.teacher_id}">${e.full_name} (${ROLE_LABELS_UZ_JS[e.role] || e.role})</option>`).join("")}
        </select>
      </div>
      <div id="taskTargetRoleWrap" style="display:none;">
        <label>Rol</label>
        <select id="taskTargetRole">
          ${roles.map((r) => `<option value="${r}">${ROLE_LABELS_UZ_JS[r] || r}</option>`).join("")}
        </select>
      </div>

      <label>Topshiriq matni</label>
      <textarea id="taskText" rows="3" placeholder="Masalan: Aliyev Botir talabani muzlating"></textarea>

      <label>Kategoriya</label>
      <select id="taskCategory">
        ${categories.map((c) => `<option value="${c.key}">${c.icon ? c.icon + " " : ""}${c.label}</option>`).join("")}
      </select>

      <div id="taskStudentFieldsWrap">
        <label>O'quvchi ism-familyasi</label>
        <input id="taskStudentName" type="text" placeholder="masalan: Aliyev Botir" />

        <label>Guruh nomi</label>
        <input id="taskStudentGroup" type="text" placeholder="masalan: T2-Elementary" />

        <label>Tel raqami</label>
        <input id="taskStudentPhone" type="tel" placeholder="+998 XX XXX XX XX" />

        <label>Muammo statusi</label>
        <select id="taskStudentStatus">
          <option value="">-</option>
          ${problemStatuses.map((s) => `<option value="${s.label}">${s.label}</option>`).join("")}
        </select>
      </div>

      <label>Muddat (ixtiyoriy)</label>
      <input id="taskDeadline" type="date" min="${_todayDateStr()}" />

      <div style="display:flex;align-items:center;gap:8px;margin:10px 0;">
        <input id="taskUrgent" type="checkbox" style="width:auto;margin:0;" />
        <label style="margin:0;">🔴 Shoshilinch</label>
      </div>

      <button class="primary" id="taskSubmitBtn">Yuborish</button>
      <div id="taskFormMsg" style="margin-top:8px;font-size:13px;"></div>
    </div>
  `;

  const targetType = box.querySelector("#taskTargetType");
  const personWrap = box.querySelector("#taskTargetPersonWrap");
  const roleWrap = box.querySelector("#taskTargetRoleWrap");
  const categorySelect = box.querySelector("#taskCategory");
  const studentFieldsWrap = box.querySelector("#taskStudentFieldsWrap");
  const textArea = box.querySelector("#taskText");
  const nameInput = box.querySelector("#taskStudentName");
  const groupInput = box.querySelector("#taskStudentGroup");
  const phoneInput = box.querySelector("#taskStudentPhone");
  const statusSelect = box.querySelector("#taskStudentStatus");

  function toggleStudentFields() {
    studentFieldsWrap.style.display = categorySelect.value === "student" ? "block" : "none";
  }
  categorySelect.addEventListener("change", toggleStudentFields);
  toggleStudentFields();

  function autoFillText() {
    if (categorySelect.value !== "student" || !statusSelect.value) return;
    textArea.value = _studentTaskTextTemplate(
      statusSelect.value, nameInput.value.trim(), groupInput.value.trim(), phoneInput.value.trim()
    );
  }
  [nameInput, groupInput, phoneInput, statusSelect].forEach((inp) => {
    inp.addEventListener("input", autoFillText);
    inp.addEventListener("change", autoFillText);
  });

  targetType.addEventListener("change", () => {
    const isPerson = targetType.value === "person";
    personWrap.style.display = isPerson ? "block" : "none";
    roleWrap.style.display = isPerson ? "none" : "block";
  });

  box.querySelector("#taskSubmitBtn").addEventListener("click", async () => {
    const msg = box.querySelector("#taskFormMsg");
    const text = box.querySelector("#taskText").value.trim();
    if (!text) {
      msg.innerHTML = `<span class="badge warn">❌ Topshiriq matnini kiriting</span>`;
      return;
    }

    const payload = {
      text,
      urgent: box.querySelector("#taskUrgent").checked,
      category: categorySelect.value,
      deadline: box.querySelector("#taskDeadline").value || null,
    };
    if (categorySelect.value === "student") {
      payload.student_name = nameInput.value.trim() || null;
      payload.student_group = groupInput.value.trim() || null;
      payload.student_phone = phoneInput.value.trim() || null;
      payload.student_problem_status = statusSelect.value || null;
    }
    if (targetType.value === "person") {
      payload.to_teacher_id = box.querySelector("#taskTargetPerson").value;
    } else {
      payload.to_role = box.querySelector("#taskTargetRole").value;
    }

    msg.textContent = "Yuborilmoqda...";
    try {
      await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
      msg.innerHTML = `<span class="badge ok">✅ Yuborildi</span>`;
      setTimeout(() => onCreated(), 500);
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
    }
  });
}

// ============================================================
// ASOSIY QOIDALAR — Teacher va Edu Manager KPI qoidalarini tushuntirish
// ============================================================

async function renderKpiRulesTab(box) {
  box.innerHTML = `
    <div class="teacher-hero" style="padding:20px 16px;">
      <div style="font-size:36px;">📜</div>
      <h1 style="margin:6px 0 2px;font-size:18px;">Asosiy qoidalar</h1>
      <div class="teacher-sub">KPI qanday hisoblanishini bilib oling</div>
    </div>
    <div class="menu-grid">
      <div class="menu-card" data-rule="teacher">
        <div class="menu-icon">👨‍🏫</div>
        <div class="menu-text">
          <div class="menu-label">O'qituvchi (Teacher)</div>
          <div class="menu-desc">7 mezonli KPI tizimi — qanday baholanadi</div>
        </div>
        <div class="menu-arrow">›</div>
      </div>
      <div class="menu-card" data-rule="edumanager">
        <div class="menu-icon">🎓</div>
        <div class="menu-text">
          <div class="menu-label">Ta'lim menejeri (Edu Manager)</div>
          <div class="menu-desc">6 mezonli vaznli KPI tizimi — qanday baholanadi</div>
        </div>
        <div class="menu-arrow">›</div>
      </div>
    </div>
  `;

  box.querySelectorAll("[data-rule]").forEach((card) => {
    card.addEventListener("click", () => {
      if (card.dataset.rule === "teacher") renderTeacherKpiRules(box);
      else renderEduManagerKpiRules(box);
    });
  });
}

function _ruleCriterionCard(icon, label, sub, tableRows, tableHeaders) {
  const id = "rc_" + Math.random().toString(36).slice(2, 9);
  return `
    <div class="rule-criterion-card">
      <div class="rule-criterion-head" data-toggle="${id}">
        <span class="rule-criterion-icon">${icon}</span>
        <div class="rule-criterion-titles">
          <div class="rule-criterion-label">${label}</div>
          ${sub ? `<div class="rule-criterion-sub">${sub}</div>` : ""}
        </div>
        <span class="rule-criterion-chevron">⌄</span>
      </div>
      <div class="rule-criterion-body" id="${id}" style="display:none;">
        <table class="rule-table">
          <thead><tr>${tableHeaders.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>${tableRows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    </div>
  `;
}

function _wireRuleToggles(box) {
  box.querySelectorAll("[data-toggle]").forEach((head) => {
    head.addEventListener("click", () => {
      const body = box.querySelector(`#${head.dataset.toggle}`);
      const isOpen = body.style.display === "block";
      body.style.display = isOpen ? "none" : "block";
      head.querySelector(".rule-criterion-chevron").textContent = isOpen ? "⌄" : "︿";
    });
  });
}

function renderTeacherKpiRules(box) {
  box.innerHTML = `
    <button class="back-btn" id="rulesBackBtn">← Orqaga</button>
    <div class="rule-hero rule-hero-teacher">
      <div style="font-size:32px;">👨‍🏫</div>
      <h2 style="margin:6px 0 0;color:#fff;">O'qituvchi KPI qoidalari</h2>
    </div>

    <div class="rule-step-card">
      <div class="rule-step-num">1</div>
      <div class="rule-step-text"><b>7 ta mezon</b> baholanadi, har biri o'z maksimal balliga ega. Ballar oddiy yig'indi bilan qo'shiladi — <b>maksimal 100 ball</b>.</div>
    </div>

    ${_ruleCriterionCard("🔁", "Retention", "Maksimal 25 ball", [
      ["≥ 97%", "25 ball"], ["≥ 95%", "22 ball"], ["≥ 93%", "19 ball"], ["≥ 91%", "15 ball"],
      ["≥ 89%", "10 ball"], ["≥ 87%", "5 ball"], ["< 87%", "0 ball"],
    ], ["Retention foizi", "Ball"])}

    ${_ruleCriterionCard("📈", "Student Progress", "Maksimal 25 ball", [
      ["≥ 90%", "25 ball"], ["≥ 85%", "22 ball"], ["≥ 80%", "19 ball"], ["≥ 75%", "15 ball"],
      ["≥ 70%", "10 ball"], ["≥ 65%", "5 ball"], ["< 65%", "0 ball"],
    ], ["Progress foizi", "Ball"])}

    ${_ruleCriterionCard("🗓️", "Attendance", "Maksimal 10 ball", [
      ["≥ 92%", "10 ball"], ["≥ 90%", "9 ball"], ["≥ 88%", "8 ball"], ["≥ 86%", "7 ball"],
      ["≥ 84%", "6 ball"], ["≥ 82%", "4 ball"], ["≥ 80%", "2 ball"], ["< 80%", "0 ball"],
    ], ["Davomat foizi", "Ball"])}

    ${_ruleCriterionCard("📝", "Homework Completion", "Maksimal 10 ball", [
      ["≥ 90%", "10 ball"], ["≥ 85%", "9 ball"], ["≥ 80%", "8 ball"], ["≥ 75%", "7 ball"],
      ["≥ 70%", "5 ball"], ["≥ 65%", "3 ball"], ["≥ 60%", "1 ball"], ["< 60%", "0 ball"],
    ], ["Homework foizi", "Ball"])}

    ${_ruleCriterionCard("👀", "Observation", "Maksimal 15 ball · Chiziqli", [
      ["Kiritilgan ball (0-25) ÷ 25 × 15 = Ball", "Masalan: 20/25 → 12 ball"],
    ], ["Formula", "Misol"])}

    ${_ruleCriterionCard("💬", "Student Feedback", "Maksimal 10 ball", [
      ["≥ 9.5", "10 ball"], ["≥ 9.0", "9 ball"], ["≥ 8.5", "8 ball"], ["≥ 8.0", "6 ball"],
      ["≥ 7.5", "4 ball"], ["≥ 7.0", "2 ball"], ["< 7.0", "0 ball"],
    ], ["O'rtacha ball (0-10)", "Ball"])}

    ${_ruleCriterionCard("💻", "Platforma intizomi", "Maksimal 5 ball · Chiziqli", [
      ["Kiritilgan ball (0-5) ÷ 5 × 5 = Ball", "Masalan: 4/5 → 4 ball"],
    ], ["Formula", "Misol"])}

    <div class="rule-step-card">
      <div class="rule-step-num">2</div>
      <div class="rule-step-text">Barcha 7 ta ball <b>qo'shiladi</b> = <b>Yakuniy KPI foizi</b> (0-100%).</div>
    </div>

    <div class="rule-step-card rule-step-warning">
      <div class="rule-step-num">⚠️</div>
      <div class="rule-step-text"><b>Minimal KPI foizi</b> (Sozlamalarda belgilangan): agar Yakuniy KPI foizi shu chegaradan <b>past</b> bo'lsa, KPI summasi butunlay <b>0</b> bo'ladi. Chegaraga yetsa — to'liq, haqiqiy foiz bo'yicha to'lanadi.</div>
    </div>

    <div class="rule-step-card">
      <div class="rule-step-num">💰</div>
      <div class="rule-step-text"><b>KPI summasi</b> = KPI fondi (Fix × KPI foizi sozlamasi) × Yakuniy KPI foizi ÷ 100</div>
    </div>
  `;
  _wireRuleToggles(box);
  box.querySelector("#rulesBackBtn").addEventListener("click", () => renderKpiRulesTab(box));
}

function renderEduManagerKpiRules(box) {
  box.innerHTML = `
    <button class="back-btn" id="rulesBackBtn">← Orqaga</button>
    <div class="rule-hero rule-hero-edu">
      <div style="font-size:32px;">🎓</div>
      <h2 style="margin:6px 0 0;color:#fff;">Ta'lim menejeri KPI qoidalari</h2>
    </div>

    <div class="rule-step-card">
      <div class="rule-step-num">1</div>
      <div class="rule-step-text"><b>6 ta mezon</b> baholanadi, lekin bu safar har birining o'z <b>og'irligi (vazni)</b> bor — bular <b>vaznli o'rtacha</b> tarzida qo'shiladi (Teacher'dan farqli).</div>
    </div>

    ${_ruleCriterionCard("🔁", "Retention", "Vazn: 30%", [
      ["≥ 98%", "100%"], ["≥ 97%", "93.3%"], ["≥ 96%", "86.7%"], ["≥ 95%", "80%"],
      ["≥ 94%", "66.7%"], ["≥ 93%", "53.3%"], ["≥ 92%", "40%"], ["≥ 91%", "26.7%"], ["< 91%", "0%"],
    ], ["Retention foizi", "Ball foizi"])}

    ${_ruleCriterionCard("👨‍🏫", "Teacher Performance", "Vazn: 20%", [
      ["≥ 90", "100%"], ["≥ 88", "90%"], ["≥ 86", "80%"], ["≥ 84", "70%"],
      ["≥ 82", "50%"], ["≥ 80", "30%"], ["< 80", "0%"],
    ], ["O'qituvchilar o'rtacha bali", "Ball foizi"])}

    ${_ruleCriterionCard("📈", "Student Results o'sishi", "Vazn: 20%", [
      ["≥ 8%", "100%"], ["≥ 6%", "90%"], ["≥ 4%", "80%"], ["≥ 2%", "60%"],
      ["≥ 0%", "40%"], ["< 0% (manfiy)", "0%"],
    ], ["Oldingi oyga nisbatan o'sish", "Ball foizi"])}

    ${_ruleCriterionCard("🗓️", "Attendance", "Vazn: 10%", [
      ["≥ 95%", "100%"], ["≥ 94%", "90%"], ["≥ 93%", "80%"], ["≥ 92%", "70%"],
      ["≥ 91%", "60%"], ["≥ 90%", "50%"], ["< 90%", "0%"],
    ], ["Davomat foizi", "Ball foizi"])}

    ${_ruleCriterionCard("📝", "Homework", "Vazn: 10%", [
      ["≥ 90%", "100%"], ["≥ 88%", "90%"], ["≥ 86%", "80%"], ["≥ 84%", "70%"],
      ["≥ 82%", "60%"], ["≥ 80%", "50%"], ["< 80%", "0%"],
    ], ["Homework foizi", "Ball foizi"])}

    ${_ruleCriterionCard("🏫", "Group Occupancy", "Vazn: 10%", [
      ["≥ 95%", "100%"], ["≥ 93%", "90%"], ["≥ 91%", "80%"], ["≥ 89%", "70%"],
      ["≥ 87%", "60%"], ["≥ 85%", "50%"], ["< 85%", "0%"],
    ], ["Guruhlar to'lganlik foizi", "Ball foizi"])}

    <div class="rule-step-card">
      <div class="rule-step-num">2</div>
      <div class="rule-step-text">
        <b>Yakuniy KPI foizi</b> = (Retention×30%) + (Teacher Perf×20%) + (Student Results×20%) + (Attendance×10%) + (Homework×10%) + (Occupancy×10%)
      </div>
    </div>

    <div class="rule-step-card rule-step-danger">
      <div class="rule-step-num">🔒</div>
      <div class="rule-step-text">
        <b>Ikkilamchi Gate</b> (faqat Edu Manager uchun): agar <b>"Hisobot tasdiqlangan"</b> yoki <b>"Ma'lumot haqqoniy"</b> katakchalaridan biri belgilanmagan bo'lsa — ball qanchalik yuqori bo'lmasin, KPI summasi butunlay <b>0</b> bo'ladi.
      </div>
    </div>

    <div class="rule-step-card rule-step-warning">
      <div class="rule-step-num">⚠️</div>
      <div class="rule-step-text"><b>Minimal KPI foizi</b> (Sozlamalarda belgilangan): ikkala katakcha ✅ bo'lsa ham, agar Yakuniy KPI foizi shu chegaradan past bo'lsa — KPI summasi baribir <b>0</b> bo'ladi.</div>
    </div>

    <div class="rule-step-card">
      <div class="rule-step-num">💰</div>
      <div class="rule-step-text"><b>KPI summasi</b> = KPI fondi (Oylik maosh × KPI foizi sozlamasi) × Yakuniy KPI foizi ÷ 100</div>
    </div>
  `;
  _wireRuleToggles(box);
  box.querySelector("#rulesBackBtn").addEventListener("click", () => renderKpiRulesTab(box));
}

const GRADE_ORDER = ["T5", "T4", "T3", "T2", "T1", "T0"];

async function renderEduTeachersTab(box) {
  box.innerHTML = `
    ${_monthSelectHtml("etMonth")}
    <div id="etResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;
  const select = box.querySelector("#etMonth");

  async function load() {
    const resultBox = box.querySelector("#etResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const employees = await api("/api/employees");
      const teachers = employees.filter((e) => e.role === "Teacher");
      teachers.sort((a, b) => {
        const ga = GRADE_ORDER.indexOf(a.grade), gb = GRADE_ORDER.indexOf(b.grade);
        if (ga !== gb) return ga - gb;
        return a.full_name.localeCompare(b.full_name);
      });

      const itemsHtml = teachers.map((t, i) => `
        <div class="teacher-rank-item">
          <div class="rank-num-circle">${i + 1}</div>
          <div class="teacher-rank-name">${t.full_name}</div>
          <span class="grade-chip">${t.grade || "-"}</span>
          <span class="stavka-chip">${t.workload_rate} stavka</span>
        </div>
      `).join("");

      resultBox.innerHTML = `
        <p style="font-size:12px;color:var(--hint);margin-bottom:10px;">${select.value} — jami ${teachers.length} o'qituvchi (daraja bo'yicha tartiblangan)</p>
        ${itemsHtml || "<p style='color:var(--hint);font-size:13px;'>Ma'lumot yo'q</p>"}
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  select.addEventListener("change", load);
  load();
}

function _kpiColorClass(percent) {
  if (percent >= 90) return "green";
  if (percent >= 80) return "yellow";
  return "red";
}

async function renderEduKpiTab(box) {
  box.innerHTML = `
    ${_monthSelectHtml("ekMonth")}
    <div id="ekResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;
  const select = box.querySelector("#ekMonth");
  const medals = ["🥇", "🥈", "🥉"];

  async function load() {
    const resultBox = box.querySelector("#ekResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const data = await api(`/api/kpi-ranking?month=${select.value}`);

      const missingHtml = data.missing_scorecard.length
        ? `<div class="gate-warning">⚠️ Scorecard kiritilmagan: ${data.missing_scorecard.map((m) => m.full_name).join(", ")}</div>`
        : "";

      const itemsHtml = data.ranked.map((r, i) => `
        <div class="kpi-rank-item">
          <div class="rank-num-circle">${medals[i] || i + 1}</div>
          <div class="teacher-rank-name">${r.full_name}<br/><span style="font-size:11px;color:var(--hint);font-weight:400;">${r.grade || "-"}</span></div>
          <span class="kpi-chip ${_kpiColorClass(r.kpi_percent)}">${r.kpi_percent}%</span>
        </div>
      `).join("");

      resultBox.innerHTML = `
        ${missingHtml}
        <div class="legend-row">
          <span class="legend-item"><span class="legend-dot green"></span> 90%+</span>
          <span class="legend-item"><span class="legend-dot yellow"></span> 80-89%</span>
          <span class="legend-item"><span class="legend-dot red"></span> &lt;80%</span>
        </div>
        ${itemsHtml || "<p style='color:var(--hint);font-size:13px;'>Ma'lumot yo'q</p>"}
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  select.addEventListener("change", load);
  load();
}

async function renderEduReportsTab(box) {
  box.innerHTML = `
    ${_monthSelectHtml("erMonth")}
    <div id="erResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;
  const select = box.querySelector("#erMonth");

  async function load() {
    const resultBox = box.querySelector("#erResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const s = await api(`/api/reports/kpi-summary?month=${select.value}`);

      const missingHtml = s.missing_scorecard.length
        ? `<div class="gate-warning">⚠️ Scorecard kiritilmagan: ${s.missing_scorecard.map((m) => m.full_name).join(", ")}</div>`
        : "";

      const trendRows = s.trend.map((t) => `
        <tr>
          <td>${t.month}</td>
          <td>${t.avg_kpi_percent !== null ? t.avg_kpi_percent + "%" : "-"}</td>
        </tr>
      `).join("");

      resultBox.innerHTML = `
        <div class="total-box">
          <div class="caption">${s.month} — o'rtacha KPI</div>
          <div class="amount">${s.avg_kpi_percent !== null ? s.avg_kpi_percent + "%" : "-"}</div>
        </div>
        ${missingHtml}
        <div class="dash-grid">
          <div class="dash-card"><div class="dash-num">${s.teacher_count}</div><div class="dash-label">Jami o'qituvchi</div></div>
          <div class="dash-card"><div class="dash-num" style="color:var(--green)">${s.green_count}</div><div class="dash-label">90%+ natija</div></div>
          <div class="dash-card"><div class="dash-num" style="color:#a6790a">${s.yellow_count}</div><div class="dash-label">80-89% natija</div></div>
          <div class="dash-card"><div class="dash-num" style="color:var(--red)">${s.red_count}</div><div class="dash-label">80% dan past</div></div>
        </div>
        <h2>Oxirgi 6 oy — o'rtacha KPI</h2>
        <div class="card" style="overflow-x:auto;">
          <table>
            <thead><tr><th>Oy</th><th>O'rtacha KPI</th></tr></thead>
            <tbody>${trendRows}</tbody>
          </table>
        </div>
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  select.addEventListener("change", load);
  load();
}

// ---------- DASHBOARD TAB ----------

async function loadAiSummary(box, month) {
  box.innerHTML = `<div class="center-box" style="min-height:60px;"><div class="spinner"></div></div>`;
  try {
    const res = await api(`/api/dashboard/ai-summary?month=${month}`);
    renderAiSummaryState(box, month, res.exists ? res : null);
  } catch (err) {
    box.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}

function renderAiSummaryState(box, month, cached) {
  if (!cached) {
    box.innerHTML = `
      <div class="ai-summary-card ai-summary-empty">
        <div class="ai-summary-empty-text">🤖 Bu oy uchun AI xulosasi hali olinmagan</div>
        <button class="primary" id="genAiSummaryBtn">✨ AI xulosasini olish</button>
      </div>
    `;
  } else {
    const genDate = cached.generated_at ? cached.generated_at.slice(0, 16).replace("T", " ") : "";
    box.innerHTML = `
      <div class="ai-summary-card">
        <div class="ai-summary-head">
          <span>🤖 AI xulosasi</span>
          <button class="mini-btn" id="refreshAiSummaryBtn">🔄 Yangilash</button>
        </div>
        <div class="ai-summary-text">${cached.summary.replace(/\n/g, "<br/>")}</div>
        <div class="ai-summary-time">Yaratilgan: ${genDate}</div>
      </div>
    `;
    box.querySelector("#refreshAiSummaryBtn").addEventListener("click", () => generateAiSummary(box, month));
  }

  const genBtn = box.querySelector("#genAiSummaryBtn");
  if (genBtn) genBtn.addEventListener("click", () => generateAiSummary(box, month));
}

async function generateAiSummary(box, month) {
  box.innerHTML = `
    <div class="ai-summary-card ai-summary-loading">
      <div class="spinner" style="width:22px;height:22px;margin:0 auto 8px;"></div>
      <div style="text-align:center;font-size:12px;color:var(--hint);">AI ma'lumotlarni tahlil qilmoqda...</div>
    </div>
  `;
  try {
    const res = await api(`/api/dashboard/ai-summary?month=${month}`, { method: "POST" });
    renderAiSummaryState(box, month, res);
  } catch (err) {
    box.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}

async function renderDashboardTab(box) {
  box.innerHTML = `
    <div class="month-picker">
      <label style="margin:0;">Oy:</label>
      <select id="dMonth"></select>
    </div>
    <div id="dResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;
  const select = box.querySelector("#dMonth");
  lastNMonths(6).forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m; opt.textContent = m;
    select.appendChild(opt);
  });

  async function load() {
    const resultBox = box.querySelector("#dResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const d = await api(`/api/dashboard?month=${select.value}`);
      const { start, end } = _monthDateRange(select.value);
      let range = null;
      try {
        range = await api(`/api/company-metrics/range?start=${start}&end=${end}`);
      } catch (e) {
        range = null;
      }

      let diffHtml = "";
      if (d.prev_total_expense > 0) {
        const diff = d.total_expense - d.prev_total_expense;
        const diffPct = ((diff / d.prev_total_expense) * 100).toFixed(1);
        diffHtml = `<div style="font-size:12px;margin-top:4px;">${diff >= 0 ? "▲" : "▼"} ${Math.abs(diffPct)}% o'tgan oyga nisbatan</div>`;
      }

      const missingHtml = d.missing_scorecard.length
        ? `<div class="gate-warning">⚠️ Scorecard kiritilmagan: ${d.missing_scorecard.map((m) => m.full_name).join(", ")}</div>`
        : "";
      const medals = ["🥇", "🥈", "🥉"];
      const top3Html = d.top3.length
        ? `<div class="rank-list">${d.top3.map((t, i) => `
            <div class="rank-item rank-top">
              <span class="rank-medal">${medals[i] || "🎖️"}</span>
              <span class="rank-name">${t.full_name}</span>
              <span class="rank-percent good">${t.kpi_percent}%</span>
            </div>
          `).join("")}</div>`
        : `<p style="color:var(--hint);font-size:13px;margin:0;">70% dan yuqori natija ko'rsatgan o'qituvchi hali yo'q</p>`;

      const bottom3Html = d.bottom3.length
        ? `<div class="rank-list">${d.bottom3.map((t) => `
            <div class="rank-item rank-bottom">
              <span class="rank-medal">⚠️</span>
              <span class="rank-name">${t.full_name}</span>
              <span class="rank-percent bad">${t.kpi_percent}%</span>
            </div>
          `).join("")}</div>`
        : `<p style="color:var(--hint);font-size:13px;margin:0;">Ma'lumot yo'q</p>`;

      // Tushum vs Xarajat taqqoslash paneli
      let compareHtml = "";
      if (d.total_revenue !== null) {
        const maxVal = Math.max(d.total_revenue, d.total_expense, 1);
        const revPct = Math.min(100, (d.total_revenue / maxVal) * 100);
        const expPct = Math.min(100, (d.total_expense / maxVal) * 100);
        compareHtml = `
          <h2>Rentabellik</h2>
          <div class="compare-panel">
            <div class="compare-row">
              <div class="compare-row-head"><span class="compare-label">Umumiy tushum</span><span class="compare-value">${fmt(d.total_revenue)}</span></div>
              <div class="compare-bar-track"><div class="compare-bar-fill revenue" style="width:${revPct}%;"></div></div>
            </div>
            <div class="compare-row">
              <div class="compare-row-head"><span class="compare-label">Umumiy xarajat</span><span class="compare-value">${fmt(d.total_expense)}</span></div>
              <div class="compare-bar-track"><div class="compare-bar-fill expense" style="width:${expPct}%;"></div></div>
            </div>
            <div class="row" style="margin-top:4px;padding-top:10px;border-top:1px dashed #e5e5ea;">
              <span class="label">Sof foyda</span>
              <span class="value" style="color:${d.total_profit >= 0 ? "var(--green)" : "var(--red)"}">${fmt(d.total_profit)}</span>
            </div>
          </div>
        `;
      } else {
        compareHtml = `<p style="font-size:12px;color:var(--hint);">💡 "Tushum" bo'limida oylik tushumni kiritsangiz, bu yerda sof foyda ham chiqadi.</p>`;
      }

      // Kompaniya ko'rsatkichlari (rol asosidagi tasdiqlangan kunlik ma'lumotlardan)
      let companyStatsHtml = "";
      if (range && range.days_with_data > 0) {
        const s = range.sums;
        const conversion = s.trial_count > 0 ? Math.round((s.sales_count / s.trial_count) * 100) : null;
        const growthChipClass = range.aggregate_growth === null ? "" : range.aggregate_growth >= 0 ? "up" : "down";
        const growthChipHtml = range.aggregate_growth !== null
          ? `<div class="growth-chip ${growthChipClass}">${range.aggregate_growth >= 0 ? "▲" : "▼"} ${Math.abs(range.aggregate_growth)} o'quvchi (oylik o'sish)</div>`
          : "";

        companyStatsHtml = `
          <h2>🏢 Kompaniya ko'rsatkichlari</h2>
          ${growthChipHtml ? `<div style="text-align:center;margin-bottom:10px;">${growthChipHtml}</div>` : ""}
          <div class="stat-grid">
            <div class="stat-mini"><div class="stat-mini-icon">🆕</div><div class="stat-mini-num">${s.new_admissions}</div><div class="stat-mini-label">Yangi qabul</div></div>
            <div class="stat-mini"><div class="stat-mini-icon">💼</div><div class="stat-mini-num">${s.sales_count}</div><div class="stat-mini-label">Sotuv soni</div></div>
            <div class="stat-mini"><div class="stat-mini-icon">🎯</div><div class="stat-mini-num">${conversion !== null ? conversion + "%" : "-"}</div><div class="stat-mini-label">Konversiya</div></div>
            <div class="stat-mini"><div class="stat-mini-icon">📅</div><div class="stat-mini-num">${range.avg_attendance_percent !== null ? range.avg_attendance_percent + "%" : "-"}</div><div class="stat-mini-label">O'rtacha davomat</div></div>
            <div class="stat-mini"><div class="stat-mini-icon">⚠️</div><div class="stat-mini-num">${s.risky_count}</div><div class="stat-mini-label">Xavfli o'quvchi</div></div>
            <div class="stat-mini"><div class="stat-mini-icon">🧊</div><div class="stat-mini-num">${s.frozen_count}</div><div class="stat-mini-label">Muzlatilgan</div></div>
            <div class="stat-mini"><div class="stat-mini-icon">🚪</div><div class="stat-mini-num">${s.left_count}</div><div class="stat-mini-label">Chiqib ketgan</div></div>
            <div class="stat-mini"><div class="stat-mini-icon">😠</div><div class="stat-mini-num">${s.complaints_count}</div><div class="stat-mini-label">Shikoyatlar</div></div>
            <div class="stat-mini"><div class="stat-mini-icon">☎️</div><div class="stat-mini-num">${s.repeat_sales_calls}</div><div class="stat-mini-label">Qayta qo'ng'iroqlar</div></div>
          </div>
          <p style="font-size:11px;color:var(--hint);margin:-4px 0 12px;">${range.days_with_data} kunlik tasdiqlangan ma'lumot asosida</p>
        `;
      } else {
        companyStatsHtml = `<p style="font-size:12px;color:var(--hint);">💡 Kompaniya bo'limida xodimlarning kunlik ma'lumotlari tasdiqlangach, bu yerda to'liq statistika chiqadi.</p>`;
      }

      resultBox.innerHTML = `
        <div id="aiSummaryWrap"><div class="center-box" style="min-height:60px;"><div class="spinner"></div></div></div>

        <div class="total-box">
          <div class="caption">${d.month} — jami xarajat (FIX+KPI+Bonus)</div>
          <div class="amount">${fmt(d.total_expense)}</div>
          ${diffHtml}
        </div>
        ${missingHtml}
        <div class="dash-grid">
          <div class="dash-card"><div class="dash-card-icon">👥</div><div class="dash-num">${d.active_employees}</div><div class="dash-label">Faol xodim</div></div>
          <div class="dash-card"><div class="dash-card-icon">💳</div><div class="dash-num">${fmt(d.total_advance)}</div><div class="dash-label">Berilgan avans</div></div>
        </div>

        ${companyStatsHtml}

        <h2>Top-3 o'qituvchi (KPI)</h2>
        <div class="card">${top3Html}</div>
        <h2>E'tibor talab qiladi (past KPI)</h2>
        <div class="card">${bottom3Html}</div>
        ${compareHtml}
      `;

      loadAiSummary(box.querySelector("#aiSummaryWrap"), select.value);
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  select.addEventListener("change", load);
  load();
}

// ---------- KOMPANIYA KO'RSATKICHI TAB (kunlik) ----------

const CM_STUDENT_FIELDS = [
  { id: "start_active", label: "🌅 Kun boshidagi faol o'quvchilar soni", step: "1" },
  { id: "new_admissions", label: "🆕 Yangi qabul soni", step: "1" },
  { id: "sales_count", label: "💼 Sotuv soni", step: "1" },
  { id: "trial_count", label: "🧪 Sinov darsidagi o'quvchi soni", step: "1" },
  { id: "frozen_count", label: "🧊 Muzlatilgan o'quvchi soni", step: "1" },
  { id: "left_count", label: "🚪 Chiqib ketgan o'quvchi soni", step: "1" },
  { id: "risky_count", label: "⚠️ Xavfli o'quvchilar soni", step: "1" },
  { id: "attendance_percent", label: "📅 Davomat foizi (%)", step: "0.1" },
  { id: "end_active", label: "🌇 Kun oxiridagi faol o'quvchilar soni", step: "1" },
];

const CM_CONTACT_FIELDS = [
  { id: "repeat_sales_calls", label: "🔁 Qayta sotuv qo'ng'iroqlar soni", step: "1" },
  { id: "admin_contacted_clients", label: "📞 Administratorga bog'langan mijozlar soni", step: "1" },
  { id: "risky_contacted_count", label: "☎️ Xavfli o'quvchilar bilan bog'lanildi soni", step: "1" },
];

const CM_REVENUE_FIELDS = [
  { id: "click_revenue", label: "💳 Click tushum" },
  { id: "card_revenue", label: "🏦 Plastik tushum" },
  { id: "cash_revenue", label: "💵 Naqt tushum" },
];

const CM_EXPENSE_FIELDS = [
  { id: "click_expense", label: "💳 Click xarajat" },
  { id: "card_expense", label: "🏦 Plastik xarajat" },
  { id: "cash_expense", label: "💵 Naqt xarajat" },
];

function _cmNumberFieldsHtml(fields) {
  return fields.map((f) => `
    <div class="sc-field">
      <label>${f.label}</label>
      <input id="cm_${f.id}" type="number" step="${f.step}" min="0" />
    </div>
  `).join("");
}

// Pul maydonlari uchun: faqat qo'lda kiritish (spinner o'q-strelkalari yo'q),
// manfiyga tushmaydi, va "2 300 000" ko'rinishida ming-ming ajratib ko'rsatiladi.
function _cmMoneyFieldsHtml(fields) {
  return fields.map((f) => `
    <div class="sc-field">
      <label>${f.label}</label>
      <input id="cm_${f.id}" type="text" inputmode="numeric" placeholder="0" />
    </div>
  `).join("");
}

function _formatThousands(rawDigits) {
  if (!rawDigits) return "";
  return rawDigits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function _parseFormattedNumber(str) {
  const digits = (str || "").replace(/[^\d]/g, "");
  return digits === "" ? null : parseFloat(digits);
}

function _attachMoneyFormatting(input, onChange) {
  input.addEventListener("input", () => {
    const cursorFromEnd = input.value.length - input.selectionStart;
    const digits = input.value.replace(/[^\d]/g, "");
    const formatted = _formatThousands(digits);
    input.value = formatted;
    const newPos = Math.max(0, formatted.length - cursorFromEnd);
    input.setSelectionRange(newPos, newPos);
    if (onChange) onChange();
  });
}

// O'zbekiston tel raqami: +998 XX XXX XX XX ko'rinishida jonli formatlash
function _formatUzPhone(raw) {
  let digits = (raw || "").replace(/\D/g, "");
  if (digits.startsWith("998")) digits = digits.slice(3);
  digits = digits.slice(0, 9);
  let out = "+998";
  if (digits.length > 0) out += " " + digits.slice(0, 2);
  if (digits.length > 2) out += " " + digits.slice(2, 5);
  if (digits.length > 5) out += " " + digits.slice(5, 7);
  if (digits.length > 7) out += " " + digits.slice(7, 9);
  return out;
}

// Formatlangan tel raqamdan saqlash uchun toza "+998XXXXXXXXX" qiymatini oladi (to'liq bo'lmasa null)
function _parseUzPhone(formatted) {
  let digits = (formatted || "").replace(/\D/g, "");
  if (digits.startsWith("998")) digits = digits.slice(3);
  digits = digits.slice(0, 9);
  return digits.length === 9 ? "+998" + digits : null;
}

function _todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function _smKpiBreakdownHtml(b) {
  if (!b) return "";
  const items = [
    { label: "📈 Konversiya bonusi", value: b.conversion_bonus, note: `${b.conversion_percent}% konversiya` },
    { label: "💼 Hajm bonusi (25+)", value: b.volume_bonus, note: `${b.total_sales} ta sotuv` },
    { label: "🏆 55+ milestone", value: b.milestone_bonus, note: b.total_sales >= 55 ? "erishildi" : "erishilmadi" },
    { label: "⭐ Combo bonus", value: b.combo_bonus, note: b.combo_bonus > 0 ? "80%+ va 60+ sotuv" : "shart bajarilmadi" },
  ];
  return `
    <div class="sm-kpi-breakdown">
      <div class="sm-kpi-breakdown-title">KPI qayerdan shakllandi:</div>
      ${items.map((it) => `
        <div class="sm-kpi-breakdown-item ${it.value > 0 ? "sm-kpi-active" : "sm-kpi-inactive"}">
          <span>${it.label} <span class="sm-kpi-note">(${it.note})</span></span>
          <b>${it.value > 0 ? "+" + fmt(it.value) : "0"}</b>
        </div>
      `).join("")}
      <div class="sm-kpi-breakdown-total">
        <span>Jami KPI summasi</span>
        <b>${fmt(b.conversion_bonus + b.volume_bonus + b.milestone_bonus + b.combo_bonus)}</b>
      </div>
    </div>
  `;
}

const SM_PENDING_LABELS = {
  repeat_calls_archive: "🔁 Qayta sotuv qo'ng'iroqlari",
  reinvite_count: "📨 Re-invite",
  new_admissions: "🆕 Yangi qabul",
  trial_booked: "🧪 Sinovga yozilgan",
  trial_attended: "✅ Sinovga kelgan",
  activated_count: "⚡ Faollashtirilgan",
  new_sales: "💼 Yangi sotuv",
  waiting_contact_count: "☎️ Kutishdagilar bilan aloqa",
};

const ADMIN_PENDING_LABELS = {
  admin_contacted_clients: "📞 Bog'langan mijozlar",
  risky_contacted_count: "☎️ Xavflilar bilan aloqa",
  frozen_count: "🧊 Muzlatilgan",
  frozen_reason: "🧊 Muzlatish sababi",
  left_count: "🚪 Chiqib ketgan",
  left_reason: "🚪 Chiqib ketish sababi",
  complaints_count: "😠 Shikoyatlar",
};

const EDU_PENDING_LABELS = {
  start_active: "🌅 Kun boshi faol o'quvchi",
  end_active: "🌇 Kun oxiri faol o'quvchi",
  attendance_percent: "📅 Davomat foizi",
  risky_count: "⚠️ Xavfli o'quvchilar",
};

async function _renderGenericPendingList(box, { apiPrefix, labels, onCount }) {
  box.innerHTML = `<div class="center-box" style="min-height:80px;"><div class="spinner"></div></div>`;
  try {
    const rows = await api(`/api/${apiPrefix}/pending`);
    if (onCount) onCount(rows.length);

    if (!rows.length) {
      box.innerHTML = `<p class="cm-approval-empty">✅ Kutilayotgan yozuv yo'q</p>`;
      return;
    }

    box.innerHTML = rows.map((r) => `
      <div class="sm-pending-item" data-key="${r.teacher_id}__${r.date}">
        <div class="sm-pending-header">
          <span class="sm-pending-name">${r.full_name}</span>
          <span class="sm-pending-date">${r.date}</span>
        </div>
        <div class="sm-pending-fields">
          ${Object.keys(labels).map((k) => `
            <div class="pf-item"><span class="pf-label">${labels[k]}</span><span class="pf-value">${r[k] ?? "-"}</span></div>
          `).join("")}
        </div>
        <div class="sm-pending-actions">
          <button class="secondary" data-reject="${r.teacher_id}__${r.date}">❌ Otkaz</button>
          <button class="primary" data-approve="${r.teacher_id}__${r.date}">✅ Tasdiqlash</button>
        </div>
      </div>
    `).join("");

    box.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [teacherId, date] = btn.dataset.approve.split("__");
        const row = rows.find((r) => r.teacher_id === teacherId && r.date === date);
        showConfirm(
          "Tasdiqlashni tasdiqlang",
          `<b>${row.full_name}</b>ning <b>${date}</b> kunlik ma'lumotlari tasdiqlansinmi? Bu amalni keyin bekor qilib bo'lmaydi.`,
          async () => {
            try {
              await api(`/api/${apiPrefix}/approve`, {
                method: "POST",
                body: JSON.stringify({ teacher_id: teacherId, date }),
              });
              _renderGenericPendingList(box, { apiPrefix, labels, onCount });
            } catch (err) {
              safeAlert("Xato: " + err.message);
            }
          }
        );
      });
    });

    box.querySelectorAll("[data-reject]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [teacherId, date] = btn.dataset.reject.split("__");
        const row = rows.find((r) => r.teacher_id === teacherId && r.date === date);
        showTextPromptModal(
          `${row.full_name} — ${date}`,
          "Nima uchun otkaz qilinmoqda? (ixtiyoriy izoh)",
          async (note) => {
            try {
              await api(`/api/${apiPrefix}/reject`, {
                method: "POST",
                body: JSON.stringify({ teacher_id: teacherId, date, note: note || null }),
              });
              _renderGenericPendingList(box, { apiPrefix, labels, onCount });
            } catch (err) {
              safeAlert("Xato: " + err.message);
            }
          }
        );
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="error-box">${err.message}</div>`;
    if (onCount) onCount(0);
  }
}

async function renderSMPendingList(box, onCount) {
  await _renderGenericPendingList(box, { apiPrefix: "sales-manager-daily", labels: SM_PENDING_LABELS, onCount });
}

async function renderAdminPendingList(box, onCount) {
  await _renderGenericPendingList(box, { apiPrefix: "administrator-daily", labels: ADMIN_PENDING_LABELS, onCount });
}

async function renderEduPendingList(box, onCount) {
  await _renderGenericPendingList(box, { apiPrefix: "edu-manager-daily", labels: EDU_PENDING_LABELS, onCount });
}

async function renderCompanyTab(box) {
  const allFieldDefs = [...CM_REVENUE_FIELDS, ...CM_EXPENSE_FIELDS];
  const allFieldIds = allFieldDefs.map((f) => f.id);
  const revenueIds = CM_REVENUE_FIELDS.map((f) => f.id);
  const expenseIds = CM_EXPENSE_FIELDS.map((f) => f.id);
  const moneyIds = [...revenueIds, ...expenseIds];

  const AUTO_FIELD_DEFS = [...CM_STUDENT_FIELDS, ...CM_CONTACT_FIELDS];

  box.innerHTML = `
    <div class="cm-approvals-card">
      <div class="cm-approvals-head">
        <span class="cm-approvals-icon">📋</span>
        <div>
          <div class="cm-approvals-title">Tasdiqlash kutilmoqda</div>
          <div class="cm-approvals-sub">Xodimlarning kunlik yozuvlarini ko'rib chiqing</div>
        </div>
      </div>

      <div class="cm-approval-group">
        <div class="cm-approval-group-title">
          <span>📞 Sotuv menejeri</span>
          <span class="cm-approval-count" id="smPendingCount"></span>
        </div>
        <div id="smPendingList"><div class="center-box" style="min-height:80px;"><div class="spinner"></div></div></div>
      </div>

      <div class="cm-approval-group">
        <div class="cm-approval-group-title">
          <span>🗂️ Administrator</span>
          <span class="cm-approval-count" id="adminPendingCount"></span>
        </div>
        <div id="adminPendingList"><div class="center-box" style="min-height:80px;"><div class="spinner"></div></div></div>
      </div>

      <div class="cm-approval-group">
        <div class="cm-approval-group-title">
          <span>🎓 Ta'lim menejeri</span>
          <span class="cm-approval-count" id="eduPendingCount"></span>
        </div>
        <div id="eduPendingList"><div class="center-box" style="min-height:80px;"><div class="spinner"></div></div></div>
      </div>
    </div>

    <div class="card">
      <label>Sana</label>
      <input type="date" id="cmDate" value="${_todayStr()}" />
    </div>
    <div id="cmGrowthBanner"></div>

    <h2>🎒 Talabalar harakati <span style="font-size:10px;color:var(--hint);text-transform:none;">(xodimlar ma'lumotlaridan avtomatik)</span></h2>
    <div class="card" id="cmAutoSummary"></div>

    <h2>💰 Tushum</h2>
    <div class="card sc-form">${_cmMoneyFieldsHtml(CM_REVENUE_FIELDS)}</div>
    <div id="cmRevenueTotal" class="total-box"></div>

    <h2>💸 Xarajat</h2>
    <div class="card sc-form">${_cmMoneyFieldsHtml(CM_EXPENSE_FIELDS)}</div>
    <div id="cmExpenseTotal" class="total-box"></div>

    <button class="primary" id="cmSaveBtn">Saqlash</button>
    <div id="cmMsg" style="margin-top:8px;font-size:13px;"></div>

    <h2>📅 Kunlik tarix</h2>
    <div id="cmHistory"><div class="center-box"><div class="spinner"></div></div></div>
  `;

  function setPendingCount(id, count) {
    const el = box.querySelector(id);
    if (!el) return;
    el.textContent = count > 0 ? String(count) : "";
    el.classList.toggle("cm-approval-count-visible", count > 0);
  }

  await renderSMPendingList(box.querySelector("#smPendingList"), (c) => setPendingCount("#smPendingCount", c));
  await renderAdminPendingList(box.querySelector("#adminPendingList"), (c) => setPendingCount("#adminPendingCount", c));
  await renderEduPendingList(box.querySelector("#eduPendingList"), (c) => setPendingCount("#eduPendingCount", c));

  const dateInput = box.querySelector("#cmDate");

  function renderAutoSummary(data) {
    const summaryBox = box.querySelector("#cmAutoSummary");
    summaryBox.innerHTML = AUTO_FIELD_DEFS.map((f) => `
      <div class="row"><span class="label">${f.label}</span><span class="value">${data && data[f.id] !== null && data[f.id] !== undefined ? data[f.id] : "—"}</span></div>
    `).join("");
  }

  function updateComputedTotals() {
    const rev = revenueIds.reduce((sum, id) => {
      const v = _parseFormattedNumber(box.querySelector(`#cm_${id}`).value);
      return sum + (v || 0);
    }, 0);
    const exp = expenseIds.reduce((sum, id) => {
      const v = _parseFormattedNumber(box.querySelector(`#cm_${id}`).value);
      return sum + (v || 0);
    }, 0);
    box.querySelector("#cmRevenueTotal").innerHTML = `<div class="caption">Umumiy tushum</div><div class="amount">${fmt(rev)}</div>`;
    box.querySelector("#cmExpenseTotal").innerHTML = `<div class="caption">Umumiy xarajat</div><div class="amount">${fmt(exp)}</div>`;
  }

  function renderGrowthBanner(data) {
    const banner = box.querySelector("#cmGrowthBanner");
    if (data.growth === null || data.growth === undefined) {
      banner.innerHTML = "";
      return;
    }
    const isGrowth = data.growth >= 0;
    banner.innerHTML = `
      <div class="growth-banner ${isGrowth ? "growth-up" : "growth-down"}">
        <span class="growth-icon">${isGrowth ? "📈" : "📉"}</span>
        <span class="growth-text">${isGrowth ? "O'sish" : "Tushish"}: ${data.growth > 0 ? "+" : ""}${data.growth} ta o'quvchi</span>
      </div>
    `;
  }

  function clearForm() {
    allFieldIds.forEach((id) => {
      const input = box.querySelector(`#cm_${id}`);
      if (input) input.value = "";
    });
    updateComputedTotals();
    box.querySelector("#cmGrowthBanner").innerHTML = "";
    renderAutoSummary(null);
  }

  function fillForm(data) {
    allFieldIds.forEach((id) => {
      const input = box.querySelector(`#cm_${id}`);
      if (!input) return;
      if (moneyIds.includes(id)) {
        input.value = data[id] !== null && data[id] !== undefined ? _formatThousands(String(Math.round(data[id]))) : "";
      } else {
        input.value = data[id] ?? "";
      }
    });
    updateComputedTotals();
    renderGrowthBanner(data);
    renderAutoSummary(data);
  }

  moneyIds.forEach((id) => {
    _attachMoneyFormatting(box.querySelector(`#cm_${id}`), updateComputedTotals);
  });

  async function loadDate() {
    box.querySelector("#cmMsg").textContent = "";
    try {
      const res = await api(`/api/company-metrics?date=${dateInput.value}`);
      if (res.exists) fillForm(res.data);
      else clearForm();
    } catch (err) {
      box.querySelector("#cmMsg").innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
    }
  }

  async function loadHistory() {
    const histBox = box.querySelector("#cmHistory");
    histBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const res = await api("/api/company-metrics/history?limit=14");
      if (!res.rows.length) {
        histBox.innerHTML = `<p style="color:var(--hint);font-size:13px;">Hali ma'lumot kiritilmagan</p>`;
        return;
      }
      histBox.innerHTML = res.rows.map((r) => {
        const isGrowth = r.growth === null ? null : r.growth >= 0;
        const chip = isGrowth === null
          ? ""
          : `<span class="growth-chip ${isGrowth ? "up" : "down"}">${isGrowth ? "▲" : "▼"} ${r.growth}</span>`;
        return `
          <div class="cm-history-item" data-date="${r.date}">
            <div class="cm-history-date">${r.date}</div>
            <div class="cm-history-mid">
              <span class="cm-history-label">Tushum:</span> ${fmt(r.total_revenue)}
              <span class="cm-history-label" style="margin-left:8px;">Xarajat:</span> ${fmt(r.total_expense)}
            </div>
            ${chip}
          </div>
        `;
      }).join("");

      histBox.querySelectorAll("[data-date]").forEach((item) => {
        item.addEventListener("click", () => {
          dateInput.value = item.dataset.date;
          loadDate();
        });
      });
    } catch (err) {
      histBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  box.querySelector("#cmSaveBtn").addEventListener("click", async () => {
    const msg = box.querySelector("#cmMsg");
    msg.textContent = "Saqlanmoqda...";
    try {
      const body = { date: dateInput.value };
      allFieldIds.forEach((id) => {
        const input = box.querySelector(`#cm_${id}`);
        if (moneyIds.includes(id)) {
          body[id] = _parseFormattedNumber(input.value);
        } else {
          body[id] = input.value === "" ? null : parseFloat(input.value);
        }
      });
      const res = await api("/api/company-metrics", {
        method: "POST",
        body: JSON.stringify(body),
      });
      msg.innerHTML = `<span class="badge ok">✅ Saqlandi</span>`;
      renderGrowthBanner(res.data);
      loadHistory();
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
    }
  });

  dateInput.addEventListener("change", loadDate);

  loadDate();
  loadHistory();
}

// ---------- MOLIYA TAB (avvalgi "Payroll") ----------

// ---------- MOLIYA (menyu: Ish haqi / Kompaniya moliyasi) ----------

async function renderMoliyaTab(box) {
  renderMoliyaHome(box);
}

function renderMoliyaHome(box) {
  box.innerHTML = `
    <div class="menu-grid">
      <div class="menu-card" data-nav="ishhaqi">
        <div class="menu-icon">💼</div>
        <div class="menu-text">
          <div class="menu-label">Ish haqi</div>
          <div class="menu-desc">Fix, KPI, Bonus, Avans va Rashchyot</div>
        </div>
        <div class="menu-arrow">›</div>
      </div>
      <div class="menu-card" data-nav="tushum">
        <div class="menu-icon">📈</div>
        <div class="menu-text">
          <div class="menu-label">Tushum</div>
          <div class="menu-desc">O'qituvchi bo'yicha tushum va ish haqi foizi</div>
        </div>
        <div class="menu-arrow">›</div>
      </div>
      <div class="menu-card" data-nav="kompaniyamoliyasi">
        <div class="menu-icon">🏢</div>
        <div class="menu-text">
          <div class="menu-label">Kompaniya moliyasi</div>
          <div class="menu-desc">Tushum, xarajat va sof foyda (P&L)</div>
        </div>
        <div class="menu-arrow">›</div>
      </div>
    </div>
  `;
  box.querySelectorAll("[data-nav]").forEach((card) => {
    card.addEventListener("click", () => {
      if (card.dataset.nav === "ishhaqi") renderIshHaqiSection(box);
      else if (card.dataset.nav === "tushum") renderTushumSection(box);
      else renderKompaniyaMoliyasiSection(box);
    });
  });
}

async function renderIshHaqiSection(box) {
  box.innerHTML = `<button class="back-btn" id="ihBackBtn">← Orqaga</button><div id="ihInner"></div>`;
  box.querySelector("#ihBackBtn").addEventListener("click", () => renderMoliyaHome(box));
  await renderIshHaqiContent(box.querySelector("#ihInner"));
}

async function renderTushumSection(box) {
  box.innerHTML = `<button class="back-btn" id="tuBackBtn">← Orqaga</button><div id="tuInner"></div>`;
  box.querySelector("#tuBackBtn").addEventListener("click", () => renderMoliyaHome(box));
  await renderRevenueTab(box.querySelector("#tuInner"));
}

async function renderKompaniyaMoliyasiSection(box) {
  box.innerHTML = `<button class="back-btn" id="kmBackBtn">← Orqaga</button><div id="kmInner"></div>`;
  box.querySelector("#kmBackBtn").addEventListener("click", () => renderMoliyaHome(box));
  await renderKompaniyaMoliyasiContent(box.querySelector("#kmInner"));
}

const PAYROLL_ROLE_LABELS = {
  Teacher: "O'qituvchi",
  SubjectTeacher: "Fan o'qituvchisi",
  Administrator: "Administrator",
  SalesManager: "Sotuv menejeri",
  Director: "Direktor",
  EduManager: "Ta'lim menejeri",
  CEO: "CEO",
};

function _payrollCategoryForRole(role) {
  if (role === "Teacher") return "teacher";
  if (role === "SubjectTeacher") return "subject_teacher";
  return "staff";
}

const PAYROLL_CATEGORY_LABELS = {
  teacher: "👨‍🏫 O'qituvchilar",
  subject_teacher: "🎓 Fan o'qituvchilari",
  staff: "🧑‍💼 Xodimlar (Admin/Sotuv/Rahbariyat)",
};

async function renderIshHaqiContent(box) {
  box.innerHTML = `
    <div class="month-picker">
      <label style="margin:0;">Oy:</label>
      <select id="pMonth"></select>
    </div>
    <div class="card">
      <label>Rol bo'yicha filtr</label>
      <select id="pRoleFilter">
        <option value="all">Barcha rollar</option>
      </select>
    </div>
    <div id="pResult"></div>
  `;
  const select = box.querySelector("#pMonth");
  lastNMonths(6).forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m; opt.textContent = m;
    select.appendChild(opt);
  });
  const roleFilter = box.querySelector("#pRoleFilter");
  const resultBox = box.querySelector("#pResult");

  async function load() {
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    const data = await api(`/api/payroll?month=${select.value}`);

    // Rol filtri variantlarini shu oydagi haqiqiy natijalardan yig'amiz
    const presentRoles = [...new Set(data.results.map((r) => r.role))];
    const currentFilterVal = roleFilter.value || "all";
    roleFilter.innerHTML = `<option value="all">Barcha rollar</option>` +
      presentRoles.map((r) => `<option value="${r}">${PAYROLL_ROLE_LABELS[r] || r}</option>`).join("");
    roleFilter.value = presentRoles.includes(currentFilterVal) ? currentFilterVal : "all";

    // Kategoriya bo'yicha (Teacher / SubjectTeacher / Staff) yig'indilar — HAR DOIM
    // barcha natijalar asosida hisoblanadi (filtrdan qat'i nazar, umumiy manzara uchun)
    const categories = {
      teacher: { fix: 0, kpi: 0 },
      subject_teacher: { fix: 0, kpi: 0 },
      staff: { fix: 0, kpi: 0 },
    };
    data.results.forEach((r) => {
      const cat = _payrollCategoryForRole(r.role);
      categories[cat].fix += r.fix;
      categories[cat].kpi += r.kpi_amount;
    });

    const categoryCardsHtml = Object.keys(categories).map((cat) => `
      <div class="role-category-card">
        <div class="role-category-label">${PAYROLL_CATEGORY_LABELS[cat]}</div>
        <div class="role-category-values">
          <div class="role-category-value-col">
            <div class="role-category-value-num">${fmt(categories[cat].fix)}</div>
            <div class="role-category-value-label">Fix</div>
          </div>
          <div class="role-category-divider"></div>
          <div class="role-category-value-col">
            <div class="role-category-value-num">${fmt(categories[cat].kpi)}</div>
            <div class="role-category-value-label">KPI</div>
          </div>
        </div>
      </div>
    `).join("");

    // Filtrlangan royxat (faqat korsatish uchun)
    const filteredResults = roleFilter.value === "all"
      ? data.results
      : data.results.filter((r) => r.role === roleFilter.value);

    const totalFix = filteredResults.reduce((s, r) => s + r.fix, 0);
    const totalKpi = filteredResults.reduce((s, r) => s + r.kpi_amount, 0);
    const totalBonus = filteredResults.reduce((s, r) => s + r.bonus, 0);
    const totalAvans = filteredResults.reduce((s, r) => s + r.advance_given, 0);
    const totalRashchyotFiltered = filteredResults.reduce(
      (s, r) => s + (r.is_settled ? r.settled_amount : (r.kpi_available ? r.rashchyot : 0)), 0
    );

    const missingHtml = data.missing_scorecard.length
      ? `<div class="gate-warning">⚠️ Baholanmagan: ${data.missing_scorecard.map((m) => m.full_name).join(", ")}</div>`
      : "";

    const cardsHtml = filteredResults.map((r) => `
      <div class="payroll-card">
        <div class="payroll-card-header">
          <div>
            <div class="payroll-card-name">${r.full_name}</div>
            <div class="payroll-card-meta">${r.grade ? r.grade + " · " : r.subject ? r.subject + " · " : r.role + " · "}${r.teacher_id}</div>
            ${r.role === "SubjectTeacher" ? `<div style="font-size:10px;color:var(--hint);">Ulush: ${r.revenue_percent}% · Tushum: ${r.revenue_amount !== null && r.revenue_amount !== undefined ? fmt(r.revenue_amount) : "kiritilmagan"}</div>` : ""}
          </div>
          <div class="payroll-card-kpi">${r.kpi_available ? r.kpi_percent + "%" : "—"}</div>
        </div>
        <div class="payroll-card-breakdown">
          <div class="pcb-item"><span>Fix</span><b>${fmt(r.fix)}</b></div>
          <div class="pcb-item"><span>KPI</span><b>${r.kpi_available ? fmt(r.kpi_amount) : "—"}</b></div>
          <div class="pcb-item"><span>Bonus</span><b>${fmt(r.bonus)}</b></div>
          <div class="pcb-item pcb-total"><span>Umumiy</span><b>${fmt(r.total)}</b></div>
        </div>
        ${r.role === "SalesManager" && r.kpi_available ? _smKpiBreakdownHtml(r.breakdown) : ""}
        ${!r.kpi_available ? `<p style="font-size:11px;color:var(--hint);margin:4px 0 8px;">⚠️ Scorecard hali kiritilmagan — Avans berish mumkin, lekin Rashchyot uchun avval Scorecard kiriting</p>` : ""}
        ${r.kpi_available && r.gate_notes && r.gate_notes.length ? r.gate_notes.map((n) => `<p style="font-size:11px;color:var(--red);margin:4px 0 8px;">⚠️ ${n}</p>`).join("") : ""}
        <div class="payroll-status-row">
          <div class="payroll-status-chip">
            <span class="ps-label">Avans</span>
            <span class="ps-amount">${fmt(r.advance_given)}</span>
            <span class="ps-badge ${r.advance_is_given ? "ps-done" : "ps-pending"}">${r.advance_is_given ? "✓ berilgan" + (r.advance_is_manual ? " (qo'lda)" : "") : "kutilmoqda"}</span>
          </div>
          <button class="mini-btn" data-give-advance="${r.teacher_id}">Avans berish</button>
        </div>
        <div class="payroll-status-row">
          <div class="payroll-status-chip">
            <span class="ps-label">Rashchyot</span>
            <span class="ps-amount">${r.is_settled ? fmt(r.settled_amount) : (r.kpi_available ? fmt(r.rashchyot) : "—")}</span>
            <span class="ps-badge ${r.is_settled ? "ps-done" : "ps-pending"}">${r.is_settled ? "✓ to'landi" + (r.settlement_is_manual ? " (qo'lda)" : "") : r.kpi_available ? "kutilmoqda" : "Scorecard kerak"}</span>
          </div>
          <button class="mini-btn" data-give-settlement="${r.teacher_id}" ${(r.is_settled || !r.kpi_available) ? "disabled" : ""}>${r.is_settled ? "To'landi ✓" : "Rashchyot berish"}</button>
        </div>
      </div>
    `).join("");

    const selectedRoleLabel = roleFilter.value === "all" ? null : (PAYROLL_ROLE_LABELS[roleFilter.value] || roleFilter.value);

    const summaryHtml = roleFilter.value === "all" ? `
      <h2>Rol kategoriyalari bo'yicha</h2>
      <div class="role-category-grid">${categoryCardsHtml}</div>

      <h2>Umumiy jami (barcha rollar)</h2>
      <div class="dash-grid">
        <div class="dash-card"><div class="dash-card-icon">💵</div><div class="dash-num">${fmt(totalFix)}</div><div class="dash-label">Jami Fix</div></div>
        <div class="dash-card"><div class="dash-card-icon">🎯</div><div class="dash-num">${fmt(totalKpi)}</div><div class="dash-label">Jami KPI</div></div>
        <div class="dash-card"><div class="dash-card-icon">🎁</div><div class="dash-num">${fmt(totalBonus)}</div><div class="dash-label">Jami Bonus</div></div>
        <div class="dash-card"><div class="dash-card-icon">💳</div><div class="dash-num">${fmt(totalAvans)}</div><div class="dash-label">Jami Avans</div></div>
      </div>
    ` : `
      <h2>📌 ${selectedRoleLabel} bo'yicha (${filteredResults.length} kishi)</h2>
      <div class="dash-grid">
        <div class="dash-card"><div class="dash-card-icon">💵</div><div class="dash-num">${fmt(totalFix)}</div><div class="dash-label">Fix</div></div>
        <div class="dash-card"><div class="dash-card-icon">🎯</div><div class="dash-num">${fmt(totalKpi)}</div><div class="dash-label">KPI</div></div>
        <div class="dash-card"><div class="dash-card-icon">🎁</div><div class="dash-num">${fmt(totalBonus)}</div><div class="dash-label">Bonus</div></div>
        <div class="dash-card"><div class="dash-card-icon">💳</div><div class="dash-num">${fmt(totalAvans)}</div><div class="dash-label">Avans</div></div>
      </div>
    `;

    resultBox.innerHTML = `
      ${summaryHtml}
      <div class="total-box">
        <div class="caption">${data.month} — ${roleFilter.value === "all" ? "jami rashchyot (to'lanadigan)" : selectedRoleLabel + " — jami rashchyot"}</div>
        <div class="amount">${fmt(roleFilter.value === "all" ? data.total_rashchyot : totalRashchyotFiltered)}</div>
        <div style="font-size:12px;opacity:0.85;margin-top:4px;">Umumiy (Fix+KPI+Bonus): ${fmt(totalFix + totalKpi + totalBonus)}</div>
      </div>
      ${missingHtml}
      ${cardsHtml || "<p style='color:var(--hint);font-size:13px;'>Ma'lumot yo'q</p>"}
    `;

    resultBox.querySelectorAll("[data-give-advance]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const teacherId = btn.dataset.giveAdvance;
        const teacherRow = data.results.find((r) => r.teacher_id === teacherId);
        showAmountChoiceModal(
          "Avans berish",
          `<b>${teacherRow.full_name}</b> uchun <b>${select.value}</b> oyi bo'yicha avans berilsinmi?`,
          teacherRow.auto_advance_preview,
          async (manualAmount) => {
            try {
              const body = { teacher_id: teacherId, month: select.value };
              if (manualAmount !== null) body.manual_amount = manualAmount;
              const res = await api("/api/advance", { method: "POST", body: JSON.stringify(body) });
              safeAlert(`Avans berildi: ${fmt(res.amount)}`);
              load();
            } catch (err) {
              safeAlert("Xato: " + err.message);
            }
          }
        );
      });
    });

    resultBox.querySelectorAll("[data-give-settlement]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const teacherId = btn.dataset.giveSettlement;
        const teacherRow = data.results.find((r) => r.teacher_id === teacherId);
        showAmountChoiceModal(
          "Rashchyot to'landi deb belgilash",
          `<b>${teacherRow.full_name}</b> uchun <b>${select.value}</b> oyi bo'yicha yakuniy hisob-kitob to'landi deb belgilansinmi? Bu amalni keyin bekor qilib bo'lmaydi.`,
          teacherRow.rashchyot,
          async (manualAmount) => {
            try {
              const body = { teacher_id: teacherId, month: select.value };
              if (manualAmount !== null) body.manual_amount = manualAmount;
              const res = await api("/api/settlement", { method: "POST", body: JSON.stringify(body) });
              safeAlert(`Rashchyot to'landi: ${fmt(res.amount)}`);
              load();
            } catch (err) {
              safeAlert("Xato: " + err.message);
            }
          }
        );
      });
    });
  }

  select.addEventListener("change", load);
  roleFilter.addEventListener("change", load);
  load();
}

async function renderKompaniyaMoliyasiContent(box) {
  box.innerHTML = `
    <div class="month-picker">
      <label style="margin:0;">Oy:</label>
      <select id="fmMonth"></select>
    </div>
    <div id="fmResult"></div>
  `;
  const select = box.querySelector("#fmMonth");
  lastNMonths(6).forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m; opt.textContent = m;
    select.appendChild(opt);
  });
  const resultBox = box.querySelector("#fmResult");

  async function load() {
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const d = await api(`/api/finance-summary?month=${select.value}`);
      const isProfit = d.net_profit >= 0;

      resultBox.innerHTML = `
        <div class="growth-banner ${isProfit ? "growth-up" : "growth-down"}" style="font-size:16px;">
          <span class="growth-icon">${isProfit ? "📈" : "📉"}</span>
          <span class="growth-text">Sof foyda: ${fmt(d.net_profit)}</span>
        </div>

        <h2>💰 Kompaniya (kunlik ma'lumotlar asosida)</h2>
        <div class="card">
          <div class="row"><span class="label">Tushum</span><span class="value" style="color:var(--green);">+${fmt(d.company_revenue)}</span></div>
          <div class="row"><span class="label">Operatsion xarajat</span><span class="value" style="color:var(--red);">−${fmt(d.company_expense)}</span></div>
        </div>
        ${d.days_with_data === 0 ? `<p style="font-size:12px;color:var(--hint);">💡 Bu oy uchun "Kompaniya" bo'limida hali kunlik ma'lumot kiritilmagan.</p>` : ""}

        <h2>👥 Ish haqi xarajati</h2>
        <div class="card">
          <div class="row"><span class="label">Fix</span><span class="value">${fmt(d.payroll_fix)}</span></div>
          <div class="row"><span class="label">KPI</span><span class="value">${fmt(d.payroll_kpi)}</span></div>
          <div class="row"><span class="label">Bonus</span><span class="value">${fmt(d.payroll_bonus)}</span></div>
          <div class="row"><span class="label"><b>Jami ish haqi</b></span><span class="value">−${fmt(d.payroll_total)}</span></div>
        </div>

        <div class="total-box">
          <div class="caption">Formula: Tushum − Operatsion xarajat − Ish haqi</div>
          <div class="amount">${fmt(d.net_profit)}</div>
        </div>
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  select.addEventListener("change", load);
  load();
}

// ---------- SCORECARD TAB ----------

async function renderScorecardTab(box, me) {
  const employees = await api("/api/employees");
  const showBonus = me.role !== "EduManager";

  box.innerHTML = `
    <h2>👤 Xodim</h2>
    <div class="card">
      <label>Xodim tanlang</label>
      <select id="scEmployee">
        ${employees.map((e) => `<option value="${e.teacher_id}" data-role="${e.role}" data-name="${e.full_name}">${e.full_name} (${e.role}${e.grade ? " · " + e.grade : ""})</option>`).join("")}
      </select>
    </div>

    <div id="scMainArea"></div>

    ${showBonus ? `
      <h2>🎁 Bonus qo'shish</h2>
      <div class="card">
        <label>Oy</label>
        <select id="b_month">
          ${lastNMonths(3).map((m) => `<option value="${m}">${m}</option>`).join("")}
        </select>
        <label>Summa (so'm)</label>
        <input id="b_amount" type="text" inputmode="numeric" placeholder="masalan: 500 000" />
        <label>Izoh</label>
        <input id="b_note" type="text" placeholder="masalan: Mentorlik bonusi" />
        <button class="primary" id="bonusBtn">Bonus qo'shish</button>
        <div id="bonusMsg" style="margin-top:8px;font-size:13px;"></div>
      </div>
    ` : ""}
  `;

  const employeeSelect = box.querySelector("#scEmployee");
  const mainArea = box.querySelector("#scMainArea");

  function currentRole() {
    return employeeSelect.selectedOptions[0]?.dataset.role;
  }
  function currentName() {
    return employeeSelect.selectedOptions[0]?.dataset.name;
  }

  async function renderMainForSelected() {
    if (currentRole() === "Teacher") {
      await renderScorecardHistoryView(mainArea, employeeSelect.value, currentName());
    } else if (currentRole() === "EduManager") {
      await renderEduManagerScorecardHistoryView(mainArea, employeeSelect.value, currentName());
    } else if (currentRole() === "SalesManager") {
      await renderSalesManagerKpiView(mainArea, employeeSelect.value, currentName());
    } else {
      mainArea.innerHTML = `
        <div class="card">
          <p style="font-size:13px;color:var(--hint);margin:0;">
            💡 Bu lavozim uchun KPI/samaradorlik tizimi hali ishlab chiqilmagan.
            Hozircha ish haqi faqat <b>Oylik maosh + Bonus</b> asosida hisoblanadi.
            Ish ko'rsatkichlari aniqlangach, bu yerga baholash tizimi qo'shiladi.
          </p>
        </div>
      `;
    }
  }

  employeeSelect.addEventListener("change", renderMainForSelected);
  await renderMainForSelected();

  if (!showBonus) return;

  const bonusAmountInput = box.querySelector("#b_amount");
  _attachMoneyFormatting(bonusAmountInput);

  box.querySelector("#bonusBtn").addEventListener("click", async () => {
    const msg = box.querySelector("#bonusMsg");
    msg.textContent = "Saqlanmoqda...";
    try {
      await api("/api/bonus", {
        method: "POST",
        body: JSON.stringify({
          teacher_id: employeeSelect.value,
          month: box.querySelector("#b_month").value,
          amount: _parseFormattedNumber(bonusAmountInput.value) || 0,
          note: box.querySelector("#b_note").value,
        }),
      });
      msg.innerHTML = `<span class="badge ok">✅ Bonus qo'shildi</span>`;
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
    }
  });
}

// Tanlangan o'qituvchining scorecard tarixi — Tahrirlash/O'chirish tugmalari bilan
async function renderScorecardHistoryView(box, teacherId, employeeName) {
  box.innerHTML = `
    <h2>📅 ${employeeName} — Scorecard tarixi</h2>
    <div class="card">
      <label>Necha oylik tarix ko'rsatilsin</label>
      <select id="scHistRange">
        <option value="3">Oxirgi 3 oy</option>
        <option value="6" selected>Oxirgi 6 oy</option>
        <option value="12">Oxirgi 12 oy</option>
      </select>
    </div>
    <div id="scHistList"><div class="center-box"><div class="spinner"></div></div></div>
    <button class="primary" id="scNewBtn">+ Yangi oy uchun kiritish</button>
    <div id="scFormWrap"></div>
  `;

  const rangeSelect = box.querySelector("#scHistRange");
  const listBox = box.querySelector("#scHistList");
  let currentHistory = [];

  async function loadHistory() {
    listBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      currentHistory = await api(`/api/scorecard/history?teacher_id=${teacherId}&months=${rangeSelect.value}`);

      const itemsHtml = currentHistory.map((h) => `
        <div class="sc-history-item">
          <div class="sc-history-info">
            <div class="sc-history-month">${h.month} <span class="kpi-chip ${_kpiColorClass(h.kpi_percent)}" style="margin-left:6px;">${h.kpi_percent}%</span></div>
            <div class="sc-history-mini">Retention ${h.retention ?? "-"}% · Progress ${h.progress ?? "-"}% · Attendance ${h.attendance ?? "-"}%</div>
          </div>
          <div class="sc-history-actions">
            <button class="mini-btn" data-edit-month="${h.month}">✏️ Tahrirlash</button>
            <button class="mini-btn" data-delete-month="${h.month}">🗑️ O'chirish</button>
          </div>
        </div>
      `).join("");

      listBox.innerHTML = `
        <div class="card">
          ${itemsHtml || `<p style="color:var(--hint);font-size:13px;margin:0;">Tanlangan oraliqda hali scorecard kiritilmagan</p>`}
        </div>
      `;

      listBox.querySelectorAll("[data-edit-month]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const month = btn.dataset.editMonth;
          const entry = currentHistory.find((h) => h.month === month);
          renderScorecardForm(box.querySelector("#scFormWrap"), teacherId, entry, () => loadHistory());
        });
      });

      listBox.querySelectorAll("[data-delete-month]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const month = btn.dataset.deleteMonth;
          showConfirm(
            "Scorecardni o'chirish",
            `<b>${employeeName}</b>ning <b>${month}</b> oyi uchun scorecard yozuvi butunlay o'chirilsinmi? Bu amalni qaytarib bo'lmaydi.`,
            async () => {
              try {
                await api("/api/scorecard/delete", {
                  method: "POST",
                  body: JSON.stringify({ teacher_id: teacherId, month }),
                });
                loadHistory();
              } catch (err) {
                safeAlert("Xato: " + err.message);
              }
            }
          );
        });
      });
    } catch (err) {
      listBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  box.querySelector("#scNewBtn").addEventListener("click", () => {
    renderScorecardForm(box.querySelector("#scFormWrap"), teacherId, null, () => loadHistory());
  });

  rangeSelect.addEventListener("change", loadHistory);
  await loadHistory();
}

function renderScorecardForm(wrap, teacherId, existing, onSaved) {
  const isEdit = !!existing;
  const monthOptions = lastNMonths(6);

  wrap.innerHTML = `
    <h2>${isEdit ? "✏️ Tahrirlash — " + existing.month : "📋 Yangi scorecard"}</h2>
    <div class="card sc-form">
      ${isEdit ? "" : `
        <div class="sc-field">
          <label>Oy</label>
          <select id="f_month">
            ${monthOptions.map((m) => `<option value="${m}">${m}</option>`).join("")}
          </select>
        </div>
      `}
      <div class="sc-field">
        <label>🔁 Retention (%)</label>
        <input id="f_retention" type="number" step="0.1" placeholder="masalan: 95" value="${existing?.retention ?? ""}" />
      </div>
      <div class="sc-field">
        <label>📈 Student Progress (%)</label>
        <input id="f_progress" type="number" step="0.1" placeholder="masalan: 89" value="${existing?.progress ?? ""}" />
      </div>
      <div class="sc-field">
        <label>🗓️ Attendance (%)</label>
        <input id="f_attendance" type="number" step="0.1" placeholder="masalan: 90" value="${existing?.attendance ?? ""}" />
      </div>
      <div class="sc-field">
        <label>📝 Homework Completion (%)</label>
        <input id="f_homework" type="number" step="0.1" placeholder="masalan: 84" value="${existing?.homework ?? ""}" />
      </div>
      <div class="sc-field">
        <label>👀 Observation (0-25 ball)</label>
        <input id="f_observation" type="number" step="0.1" placeholder="masalan: 21" value="${existing?.observation ?? ""}" />
      </div>
      <div class="sc-field">
        <label>💬 Student Feedback (0-10)</label>
        <input id="f_feedback" type="number" step="0.1" placeholder="masalan: 9.2" value="${existing?.feedback ?? ""}" />
      </div>
      <div class="sc-field">
        <label>💻 Platforma intizomi (0-5)</label>
        <input id="f_lms" type="number" step="0.1" placeholder="masalan: 5" value="${existing?.lms ?? ""}" />
      </div>

      <button class="primary" id="scSaveBtn">Saqlash</button>
      <button class="secondary" id="scCancelBtn">Bekor qilish</button>
      <div id="scSaveMsg" style="margin-top:8px;font-size:13px;"></div>
    </div>
  `;

  wrap.querySelector("#scCancelBtn").addEventListener("click", () => { wrap.innerHTML = ""; });

  wrap.querySelector("#scSaveBtn").addEventListener("click", async () => {
    const msg = wrap.querySelector("#scSaveMsg");
    msg.textContent = "Saqlanmoqda...";
    const month = isEdit ? existing.month : wrap.querySelector("#f_month").value;
    try {
      await api("/api/scorecard", {
        method: "POST",
        body: JSON.stringify({
          teacher_id: teacherId,
          month: month,
          retention: parseFloat(wrap.querySelector("#f_retention").value) || null,
          progress: parseFloat(wrap.querySelector("#f_progress").value) || null,
          attendance: parseFloat(wrap.querySelector("#f_attendance").value) || null,
          homework: parseFloat(wrap.querySelector("#f_homework").value) || null,
          observation: parseFloat(wrap.querySelector("#f_observation").value) || null,
          feedback: parseFloat(wrap.querySelector("#f_feedback").value) || null,
          lms: parseFloat(wrap.querySelector("#f_lms").value) || null,
        }),
      });
      msg.innerHTML = `<span class="badge ok">✅ Saqlandi</span>`;
      setTimeout(() => { if (onSaved) onSaved(); }, 500);
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
    }
  });
}

// ---------- EDU MANAGER: 6 MEZONLI KPI SCORECARD ----------

function _kpiGoalBarHtml(current, target, label, achievedText, pendingText) {
  const pct = Math.min(100, Math.round((current / target) * 100));
  const achieved = current >= target;
  return `
    <div class="kpi-goal-row">
      <div class="kpi-goal-head">
        <span>${achieved ? "✅" : "🎯"} ${label}</span>
        <span class="kpi-goal-count">${current} / ${target}</span>
      </div>
      <div class="kpi-goal-track">
        <div class="kpi-goal-fill ${achieved ? "kpi-goal-done" : ""}" style="width:${pct}%;"></div>
      </div>
      <div class="kpi-goal-sub">${achieved ? achievedText : pendingText}</div>
    </div>
  `;
}

function _generateSalesManagerTips(b) {
  const tips = [];

  if (b.total_sales < 25) {
    tips.push({ icon: "⚠️", text: `Oylik majburiy me'yorga (25 ta) yetish uchun yana <b>${25 - b.total_sales} ta</b> sotuv kerak.`, cls: "tip-warning" });
  } else {
    const extra = b.total_sales - 25;
    tips.push({ icon: "✅", text: `Majburiy me'yorni bajardingiz! Qo'shimcha <b>${extra} ta</b> sotuv uchun +<b>${fmt(extra * 25000)}</b> ishlab oldingiz.`, cls: "tip-success" });
  }

  if (b.total_sales < 55) {
    tips.push({ icon: "🏆", text: `55 ta sotuvga yetsangiz +<b>500,000 so'm</b> bonus! Yana <b>${55 - b.total_sales} ta</b> qoldi.`, cls: "tip-info" });
  } else {
    tips.push({ icon: "🏆", text: `55+ Milestone bonusini qo'lga kiritdingiz — +<b>500,000 so'm</b>!`, cls: "tip-success" });
  }

  if (b.conversion_percent < 70) {
    tips.push({ icon: "📈", text: `Konversiyangiz ${b.conversion_percent}%. 70%ga yetsangiz +<b>500,000</b>, 85%ga yetsangiz +<b>1,000,000 so'm</b> olasiz.`, cls: "tip-warning" });
  } else if (b.conversion_percent < 85) {
    tips.push({ icon: "📈", text: `Konversiyangiz zo'r — ${b.conversion_percent}%! 85%ga yetkazsangiz yana +<b>500,000 so'm</b> ko'proq olasiz.`, cls: "tip-info" });
  } else {
    tips.push({ icon: "🌟", text: `Ajoyib! Konversiyangiz ${b.conversion_percent}% — maksimal konversiya bonusini (+1,000,000 so'm) olyapsiz.`, cls: "tip-success" });
  }

  if (b.combo_bonus > 0) {
    tips.push({ icon: "⭐", text: `SUPER natija! Combo bonusni qo'lga kiritdingiz (60+ sotuv va 80%+ konversiya) — +<b>1,500,000 so'm</b>!`, cls: "tip-success" });
  } else if (b.total_sales >= 40) {
    tips.push({ icon: "⭐", text: `Combo bonusga (+1,500,000 so'm) yaqinlashyapsiz! 60 tadan ortiq sotuv va 80%dan yuqori konversiya kerak.`, cls: "tip-info" });
  }

  return tips;
}

async function renderSalesManagerOwnKpiTab(box, me) {
  box.innerHTML = `
    <h2>🚀 Mening KPI'im</h2>
    ${_monthSelectHtml("smOwnKpiMonth")}
    <div id="smOwnKpiResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;
  const select = box.querySelector("#smOwnKpiMonth");

  async function load() {
    const resultBox = box.querySelector("#smOwnKpiResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const d = await api(`/api/me/payroll?month=${select.value}`);

      if (!d.kpi_available) {
        resultBox.innerHTML = `
          <div class="card">
            <p style="font-size:13px;color:var(--hint);margin:0;">
              📋 ${d.month} uchun hali Direktor tomonidan tasdiqlangan kunlik ma'lumot yo'q.
              "Kun" bo'limida ma'lumot kiritib, yuboring — Direktor tasdiqlagach, bu yerda natijalaringiz jonlanadi!
            </p>
          </div>
        `;
        return;
      }

      const b = d.breakdown;
      const tips = _generateSalesManagerTips(b);

      resultBox.innerHTML = `
        <div class="total-box" style="background: linear-gradient(135deg, #7c5cff, #4b2ee0);">
          <div class="caption">${d.month} — Hozirgi KPI (bonus) summangiz</div>
          <div class="amount">${fmt(d.kpi_amount)}</div>
          <div style="font-size:12px;opacity:0.85;margin-top:4px;">${b.approved_days} kunlik tasdiqlangan ma'lumot asosida</div>
        </div>

        <h2>📊 Bu oygi natijalaringiz</h2>
        <div class="stat-grid">
          <div class="stat-mini"><div class="stat-mini-icon">📥</div><div class="stat-mini-num">${b.total_admissions}</div><div class="stat-mini-label">Qabul soni</div></div>
          <div class="stat-mini"><div class="stat-mini-icon">📝</div><div class="stat-mini-num">${b.total_trial_booked}</div><div class="stat-mini-label">Sinovga yozilgan</div></div>
          <div class="stat-mini"><div class="stat-mini-icon">🚶</div><div class="stat-mini-num">${b.total_trial_attended}</div><div class="stat-mini-label">Sinovga kelgan</div></div>
          <div class="stat-mini"><div class="stat-mini-icon">⚡</div><div class="stat-mini-num">${b.total_activated}</div><div class="stat-mini-label">Faollashtirilgan</div></div>
          <div class="stat-mini"><div class="stat-mini-icon">💼</div><div class="stat-mini-num">${b.total_sales}</div><div class="stat-mini-label">Yangi sotuv</div></div>
          <div class="stat-mini"><div class="stat-mini-icon">🎯</div><div class="stat-mini-num">${b.conversion_percent}%</div><div class="stat-mini-label">Konversiya</div></div>
        </div>

        <h2>🏁 Bonusga yo'l xaritangiz</h2>
        <div class="card">
          ${_kpiGoalBarHtml(b.total_sales, 25, "Majburiy me'yor", "Bajarildi — endi har bir sotuv uchun +25,000 so'm ishlaysiz!", "Har bir sotuv sizni bonusga yaqinlashtiradi")}
          ${_kpiGoalBarHtml(b.total_sales, 55, "55+ Milestone bonusi", "Qo'lga kiritildi — +500,000 so'm!", "55 taga yetsangiz +500,000 so'm bonus")}
          ${_kpiGoalBarHtml(b.total_sales, 60, "Combo uchun sotuv sharti (60+)", "Sotuv sharti bajarildi!", "Combo bonus uchun 60 tadan ortiq sotuv kerak")}
          ${_kpiGoalBarHtml(b.conversion_percent, 85, "Maksimal konversiya bonusi (85%)", "Maksimal darajaga yetdingiz!", "85% konversiyaga yetsangiz +1,000,000 so'm")}
        </div>

        <h2>💡 Sizga tavsiyalar</h2>
        <div class="card">
          ${tips.map((t) => `
            <div class="kpi-tip-row ${t.cls}">
              <span class="kpi-tip-icon">${t.icon}</span>
              <span class="kpi-tip-text">${t.text}</span>
            </div>
          `).join("")}
        </div>
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  select.addEventListener("change", load);
  await load();
}

async function renderSalesManagerKpiView(box, teacherId, employeeName) {
  box.innerHTML = `
    <h2>📅 ${employeeName} — KPI (avtomatik hisoblangan)</h2>
    <div class="card">
      <label>Oy</label>
      <select id="smkMonth">
        ${lastNMonths(6).map((m) => `<option value="${m}">${m}</option>`).join("")}
      </select>
    </div>
    <div id="smkResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;

  const select = box.querySelector("#smkMonth");

  async function load() {
    const resultBox = box.querySelector("#smkResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const payroll = await api(`/api/payroll?month=${select.value}`);
      const row = payroll.results.find((r) => r.teacher_id === teacherId);

      if (!row || !row.kpi_available) {
        resultBox.innerHTML = `
          <div class="card">
            <p style="font-size:13px;color:var(--hint);margin:0;">
              📋 ${select.value} uchun hali Direktor tomonidan tasdiqlangan kunlik ma'lumot yo'q.
              KPI Direktor kamida bitta kunlik yozuvni tasdiqlagach avtomatik hisoblanadi.
            </p>
          </div>
        `;
        return;
      }

      const b = row.breakdown;
      resultBox.innerHTML = `
        <div class="stat-grid">
          <div class="stat-mini"><div class="stat-mini-icon">📥</div><div class="stat-mini-num">${b.total_admissions}</div><div class="stat-mini-label">Qabul soni</div></div>
          <div class="stat-mini"><div class="stat-mini-icon">💼</div><div class="stat-mini-num">${b.total_sales}</div><div class="stat-mini-label">Umumiy sotuv</div></div>
          <div class="stat-mini"><div class="stat-mini-icon">➖</div><div class="stat-mini-num">${b.extra_sales_over_quota}</div><div class="stat-mini-label">25 tadan ortig'i</div></div>
          <div class="stat-mini"><div class="stat-mini-icon">🎯</div><div class="stat-mini-num">${b.conversion_percent}%</div><div class="stat-mini-label">Konversiya</div></div>
        </div>
        <p style="font-size:11px;color:var(--hint);margin:-4px 0 12px;">${b.approved_days} kunlik tasdiqlangan ma'lumot asosida</p>
        ${_smKpiBreakdownHtml(b)}
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  select.addEventListener("change", load);
  await load();
}

async function renderEduManagerScorecardHistoryView(box, teacherId, employeeName) {
  box.innerHTML = `
    <h2>📅 ${employeeName} — KPI tarixi</h2>
    <div class="card">
      <label>Necha oylik tarix ko'rsatilsin</label>
      <select id="emHistRange">
        <option value="3">Oxirgi 3 oy</option>
        <option value="6" selected>Oxirgi 6 oy</option>
        <option value="12">Oxirgi 12 oy</option>
      </select>
    </div>
    <div id="emHistList"><div class="center-box"><div class="spinner"></div></div></div>
    <button class="primary" id="emNewBtn">+ Yangi oy uchun kiritish</button>
    <div id="emFormWrap"></div>
  `;

  const rangeSelect = box.querySelector("#emHistRange");
  const listBox = box.querySelector("#emHistList");
  let currentHistory = [];

  async function loadHistory() {
    listBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      currentHistory = await api(`/api/edu-manager-scorecard/history?teacher_id=${teacherId}&months=${rangeSelect.value}`);

      const itemsHtml = currentHistory.map((h) => {
        const gateOk = h.report_approved && h.data_honest;
        return `
        <div class="sc-history-item">
          <div class="sc-history-info">
            <div class="sc-history-month">
              ${h.month} <span class="kpi-chip ${_kpiColorClass(h.kpi_percent)}" style="margin-left:6px;">${h.kpi_percent}%</span>
              ${!gateOk ? '<span class="badge warn" style="margin-left:6px;">Gate: bloklangan</span>' : ""}
            </div>
            <div class="sc-history-mini">
              Retention ${h.retention !== null ? Math.round(h.retention * 100) : "-"}% · Teacher Perf ${h.teacher_performance ?? "-"} · Occupancy ${h.occupancy !== null ? Math.round(h.occupancy * 100) : "-"}%
            </div>
          </div>
          <div class="sc-history-actions">
            <button class="mini-btn" data-edit-month="${h.month}">✏️ Tahrirlash</button>
            <button class="mini-btn" data-delete-month="${h.month}">🗑️ O'chirish</button>
          </div>
        </div>
      `;
      }).join("");

      listBox.innerHTML = `
        <div class="card">
          ${itemsHtml || `<p style="color:var(--hint);font-size:13px;margin:0;">Tanlangan oraliqda hali KPI kiritilmagan</p>`}
        </div>
      `;

      listBox.querySelectorAll("[data-edit-month]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const month = btn.dataset.editMonth;
          const entry = currentHistory.find((h) => h.month === month);
          renderEduManagerScorecardForm(box.querySelector("#emFormWrap"), teacherId, entry, () => loadHistory());
        });
      });

      listBox.querySelectorAll("[data-delete-month]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const month = btn.dataset.deleteMonth;
          showConfirm(
            "KPI yozuvini o'chirish",
            `<b>${employeeName}</b>ning <b>${month}</b> oyi uchun KPI yozuvi butunlay o'chirilsinmi? Bu amalni qaytarib bo'lmaydi.`,
            async () => {
              try {
                await api("/api/edu-manager-scorecard/delete", {
                  method: "POST",
                  body: JSON.stringify({ teacher_id: teacherId, month }),
                });
                loadHistory();
              } catch (err) {
                safeAlert("Xato: " + err.message);
              }
            }
          );
        });
      });
    } catch (err) {
      listBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  box.querySelector("#emNewBtn").addEventListener("click", () => {
    renderEduManagerScorecardForm(box.querySelector("#emFormWrap"), teacherId, null, () => loadHistory());
  });

  rangeSelect.addEventListener("change", loadHistory);
  await loadHistory();
}

function renderEduManagerScorecardForm(wrap, teacherId, existing, onSaved) {
  const isEdit = !!existing;
  const monthOptions = lastNMonths(6);

  // Backendda 0-1 formatida saqlanadi (masalan 0.96 = 96%), foydalanuvchiga esa % ko'rinishida ko'rsatamiz
  const pctDisplay = (v) => (v !== null && v !== undefined ? Math.round(v * 10000) / 100 : "");

  wrap.innerHTML = `
    <h2>${isEdit ? "✏️ Tahrirlash — " + existing.month : "📋 Yangi KPI kiritish"}</h2>
    <div class="card sc-form">
      ${isEdit ? "" : `
        <div class="sc-field">
          <label>Oy</label>
          <select id="em_month">
            ${monthOptions.map((m) => `<option value="${m}">${m}</option>`).join("")}
          </select>
        </div>
      `}
      <div class="sc-field">
        <label>🔁 Student Retention (%)</label>
        <input id="em_retention" type="number" step="0.1" placeholder="masalan: 96" value="${pctDisplay(existing?.retention)}" />
      </div>
      <div class="sc-field">
        <label>👨‍🏫 Teacher Performance (0-100)</label>
        <input id="em_tp" type="number" step="0.1" placeholder="masalan: 88.5" value="${existing?.teacher_performance ?? ""}" />
      </div>
      <div class="sc-field">
        <label>📈 Student Results o'sishi (%, manfiy ham bo'lishi mumkin)</label>
        <input id="em_results" type="number" step="0.1" placeholder="masalan: 5" value="${pctDisplay(existing?.student_results)}" />
      </div>
      <div class="sc-field">
        <label>🗓️ Attendance (%)</label>
        <input id="em_attendance" type="number" step="0.1" placeholder="masalan: 93" value="${pctDisplay(existing?.attendance)}" />
      </div>
      <div class="sc-field">
        <label>📝 Homework Completion (%)</label>
        <input id="em_homework" type="number" step="0.1" placeholder="masalan: 88" value="${pctDisplay(existing?.homework)}" />
      </div>
      <div class="sc-field">
        <label>🏫 Group Occupancy (%)</label>
        <input id="em_occupancy" type="number" step="0.1" placeholder="masalan: 92" value="${pctDisplay(existing?.occupancy)}" />
      </div>

      <div class="sc-field" style="display:flex;align-items:center;gap:8px;margin-top:6px;">
        <input id="em_reportApproved" type="checkbox" style="width:auto;margin:0;" ${existing?.report_approved ? "checked" : ""} />
        <label style="margin:0;">Hisobot tasdiqlangan</label>
      </div>
      <div class="sc-field" style="display:flex;align-items:center;gap:8px;">
        <input id="em_dataHonest" type="checkbox" style="width:auto;margin:0;" ${existing?.data_honest ? "checked" : ""} />
        <label style="margin:0;">Ma'lumot haqqoniy</label>
      </div>
      <p style="font-size:12px;color:var(--hint);margin:6px 0 0;">
        ⚠️ Agar bu ikkalasidan biri belgilanmasa, KPI ball qanchalik yuqori bo'lmasin, KPI summasi 0 bo'ladi.
      </p>

      <button class="primary" id="emSaveBtn">Saqlash</button>
      <button class="secondary" id="emCancelBtn">Bekor qilish</button>
      <div id="emSaveMsg" style="margin-top:8px;font-size:13px;"></div>
    </div>
  `;

  wrap.querySelector("#emCancelBtn").addEventListener("click", () => { wrap.innerHTML = ""; });

  wrap.querySelector("#emSaveBtn").addEventListener("click", async () => {
    const msg = wrap.querySelector("#emSaveMsg");
    msg.textContent = "Saqlanmoqda...";
    const month = isEdit ? existing.month : wrap.querySelector("#em_month").value;

    const pct = (id) => {
      const v = parseFloat(wrap.querySelector(id).value);
      return isNaN(v) ? null : v / 100;
    };
    const raw = (id) => {
      const v = parseFloat(wrap.querySelector(id).value);
      return isNaN(v) ? null : v;
    };

    try {
      await api("/api/edu-manager-scorecard", {
        method: "POST",
        body: JSON.stringify({
          teacher_id: teacherId,
          month: month,
          retention: pct("#em_retention"),
          teacher_performance: raw("#em_tp"),
          student_results: pct("#em_results"),
          attendance: pct("#em_attendance"),
          homework: pct("#em_homework"),
          occupancy: pct("#em_occupancy"),
          report_approved: wrap.querySelector("#em_reportApproved").checked,
          data_honest: wrap.querySelector("#em_dataHonest").checked,
        }),
      });
      msg.innerHTML = `<span class="badge ok">✅ Saqlandi</span>`;
      setTimeout(() => { if (onSaved) onSaved(); }, 500);
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
    }
  });
}

// ---------- TUSHUM TAB (o'qituvchi bo'yicha rentabellik) ----------

async function renderRevenueTab(box) {
  box.innerHTML = `
    <div class="tabs" id="revSubTabs">
      <div class="tab active" data-subtab="entry">📝 Kiritish</div>
      <div class="tab" data-subtab="history">📅 Tarix</div>
    </div>
    <div id="revSubContent"></div>
  `;

  const subContent = box.querySelector("#revSubContent");
  let currentSubtab = "entry";

  function renderSub() {
    subContent.innerHTML = "";
    if (currentSubtab === "entry") renderRevenueEntry(subContent);
    else renderRevenueHistory(subContent);
  }

  box.querySelectorAll("#revSubTabs .tab").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      box.querySelectorAll("#revSubTabs .tab").forEach((x) => x.classList.remove("active"));
      tabBtn.classList.add("active");
      currentSubtab = tabBtn.dataset.subtab;
      renderSub();
    });
  });

  renderSub();
}

async function renderRevenueEntry(box) {
  box.innerHTML = `
    <div class="month-picker">
      <label style="margin:0;">Oy:</label>
      <select id="rMonth"></select>
    </div>
    <div id="rResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;
  const select = box.querySelector("#rMonth");
  lastNMonths(6).forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m; opt.textContent = m;
    select.appendChild(opt);
  });

  async function load() {
    const resultBox = box.querySelector("#rResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    const data = await api(`/api/revenue?month=${select.value}`);

    const totalRevenue = data.rows.reduce((s, r) => s + (r.revenue || 0), 0);
    const totalFix = data.rows.reduce((s, r) => s + r.fix, 0);
    const totalKpi = data.rows.reduce((s, r) => s + r.kpi_amount, 0);
    const totalBonus = data.rows.reduce((s, r) => s + r.bonus, 0);
    const totalPayroll = data.rows.reduce((s, r) => s + r.total_payroll, 0);
    const avgPercent = totalRevenue > 0 ? Math.round((totalPayroll / totalRevenue) * 1000) / 10 : null;

    const rows = data.rows.map((r) => `
      <tr>
        <td>${r.full_name}<br/><span style="color:var(--hint);font-size:11px;">${r.grade || "-"}</span></td>
        <td><input type="text" inputmode="numeric" value="${r.revenue !== null && r.revenue !== undefined ? _formatThousands(String(Math.round(r.revenue))) : ""}" data-revenue="${r.teacher_id}" style="width:130px;margin:0;" placeholder="0" /></td>
        <td>${fmt(r.fix)}</td>
        <td>${fmt(r.kpi_amount)}</td>
        <td>${fmt(r.bonus)}</td>
        <td><b>${fmt(r.total_payroll)}</b></td>
        <td>${r.payroll_percent !== null ? r.payroll_percent + "%" : "-"}</td>
      </tr>
    `).join("");

    resultBox.innerHTML = `
      <h2>📊 Umumiy hisobot</h2>
      <div class="stat-grid">
        <div class="stat-mini"><div class="stat-mini-icon">💰</div><div class="stat-mini-num">${fmt(totalRevenue)}</div><div class="stat-mini-label">Jami tushum</div></div>
        <div class="stat-mini"><div class="stat-mini-icon">💵</div><div class="stat-mini-num">${fmt(totalFix)}</div><div class="stat-mini-label">Jami Fix</div></div>
        <div class="stat-mini"><div class="stat-mini-icon">🎯</div><div class="stat-mini-num">${fmt(totalKpi)}</div><div class="stat-mini-label">Jami KPI</div></div>
        <div class="stat-mini"><div class="stat-mini-icon">🎁</div><div class="stat-mini-num">${fmt(totalBonus)}</div><div class="stat-mini-label">Jami Bonus</div></div>
        <div class="stat-mini"><div class="stat-mini-icon">🧾</div><div class="stat-mini-num">${fmt(totalPayroll)}</div><div class="stat-mini-label">Umumiy ish haqi</div></div>
        <div class="stat-mini"><div class="stat-mini-icon">📈</div><div class="stat-mini-num">${avgPercent !== null ? avgPercent + "%" : "-"}</div><div class="stat-mini-label">O'rtacha ish haqi foizi</div></div>
      </div>

      <p style="font-size:12px;color:var(--hint);">O'qituvchining shu oy uchun umumiy tushumini (LMS'dagi ma'lumot asosida) kiriting — tizim ish haqini va uning tushumdan olgan foizini avtomatik hisoblaydi.</p>
      <div class="card" style="overflow-x:auto;">
        <table>
          <thead><tr><th>O'qituvchi</th><th>Tushum</th><th>Fix</th><th>KPI</th><th>Bonus</th><th>Umumiy ish haqi</th><th>Tushumdan ish haqi foizi</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='7'>Ma'lumot yo'q</td></tr>"}</tbody>
        </table>
      </div>
      <button class="primary" id="saveRevenueBtn">Saqlash</button>
      <div id="revenueMsg" style="margin-top:8px;font-size:13px;"></div>
    `;

    resultBox.querySelectorAll("input[data-revenue]").forEach((input) => {
      _attachMoneyFormatting(input);
    });

    resultBox.querySelector("#saveRevenueBtn").addEventListener("click", async () => {
      const msg = resultBox.querySelector("#revenueMsg");
      msg.textContent = "Saqlanmoqda...";
      try {
        const inputs = resultBox.querySelectorAll("input[data-revenue]");
        for (const input of inputs) {
          if (input.value === "") continue;
          const amount = _parseFormattedNumber(input.value);
          if (amount === null) continue;
          await api("/api/revenue", {
            method: "POST",
            body: JSON.stringify({
              teacher_id: input.dataset.revenue,
              month: select.value,
              amount: amount,
            }),
          });
        }
        msg.innerHTML = `<span class="badge ok">✅ Saqlandi</span>`;
        load();
      } catch (err) {
        msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
      }
    });
  }

  select.addEventListener("change", load);
  load();
}

async function renderRevenueHistory(box) {
  const employees = await api("/api/employees");
  const eligible = employees.filter((e) => e.role === "Teacher" || e.role === "SubjectTeacher");

  box.innerHTML = `
    <div class="card">
      <label>Xodim</label>
      <select id="revHistEmployee">
        ${eligible.map((e) => `<option value="${e.teacher_id}">${e.full_name} (${e.grade || e.subject || e.role})</option>`).join("")}
      </select>

      <label>Necha oylik tarix</label>
      <select id="revHistRange">
        <option value="3">Oxirgi 3 oy</option>
        <option value="6" selected>Oxirgi 6 oy</option>
        <option value="12">Oxirgi 12 oy</option>
      </select>
    </div>
    <div id="revHistResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;

  const employeeSelect = box.querySelector("#revHistEmployee");
  const rangeSelect = box.querySelector("#revHistRange");
  const resultBox = box.querySelector("#revHistResult");

  async function load() {
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const data = await api(`/api/revenue/history?teacher_id=${employeeSelect.value}&months=${rangeSelect.value}`);

      const itemsHtml = data.rows.map((r) => `
        <div class="sc-history-item">
          <div class="sc-history-info">
            <div class="sc-history-month">${r.month}</div>
            <div class="sc-history-mini">
              Tushum: ${r.revenue !== null ? fmt(r.revenue) : "kiritilmagan"}
              ${r.payroll_percent !== null ? ` · Ish haqi foizi: ${r.payroll_percent}%` : ""}
            </div>
          </div>
          <div class="sc-history-actions">
            <button class="mini-btn" data-edit-month="${r.month}">✏️ Tahrirlash</button>
          </div>
        </div>
        <div id="revEditWrap_${r.month.replace(/[^a-zA-Z0-9]/g, "")}"></div>
      `).join("");

      resultBox.innerHTML = `<div class="card">${itemsHtml || `<p style="color:var(--hint);font-size:13px;margin:0;">Tanlangan oraliqda ma'lumot yo'q</p>`}</div>`;

      resultBox.querySelectorAll("[data-edit-month]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const month = btn.dataset.editMonth;
          const row = data.rows.find((r) => r.month === month);
          const wrap = resultBox.querySelector(`#revEditWrap_${month.replace(/[^a-zA-Z0-9]/g, "")}`);

          if (wrap.dataset.open === "1") {
            wrap.innerHTML = "";
            wrap.dataset.open = "0";
            return;
          }

          wrap.dataset.open = "1";
          wrap.innerHTML = `
            <div class="card" style="margin-top:-4px;margin-bottom:12px;">
              <label>${month} uchun tushum (so'm)</label>
              <input type="text" inputmode="numeric" id="revEditInput_${month.replace(/[^a-zA-Z0-9]/g, "")}" value="${row.revenue !== null ? _formatThousands(String(Math.round(row.revenue))) : ""}" placeholder="0" />
              <button class="primary" id="revEditSave_${month.replace(/[^a-zA-Z0-9]/g, "")}">Saqlash</button>
              <div id="revEditMsg_${month.replace(/[^a-zA-Z0-9]/g, "")}" style="margin-top:8px;font-size:13px;"></div>
            </div>
          `;
          const safeId = month.replace(/[^a-zA-Z0-9]/g, "");
          const input = wrap.querySelector(`#revEditInput_${safeId}`);
          _attachMoneyFormatting(input);

          wrap.querySelector(`#revEditSave_${safeId}`).addEventListener("click", async () => {
            const msg = wrap.querySelector(`#revEditMsg_${safeId}`);
            msg.textContent = "Saqlanmoqda...";
            try {
              const amount = _parseFormattedNumber(input.value);
              await api("/api/revenue", {
                method: "POST",
                body: JSON.stringify({
                  teacher_id: employeeSelect.value,
                  month: month,
                  amount: amount || 0,
                }),
              });
              msg.innerHTML = `<span class="badge ok">✅ Saqlandi</span>`;
              load();
            } catch (err) {
              msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
            }
          });
        });
      });
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  employeeSelect.addEventListener("change", load);
  rangeSelect.addEventListener("change", load);
  load();
}

// ---------- EMPLOYEES TAB ----------

async function renderEmployeesTab(box, me) {
  await renderEmployeesList(box, me);
}

async function renderEmployeesList(box, me) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  const employees = await api("/api/employees");

  const rows = employees.map((e) => `
    <tr>
      <td>${e.full_name}<br/><span style="color:var(--hint);font-size:11px;">${e.login || e.teacher_id}</span></td>
      <td>${e.role}</td>
      <td>${e.grade || "-"}</td>
      <td>${e.workload_rate}</td>
      <td style="white-space:nowrap;">
        <button class="mini-btn" data-edit="${e.teacher_id}">✏️</button>
        <button class="mini-btn" data-deactivate="${e.teacher_id}">🗑️</button>
      </td>
    </tr>
  `).join("");

  box.innerHTML = `
    <div class="card" style="overflow-x:auto;">
      <table>
        <thead><tr><th>Ism</th><th>Rol</th><th>Grade</th><th>Stavka</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <h2>Yangi xodim qo'shish</h2>
    <div class="card">
      <label>Familya</label>
      <input id="e_lastname" type="text" placeholder="masalan: Yo'ldoshev" />

      <label>Ism</label>
      <input id="e_firstname" type="text" placeholder="masalan: Bobur" />

      <label>Otchestva (ixtiyoriy)</label>
      <input id="e_patronymic" type="text" placeholder="masalan: Alisher o'g'li" />

      <label>Rol</label>
      <select id="e_role">
        <option value="Teacher">Teacher (grade bo'yicha)</option>
        <option value="SubjectTeacher">Fan o'qituvchisi (tushum foizi bo'yicha)</option>
        <option value="EduManager">Edu Manager</option>
        <option value="Director">Director</option>
        <option value="Administrator">Administrator</option>
        <option value="SalesManager">Sotuv menejeri</option>
        <option value="CEO">CEO</option>
      </select>

      <label>Login (unikal, masalan T011 yoki DIR1) — xodim tizimga shu bilan kiradi</label>
      <input id="e_id" type="text" />

      <div id="e_teacherFields" style="display:none;">
        <label>Grade</label>
        <select id="e_grade">
          <option value="">-</option>
          <option value="T0">T0</option>
          <option value="T1">T1</option>
          <option value="T2">T2</option>
          <option value="T3">T3</option>
          <option value="T4">T4</option>
          <option value="T5">T5</option>
        </select>
      </div>

      <div id="e_subjectFields" style="display:none;">
        <label>Fan nomi (masalan: Matematika, Koreys tili)</label>
        <input id="e_subject" type="text" placeholder="masalan: Matematika" />

        <label>Tushumdan ulush foizi (%)</label>
        <input id="e_revenuePercent" type="number" step="1" min="0" max="100" placeholder="masalan: 40" />
        <p style="font-size:12px;color:var(--hint);margin:-4px 0 10px;">
          Har oy Tushum bo'limida kiritilgan summadan shu foiz avtomatik xarajat/rashchyot sifatida hisoblanadi.
        </p>
      </div>

      <div id="e_staffFields" style="display:none;">
        <label>Oylik maosh (so'm)</label>
        <input id="e_salary" type="text" inputmode="numeric" placeholder="masalan: 4 500 000" />
      </div>

      <label>Ish stavkasi (0.25 / 0.5 / 0.75 / 1.0)</label>
      <input id="e_workload" type="number" step="0.05" min="0" value="1.0" />

      <label>Tel raqam</label>
      <input id="e_phone" type="tel" value="+998 " />

      <label>Parol (ixtiyoriy)</label>
      <input id="e_password" type="text" placeholder="Bo'sh qoldirsangiz, avtomatik yaratiladi" />

      <button class="primary" id="addEmpBtn">Qo'shish</button>
      <div id="addEmpMsg" style="margin-top:8px;font-size:13px;"></div>
    </div>

    <p style="font-size:12px;color:var(--hint);padding:0 4px;">
      💡 Xodim tizimga yuqoridagi <b>Login</b> va shu yerda kiritgan (yoki avtomatik yaratilgan) <b>parol</b> bilan kiradi.
      Qo'shilgach, parol yana ko'rsatiladi — uni nusxalab xodimga yuboring.
    </p>
  `;

  const roleSelect = box.querySelector("#e_role");
  const teacherFieldsDiv = box.querySelector("#e_teacherFields");
  const subjectFieldsDiv = box.querySelector("#e_subjectFields");
  const staffFieldsDiv = box.querySelector("#e_staffFields");
  const salaryInput = box.querySelector("#e_salary");
  _attachMoneyFormatting(salaryInput);

  function toggleRoleFields() {
    const role = roleSelect.value;
    teacherFieldsDiv.style.display = role === "Teacher" ? "block" : "none";
    subjectFieldsDiv.style.display = role === "SubjectTeacher" ? "block" : "none";
    staffFieldsDiv.style.display = (role !== "Teacher" && role !== "SubjectTeacher") ? "block" : "none";
  }
  roleSelect.addEventListener("change", toggleRoleFields);
  toggleRoleFields();

  const phoneInput = box.querySelector("#e_phone");
  phoneInput.addEventListener("input", () => {
    phoneInput.value = _formatUzPhone(phoneInput.value);
  });

  box.querySelector("#addEmpBtn").addEventListener("click", async () => {
    const msg = box.querySelector("#addEmpMsg");

    const lastname = box.querySelector("#e_lastname").value.trim();
    const firstname = box.querySelector("#e_firstname").value.trim();
    const patronymic = box.querySelector("#e_patronymic").value.trim();
    const role = roleSelect.value;

    if (!lastname || !firstname) {
      msg.innerHTML = `<span class="badge warn">❌ Familya va Ism to'ldirilishi shart</span>`;
      return;
    }

    const teacherId = box.querySelector("#e_id").value.trim();
    if (!teacherId) {
      msg.innerHTML = `<span class="badge warn">❌ Login (ID) to'ldirilishi shart</span>`;
      return;
    }

    let grade = null;
    let fixedSalary = null;
    let subject = null;
    let revenuePercent = null;

    if (role === "Teacher") {
      grade = box.querySelector("#e_grade").value || null;
    } else if (role === "SubjectTeacher") {
      subject = box.querySelector("#e_subject").value.trim() || null;
      revenuePercent = parseFloat(box.querySelector("#e_revenuePercent").value);
      if (!subject) {
        msg.innerHTML = `<span class="badge warn">❌ Fan nomi to'ldirilishi shart</span>`;
        return;
      }
      if (isNaN(revenuePercent)) {
        msg.innerHTML = `<span class="badge warn">❌ Ulush foizi to'ldirilishi shart</span>`;
        return;
      }
    } else {
      fixedSalary = _parseFormattedNumber(salaryInput.value);
    }

    const fullName = [lastname, firstname, patronymic].filter(Boolean).join(" ");
    const phone = _parseUzPhone(phoneInput.value);

    msg.textContent = "Qo'shilmoqda...";
    try {
      const res = await api("/api/employees", {
        method: "POST",
        body: JSON.stringify({
          teacher_id: teacherId,
          full_name: fullName,
          role: role,
          grade: grade,
          workload_rate: parseFloat(box.querySelector("#e_workload").value) || 1.0,
          phone: phone,
          fixed_salary: fixedSalary,
          subject: subject,
          revenue_percent: revenuePercent,
          password: box.querySelector("#e_password").value.trim() || null,
        }),
      });
      msg.innerHTML = `<span class="badge ok">✅ Qo'shildi</span>`;
      showSuccessModal("Xodim qo'shildi", `<b>${fullName}</b> tizimga muvaffaqiyatli qo'shildi.`);
      setTimeout(() => renderEmployeesList(box, me), 700);
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
    }
  });

  box.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const emp = employees.find((e) => e.teacher_id === btn.dataset.edit);
      renderEmployeeEditForm(box, me, emp);
    });
  });

  box.querySelectorAll("[data-deactivate]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const emp = employees.find((e) => e.teacher_id === btn.dataset.deactivate);
      showConfirm(
        "Xodimni faolsizlantirish",
        `<b>${emp.full_name}</b>ni faolsizlantirmoqchimisiz? U ro'yxatlarda ko'rinmay qoladi, lekin tarixiy moliya ma'lumotlari saqlanib qoladi.`,
        async () => {
          await api(`/api/employees/${emp.teacher_id}/deactivate`, { method: "POST" });
          renderEmployeesList(box, me);
        }
      );
    });
  });
}

async function _loadTeacherGroupInfo(box, emp) {
  try {
    const s = await api("/api/settings");
    const groupsPerStavka = s.groups_per_stavka || 6;
    const history = await api(`/api/employees/${emp.teacher_id}/grade-history`);
    const currentGroups = history.length && history[0].group_count !== null
      ? history[0].group_count
      : Math.round((emp.workload_rate || 0) * groupsPerStavka);
    const infoEl = box.querySelector("#ed_currentGroupsInfo");
    if (infoEl) {
      infoEl.innerHTML = `📊 Joriy holat: <b>${currentGroups} ta guruh</b> (${(currentGroups / groupsPerStavka).toFixed(3)} stavka) · 1 stavka = ${groupsPerStavka} guruh`;
    }
    const histCard = box.querySelector("#ed_gradeHistoryCard");
    if (histCard) {
      histCard.innerHTML = history.length
        ? history.map((h) => `
            <div class="row">
              <span class="label">${h.effective_date} dan</span>
              <span class="value">${h.grade} · ${Number(h.workload_rate).toFixed(3)} stavka${h.group_count !== null ? ` (${h.group_count} guruh)` : ""}</span>
            </div>
            ${h.change_note ? `<p style="font-size:11px;color:var(--hint);margin:-4px 0 8px;">${h.change_note}</p>` : ""}
            <button class="mini-btn" data-delete-history="${h.id}" style="margin-bottom:10px;">🗑️ Bu yozuvni o'chirish</button>
          `).join("")
        : `<p style="font-size:12px;color:var(--hint);margin:0;">Tarix hali yo'q</p>`;

      histCard.querySelectorAll("[data-delete-history]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const entryId = btn.dataset.deleteHistory;
          showConfirm(
            "Yozuvni o'chirish",
            "Bu Grade/Stavka tarixi yozuvi butunlay o'chirilsinmi? Bu amalni qaytarib bo'lmaydi.",
            async () => {
              try {
                await api(`/api/employees/${emp.teacher_id}/grade-history/${entryId}/delete`, { method: "POST" });
                await _loadTeacherGroupInfo(box, emp);
              } catch (err) {
                safeAlert("Xato: " + err.message);
              }
            }
          );
        });
      });
    }
  } catch (err) {
    const histCard = box.querySelector("#ed_gradeHistoryCard");
    if (histCard) histCard.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}

async function _handleGroupChange(box, emp, me, direction) {
  const msg = box.querySelector("#ed_groupMsg");
  const date = box.querySelector("#ed_groupDate").value;
  const count = parseInt(box.querySelector("#ed_groupCount").value, 10) || 1;
  const note = box.querySelector("#ed_groupNote").value.trim() || null;
  const deltaGroups = direction * count;

  const verb = direction > 0 ? "qo'shilsinmi" : "ayirilsinmi";
  showConfirm(
    "Guruh o'zgarishini tasdiqlang",
    `<b>${emp.full_name}</b>ga <b>${date}</b> sanasidan boshlab <b>${count} ta guruh</b> ${verb}? Bu shu sanadan keyingi kunlar uchun stavkani avtomatik qayta hisoblaydi.`,
    async () => {
      msg.textContent = "Saqlanmoqda...";
      try {
        const res = await api(`/api/employees/${emp.teacher_id}/group-change`, {
          method: "POST",
          body: JSON.stringify({ effective_date: date, delta_groups: deltaGroups, note }),
        });
        msg.innerHTML = `<span class="badge ok">✅ Yangi holat: ${res.new_group_count} ta guruh (${res.new_workload_rate} stavka)</span>`;
        emp.workload_rate = res.new_workload_rate;
        box.querySelector("#ed_workload").value = res.new_workload_rate;
        box.querySelector("#ed_groupNote").value = "";
        await _loadTeacherGroupInfo(box, emp);
      } catch (err) {
        msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
      }
    }
  );
}

function renderEmployeeEditForm(box, me, emp) {
  const isTeacher = emp.role === "Teacher";
  const isSubjectTeacher = emp.role === "SubjectTeacher";
  const isStaff = !isTeacher && !isSubjectTeacher;

  box.innerHTML = `
    <button class="back-btn" id="backBtn">← Orqaga</button>
    <h2>${emp.full_name}ni tahrirlash</h2>
    <div class="card">
      <label>To'liq ism</label>
      <input id="ed_name" type="text" value="${emp.full_name}" />

      ${isTeacher ? `
        <label>Grade</label>
        <select id="ed_grade">
          <option value="">-</option>
          ${["T0", "T1", "T2", "T3", "T4", "T5"].map((g) => `<option value="${g}" ${emp.grade === g ? "selected" : ""}>${g}</option>`).join("")}
        </select>
      ` : isSubjectTeacher ? `
        <label>Fan nomi</label>
        <input id="ed_subject" type="text" value="${emp.subject || ""}" placeholder="masalan: Matematika" />

        <label>Tushumdan ulush foizi (%)</label>
        <input id="ed_revenuePercent" type="number" step="1" min="0" max="100" value="${emp.revenue_percent ?? ""}" />
      ` : `
        <label>Oylik maosh (so'm)</label>
        <input id="ed_salary" type="text" inputmode="numeric" value="${emp.fixed_salary ? _formatThousands(String(Math.round(emp.fixed_salary))) : ""}" placeholder="masalan: 4 500 000" />
      `}

      <label>Stavka</label>
      <input id="ed_workload" type="number" step="0.05" value="${emp.workload_rate}" />

      ${isTeacher ? `
        <label>Qaysi sanadan kuchga kirsin?</label>
        <input id="ed_effectiveDate" type="date" value="${_todayDateStr()}" />
        <p style="font-size:11px;color:var(--hint);margin:-4px 0 10px;">
          Grade/Stavka o'zgarishi faqat shu sanadan boshlab qo'llanadi — oldingi kunlarning hisob-kitobi o'zgarmaydi.
          Agar oy ICHIDA o'zgartirsangiz, Fix shu oy uchun kunlarga mutanosib (prorata) hisoblanadi.
        </p>
      ` : ""}

      <button class="primary" id="ed_saveBtn">Saqlash</button>
      <div id="ed_msg" style="margin-top:8px;font-size:13px;"></div>
    </div>

    ${isTeacher ? `
      <h2>🔀 Guruh qo'shish/ayirish (tezkor)</h2>
      <div class="card">
        <p style="font-size:12px;color:var(--hint);margin:0 0 10px;" id="ed_currentGroupsInfo">Joriy holat yuklanmoqda...</p>
        <label>Sana</label>
        <input id="ed_groupDate" type="date" value="${_todayDateStr()}" />
        <label>Nechta guruh</label>
        <input id="ed_groupCount" type="number" min="1" step="1" value="1" />
        <label>Izoh (ixtiyoriy)</label>
        <input id="ed_groupNote" type="text" placeholder="masalan: T2-Beginner guruhi qo'shildi" />
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="secondary" id="ed_groupRemoveBtn" style="flex:1;">− Ayirish</button>
          <button class="primary" id="ed_groupAddBtn" style="flex:1;">+ Qo'shish</button>
        </div>
        <div id="ed_groupMsg" style="margin-top:8px;font-size:13px;"></div>
      </div>

      <h2>Grade/Stavka tarixi</h2>
      <div class="card" id="ed_gradeHistoryCard"><div class="center-box"><div class="spinner"></div></div></div>
    ` : ""}

    <h2>Kirish ma'lumotlari</h2>
    <div class="card">
      <p style="font-size:13px;color:var(--hint);margin-top:0;">
        Xodim tizimga shu login va parol bilan kiradi. Parol maydonini bo'sh qoldirsangiz,
        eski parol o'zgarmaydi.
      </p>

      <label>Login</label>
      <input id="ed_login" type="text" value="${emp.login || emp.teacher_id}" autocomplete="off" />

      <label>Yangi parol</label>
      <input id="ed_newPw" type="text" placeholder="Bo'sh qoldirsangiz, o'zgarmaydi" autocomplete="off" />

      <button class="primary" id="ed_saveCreds">Kirish ma'lumotlarini saqlash</button>
      <div id="ed_credsMsg" style="margin:8px 0 12px;font-size:13px;"></div>

      <button class="secondary" id="ed_resetPw">🎲 Tasodifiy parol yaratish</button>
    </div>
  `;

  if (isTeacher) {
    _loadTeacherGroupInfo(box, emp);

    box.querySelector("#ed_groupAddBtn").addEventListener("click", () => _handleGroupChange(box, emp, me, 1));
    box.querySelector("#ed_groupRemoveBtn").addEventListener("click", () => _handleGroupChange(box, emp, me, -1));
  }

  if (isStaff) {
    _attachMoneyFormatting(box.querySelector("#ed_salary"));
  }

  box.querySelector("#backBtn").addEventListener("click", () => renderEmployeesList(box, me));

  box.querySelector("#ed_saveBtn").addEventListener("click", async () => {
    const msg = box.querySelector("#ed_msg");
    msg.textContent = "Saqlanmoqda...";
    try {
      const payload = {
        full_name: box.querySelector("#ed_name").value.trim(),
        workload_rate: parseFloat(box.querySelector("#ed_workload").value),
      };
      if (isTeacher) {
        payload.grade = box.querySelector("#ed_grade").value || null;
        payload.effective_date = box.querySelector("#ed_effectiveDate").value;
      } else if (isSubjectTeacher) {
        payload.subject = box.querySelector("#ed_subject").value.trim();
        const pct = parseFloat(box.querySelector("#ed_revenuePercent").value);
        if (!isNaN(pct)) payload.revenue_percent = pct;
      } else {
        payload.fixed_salary = _parseFormattedNumber(box.querySelector("#ed_salary").value);
      }
      await api(`/api/employees/${emp.teacher_id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      msg.innerHTML = `<span class="badge ok">✅ Saqlandi</span>`;
      setTimeout(() => renderEmployeesList(box, me), 700);
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
    }
  });

  box.querySelector("#ed_saveCreds").addEventListener("click", async () => {
    const msg = box.querySelector("#ed_credsMsg");
    const newLogin = box.querySelector("#ed_login").value.trim();
    const newPw = box.querySelector("#ed_newPw").value.trim();

    if (!newLogin) {
      msg.innerHTML = `<span class="badge warn">❌ Login bo'sh bo'lishi mumkin emas</span>`;
      return;
    }

    msg.textContent = "Saqlanmoqda...";
    try {
      await api(`/api/employees/${emp.teacher_id}/credentials`, {
        method: "POST",
        body: JSON.stringify({ login: newLogin, password: newPw || null }),
      });
      emp.login = newLogin;
      box.querySelector("#ed_newPw").value = "";
      msg.innerHTML = `<span class="badge ok">✅ Saqlandi</span>`;
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
    }
  });

  box.querySelector("#ed_resetPw").addEventListener("click", () => {
    showConfirm(
      "Tasodifiy parol yaratish",
      `<b>${emp.full_name}</b> uchun yangi tasodifiy parol yaratiladi. Eski parol shu zahoti ishlamay qoladi. Davom etasizmi?`,
      async () => {
        try {
          const res = await api(`/api/employees/${emp.teacher_id}/set-password`, {
            method: "POST",
            body: JSON.stringify({}),
          });
          showPasswordModal(res.password, emp.full_name);
        } catch (err) {
          safeAlert("Xato: " + err.message);
        }
      }
    );
  });
}

// ---------- REPORTS TAB (Hisobotlar) ----------

async function renderReportsTab(box) {
  renderReportsHome(box);
}

function renderReportsHome(box) {
  box.innerHTML = `
    <div class="menu-grid">
      <div class="menu-card" data-nav="teacher">
        <div class="menu-icon">👨‍🏫</div>
        <div class="menu-text">
          <div class="menu-label">O'qituvchi hisobi</div>
          <div class="menu-desc">Fix, KPI, bonus, stavka va moliyaviy tarix</div>
        </div>
        <div class="menu-arrow">›</div>
      </div>
      <div class="menu-card" data-nav="scorecard">
        <div class="menu-icon">📇</div>
        <div class="menu-text">
          <div class="menu-label">Scorecard hisobotlari</div>
          <div class="menu-desc">Oy bo'yicha, har bir KPI yo'nalishida o'rtacha ko'rsatkich</div>
        </div>
        <div class="menu-arrow">›</div>
      </div>
      <div class="menu-card" data-nav="company">
        <div class="menu-icon">🏢</div>
        <div class="menu-text">
          <div class="menu-label">Kompaniya</div>
          <div class="menu-desc">Sana oralig'i bo'yicha umumiy ko'rsatkichlar</div>
        </div>
        <div class="menu-arrow">›</div>
      </div>
      <div class="menu-card" data-nav="tasks">
        <div class="menu-icon">📋</div>
        <div class="menu-text">
          <div class="menu-label">Topshiriqlar tarixi</div>
          <div class="menu-desc">Rollar bo'yicha bajarilgan/bajarilmagan topshiriqlar</div>
        </div>
        <div class="menu-arrow">›</div>
      </div>
      <div class="menu-card" data-nav="rating">
        <div class="menu-icon">🏆</div>
        <div class="menu-text">
          <div class="menu-label">Xodimlar reytingi</div>
          <div class="menu-desc">Kim qancha vaqtda bajaradi — umumiy va rollar bo'yicha</div>
        </div>
        <div class="menu-arrow">›</div>
      </div>
    </div>
  `;

  box.querySelectorAll("[data-nav]").forEach((card) => {
    card.addEventListener("click", () => {
      if (card.dataset.nav === "teacher") renderTeacherReportSection(box);
      else if (card.dataset.nav === "scorecard") renderScorecardReportSection(box);
      else if (card.dataset.nav === "tasks") renderTasksReportSection(box);
      else if (card.dataset.nav === "rating") renderTasksRatingSection(box);
      else renderCompanyReportSection(box);
    });
  });
}

// ---------- Xodimlar reytingi (topshiriqlar bo'yicha) ----------

function _fmtDuration(minutes) {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 60) return `${minutes} daq`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const m = minutes % 60;
    return m ? `${hours} soat ${m} daq` : `${hours} soat`;
  }
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${days} kun ${h} soat` : `${days} kun`;
}

function _ratingMedal(rank) {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`;
}

function _scoreColor(score) {
  if (score >= 80) return "var(--green)";
  if (score >= 50) return "var(--orange)";
  return "var(--red)";
}

function _ratingRowHtml(e, rank) {
  return `
    <div class="rating-row">
      <div class="rating-rank">${_ratingMedal(rank)}</div>
      <div class="rating-main">
        <div class="rating-name">${e.full_name}</div>
        <div class="rating-sub">${e.role_label} · ${e.done}/${e.assigned} bajargan${e.overdue > 0 ? ` · <span style="color:var(--red);">${e.overdue} muddati o'tgan</span>` : ""}</div>
        <div class="rating-metrics">
          <span title="O'rtacha: yaratilgandan ochilgunicha">👁️ ${_fmtDuration(e.avg_seen_minutes)}</span>
          <span title="O'rtacha: yaratilgandan boshlagunicha">🔄 ${_fmtDuration(e.avg_start_minutes)}</span>
          <span title="O'rtacha: yaratilgandan bajarilgunicha">✅ ${_fmtDuration(e.avg_done_minutes)}</span>
          <span title="Muddatida bajarilgan ulushi">⏱️ ${e.on_time_rate}%</span>
        </div>
      </div>
      <div class="rating-score" style="color:${_scoreColor(e.score)};">
        ${e.score}
        <span class="rating-score-label">ball</span>
      </div>
    </div>
  `;
}

async function renderTasksRatingSection(box) {
  box.innerHTML = `<button class="back-btn" id="rtBackBtn">← Orqaga</button><div id="rtInner"></div>`;
  box.querySelector("#rtBackBtn").addEventListener("click", () => renderReportsHome(box));
  await renderTasksRatingContent(box.querySelector("#rtInner"));
}

async function renderTasksRatingContent(box) {
  const today = _todayDateStr();
  const monthAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();

  box.innerHTML = `
    <h2>🏆 Xodimlar reytingi</h2>
    <div class="card">
      <label>Boshlanish sanasi</label>
      <input type="date" id="rtStart" value="${monthAgo}" max="${today}" />
      <label>Tugash sanasi</label>
      <input type="date" id="rtEnd" value="${today}" max="${today}" />
    </div>
    <div id="rtResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;

  const startInput = box.querySelector("#rtStart");
  const endInput = box.querySelector("#rtEnd");

  async function load() {
    const resultBox = box.querySelector("#rtResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const d = await api(`/api/reports/tasks-rating?start=${startInput.value}&end=${endInput.value}`);

      if (!d.rating.length) {
        resultBox.innerHTML = `<p style="color:var(--hint);font-size:13px;">Bu davrda aniq xodimga yuborilgan topshiriq topilmadi.</p>`;
        return;
      }

      const overallHtml = `
        <h2>📊 Umumiy reyting</h2>
        <div class="card">${d.rating.map((e) => _ratingRowHtml(e, e.rank)).join("")}</div>
      `;

      const byRoleHtml = d.by_role.map((r) => `
        <h2>${r.role_label} <span style="font-size:10px;color:var(--hint);text-transform:none;">(o'rtacha ${r.avg_score} ball · ${r.total_done}/${r.total_assigned} bajarilgan)</span></h2>
        <div class="card">${r.employees.map((e) => _ratingRowHtml(e, e.role_rank)).join("")}</div>
      `).join("");

      resultBox.innerHTML = `
        ${overallHtml}
        <h2>👥 Rollar bo'yicha</h2>
        ${byRoleHtml}
        <div class="card" style="font-size:12px;color:var(--hint);line-height:1.6;">
          <b>Ball qanday hisoblanadi (100 ball):</b><br/>
          • <b>50 ball</b> — bajarish ulushi (bajarilgan ÷ berilgan)<br/>
          • <b>30 ball</b> — muddatida bajarish ulushi (muddatida ÷ bajarilgan)<br/>
          • <b>20 ball</b> — o'rtacha bajarish tezligi: 4 soatgacha 20, 24 soatgacha 15, 48 soatgacha 10, 72 soatgacha 5 ball<br/><br/>
          👁️ ochilgunicha · 🔄 boshlangunicha · ✅ bajarilgunicha o'tgan o'rtacha vaqt (topshiriq yaratilgan paytdan boshlab).
          Faqat aniq xodimga yuborilgan topshiriqlar hisobga olinadi.
        </div>
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  startInput.addEventListener("change", load);
  endInput.addEventListener("change", load);
  load();
}

async function renderTasksReportSection(box) {
  box.innerHTML = `<button class="back-btn" id="trBackBtn">← Orqaga</button><div id="trInner"></div>`;
  box.querySelector("#trBackBtn").addEventListener("click", () => renderReportsHome(box));
  await renderTasksReportContent(box.querySelector("#trInner"));
}

async function renderTasksReportContent(box) {
  const today = _todayDateStr();
  const monthAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();

  box.innerHTML = `
    <h2>📋 Topshiriqlar tarixi</h2>
    <div class="card">
      <label>Boshlanish sanasi</label>
      <input type="date" id="trStart" value="${monthAgo}" max="${today}" />
      <label>Tugash sanasi</label>
      <input type="date" id="trEnd" value="${today}" max="${today}" />
    </div>
    <div id="trResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;

  const startInput = box.querySelector("#trStart");
  const endInput = box.querySelector("#trEnd");

  async function load() {
    const resultBox = box.querySelector("#trResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const d = await api(`/api/reports/tasks-summary?start=${startInput.value}&end=${endInput.value}`);

      const overallHtml = `
        <div class="stat-grid" style="grid-template-columns: repeat(4, 1fr);">
          <div class="stat-mini"><div class="stat-mini-icon">📋</div><div class="stat-mini-num">${d.overall.total}</div><div class="stat-mini-label">Jami</div></div>
          <div class="stat-mini"><div class="stat-mini-icon">✅</div><div class="stat-mini-num" style="color:var(--green);">${d.overall.done}</div><div class="stat-mini-label">Bajarilgan</div></div>
          <div class="stat-mini"><div class="stat-mini-icon">👁️</div><div class="stat-mini-num" style="color:#a6790a;">${d.overall.in_progress}</div><div class="stat-mini-label">Jarayonda</div></div>
          <div class="stat-mini"><div class="stat-mini-icon">🆕</div><div class="stat-mini-num" style="color:var(--red);">${d.overall.not_done}</div><div class="stat-mini-label">Bajarilmagan</div></div>
        </div>
        ${d.overall.total_penalty > 0 ? `
          <div class="total-box" style="background:linear-gradient(135deg,#e5484d,#b8302f);">
            <div class="caption">⚠️ Jami jarima (${d.overall.overdue} ta muddati o'tgan topshiriq)</div>
            <div class="amount">${fmt(d.overall.total_penalty)}</div>
          </div>
        ` : ""}
      `;

      const roleSectionsHtml = d.by_role.length
        ? d.by_role.map((r) => {
            const donePct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
            const employeesHtml = r.employees.length
              ? r.employees.map((e) => {
                  const isGood = e.pending === 0;
                  return `
                    <div class="task-report-emp-row">
                      <span class="task-report-emp-name">${isGood ? "✅" : "⚠️"} ${e.full_name}</span>
                      <span class="task-report-emp-stats">${e.done}/${e.assigned} bajargan${e.pending > 0 ? `, <b style="color:var(--red);">${e.pending} kutilmoqda</b>` : ""}${e.total_penalty > 0 ? `<br/><span style="color:var(--red);font-size:11px;">⚠️ Jarima: ${fmt(e.total_penalty)}</span>` : ""}</span>
                    </div>
                  `;
                }).join("")
              : `<p style="font-size:12px;color:var(--hint);margin:4px 0;">Aniq xodimga yuborilgan topshiriq yo'q</p>`;

            return `
              <div class="card">
                <div class="task-report-role-head">
                  <span class="task-report-role-name">${r.role_label}</span>
                  <span class="task-report-role-total">${r.total} ta topshiriq</span>
                </div>
                <div class="compare-bar-track" style="margin-bottom:10px;">
                  <div class="compare-bar-fill revenue" style="width:${donePct}%;"></div>
                </div>
                <div class="task-report-mini-stats">
                  <span>✅ ${r.done} bajarilgan</span>
                  <span>👁️ ${r.in_progress} jarayonda</span>
                  <span>🆕 ${r.not_done} bajarilmagan</span>
                </div>
                ${r.total_penalty > 0 ? `<p style="font-size:12px;color:var(--red);margin:6px 0;">⚠️ Jarima (${r.penalty_rate}/dona × ${r.overdue} ta muddati o'tgan) = <b>${fmt(r.total_penalty)}</b></p>` : ""}
                <div class="task-report-employees">${employeesHtml}</div>
              </div>
            `;
          }).join("")
        : `<p style="color:var(--hint);font-size:13px;text-align:center;padding:20px 0;">Tanlangan oraliqda topshiriq topilmadi</p>`;

      resultBox.innerHTML = `
        ${overallHtml}
        <h2>Rollar bo'yicha</h2>
        ${roleSectionsHtml}
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  startInput.addEventListener("change", load);
  endInput.addEventListener("change", load);
  await load();
}

async function renderScorecardReportSection(box) {
  box.innerHTML = `<button class="back-btn" id="scrBackBtn">← Orqaga</button><div id="scrInner"></div>`;
  box.querySelector("#scrBackBtn").addEventListener("click", () => renderReportsHome(box));
  await renderScorecardReportContent(box.querySelector("#scrInner"));
}

async function renderScorecardReportContent(box) {
  box.innerHTML = `
    <div id="scrMainWrap"></div>
  `;
  await renderScorecardReportMain(box.querySelector("#scrMainWrap"));
}

async function renderScorecardReportMain(box, selectedMonth) {
  box.innerHTML = `
    <h2>📇 Scorecard hisobotlari</h2>
    <div class="month-picker">
      <label style="margin:0;">Oy:</label>
      <select id="scrMonth">
        ${lastNMonths(6).map((m) => `<option value="${m}" ${m === selectedMonth ? "selected" : ""}>${m}</option>`).join("")}
      </select>
    </div>
    <div id="scrResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;

  const select = box.querySelector("#scrMonth");

  async function load() {
    const resultBox = box.querySelector("#scrResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const d = await api(`/api/reports/scorecard-summary?month=${select.value}`);

      const missingHtml = d.missing_scorecard.length
        ? `<div class="gate-warning">⚠️ Scorecard kiritilmagan: ${d.missing_scorecard.map((m) => m.full_name).join(", ")}</div>`
        : "";

      const criteriaHtml = d.criteria.map((c) => {
        const pct = c.avg_percent;
        const colorClass = pct === null ? "" : _kpiColorClass(pct);
        const barColor = colorClass === "green" ? "var(--green)" : colorClass === "yellow" ? "#e8a33d" : "var(--red)";
        const gateHtml = c.gate > 0
          ? `<span class="criterion-gate-chip ${c.below_gate_count > 0 ? "criterion-gate-warn" : ""}">Gate ${c.gate}%${c.below_gate_count > 0 ? ` · ${c.below_gate_count} kishi past` : ""}</span>`
          : "";
        return `
          <div class="criterion-row criterion-row-clickable" data-criterion="${c.key}" data-label="${c.label}">
            <div class="criterion-header">
              <span class="criterion-label">${c.label}</span>
              <span class="kpi-chip ${colorClass || "red"}">${pct !== null ? pct + "%" : "-"}</span>
              <span class="criterion-arrow">›</span>
            </div>
            <div class="criterion-bar-track">
              <div class="criterion-bar-fill" style="width:${pct !== null ? pct : 0}%;background:${pct !== null ? barColor : "#e5e5ea"};"></div>
            </div>
            <div class="criterion-sub">O'rtacha ball: ${c.avg_ball !== null ? c.avg_ball : "-"} / ${c.max_ball} · Xom o'rtacha: ${c.avg_raw_percent !== null ? c.avg_raw_percent + "%" : "-"} · Batafsil uchun bosing</div>
            ${gateHtml ? `<div style="margin-top:6px;">${gateHtml}</div>` : ""}
          </div>
        `;
      }).join("");

      resultBox.innerHTML = `
        <div class="total-box">
          <div class="caption">${d.month} — O'rtacha umumiy KPI foizi (${d.teacher_count} o'qituvchi bo'yicha)</div>
          <div class="amount">${d.avg_kpi_percent !== null ? d.avg_kpi_percent + "%" : "-"}</div>
        </div>
        ${missingHtml}
        <h2>Mezonlar bo'yicha o'rtacha</h2>
        <div class="card">
          ${criteriaHtml}
        </div>
      `;

      resultBox.querySelectorAll("[data-criterion]").forEach((rowEl) => {
        rowEl.addEventListener("click", () => {
          const critInfo = d.criteria.find((c) => c.key === rowEl.dataset.criterion);
          renderScorecardCriterionDetail(
            box, rowEl.dataset.criterion, rowEl.dataset.label, d.month, d.teachers, critInfo ? critInfo.gate : 0
          );
        });
      });
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  select.addEventListener("change", load);
  load();
}

function renderScorecardCriterionDetail(box, criterionKey, criterionLabel, month, teachers, gate) {
  const key = `${criterionKey}_percent`;
  const rawKey = `${criterionKey}_raw_percent`;
  const belowGateKey = `${criterionKey}_below_gate`;
  const ranked = [...teachers].sort((a, b) => b[key] - a[key]);
  const medals = ["🥇", "🥈", "🥉"];

  const rowsHtml = ranked.map((t, i) => {
    const pct = t[key];
    const rawPct = t[rawKey];
    const isBelowGate = t[belowGateKey];
    const colorClass = _kpiColorClass(pct);
    return `
      <div class="criterion-rank-row ${isBelowGate ? "criterion-rank-below-gate" : ""}">
        <div class="criterion-rank-num">${medals[i] || (i + 1)}</div>
        <div class="criterion-rank-name">
          ${t.full_name}
          ${isBelowGate ? `<span class="criterion-gate-flag">⚠️ Gate ostida</span>` : ""}
          <div class="criterion-rank-raw">Xom: ${rawPct}%</div>
        </div>
        <div class="criterion-rank-percent kpi-chip ${colorClass}">${pct}%</div>
      </div>
    `;
  }).join("");

  box.innerHTML = `
    <button class="back-btn" id="critBackBtn">← Orqaga</button>
    <h2>${criterionLabel} — ${month}</h2>
    <p style="font-size:12px;color:var(--hint);margin-top:-8px;">
      O'qituvchilar eng yuqori natijadan pastga qarab tartiblangan. Har birida ball asosidagi foiz
      (katta) va xom kiritilgan qiymat (kichik) ko'rsatiladi.
      ${gate > 0 ? `Gate chegarasi: <b>${gate}%</b> (xom qiymat bo'yicha) — pastdagilar belgilangan.` : ""}
    </p>
    <div class="card">
      ${rowsHtml || `<p style="color:var(--hint);font-size:13px;margin:0;">Ma'lumot yo'q</p>`}
    </div>
  `;

  box.querySelector("#critBackBtn").addEventListener("click", () => renderScorecardReportMain(box, month));
}

async function renderTeacherReportSection(box) {
  box.innerHTML = `
    <button class="back-btn" id="repBackHome">← Orqaga</button>
    <div id="repInner"></div>
  `;
  box.querySelector("#repBackHome").addEventListener("click", () => renderReportsHome(box));
  await renderReportsSummary(box.querySelector("#repInner"));
}

async function renderCompanyReportSection(box) {
  box.innerHTML = `
    <button class="back-btn" id="compBackHome">← Orqaga</button>
    <div id="compInner"></div>
  `;
  box.querySelector("#compBackHome").addEventListener("click", () => renderReportsHome(box));
  await renderCompanyRangeReport(box.querySelector("#compInner"));
}

function _defaultRangeDates() {
  const end = _todayStr();
  const d = new Date();
  d.setDate(d.getDate() - 6);
  const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start, end };
}

async function renderCompanyRangeReport(box) {
  const { start, end } = _defaultRangeDates();

  box.innerHTML = `
    <div class="card">
      <label>Boshlanish sanasi</label>
      <input type="date" id="crStart" value="${start}" />
      <label>Tugash sanasi</label>
      <input type="date" id="crEnd" value="${end}" />
    </div>
    <div id="crResult"><div class="center-box"><div class="spinner"></div></div></div>
  `;

  const startInput = box.querySelector("#crStart");
  const endInput = box.querySelector("#crEnd");

  async function load() {
    const resultBox = box.querySelector("#crResult");
    resultBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const d = await api(`/api/company-metrics/range?start=${startInput.value}&end=${endInput.value}`);

      if (d.days_with_data === 0) {
        resultBox.innerHTML = `<p style="color:var(--hint);font-size:13px;">Tanlangan oraliqda ma'lumot kiritilmagan</p>`;
        return;
      }

      const growthHtml = d.aggregate_growth !== null
        ? `
          <div class="growth-banner ${d.aggregate_growth >= 0 ? "growth-up" : "growth-down"}">
            <span class="growth-icon">${d.aggregate_growth >= 0 ? "📈" : "📉"}</span>
            <span class="growth-text">${d.aggregate_growth >= 0 ? "O'sish" : "Tushish"}: ${d.aggregate_growth > 0 ? "+" : ""}${d.aggregate_growth} ta o'quvchi</span>
          </div>
        `
        : "";

      const dailyRows = d.daily.map((r) => {
        const chip = r.growth === null
          ? ""
          : `<span class="growth-chip ${r.growth >= 0 ? "up" : "down"}">${r.growth >= 0 ? "▲" : "▼"} ${r.growth}</span>`;
        return `
          <div class="cm-history-item">
            <div class="cm-history-date">${r.date}</div>
            <div class="cm-history-mid">
              <span class="cm-history-label">Tushum:</span> ${fmt(r.total_revenue)}
              <span class="cm-history-label" style="margin-left:8px;">Xarajat:</span> ${fmt(r.total_expense)}
            </div>
            ${chip}
          </div>
        `;
      }).join("");

      resultBox.innerHTML = `
        <div class="total-box">
          <div class="caption">${d.start} — ${d.end} (${d.days_with_data} kun ma'lumot bilan) — sof foyda</div>
          <div class="amount">${fmt(d.total_profit)}</div>
        </div>
        ${growthHtml}

        <h2>💰 Moliya</h2>
        <div class="dash-grid">
          <div class="dash-card"><div class="dash-num">${fmt(d.total_revenue)}</div><div class="dash-label">Jami tushum</div></div>
          <div class="dash-card"><div class="dash-num">${fmt(d.total_expense)}</div><div class="dash-label">Jami xarajat</div></div>
        </div>

        <h2>🎒 Talabalar harakati</h2>
        <div class="dash-grid">
          <div class="dash-card"><div class="dash-num">${d.sums.new_admissions}</div><div class="dash-label">Yangi qabul</div></div>
          <div class="dash-card"><div class="dash-num">${d.sums.sales_count}</div><div class="dash-label">Sotuv</div></div>
          <div class="dash-card"><div class="dash-num">${d.sums.left_count}</div><div class="dash-label">Chiqib ketgan</div></div>
          <div class="dash-card"><div class="dash-num">${d.sums.frozen_count}</div><div class="dash-label">Muzlatilgan</div></div>
          <div class="dash-card"><div class="dash-num">${d.sums.trial_count}</div><div class="dash-label">Sinov darsi</div></div>
          <div class="dash-card"><div class="dash-num">${d.sums.risky_count}</div><div class="dash-label">Xavfli o'quvchi</div></div>
          <div class="dash-card" style="grid-column: span 2;"><div class="dash-num">${d.avg_attendance_percent !== null ? d.avg_attendance_percent + "%" : "-"}</div><div class="dash-label">O'rtacha davomat foizi</div></div>
        </div>

        <h2>☎️ Qo'ng'iroqlar va bog'lanish</h2>
        <div class="dash-grid">
          <div class="dash-card"><div class="dash-num">${d.sums.repeat_sales_calls}</div><div class="dash-label">Qayta sotuv qo'ng'iroqlari</div></div>
          <div class="dash-card"><div class="dash-num">${d.sums.admin_contacted_clients}</div><div class="dash-label">Admin bog'langan mijozlar</div></div>
          <div class="dash-card" style="grid-column: span 2;"><div class="dash-num">${d.sums.risky_contacted_count}</div><div class="dash-label">Xavflilar bilan bog'lanildi</div></div>
        </div>

        <h2>📅 Kunlar bo'yicha</h2>
        ${dailyRows}
      `;
    } catch (err) {
      resultBox.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }

  startInput.addEventListener("change", load);
  endInput.addEventListener("change", load);
  load();
}

async function renderReportsSummary(box, selectedMonth) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;

  const monthOptions = lastNMonths(6);
  const currentM = selectedMonth && monthOptions.includes(selectedMonth) ? selectedMonth : monthOptions[0];

  const employees = await api("/api/employees");
  const teachers = employees.filter((e) => e.role === "Teacher");

  box.innerHTML = `
    <div class="month-picker">
      <label style="margin:0;">Oy:</label>
      <select id="repMonth">
        ${monthOptions.map((m) => `<option value="${m}" ${m === currentM ? "selected" : ""}>${m}</option>`).join("")}
      </select>
    </div>
    <div id="repTotals"></div>

    <h2>O'qituvchi bo'yicha tarix</h2>
    <div class="card">
      <label>O'qituvchi</label>
      <select id="repTeacher">
        ${teachers.map((t) => `<option value="${t.teacher_id}">${t.full_name} (${t.grade})</option>`).join("")}
      </select>
      <button class="primary" id="viewHistoryBtn">Tarixni ko'rish</button>
    </div>
  `;

  async function renderTotalsBox(month) {
    const totalsBox = box.querySelector("#repTotals");
    totalsBox.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    const t = await api(`/api/reports/totals?month=${month}`);

    const ulushHtml = t.total_revenue !== null
      ? `
        <h2>O'qituvchi ulushi</h2>
        <div class="card">
          <div class="row"><span class="label">Umumiy tushum</span><span class="value">${fmt(t.total_revenue)}</span></div>
          <div class="row"><span class="label">O'rtacha ulush foizi</span><span class="value">${t.avg_teacher_share_percent}%</span></div>
        </div>
      `
      : `<p style="font-size:12px;color:var(--hint);">💡 "Tushum" bo'limida tushum kiritilsa, bu yerda o'qituvchi ulushi ham chiqadi.</p>`;

    totalsBox.innerHTML = `
      <div class="dash-grid">
        <div class="dash-card"><div class="dash-num">${t.total_stavka}</div><div class="dash-label">Jami stavka</div></div>
        <div class="dash-card"><div class="dash-num">${fmt(t.total_fix)}</div><div class="dash-label">Jami fix</div></div>
        <div class="dash-card"><div class="dash-num">${fmt(t.total_kpi)}</div><div class="dash-label">Jami KPI</div></div>
        <div class="dash-card"><div class="dash-num">${fmt(t.total_bonus)}</div><div class="dash-label">Jami bonus</div></div>
        <div class="dash-card" style="grid-column: span 2;"><div class="dash-num">${fmt(t.avg_stavka_amount)}</div><div class="dash-label">O'rtacha stavka summasi (Jami Fix ÷ Jami stavka)</div></div>
      </div>
      ${ulushHtml}
    `;
  }

  box.querySelector("#repMonth").addEventListener("change", (e) => renderTotalsBox(e.target.value));
  renderTotalsBox(currentM);

  box.querySelector("#viewHistoryBtn").addEventListener("click", async () => {
    const teacherId = box.querySelector("#repTeacher").value;
    const teacher = teachers.find((t) => t.teacher_id === teacherId);
    const monthAtDrilldown = box.querySelector("#repMonth").value;
    await renderReportsHistory(box, teacher, monthAtDrilldown);
  });
}

async function renderReportsHistory(box, teacher, returnMonth) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  const data = await api(`/api/reports/history?teacher_id=${teacher.teacher_id}&months=6`);

  const rows = data.rows.map((r) => `
    <tr>
      <td>${r.month}</td>
      <td>${r.fix !== null ? fmt(r.fix) : "-"}</td>
      <td>${r.kpi_percent !== null ? r.kpi_percent + "%" : "-"}</td>
      <td>${r.bonus !== null ? fmt(r.bonus) : "-"}</td>
      <td>${r.total !== null ? fmt(r.total) : "-"}</td>
    </tr>
  `).join("");

  box.innerHTML = `
    <button class="back-btn" id="repBackBtn">← Orqaga</button>
    <h2>${teacher.full_name} — oxirgi 6 oy</h2>
    <div class="card" style="overflow-x:auto;">
      <table>
        <thead><tr><th>Oy</th><th>Fix</th><th>KPI %</th><th>Bonus</th><th>Jami</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <button class="primary" id="csvBtn">📥 CSV yuklab olish</button>
  `;

  box.querySelector("#repBackBtn").addEventListener("click", () => renderReportsSummary(box, returnMonth));
  box.querySelector("#csvBtn").addEventListener("click", () => {
    const header = "Oy,Fix,KPI %,Bonus,Jami\n";
    const csvRows = data.rows.map((r) => `${r.month},${r.fix ?? ""},${r.kpi_percent ?? ""},${r.bonus ?? ""},${r.total ?? ""}`).join("\n");
    const blob = new Blob([header + csvRows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${teacher.full_name}_hisobot.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ---------- SETTINGS TAB ----------

const CRITERION_GATE_FIELDS = [
  { key: "retention", label: "🔁 Retention" },
  { key: "progress", label: "📈 Student Progress" },
  { key: "attendance", label: "🗓️ Attendance" },
  { key: "homework", label: "📝 Homework" },
  { key: "observation", label: "👀 Observation" },
  { key: "feedback", label: "💬 Student Feedback" },
  { key: "lms", label: "💻 Platforma intizomi" },
];

async function renderTaskCategoriesSettings(box) {
  async function load() {
    box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const cats = await api("/api/task-categories");
      box.innerHTML = `
        <div class="task-category-manage-list">
          ${cats.map((c) => `
            <div class="task-category-manage-row">
              <span>${c.icon || ""} ${c.label}</span>
              <button class="mini-btn" data-delete-cat="${c.key}">🗑️</button>
            </div>
          `).join("")}
        </div>
        <label>Yangi kategoriya nomi</label>
        <input id="newCatLabel" type="text" placeholder="masalan: Marketing" />
        <label>Ikonka (ixtiyoriy, bitta emoji)</label>
        <input id="newCatIcon" type="text" placeholder="📣" maxlength="4" />
        <button class="primary" id="addCatBtn" style="margin-top:8px;">+ Qo'shish</button>
        <div id="catMsg" style="margin-top:8px;font-size:13px;"></div>
      `;

      box.querySelectorAll("[data-delete-cat]").forEach((btn) => {
        btn.addEventListener("click", () => {
          showConfirm("Kategoriyani o'chirish", "Bu kategoriya butunlay o'chirilsinmi?", async () => {
            try {
              await api("/api/settings/task-categories/delete", {
                method: "POST", body: JSON.stringify({ key: btn.dataset.deleteCat }),
              });
              load();
            } catch (err) {
              safeAlert("Xato: " + err.message);
            }
          });
        });
      });

      box.querySelector("#addCatBtn").addEventListener("click", async () => {
        const msg = box.querySelector("#catMsg");
        const label = box.querySelector("#newCatLabel").value.trim();
        const icon = box.querySelector("#newCatIcon").value.trim();
        if (!label) { msg.innerHTML = `<span class="badge warn">❌ Nom kiriting</span>`; return; }
        const key = label.toLowerCase().replace(/[^a-z0-9а-яёʻʼ]+/gi, "_").slice(0, 30) + "_" + Date.now().toString(36).slice(-4);
        try {
          await api("/api/settings/task-categories/add", {
            method: "POST", body: JSON.stringify({ key, label, icon }),
          });
          load();
        } catch (err) {
          msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
        }
      });
    } catch (err) {
      box.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }
  await load();
}

async function renderTaskProblemStatusesSettings(box) {
  async function load() {
    box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const statuses = await api("/api/task-problem-statuses");
      box.innerHTML = `
        <div class="task-category-manage-list">
          ${statuses.map((s) => `
            <div class="task-category-manage-row">
              <span>${s.label}</span>
              <button class="mini-btn" data-delete-status="${s.id}">🗑️</button>
            </div>
          `).join("")}
        </div>
        <label>Yangi status</label>
        <input id="newStatusLabel" type="text" placeholder="masalan: Nizolashdi" />
        <button class="primary" id="addStatusBtn" style="margin-top:8px;">+ Qo'shish</button>
        <div id="statusMsg" style="margin-top:8px;font-size:13px;"></div>
      `;

      box.querySelectorAll("[data-delete-status]").forEach((btn) => {
        btn.addEventListener("click", () => {
          showConfirm("Statusni o'chirish", "Bu status butunlay o'chirilsinmi?", async () => {
            try {
              await api("/api/settings/task-problem-statuses/delete", {
                method: "POST", body: JSON.stringify({ id: parseInt(btn.dataset.deleteStatus, 10) }),
              });
              load();
            } catch (err) {
              safeAlert("Xato: " + err.message);
            }
          });
        });
      });

      box.querySelector("#addStatusBtn").addEventListener("click", async () => {
        const msg = box.querySelector("#statusMsg");
        const label = box.querySelector("#newStatusLabel").value.trim();
        if (!label) { msg.innerHTML = `<span class="badge warn">❌ Nom kiriting</span>`; return; }
        try {
          await api("/api/settings/task-problem-statuses/add", {
            method: "POST", body: JSON.stringify({ label }),
          });
          load();
        } catch (err) {
          msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
        }
      });
    } catch (err) {
      box.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }
  await load();
}

async function renderGroupAbsenceReasonsSettings(box) {
  async function load() {
    box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
    try {
      const reasons = await api("/api/group-absence-reasons");
      box.innerHTML = `
        <div class="task-category-manage-list">
          ${reasons.map((r) => `
            <div class="task-category-manage-row">
              <span>${r.label}</span>
              <button class="mini-btn" data-delete-reason="${r.id}">🗑️</button>
            </div>
          `).join("")}
        </div>
        <label>Yangi sabab</label>
        <input id="newReasonLabel" type="text" placeholder="masalan: Sayohatda" />
        <button class="primary" id="addReasonBtn" style="margin-top:8px;">+ Qo'shish</button>
        <div id="reasonMsg" style="margin-top:8px;font-size:13px;"></div>
      `;

      box.querySelectorAll("[data-delete-reason]").forEach((btn) => {
        btn.addEventListener("click", () => {
          showConfirm("Sababni o'chirish", "Bu sabab butunlay o'chirilsinmi?", async () => {
            try {
              await api("/api/settings/group-absence-reasons/delete", {
                method: "POST", body: JSON.stringify({ id: parseInt(btn.dataset.deleteReason, 10) }),
              });
              load();
            } catch (err) {
              safeAlert("Xato: " + err.message);
            }
          });
        });
      });

      box.querySelector("#addReasonBtn").addEventListener("click", async () => {
        const msg = box.querySelector("#reasonMsg");
        const label = box.querySelector("#newReasonLabel").value.trim();
        if (!label) { msg.innerHTML = `<span class="badge warn">❌ Nom kiriting</span>`; return; }
        try {
          await api("/api/settings/group-absence-reasons/add", {
            method: "POST", body: JSON.stringify({ label }),
          });
          load();
        } catch (err) {
          msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
        }
      });
    } catch (err) {
      box.innerHTML = `<div class="error-box">${err.message}</div>`;
    }
  }
  await load();
}

async function renderTaskPenaltiesSettings(box) {
  box.innerHTML = `<div class="center-box"><div class="spinner"></div></div>`;
  try {
    const penalties = await api("/api/settings/task-penalties");
    box.innerHTML = `
      <p style="font-size:12px;color:var(--hint);margin:0 0 10px;">
        Har bir rol uchun, muddati o'tgan HAR BIR topshiriq uchun qo'llaniladigan jarima summasi. 0 qoldirilsa, o'sha rol uchun jarima o'chirilgan hisoblanadi.
      </p>
      ${Object.keys(ROLE_LABELS_UZ_JS).map((role) => `
        <label>${ROLE_LABELS_UZ_JS[role]}</label>
        <input id="penalty_${role}" type="number" step="1000" min="0" value="${penalties[role] || 0}" />
      `).join("")}
      <button class="primary" id="savePenaltiesBtn" style="margin-top:8px;">Saqlash</button>
      <div id="penaltiesMsg" style="margin-top:8px;font-size:13px;"></div>
    `;

    box.querySelector("#savePenaltiesBtn").addEventListener("click", async () => {
      const msg = box.querySelector("#penaltiesMsg");
      msg.textContent = "Saqlanmoqda...";
      try {
        for (const role of Object.keys(ROLE_LABELS_UZ_JS)) {
          const val = parseFloat(box.querySelector(`#penalty_${role}`).value) || 0;
          if (val !== (penalties[role] || 0)) {
            await api("/api/settings/task-penalties", {
              method: "POST", body: JSON.stringify({ role, amount: val }),
            });
          }
        }
        msg.innerHTML = `<span class="badge ok">✅ Saqlandi</span>`;
      } catch (err) {
        msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
      }
    });
  } catch (err) {
    box.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}

async function renderSettingsTab(box) {
  const s = await api("/api/settings");

  const gradeRows = Object.entries(s.grade_rates).map(([grade, rate]) => `
    <div class="row">
      <span class="label">${grade}</span>
      <input type="number" step="10000" value="${rate}" data-grade="${grade}" style="width:140px;margin:0;" />
    </div>
  `).join("");

  box.innerHTML = `
    <h2>Grade stavkalari (1.0 stavka uchun, so'm)</h2>
    <div class="card">${gradeRows}</div>

    <h2>KPI fondi foizi</h2>
    <div class="card">
      <input id="kpiPercent" type="number" step="1" value="${s.kpi_pool_percent}" />
    </div>

    <h2>Avans foizi (Fix'dan)</h2>
    <div class="card">
      <input id="avansPercent" type="number" step="1" value="${s.avans_percent}" />
      <p style="font-size:12px;color:var(--hint);margin:4px 0 0;">Masalan 30 kiritsangiz: Avans = Fix × 30%</p>
    </div>

    <h2>Minimal KPI foizi</h2>
    <div class="card">
      <input id="minKpiPercent" type="number" step="1" value="${s.min_kpi_percent}" />
      <p style="font-size:12px;color:var(--hint);margin:4px 0 0;">Agar o'qituvchining yakuniy KPI foizi shu chegaradan past bo'lsa, KPI summasi butunlay 0 bo'ladi (masalan: chegara 55%, xodim 48% to'plasa — KPI summasi 0). Chegaraga yetsa yoki undan yuqori bo'lsa, KPI to'liq, haqiqiy foiz bo'yicha to'lanadi.</p>
    </div>

    <h2>📚 Stavka / Guruh nisbati</h2>
    <div class="card">
      <label>1 stavka = necha guruh?</label>
      <input id="groupsPerStavka" type="number" step="1" min="1" value="${s.groups_per_stavka}" />
      <p style="font-size:12px;color:var(--hint);margin:4px 0 0;">Xodim tahrirlashda "Guruh qo'shish/ayirish" tugmalari shu nisbat asosida stavkani avtomatik hisoblaydi.</p>
    </div>

    <button class="primary" id="saveSettingsBtn">Saqlash</button>
    <div id="settingsMsg" style="margin-top:8px;font-size:13px;"></div>

    <h2>🚧 Mezonlar bo'yicha Gate chegaralari</h2>
    <div class="card">
      <p style="font-size:12px;color:var(--hint);margin:0 0 10px;">
        Har bir mezon uchun alohida minimal xom foiz chegarasi. <b>Bu faqat Hisobotlar bo'limida</b>
        kimlar chegaradan pastligini ko'rsatish uchun ishlatiladi — ish haqi/KPI summasi hisob-kitobiga
        hech qanday ta'sir qilmaydi. 0 qoldirilsa, o'sha mezon uchun Gate o'chirilgan hisoblanadi.
      </p>
      ${CRITERION_GATE_FIELDS.map((f) => `
        <label>${f.label} gate (%)</label>
        <input id="gate_${f.key}" type="number" step="1" min="0" max="100" value="${s.criterion_gates[f.key] ?? 0}" />
      `).join("")}
      <button class="primary" id="saveGatesBtn" style="margin-top:6px;">Gate'larni saqlash</button>
      <div id="gatesMsg" style="margin-top:8px;font-size:13px;"></div>
    </div>

    <h2>📋 Topshiriqlar — Kategoriyalar</h2>
    <div class="card" id="taskCategoriesCard"><div class="center-box"><div class="spinner"></div></div></div>

    <h2>🎓 Topshiriqlar — O'quvchi muammo statuslari</h2>
    <div class="card" id="taskStatusesCard"><div class="center-box"><div class="spinner"></div></div></div>

    <h2>⏰ Muddati o'tgan topshiriq uchun jarima</h2>
    <div class="card" id="taskPenaltiesCard"><div class="center-box"><div class="spinner"></div></div></div>

    <h2>🚩 Guruh davomati — Kelmaganlik sabablari</h2>
    <div class="card" id="absenceReasonsCard"><div class="center-box"><div class="spinner"></div></div></div>

    <h2>🧪 Sinov rejimi</h2>
    <div class="card">
      <p style="font-size:12px;color:var(--hint);margin:0 0 10px;">
        Bitta hisob bilan boshqa rollarni sinab ko'rish uchun — pastdan xodimni tanlang va
        "Shu sifatda kirish" tugmasini bosing. Istalgan vaqtda ekran tepasidagi banner orqali
        asl (CEO) hisobingizga xavfsiz qaytishingiz mumkin.
      </p>
      <label>Xodim</label>
      <select id="testModeEmployee"></select>
      <button class="secondary" id="testModeEnterBtn">🧪 Shu sifatda kirish</button>
      <div id="testModeMsg" style="margin-top:8px;font-size:13px;"></div>
    </div>
  `;

  await renderTaskCategoriesSettings(box.querySelector("#taskCategoriesCard"));
  await renderTaskProblemStatusesSettings(box.querySelector("#taskStatusesCard"));
  await renderTaskPenaltiesSettings(box.querySelector("#taskPenaltiesCard"));
  await renderGroupAbsenceReasonsSettings(box.querySelector("#absenceReasonsCard"));

  box.querySelector("#saveGatesBtn").addEventListener("click", async () => {
    const msg = box.querySelector("#gatesMsg");
    msg.textContent = "Saqlanmoqda...";
    try {
      for (const f of CRITERION_GATE_FIELDS) {
        const val = parseFloat(box.querySelector(`#gate_${f.key}`).value) || 0;
        if (val !== (s.criterion_gates[f.key] ?? 0)) {
          await api("/api/settings/criterion-gate", {
            method: "POST",
            body: JSON.stringify({ criterion: f.key, value: val }),
          });
        }
      }
      msg.innerHTML = `<span class="badge ok">✅ Saqlandi</span>`;
    } catch (err) {
      msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
    }
  });

  try {
    const employees = await api("/api/employees");
    const empSelect = box.querySelector("#testModeEmployee");
    empSelect.innerHTML = employees.map((e) => `
      <option value="${e.teacher_id}">${e.full_name} (${e.role}${e.grade ? " · " + e.grade : ""})</option>
    `).join("");

    box.querySelector("#testModeEnterBtn").addEventListener("click", () => {
      const selected = empSelect.selectedOptions[0];
      showConfirm(
        "Sinov rejimiga o'tish",
        `Endi <b>${selected.textContent}</b> sifatida ko'rasiz. Asl hisobingizga qaytish uchun istalgan vaqtda ekran tepasidagi bannerni bosishingiz mumkin. Davom etasizmi?`,
        async () => {
          const msg = box.querySelector("#testModeMsg");
          msg.textContent = "O'tilmoqda...";
          try {
            await api("/api/admin/switch-my-link", {
              method: "POST",
              body: JSON.stringify({ target_teacher_id: empSelect.value }),
            });
            window.location.reload();
          } catch (err) {
            msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
          }
        }
      );
    });
  } catch (err) {
    // xodimlar ro'yxatini yuklab bo'lmasa, sinov rejimi qismini jim tashlab ketamiz
  }

  box.querySelector("#saveSettingsBtn").addEventListener("click", async () => {
    const changes = [];
    const gradeInputs = box.querySelectorAll("input[data-grade]");
    gradeInputs.forEach((input) => {
      const oldVal = s.grade_rates[input.dataset.grade];
      const newVal = parseFloat(input.value);
      if (newVal !== oldVal) changes.push({ type: "grade", grade: input.dataset.grade, oldVal, newVal });
    });
    const newKpi = parseFloat(box.querySelector("#kpiPercent").value);
    if (newKpi !== s.kpi_pool_percent) changes.push({ type: "kpi", oldVal: s.kpi_pool_percent, newVal: newKpi });

    const newAvans = parseFloat(box.querySelector("#avansPercent").value);
    if (newAvans !== s.avans_percent) changes.push({ type: "avans", oldVal: s.avans_percent, newVal: newAvans });

    const newMinKpi = parseFloat(box.querySelector("#minKpiPercent").value);
    if (newMinKpi !== s.min_kpi_percent) changes.push({ type: "minkpi", oldVal: s.min_kpi_percent, newVal: newMinKpi });

    const newGroupsPerStavka = parseFloat(box.querySelector("#groupsPerStavka").value);
    if (newGroupsPerStavka !== s.groups_per_stavka) changes.push({ type: "groupsPerStavka", oldVal: s.groups_per_stavka, newVal: newGroupsPerStavka });

    const msg = box.querySelector("#settingsMsg");
    if (changes.length === 0) {
      msg.textContent = "O'zgarish yo'q.";
      return;
    }

    const impactLines = [];
    for (const c of changes) {
      if (c.type === "grade") {
        const impact = await api(`/api/settings/grade-rate-impact?grade=${c.grade}`);
        impactLines.push(`<b>${c.grade}:</b> ${fmt(c.oldVal)} → ${fmt(c.newVal)} (${impact.count} ta faol xodimga ta'sir qiladi)`);
      } else if (c.type === "kpi") {
        impactLines.push(`<b>KPI fondi foizi:</b> ${c.oldVal}% → ${c.newVal}% (barcha o'qituvchilarning KPI hisobiga ta'sir qiladi)`);
      } else if (c.type === "avans") {
        const impact = await api("/api/settings/avans-impact");
        impactLines.push(`<b>Avans foizi:</b> ${c.oldVal}% → ${c.newVal}% (${impact.count} ta faol xodimga ta'sir qiladi)`);
      } else if (c.type === "minkpi") {
        impactLines.push(`<b>Minimal KPI foizi:</b> ${c.oldVal}% → ${c.newVal}% (KPI foizi shu chegaradan past bo'lgan har qanday o'qituvchining KPI summasi 0 bo'lib qoladi)`);
      } else if (c.type === "groupsPerStavka") {
        impactLines.push(`<b>Stavka/Guruh nisbati:</b> 1 stavka = ${c.oldVal} guruh → 1 stavka = ${c.newVal} guruh (bundan buyongi "Guruh qo'shish/ayirish" hisob-kitobiga ta'sir qiladi)`);
      }
    }

    showConfirm("O'zgarishlarni tasdiqlang", impactLines.join("<br/><br/>"), async () => {
      msg.textContent = "Saqlanmoqda...";
      try {
        for (const c of changes) {
          if (c.type === "grade") {
            await api("/api/settings/grade-rate", {
              method: "POST",
              body: JSON.stringify({ grade: c.grade, rate: c.newVal }),
            });
          } else if (c.type === "kpi") {
            await api("/api/settings/kpi-pool-percent", {
              method: "POST",
              body: JSON.stringify({ value: c.newVal }),
            });
          } else if (c.type === "avans") {
            await api("/api/settings/avans-percent", {
              method: "POST",
              body: JSON.stringify({ value: c.newVal }),
            });
          } else if (c.type === "minkpi") {
            await api("/api/settings/min-kpi-percent", {
              method: "POST",
              body: JSON.stringify({ value: c.newVal }),
            });
          } else if (c.type === "groupsPerStavka") {
            await api("/api/settings/groups-per-stavka", {
              method: "POST",
              body: JSON.stringify({ value: c.newVal }),
            });
          }
        }
        msg.innerHTML = `<span class="badge ok">✅ Saqlandi</span>`;
      } catch (err) {
        msg.innerHTML = `<span class="badge warn">❌ ${err.message}</span>`;
      }
    });
  });
}

boot();
