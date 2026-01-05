(() => {
  const DEFAULT_SETTINGS = {
    includeFixedBlocks: true,
    includeCompletedTasks: false,
    reminderMinutes: 15,
    lastExportAt: "",
  };

  let initialized = false;

  function $(selector) {
    return document.querySelector(selector);
  }

  function isDashboardPage() {
    return Boolean(document.getElementById("dashboard"));
  }

  function safeIsoString(value) {
    if (!value || typeof value !== "string") return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }

  function loadSettingsFromState() {
    const current = state?.calendarExportSettings;
    const next = {
      ...DEFAULT_SETTINGS,
      ...(current && typeof current === "object" ? current : {}),
    };

    next.includeFixedBlocks = Boolean(next.includeFixedBlocks);
    next.includeCompletedTasks = Boolean(next.includeCompletedTasks);
    next.reminderMinutes = Number.isFinite(Number(next.reminderMinutes))
      ? Math.max(0, Math.min(240, Math.round(Number(next.reminderMinutes))))
      : DEFAULT_SETTINGS.reminderMinutes;
    next.lastExportAt = safeIsoString(next.lastExportAt);

    state.calendarExportSettings = next;
    return next;
  }

  function persistSettings(next) {
    state.calendarExportSettings = { ...loadSettingsFromState(), ...(next || {}) };
    try {
      saveUserData?.();
    } catch {}
  }

  function formatLastExportLabel(iso) {
    if (!iso) return "Last export: —";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "Last export: —";
    return `Last export: ${d.toLocaleString()}`;
  }

  function updateBadge() {
    const badge = $("#calendarExportBadge");
    const settings = loadSettingsFromState();
    if (!badge) return;
    if (!settings.lastExportAt) {
      badge.classList.add("hidden");
      badge.textContent = "";
      return;
    }
    const d = new Date(settings.lastExportAt);
    if (Number.isNaN(d.getTime())) {
      badge.classList.add("hidden");
      badge.textContent = "";
      return;
    }
    badge.textContent = d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
    badge.classList.remove("hidden");
  }

  function setModalOpen(open) {
    const modal = $("#calendarExportModal");
    if (!modal) return;
    modal.classList.toggle("hidden", !open);
    if (open) {
      renderModal();
    }
  }

  function closeModal() {
    setModalOpen(false);
  }

  function openModal() {
    setModalOpen(true);
  }

  function downloadTextFile({ text, filename, mimeType }) {
    const blob = new Blob([text], { type: mimeType || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyToClipboard(text) {
    const value = String(text || "");
    if (!value) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fallback prompt
      try {
        window.prompt("Copy this:", value);
        return true;
      } catch {
        return false;
      }
    }
  }

  // ---------- Client-side ICS builder (guest fallback) ----------
  function icsEscapeText(value) {
    return String(value ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\r/g, "")
      .replace(/\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,");
  }

  function formatIcsDateTimeUtc(date) {
    const iso = date.toISOString();
    return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  function foldIcsLine(line) {
    const parts = [];
    let remaining = String(line);
    while (remaining.length > 75) {
      parts.push(remaining.slice(0, 75));
      remaining = ` ${remaining.slice(75)}`;
    }
    parts.push(remaining);
    return parts;
  }

  function buildGuestIcs({ settings }) {
    const includeFixedBlocks = settings?.includeFixedBlocks !== false;
    const includeCompletedTasks = settings?.includeCompletedTasks === true;
    const reminderMinutes = Number.isFinite(settings?.reminderMinutes)
      ? Math.max(0, Math.min(240, Math.round(settings.reminderMinutes)))
      : 15;

    const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
    const tasksById = new Map(tasks.map((t) => [t.id, t]));
    const completedIds = new Set(tasks.filter((t) => t?.completed).map((t) => t.id));

    const scheduleBlocks = Array.isArray(state?.schedule) ? state.schedule : [];
    const fixedBlocks = includeFixedBlocks && Array.isArray(state?.fixedBlocks) ? state.fixedBlocks : [];

    const lines = [];
    const push = (line) => foldIcsLine(line).forEach((l) => lines.push(l));
    const dtStamp = formatIcsDateTimeUtc(new Date());

    push("BEGIN:VCALENDAR");
    push("VERSION:2.0");
    push("CALSCALE:GREGORIAN");
    push("METHOD:PUBLISH");
    push("PRODID:-//Axis//EN");
    push("X-WR-CALNAME:Axis Schedule");
    push("X-WR-TIMEZONE:UTC");

    const addEvent = ({ uid, summary, description, start, end, categories }) => {
      push("BEGIN:VEVENT");
      push(`UID:${uid}`);
      push(`DTSTAMP:${dtStamp}`);
      push(`DTSTART:${formatIcsDateTimeUtc(start)}`);
      push(`DTEND:${formatIcsDateTimeUtc(end)}`);
      push(`SUMMARY:${icsEscapeText(summary)}`);
      if (description) push(`DESCRIPTION:${icsEscapeText(description)}`);
      if (categories?.length) push(`CATEGORIES:${categories.map((c) => icsEscapeText(c)).join(",")}`);
      if (reminderMinutes > 0) {
        push("BEGIN:VALARM");
        push("ACTION:DISPLAY");
        push(`DESCRIPTION:${icsEscapeText(summary)}`);
        push(`TRIGGER:-PT${reminderMinutes}M`);
        push("END:VALARM");
      }
      push("END:VEVENT");
    };

    scheduleBlocks.forEach((b, idx) => {
      const taskId = b?.taskId;
      if (!taskId) return;
      if (!includeCompletedTasks && completedIds.has(taskId)) return;
      const start = new Date(b.start);
      const end = new Date(b.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return;

      const task = tasksById.get(taskId) || null;
      const summary = task?.task_name ? String(task.task_name) : "Task";
      const category = task?.task_category ? String(task.task_category) : "";
      const priority = task?.task_priority ? String(task.task_priority) : "";
      const deadline = task?.task_deadline ? `${task.task_deadline} ${task.task_deadline_time || ""}`.trim() : "";

      const parts = [];
      if (category) parts.push(`Category: ${category}`);
      if (priority) parts.push(`Priority: ${priority}`);
      if (deadline) parts.push(`Deadline: ${deadline}`);

      addEvent({
        uid: `axis-${taskId}-${start.toISOString()}-${idx}`,
        summary,
        description: parts.join("\n"),
        start,
        end,
        categories: category ? [category] : [],
      });
    });

    fixedBlocks.forEach((b, idx) => {
      const start = new Date(b.start);
      const end = new Date(b.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return;
      const label = String(b.label || "Fixed block");
      const category = b.category ? String(b.category) : "";
      addEvent({
        uid: `axis-fixed-${idx}-${start.toISOString()}`,
        summary: label,
        description: category ? `Category: ${category}` : "",
        start,
        end,
        categories: category ? [category] : [],
      });
    });

    push("END:VCALENDAR");
    return `${lines.join("\r\n")}\r\n`;
  }

  function renderModal() {
    const settings = loadSettingsFromState();

    const includeFixed = $("#exportIncludeFixedBlocks");
    if (includeFixed) includeFixed.checked = Boolean(settings.includeFixedBlocks);
    const includeCompleted = $("#exportIncludeCompletedTasks");
    if (includeCompleted) includeCompleted.checked = Boolean(settings.includeCompletedTasks);
    const reminder = $("#exportReminderMinutes");
    if (reminder) reminder.value = String(settings.reminderMinutes ?? DEFAULT_SETTINGS.reminderMinutes);

    const lastEl = $("#calendarExportLast");
    if (lastEl) lastEl.textContent = formatLastExportLabel(settings.lastExportAt);

    updateBadge();
  }

  async function downloadIcs() {
    const settings = loadSettingsFromState();
    const token = getAuthToken?.() || "";
    const isGuest = token.startsWith("guest_");

    try {
      if (!isGuest && token) {
        const res = await fetch("/api/calendar/export", {
          method: "POST",
          headers: getAuthHeaders?.() || { "Content-Type": "application/json" },
          body: JSON.stringify({
            includeFixedBlocks: settings.includeFixedBlocks,
            includeCompletedTasks: settings.includeCompletedTasks,
            reminderMinutes: settings.reminderMinutes,
          }),
        });
        if (!res.ok) throw new Error(`Export failed (${res.status})`);
        const text = await res.text();
        downloadTextFile({
          text,
          filename: `axis-schedule-${new Date().toISOString().slice(0, 10)}.ics`,
          mimeType: "text/calendar",
        });
      } else {
        const ics = buildGuestIcs({ settings });
        downloadTextFile({
          text: ics,
          filename: `axis-schedule-${new Date().toISOString().slice(0, 10)}.ics`,
          mimeType: "text/calendar",
        });
      }

      const nextIso = new Date().toISOString();
      persistSettings({ lastExportAt: nextIso });
      renderModal();

      try {
        window.AxisToast?.success?.("Calendar exported.");
      } catch {
        showToast?.("Calendar exported.");
      }
    } catch (err) {
      console.error("downloadIcs error:", err);
      try {
        window.AxisToast?.error?.("Calendar export failed.");
      } catch {
        showToast?.("Calendar export failed.");
      }
    }
  }

  async function getSubscribeUrls() {
    const token = getAuthToken?.() || "";
    if (!token || token.startsWith("guest_")) return null;

    const res = await fetch("/api/calendar/token", { headers: getAuthHeaders?.() || {} });
    if (!res.ok) throw new Error(`Token request failed (${res.status})`);
    const data = await res.json();
    if (!data || typeof data !== "object") throw new Error("Invalid token response");
    return {
      subscribeUrl: String(data.subscribeUrl || ""),
      webcalUrl: String(data.webcalUrl || ""),
    };
  }

  async function copyWebcalUrl() {
    try {
      const urls = await getSubscribeUrls();
      if (!urls?.webcalUrl) {
        try {
          window.AxisToast?.info?.("Webcal subscription requires an account.");
        } catch {
          showToast?.("Webcal subscription requires an account.");
        }
        return;
      }
      const ok = await copyToClipboard(urls.webcalUrl);
      if (ok) {
        try {
          window.AxisToast?.success?.("Copied webcal URL.");
        } catch {
          showToast?.("Copied webcal URL.");
        }
      }
    } catch (err) {
      console.error("copyWebcalUrl error:", err);
      try {
        window.AxisToast?.error?.("Could not copy webcal URL.");
      } catch {
        showToast?.("Could not copy webcal URL.");
      }
    }
  }

  async function openGoogleCalendar() {
    try {
      const urls = await getSubscribeUrls();
      if (!urls?.subscribeUrl) {
        try {
          window.AxisToast?.info?.("Google subscription requires an account.");
        } catch {
          showToast?.("Google subscription requires an account.");
        }
        window.open("https://calendar.google.com/calendar/u/0/r/settings/addbyurl", "_blank", "noopener");
        return;
      }

      await copyToClipboard(urls.subscribeUrl);
      window.open("https://calendar.google.com/calendar/u/0/r/settings/addbyurl", "_blank", "noopener");
      try {
        window.AxisToast?.success?.("Copied subscription URL. Paste it into Google Calendar → Add by URL.");
      } catch {
        showToast?.("Copied subscription URL. Paste it into Google Calendar → Add by URL.");
      }
    } catch (err) {
      console.error("openGoogleCalendar error:", err);
      window.open("https://calendar.google.com/calendar/u/0/r/settings/addbyurl", "_blank", "noopener");
      try {
        window.AxisToast?.error?.("Could not fetch subscription URL.");
      } catch {
        showToast?.("Could not fetch subscription URL.");
      }
    }
  }

  function wireSettingsHandlers() {
    const includeFixed = $("#exportIncludeFixedBlocks");
    includeFixed?.addEventListener("change", () => {
      persistSettings({ includeFixedBlocks: includeFixed.checked });
      renderModal();
    });
    const includeCompleted = $("#exportIncludeCompletedTasks");
    includeCompleted?.addEventListener("change", () => {
      persistSettings({ includeCompletedTasks: includeCompleted.checked });
      renderModal();
    });
    const reminder = $("#exportReminderMinutes");
    reminder?.addEventListener("change", () => {
      const val = Number(reminder.value);
      persistSettings({ reminderMinutes: Number.isFinite(val) ? val : DEFAULT_SETTINGS.reminderMinutes });
      renderModal();
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;
    if (!isDashboardPage()) return;

    loadSettingsFromState();
    updateBadge();

    $("#calendarExportBtn")?.addEventListener("click", () => openModal());

    const modal = $("#calendarExportModal");
    if (modal) {
      modal.querySelector(".modal-overlay")?.addEventListener("click", closeModal);
    }
    $("#closeCalendarExportBtn")?.addEventListener("click", closeModal);

    $("#downloadIcsBtn")?.addEventListener("click", downloadIcs);
    $("#copyWebcalBtn")?.addEventListener("click", copyWebcalUrl);
    $("#googleCalendarBtn")?.addEventListener("click", openGoogleCalendar);

    wireSettingsHandlers();
    renderModal();
  }

  window.AxisCalendarExport = {
    init,
    open: openModal,
    close: closeModal,
    isOpen: () => {
      const modal = $("#calendarExportModal");
      return Boolean(modal && !modal.classList.contains("hidden"));
    },
  };
})();

