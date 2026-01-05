(() => {
  const COMPLETED_KEY = "axis_tour_completed";

  const DEFAULT_STEPS = [
    {
      id: "goals",
      title: "Goals Hierarchy",
      body: "Your goals are organized by timeframe (lifetime → daily). Use this to keep your tasks tied to the bigger picture.",
      selector: ".panel-goals",
    },
    {
      id: "tasks",
      title: "To‑Do List",
      body: "Add tasks with deadlines and durations. Axis ranks them by urgency so you always know what matters most.",
      selector: ".panel-tasks",
    },
    {
      id: "calendar",
      title: "AI Schedule",
      body: "Axis time‑blocks your ranked tasks into a realistic plan. Drag blocks to adjust — it will still respect deadlines.",
      selector: ".calendar-section",
    },
    {
      id: "pomodoro",
      title: "Focus Timer",
      body: "Start a Pomodoro session for any task. Press F to start focus on your selected task.",
      selector: ".panel-tasks",
      onEnter: () => {
        try {
          const firstTask = (state.tasks || []).find((t) => !t.completed) || (state.tasks || [])[0];
          if (firstTask && typeof openPomodoroTimer === "function") {
            openPomodoroTimer(firstTask.id);
            return { selectorOverride: "#pomodoroModal .pomodoro-modal-content", openedPomodoro: true };
          }
        } catch {}
        return null;
      },
      onExit: (ctx) => {
        if (ctx?.openedPomodoro) {
          try {
            if (typeof closePomodoroTimer === "function") closePomodoroTimer();
          } catch {}
        }
      },
    },
    {
      id: "settings",
      title: "Settings",
      body: "Customize themes, focus mode, data management, and notification preferences here.",
      selector: "#settingsBtn",
    },
    {
      id: "assistant",
      title: "Axis Assistant",
      body: "Ask for planning help, focus tips, or quick guidance — it’s here when you get stuck.",
      selector: ".panel-chat",
    },
  ];

  let steps = DEFAULT_STEPS;
  let active = false;
  let stepIndex = 0;
  let stepCtx = null;

  let overlayEl = null;
  let spotlightEl = null;
  let tooltipEl = null;

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function createElements() {
    if (overlayEl) return;

    overlayEl = document.createElement("div");
    overlayEl.className = "axis-tour-overlay";
    overlayEl.setAttribute("role", "dialog");
    overlayEl.setAttribute("aria-modal", "true");
    overlayEl.setAttribute("aria-label", "Onboarding tour");

    spotlightEl = document.createElement("div");
    spotlightEl.className = "axis-tour-spotlight";

    tooltipEl = document.createElement("div");
    tooltipEl.className = "axis-tour-tooltip";

    overlayEl.appendChild(spotlightEl);
    overlayEl.appendChild(tooltipEl);
    document.body.appendChild(overlayEl);

    overlayEl.addEventListener("click", (e) => {
      // Prevent click-through; only allow tooltip interactions.
      if (tooltipEl && tooltipEl.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  function destroyElements() {
    if (!overlayEl) return;
    window.removeEventListener("resize", updatePosition, true);
    window.removeEventListener("scroll", updatePosition, true);
    document.removeEventListener("keydown", onKeydown, true);
    overlayEl.remove();
    overlayEl = null;
    spotlightEl = null;
    tooltipEl = null;
  }

  function getTarget(step) {
    const selector = stepCtx?.selectorOverride || step.selector;
    if (!selector) return null;
    return document.querySelector(selector);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function updatePosition() {
    if (!active) return;
    const step = steps[stepIndex];
    const target = getTarget(step);
    if (!target || !spotlightEl || !tooltipEl) return;

    const rect = target.getBoundingClientRect();
    const pad = 10;

    const left = rect.left - pad;
    const top = rect.top - pad;
    const width = rect.width + pad * 2;
    const height = rect.height + pad * 2;

    spotlightEl.style.left = `${Math.max(8, left)}px`;
    spotlightEl.style.top = `${Math.max(8, top)}px`;
    spotlightEl.style.width = `${Math.max(24, width)}px`;
    spotlightEl.style.height = `${Math.max(24, height)}px`;

    // Tooltip positioning: prefer right, then left, then bottom, then top.
    const tooltipWidth = 380;
    const margin = 14;

    const spaceRight = window.innerWidth - rect.right;
    const spaceLeft = rect.left;
    const spaceBottom = window.innerHeight - rect.bottom;
    const spaceTop = rect.top;

    let placement = "right";
    if (spaceRight >= tooltipWidth + margin) placement = "right";
    else if (spaceLeft >= tooltipWidth + margin) placement = "left";
    else if (spaceBottom >= 160) placement = "bottom";
    else placement = "top";

    let tx = rect.right + margin;
    let ty = rect.top;
    if (placement === "left") {
      tx = rect.left - tooltipWidth - margin;
      ty = rect.top;
    } else if (placement === "bottom") {
      tx = rect.left;
      ty = rect.bottom + margin;
    } else if (placement === "top") {
      tx = rect.left;
      ty = rect.top - margin - 160;
    }

    tx = clamp(tx, 12, window.innerWidth - tooltipWidth - 12);
    ty = clamp(ty, 12, window.innerHeight - 220);

    tooltipEl.style.left = `${tx}px`;
    tooltipEl.style.top = `${ty}px`;
  }

  function renderTooltip() {
    if (!tooltipEl) return;
    const step = steps[stepIndex];

    const isLast = stepIndex === steps.length - 1;
    tooltipEl.innerHTML = `
      <div class="axis-tour-header">
        <div class="axis-tour-title">${escapeHtml(step.title)}</div>
        <div class="axis-tour-progress">${stepIndex + 1} of ${steps.length}</div>
      </div>
      <div class="axis-tour-body">${escapeHtml(step.body)}</div>
      <div class="axis-tour-actions">
        <button type="button" class="btn btn-ghost axis-tour-skip">Skip</button>
        <button type="button" class="btn btn-primary axis-tour-next">${isLast ? "Done" : "Next"}</button>
      </div>
    `;

    tooltipEl.querySelector(".axis-tour-skip")?.addEventListener("click", skip);
    tooltipEl.querySelector(".axis-tour-next")?.addEventListener("click", next);
  }

  function goTo(index) {
    if (!active) return;
    const nextIndex = clamp(index, 0, steps.length - 1);

    // Exit old step
    const current = steps[stepIndex];
    try {
      current?.onExit?.(stepCtx);
    } catch {}

    stepIndex = nextIndex;
    stepCtx = null;

    // Enter new step (may override selector)
    const step = steps[stepIndex];
    try {
      const ctx = step?.onEnter?.();
      if (ctx && typeof ctx === "object") stepCtx = ctx;
    } catch {}

    const target = getTarget(step);
    if (target) {
      try {
        target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      } catch {}
    }

    renderTooltip();
    // Allow layout to settle (and smooth scrolling to start) before positioning.
    setTimeout(updatePosition, 80);
    setTimeout(updatePosition, 260);
  }

  function next() {
    if (!active) return;
    if (stepIndex >= steps.length - 1) {
      finish(true);
      return;
    }
    goTo(stepIndex + 1);
  }

  function skip() {
    finish(true);
  }

  function finish(markCompleted) {
    if (!active) return;
    const current = steps[stepIndex];
    try {
      current?.onExit?.(stepCtx);
    } catch {}

    active = false;
    stepIndex = 0;
    stepCtx = null;

    if (markCompleted) {
      try {
        localStorage.setItem(COMPLETED_KEY, "1");
      } catch {}
    }
    destroyElements();
  }

  function start(customSteps) {
    if (active) return;
    const hasDashboard = Boolean(document.getElementById("dashboard"));
    if (!hasDashboard) return;

    steps = Array.isArray(customSteps) && customSteps.length ? customSteps : DEFAULT_STEPS;
    active = true;
    stepIndex = 0;
    stepCtx = null;

    createElements();
    window.addEventListener("resize", updatePosition, true);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("keydown", onKeydown, true);
    goTo(0);
  }

  function onKeydown(e) {
    if (!active) return;
    if (e.key === "Escape") {
      e.preventDefault();
      skip();
      return;
    }
    if (e.key === "Enter") {
      // Avoid hijacking when typing in an input inside the app.
      const target = e.target;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      e.preventDefault();
      next();
    }
  }

  function maybeStart() {
    const hasDashboard = Boolean(document.getElementById("dashboard"));
    if (!hasDashboard) return;

    try {
      if (localStorage.getItem(COMPLETED_KEY) === "1") return;
    } catch {}

    // Avoid starting while the signup wizard is active.
    const wizard = document.getElementById("wizard");
    if (wizard && !wizard.classList.contains("hidden")) return;

    // Give the dashboard a moment to render tasks/goals/schedule.
    setTimeout(() => start(), 700);
  }

  function reset() {
    try {
      localStorage.removeItem(COMPLETED_KEY);
    } catch {}
  }

  window.AxisOnboardingTour = {
    start,
    maybeStart,
    skip,
    finish: () => finish(true),
    reset,
    isOpen: () => active,
  };
})();

