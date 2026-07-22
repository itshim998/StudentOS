(() => {
  const LOGO_URL = "https://i.ibb.co/Y7q4YRF9/Student-OS-logo.png";
  const SIGNIN_COPY = {
    title: "Welcome back",
    body: "Sign in to continue to your academic workspace.",
    action: "Sign in",
  };
  const SIGNUP_COPY = {
    title: "Create your StudentOS account",
    body: "Start with your student email. Your workspace will be prepared after verification.",
    action: "Create account",
  };
  const GENERIC_SESSION_MESSAGES = new Set([
    "",
    "Ready to sign in",
    "Local preview",
  ]);
  const GENERIC_HELP_MESSAGES = new Set([
    "",
    "Create an account or sign in. Email verification may be required.",
    "Local preview keeps account actions available without contacting live sign-in.",
  ]);

  function currentMode() {
    const hash = window.location.hash.toLowerCase();
    if (hash === "#signup") return "signup";
    const title = document.getElementById("auth-shell-title")?.textContent || "";
    return /create/i.test(title) ? "signup" : "signin";
  }

  function setHashForMode(mode) {
    const nextHash = mode === "signup" ? "#signup" : "#login";
    if (window.location.hash.toLowerCase() === nextHash) {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      return;
    }
    window.location.hash = nextHash;
  }

  function createBrandMarkup() {
    return `
      <div class="auth-brand-lockup-v2">
        <span class="auth-logo-frame">
          <img class="auth-logo-image" src="${LOGO_URL}" width="76" height="76" alt="StudentOS logo" decoding="async" referrerpolicy="no-referrer">
          <span class="auth-logo-fallback" aria-hidden="true">SO</span>
        </span>
        <span class="auth-brand-name">
          <strong>StudentOS</strong>
          <small>Academic operating layer</small>
        </span>
      </div>
      <div class="auth-hero-copy auth-hero-copy-v2">
        <p class="eyebrow">Your private academic workspace</p>
        <h2>Know what to study next.</h2>
        <p class="auth-hero-lead">StudentOS brings your schedule, course material, and academic progress into one clear workspace.</p>
      </div>
      <div class="auth-capability-list" aria-label="StudentOS capabilities">
        <p><span aria-hidden="true">01</span>A focused plan for today</p>
        <p><span aria-hidden="true">02</span>Course context that stays with you</p>
        <p><span aria-hidden="true">03</span>Recovery built around what you actually struggle with</p>
      </div>
      <p class="auth-privacy-note"><span aria-hidden="true"></span>Your academic workspace stays private to your account.</p>
    `;
  }

  function createModeTabs() {
    const tabs = document.createElement("div");
    tabs.className = "auth-mode-tabs auth-mode-tabs-v2";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Choose account action");
    tabs.innerHTML = `
      <button type="button" class="auth-mode-tab" data-auth-mode="signin" role="tab" aria-controls="auth-form">Sign in</button>
      <button type="button" class="auth-mode-tab" data-auth-mode="signup" role="tab" aria-controls="auth-form">Create account</button>
    `;
    tabs.querySelectorAll("[data-auth-mode]").forEach((button) => {
      button.addEventListener("click", () => setHashForMode(button.dataset.authMode));
    });
    return tabs;
  }

  function ensureFieldError(field, id) {
    let error = document.getElementById(id);
    if (!error) {
      error = document.createElement("p");
      error.id = id;
      error.className = "auth-field-error";
      error.setAttribute("role", "alert");
      error.hidden = true;
      field.append(error);
    }
    return error;
  }

  function setFieldError(input, errorElement, message = "") {
    const active = Boolean(message);
    input.setAttribute("aria-invalid", active ? "true" : "false");
    errorElement.textContent = message;
    errorElement.hidden = !active;
  }

  function enhancePasswordField(passwordField, forgotButton) {
    const label = passwordField.querySelector("label");
    const input = passwordField.querySelector("input");
    if (!label || !input) return;

    const labelRow = document.createElement("div");
    labelRow.className = "auth-label-row";
    label.replaceWith(labelRow);
    labelRow.append(label);
    if (forgotButton) labelRow.append(forgotButton);

    const control = document.createElement("div");
    control.className = "auth-password-control";
    input.replaceWith(control);
    control.append(input);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "auth-password-toggle";
    toggle.setAttribute("aria-label", "Show password");
    toggle.setAttribute("aria-pressed", "false");
    toggle.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M2.8 12s3.1-5 9.2-5 9.2 5 9.2 5-3.1 5-9.2 5-9.2-5-9.2-5Z"></path>
        <circle cx="12" cy="12" r="2.6"></circle>
      </svg>
    `;
    toggle.addEventListener("click", () => {
      const revealing = input.type === "password";
      input.type = revealing ? "text" : "password";
      toggle.setAttribute("aria-label", revealing ? "Hide password" : "Show password");
      toggle.setAttribute("aria-pressed", revealing ? "true" : "false");
      input.focus({ preventScroll: true });
    });
    control.append(toggle);
  }

  function updateModePresentation(panel, submitButton, passwordInput) {
    const mode = currentMode();
    const copy = mode === "signup" ? SIGNUP_COPY : SIGNIN_COPY;
    const title = panel.querySelector("#auth-shell-title");
    const body = panel.querySelector("#auth-shell-copy");

    if (title && title.textContent !== copy.title) title.textContent = copy.title;
    if (body && body.textContent !== copy.body) body.textContent = copy.body;
    if (passwordInput) passwordInput.autocomplete = mode === "signup" ? "new-password" : "current-password";
    if (submitButton && !submitButton.classList.contains("is-loading")) submitButton.textContent = copy.action;

    panel.querySelectorAll("[data-auth-mode]").forEach((button) => {
      const active = button.dataset.authMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.setAttribute("tabindex", active ? "0" : "-1");
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function updateStatusPresentation(panel, submitButton) {
    const session = panel.querySelector("#auth-session");
    const help = panel.querySelector("#auth-help");
    const message = panel.querySelector("#auth-message");
    const result = panel.querySelector("#auth-result");
    if (!session || !help || !message || !result || !submitButton) return;

    const sessionText = session.textContent.trim();
    const helpText = help.textContent.trim();
    const messageText = message.textContent.trim();
    const loading = /^(Signing in|Creating account)\.\.\.$/i.test(sessionText);

    session.hidden = GENERIC_SESSION_MESSAGES.has(sessionText);
    help.hidden = GENERIC_HELP_MESSAGES.has(helpText);
    message.hidden = !messageText;
    result.hidden = session.hidden && help.hidden && message.hidden;
    result.dataset.state = loading ? "loading" : /invalid|couldn|failed|unavailable|expired|too many/i.test(`${sessionText} ${messageText}`) ? "error" : "notice";

    submitButton.classList.toggle("is-loading", loading);
    submitButton.disabled = loading;
    submitButton.setAttribute("aria-busy", loading ? "true" : "false");
    submitButton.textContent = loading
      ? (currentMode() === "signup" ? "Creating account..." : "Signing in...")
      : (currentMode() === "signup" ? SIGNUP_COPY.action : SIGNIN_COPY.action);
  }

  function wireKeyboardTabs(panel) {
    const tabs = [...panel.querySelectorAll("[data-auth-mode]")];
    tabs.forEach((tab, index) => {
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const targetIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : event.key === "ArrowLeft"
              ? (index - 1 + tabs.length) % tabs.length
              : (index + 1) % tabs.length;
        tabs[targetIndex].focus();
        tabs[targetIndex].click();
      });
    });
  }

  function initializeAuthRedesign() {
    const shell = document.getElementById("public-auth-shell");
    const content = shell?.querySelector(".public-auth-content");
    const brand = shell?.querySelector(".public-auth-brand");
    const panel = shell?.querySelector("#auth-panel");
    const form = panel?.querySelector("#auth-form");
    const emailInput = panel?.querySelector("#auth-email");
    const passwordInput = panel?.querySelector("#auth-password");
    const submitButton = panel?.querySelector("#signin-btn");
    const signupButton = panel?.querySelector("#signup-btn");
    const forgotButton = panel?.querySelector("#password-reset-btn");
    if (!shell || !content || !brand || !panel || !form || !emailInput || !passwordInput || !submitButton) return;
    if (shell.dataset.authRedesignReady === "true") return;

    shell.dataset.authRedesignReady = "true";
    shell.classList.add("public-auth-shell-v2");
    content.classList.add("public-auth-content-v2");
    panel.classList.add("public-auth-panel-v2");
    document.body.classList.add("auth-redesign-ready");

    brand.innerHTML = createBrandMarkup();
    const logo = brand.querySelector(".auth-logo-image");
    logo?.addEventListener("load", () => logo.closest(".auth-logo-frame")?.classList.add("has-image"), { once: true });
    logo?.addEventListener("error", () => logo.closest(".auth-logo-frame")?.classList.add("image-failed"), { once: true });

    const heading = panel.querySelector(".auth-panel-heading");
    const tabs = createModeTabs();
    heading?.before(tabs);
    wireKeyboardTabs(panel);

    emailInput.required = true;
    emailInput.inputMode = "email";
    emailInput.autocapitalize = "none";
    emailInput.spellcheck = false;
    emailInput.setAttribute("aria-describedby", "auth-email-error");
    passwordInput.required = true;
    passwordInput.setAttribute("aria-describedby", "auth-password-error");

    const emailField = emailInput.closest(".auth-field");
    const passwordField = passwordInput.closest(".auth-field");
    const emailError = emailField ? ensureFieldError(emailField, "auth-email-error") : null;
    const passwordError = passwordField ? ensureFieldError(passwordField, "auth-password-error") : null;
    enhancePasswordField(passwordField, forgotButton);

    const footer = panel.querySelector(".auth-card-footer");
    if (footer) {
      footer.hidden = true;
      footer.setAttribute("aria-hidden", "true");
    }
    if (signupButton) signupButton.tabIndex = -1;

    const trust = document.createElement("p");
    trust.className = "auth-form-trust";
    trust.innerHTML = `<span aria-hidden="true"></span>Secure access to your private StudentOS workspace.`;
    panel.append(trust);

    form.addEventListener("submit", (event) => {
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const emailMessage = !email
        ? "Enter your email address."
        : !emailInput.validity.valid
          ? "Enter a valid email address."
          : "";
      const passwordMessage = !password ? "Enter your password." : "";
      if (emailError) setFieldError(emailInput, emailError, emailMessage);
      if (passwordError) setFieldError(passwordInput, passwordError, passwordMessage);
      if (emailMessage || passwordMessage) {
        event.preventDefault();
        event.stopImmediatePropagation();
        (emailMessage ? emailInput : passwordInput).focus();
      }
    }, true);

    emailInput.addEventListener("input", () => {
      if (emailError) setFieldError(emailInput, emailError, "");
    });
    passwordInput.addEventListener("input", () => {
      if (passwordError) setFieldError(passwordInput, passwordError, "");
    });

    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(() => {
        updateModePresentation(panel, submitButton, passwordInput);
        updateStatusPresentation(panel, submitButton);
      });
    });
    observer.observe(panel, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });

    window.addEventListener("hashchange", () => {
      window.requestAnimationFrame(() => updateModePresentation(panel, submitButton, passwordInput));
    });

    updateModePresentation(panel, submitButton, passwordInput);
    updateStatusPresentation(panel, submitButton);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeAuthRedesign, { once: true });
  } else {
    initializeAuthRedesign();
  }
})();
