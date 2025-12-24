// Toast Notification System
import { generateId } from "../utils/helpers.js";

class ToastManager {
  constructor() {
    this.container = document.createElement("div");
    this.container.className = "toast-container";
    document.body.appendChild(this.container);
    
    // Inject styles if not present
    if (!document.getElementById("toast-styles")) {
      const style = document.createElement("style");
      style.id = "toast-styles";
      style.textContent = `
        .toast-container {
          position: fixed;
          bottom: 24px;
          right: 24px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          z-index: 9999;
          pointer-events: none;
        }
        .toast {
          background: white;
          border-radius: 12px;
          padding: 16px 20px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.15);
          border-left: 4px solid #3b82f6;
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 300px;
          max-width: 400px;
          pointer-events: auto;
          animation: toast-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          font-size: 0.9rem;
          color: #1f2937;
        }
        .toast.success { border-left-color: #22c55e; }
        .toast.error { border-left-color: #ef4444; }
        .toast.info { border-left-color: #3b82f6; }
        .toast.warning { border-left-color: #f59e0b; }
        
        .toast-content { flex: 1; }
        .toast-close {
          border: none;
          background: transparent;
          color: #9ca3af;
          cursor: pointer;
          padding: 4px;
          font-size: 1.2rem;
          line-height: 1;
        }
        .toast-close:hover { color: #4b5563; }
        
        @keyframes toast-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes toast-slide-out {
          to { transform: translateX(100%); opacity: 0; }
        }
        .toast.hiding {
          animation: toast-slide-out 0.3s forwards;
        }
      `;
      document.head.appendChild(style);
    }
  }

  show(message, type = "info", duration = 4000) {
    const id = generateId("toast");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.id = id;
    
    let icon = "";
    switch(type) {
      case "success": icon = "✅"; break;
      case "error": icon = "❌"; break;
      case "warning": icon = "⚠️"; break;
      default: icon = "ℹ️";
    }

    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-content">${message}</div>
      <button class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;

    this.container.appendChild(toast);

    // Auto remove
    if (duration > 0) {
      setTimeout(() => {
        this.dismiss(toast);
      }, duration);
    }
    
    return id;
  }

  dismiss(toastElement) {
    if (!toastElement) return;
    toastElement.classList.add("hiding");
    toastElement.addEventListener("animationend", () => {
      toastElement.remove();
    });
  }

  success(msg) { return this.show(msg, "success"); }
  error(msg) { return this.show(msg, "error"); }
  info(msg) { return this.show(msg, "info"); }
  warning(msg) { return this.show(msg, "warning"); }
}

export const toast = new ToastManager();
