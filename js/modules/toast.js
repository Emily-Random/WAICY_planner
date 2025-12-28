(() => {
  const DEFAULT_DURATION_MS = 3500;
  const MAX_TOASTS = 4;

  let container = null;
  let initialized = false;

  function ensureContainer() {
    if (container) return container;
    container = document.createElement("div");
    container.className = "axis-toast-container";
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-relevant", "additions");
    document.body.appendChild(container);
    return container;
  }

  function dismissToast(toastEl) {
    if (!toastEl) return;
    toastEl.classList.add("is-hiding");
    toastEl.addEventListener(
      "animationend",
      () => {
        toastEl.remove();
      },
      { once: true },
    );
  }

  function show(type, message, opts = {}) {
    if (!message) return null;
    ensureContainer();

    const toastEl = document.createElement("div");
    toastEl.className = `axis-toast axis-toast-${type || "info"}`;

    const contentEl = document.createElement("div");
    contentEl.className = "axis-toast-content";
    contentEl.textContent = String(message);

    const actionsEl = document.createElement("div");
    actionsEl.className = "axis-toast-actions";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "axis-toast-close";
    closeBtn.setAttribute("aria-label", "Dismiss");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => dismissToast(toastEl));

    let actionBtn = null;
    if (opts.actionText && typeof opts.onAction === "function") {
      actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.className = "axis-toast-action";
      actionBtn.textContent = String(opts.actionText);
      actionBtn.addEventListener("click", () => {
        try {
          opts.onAction();
        } finally {
          dismissToast(toastEl);
        }
      });
      actionsEl.appendChild(actionBtn);
    }

    actionsEl.appendChild(closeBtn);
    toastEl.appendChild(contentEl);
    toastEl.appendChild(actionsEl);

    container.appendChild(toastEl);

    // Cap number of visible toasts.
    const toasts = container.querySelectorAll(".axis-toast");
    if (toasts.length > MAX_TOASTS) {
      for (let i = 0; i < toasts.length - MAX_TOASTS; i++) {
        dismissToast(toasts[i]);
      }
    }

    const durationMs = Number(opts.durationMs ?? DEFAULT_DURATION_MS);
    if (durationMs > 0) {
      window.setTimeout(() => dismissToast(toastEl), durationMs);
    }

    return toastEl;
  }

  function init() {
    if (initialized) return;
    initialized = true;
    // Create container lazily.
  }

  window.AxisToast = {
    init,
    show,
    info: (msg, opts) => show("info", msg, opts),
    success: (msg, opts) => show("success", msg, opts),
    warning: (msg, opts) => show("warning", msg, opts),
    error: (msg, opts) => show("error", msg, opts),
    dismissAll: () => {
      if (!container) return;
      container.querySelectorAll(".axis-toast").forEach((t) => dismissToast(t));
    },
  };

  // Auto-init.
  init();
})();

