(() => {
  const CENTER_KEY = "axis_notification_center";
  const SETTINGS_KEY = "axis_notification_settings";
  const SENT_KEY = "axis_notification_sent";
  const PERMISSION_REQUESTED_KEY = "axis_notification_permission_requested";

  const DEFAULT_SETTINGS = {
    browserEnabled: true,
    deadlines: true,
    schedule: true,
    habits: true,
    focus: true,
    reflections: true,
  };

  const MAX_CENTER_ITEMS = 40;
  const SENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  let initialized = false;
  let checkInterval = null;
  let centerItems = [];
  let sentMap = {};
  let settings = { ...DEFAULT_SETTINGS };

  function $(selector) {
    return document.querySelector(selector);
  }

  function safeJsonParse(raw, fallback) {
    try {
      const v = JSON.parse(raw);
      return v ?? fallback;
    } catch {
      return fallback;
    }
  }

  function loadSettings() {
    const stored = safeJsonParse(localStorage.getItem(SETTINGS_KEY), null);
    if (!stored || typeof stored !== "object") return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...stored };
  }

  function saveSettings(next) {
    settings = { ...DEFAULT_SETTINGS, ...(next || {}) };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
    updatePermissionStatus();
  }

  function loadCenter() {
    const stored = safeJsonParse(localStorage.getItem(CENTER_KEY), []);
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((n) => n && typeof n === "object")
      .map((n) => ({
        id: String(n.id || ""),
        type: String(n.type || "info"),
        title: String(n.title || ""),
        body: String(n.body || ""),
        ts: typeof n.ts === "number" ? n.ts : Date.now(),
        read: Boolean(n.read),
      }))
      .slice(0, MAX_CENTER_ITEMS);
  }

  function saveCenter() {
    try {
      localStorage.setItem(CENTER_KEY, JSON.stringify(centerItems.slice(0, MAX_CENTER_ITEMS)));
    } catch {}
  }

  function loadSentMap() {
    const stored = safeJsonParse(localStorage.getItem(SENT_KEY), {});
    const now = Date.now();
    const map = {};
    if (stored && typeof stored === "object") {
      Object.entries(stored).forEach(([k, v]) => {
        const ts = typeof v === "number" ? v : 0;
        if (now - ts <= SENT_TTL_MS) map[k] = ts;
      });
    }
    return map;
  }

  function saveSentMap() {
    try {
      localStorage.setItem(SENT_KEY, JSON.stringify(sentMap));
    } catch {}
  }

  function isSent(key) {
    return Boolean(sentMap[key]);
  }

  function markSent(key) {
    sentMap[key] = Date.now();
    saveSentMap();
  }

  function formatRelativeTime(ts) {
    const diff = Date.now() - ts;
    const sec = Math.floor(diff / 1000);
    if (sec < 10) return "Just now";
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    return `${d}d ago`;
  }

  function getUi() {
    return {
      btn: $("#notificationBtn"),
      badge: $("#notificationBadge"),
      dropdown: $("#notificationDropdown"),
      list: $("#notificationList"),
      clearBtn: $("#clearNotificationsBtn"),
      permissionBtn: $("#requestNotificationPermissionBtn"),
      permissionStatus: $("#notifPermissionStatus"),
      toggleBrowser: $("#notifBrowserEnabled"),
      toggleDeadlines: $("#notifDeadlines"),
      toggleSchedule: $("#notifSchedule"),
      toggleHabits: $("#notifHabits"),
      toggleFocus: $("#notifFocus"),
      toggleReflections: $("#notifReflections"),
    };
  }

  function unreadCount() {
    return centerItems.filter((n) => !n.read).length;
  }

  function renderBadge() {
    const { badge } = getUi();
    if (!badge) return;
    const count = unreadCount();
    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
  }

  function iconForType(type) {
    switch (type) {
      case "deadline":
        return "⏳";
      case "schedule":
        return "🗓️";
      case "habit":
        return "⏰";
      case "focus":
        return "🎯";
      case "reflection":
        return "📝";
      default:
        return "🔔";
    }
  }

  function renderList() {
    const { list } = getUi();
    if (!list) return;

    if (!centerItems.length) {
      list.innerHTML = `<div class="notification-empty">No notifications yet.</div>`;
      return;
    }

    list.innerHTML = centerItems
      .map((n) => {
        const icon = iconForType(n.type);
        return `
          <div class="notification-item${n.read ? "" : " unread"}" data-id="${n.id}">
            <div class="notification-item-title">
              <span aria-hidden="true">${icon}</span>
              <span>${escapeHtml(n.title)}</span>
            </div>
            ${n.body ? `<div class="notification-item-body">${escapeHtml(n.body)}</div>` : ""}
            <div class="notification-item-meta">
              <span>${formatRelativeTime(n.ts)}</span>
              <span>${n.read ? "" : "New"}</span>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function setDropdownOpen(nextOpen) {
    const { dropdown } = getUi();
    if (!dropdown) return;
    dropdown.classList.toggle("hidden", !nextOpen);
    if (nextOpen) {
      centerItems = centerItems.map((n) => ({ ...n, read: true }));
      saveCenter();
      renderBadge();
      renderList();
    }
  }

  function toggleDropdown() {
    const { dropdown } = getUi();
    if (!dropdown) return;
    const isHidden = dropdown.classList.contains("hidden");
    setDropdownOpen(isHidden);
  }

  function closeDropdown() {
    setDropdownOpen(false);
  }

  function addToCenter(notification) {
    centerItems.unshift(notification);
    centerItems = centerItems.slice(0, MAX_CENTER_ITEMS);
    saveCenter();
    renderBadge();
    renderList();
  }

  function canUseBrowserNotifications() {
    if (!settings.browserEnabled) return false;
    if (!("Notification" in window)) return false;
    return Notification.permission === "granted";
  }

  function sendBrowserNotification(title, options = {}) {
    if (!canUseBrowserNotifications()) return;
    try {
      new Notification(title, options);
    } catch {}
  }

  async function requestPermission() {
    if (!("Notification" in window)) return "unsupported";
    try {
      const perm = await Notification.requestPermission();
      return perm;
    } catch {
      return Notification.permission || "default";
    }
  }

  function updatePermissionStatus() {
    const { permissionStatus } = getUi();
    if (!permissionStatus) return;
    if (!("Notification" in window)) {
      permissionStatus.textContent = "Permission: unsupported";
      return;
    }
    permissionStatus.textContent = `Permission: ${Notification.permission}`;
  }

  function maybeRequestPermissionForDeadlines(userGesture = false) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    if (!settings.browserEnabled || !settings.deadlines) return;

    const alreadyRequested = localStorage.getItem(PERMISSION_REQUESTED_KEY) === "1";
    if (alreadyRequested) return;

    // Only request on a user gesture to avoid browser blocking.
    if (!userGesture) return;

    try {
      localStorage.setItem(PERMISSION_REQUESTED_KEY, "1");
    } catch {}

    requestPermission().finally(updatePermissionStatus);
  }

  function notify(type, title, body, opts = {}) {
    const id = `notif_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const now = Date.now();

    addToCenter({
      id,
      type: type || "info",
      title: title || "Notification",
      body: body || "",
      ts: now,
      read: false,
    });

    if (opts.browser && canUseBrowserNotifications()) {
      sendBrowserNotification(title || "Axis", { body: body || "", tag: opts.tag || id });
    }
  }

  function checkDeadlines() {
    if (!settings.deadlines) return;
    if (typeof state === "undefined" || !state) return;

    const now = Date.now();
    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    tasks.forEach((t) => {
      if (!t || t.completed) return;
      if (!t.task_deadline) return;
      const time = t.task_deadline_time || "23:59";
      const deadline = new Date(`${t.task_deadline}T${time}:00`);
      const msUntil = deadline.getTime() - now;
      if (!Number.isFinite(msUntil)) return;
      if (msUntil <= 0) return;

      const deadlineKeyBase = `${t.id}:${deadline.toISOString()}`;

      // 1 hour before (skip if already within 15m)
      if (msUntil <= 60 * 60 * 1000 && msUntil > 15 * 60 * 1000 + 1000) {
        const key = `deadline:1h:${deadlineKeyBase}`;
        if (!isSent(key)) {
          markSent(key);
          notify(
            "deadline",
            "Task deadline approaching",
            `${t.task_name || "Task"} is due in ~1 hour.`,
            { browser: true, tag: key },
          );
        }
      }

      // 15 minutes before
      if (msUntil <= 15 * 60 * 1000) {
        const key = `deadline:15m:${deadlineKeyBase}`;
        if (!isSent(key)) {
          markSent(key);
          notify(
            "deadline",
            "Task deadline soon",
            `${t.task_name || "Task"} is due in ~15 minutes.`,
            { browser: true, tag: key },
          );
        }
      }
    });
  }

  function taskNameById(taskId) {
    const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
    return tasks.find((t) => t.id === taskId)?.task_name || "Task";
  }

  function checkScheduleBlocks() {
    if (!settings.schedule) return;
    if (typeof state === "undefined" || !state) return;

    const now = Date.now();
    const blocks = [...(state.fixedBlocks || []), ...(state.schedule || [])].filter(Boolean);
    blocks.forEach((b) => {
      const start = new Date(b.start);
      const msUntil = start.getTime() - now;
      if (!Number.isFinite(msUntil)) return;

      // Notify within a 90s window around start (catch-up friendly)
      if (msUntil > 90 * 1000 || msUntil < -30 * 1000) return;

      const label = b.kind === "fixed" ? b.label || "Routine" : taskNameById(b.taskId);
      const key = `block-start:${b.kind}:${b.start}:${b.taskId || b.label || ""}`;
      if (isSent(key)) return;
      markSent(key);
      notify("schedule", "Time block starting", label, { browser: true, tag: key });
    });
  }

  function onHabitDue(habit) {
    if (!settings.habits) return;
    if (!habit || !habit.id) return;
    const today = new Date().toISOString().slice(0, 10);
    const key = `habit:${habit.id}:${today}:${habit.time || ""}`;
    if (isSent(key)) return;
    markSent(key);
    notify("habit", "Habit reminder", `${habit.name || "Habit"} · ${habit.time || "now"}`, { browser: true, tag: key });
  }

  function onFocusComplete(task) {
    if (!settings.focus) return;
    const title = "Focus timer complete";
    const body = task?.task_name ? `Nice work — ${task.task_name}` : "Nice work!";
    notify("focus", title, body, { browser: true, tag: `focus:${Date.now()}` });
  }

  function onReflectionDue(type) {
    if (!settings.reflections) return;
    const kind = type === "monthly" ? "Monthly" : "Weekly";
    notify("reflection", `${kind} reflection due`, "Take 2 minutes to reflect and recalibrate.", {
      browser: true,
      tag: `reflection:${type}:${new Date().toISOString().slice(0, 10)}`,
    });
  }

  function bindSettingsUi() {
    const ui = getUi();
    if (ui.toggleBrowser) ui.toggleBrowser.checked = Boolean(settings.browserEnabled);
    if (ui.toggleDeadlines) ui.toggleDeadlines.checked = Boolean(settings.deadlines);
    if (ui.toggleSchedule) ui.toggleSchedule.checked = Boolean(settings.schedule);
    if (ui.toggleHabits) ui.toggleHabits.checked = Boolean(settings.habits);
    if (ui.toggleFocus) ui.toggleFocus.checked = Boolean(settings.focus);
    if (ui.toggleReflections) ui.toggleReflections.checked = Boolean(settings.reflections);

    const onChange = () => {
      saveSettings({
        browserEnabled: Boolean(ui.toggleBrowser?.checked),
        deadlines: Boolean(ui.toggleDeadlines?.checked),
        schedule: Boolean(ui.toggleSchedule?.checked),
        habits: Boolean(ui.toggleHabits?.checked),
        focus: Boolean(ui.toggleFocus?.checked),
        reflections: Boolean(ui.toggleReflections?.checked),
      });
    };

    ui.toggleBrowser?.addEventListener("change", onChange);
    ui.toggleDeadlines?.addEventListener("change", onChange);
    ui.toggleSchedule?.addEventListener("change", onChange);
    ui.toggleHabits?.addEventListener("change", onChange);
    ui.toggleFocus?.addEventListener("change", onChange);
    ui.toggleReflections?.addEventListener("change", onChange);

    ui.permissionBtn?.addEventListener("click", async () => {
      try {
        localStorage.setItem(PERMISSION_REQUESTED_KEY, "1");
      } catch {}
      await requestPermission();
      updatePermissionStatus();
    });

    updatePermissionStatus();
  }

  function bindCenterUi() {
    const { btn, clearBtn } = getUi();
    btn?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDropdown();
    });

    clearBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      centerItems = [];
      saveCenter();
      renderBadge();
      renderList();
      closeDropdown();
    });

    document.addEventListener("click", (e) => {
      const { dropdown, btn: nbtn } = getUi();
      if (!dropdown || !nbtn) return;
      if (dropdown.classList.contains("hidden")) return;
      const target = e.target;
      if (dropdown.contains(target) || nbtn.contains(target)) return;
      closeDropdown();
    });
  }

  function startChecking() {
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(() => {
      checkDeadlines();
      checkScheduleBlocks();
    }, 60 * 1000);

    // Initial pass
    checkDeadlines();
    checkScheduleBlocks();
  }

  function init() {
    if (initialized) return;
    initialized = true;

    settings = loadSettings();
    centerItems = loadCenter();
    sentMap = loadSentMap();

    bindCenterUi();
    bindSettingsUi();
    renderBadge();
    renderList();
    startChecking();
  }

  window.AxisNotifications = {
    init,
    notify,
    closeDropdown,
    maybeRequestPermissionForDeadlines,
    onHabitDue,
    onFocusComplete,
    onReflectionDue,
    getSettings: () => ({ ...settings }),
    setSettings: saveSettings,
  };
})();

