(() => {
  const SETTINGS_KEY = "axis_celebrations_settings";
  const STREAK_WINDOW_MS = 5 * 60 * 1000;

  const DEFAULT_SETTINGS = {
    enabled: true,
    sounds: false,
    streaks: true,
  };

  const BADGES = [
    { key: "firstTask", title: "First Task", desc: "Complete your first task", icon: "✓" },
    { key: "tasks10", title: "Task Collector", desc: "Complete 10 tasks", icon: "10" },
    { key: "streak3", title: "On a Roll", desc: "Complete 3 tasks in a row", icon: "⚡" },
    { key: "firstGoal", title: "Goal Getter", desc: "Complete your first goal", icon: "🎯" },
  ];

  let settings = { ...DEFAULT_SETTINGS };
  let initialized = false;

  function safeJsonParse(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const parsed = safeJsonParse(raw, null);
      if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
      return {
        enabled: parsed.enabled !== false,
        sounds: Boolean(parsed.sounds),
        streaks: parsed.streaks !== false,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(next) {
    settings = { ...settings, ...(next || {}) };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
    renderSettingsUi();
  }

  function getState() {
    try {
      return state;
    } catch {
      return null;
    }
  }

  function ensureAchievements() {
    const s = getState();
    if (!s) return null;
    if (!s.achievements || typeof s.achievements !== "object") {
      s.achievements = {};
    }

    const a = s.achievements;
    if (!a.badges || typeof a.badges !== "object") a.badges = {};
    if (!a.currentStreak || typeof a.currentStreak !== "number") a.currentStreak = 0;
    if (!a.bestStreak || typeof a.bestStreak !== "number") a.bestStreak = 0;
    if (!a.lastCompletedAt || typeof a.lastCompletedAt !== "string") a.lastCompletedAt = "";
    if (!a.completedTaskCount || typeof a.completedTaskCount !== "number") {
      a.completedTaskCount = (s.tasks || []).filter((t) => t.completed).length;
    }

    a.badges.firstTask = Boolean(a.badges.firstTask);
    a.badges.tasks10 = Boolean(a.badges.tasks10);
    a.badges.streak3 = Boolean(a.badges.streak3);
    a.badges.firstGoal = Boolean(a.badges.firstGoal);
    return a;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderBadgesUi() {
    const container = document.getElementById("achievementBadges");
    if (!container) return;
    const a = ensureAchievements();
    const unlocked = a?.badges || {};

    container.innerHTML = BADGES.map((b) => {
      const isUnlocked = Boolean(unlocked[b.key]);
      return `
        <div class="achievement-badge${isUnlocked ? "" : " locked"}" role="group" aria-label="${escapeHtml(b.title)}">
          <div class="achievement-badge-icon" aria-hidden="true">${escapeHtml(b.icon)}</div>
          <div>
            <div class="achievement-badge-title">${escapeHtml(b.title)}</div>
            <div class="achievement-badge-desc">${escapeHtml(b.desc)}</div>
          </div>
        </div>
      `.trim();
    }).join("");
  }

  function playTone({ frequency = 740, durationMs = 90, type = "sine", gain = 0.16 } = {}) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gainNode.gain.setValueAtTime(gain, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + durationMs / 1000);
      oscillator.onended = () => ctx.close().catch(() => {});
    } catch {}
  }

  function playPop() {
    playTone({ frequency: 880, durationMs: 80, type: "triangle", gain: 0.12 });
  }

  function playChime() {
    playTone({ frequency: 659, durationMs: 120, type: "sine", gain: 0.14 });
    window.setTimeout(() => playTone({ frequency: 988, durationMs: 140, type: "sine", gain: 0.12 }), 70);
  }

  function toast(type, message, opts) {
    try {
      window.AxisToast?.[type]?.(message, opts);
      return;
    } catch {}
    try {
      if (typeof showToast === "function") showToast(message);
    } catch {}
  }

  function confettiAtElement(el, intensity = "small") {
    if (!settings.enabled) return;
    const prefersReduce = (() => {
      try {
        return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch {
        return false;
      }
    })();
    if (prefersReduce) return;

    const rect = el?.getBoundingClientRect?.();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 3;

    const big = intensity === "big";
    window.AxisConfetti?.burst?.({
      x,
      y,
      particleCount: big ? 70 : 24,
      spread: big ? 95 : 70,
      startVelocity: big ? 9 : 7.2,
      scalar: big ? 1.1 : 0.95,
    });
  }

  function unlockBadge(badgeKey, title) {
    const s = getState();
    const a = ensureAchievements();
    if (!s || !a) return false;
    if (a.badges?.[badgeKey]) return false;
    a.badges[badgeKey] = true;
    try {
      if (typeof saveUserData === "function") saveUserData();
    } catch {}
    toast("success", `Achievement unlocked: ${title}`);
    if (settings.sounds) playChime();
    confettiAtElement(document.querySelector(".panel-analytics") || document.body, "big");
    renderBadgesUi();
    return true;
  }

  function onTaskCompleted(task, opts = {}) {
    if (!task) return;
    const s = getState();
    const a = ensureAchievements();

    if (settings.sounds) playPop();

    const targetEl = opts.element || document.querySelector(`[data-task-id="${task.id}"]`) || document.body;
    confettiAtElement(targetEl, "small");

    // Update streak/badges (best-effort; avoids breaking completion flow).
    if (s && a) {
      a.completedTaskCount = (s.tasks || []).filter((t) => t.completed).length;

      const now = Date.now();
      const last = a.lastCompletedAt ? Date.parse(a.lastCompletedAt) : 0;
      const within = last && now - last <= STREAK_WINDOW_MS;
      a.currentStreak = within ? a.currentStreak + 1 : 1;
      a.bestStreak = Math.max(a.bestStreak || 0, a.currentStreak || 0);
      a.lastCompletedAt = new Date(now).toISOString();

      try {
        if (typeof saveUserData === "function") saveUserData();
      } catch {}

      if (a.completedTaskCount >= 1) unlockBadge("firstTask", "First task completed");
      if (a.completedTaskCount >= 10) unlockBadge("tasks10", "10 tasks completed");

      if (settings.streaks && a.currentStreak === 3) {
        unlockBadge("streak3", "3‑task streak");
        toast("success", "Streak! 3 tasks in a row 🎉");
        confettiAtElement(targetEl, "big");
      } else {
        toast("success", "Nice work!");
      }
    } else {
      toast("success", "Nice work!");
    }

    // Animate the task row, if available.
    const row = document.querySelector(`.task-item[data-task-id="${task.id}"]`);
    if (row) {
      row.classList.add("task-just-completed");
      window.setTimeout(() => row.classList.remove("task-just-completed"), 650);
    }

    renderBadgesUi();
  }

  function onGoalCompleted(goal) {
    if (!goal) return;
    if (settings.sounds) playChime();
    confettiAtElement(document.querySelector(`.goal-item[data-goal-id="${goal.id}"]`) || document.body, "big");
    unlockBadge("firstGoal", "First goal completed");
    renderBadgesUi();
  }

  function renderSettingsUi() {
    const enabledEl = document.getElementById("celebrationsEnabled");
    if (enabledEl) enabledEl.checked = settings.enabled !== false;
    const soundsEl = document.getElementById("celebrationsSounds");
    if (soundsEl) soundsEl.checked = Boolean(settings.sounds);
    const streaksEl = document.getElementById("celebrationsStreaks");
    if (streaksEl) streaksEl.checked = settings.streaks !== false;
    renderBadgesUi();
  }

  function bindSettingsUi() {
    const root = document.getElementById("settingsExperience");
    if (!root || root.dataset.axisCelebrationsBound === "1") return;
    root.dataset.axisCelebrationsBound = "1";

    root.addEventListener("change", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.id === "celebrationsEnabled") saveSettings({ enabled: target.checked });
      if (target.id === "celebrationsSounds") saveSettings({ sounds: target.checked });
      if (target.id === "celebrationsStreaks") saveSettings({ streaks: target.checked });
    });

    renderSettingsUi();
  }

  function init() {
    if (initialized) return;
    initialized = true;
    settings = loadSettings();
    renderSettingsUi();
    renderBadgesUi();
  }

  window.AxisCelebrations = {
    init,
    onTaskCompleted,
    onGoalCompleted,
    bindSettingsUi,
    getSettings: () => ({ ...settings }),
    setSettings: saveSettings,
  };

  init();
})();
