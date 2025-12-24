// Website Blocker Component
// Provides client-side website blocking via page redirection and focus mode

export class WebsiteBlocker {
  constructor() {
    this.rules = [];
    this.isActive = false;
    this.blockedPageUrl = null;
    this.focusMode = false;
    this.focusModeEndTime = null;
    this.checkInterval = null;
    this.blockedAttempts = [];
    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById("blocker-styles")) return;
    
    const style = document.createElement("style");
    style.id = "blocker-styles";
    style.textContent = `
      /* Blocker UI Styles */
      .blocker-badge {
        position: fixed;
        bottom: 24px;
        left: 24px;
        background: linear-gradient(135deg, #c8103c, #e11d48);
        color: white;
        padding: 12px 18px;
        border-radius: 12px;
        font-size: 0.85rem;
        font-weight: 600;
        box-shadow: 0 8px 24px rgba(200, 16, 60, 0.3);
        z-index: 9000;
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      .blocker-badge:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 32px rgba(200, 16, 60, 0.4);
      }
      .blocker-badge-icon {
        font-size: 1.2rem;
      }
      .blocker-badge-timer {
        font-variant-numeric: tabular-nums;
        font-family: monospace;
      }
      .blocker-badge.hidden {
        display: none;
      }
      
      /* Focus mode overlay */
      .focus-mode-indicator {
        position: fixed;
        top: 12px;
        right: 12px;
        background: rgba(200, 16, 60, 0.9);
        color: white;
        padding: 8px 14px;
        border-radius: 20px;
        font-size: 0.8rem;
        font-weight: 500;
        z-index: 9001;
        display: flex;
        align-items: center;
        gap: 8px;
        backdrop-filter: blur(10px);
      }
      .focus-mode-indicator.hidden {
        display: none;
      }
      .focus-mode-dot {
        width: 8px;
        height: 8px;
        background: #22c55e;
        border-radius: 50%;
        animation: pulse 2s ease-in-out infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(0.9); }
      }
      
      /* Blocked page overlay */
      .blocked-overlay {
        position: fixed;
        inset: 0;
        background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
        z-index: 99999;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: white;
        text-align: center;
        padding: 32px;
      }
      .blocked-overlay.hidden {
        display: none;
      }
      .blocked-icon {
        font-size: 5rem;
        margin-bottom: 24px;
        animation: shake 0.5s ease-in-out;
      }
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-10px); }
        75% { transform: translateX(10px); }
      }
      .blocked-title {
        font-size: 2rem;
        font-weight: 700;
        margin: 0 0 12px;
      }
      .blocked-message {
        font-size: 1.1rem;
        opacity: 0.8;
        margin: 0 0 24px;
        max-width: 500px;
        line-height: 1.6;
      }
      .blocked-domain {
        font-family: monospace;
        background: rgba(255,255,255,0.1);
        padding: 8px 16px;
        border-radius: 8px;
        margin-bottom: 32px;
        font-size: 1rem;
      }
      .blocked-actions {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        justify-content: center;
      }
      .blocked-btn {
        padding: 12px 24px;
        border-radius: 12px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
        border: none;
      }
      .blocked-btn:hover {
        transform: translateY(-2px);
      }
      .blocked-btn-primary {
        background: #c8103c;
        color: white;
        box-shadow: 0 8px 24px rgba(200, 16, 60, 0.4);
      }
      .blocked-btn-secondary {
        background: rgba(255,255,255,0.1);
        color: white;
        border: 1px solid rgba(255,255,255,0.2);
      }
      .blocked-quote {
        margin-top: 48px;
        font-style: italic;
        opacity: 0.6;
        max-width: 400px;
        font-size: 0.9rem;
        line-height: 1.5;
      }
      
      /* Settings panel for blocker */
      .blocker-settings {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .blocker-rule-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: rgba(249, 250, 251, 0.9);
        border-radius: 10px;
        border: 1px solid rgba(0,0,0,0.08);
      }
      .blocker-rule-domain {
        flex: 1;
        font-family: monospace;
        font-size: 0.9rem;
        color: #1f2937;
      }
      .blocker-rule-action {
        font-size: 0.8rem;
        color: #6b7280;
        padding: 4px 10px;
        background: rgba(0,0,0,0.05);
        border-radius: 6px;
      }
      .blocker-rule-action.block {
        background: rgba(239, 68, 68, 0.1);
        color: #dc2626;
      }
      .blocker-rule-action.redirect {
        background: rgba(59, 130, 246, 0.1);
        color: #2563eb;
      }
      .blocker-rule-toggle {
        width: 44px;
        height: 24px;
        background: #e5e7eb;
        border-radius: 12px;
        position: relative;
        cursor: pointer;
        transition: background 0.2s;
      }
      .blocker-rule-toggle.active {
        background: #22c55e;
      }
      .blocker-rule-toggle::after {
        content: "";
        position: absolute;
        width: 20px;
        height: 20px;
        background: white;
        border-radius: 50%;
        top: 2px;
        left: 2px;
        transition: transform 0.2s;
        box-shadow: 0 2px 4px rgba(0,0,0,0.15);
      }
      .blocker-rule-toggle.active::after {
        transform: translateX(20px);
      }
      .blocker-rule-delete {
        background: transparent;
        border: none;
        color: #9ca3af;
        cursor: pointer;
        padding: 6px;
        font-size: 1.2rem;
        line-height: 1;
        border-radius: 6px;
        transition: color 0.2s, background 0.2s;
      }
      .blocker-rule-delete:hover {
        color: #ef4444;
        background: rgba(239, 68, 68, 0.1);
      }
      
      /* Focus mode start panel */
      .focus-start-panel {
        background: linear-gradient(135deg, rgba(200, 16, 60, 0.05), rgba(225, 29, 72, 0.05));
        border: 1px solid rgba(200, 16, 60, 0.2);
        border-radius: 16px;
        padding: 20px;
        margin-bottom: 20px;
      }
      .focus-start-title {
        font-size: 1rem;
        font-weight: 600;
        color: #c8103c;
        margin: 0 0 12px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .focus-duration-buttons {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .focus-duration-btn {
        padding: 8px 16px;
        border: 1px solid rgba(200, 16, 60, 0.3);
        background: white;
        border-radius: 8px;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.2s;
      }
      .focus-duration-btn:hover {
        background: #c8103c;
        color: white;
        border-color: #c8103c;
      }
      .focus-duration-btn.active {
        background: #c8103c;
        color: white;
        border-color: #c8103c;
      }
    `;
    document.head.appendChild(style);
  }

  // Initialize with rules from state
  init(rules = []) {
    this.rules = rules.map(r => ({
      ...r,
      enabled: r.enabled !== false,
      id: r.id || `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }));
    this.createBlockerUI();
    this.startMonitoring();
  }

  // Create the blocker UI elements
  createBlockerUI() {
    // Focus mode indicator
    if (!document.getElementById("focus-mode-indicator")) {
      const indicator = document.createElement("div");
      indicator.id = "focus-mode-indicator";
      indicator.className = "focus-mode-indicator hidden";
      indicator.innerHTML = `
        <span class="focus-mode-dot"></span>
        <span>Focus Mode</span>
        <span class="focus-mode-timer"></span>
      `;
      document.body.appendChild(indicator);
    }

    // Blocker badge (shows blocked attempts)
    if (!document.getElementById("blocker-badge")) {
      const badge = document.createElement("div");
      badge.id = "blocker-badge";
      badge.className = "blocker-badge hidden";
      badge.innerHTML = `
        <span class="blocker-badge-icon">🛡️</span>
        <span class="blocker-badge-text">Blocking active</span>
      `;
      badge.addEventListener("click", () => this.showBlockedAttempts());
      document.body.appendChild(badge);
    }
  }

  // Start monitoring for blocked sites
  startMonitoring() {
    if (this.checkInterval) return;
    
    // Check every second for focus mode timer and update UI
    this.checkInterval = setInterval(() => {
      this.updateFocusModeUI();
    }, 1000);
    
    this.isActive = true;
    this.updateBadge();
  }

  // Stop monitoring
  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isActive = false;
    this.updateBadge();
  }

  // Add a blocking rule
  addRule(domain, action = "block", redirectUrl = "", enabled = true) {
    const rule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      domain: this.normalizeDomain(domain),
      action,
      redirectUrl,
      enabled
    };
    this.rules.push(rule);
    return rule;
  }

  // Remove a rule
  removeRule(ruleId) {
    this.rules = this.rules.filter(r => r.id !== ruleId);
  }

  // Toggle a rule
  toggleRule(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.enabled = !rule.enabled;
    }
    return rule;
  }

  // Normalize domain
  normalizeDomain(domain) {
    return domain
      .toLowerCase()
      .replace(/^(https?:\/\/)?/, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
      .trim();
  }

  // Check if a URL should be blocked
  shouldBlock(url) {
    if (!url || !this.isActive) return null;
    
    const domain = this.normalizeDomain(url);
    
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      
      // Check if domain matches (supports wildcards)
      const pattern = rule.domain.replace(/\*/g, ".*");
      const regex = new RegExp(`^${pattern}$|\.${pattern}$`, "i");
      
      if (regex.test(domain) || domain.includes(rule.domain)) {
        return rule;
      }
    }
    return null;
  }

  // Record a blocked attempt
  recordBlockedAttempt(url, rule) {
    this.blockedAttempts.push({
      url,
      rule: rule.domain,
      action: rule.action,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 100 attempts
    if (this.blockedAttempts.length > 100) {
      this.blockedAttempts = this.blockedAttempts.slice(-100);
    }
    
    this.updateBadge();
  }

  // Update badge visibility and text
  updateBadge() {
    const badge = document.getElementById("blocker-badge");
    if (!badge) return;
    
    const enabledRules = this.rules.filter(r => r.enabled).length;
    
    if (enabledRules > 0 && this.isActive) {
      badge.classList.remove("hidden");
      badge.querySelector(".blocker-badge-text").textContent = 
        `${enabledRules} site${enabledRules > 1 ? "s" : ""} blocked`;
    } else {
      badge.classList.add("hidden");
    }
  }

  // Show blocked attempts history
  showBlockedAttempts() {
    const recent = this.blockedAttempts.slice(-10).reverse();
    if (recent.length === 0) {
      alert("No blocked attempts recorded yet.");
      return;
    }
    
    const list = recent.map(a => 
      `• ${a.url} (${a.action}) at ${new Date(a.timestamp).toLocaleTimeString()}`
    ).join("\n");
    
    alert(`Recent blocked attempts:\n\n${list}`);
  }

  // Start focus mode
  startFocusMode(durationMinutes) {
    this.focusMode = true;
    this.focusModeEndTime = Date.now() + (durationMinutes * 60 * 1000);
    
    // Enable all blocking rules during focus mode
    this.rules.forEach(r => r.enabled = true);
    this.isActive = true;
    
    this.updateFocusModeUI();
    this.updateBadge();
    
    // Store in localStorage so it persists across page refreshes
    localStorage.setItem("axis_focus_mode", JSON.stringify({
      active: true,
      endTime: this.focusModeEndTime
    }));
    
    return this.focusModeEndTime;
  }

  // Stop focus mode
  stopFocusMode() {
    this.focusMode = false;
    this.focusModeEndTime = null;
    
    localStorage.removeItem("axis_focus_mode");
    this.updateFocusModeUI();
  }

  // Restore focus mode from localStorage
  restoreFocusMode() {
    const stored = localStorage.getItem("axis_focus_mode");
    if (!stored) return false;
    
    try {
      const data = JSON.parse(stored);
      if (data.active && data.endTime > Date.now()) {
        this.focusMode = true;
        this.focusModeEndTime = data.endTime;
        this.isActive = true;
        this.updateFocusModeUI();
        return true;
      } else {
        localStorage.removeItem("axis_focus_mode");
      }
    } catch (e) {
      localStorage.removeItem("axis_focus_mode");
    }
    return false;
  }

  // Update focus mode UI
  updateFocusModeUI() {
    const indicator = document.getElementById("focus-mode-indicator");
    if (!indicator) return;
    
    if (this.focusMode && this.focusModeEndTime) {
      const remaining = this.focusModeEndTime - Date.now();
      
      if (remaining <= 0) {
        this.stopFocusMode();
        return;
      }
      
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      const timer = indicator.querySelector(".focus-mode-timer");
      if (timer) {
        timer.textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;
      }
      
      indicator.classList.remove("hidden");
    } else {
      indicator.classList.add("hidden");
    }
  }

  // Show blocked page overlay
  showBlockedOverlay(url, rule) {
    // Don't show overlay on our own app
    if (window.location.hostname === "localhost") return;
    
    const existing = document.getElementById("blocked-overlay");
    if (existing) existing.remove();
    
    const motivationalQuotes = [
      "The secret of getting ahead is getting started. – Mark Twain",
      "Focus on being productive instead of busy. – Tim Ferriss",
      "It's not that I'm so smart, it's just that I stay with problems longer. – Einstein",
      "The way to get started is to quit talking and begin doing. – Walt Disney",
      "Don't watch the clock; do what it does. Keep going. – Sam Levenson"
    ];
    
    const quote = motivationalQuotes[Math.floor(Math.random() * motivationalQuotes.length)];
    
    const overlay = document.createElement("div");
    overlay.id = "blocked-overlay";
    overlay.className = "blocked-overlay";
    overlay.innerHTML = `
      <div class="blocked-icon">🚫</div>
      <h1 class="blocked-title">Site Blocked</h1>
      <p class="blocked-message">
        This site is on your blocked list. Stay focused on your goals!
      </p>
      <div class="blocked-domain">${this.normalizeDomain(url)}</div>
      <div class="blocked-actions">
        <button class="blocked-btn blocked-btn-primary" id="blocked-go-back">
          Go Back to Work
        </button>
        ${rule.action === "redirect" && rule.redirectUrl ? `
          <button class="blocked-btn blocked-btn-secondary" id="blocked-redirect">
            Go to ${rule.redirectUrl}
          </button>
        ` : ""}
      </div>
      <p class="blocked-quote">"${quote}"</p>
    `;
    
    document.body.appendChild(overlay);
    
    document.getElementById("blocked-go-back")?.addEventListener("click", () => {
      window.history.back();
      setTimeout(() => {
        if (document.getElementById("blocked-overlay")) {
          window.location.href = "/dashboard.html";
        }
      }, 100);
    });
    
    document.getElementById("blocked-redirect")?.addEventListener("click", () => {
      if (rule.redirectUrl) {
        window.location.href = rule.redirectUrl.startsWith("http") 
          ? rule.redirectUrl 
          : `https://${rule.redirectUrl}`;
      }
    });
    
    this.recordBlockedAttempt(url, rule);
  }

  // Get rules
  getRules() {
    return this.rules;
  }

  // Set rules
  setRules(rules) {
    this.rules = rules;
    this.updateBadge();
  }

  // Check if focus mode is active
  isFocusModeActive() {
    return this.focusMode && this.focusModeEndTime > Date.now();
  }

  // Get remaining focus time
  getRemainingFocusTime() {
    if (!this.focusMode || !this.focusModeEndTime) return 0;
    return Math.max(0, this.focusModeEndTime - Date.now());
  }

  // Render rules list for settings panel
  renderRulesHTML() {
    if (this.rules.length === 0) {
      return `<p class="settings-description">No blocking rules configured. Add sites to block during focus time.</p>`;
    }
    
    return this.rules.map(rule => `
      <div class="blocker-rule-item" data-rule-id="${rule.id}">
        <span class="blocker-rule-domain">${rule.domain}</span>
        <span class="blocker-rule-action ${rule.action}">${rule.action}</span>
        <div class="blocker-rule-toggle ${rule.enabled ? 'active' : ''}" 
             data-toggle-rule="${rule.id}" 
             title="${rule.enabled ? 'Disable' : 'Enable'} rule">
        </div>
        <button class="blocker-rule-delete" data-delete-rule="${rule.id}" title="Delete rule">×</button>
      </div>
    `).join("");
  }

  // Render focus mode start panel
  renderFocusPanelHTML() {
    if (this.isFocusModeActive()) {
      const remaining = this.getRemainingFocusTime();
      const minutes = Math.floor(remaining / 60000);
      return `
        <div class="focus-start-panel">
          <h4 class="focus-start-title">🎯 Focus Mode Active</h4>
          <p style="margin: 0; color: #6b7280;">
            ${minutes} minutes remaining. All distracting sites are blocked.
          </p>
          <button class="btn btn-ghost" style="margin-top: 12px;" id="stop-focus-mode">
            End Focus Mode Early
          </button>
        </div>
      `;
    }
    
    return `
      <div class="focus-start-panel">
        <h4 class="focus-start-title">🎯 Start Focus Mode</h4>
        <p style="margin: 0 0 12px; color: #6b7280; font-size: 0.85rem;">
          Block all distracting sites for a set duration.
        </p>
        <div class="focus-duration-buttons">
          <button class="focus-duration-btn" data-focus-duration="25">25 min</button>
          <button class="focus-duration-btn" data-focus-duration="45">45 min</button>
          <button class="focus-duration-btn" data-focus-duration="60">1 hour</button>
          <button class="focus-duration-btn" data-focus-duration="90">1.5 hours</button>
        </div>
      </div>
    `;
  }
}

export const blocker = new WebsiteBlocker();
