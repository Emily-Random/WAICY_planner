(() => {
  const RECENTS_KEY = "axis_command_palette_recent";
  const MAX_RECENTS = 8;

  let initialized = false;
  let open = false;
  let activeIndex = 0;
  let currentItems = [];
  let selectedTaskId = null;

  function $(selector) {
    return document.querySelector(selector);
  }

  function isEditableTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    if (target.closest?.("[data-hotkeys-disabled]")) return true;
    const tag = target.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return Boolean(target.isContentEditable);
  }

  function getElements() {
    return {
      modal: $("#commandPaletteModal"),
      overlay: $("#commandPaletteModal .modal-overlay"),
      input: $("#commandPaletteInput"),
      list: $("#commandPaletteList"),
      helpModal: $("#shortcutsHelpModal"),
      helpOverlay: $("#shortcutsHelpModal .modal-overlay"),
      helpCloseBtn: $("#closeShortcutsHelpBtn"),
      openBtn: $("#commandPaletteBtn"),
    };
  }

  function fuzzyScore(query, text) {
    const q = String(query || "").trim().toLowerCase();
    const t = String(text || "").trim().toLowerCase();
    if (!q) return 0;
    if (!t) return Number.NEGATIVE_INFINITY;
    const idx = t.indexOf(q);
    if (idx >= 0) {
      return 200 - idx - Math.max(0, t.length - q.length);
    }
    // Subsequence match
    let ti = 0;
    let score = 0;
    for (const qc of q) {
      const found = t.indexOf(qc, ti);
      if (found === -1) return Number.NEGATIVE_INFINITY;
      score += found === ti ? 8 : 4;
      ti = found + 1;
    }
    return score - Math.max(0, t.length - q.length);
  }

  function loadRecents() {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(0, MAX_RECENTS);
    } catch {
      return [];
    }
  }

  function saveRecents(list) {
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
    } catch {}
  }

  function recordRecent(item) {
    if (!item || !item.kind) return;
    const key = item.kind === "action" ? `action:${item.id}` : `${item.kind}:${item.id}`;
    const recents = loadRecents();
    const next = [
      { key, kind: item.kind, id: item.id, label: item.title || item.label || "" },
      ...recents.filter((r) => r && r.key !== key),
    ];
    saveRecents(next);
  }

  function resolveRecent(rec) {
    if (!rec || !rec.kind || !rec.id) return null;
    if (rec.kind === "action") return getDefaultActions().find((a) => a.id === rec.id) || null;

    if (typeof state === "undefined" || !state) return null;
    if (rec.kind === "task") {
      const task = (state.tasks || []).find((t) => t.id === rec.id);
      if (!task) return null;
      return {
        kind: "task",
        id: task.id,
        title: task.task_name || "Untitled task",
        subtitle: task.task_deadline ? `Due ${task.task_deadline} ${task.task_deadline_time || ""}`.trim() : "",
      };
    }
    if (rec.kind === "goal") {
      const goal = (state.goals || []).find((g) => g.id === rec.id);
      if (!goal) return null;
      return {
        kind: "goal",
        id: goal.id,
        title: goal.name || "Untitled goal",
        subtitle: goal.level ? `${goal.level} goal` : "Goal",
      };
    }
    if (rec.kind === "habit") {
      const habit = (state.dailyHabits || []).find((h) => h.id === rec.id);
      if (!habit) return null;
      return {
        kind: "habit",
        id: habit.id,
        title: habit.name || "Untitled habit",
        subtitle: habit.time ? `Daily at ${habit.time}` : "Daily habit",
      };
    }
    return null;
  }

  function getDefaultActions() {
    return [
      {
        kind: "action",
        id: "new-task",
        title: "New task",
        subtitle: "Open the Add Task modal",
        shortcut: "Ctrl/⌘ N",
        run: () => {
          if (typeof openTaskEditor === "function") openTaskEditor(null);
        },
      },
      {
        kind: "action",
        id: "new-goal",
        title: "New goal",
        subtitle: "Open the Add Goal modal",
        shortcut: "Ctrl/⌘ G",
        run: () => {
          if (typeof openAddGoalModal === "function") openAddGoalModal();
        },
      },
      {
        kind: "action",
        id: "open-settings",
        title: "Open settings",
        subtitle: "Customization and account options",
        run: () => {
          const panel = document.getElementById("settingsPanel");
          if (panel) {
            panel.classList.remove("hidden");
            if (typeof initSettings === "function") initSettings();
          }
        },
      },
      {
        kind: "action",
        id: "toggle-theme",
        title: "Toggle theme",
        subtitle: "Light ↔ Dark",
        shortcut: "T",
        run: () => {
          if (typeof toggleTheme === "function") toggleTheme();
        },
      },
      {
        kind: "action",
        id: "show-shortcuts",
        title: "Show keyboard shortcuts",
        subtitle: "Quick reference",
        shortcut: "Ctrl/⌘ /",
        run: () => openShortcutsHelp(),
      },
    ];
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderItems(items) {
    const { list } = getElements();
    if (!list) return;
    currentItems = items.filter((it) => it && it.selectable !== false);
    activeIndex = Math.min(activeIndex, Math.max(0, currentItems.length - 1));
    if (!currentItems.length) activeIndex = 0;

    list.innerHTML = currentItems
      .map((item, idx) => {
        const badge =
          item.kind === "task"
            ? "Task"
            : item.kind === "goal"
              ? "Goal"
              : item.kind === "habit"
                ? "Habit"
                : "Action";
        return `
          <button type="button" class="command-palette-item${idx === activeIndex ? " active" : ""}" data-index="${idx}">
            <span class="command-palette-item-main">
              <span class="command-palette-badge">${badge}</span>
              <span class="command-palette-title">${escapeHtml(item.title || "")}</span>
            </span>
            <span class="command-palette-item-meta">
              <span class="command-palette-subtitle">${escapeHtml(item.subtitle || "")}</span>
              ${item.shortcut ? `<span class="command-palette-shortcut">${escapeHtml(item.shortcut)}</span>` : ""}
            </span>
          </button>
        `;
      })
      .join("");
  }

  function setActiveIndex(nextIndex) {
    const { list } = getElements();
    if (!list) return;
    activeIndex = Math.max(0, Math.min(nextIndex, currentItems.length - 1));
    list.querySelectorAll(".command-palette-item").forEach((el) => {
      const idx = Number(el.dataset.index);
      el.classList.toggle("active", idx === activeIndex);
    });
    const activeEl = list.querySelector(`.command-palette-item[data-index="${activeIndex}"]`);
    activeEl?.scrollIntoView?.({ block: "nearest" });
  }

  function scrollAndFlash(el) {
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("axis-flash");
    setTimeout(() => el.classList.remove("axis-flash"), 650);
  }

  function runItem(item) {
    if (!item) return;
    recordRecent(item);

    if (item.kind === "action") {
      item.run?.();
      return;
    }

    if (item.kind === "task") {
      selectedTaskId = item.id;
      try {
        window.AxisKeyboardShortcuts?.setSelectedTaskId?.(item.id);
      } catch {}
      if (typeof openTaskEditor === "function") openTaskEditor(item.id);
      const taskEl = document.querySelector(`.checkbox-fancy[data-id="${CSS.escape(item.id)}"]`)?.closest(".task-item");
      if (taskEl) scrollAndFlash(taskEl);
      return;
    }

    if (item.kind === "goal") {
      const goalEl = document.querySelector(`.goal-item[data-goal-id="${CSS.escape(item.id)}"]`);
      if (goalEl) {
        scrollAndFlash(goalEl);
      } else {
        document.querySelector(".panel-goals")?.scrollIntoView({ block: "start", behavior: "smooth" });
      }
      return;
    }

    if (item.kind === "habit") {
      const habitEl = document.querySelector(`.habit-item[data-habit-id="${CSS.escape(item.id)}"]`);
      if (habitEl) {
        scrollAndFlash(habitEl);
      } else {
        document.querySelector(".panel-habits")?.scrollIntoView({ block: "start", behavior: "smooth" });
      }
      return;
    }
  }

  function buildQueryItems(query) {
    const q = String(query || "").trim();
    const actions = getDefaultActions();
    if (!q) {
      const resolvedRecents = loadRecents().map(resolveRecent).filter(Boolean);
      const uniq = new Map();
      [...resolvedRecents, ...actions].forEach((it) => {
        const key = it.kind === "action" ? `action:${it.id}` : `${it.kind}:${it.id}`;
        if (!uniq.has(key)) uniq.set(key, it);
      });
      return Array.from(uniq.values()).slice(0, 14);
    }

    const results = [];

    actions.forEach((a) => {
      const score = fuzzyScore(q, `${a.title} ${a.subtitle}`);
      if (score > Number.NEGATIVE_INFINITY) results.push({ ...a, _score: score });
    });

    if (typeof state !== "undefined" && state) {
      (state.tasks || []).forEach((task) => {
        const title = task.task_name || "Untitled task";
        const subtitle = task.task_deadline ? `Due ${task.task_deadline} ${task.task_deadline_time || ""}`.trim() : "";
        const score = fuzzyScore(q, `${title} ${subtitle}`);
        if (score > Number.NEGATIVE_INFINITY) {
          results.push({ kind: "task", id: task.id, title, subtitle, _score: score });
        }
      });

      (state.goals || []).forEach((goal) => {
        const title = goal.name || "Untitled goal";
        const subtitle = goal.level ? `${goal.level} goal` : "Goal";
        const score = fuzzyScore(q, `${title} ${subtitle}`);
        if (score > Number.NEGATIVE_INFINITY) {
          results.push({ kind: "goal", id: goal.id, title, subtitle, _score: score });
        }
      });

      (state.dailyHabits || []).forEach((habit) => {
        const title = habit.name || "Untitled habit";
        const subtitle = habit.time ? `Daily at ${habit.time}` : "Daily habit";
        const score = fuzzyScore(q, `${title} ${subtitle}`);
        if (score > Number.NEGATIVE_INFINITY) {
          results.push({ kind: "habit", id: habit.id, title, subtitle, _score: score });
        }
      });
    }

    results.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
    return results.slice(0, 14).map(({ _score, ...rest }) => rest);
  }

  function openCommandPalette() {
    const { modal, input } = getElements();
    if (!modal || !input) return;

    modal.classList.remove("hidden");
    open = true;
    input.value = "";
    activeIndex = 0;
    renderItems(buildQueryItems(""));
    setTimeout(() => input.focus(), 0);
  }

  function closeCommandPalette() {
    const { modal } = getElements();
    if (!modal) return;
    modal.classList.add("hidden");
    open = false;
  }

  function toggleCommandPalette() {
    if (open) closeCommandPalette();
    else openCommandPalette();
  }

  function openShortcutsHelp() {
    const { helpModal } = getElements();
    if (!helpModal) return;
    helpModal.classList.remove("hidden");
    setTimeout(() => document.getElementById("closeShortcutsHelpBtn")?.focus?.(), 0);
  }

  function closeShortcutsHelp() {
    const { helpModal } = getElements();
    if (!helpModal) return;
    helpModal.classList.add("hidden");
  }

  function closeOverlays() {
    closeCommandPalette();
    closeShortcutsHelp();
  }

  function onPaletteInput() {
    const { input } = getElements();
    if (!input) return;
    activeIndex = 0;
    renderItems(buildQueryItems(input.value));
  }

  function onPaletteKeydown(e) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(activeIndex + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(activeIndex - 1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = currentItems[activeIndex];
      if (item) {
        closeCommandPalette();
        runItem(item);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeCommandPalette();
    }
  }

  function onPaletteClick(e) {
    const btn = e.target.closest(".command-palette-item");
    if (!btn) return;
    const idx = Number(btn.dataset.index);
    if (Number.isNaN(idx)) return;
    const item = currentItems[idx];
    if (!item) return;
    closeCommandPalette();
    runItem(item);
  }

  function init() {
    if (initialized) return;
    initialized = true;

    const { openBtn, modal, overlay, input, list, helpOverlay, helpCloseBtn } = getElements();
    openBtn?.addEventListener("click", openCommandPalette);

    overlay?.addEventListener("click", closeCommandPalette);
    input?.addEventListener("input", onPaletteInput);
    input?.addEventListener("keydown", onPaletteKeydown);
    list?.addEventListener("click", onPaletteClick);

    helpOverlay?.addEventListener("click", closeShortcutsHelp);
    helpCloseBtn?.addEventListener("click", closeShortcutsHelp);

    modal?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeCommandPalette();
      }
    });
  }

  function handleKeydown(e) {
    // If palette is open, let it swallow arrow/enter/esc.
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") {
        const { input } = getElements();
        if (input && document.activeElement !== input) {
          input.focus();
        }
        return true;
      }
    }

    // Don't handle plain keys while typing.
    if (isEditableTarget(e.target)) return false;
    return false;
  }

  function setSelectedTaskIdForShortcuts(taskId) {
    selectedTaskId = taskId || null;
  }

  function getSelectedTaskIdForShortcuts() {
    return selectedTaskId;
  }

  window.AxisKeyboardShortcuts = {
    init,
    handleKeydown,
    openCommandPalette,
    closeCommandPalette,
    toggleCommandPalette,
    openShortcutsHelp,
    closeShortcutsHelp,
    closeOverlays,
    setSelectedTaskId: setSelectedTaskIdForShortcuts,
    getSelectedTaskId: getSelectedTaskIdForShortcuts,
    isCommandPaletteOpen: () => open,
  };

  // Auto-init when present on the page.
  init();
})();

