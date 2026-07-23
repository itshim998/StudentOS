(() => {
  function isSignupMode() {
    if (window.location.hash.toLowerCase() === "#signup") return true;
    return /create/i.test(document.getElementById("auth-shell-title")?.textContent || "");
  }

  function syncSubmitAccessibleName() {
    const submitButton = document.getElementById("signin-btn");
    if (!submitButton) return;
    submitButton.setAttribute("aria-label", isSignupMode() ? "Create an account" : "Sign in");
  }

  function initialize() {
    syncSubmitAccessibleName();
    window.addEventListener("hashchange", () => window.requestAnimationFrame(syncSubmitAccessibleName));

    const panel = document.getElementById("auth-panel");
    if (!panel) return;
    const observer = new MutationObserver(() => syncSubmitAccessibleName());
    observer.observe(panel, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
