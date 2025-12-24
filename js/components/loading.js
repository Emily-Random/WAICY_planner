// Loading States Component
export class LoadingManager {
  constructor() {
    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById("loading-styles")) return;
    
    const style = document.createElement("style");
    style.id = "loading-styles";
    style.textContent = `
      /* Loading Overlay */
      .loading-overlay {
        position: fixed;
        inset: 0;
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(4px);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 9998;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.3s ease, visibility 0.3s ease;
      }
      .loading-overlay.visible {
        opacity: 1;
        visibility: visible;
      }
      
      /* Spinner */
      .loading-spinner {
        width: 48px;
        height: 48px;
        border: 4px solid #f3f3f3;
        border-top: 4px solid #c8103c;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      .loading-spinner-sm {
        width: 20px;
        height: 20px;
        border-width: 2px;
      }
      .loading-spinner-inline {
        display: inline-block;
        vertical-align: middle;
        margin-right: 8px;
      }
      
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      
      .loading-text {
        margin-top: 16px;
        font-size: 1rem;
        color: #1f1f25;
        font-weight: 500;
      }
      
      /* Button loading state */
      .btn-loading {
        position: relative;
        pointer-events: none;
        opacity: 0.8;
      }
      .btn-loading::after {
        content: "";
        position: absolute;
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
      }
      
      /* Skeleton loading */
      .skeleton {
        background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
        background-size: 200% 100%;
        animation: skeleton-shimmer 1.5s ease-in-out infinite;
        border-radius: 4px;
      }
      @keyframes skeleton-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      .skeleton-text {
        height: 14px;
        margin-bottom: 8px;
        width: 80%;
      }
      .skeleton-text-sm {
        height: 10px;
        width: 60%;
      }
      .skeleton-box {
        height: 60px;
        margin-bottom: 12px;
      }
      
      /* Empty states */
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 32px 24px;
        text-align: center;
        color: #60646f;
      }
      .empty-state-icon {
        font-size: 3rem;
        margin-bottom: 16px;
        opacity: 0.6;
      }
      .empty-state-title {
        font-size: 1.1rem;
        font-weight: 600;
        color: #1f1f25;
        margin: 0 0 8px;
      }
      .empty-state-description {
        font-size: 0.9rem;
        margin: 0 0 16px;
        max-width: 280px;
        line-height: 1.5;
      }
      .empty-state-action {
        margin-top: 8px;
      }
      
      /* Error banner */
      .error-banner {
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-left: 4px solid #ef4444;
        padding: 12px 16px;
        border-radius: 8px;
        margin-bottom: 16px;
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }
      .error-banner-icon {
        color: #ef4444;
        font-size: 1.2rem;
        flex-shrink: 0;
      }
      .error-banner-content {
        flex: 1;
      }
      .error-banner-title {
        font-weight: 600;
        color: #dc2626;
        margin: 0 0 4px;
        font-size: 0.9rem;
      }
      .error-banner-message {
        color: #7f1d1d;
        margin: 0;
        font-size: 0.85rem;
        line-height: 1.4;
      }
      .error-banner-dismiss {
        background: transparent;
        border: none;
        color: #dc2626;
        cursor: pointer;
        padding: 4px;
        font-size: 1.2rem;
        line-height: 1;
        opacity: 0.7;
        transition: opacity 0.2s;
      }
      .error-banner-dismiss:hover {
        opacity: 1;
      }
      
      /* Progress bar */
      .progress-bar {
        width: 100%;
        height: 6px;
        background: #e5e7eb;
        border-radius: 3px;
        overflow: hidden;
      }
      .progress-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #c8103c, #e11d48);
        border-radius: 3px;
        transition: width 0.3s ease;
      }
      .progress-bar-indeterminate .progress-bar-fill {
        width: 30%;
        animation: progress-indeterminate 1.5s ease-in-out infinite;
      }
      @keyframes progress-indeterminate {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(400%); }
      }
    `;
    document.head.appendChild(style);
  }

  // Create loading overlay
  createOverlay(text = "Loading...") {
    const existing = document.getElementById("app-loading-overlay");
    if (existing) return existing;
    
    const overlay = document.createElement("div");
    overlay.id = "app-loading-overlay";
    overlay.className = "loading-overlay";
    overlay.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-text">${text}</div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  showOverlay(text = "Loading...") {
    const overlay = this.createOverlay(text);
    overlay.querySelector(".loading-text").textContent = text;
    requestAnimationFrame(() => overlay.classList.add("visible"));
  }

  hideOverlay() {
    const overlay = document.getElementById("app-loading-overlay");
    if (overlay) {
      overlay.classList.remove("visible");
      setTimeout(() => overlay.remove(), 300);
    }
  }

  // Button loading state
  setButtonLoading(button, isLoading, originalText = null) {
    if (!button) return;
    
    if (isLoading) {
      button.dataset.originalText = button.textContent;
      button.classList.add("btn-loading");
      button.disabled = true;
      if (originalText) button.textContent = originalText;
    } else {
      button.classList.remove("btn-loading");
      button.disabled = false;
      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
      }
    }
  }

  // Create inline spinner
  createSpinner(size = "sm") {
    const spinner = document.createElement("span");
    spinner.className = `loading-spinner loading-spinner-${size} loading-spinner-inline`;
    return spinner;
  }

  // Create skeleton placeholder
  createSkeleton(type = "text", count = 1) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const div = document.createElement("div");
      div.className = `skeleton skeleton-${type}`;
      fragment.appendChild(div);
    }
    return fragment;
  }

  // Create empty state
  createEmptyState(options = {}) {
    const {
      icon = "📭",
      title = "Nothing here yet",
      description = "",
      actionText = "",
      onAction = null
    } = options;
    
    const container = document.createElement("div");
    container.className = "empty-state";
    container.innerHTML = `
      <div class="empty-state-icon">${icon}</div>
      <h3 class="empty-state-title">${title}</h3>
      ${description ? `<p class="empty-state-description">${description}</p>` : ""}
      ${actionText ? `<button class="btn btn-primary empty-state-action">${actionText}</button>` : ""}
    `;
    
    if (onAction && actionText) {
      container.querySelector(".empty-state-action")?.addEventListener("click", onAction);
    }
    
    return container;
  }

  // Create error banner
  createErrorBanner(title, message, dismissable = true) {
    const banner = document.createElement("div");
    banner.className = "error-banner";
    banner.innerHTML = `
      <span class="error-banner-icon">⚠️</span>
      <div class="error-banner-content">
        <h4 class="error-banner-title">${title}</h4>
        <p class="error-banner-message">${message}</p>
      </div>
      ${dismissable ? '<button class="error-banner-dismiss">×</button>' : ''}
    `;
    
    if (dismissable) {
      banner.querySelector(".error-banner-dismiss")?.addEventListener("click", () => {
        banner.style.animation = "fadeOut 0.2s ease-out forwards";
        setTimeout(() => banner.remove(), 200);
      });
    }
    
    return banner;
  }

  // Create progress bar
  createProgressBar(progress = 0, indeterminate = false) {
    const container = document.createElement("div");
    container.className = `progress-bar ${indeterminate ? 'progress-bar-indeterminate' : ''}`;
    container.innerHTML = `<div class="progress-bar-fill" style="width: ${progress}%"></div>`;
    return container;
  }

  updateProgressBar(container, progress) {
    const fill = container.querySelector(".progress-bar-fill");
    if (fill) fill.style.width = `${progress}%`;
  }
}

export const loading = new LoadingManager();
