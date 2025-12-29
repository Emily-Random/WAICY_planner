// Offline UI Indicator and Status Display
import { offlineQueue } from "./offline-queue.js";
import { toast } from "../components/toast.js";

class OfflineUI {
  constructor() {
    this.indicator = null;
    this.statusBar = null;
    this.init();
  }

  init() {
    this.createIndicator();
    this.createStatusBar();
    this.setupListeners();
    this.updateUI();
  }

  createIndicator() {
    // Create offline indicator badge
    this.indicator = document.createElement("div");
    this.indicator.id = "offline-indicator";
    this.indicator.className = "offline-indicator";
    this.indicator.setAttribute("role", "status");
    this.indicator.setAttribute("aria-live", "polite");
    this.indicator.innerHTML = `
      <span class="offline-indicator-icon">📡</span>
      <span class="offline-indicator-text">Offline</span>
    `;
    
    // Inject styles
    if (!document.getElementById("offline-ui-styles")) {
      const style = document.createElement("style");
      style.id = "offline-ui-styles";
      style.textContent = `
        .offline-indicator {
          position: fixed;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(239, 68, 68, 0.95);
          color: white;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 0.85rem;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 8px;
          z-index: 10000;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          backdrop-filter: blur(10px);
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.3s ease, visibility 0.3s ease, transform 0.3s ease;
        }
        .offline-indicator.visible {
          opacity: 1;
          visibility: visible;
        }
        .offline-indicator.online {
          background: rgba(34, 197, 94, 0.95);
        }
        .offline-indicator-icon {
          font-size: 1rem;
        }
        .offline-status-bar {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(59, 130, 246, 0.95);
          color: white;
          padding: 8px 16px;
          font-size: 0.85rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          z-index: 9999;
          transform: translateY(100%);
          transition: transform 0.3s ease;
        }
        .offline-status-bar.visible {
          transform: translateY(0);
        }
        .offline-status-text {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .offline-status-actions {
          display: flex;
          gap: 8px;
        }
        .offline-status-btn {
          background: rgba(255, 255, 255, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.3);
          color: white;
          padding: 4px 12px;
          border-radius: 4px;
          font-size: 0.8rem;
          cursor: pointer;
          transition: background 0.2s;
        }
        .offline-status-btn:hover {
          background: rgba(255, 255, 255, 0.3);
        }
        @media (max-width: 720px) {
          .offline-indicator {
            top: 8px;
            left: 8px;
            right: 8px;
            transform: none;
            justify-content: center;
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(this.indicator);
  }

  createStatusBar() {
    this.statusBar = document.createElement("div");
    this.statusBar.id = "offline-status-bar";
    this.statusBar.className = "offline-status-bar";
    this.statusBar.innerHTML = `
      <div class="offline-status-text">
        <span>⏳</span>
        <span id="offline-queue-count">0</span> actions queued for sync
      </div>
      <div class="offline-status-actions">
        <button class="offline-status-btn" id="sync-now-btn">Sync Now</button>
      </div>
    `;

    // Sync now button
    this.statusBar.querySelector("#sync-now-btn").addEventListener("click", async () => {
      if (navigator.onLine) {
        await offlineQueue.sync();
      } else {
        toast.info("You're still offline. Please check your connection.");
      }
    });

    document.body.appendChild(this.statusBar);
  }

  setupListeners() {
    // Listen to offline queue events
    offlineQueue.subscribe((event) => {
      this.updateUI();
      
      if (event.type === 'sync-complete') {
        if (event.successful > 0) {
          toast.success(`${event.successful} action(s) synced successfully`);
        }
        if (event.failed > 0) {
          toast.warning(`${event.failed} action(s) failed to sync`);
        }
      }
    });

    // Listen to online/offline events
    window.addEventListener('online', () => {
      this.updateUI();
      toast.success("You're back online! Syncing queued actions...");
      offlineQueue.sync();
    });

    window.addEventListener('offline', () => {
      this.updateUI();
      toast.info("You're offline. Changes will be synced when you're back online.");
    });
  }

  updateUI() {
    const status = offlineQueue.getStatus();
    
    // Update indicator
    if (!status.isOnline) {
      this.indicator.classList.add("visible");
      this.indicator.classList.remove("online");
      this.indicator.querySelector(".offline-indicator-text").textContent = "Offline";
      this.indicator.setAttribute("aria-label", "You are currently offline");
    } else if (status.queueLength > 0) {
      this.indicator.classList.add("visible", "online");
      this.indicator.querySelector(".offline-indicator-text").textContent = `Syncing ${status.queueLength}...`;
      this.indicator.setAttribute("aria-label", `Syncing ${status.queueLength} queued actions`);
    } else {
      this.indicator.classList.remove("visible");
    }

    // Update status bar
    if (status.queueLength > 0) {
      this.statusBar.classList.add("visible");
      this.statusBar.querySelector("#offline-queue-count").textContent = status.queueLength;
    } else {
      this.statusBar.classList.remove("visible");
    }
  }
}

export const offlineUI = new OfflineUI();

