const runtimeApiBase = window.StudentOSRuntimeConfig?.apiBase || window.STUDENTOS_API_BASE || "";

window.StudentOSConfig = {
  apiBase: String(runtimeApiBase || "").trim().replace(/\/+$/, ""),
};

(() => {
  const nativeFetch = window.fetch.bind(window);
  const bootState = {
    backendResponsive: false,
    overlayVisible: false,
    revealStarted: false,
    showTimer: null,
    longWaitTimer: null,
  };
  const SHOW_DELAY_MS = 550;
  const LONG_WAIT_MS = 45_000;
  const MAX_CONFIG_ATTEMPTS = 8;
  const RETRYABLE_STATUS = new Set([408, 425, 502, 503, 504]);

  const style = document.createElement("style");
  style.id = "studentos-backend-boot-styles";
  style.textContent = `
    html.studentos-backend-boot-pending,
    html.studentos-backend-boot-pending body {
      min-height: 100%;
      background: #f1f6f2;
    }

    html.studentos-backend-boot-pending body {
      overflow: hidden;
    }

    html.studentos-backend-boot-pending #public-auth-shell,
    html.studentos-backend-boot-pending #product-flow-shell,
    html.studentos-backend-boot-pending #app-shell {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    .studentos-backend-boot[hidden] {
      display: none !important;
    }

    .studentos-backend-boot {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: grid;
      place-items: center;
      overflow: hidden;
      padding: 24px;
      background:
        radial-gradient(circle at 50% 42%, rgba(255, 255, 255, 0.95) 0, rgba(247, 251, 248, 0.88) 28%, rgba(237, 245, 239, 0.96) 68%),
        #f1f6f2;
      color: #163026;
      opacity: 0;
      transition: opacity 420ms ease;
    }

    .studentos-backend-boot.is-visible {
      opacity: 1;
    }

    .studentos-backend-boot.is-leaving {
      opacity: 0;
    }

    .studentos-backend-boot-content {
      display: grid;
      justify-items: center;
      gap: 22px;
      min-width: min(260px, 82vw);
      text-align: center;
    }

    .studentos-backend-boot-dots {
      position: relative;
      width: 48px;
      height: 48px;
      animation: studentos-backend-boot-rotate 1.35s linear infinite;
    }

    .studentos-backend-boot-dots span {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 6px;
      height: 6px;
      margin: -3px;
      border-radius: 999px;
      background: #246f57;
      opacity: 0.22;
      transform: rotate(calc(var(--dot-index) * 45deg)) translateY(-18px);
      animation: studentos-backend-boot-pulse 1.08s ease-in-out infinite;
      animation-delay: calc(var(--dot-index) * -0.12s);
    }

    .studentos-backend-boot-copy {
      display: inline-block;
      width: 0;
      overflow: hidden;
      border-right: 1px solid rgba(22, 48, 38, 0.55);
      color: #163026;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 0.98rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      line-height: 1.5;
      white-space: nowrap;
      animation:
        studentos-backend-boot-type 1.45s steps(16, end) 120ms forwards,
        studentos-backend-boot-caret 820ms step-end 120ms infinite;
    }

    .studentos-backend-boot-copy.is-static {
      width: auto;
      border-right: 0;
      white-space: normal;
      animation: none;
    }

    .studentos-backend-boot-retry {
      display: none;
      min-height: 40px;
      padding: 0 18px;
      border: 1px solid rgba(36, 111, 87, 0.28);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.72);
      color: #1f604c;
      font: inherit;
      font-size: 0.88rem;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 8px 22px rgba(22, 48, 38, 0.07);
    }

    .studentos-backend-boot.is-taking-longer .studentos-backend-boot-retry {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .studentos-backend-boot-retry:focus-visible {
      outline: 3px solid rgba(47, 156, 123, 0.24);
      outline-offset: 3px;
    }

    @keyframes studentos-backend-boot-rotate {
      to { transform: rotate(360deg); }
    }

    @keyframes studentos-backend-boot-pulse {
      0%, 100% { opacity: 0.18; transform: rotate(calc(var(--dot-index) * 45deg)) translateY(-18px) scale(0.82); }
      45% { opacity: 1; transform: rotate(calc(var(--dot-index) * 45deg)) translateY(-18px) scale(1); }
    }

    @keyframes studentos-backend-boot-type {
      from { width: 0; }
      to { width: 16ch; }
    }

    @keyframes studentos-backend-boot-caret {
      50% { border-color: transparent; }
    }

    @media (prefers-reduced-motion: reduce) {
      .studentos-backend-boot {
        transition: none;
      }

      .studentos-backend-boot-dots,
      .studentos-backend-boot-dots span,
      .studentos-backend-boot-copy {
        animation: none;
      }

      .studentos-backend-boot-copy {
        width: auto;
        border-right: 0;
      }
    }
  `;
  document.head.append(style);

  const overlay = document.createElement("section");
  overlay.id = "studentos-backend-boot";
  overlay.className = "studentos-backend-boot";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.setAttribute("aria-busy", "true");
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="studentos-backend-boot-content">
      <div class="studentos-backend-boot-dots" aria-hidden="true">
        ${Array.from({ length: 8 }, (_, index) => `<span style="--dot-index:${index}"></span>`).join("")}
      </div>
      <span class="studentos-backend-boot-copy">Just a moment...</span>
      <button class="studentos-backend-boot-retry" type="button">Try again</button>
    </div>
  `;
  document.body.append(overlay);

  const bootCopy = overlay.querySelector(".studentos-backend-boot-copy");
  const retryButton = overlay.querySelector(".studentos-backend-boot-retry");

  document.documentElement.classList.add("studentos-backend-boot-pending");

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function requestUrl(input) {
    try {
      const value = typeof input === "string" ? input : input?.url;
      return value ? new URL(value, window.location.href) : null;
    } catch {
      return null;
    }
  }

  function isRuntimeConfigRequest(input) {
    const url = requestUrl(input);
    if (!url) return false;
    return url.pathname === "/api/config" || url.pathname.endsWith("/api/config");
  }

  function showOverlay() {
    if (bootState.backendResponsive || bootState.revealStarted) return;
    bootState.overlayVisible = true;
    overlay.hidden = false;
    window.requestAnimationFrame(() => overlay.classList.add("is-visible"));
  }

  function showLongWaitState() {
    if (bootState.backendResponsive || bootState.revealStarted) return;
    showOverlay();
    overlay.classList.add("is-taking-longer");
    bootCopy.textContent = "StudentOS is taking longer than usual.";
    bootCopy.classList.add("is-static");
  }

  function visibleInterfaceIsReady() {
    const authShell = document.getElementById("public-auth-shell");
    const productFlowShell = document.getElementById("product-flow-shell");
    const appShell = document.getElementById("app-shell");
    if (authShell && !authShell.hidden) return true;
    if (productFlowShell && !productFlowShell.hidden) return true;
    return Boolean(appShell && !appShell.hidden && appShell.getAttribute("aria-busy") !== "true");
  }

  function finishReveal() {
    if (bootState.revealStarted) return;
    bootState.revealStarted = true;
    window.clearTimeout(bootState.showTimer);
    window.clearTimeout(bootState.longWaitTimer);
    document.documentElement.classList.remove("studentos-backend-boot-pending");

    if (!bootState.overlayVisible) {
      overlay.remove();
      return;
    }

    overlay.classList.add("is-leaving");
    overlay.classList.remove("is-visible");
    window.setTimeout(() => overlay.remove(), 460);
  }

  function revealWhenInterfaceIsReady(startedAt = performance.now()) {
    if (visibleInterfaceIsReady() || performance.now() - startedAt > 1800) {
      finishReveal();
      return;
    }
    window.requestAnimationFrame(() => revealWhenInterfaceIsReady(startedAt));
  }

  function markBackendResponsive() {
    if (bootState.backendResponsive) return;
    bootState.backendResponsive = true;
    window.clearTimeout(bootState.longWaitTimer);
    revealWhenInterfaceIsReady();
  }

  async function fetchRuntimeConfigWithWakeRetries(input, init) {
    let lastError = null;
    let lastResponse = null;

    for (let attempt = 0; attempt < MAX_CONFIG_ATTEMPTS; attempt += 1) {
      try {
        const response = await nativeFetch(input, {
          ...init,
          cache: init?.cache || "no-store",
        });
        lastResponse = response;
        if (response.ok) {
          markBackendResponsive();
          return response;
        }
        if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_CONFIG_ATTEMPTS - 1) {
          return response;
        }
      } catch (error) {
        lastError = error;
        if (attempt === MAX_CONFIG_ATTEMPTS - 1) throw error;
      }

      await delay(Math.min(750 + attempt * 500, 4000));
    }

    if (lastResponse) return lastResponse;
    throw lastError || new Error("StudentOS could not connect yet.");
  }

  window.fetch = (input, init) => {
    if (!isRuntimeConfigRequest(input)) return nativeFetch(input, init);
    return fetchRuntimeConfigWithWakeRetries(input, init);
  };

  retryButton.addEventListener("click", () => window.location.reload());
  bootState.showTimer = window.setTimeout(showOverlay, SHOW_DELAY_MS);
  bootState.longWaitTimer = window.setTimeout(showLongWaitState, LONG_WAIT_MS);
})();
