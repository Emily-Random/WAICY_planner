document.addEventListener("DOMContentLoaded", async () => {
  const dashboardEl = document.getElementById("dashboard");
  if (!dashboardEl) return;

  const token = getAuthToken();
  if (!token) {
    window.location.replace("index.html");
    return;
  }

  // Restore current user from storage (used in settings UI)
  try {
    currentUser = JSON.parse(localStorage.getItem(STORAGE_USER_KEY) || "null");
  } catch {
    currentUser = null;
  }

  // Restore onboarding flags (set during signup flow on index.html)
  const isGuest = token.startsWith("guest_");
  if (isGuest) {
    onboardingMode = null;
    shouldShowOnboarding = false;
    localStorage.removeItem("planwise_should_show_onboarding");
    localStorage.removeItem("planwise_onboarding_mode");
  } else {
    shouldShowOnboarding = localStorage.getItem("planwise_should_show_onboarding") === "1";
    onboardingMode = localStorage.getItem("planwise_onboarding_mode") || null;
  }

  const ok = await loadUserData();
  if (!ok) {
    window.location.replace("index.html");
    return;
  }

  showView("dashboard");
  initAuth(); // includes logout/settings handlers used on dashboard

  if (isGuest) {
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.title = "Login";
      logoutBtn.setAttribute("aria-label", "Login");
      logoutBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 3h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5"/>
          <path d="M7 7l-4 4 4 4"/>
          <path d="M3 11h10"/>
        </svg>
      `.trim();
    }
  }

  initDashboard();
  window.AxisNotifications?.init?.();
  window.AxisOnboardingTour?.maybeStart?.();
});
