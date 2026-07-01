import { purgeLegacyAcademicCache } from "./migrations/legacyAcademicCache.js";

const API_BASE = window.StudentOSConfig?.apiBase || "";
const PUBLIC_FRONTEND_HOSTS = new Set([
  "studentos.sentiqlabs.com",
  "studentos-39s.pages.dev",
]);
const API_BASE_MISCONFIGURED_MESSAGE = "StudentOS is not connected for this site yet. Please try again later.";
purgeLegacyAcademicCache();

let state = null;
let activeVerb = "Ask";
let runtimeConfig = { auth: { enabled: false } };
let authSession = readStoredSession();
let bootstrapLoaded = false;
let authReturnMessage = "";
let accountSnapshot = null;
let classroomStatus = null;
let classroomStatusLoaded = false;
let aiDrawerReturnFocus = null;
let sourceSearchQuery = "";
let authShellMode = "signin";
let productPersistenceQueue = [];
let productPersistenceRunner = null;
let productPersistenceError = null;
let productUploadTail = Promise.resolve();
let productUploadsPending = 0;
let productClassroomRefreshAttempted = false;
let pendingAcademicContextDeletion = null;
const productUploadResults = new Map();
const ACTION_LOADING_TIMEOUT_MS = 30000;
const LONG_ACTION_LOADING_TIMEOUT_MS = 60000;

const els = {
  publicAuthShell: document.getElementById("public-auth-shell"),
  productFlowShell: document.getElementById("product-flow-shell"),
  productFlowContent: document.getElementById("product-flow-content"),
  productFlowProgress: document.getElementById("product-flow-progress"),
  productSaveStatus: document.getElementById("product-save-status"),
  productFlowLogoutBtn: document.getElementById("product-flow-logout-btn"),
  productFlowAskBtn: document.getElementById("product-flow-ask-btn"),
  productFlowAskResponse: document.getElementById("product-flow-ask-response"),
  appShell: document.getElementById("app-shell"),
  viewTitle: document.getElementById("view-title"),
  creditBalance: document.getElementById("credit-balance"),
  planBadge: document.getElementById("plan-badge"),
  studyRhythm: document.getElementById("study-rhythm"),
  creditEligibility: document.getElementById("credit-eligibility"),
  studentName: document.getElementById("student-name"),
  connectorStatus: document.getElementById("connector-status"),
  classroomPanel: document.getElementById("classroom-panel"),
  classroomConnectBtn: document.getElementById("classroom-connect-btn"),
  classroomSyncBtn: document.getElementById("classroom-sync-btn"),
  classroomDisconnectBtn: document.getElementById("classroom-disconnect-btn"),
  dashboardSummary: document.getElementById("dashboard-summary"),
  onboardingForm: document.getElementById("onboarding-form"),
  onboardingResult: document.getElementById("onboarding-result"),
  roadmapList: document.getElementById("roadmap-list"),
  timetableList: document.getElementById("timetable-list"),
  assignmentList: document.getElementById("assignment-list"),
  coursesGrid: document.getElementById("courses-grid"),
  sourceSearchInput: document.getElementById("source-search-input"),
  sourceList: document.getElementById("source-list"),
  academicContextSummary: document.getElementById("academic-context-summary"),
  sourceCourseSelect: document.getElementById("source-course-select"),
  sourceKindSelect: document.getElementById("source-kind-select"),
  sourceDeadlineField: document.getElementById("source-deadline-field"),
  sourceDeadline: document.getElementById("source-deadline"),
  sourceSubmitButton: document.getElementById("source-submit-button"),
  sourceFile: document.getElementById("source-file"),
  sourceCapacityMessage: document.getElementById("source-capacity-message"),
  sourceResult: document.getElementById("source-result"),
  academicContextDeleteDialog: document.getElementById("academic-context-delete-dialog"),
  academicContextDeleteCancel: document.getElementById("academic-context-delete-cancel"),
  academicContextDeleteConfirm: document.getElementById("academic-context-delete-confirm"),
  scoreTopicSelect: document.getElementById("score-topic-select"),
  extensionAssignmentSelect: document.getElementById("extension-assignment-select"),
  flowAssignmentSelect: document.getElementById("flow-assignment-select"),
  aiForm: document.getElementById("ai-form"),
  aiMessage: document.getElementById("ai-message"),
  aiResponse: document.getElementById("ai-response"),
  contractResult: document.getElementById("contract-result"),
  flowResult: document.getElementById("flow-result"),
  scoreResult: document.getElementById("score-result"),
  lessonResult: document.getElementById("lesson-result"),
  extensionResult: document.getElementById("extension-result"),
  signinBtn: document.getElementById("signin-btn"),
  authForm: document.getElementById("auth-form"),
  signupBtn: document.getElementById("signup-btn"),
  passwordResetBtn: document.getElementById("password-reset-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  authResult: document.getElementById("auth-result"),
  authSession: document.getElementById("auth-session"),
  authHelp: document.getElementById("auth-help"),
  authMessage: document.getElementById("auth-message"),
  authModeLabel: document.getElementById("auth-mode-label"),
  authShellTitle: document.getElementById("auth-shell-title"),
  authShellCopy: document.getElementById("auth-shell-copy"),
  railSessionStatus: document.getElementById("rail-session-status"),
  railSessionHelp: document.getElementById("rail-session-help"),
  accountSummary: document.getElementById("account-summary"),
  quotaPanel: document.getElementById("quota-panel"),
  accountResetForm: document.getElementById("account-reset-form"),
  accountResetEmail: document.getElementById("account-reset-email"),
  passwordResetResult: document.getElementById("password-reset-result"),
  verificationResendForm: document.getElementById("verification-resend-form"),
  verificationEmail: document.getElementById("verification-email"),
  verificationResult: document.getElementById("verification-result"),
  legalStatus: document.getElementById("legal-status"),
  legalAcceptCheck: document.getElementById("legal-accept-check"),
  legalAcceptBtn: document.getElementById("legal-accept-btn"),
  legalResult: document.getElementById("legal-result"),
  consentForm: document.getElementById("consent-form"),
  consentWithdrawBtn: document.getElementById("consent-withdraw-btn"),
  consentResult: document.getElementById("consent-result"),
  exportRequestBtn: document.getElementById("export-request-btn"),
  deletionRequestBtn: document.getElementById("deletion-request-btn"),
  accountActionResult: document.getElementById("account-action-result"),
  accountLifecycleStatus: document.getElementById("account-lifecycle-status"),
  guardianPreviewBtn: document.getElementById("guardian-preview-btn"),
  invitationResult: document.getElementById("invitation-result"),
  upgradeBtn: document.getElementById("upgrade-btn"),
  manageBillingBtn: document.getElementById("manage-billing-btn"),
  pricingSection: document.getElementById("pricing"),
  pricingPanel: document.getElementById("pricing-panel"),
  aiLauncher: document.getElementById("ai-launcher"),
  aiPanel: document.getElementById("ai-panel"),
  aiCloseBtn: document.getElementById("ai-close-btn"),
  aiScrim: document.getElementById("ai-scrim"),
};

function readStoredSession() {
  try {
    return JSON.parse(sessionStorage.getItem("studentos.auth.session") || "null");
  } catch {
    return null;
  }
}

function storeSession(session) {
  const previousToken = authSession?.access_token || "";
  authSession = session?.access_token ? session : null;
  if ((authSession?.access_token || "") !== previousToken) {
    state = null;
    accountSnapshot = null;
    bootstrapLoaded = false;
  }
  if (authSession) {
    sessionStorage.setItem("studentos.auth.session", JSON.stringify(authSession));
  } else {
    sessionStorage.removeItem("studentos.auth.session");
  }
}

function decodeAuthUser(accessToken) {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const claims = JSON.parse(atob(normalized));
    return {
      id: claims.sub || null,
      email: claims.email || null,
    };
  } catch {
    return null;
  }
}

function captureAuthReturnSession() {
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = fragment.get("access_token") || query.get("access_token") || "";
  const refreshToken = fragment.get("refresh_token") || query.get("refresh_token") || "";
  const authError = fragment.get("error_description") || query.get("error_description") || fragment.get("error") || query.get("error") || "";
  const hasAuthReturn = Boolean(accessToken || refreshToken || authError || fragment.get("expires_in") || query.get("expires_in"));
  if (!hasAuthReturn) return false;

  if (accessToken) {
    const expiresIn = Number(fragment.get("expires_in") || query.get("expires_in") || 0);
    const expiresAt = Number(fragment.get("expires_at") || query.get("expires_at") || 0);
    storeSession({
      access_token: accessToken,
      refresh_token: refreshToken || undefined,
      token_type: fragment.get("token_type") || query.get("token_type") || "bearer",
      expires_in: expiresIn || undefined,
      expires_at: expiresAt || (expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined),
      user: decodeAuthUser(accessToken) || undefined,
    });
    authReturnMessage = "Email verified. Continue your StudentOS setup.";
  } else {
    storeSession(null);
    authReturnMessage = "This sign-in link is incomplete or has expired. Request a fresh link and try again.";
  }
  history.replaceState(null, "", "/");
  return true;
}

function setText(element, value) {
  if (element) element.textContent = value;
}

function loadingMarkup(copy) {
  return `
    <div class="loading-row" role="status" aria-live="polite">
      <span class="loading-spinner" aria-hidden="true"></span>
      <span>${escapeHtml(copy)}</span>
    </div>
  `;
}

function loadingCardMarkup(copy, className = "item-card loading-card") {
  return `<article class="${escapeHtml(className)}" role="status" aria-live="polite">${loadingMarkup(copy)}</article>`;
}

function messageCardMarkup(title, copy, className = "item-card") {
  return `
    <article class="${escapeHtml(className)}">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(copy)}</p>
    </article>
  `;
}

function setLoading(target, copy, options = {}) {
  if (!target) return;
  target.setAttribute("aria-busy", "true");
  target.innerHTML = options.card
    ? loadingCardMarkup(copy, options.cardClass)
    : loadingMarkup(copy);
}

function setResult(target, html) {
  if (!target) return;
  target.removeAttribute("aria-busy");
  target.innerHTML = html;
}

function setAppLoading(isLoading) {
  if (!els.appShell) return;
  if (isLoading) {
    els.appShell.setAttribute("aria-busy", "true");
  } else {
    els.appShell.removeAttribute("aria-busy");
  }
}

function buttonLoadingMarkup(copy) {
  return `
    <span class="button-loading">
      <span class="button-spinner" aria-hidden="true"></span>
      <span>${escapeHtml(copy)}</span>
    </span>
  `;
}

function restoreButton(button, previous) {
  if (!button || !previous) return;
  button.innerHTML = previous.html;
  button.disabled = previous.disabled;
  if (previous.ariaBusy === null) button.removeAttribute("aria-busy");
  else button.setAttribute("aria-busy", previous.ariaBusy);
}

async function withButtonLoading(button, label, action, options = {}) {
  if (!button) return action();
  const previous = {
    html: button.innerHTML,
    disabled: button.disabled,
    ariaBusy: button.getAttribute("aria-busy"),
  };
  let settled = false;
  const timeoutMs = options.timeoutMs || ACTION_LOADING_TIMEOUT_MS;
  const timeoutId = window.setTimeout(() => {
    if (settled) return;
    restoreButton(button, previous);
    if (options.timeoutTarget) {
      setResult(options.timeoutTarget, `<p>${escapeHtml(options.timeoutCopy || "This is taking longer than expected. You can try again.")}</p>`);
    }
  }, timeoutMs);
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML = buttonLoadingMarkup(label);
  try {
    return await action();
  } finally {
    settled = true;
    window.clearTimeout(timeoutId);
    restoreButton(button, previous);
  }
}

function renderWorkspaceLoading(copy = "Loading your workspace...") {
  setAppLoading(true);
  setLoading(els.dashboardSummary, copy, { card: true, cardClass: "today-brief-card loading-card" });
  setLoading(els.roadmapList, "Loading your study list...", { card: true });
  setLoading(els.timetableList, "Loading your schedule...", { card: true });
  setLoading(els.classroomPanel, "Checking Classroom status...");
  updateClassroomActions(statusPendingClassroomConnector());
  setLoading(els.assignmentList, "Loading due work...", { card: true });
}

function renderWorkspaceLoadError(error) {
  const fallback = "StudentOS could not load your workspace. Refresh and try again.";
  if (productSetupActive() && els.productFlowContent) {
    els.productFlowContent.innerHTML = messageCardMarkup("Setup unavailable", "StudentOS could not load your setup. Refresh and try again.");
  }
  setAppLoading(false);
  setResult(els.dashboardSummary, `
    <article class="today-brief-card">
      <div class="today-brief-copy">
        <p class="eyebrow">Workspace</p>
        <h3><span>Load issue</span>${escapeHtml(fallback)}</h3>
      </div>
    </article>
  `);
  setResult(els.roadmapList, messageCardMarkup("Study list unavailable", "Refresh and try again."));
  setResult(els.timetableList, messageCardMarkup("Schedule unavailable", "Refresh and try again."));
  setResult(els.assignmentList, messageCardMarkup("Due work unavailable", "Refresh and try again."));
  setResult(els.classroomPanel, `<p>${escapeHtml(fallback)}</p>`);
  setResult(els.aiResponse, `<p>${escapeHtml(error?.message || fallback)}</p>`);
}

function authGateActive() {
  return Boolean(productionAuthUnavailable() || (runtimeConfig.auth?.enabled && !authSession?.access_token));
}

function lifecycleDashboardReady(lifecycle = state?.productLifecycle) {
  return Boolean(
    lifecycle?.dashboardActive === true &&
    lifecycle.state === "dashboard_active" &&
    productPlan(lifecycle.selectedPlanId) &&
    lifecycle.paymentMethodVerified === true &&
    lifecycle.legalConsentComplete === true &&
    lifecycle.workspaceReady === true &&
    lifecycle.nextStep === "dashboard"
  );
}

function productSetupActive() {
  const authenticated = Boolean(authSession?.access_token);
  if (authenticated && !bootstrapLoaded) return true;
  if (authenticated && !state?.productLifecycle) return true;
  return Boolean(state?.productLifecycle && !lifecycleDashboardReady());
}

function updateShellVisibility() {
  const showPublicAuth = authGateActive();
  const showProductFlow = !showPublicAuth && productSetupActive();
  if (els.publicAuthShell) {
    els.publicAuthShell.hidden = !showPublicAuth;
  }
  if (els.productFlowShell) {
    els.productFlowShell.hidden = !showProductFlow;
  }
  if (els.appShell) {
    els.appShell.hidden = showPublicAuth || showProductFlow;
  }
  document.body.classList.toggle("auth-shell-active", showPublicAuth);
  document.body.classList.toggle("product-flow-active", showProductFlow);
}

function setAuthModeTabsDisabled(disabled) {
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.disabled = Boolean(disabled);
    button.setAttribute("aria-disabled", disabled ? "true" : "false");
  });
}

function setAuthShellMode(mode = "signin") {
  authShellMode = mode === "signup" ? "signup" : "signin";
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    const active = button.dataset.authMode === authShellMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  if (authShellMode === "signup") {
    setText(els.authModeLabel, "Create account");
    setText(els.authShellTitle, "Create your StudentOS account");
    setText(els.authShellCopy, "Use your student email and a password. Email verification may be required before the account opens.");
    els.signinBtn?.classList.remove("primary-button");
    els.signinBtn?.classList.add("secondary-button");
    els.signupBtn?.classList.remove("secondary-button");
    els.signupBtn?.classList.add("primary-button");
    return;
  }
  setText(els.authModeLabel, "Session");
  setText(els.authShellTitle, "Sign in to StudentOS");
  setText(els.authShellCopy, "Use the email and password for your StudentOS account.");
  els.signinBtn?.classList.add("primary-button");
  els.signinBtn?.classList.remove("secondary-button");
  els.signupBtn?.classList.add("secondary-button");
  els.signupBtn?.classList.remove("primary-button");
}

function focusPricingSection() {
  if (!els.pricingSection || authGateActive()) return;
  window.requestAnimationFrame(() => {
    els.pricingSection.scrollIntoView({ block: "start" });
    els.pricingSection.focus({ preventScroll: true });
  });
}

function syncAuthHash() {
  const hash = window.location.hash.toLowerCase();
  if (hash === "#signup") {
    setAuthShellMode("signup");
  } else if (hash === "#login" || hash === "#app") {
    setAuthShellMode("signin");
  } else if (hash === "#pricing") {
    if (!authGateActive()) {
      setView("account");
      focusPricingSection();
    }
  }
  updateShellVisibility();
}

function handleAuthLocationChange() {
  if (!captureAuthReturnSession()) {
    syncAuthHash();
    return;
  }
  renderAuth(authReturnMessage);
  updateShellVisibility();
  if (!authGateActive()) {
    loadBootstrap().catch(renderWorkspaceLoadError);
  }
}

function handleSessionExpiry() {
  storeSession(null);
  accountSnapshot = null;
  renderAuth("Session expired. Sign in again to continue.");
}

function classroomErrorCopy(error) {
  const message = String(error?.message || "");
  const lower = message.toLowerCase();
  if (lower.includes("insufficient") || lower.includes("scope") || lower.includes("expired") || lower.includes("revoked") || lower.includes("invalid credentials") || lower.includes("unauthorized") || lower.includes("reconnect")) {
    return "Reconnect Classroom to check for new work and refresh selected items.";
  }
  if (lower.includes("quota") || lower.includes("rate") || lower.includes("429") || lower.includes("busy")) {
    return "Classroom syncing is busy right now. You can keep working in StudentOS.";
  }
  if (lower.includes("disabled") || lower.includes("setup") || lower.includes("not active") || lower.includes("not configured")) {
    return "Classroom setup is not active for this workspace.";
  }
  if (lower.includes("disconnected") || lower.includes("connect classroom")) {
    return "Connect Classroom before syncing assignments.";
  }
  return message || "Classroom assignments could not be refreshed. Your StudentOS work was not changed.";
}

function renderClassroomError(error) {
  if (!els.classroomPanel) return;
  const copy = classroomErrorCopy(error);
  const reconnect = /reconnect/i.test(copy);
  const connector = {
    state: reconnect ? "reconnect_required" : "status_pending",
    connected: false,
    actions: {
      connect: false,
      reconnect,
      sync: false,
      disconnect: false,
    },
    ui: {
      title: reconnect ? "Reconnect Classroom" : "Classroom status pending",
      message: copy,
      badge: reconnect ? "reconnect needed" : "workspace ready",
    },
  };
  classroomStatus = { connector, syncSummary: null };
  classroomStatusLoaded = true;
  updateClassroomActions(connector);
  setResult(els.classroomPanel, `
    <strong>${escapeHtml(connector.ui.title)}</strong>
    <p>${escapeHtml(copy)}</p>
    <div class="tag-row">
      ${tag(connector.ui.badge, reconnect ? "medium" : "source")}
    </div>
  `);
}

function isPublicFrontendOrigin() {
  return PUBLIC_FRONTEND_HOSTS.has(window.location.hostname);
}

function productionAuthUnavailable() {
  return isPublicFrontendOrigin() && runtimeConfig.auth?.enabled !== true;
}

function apiBaseMisconfiguredError() {
  return new Error(API_BASE_MISCONFIGURED_MESSAGE);
}

function studentFacingRequestError(message = "", status = 0) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  if (status === 429 || lower.includes("429") || lower.includes("too many") || lower.includes("rate limit")) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (lower.includes("invalid login") || lower.includes("invalid credentials") || lower.includes("invalid email") || lower.includes("invalid password")) {
    return "Invalid email or password.";
  }
  if (lower.includes("email not confirmed") || lower.includes("not confirmed") || lower.includes("verification")) {
    return "Please check your email to continue.";
  }
  if (/\b(supabase|groq|pollinations|gemini|openai|gpt|gpt-oss|anthropic|claude|provider|model|token|vector|embedding|chunks?|backend|storage|oauth|connector)\b/i.test(text)) {
    return "We couldn’t complete that request. Please try again.";
  }
  return text || "We couldn’t complete that request. Please try again.";
}

function apiUrl(path) {
  if (!API_BASE && isPublicFrontendOrigin()) {
    throw apiBaseMisconfiguredError();
  }
  return `${API_BASE}${path}`;
}

async function readJsonResponse(response, fallbackMessage) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const looksHtml = contentType.includes("text/html") || /^\s*<!doctype\s+html/i.test(text) || /^\s*<html[\s>]/i.test(text);
  if (looksHtml) {
    throw apiBaseMisconfiguredError();
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(fallbackMessage || "StudentOS API returned an invalid JSON response.");
  }
}

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = isFormData
    ? { ...(options.headers || {}) }
    : {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      };
  if (authSession?.access_token) {
    headers.Authorization = `Bearer ${authSession.access_token}`;
  }
  const response = await fetch(apiUrl(path), {
    ...options,
    headers,
  });
  const body = await readJsonResponse(response, `StudentOS API returned invalid JSON for ${path}.`);
  if (!response.ok) {
    if (response.status === 401) {
      handleSessionExpiry();
    }
    throw new Error(studentFacingRequestError(body.error || `HTTP ${response.status}`, response.status));
  }
  return body;
}

async function loadRuntimeConfig() {
  runtimeConfig = await api("/api/config");
  syncAuthHash();
  renderAuth(authReturnMessage);
}

async function loadClassroomStatus() {
  try {
    classroomStatus = await api("/api/classroom/status");
    classroomStatusLoaded = true;
  } catch (error) {
    classroomStatus = {
      connector: {
        state: "status_pending",
        mode: runtimeConfig.classroom?.mode || "unknown",
        connected: false,
        available: false,
        readOnlyImport: true,
        writeScopesEnabled: false,
        actions: {
          connect: false,
          reconnect: false,
          sync: false,
          disconnect: false,
        },
        ui: {
          title: "Classroom status pending",
          message: "Your workspace is ready. Classroom status will update when setup is available.",
          badge: "workspace ready",
        },
      },
      error: error.message,
    };
    classroomStatusLoaded = true;
  }
  renderClassroomPanel();
}

function getAcademicGoalLabel() {
  return humanize(state?.studentProfile?.preferences?.academicGoal || "Not set");
}

async function authRequest(path, body, token = "") {
  if (!runtimeConfig.auth?.enabled) {
    throw new Error("StudentOS sign-in is not available yet.");
  }
  const headers = {
    apikey: runtimeConfig.auth.anonKey,
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${runtimeConfig.auth.url}/auth/v1${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });
  const payload = await readJsonResponse(response, "StudentOS sign-in returned an invalid response.").catch(() => ({}));
  if (!response.ok) {
    throw new Error(studentFacingRequestError(payload.error_description || payload.msg || payload.error || "Sign-in request failed", response.status));
  }
  return payload;
}

function renderAuth(message = "") {
  if (productionAuthUnavailable()) {
    setAuthModeTabsDisabled(true);
    els.authForm.hidden = true;
    els.logoutBtn.hidden = true;
    setText(els.authModeLabel, "Configuration");
    setText(els.authShellTitle, "StudentOS sign-in is not available yet");
    setText(els.authShellCopy, "StudentOS sign-in is temporarily unavailable. A local preview will not open on this site.");
    setText(els.authSession, "Configuration required");
    setText(els.authHelp, "Please try again after the StudentOS deployment is updated.");
    setText(els.authMessage, message || "");
    setText(els.railSessionStatus, "Sign in unavailable");
    setText(els.railSessionHelp, "Production sign-in configuration is required.");
    updateShellVisibility();
    return;
  }
  setAuthModeTabsDisabled(false);
  if (!runtimeConfig.auth?.enabled) {
    els.authForm.hidden = true;
    els.logoutBtn.hidden = true;
    setText(els.authSession, "Local preview");
    setText(els.authHelp, "Local preview keeps account actions available without contacting live sign-in.");
    setText(els.railSessionStatus, "Local preview");
    setText(els.railSessionHelp, "Local preview with private-account controls simulated.");
    updateShellVisibility();
    return;
  }
  if (authSession?.access_token) {
    els.authForm.hidden = true;
    els.logoutBtn.hidden = false;
    const email = authSession.user?.email || authSession.email || "Signed in";
    setText(els.authSession, email);
    setText(els.authHelp, "Session active. Account settings and export requests stay private to your session.");
    setText(els.railSessionStatus, email);
    setText(els.railSessionHelp, "StudentOS workspace is open.");
    updateShellVisibility();
    return;
  }
  els.authForm.hidden = false;
  els.logoutBtn.hidden = true;
  setText(els.authSession, message || "Ready to sign in");
  setText(els.authHelp, "Create an account or sign in. Email verification may be required.");
  setText(els.railSessionStatus, "Sign in required");
  setText(els.railSessionHelp, "Use the secure sign-in screen to open StudentOS.");
  updateShellVisibility();
}

async function signInWithPassword(event) {
  event?.preventDefault();
  renderAuth("Signing in...");
  const session = await authRequest("/token?grant_type=password", {
    email: els.authEmail.value,
    password: els.authPassword.value,
  });
  storeSession(session);
  renderAuth();
  if (["#login", "#signup"].includes(window.location.hash.toLowerCase())) {
    history.replaceState(null, "", "#app");
  }
  await loadBootstrap();
  syncAuthHash();
}

async function signUpWithPassword() {
  renderAuth("Creating account...");
  const callbackPath = String(runtimeConfig.auth?.signupRedirectPath || "/auth/callback");
  const callbackUrl = new URL(callbackPath.startsWith("/") ? callbackPath : "/auth/callback", window.location.origin).href;
  const session = await authRequest(`/signup?redirect_to=${encodeURIComponent(callbackUrl)}`, {
    email: els.authEmail.value,
    password: els.authPassword.value,
  });
  if (session.access_token) {
    storeSession(session);
    if (["#login", "#signup"].includes(window.location.hash.toLowerCase())) {
      history.replaceState(null, "", "#app");
    }
    await loadBootstrap();
    syncAuthHash();
  }
  renderAuth(session.access_token ? "" : "Check your email to verify this StudentOS account.");
}

async function logout() {
  const token = authSession?.access_token;
  if (token && runtimeConfig.auth?.enabled) {
    await authRequest("/logout", {}, token).catch(() => null);
  }
  storeSession(null);
  accountSnapshot = null;
  renderAuth();
  if (!authGateActive()) {
    await loadBootstrap();
  }
}

async function requestPasswordReset(email, target = els.passwordResetResult) {
  const address = String(email || "").trim();
  if (!address) {
    target.innerHTML = `<p>Enter the account email first.</p>`;
    return;
  }
  target.innerHTML = `<p>Preparing password recovery...</p>`;
  const result = await api("/api/auth/password-reset", {
    method: "POST",
    body: JSON.stringify({ email: address }),
  });
  target.innerHTML = `
    <strong>Password reset ready</strong>
    <p>${escapeHtml(result.message)}</p>
  `;
}

async function requestVerificationResend(email) {
  const address = String(email || "").trim();
  if (!address) {
    els.verificationResult.innerHTML = `<p>Enter the account email first.</p>`;
    return;
  }
  els.verificationResult.innerHTML = `<p>Preparing a fresh verification link...</p>`;
  const result = await api("/api/auth/verification/resend", {
    method: "POST",
    body: JSON.stringify({ email: address }),
  });
  els.verificationResult.innerHTML = `
    <strong>Verification link request ready</strong>
    <p>${escapeHtml(result.message)}</p>
    <div class="tag-row">
      ${tag("StudentOS sign-in", "source")}
      ${tag(result.verificationEmailRequested ? "email requested" : "preview ready", result.verificationEmailRequested ? "source" : "medium")}
    </div>
  `;
}

function courseById(courseId) {
  return state?.courses?.find((course) => course.id === courseId);
}

function topicById(topicId) {
  return state?.topics?.find((topic) => topic.id === topicId);
}

function assignmentById(assignmentId) {
  return state?.assignments?.find((assignment) => assignment.id === assignmentId);
}

function assignmentInsightById(assignmentId) {
  return state?.assignmentInsights?.find((insight) => insight.assignmentId === assignmentId);
}

function timestampFor(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function timestampForNewest(value) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function sortedByDate(items, getValue) {
  return [...(items || [])].sort((left, right) => timestampFor(getValue(left)) - timestampFor(getValue(right)));
}

function classroomFreshnessTimestamp(item = {}) {
  return Math.max(
    timestampForNewest(item.classroomUpdatedAt),
    timestampForNewest(item.updateTime),
    timestampForNewest(item.creationTime),
    timestampForNewest(item.dueAt),
    timestampForNewest(item.dueDate),
    timestampForNewest(item.importedAt),
    timestampForNewest(item.createdAt),
    timestampForNewest(item.updatedAt),
  );
}

function sortStudentWork(left, right) {
  const due = timestampFor(left.dueAt || left.dueDate) - timestampFor(right.dueAt || right.dueDate);
  if (due) return due;
  return timestampFor(left.postedAt || left.createdAt) - timestampFor(right.postedAt || right.createdAt);
}

function assignmentNeedsAction(assignment = {}) {
  const status = String(assignment.status || "").toLowerCase();
  return assignment.handedIn !== true &&
    !assignment.archived &&
    !["archived", "completed", "done", "graded", "returned", "submitted"].includes(status);
}

function getNextActions() {
  const roadmap = (state.roadmap || []).filter((item) => item.status === "open");
  return state.todayNextActions?.length ? state.todayNextActions : sortedByDate(roadmap, (item) => item.dueAt);
}

function getDueAssignments() {
  const selectedWork = (state.assignments || []).filter(assignmentNeedsAction).sort(sortStudentWork);
  const selectedIds = new Set(selectedWork.map((item) => item.id));
  const reviewWork = (state.classroomDueWork || [])
    .filter((item) => item.reviewRequired && assignmentNeedsAction(item) && !selectedIds.has(item.id))
    .sort(sortStudentWork);
  return [...selectedWork, ...reviewWork];
}

function getNextTimetableBlock() {
  return sortedByDate(state.timetable || [], (item) => item.startsAt)[0] || null;
}

function getCourseTopics(courseId) {
  return (state.topics || []).filter((topic) => topic.courseId === courseId);
}

function getCourseAssignments(courseId) {
  return (state.assignments || []).filter((assignment) => assignment.courseId === courseId && assignmentNeedsAction(assignment)).sort(sortStudentWork);
}

function getCourseSources(courseId) {
  return (state.sourceMaterials || [])
    .filter((source) => source.courseId === courseId && !source.deletedAt)
    .sort((left, right) => {
      const freshness = classroomFreshnessTimestamp(right) - classroomFreshnessTimestamp(left);
      if (freshness) return freshness;
      return String(left.id || left.title || "").localeCompare(String(right.id || right.title || ""));
    });
}

function getCourseRoadmap(courseId) {
  return sortedByDate((state.roadmap || []).filter((item) => item.courseId === courseId && item.status === "open"), (item) => item.dueAt);
}

function sourceIsIndexed(source) {
  return source.readyForStudy === true || source.status === "indexed" || source.status === "ready";
}

function sourceEmbeddedChunks(source) {
  if (!source?.id) return sourceIsIndexed(source) ? 1 : 0;
  const embedded = (state.sourceChunks || []).filter((chunk) =>
    chunk.sourceMaterialId === source.id && chunk.embeddingStatus === "embedded"
  ).length;
  return embedded || (sourceIsIndexed(source) ? 1 : 0);
}

function latestSourceJob(source) {
  const jobTime = (job) => {
    const parsed = Date.parse(job.updatedAt || job.createdAt || "");
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  return (state.backgroundJobs || [])
    .filter((job) => job.sourceId === source.id)
    .sort((left, right) => jobTime(right) - jobTime(left))[0];
}

function sourceTypeLabel(source) {
  return source.filename || source.mimeType || humanize(source.kind || "Academic material");
}

function sourceHealthLabel(source, latestJob, embeddedCount) {
  if (source.extractionError || latestJob?.status === "failed") return "needs attention";
  if (source.ocrRequired || source.status === "needs_ocr") return "OCR needed";
  if (sourceIsIndexed(source) || embeddedCount > 0) return "Ready";
  return humanize(source.status || source.extractionStatus || "registered");
}

function backendModeLabel(mode) {
  if (mode === "private_cloud_sync") return "Cloud sync";
  if (mode === "local_preview") return "Local preview";
  if (mode === "supabase") return "Cloud sync";
  if (mode === "mock") return "Local preview";
  return humanize(mode || "unknown mode");
}

function classroomModeLabel(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "mock" || mode === "preview") return "Classroom preview ready";
  if (mode === "oauth") return "Classroom connected";
  if (mode === "connected") return "Classroom connected";
  if (mode === "disabled") return "Classroom setup not active";
  if (mode === "setup_required") return "Classroom setup not active";
  if (mode === "disconnected") return "Classroom can be connected";
  if (mode === "reconnect_required" || mode === "expired" || mode === "error") return "Reconnect Classroom";
  if (mode === "status_pending") return "Classroom status pending";
  return humanize(value || "Classroom status pending");
}

function normalizedClassroomState(connector = {}) {
  const stateName = String(connector.state || connector.status || "").toLowerCase();
  const mode = String(connector.mode || "").toLowerCase();
  if (stateName) {
    if (["expired", "error"].includes(stateName)) return "reconnect_required";
    return stateName;
  }
  if (mode === "disabled") return "disabled";
  if (mode === "mock" || mode === "preview") return "connected";
  if (mode === "oauth") return connector.connected ? "connected" : "disconnected";
  return "status_pending";
}

function statusPendingClassroomConnector() {
  return {
    state: "status_pending",
    status: "status_pending",
    connected: false,
    available: false,
    readOnlyImport: true,
    writeScopesEnabled: false,
    actions: {
      connect: false,
      reconnect: false,
      sync: false,
      disconnect: false,
    },
    ui: {
      title: "Classroom status pending",
      message: "Your workspace is ready. Classroom status will update when setup is available.",
      badge: "workspace ready",
      detail: "Classroom actions are hidden until status is ready.",
    },
  };
}

function activeClassroomConnector() {
  return classroomStatusLoaded && classroomStatus?.connector
    ? classroomStatus.connector
    : statusPendingClassroomConnector();
}

function classroomActions(connector = {}) {
  if (connector.actions) {
    return {
      connect: connector.actions.connect === true,
      reconnect: connector.actions.reconnect === true,
      sync: connector.actions.sync === true,
      disconnect: connector.actions.disconnect === true,
    };
  }
  const stateName = normalizedClassroomState(connector);
  return {
    connect: stateName === "disconnected",
    reconnect: stateName === "reconnect_required",
    sync: stateName === "connected",
    disconnect: stateName === "connected",
  };
}

function updateClassroomActions(connector = {}) {
  const actions = classroomActions(connector);
  if (els.classroomConnectBtn) {
    els.classroomConnectBtn.hidden = !(actions.connect || actions.reconnect);
    els.classroomConnectBtn.textContent = actions.reconnect ? "Reconnect Classroom" : "Connect Classroom";
    els.classroomConnectBtn.disabled = false;
  }
  if (els.classroomSyncBtn) {
    els.classroomSyncBtn.hidden = !actions.sync;
    els.classroomSyncBtn.disabled = false;
    els.classroomSyncBtn.textContent = starterCourseOnlyClassroom() ? "Refresh courses" : "Check Classroom";
  }
  if (els.classroomDisconnectBtn) {
    els.classroomDisconnectBtn.hidden = !actions.disconnect;
    els.classroomDisconnectBtn.disabled = false;
  }
  return actions;
}

function classroomUi(connector = {}, summary = null, history = []) {
  if (connector.ui?.title || connector.ui?.message) return connector.ui;
  const stateName = normalizedClassroomState(connector);
  const lastSync = connector.lastSyncAt || history[0]?.completedAt || "";
  if (stateName === "connected") {
    return {
      title: connector.mode === "mock" ? "Classroom preview ready" : "Classroom connected",
      message: connector.mode === "mock"
        ? "Choose the work you want to include in your academic context."
        : "StudentOS can find Classroom work for you to review. You choose what gets added.",
      badge: "work ready to review",
      detail: lastSync ? `Last checked ${formatDate(lastSync)}` : summary ? "Choose what to add to your academic context." : "Ready to check for Classroom work.",
    };
  }
  if (stateName === "disconnected") {
    return {
      title: "Classroom can be connected",
      message: "Connect when you want to choose Classroom work for your academic context.",
      badge: "optional setup",
      detail: "No Classroom connection is active.",
    };
  }
  if (stateName === "reconnect_required") {
    return {
      title: "Reconnect Classroom",
      message: "Reconnect Classroom to check for new work and refresh selected items.",
      badge: "reconnect needed",
      detail: "Existing StudentOS work was not changed.",
    };
  }
  return {
    title: "Classroom setup is not active",
    message: "Your workspace is ready. Classroom can be connected later.",
    badge: "workspace ready",
    detail: "Classroom actions are hidden until setup is complete.",
  };
}

function sourceStatusLabel(value) {
  const status = String(value || "").toLowerCase();
  if (status === "indexed" || status === "completed") return "Ready";
  if (status === "queued") return "Saved privately";
  if (status === "processing" || status === "extracting") return "Preparing source";
  if (status === "needs_ocr") return "Needs review";
  if (status === "failed") return "Needs review";
  if (status === "registered") return "Saved privately";
  return humanize(value || "Saved privately");
}

function indexedSectionsLabel(count) {
  return `${count} source section${count === 1 ? "" : "s"}`;
}

function studyBreakLabel(value) {
  const pattern = String(value || "").trim();
  const match = pattern.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (match) return `${match[1]} min focus / ${match[2]} min break`;
  return pattern || "Not set";
}

function studentTaskTitle(title) {
  return String(title || "")
    .replace(/^Recover\s+/i, "Review ")
    .replace(/\bgrouped-data\b/gi, "grouped data")
    .replace(/\bTODO\b/g, "task")
    .trim();
}

function sourceVisibilityLabel(source) {
  return source?.isPrivate ? "Private" : "Private to your account";
}

function buildSourceAiPrompt(source, course) {
  return [
    `Explain this source for study use: ${source.title}.`,
    `Course: ${course?.title || "Course not set"}.`,
    `Type: ${sourceTypeLabel(source)}.`,
    "Use my uploaded materials where available and call out anything not covered.",
  ].join(" ");
}

function sourceSearchText(source, course, latestJob, embeddedCount) {
  return [
    source.title,
    source.filename,
    source.mimeType,
    source.kind,
    source.status,
    source.extractionStatus,
    source.storageMode,
    source.citationLabel,
    source.extractionSummary,
    source.extractedSnippet,
    source.extractionError,
    sourceHealthLabel(source, latestJob, embeddedCount),
    indexedSectionsLabel(embeddedCount),
    sourceVisibilityLabel(source),
    latestJob?.status,
    latestJob?.jobType,
    latestJob?.lastError,
    course?.title,
  ].filter(Boolean).join(" ").toLowerCase();
}

function courseNextAction(course, assignments, roadmap) {
  const todayAction = getNextActions().find((item) => item.courseId === course.id);
  return todayAction || roadmap[0] || assignments[0] || null;
}

function buildCourseAiPrompt(course, weakTopics, assignments, sources, nextAction) {
  const parts = [
    `Course workspace: ${course.title}.`,
    weakTopics.length ? `Weak topics: ${weakTopics.map((topic) => topic.title).join(", ")}.` : "No weak topics listed.",
    assignments.length ? `Due work: ${assignments.slice(0, 2).map((assignment) => assignment.title).join(", ")}.` : "No due work listed.",
    sources.length ? `Sources available: ${sources.map((source) => source.title).slice(0, 2).join(", ")}.` : "No sources uploaded yet.",
    nextAction ? `Next action: ${nextAction.title}.` : "Choose the safest next action.",
  ];
  return `Help me focus this course. ${parts.join(" ")} Keep the answer practical and grounded in StudentOS data.`;
}

function buildTodayPlanPrompt(nextAction, dueAssignment, nextBlock) {
  const parts = [
    nextAction ? `Start with ${nextAction.title}.` : "Choose my first study block.",
    dueAssignment ? `Protect due work: ${dueAssignment.title} due ${formatDate(dueAssignment.dueDate)}.` : "No due work is listed yet.",
    nextBlock ? `Fit around ${nextBlock.title} at ${formatTime(nextBlock.startsAt)}.` : "Use my available study window.",
  ];
  return `Plan today from my StudentOS command center. ${parts.join(" ")} Keep it concise and practical.`;
}

function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function humanize(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toneForCoverage(status) {
  if (status === "covered") return "source";
  if (status === "partially_covered") return "medium";
  return "urgent";
}

function tag(label, tone = "") {
  return `<span class="tag ${tone}">${escapeHtml(label)}</span>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function list(items = []) {
  if (!items.length) return "";
  return `<ul>${items.map((item) => `<li>${escapeHtml(typeof item === "string" ? item : JSON.stringify(item))}</li>`).join("")}</ul>`;
}

const PRODUCT_FLOW_STEPS = Object.freeze([
  "about_you",
  "education_system",
  "pricing",
  "trial_choice",
  "payment_method",
  "legal_consent",
  "daily_schedule",
  "exam_pattern",
  "academic_context",
  "classroom_setup",
  "materials",
  "setup_summary",
  "workspace_preparation",
  "tutorial",
]);

const ONBOARDING_STEPS = Object.freeze([
  "about_you",
  "education_system",
  "daily_schedule",
  "exam_pattern",
  "academic_context",
]);

const ONBOARDING_PAGE_COPY = Object.freeze({
  about_you: {
    title: "What is your name?",
    copy: "This is the only required profile question. You can adjust everything else later.",
    fields: [{ name: "displayName", label: "Your name", required: true, placeholder: "Enter your name" }],
  },
  education_system: {
    title: "Academic identity",
    copy: "A little context helps StudentOS shape your workspace. Every field on this page is optional.",
    fields: [
      { name: "institution", label: "School, college, or institution", placeholder: "Optional" },
      { name: "level", label: "Level", placeholder: "For example, Grade 12 or undergraduate" },
      { name: "stream", label: "Stream or course", placeholder: "Optional" },
      { name: "yearSemester", label: "Year or semester", placeholder: "Optional" },
    ],
  },
  daily_schedule: {
    title: "Daily Schedule",
    copy: "Tell StudentOS when study usually fits into your day.",
    fields: [{ name: "schedule", label: "Typical study times", placeholder: "For example, weekdays after 6 PM", multiline: true }],
  },
  exam_pattern: {
    title: "Exam and Assessment Pattern",
    copy: "Tell StudentOS how exams and assessments work in your institution.",
    detail: "For example: In my 5-month semester, we have 4 Continuous Internal Assessments of 20 marks each, one per month, followed by a 60-mark semester exam.",
    fields: [{ name: "examPattern", label: "Your institution's exam pattern", placeholder: "Describe your exams, internals, practicals, viva, assignments, marks, frequency, and semester pattern.", multiline: true }],
  },
  academic_context: {
    title: "Syllabus and Academic Context",
    copy: "Add your subjects and describe your syllabus naturally. PDF uploads become available in Academic Context after Setup.",
    fields: [
      { name: "subjects", label: "Subjects or courses", placeholder: "One per line is fine", multiline: true },
      { name: "syllabusNotes", label: "Describe your syllabus or courses", placeholder: "Type naturally about topics, units, routines, assignments, or anything StudentOS should understand.", multiline: true },
    ],
  },
});

function academicContextUploadMarkup() {
  return `
    <section class="academic-file-upload" aria-labelledby="academic-file-upload-title">
      <div>
        <strong id="academic-file-upload-title">Add PDFs after Setup</strong>
        <p>Add your subjects here first. When Setup is complete, Academic Context lets you choose a course and upload an assignment or material PDF.</p>
      </div>
      <label class="academic-file-picker" for="product-academic-files">
        <span>Available after Setup</span>
        <input id="product-academic-files" type="file" disabled accept=".pdf,application/pdf">
      </label>
      <p class="form-help">Add a course in Setup before uploading academic context.</p>
    </section>
  `;
}

function currentClassroomPolicy() {
  return state?.planAccess?.entitlements?.classroom || classroomStatus?.policy || {};
}

function starterCourseOnlyClassroom() {
  return currentClassroomPolicy().courseOnly === true;
}

const PAID_PRODUCT_PLAN_KEYS = Object.freeze(["starter", "essential", "plus", "pro"]);

function publicPlanSummaries() {
  const plans = runtimeConfig.billing?.plans || runtimeConfig.saas?.billing?.plans || [];
  return Array.isArray(plans) ? plans.filter((plan) => PAID_PRODUCT_PLAN_KEYS.includes(publicPlanKey(plan))) : [];
}

function publicPlanKey(plan) {
  const planKey = String(plan?.planKey || plan?.id || "").trim().toLowerCase();
  return PAID_PRODUCT_PLAN_KEYS.includes(planKey) ? planKey : null;
}

function productPlan(planId) {
  const normalized = String(planId || "").trim().toLowerCase();
  if (!normalized) return null;
  return publicPlanSummaries().find((plan) => publicPlanKey(plan) === normalized) || null;
}

function normalizedProductPlanKey(value) {
  const plan = productPlan(value);
  return plan ? publicPlanKey(plan) : null;
}

function productPlanName(planId) {
  const plan = productPlan(planId);
  return plan?.displayName || plan?.label || "selected plan";
}

function planPriceDisplay(plan) {
  if (plan?.priceDisplay) return String(plan.priceDisplay);
  const monthlyPrice = Number(plan?.priceMonthlyInr);
  return Number.isFinite(monthlyPrice) && monthlyPrice > 0 ? `₹${monthlyPrice}/month` : "Plan setup pending";
}

function planValueStatement(plan) {
  return String(plan?.positioning || "Plan details are temporarily unavailable.");
}

function planFeatureBullets(plan) {
  const features = plan?.featureBullets || plan?.highlights || [];
  return Array.isArray(features) ? features.slice(0, 6) : [];
}

function planBestFor(plan) {
  return String(plan?.bestFor || "");
}

function pendingPlanSummary() {
  return {
    id: null,
    planKey: null,
    label: "Plan setup pending",
    displayName: "Plan setup pending",
    positioning: "Choose a StudentOS plan to continue setting up your workspace.",
    featureBullets: [],
    bestFor: "Completing plan selection.",
    recommended: false,
  };
}

function currentProductCapabilities() {
  return state?.planAccess?.capabilities || accountSnapshot?.planAccess?.capabilities || accountSnapshot?.quota?.capabilities || null;
}

function currentAcademicContextCapacity() {
  const capacity = state?.planAccess?.academicContext || accountSnapshot?.planAccess?.academicContext || accountSnapshot?.quota?.academicContext;
  if (capacity && ["available", "almost_full", "full", "unavailable"].includes(capacity.status)) return capacity;
  return {
    status: "unavailable",
    canAdd: false,
    message: "Plan setup pending. Finish setup before adding academic material.",
  };
}

function academicContextCapacityMarkup() {
  const capacity = currentAcademicContextCapacity();
  if (capacity.status === "available") return "";
  const tone = capacity.status === "full" ? "warning-copy" : "muted-copy";
  return `<p class="${tone}" data-academic-context-status="${escapeHtml(capacity.status)}">${escapeHtml(capacity.message)}</p>`;
}

function syncAcademicContextUploadType() {
  const assignment = (els.sourceKindSelect?.value || "assignment") === "assignment";
  if (els.sourceDeadlineField) els.sourceDeadlineField.hidden = !assignment;
  if (els.sourceDeadline) {
    els.sourceDeadline.required = assignment;
    if (!assignment) els.sourceDeadline.value = "";
  }
  if (els.sourceSubmitButton) els.sourceSubmitButton.textContent = assignment ? "Upload assignment" : "Upload material";
}

function updateProductFeatureControls() {
  const capacity = currentAcademicContextCapacity();
  const noCourses = !(state?.courses || []).length;
  const blockMaterialAdd = capacity.canAdd !== true || noCourses;
  if (els.sourceFile) els.sourceFile.disabled = blockMaterialAdd;
  if (els.sourceCourseSelect) els.sourceCourseSelect.disabled = blockMaterialAdd;
  if (els.sourceKindSelect) els.sourceKindSelect.disabled = blockMaterialAdd;
  if (els.sourceDeadline) els.sourceDeadline.disabled = blockMaterialAdd;
  const sourceSubmit = document.querySelector("#source-form button[type='submit']");
  if (sourceSubmit) sourceSubmit.disabled = blockMaterialAdd;
  if (els.sourceCapacityMessage) {
    els.sourceCapacityMessage.textContent = noCourses
      ? "Add a course in Setup before uploading academic context."
      : capacity.message;
    els.sourceCapacityMessage.classList.toggle("warning-copy", capacity.status === "full");
  }
  syncAcademicContextUploadType();

  const capabilities = currentProductCapabilities();
  const assignmentCoachEnabled = capabilities?.features?.assignmentCoach === true;
  const assignmentCoachCopy = capabilities
    ? "Assignment Coach is available with Plus or Pro. Student review is always required."
    : "Plan setup pending. Finish setup to check assignment features.";
  const contractButton = document.getElementById("contract-btn");
  if (contractButton) {
    contractButton.disabled = !assignmentCoachEnabled;
    contractButton.title = assignmentCoachEnabled ? "" : assignmentCoachCopy;
    if (!assignmentCoachEnabled && els.contractResult && !els.contractResult.textContent.trim()) {
      setResult(els.contractResult, `<p>${escapeHtml(assignmentCoachCopy)}</p>`);
    }
  }
  const extensionForm = document.getElementById("extension-form");
  if (extensionForm) {
    for (const control of extensionForm.querySelectorAll("input, select, button")) control.disabled = !assignmentCoachEnabled;
    if (!assignmentCoachEnabled && els.extensionResult && !els.extensionResult.textContent.trim()) {
      setResult(els.extensionResult, `<p>${escapeHtml(assignmentCoachCopy)}</p>`);
    }
  }
}

function planSummaryCardMarkup(plan, { context = "onboarding", activePlanId = null } = {}) {
  const planKey = publicPlanKey(plan);
  if (!planKey) return "";
  const displayName = plan.displayName || plan.label || humanize(planKey);
  const active = planKey === activePlanId;
  const recommended = plan.recommended === true;
  const cardClass = context === "account" ? "pricing-card" : "product-plan-card";
  const headingTag = context === "account" ? "h4" : "h3";
  const buttonAttributes = context === "account"
    ? `data-plan-preview="${escapeHtml(planKey)}"`
    : `data-product-action="select-plan" data-plan-id="${escapeHtml(planKey)}"`;
  const buttonLabel = context === "account" && active ? "Current plan" : `Choose ${displayName}`;
  const buttonClass = context === "account" && active ? "secondary-button" : "primary-button";
  const bestFor = planBestFor(plan);
  return `
    <article class="${cardClass} plan-summary-card${recommended ? " recommended" : ""}${active ? " active" : ""}" data-plan-key="${escapeHtml(planKey)}">
      <div class="plan-card-topline">
        <p class="eyebrow">${escapeHtml(displayName)}</p>
        <div class="plan-card-badges">
          ${recommended ? '<span class="plan-recommended-badge">Recommended</span>' : ""}
          ${active ? '<span class="plan-current-badge">Current plan</span>' : ""}
        </div>
      </div>
      <${headingTag} class="plan-price">${escapeHtml(planPriceDisplay(plan))}</${headingTag}>
      <p class="plan-positioning">${escapeHtml(planValueStatement(plan))}</p>
      <ul class="pricing-feature-list plan-feature-list">
        ${planFeatureBullets(plan).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
      ${bestFor ? `<div class="plan-best-for"><span>Best for</span><p>${escapeHtml(bestFor)}</p></div>` : ""}
      <button class="${buttonClass} wide pricing-cta" type="button" ${buttonAttributes}>${escapeHtml(buttonLabel)}</button>
    </article>
  `;
}

function renderProductProgress(lifecycle) {
  if (!els.productFlowProgress) return;
  const index = Math.max(0, PRODUCT_FLOW_STEPS.indexOf(lifecycle.nextStep));
  const progress = Math.round(((index + 1) / PRODUCT_FLOW_STEPS.length) * 100);
  els.productFlowProgress.innerHTML = `
    <div class="product-progress-copy">
      <span>StudentOS setup</span>
      <strong>Step ${index + 1} of ${PRODUCT_FLOW_STEPS.length}</strong>
    </div>
    <div class="product-progress-track" aria-hidden="true"><span style="width:${progress}%"></span></div>
  `;
}

function pricingStepMarkup() {
  const plans = publicPlanSummaries();
  return `
    <p class="eyebrow">Choose your plan</p>
    <h2 id="product-flow-title">Build your academic workspace</h2>
    <p class="product-flow-lead">Choose the support level that fits your semester. StudentOS has no free tier, and every plan can begin with optional Trial Mode.</p>
    <div class="product-pricing-grid">
      ${plans.length
        ? plans.map((plan) => planSummaryCardMarkup(plan)).join("")
        : '<article class="product-empty-state"><strong>Plans unavailable</strong><p>StudentOS could not load plan details yet. Refresh before continuing.</p></article>'}
    </div>
  `;
}

function trialChoiceMarkup(lifecycle) {
  const label = productPlanName(lifecycle.selectedPlanId);
  return `
    <p class="eyebrow">How would you like to start?</p>
    <h2 id="product-flow-title">You selected ${escapeHtml(label)}</h2>
    <p class="product-flow-lead">You selected ${escapeHtml(label)}. Trial Mode gives you limited access for 7 days before your ${escapeHtml(label)} subscription starts. Trial features are different from ${escapeHtml(label)}. Start with Trial Mode, or begin ${escapeHtml(label)} now.</p>
    <div class="product-choice-grid">
      <button class="choice-card" type="button" data-product-action="choose-access" data-access-mode="trial">
        <strong>Start with Trial Mode</strong>
        <span>Your selected ${escapeHtml(label)} plan stays saved while Trial Mode is active.</span>
      </button>
      <button class="choice-card" type="button" data-product-action="choose-access" data-access-mode="paid_plan">
        <strong>Start ${escapeHtml(label)} now</strong>
        <span>Continue directly with your selected plan.</span>
      </button>
    </div>
  `;
}

function paymentStepMarkup(lifecycle) {
  const enabled = runtimeConfig.productFlow?.paymentPlaceholderEnabled === true;
  return `
    <p class="eyebrow">Access check</p>
    <h2 id="product-flow-title">Verify your payment method</h2>
    <p class="product-flow-lead">StudentOS verifies your payment method before preparing your workspace. This access step does not claim that a payment has been completed.</p>
    <div class="product-note-card">
      <strong>No charge is created here</strong>
      <p>${enabled ? "You can safely continue through this access check without a real charge or recurring payment instruction." : "This access step is not available yet. Your workspace will stay locked until payment verification is ready."}</p>
    </div>
    <button class="primary-button" type="button" data-product-action="verify-payment" ${enabled ? "" : "disabled"}>Continue setup</button>
    <p class="form-help">Selected start: ${escapeHtml(lifecycle.accessMode === "trial" ? "7-day Trial Mode" : productPlanName(lifecycle.selectedPlanId))}</p>
  `;
}

function legalStepMarkup(lifecycle) {
  const agreements = [
    ["termsOfService", "I agree to the Terms of Service."],
    ["privacyPolicy", "I agree to the Privacy Policy."],
    ["trialBilling", "I understand the 7-day Trial Mode and automatic subscription billing."],
    ["trialLimits", "I understand Trial Mode has limited access and is not the same as my selected paid plan."],
    ["paymentMandate", "I authorize StudentOS and its payment partner to verify my payment method and create a recurring payment mandate."],
    ["cancellationWindow", "I understand I can cancel before the trial ends."],
    ["academicDataUse", "I understand StudentOS uses my academic files, timetable, Classroom data, and notes to build my workspace."],
    ["noOutcomeGuarantee", "I understand StudentOS is a study assistant and does not guarantee marks, rankings, admissions, or exam results."],
    ["responsibleUse", "I agree to use StudentOS responsibly and not for academic misconduct."],
    ["aiAccuracy", "I understand AI-generated outputs may contain mistakes and should be checked before use."],
  ];
  const draft = lifecycle.legalConsentDraft || {};
  const draftConsents = draft.consents || lifecycle.legalConsents || {};
  return `
    <p class="eyebrow">Required agreement</p>
    <h2 id="product-flow-title">Review before we build your workspace</h2>
    <p class="product-flow-lead">Please review each item separately. All acknowledgements are required before onboarding.</p>
    <form id="product-legal-form" class="product-flow-form">
      <fieldset class="legal-check-list">
        <legend>Terms, privacy, and responsible use</legend>
        ${agreements.map(([name, label]) => `<label class="check-row"><input name="${name}" type="checkbox" required ${draftConsents[name] ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`).join("")}
      </fieldset>
      <fieldset class="age-gate-list">
        <legend>Age and consent</legend>
        <label class="check-row"><input name="ageGate" type="radio" value="adult" required ${draft.ageGate === "adult" || lifecycle.ageGate === "adult" ? "checked" : ""}><span>I am 18 or older.</span></label>
        <label class="check-row"><input name="ageGate" type="radio" value="minor" required ${draft.ageGate === "minor" || lifecycle.ageGate === "minor" ? "checked" : ""}><span>I am under 18 and have parent/guardian consent.</span></label>
        <label class="check-row guardian-ack"><input name="guardianConsentAcknowledged" type="checkbox" ${draft.guardianConsentAcknowledged || lifecycle.guardianConsentAcknowledged ? "checked" : ""}><span>If I am under 18, I confirm my parent or guardian has reviewed and agreed to this setup.</span></label>
      </fieldset>
      <div id="product-flow-message" class="result-box" aria-live="polite"></div>
      <button class="primary-button" type="submit">Agree and continue</button>
    </form>
  `;
}

function onboardingStepMarkup(lifecycle, step) {
  const page = ONBOARDING_PAGE_COPY[step];
  const saved = lifecycle.onboarding?.answers?.[step] || {};
  if (step === "about_you") {
    return `
      <div class="product-name-step">
        <p class="eyebrow">Welcome to StudentOS</p>
        <h2 id="product-flow-title">What is your name?</h2>
        <p class="product-flow-lead">${escapeHtml(page.copy)}</p>
        <form id="product-onboarding-form" class="product-flow-form" data-step="about_you">
          <label for="product-display-name">Your name</label>
          <input id="product-display-name" name="displayName" type="text" value="${escapeHtml(saved.displayName || state.studentProfile?.displayName || "")}" placeholder="Enter your name" autocomplete="name" required autofocus>
          <div id="product-flow-message" class="result-box" aria-live="polite"></div>
          <button class="primary-button" type="submit">Continue</button>
        </form>
      </div>
    `;
  }
  return `
    <p class="eyebrow">Guided setup</p>
    <h2 id="product-flow-title">${escapeHtml(page.title)}</h2>
    <p class="product-flow-lead">${escapeHtml(page.copy)}</p>
    ${page.detail ? `<p class="product-guidance-example">${escapeHtml(page.detail)}</p>` : ""}
    <form id="product-onboarding-form" class="product-flow-form ${step === "education_system" ? "academic-identity-form" : ""}" data-step="${escapeHtml(step)}">
      ${step === "academic_context" ? academicContextUploadMarkup() : ""}
      <div class="${step === "education_system" ? "academic-identity-grid" : "product-field-stack"}">
      ${page.fields.map((field) => {
        const fieldId = `product-${step}-${field.name}`;
        return `
        <label for="${escapeHtml(fieldId)}">${escapeHtml(field.label)}
          ${field.multiline
            ? `<textarea id="${escapeHtml(fieldId)}" name="${escapeHtml(field.name)}" rows="4" placeholder="${escapeHtml(field.placeholder)}">${escapeHtml(saved[field.name] || "")}</textarea>`
            : `<input id="${escapeHtml(fieldId)}" name="${escapeHtml(field.name)}" type="text" value="${escapeHtml(saved[field.name] || "")}" placeholder="${escapeHtml(field.placeholder)}" ${field.required ? "required" : ""}>`}
        </label>
      `; }).join("")}
      </div>
      <div id="product-flow-message" class="result-box" aria-live="polite"></div>
      <div class="product-form-actions">
        <button class="primary-button" type="submit">Save and continue</button>
        ${step === "about_you" ? "" : `<button class="text-button" type="submit" name="skipStep" value="true">Skip for now</button>`}
      </div>
    </form>
  `;
}

function classroomStepMarkup(lifecycle) {
  const starterCourseOnly = starterCourseOnlyClassroom();
  if (lifecycle.classroomChoice === "classroom" && !lifecycle.classroomConnectedAt) {
    return `
      <p class="eyebrow">Classroom setup</p>
      <h2 id="product-flow-title">Connect Google Classroom</h2>
      <p class="product-flow-lead">${starterCourseOnly ? "Starter uses Classroom only to help set up your course list. Upload PDFs manually to add assignments or materials." : "Connect your account so StudentOS can show coursework you may want to add to your academic context."}</p>
      <div id="product-flow-message" class="result-box" aria-live="polite"></div>
      <button class="primary-button" type="button" data-product-action="connect-classroom">Connect Google Classroom</button>
      <button class="text-button" type="button" data-product-action="choose-path" data-choice="manual">My institution does not use Classroom</button>
    `;
  }
  return `
    <p class="eyebrow">Classroom or manual setup</p>
    <h2 id="product-flow-title">How should StudentOS find your coursework?</h2>
    <p class="product-flow-lead">Choose the path that matches your institution. Both paths lead to the same calm academic workspace.</p>
    <div id="product-flow-message" class="result-box" aria-live="polite"></div>
    <div class="product-choice-grid">
      <button class="choice-card" type="button" data-product-action="choose-path" data-choice="classroom">
        <strong>Connect Google Classroom</strong>
        <span>${starterCourseOnly ? "Use Classroom to help set up your course list." : "Choose coursework to include in your academic context."}</span>
      </button>
      <button class="choice-card" type="button" data-product-action="choose-path" data-choice="manual">
        <strong>My institution does not use Classroom</strong>
        <span>Add your own subjects and materials now or later.</span>
      </button>
    </div>
  `;
}

function materialCandidates() {
  const courses = new Map((state.courses || []).map((course) => [course.id, course.title]));
  const rows = [
    ...(state.sourceMaterials || []).filter((item) => item.source !== "google_classroom" && item.provider !== "google_classroom").map((item) => ({
      id: item.id,
      title: item.title,
      course: courses.get(item.courseId) || "Academic context",
      type: "Uploaded file",
      date: item.updateTime || item.updatedAt || item.creationTime || item.createdAt || item.dueDate || item.importedAt || "",
    })),
    ...(state.classroomItems || []).filter((item) => item.selectionState !== "archived").map((item) => ({
      id: item.id,
      title: item.title,
      course: item.courseTitle || "Classroom course",
      type: item.itemType === "assignment" ? "Classroom assignment" : "Classroom material",
      date: item.providerUpdatedAt || item.postedAt || item.dueAt || "",
    })),
  ];
  return rows.sort((left, right) => timestampFor(right.date) - timestampFor(left.date));
}

function materialsStepMarkup(lifecycle) {
  const candidates = materialCandidates();
  const classroom = lifecycle.classroomChoice === "classroom";
  const starterCourseOnly = classroom && starterCourseOnlyClassroom();
  const draft = lifecycle.materialsDraft || {};
  const draftIds = new Set((draft.materialIds || []).length ? draft.materialIds : lifecycle.selectedMaterialIds || []);
  const draftLabels = (draft.materialLabels || []).length ? draft.materialLabels : lifecycle.selectedMaterialLabels || [];
  const capacity = currentAcademicContextCapacity();
  const addBlocked = capacity.canAdd !== true;
  return `
    <p class="eyebrow">Select academic materials</p>
    <h2 id="product-flow-title">Choose what belongs in your first workspace</h2>
    <p class="product-flow-lead">${starterCourseOnly ? "Starter uses Classroom only to help set up your course list. Upload PDFs manually to add assignments or materials." : classroom ? "Choose Classroom work to add to your academic context." : "Add a few material names now, or continue and add them later."}</p>
    <form id="product-materials-form" class="product-flow-form">
      ${starterCourseOnly ? `<div class="product-empty-state"><strong>Your course list is ready</strong><p>Finish Setup, then use Academic Context to upload assignment or material PDFs against a course.</p></div>` : candidates.length ? `<div class="material-choice-list">${candidates.map((item) => `
        <label class="check-row material-choice-row">
          <input name="materialIds" type="checkbox" value="${escapeHtml(item.id)}" data-material-label="${escapeHtml(item.title)}" ${draftIds.has(item.id) ? "checked" : ""} ${addBlocked && !draftIds.has(item.id) ? "disabled" : ""}>
          <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.course)} · ${escapeHtml(item.type)}${item.date ? ` · ${escapeHtml(formatDate(item.date))}` : ""}</small></span>
        </label>
      `).join("")}</div>` : `<div class="product-empty-state"><strong>${classroom ? "No selected Classroom work yet" : "No materials are waiting yet"}</strong><p>${classroom ? "Choose Classroom work to include in your academic context when it appears." : "You can continue now and add material when your workspace is ready."}</p></div>`}
      ${classroom ? "" : `<label for="product-material-labels">Materials you may add<textarea id="product-material-labels" name="materialLabels" rows="4" placeholder="For example, Chemistry syllabus&#10;Statistics lecture notes">${escapeHtml(draftLabels.join("\n"))}</textarea></label>`}
      ${academicContextCapacityMarkup()}
      <p class="form-help">You can add or remove materials later from Academic Context.</p>
      <button class="primary-button" type="submit">Continue to setup summary</button>
    </form>
  `;
}

function summaryValue(lifecycle, key, fallback = "Not provided yet") {
  const answers = lifecycle.onboarding?.answers || {};
  for (const step of Object.values(answers)) {
    if (step?.[key]) return step[key];
  }
  return fallback;
}

function setupSummaryMarkup(lifecycle) {
  const materialLabels = lifecycle.selectedMaterialLabels || [];
  return `
    <p class="eyebrow">Setup summary</p>
    <h2 id="product-flow-title">Does this look right?</h2>
    <p class="product-flow-lead">Here is what StudentOS will use to prepare your first Today view.</p>
    <dl class="setup-summary-list">
      <div><dt>Name</dt><dd>${escapeHtml(state.studentProfile?.displayName || "Student")}</dd></div>
      <div><dt>Level</dt><dd>${escapeHtml(summaryValue(lifecycle, "level"))}</dd></div>
      <div><dt>Institution</dt><dd>${escapeHtml(summaryValue(lifecycle, "institution"))}</dd></div>
      <div><dt>Stream or course</dt><dd>${escapeHtml(summaryValue(lifecycle, "stream", summaryValue(lifecycle, "course")))}</dd></div>
      <div><dt>Year or semester</dt><dd>${escapeHtml(summaryValue(lifecycle, "yearSemester"))}</dd></div>
      <div><dt>Subjects or courses</dt><dd>${escapeHtml(summaryValue(lifecycle, "subjects"))}</dd></div>
      <div><dt>Exam pattern</dt><dd>${escapeHtml(summaryValue(lifecycle, "examPattern"))}</dd></div>
      <div><dt>Timetable</dt><dd>${escapeHtml(summaryValue(lifecycle, "schedule"))}</dd></div>
      <div><dt>Setup path</dt><dd>${escapeHtml(lifecycle.classroomChoice === "classroom" ? "Google Classroom" : "Manual academic context")}</dd></div>
      <div><dt>Selected materials</dt><dd>${escapeHtml(materialLabels.length ? materialLabels.join(", ") : "Add later")}</dd></div>
    </dl>
    <div class="product-form-actions">
      <button class="primary-button" type="button" data-product-action="confirm-summary">Prepare my workspace</button>
      <button class="secondary-button" type="button" data-product-action="edit-setup" data-target-step="academic_context">Edit details</button>
    </div>
    <div id="product-flow-message" class="result-box" aria-live="polite"></div>
  `;
}

function preparationStepMarkup() {
  return `
    <p class="eyebrow">Preparing Workspace</p>
    <h2 id="product-flow-title">Preparing your workspace</h2>
    <p class="product-flow-lead">StudentOS is organizing what you shared into your first Today view.</p>
    <ul class="preparation-list">
      <li>Reading your academic context</li>
      <li>Organizing your courses</li>
      <li>Preparing your first study plan</li>
      <li>Checking upcoming work</li>
      <li>Building your Today view</li>
    </ul>
    <div id="product-flow-message" class="result-box" aria-live="polite"></div>
    <button class="primary-button" type="button" data-product-action="prepare-workspace">Continue to quick tour</button>
  `;
}

function tutorialStepMarkup(lifecycle) {
  if (lifecycle.tutorialChoice === "show") {
    return `
      <p class="eyebrow">Quick tour</p>
      <h2 id="product-flow-title">Four places to begin</h2>
      <div class="tutorial-grid">
        <article><strong>Today</strong><p>See the clearest next study action.</p></article>
        <article><strong>Academic Context</strong><p>Keep subjects and selected material current.</p></article>
        <article><strong>Ask StudentOS</strong><p>Ask one assistant for explanations, plans, and revision help.</p></article>
        <article><strong>Account</strong><p>Review your plan, privacy choices, and data controls.</p></article>
      </div>
      <button class="primary-button" type="button" data-product-action="complete-tutorial">Enter Today</button>
    `;
  }
  return `
    <p class="eyebrow">Workspace ready</p>
    <h2 id="product-flow-title">Would you like a quick tour before entering Today?</h2>
    <p class="product-flow-lead">The short tour covers Today, Academic Context, Ask StudentOS, and where to adjust your setup.</p>
    <div class="product-choice-grid">
      <button class="choice-card" type="button" data-product-action="choose-tutorial" data-choice="show"><strong>Show tutorial</strong><span>See the four main parts of StudentOS.</span></button>
      <button class="choice-card" type="button" data-product-action="choose-tutorial" data-choice="skip"><strong>Skip for now</strong><span>Open Today immediately.</span></button>
    </div>
  `;
}

function renderProductFlow() {
  const lifecycle = state?.productLifecycle;
  if (!els.productFlowContent) return;
  if (!lifecycle) {
    els.productFlowContent.innerHTML = `${loadingMarkup("Loading your StudentOS setup...")}<p>Your workspace will stay closed until setup is ready.</p>`;
    return;
  }
  renderProductProgress(lifecycle);
  const step = lifecycle.nextStep;
  els.productFlowContent.dataset.productStep = step;
  if (step === "pricing") els.productFlowContent.innerHTML = pricingStepMarkup();
  else if (step === "trial_choice") els.productFlowContent.innerHTML = trialChoiceMarkup(lifecycle);
  else if (step === "payment_method") els.productFlowContent.innerHTML = paymentStepMarkup(lifecycle);
  else if (step === "legal_consent") els.productFlowContent.innerHTML = legalStepMarkup(lifecycle);
  else if (ONBOARDING_PAGE_COPY[step]) els.productFlowContent.innerHTML = onboardingStepMarkup(lifecycle, step);
  else if (step === "classroom_setup") els.productFlowContent.innerHTML = classroomStepMarkup(lifecycle);
  else if (step === "materials") els.productFlowContent.innerHTML = materialsStepMarkup(lifecycle);
  else if (step === "setup_summary") els.productFlowContent.innerHTML = setupSummaryMarkup(lifecycle);
  else if (step === "workspace_preparation") els.productFlowContent.innerHTML = preparationStepMarkup(lifecycle);
  else if (step === "tutorial") els.productFlowContent.innerHTML = tutorialStepMarkup(lifecycle);
  else els.productFlowContent.innerHTML = `<p class="eyebrow">Setup</p><h2 id="product-flow-title">Continue your StudentOS setup</h2><p>Your next step is ready.</p>`;
  if (lifecycle.canGoPrevious) {
    els.productFlowContent.insertAdjacentHTML("beforeend", `
      <nav class="product-step-navigation" aria-label="Setup navigation">
        <button class="secondary-button product-previous-button" type="button" data-product-action="previous-step">Previous</button>
      </nav>
    `);
  }
  renderProductPersistenceStatus();
  if (step === "materials" && lifecycle.classroomChoice === "classroom" && lifecycle.classroomConnectedAt && !productClassroomRefreshAttempted) {
    productClassroomRefreshAttempted = true;
    window.setTimeout(() => refreshClassroomForProductFlow(), 0);
  }
}

function setupFieldValue(name, value) {
  const field = els.onboardingForm?.elements?.namedItem(name);
  if (field) field.value = value === null || value === undefined ? "" : String(value);
}

function derivedSubjectLines() {
  return (state.courses || [])
    .filter((course) => course.source !== "google_classroom")
    .map((course) => {
      const topics = (state.topics || []).filter((topic) => topic.courseId === course.id).map((topic) => topic.title);
      const parts = [course.title || "", course.examDate ? String(course.examDate).slice(0, 10) : "", topics.join(", ")];
      return parts.some((part, index) => index > 0 && part) ? parts.join("|") : parts[0];
    })
    .filter(Boolean)
    .join("\n");
}

function derivedTopicLines(predicate) {
  const grouped = new Map();
  for (const topic of (state.topics || []).filter(predicate)) {
    const courseTitle = courseById(topic.courseId)?.title || "";
    if (!grouped.has(courseTitle)) grouped.set(courseTitle, []);
    grouped.get(courseTitle).push(topic.title);
  }
  return [...grouped.entries()].map(([courseTitle, topics]) => `${courseTitle ? `${courseTitle}: ` : ""}${topics.join(", ")}`).join("\n");
}

function derivedTimetableLines() {
  return (state.timetable || []).map((item) => {
    const startsAt = new Date(item.startsAt);
    const time = Number.isNaN(startsAt.getTime()) ? "" : startsAt.toTimeString().slice(0, 5);
    return [item.location || "", time, item.title || "", courseById(item.courseId)?.title || ""].join("|");
  }).join("\n");
}

function populateSetupFormFromState() {
  if (!els.onboardingForm || els.onboardingForm.contains(document.activeElement)) return;
  const profile = state.studentProfile || {};
  const preferences = profile.preferences || {};
  setupFieldValue("displayName", profile.displayName || "");
  setupFieldValue("stream", preferences.stream || "");
  setupFieldValue("classLevel", preferences.classLevel || profile.gradeBand || "");
  setupFieldValue("academicGoal", preferences.academicGoal || "");
  setupFieldValue("dailyStudyAvailabilityMinutes", preferences.dailyStudyAvailabilityMinutes || "");
  setupFieldValue("studyBreakPattern", preferences.studyBreakPattern || "");
  setupFieldValue("subjectsText", preferences.subjectsText || derivedSubjectLines());
  setupFieldValue("weakTopicsText", preferences.weakTopicsText || derivedTopicLines((topic) => (topic.weakSignals || []).length > 0));
  setupFieldValue("completedTopicsText", preferences.completedTopicsText || derivedTopicLines((topic) => topic.coverageState === "covered"));
  setupFieldValue("timetableText", preferences.timetableText || preferences.scheduleText || derivedTimetableLines());
}

function render() {
  if (!state) return;
  updateShellVisibility();
  if (productSetupActive()) {
    renderProductFlow();
    return;
  }
  const lifecyclePlan = productPlan(state.productLifecycle?.selectedPlanId);
  const accountPlan = productPlan(accountSnapshot?.planAccess?.plan?.selected?.planKey || accountSnapshot?.quota?.plan?.selected?.planKey);
  const plan = lifecyclePlan || accountPlan || pendingPlanSummary();
  els.studentName.textContent = state.studentProfile.displayName || "Student";
  els.creditBalance.textContent = state.creditBalance || 0;
  els.planBadge.textContent = plan.displayName || plan.label || "Plan setup pending";
  els.studyRhythm.textContent = humanize(state.studentProfile.studyRhythm || "not set");
  els.creditEligibility.textContent = humanize(state.studentProfile.convenienceEligibility || "learning first");
  const backendPersistence = runtimeConfig.persistence || {};
  els.connectorStatus.textContent = backendModeLabel(backendPersistence.mode || state.persistence?.mode || "unknown mode");
  populateSetupFormFromState();
  renderClassroomPanel();
  renderDashboardSummary();
  renderRoadmap();
  renderTimetable();
  renderAssignments();
  renderCourses();
  renderSources();
  renderSelects();
  renderAccount();
  updateProductFeatureControls();
}

function renderDashboardSummary() {
  const preferences = state.studentProfile?.preferences || {};
  const upcomingExams = [...(state.exams || [])]
    .sort((left, right) => timestampFor(left.examDate) - timestampFor(right.examDate))
    .slice(0, 3);
  const weakTopics = (state.topics || [])
    .filter((topic) => (topic.weakSignals || []).length || topic.mastery === "revision_required")
    .slice(0, 5);
  const openRoadmap = (state.roadmap || []).filter((item) => item.status === "open");
  const completedRoadmap = (state.roadmap || []).filter((item) => item.status === "done" || item.status === "completed");
  const activeSources = (state.sourceMaterials || []).filter((source) => !source.deletedAt);
  const indexedSources = activeSources.filter((source) => source.status === "indexed");
  const dueAssignments = getDueAssignments();
  const dueSoon = dueAssignments[0] || null;
  const nextBlock = getNextTimetableBlock();
  const nextActions = getNextActions();
  const nextAction = nextActions[0] || null;
  const nextCourse = courseById(dueSoon?.courseId || nextAction?.courseId);
  const nextTopic = topicById(dueSoon?.topicIds?.[0] || nextAction?.topicId);
  const nextExam = upcomingExams[0] || null;
  if (!nextAction && !dueSoon) {
    const guidance = [];
    if (!(state.courses || []).length) guidance.push("Add your subjects in Setup so StudentOS can plan today.");
    if (!(state.timetable || []).length) guidance.push("Add your timetable so Today can protect your study time.");
    if (!(state.exams || []).length && !(state.assignments || []).length) guidance.push("Add upcoming exams or assignments to build your first plan.");
    setResult(els.dashboardSummary, `
      <article class="today-brief-card today-empty-card">
        <div class="today-brief-copy">
          <p class="eyebrow">Today Command Center</p>
          <h3><span>Today</span>No study task yet.</h3>
          ${list(guidance.length ? guidance : ["Your current study list is clear."])}
        </div>
      </article>
    `);
    return;
  }
  const availability = preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes || null;
  const doNowTitle = studentTaskTitle(dueSoon?.title || nextAction?.title);
  const doNowContext = [
    nextCourse?.title || dueSoon?.courseTitle || nextAction?.courseTitle,
    nextTopic?.title || nextAction?.topicTitle,
  ].filter(Boolean).join(" / ") || "Your academic context";
  const riskCopy = weakTopics.map((topic) => topic.title).join(" / ") || "No weak topics yet";
  const planPrompt = buildTodayPlanPrompt(dueSoon || nextAction, dueSoon, nextBlock);
  const reviewRequired = dueSoon?.reviewRequired === true;
  const dueSoonTimestamp = timestampFor(dueSoon?.dueAt || dueSoon?.dueDate);
  const dueSoonOverdue = Number.isFinite(dueSoonTimestamp) && dueSoonTimestamp < Date.now();
  setResult(els.dashboardSummary, `
    <article class="today-brief-card">
      <div class="today-brief-copy">
        <p class="eyebrow">Today Command Center</p>
        <h3><span>Do now</span>${escapeHtml(doNowTitle)}</h3>
        <p>Goal: ${escapeHtml(getAcademicGoalLabel())}${preferences.stream || state.studentProfile?.gradeBand ? ` / ${escapeHtml(preferences.stream || state.studentProfile?.gradeBand)}` : ""}</p>
        <div class="tag-row">
          ${tag(doNowContext, "source")}
          ${reviewRequired ? tag("Review and add", "medium") : ""}
          ${dueSoonOverdue ? tag("Overdue", "urgent") : ""}
          ${availability ? tag(`${availability} min available`, "source") : ""}
          ${preferences.studyBreakPattern ? tag(studyBreakLabel(preferences.studyBreakPattern), "medium") : ""}
        </div>
      </div>
      <div class="today-brief-actions">
        ${reviewRequired
          ? `<button class="primary-button" type="button" data-classroom-item-id="${escapeHtml(dueSoon.classroomItemId || dueSoon.id)}">Review and add</button>`
          : `<button class="primary-button ai-context-button" type="button" data-ai-open data-ai-verb="Plan" data-ai-prompt="${escapeHtml(planPrompt)}">Plan this block</button>`}
      </div>
    </article>
    <div class="today-status-strip" role="list" aria-label="Today status">
      <article class="today-status-item" role="listitem">
        <span>Next exam</span>
        <strong>${escapeHtml(nextExam ? formatDate(nextExam.examDate) : "None")}</strong>
        <p>${escapeHtml(nextExam ? nextExam.title : "Add exams in setup")}</p>
      </article>
      <article class="today-status-item" role="listitem">
        <span>Risk</span>
        <strong>${weakTopics.length ? `${weakTopics.length} topic(s)` : "Clear"}</strong>
        <p>${escapeHtml(riskCopy)}</p>
      </article>
      <article class="today-status-item" role="listitem">
        <span>${dueSoonOverdue ? "Overdue" : "Due soon"}</span>
        <strong>${escapeHtml(dueSoon ? formatDate(dueSoon.dueDate) : "None")}</strong>
        <p>${escapeHtml(dueSoon?.title || "No due work listed")}</p>
      </article>
      <article class="today-status-item" role="listitem">
        <span>Next block</span>
        <strong>${escapeHtml(nextBlock ? formatTime(nextBlock.startsAt) : "Open")}</strong>
        <p>${escapeHtml(nextBlock?.title || "Add your timetable so Today can protect your study time.")}</p>
      </article>
      <article class="today-status-item" role="listitem">
        <span>Materials</span>
        <strong>${activeSources.length ? "Sources ready" : "Add sources"}</strong>
        <p>${escapeHtml(activeSources.filter((source) => source.status === "needs_ocr").length ? "Some need review" : `${indexedSources.length} ready for study`)}</p>
      </article>
      <article class="today-status-item" role="listitem">
        <span>Roadmap</span>
        <strong>${openRoadmap.length ? `${openRoadmap.length} next` : "Clear"}</strong>
        <p>${escapeHtml(completedRoadmap.length ? `${completedRoadmap.length} finished` : "Add upcoming work in Setup")}</p>
      </article>
    </div>
  `);
}

function renderRoadmap() {
  const actions = getNextActions();
  if (!actions.length) {
    setResult(els.roadmapList, `
      <article class="item-card roadmap-empty-card">
        <strong>No study task yet.</strong>
        <p>Add upcoming exams or assignments to build your first plan.</p>
      </article>
    `);
    return;
  }
  setResult(els.roadmapList, actions.slice(0, 5).map((item) => {
    const topic = topicById(item.topicId);
    const course = courseById(item.courseId);
    const isPrimary = item === actions[0];
    const itemTitle = studentTaskTitle(item.title);
    const prompt = `Plan a focused study block for ${itemTitle}. Use my course context, due work, timetable, and sources.`;
    const priorityLabel = item.priority ? (item.priority === "high" ? "Important" : humanize(item.priority)) : "Study focus";
    return `
      <article class="item-card roadmap-card ${isPrimary ? "roadmap-primary" : "roadmap-secondary"}">
        ${isPrimary ? `<span class="queue-label">First up</span>` : ""}
        <strong>${escapeHtml(itemTitle)}</strong>
        <p>${escapeHtml(item.courseTitle || course?.title || "Course")} / ${escapeHtml(item.topicTitle || topic?.title || "Topic")}</p>
        <div class="item-meta">
          ${tag(priorityLabel, item.priority || "source")}
          ${tag(formatDate(item.dueAt))}
          ${tag(humanize(item.kind))}
          ${item.examPressure ? tag(item.examPressure === "critical" ? "Exam soon" : "Exam focus", item.examPressure === "critical" ? "urgent" : "medium") : ""}
        </div>
        ${isPrimary ? `<button class="mini-action ai-context-button" type="button" data-ai-open data-ai-verb="Plan" data-ai-prompt="${escapeHtml(prompt)}">Plan item</button>` : ""}
      </article>
    `;
  }).join(""));
}

function renderTimetable() {
  const blocks = sortedByDate(state.timetable || [], (item) => item.startsAt);
  if (!blocks.length) {
    setResult(els.timetableList, `
      <article class="item-card timetable-empty-card">
        <strong>No blocks listed</strong>
        <p>Add your timetable so Today can protect your study time.</p>
        <div class="item-meta">${tag("schedule open", "medium")}</div>
      </article>
    `);
    return;
  }
  setResult(els.timetableList, blocks.map((item) => {
    const course = courseById(item.courseId);
    return `
      <article class="item-card timetable-card">
        <strong>${escapeHtml(item.title)}</strong>
        <p>${formatTime(item.startsAt)} - ${formatTime(item.endsAt)} / ${escapeHtml(item.location)}</p>
        <div class="item-meta">${tag(course?.title || "Study")}</div>
      </article>
    `;
  }).join(""));
}

function renderClassroomPanel() {
  if (!els.classroomPanel) return;
  const connector = activeClassroomConnector();
  const summary = classroomStatus?.syncSummary || connector.syncSummary || null;
  const history = classroomStatus?.syncHistory || connector.syncHistory || [];
  const providerEmail = connector.providerAccountEmail || "";
  const lastSync = connector.lastSyncAt || history[0]?.completedAt || "";
  const actions = updateClassroomActions(connector);
  const ui = classroomUi(connector, summary, history);
  const stateName = normalizedClassroomState(connector);
  const emptyClassroom = summary?.emptyClassroom || history.some((run) => run.payload?.emptyClassroom);
  const showDetails = summary || history.length;
  const policy = currentClassroomPolicy();
  const courseOnly = policy.courseOnly === true;
  const cadence = String(policy.cadence || "").toLowerCase();
  const cadenceCopy = cadence.includes("weekly")
    ? "weekly"
    : cadence.includes("five days")
      ? "every five days"
      : cadence.includes("three days")
        ? "every three days"
        : cadence.includes("trial")
          ? "once during Trial Mode"
          : "from time to time";
  const checkPolicyCopy = courseOnly
    ? "Starter uses Classroom only to help set up your course list. Upload PDFs manually to add assignments or materials."
    : policy.automaticChecksEnabled
    ? `StudentOS checks for new coursework ${cadenceCopy}. You choose what to include.`
    : "Classroom coursework refreshes only when you ask. You choose what to include.";
  setResult(els.classroomPanel, `
    <div class="classroom-compact-head">
      <div>
        <strong>${escapeHtml(ui.title || classroomModeLabel(stateName))}</strong>
        <p>${escapeHtml(courseOnly ? "Classroom courses can help set up your course list. Upload PDFs manually on Starter." : ui.message || "StudentOS can include Classroom coursework in your study plan.")}</p>
      </div>
      ${summary ? `<span>${escapeHtml(courseOnly ? `${summary.discoveredCourses || 0} course(s) ready` : `${summary.discoveredAssignments || 0} new to review / ${summary.updatedAssignments || 0} refreshed`)}</span>` : ""}
    </div>
    <div class="tag-row">
      ${tag(courseOnly ? "Course list setup" : ui.badge || classroomModeLabel(stateName), stateName === "reconnect_required" ? "medium" : "source")}
      ${lastSync ? tag(`checked ${formatDate(lastSync)}`, "source") : ""}
      ${providerEmail && stateName === "connected" ? tag("connected account", "source") : ""}
    </div>
    ${courseOnly ? `<p>Refresh your course list when Setup changes.</p>` : ui.detail ? `<p>${escapeHtml(ui.detail)}</p>` : actions.sync ? `<p>Check Classroom when you want to review the latest work.</p>` : ""}
    <p class="muted-copy">${escapeHtml(checkPolicyCopy)}</p>
    ${emptyClassroom && !courseOnly ? `<p class="muted-copy">No active Classroom coursework was found. StudentOS is ready to refresh when new work appears.</p>` : ""}
    ${showDetails ? `
      <details class="classroom-details">
        <summary>Recent checks</summary>
        ${summary ? `<p>${escapeHtml(courseOnly ? `${summary.discoveredCourses || 0} course(s) available for Setup` : `${summary.discoveredCourses || 0} course(s), ${summary.discoveredAssignments || 0} new assignment(s) to review, ${summary.updatedAssignments || 0} refreshed${summary.emptyClassroom ? " / no active coursework" : ""}`)}</p>` : ""}
        ${history.length ? `
          <div class="mini-history">
            ${history.slice(0, 4).map((run) => `
              <span>${escapeHtml(humanize(run.status))}: ${escapeHtml(formatDate(run.completedAt || run.startedAt))}${courseOnly ? " / course list checked" : ` / ${run.discoveredAssignments || 0} new, ${run.updatedAssignments || 0} refreshed`}${run.errorCount ? " / needs review" : ""}</span>
            `).join("")}
          </div>
        ` : ""}
      </details>
    ` : ""}
  `);
}

function classroomStatusCard() {
  const connector = activeClassroomConnector();
  const summary = classroomStatus?.syncSummary || connector.syncSummary || null;
  const history = classroomStatus?.syncHistory || connector.syncHistory || [];
  const providerEmail = connector.providerAccountEmail || "";
  const lastSync = connector.lastSyncAt || history[0]?.completedAt || "";
  const classroomItems = state.classroomItems || [];
  const selectedItems = classroomItems.filter((item) => item.academicContextIncluded).length;
  const reviewItems = classroomItems.filter((item) => item.selectionState === "discovered").length;
  const stateName = normalizedClassroomState(connector);
  const ui = classroomUi(connector, summary, history);
  const emptyClassroom = summary?.emptyClassroom || history.some((run) => run.payload?.emptyClassroom);
  const courseOnly = starterCourseOnlyClassroom();
  if (["disabled", "setup_required", "status_pending"].includes(stateName) && !classroomItems.length) {
    return "";
  }
  return `
    <article class="course-card course-workspace-card classroom-import-card" data-color="sky">
      <header class="course-card-head">
        <div>
          <span class="workspace-label">Classroom workspace</span>
          <strong>Google Classroom</strong>
          <p>${providerEmail ? `Connected as ${escapeHtml(providerEmail)}` : courseOnly ? "Course list setup" : "Choose what to add"}</p>
        </div>
      </header>
      <div class="tag-row">
        ${tag(courseOnly ? "Course list setup" : ui.badge || classroomModeLabel(stateName), stateName === "reconnect_required" ? "medium" : "source")}
        ${courseOnly ? tag("Course list only", "source") : tag(`${selectedItems} selected`, "source")}
        ${courseOnly ? "" : tag(`${reviewItems} to review`, reviewItems ? "medium" : "source")}
        ${lastSync ? tag(`checked ${formatDate(lastSync)}`, "source") : tag("check when ready", "medium")}
        ${tag("student controlled", "source")}
      </div>
      <div class="course-signal-grid">
        <span><strong>${courseOnly ? state.courses.length : selectedItems}</strong> ${courseOnly ? "courses ready" : "selected for academic context"}</span>
        ${courseOnly ? "" : `<span><strong>${reviewItems}</strong> ready to review</span>`}
        <span><strong>${lastSync ? formatDate(lastSync) : "When ready"}</strong> last checked</span>
      </div>
      ${courseOnly ? `<p class="muted-copy">Classroom courses can help set up your course list. Upload PDFs manually on Starter.</p>` : emptyClassroom ? `<p class="muted-copy">No active Classroom coursework was found yet.</p>` : ""}
      ${stateName === "reconnect_required" ? `<p class="warning-copy">Reconnect Classroom to check for new work and refresh selected items.</p>` : ""}
    </article>
  `;
}

function renderAssignments() {
  const assignments = getDueAssignments();
  if (!assignments.length) {
    const connector = activeClassroomConnector();
    const actions = classroomActions(connector);
    const emptyCopy = actions.connect || actions.reconnect
      ? "Connect Classroom, or add work from your courses to start the learning loop."
      : "Add upcoming exams or assignments to build your first plan.";
    setResult(els.assignmentList, `
      <article class="item-card assignment-card">
        <strong>No assignments yet</strong>
        <p>${escapeHtml(emptyCopy)}</p>
        <div class="item-meta">
          ${tag("Student controlled", "source")}
        </div>
      </article>
    `);
    return;
  }
  setResult(els.assignmentList, assignments.map((assignment, index) => {
    const course = courseById(assignment.courseId);
    const insight = assignmentInsightById(assignment.id);
    const isClassroom = assignment.source === "google_classroom";
    const reviewRequired = assignment.reviewRequired === true;
    const isPrimary = index === 0;
    const primaryLabel = "Nearest deadline";
    const dueTimestamp = timestampFor(assignment.dueAt || assignment.dueDate);
    const dueLabel = Number.isFinite(dueTimestamp) && dueTimestamp < Date.now()
      ? "Overdue"
      : Number.isFinite(dueTimestamp) && dueTimestamp - Date.now() <= 72 * 60 * 60 * 1000
        ? "Due soon"
        : assignment.dueAt || assignment.dueDate
          ? "Upcoming"
          : "No due date";
    return `
      <article class="item-card assignment-card ${isPrimary ? "assignment-card-primary" : ""}">
        ${isPrimary ? `<span class="queue-label">${escapeHtml(primaryLabel)}</span>` : ""}
        <strong>${escapeHtml(assignment.title)}</strong>
        <p>${escapeHtml(course?.title || assignment.courseTitle || "Course")} / due ${formatDate(assignment.dueAt || assignment.dueDate)}</p>
        <div class="item-meta">
          ${tag(dueLabel, dueLabel === "Overdue" ? "urgent" : "medium")}
          ${isClassroom ? tag("Google Classroom", "source") : tag(humanize(assignment.source))}
          ${reviewRequired ? tag("Review to add", "medium") : isClassroom ? tag("Selected for academic context", "source") : ""}
          ${assignment.readOnly ? tag("Read-only", "source") : ""}
          ${!reviewRequired && insight ? tag(humanize(insight.status), toneForCoverage(insight.status)) : ""}
        </div>
        ${!reviewRequired && insight ? `<p class="muted-copy">${escapeHtml(insight.summary)}</p>` : reviewRequired ? `<p class="muted-copy">New Classroom work found. Review it before adding it to your academic context.</p>` : ""}
        ${reviewRequired
          ? `<button class="mini-action" type="button" data-classroom-item-id="${escapeHtml(assignment.classroomItemId || assignment.id)}">Review and add</button>`
          : `<button class="mini-action" type="button" data-flow-id="${assignment.id}">${isClassroom ? "Prepare assignment" : "Analyze"}</button>`}
      </article>
    `;
  }).join(""));
}

function renderCourses() {
  const courseCards = state.courses.map((course) => {
    const topics = getCourseTopics(course.id);
    const assignments = getCourseAssignments(course.id);
    const sources = getCourseSources(course.id);
    const roadmap = getCourseRoadmap(course.id);
    const weakTopics = topics.filter((topic) => (topic.weakSignals || []).length || topic.mastery === "revision_required" || topic.mastery === "not_started");
    const classroomAssignments = assignments.filter((assignment) => assignment.source === "google_classroom");
    const steadyTopics = topics.filter((topic) => ["secure", "strong"].includes(topic.mastery));
    const revisionCount = topics.filter((topic) => ["revision_required", "not_started"].includes(topic.mastery)).length;
    const progress = topics.length ? Math.round((steadyTopics.length / topics.length) * 100) : 0;
    const indexedSources = sources.filter(sourceIsIndexed);
    const nextAction = courseNextAction(course, assignments, roadmap);
    const nextActionLabel = nextAction?.dueAt || nextAction?.dueDate ? formatDate(nextAction.dueAt || nextAction.dueDate) : "Open";
    const sourcesReadyLabel = indexedSources.length ? "Ready" : sources.length ? "Needs review" : "Add materials";
    const nextActionReadyLabel = nextAction ? "Ready" : "Add work";
    const isClassroom = course.source === "google_classroom";
    const prompt = buildCourseAiPrompt(course, weakTopics, assignments, sources, nextAction);
    const courseDetails = [course.teacher, course.examDate ? `exam ${formatDate(course.examDate)}` : ""].filter(Boolean).join(" / ");
    return `
      <article class="course-card course-workspace-card" data-color="${escapeHtml(course.color || "mint")}">
        <header class="course-card-head">
          <div>
            <span class="workspace-label">Workspace preview</span>
            <strong>${escapeHtml(course.title)}</strong>
            ${courseDetails ? `<p>${escapeHtml(courseDetails)}</p>` : ""}
          </div>
          <button class="mini-action ai-context-button" type="button" data-ai-open data-ai-verb="Ask" data-ai-prompt="${escapeHtml(prompt)}">Ask about course</button>
        </header>

        <div class="course-progress-row">
          <div class="progress-track" aria-label="Mastery progress">
            <div class="progress-fill" style="width:${progress}%"></div>
          </div>
          <span>${topics.length ? (steadyTopics.length ? `${steadyTopics.length} topic${steadyTopics.length === 1 ? "" : "s"} on track` : "Topics ready for review") : "No topics added yet"}</span>
        </div>

        <div class="course-signal-grid">
          <span><strong>${weakTopics.length}</strong> weak topics</span>
          <span><strong>${assignments.length}</strong> due items</span>
          <span><strong>${escapeHtml(sourcesReadyLabel)}</strong> sources</span>
          <span><strong>${escapeHtml(nextActionReadyLabel)}</strong> next action</span>
        </div>

        <div class="tag-row">
          ${isClassroom ? tag("Google Classroom", "source") : ""}
          ${course.readOnly ? tag("Read-only", "source") : ""}
          ${isClassroom || course.readOnly ? tag("Student controlled", "source") : ""}
          ${revisionCount ? tag("Needs revision", "medium") : topics.length ? tag("On track", "source") : tag("Add topics", "medium")}
        </div>

        <div class="course-workspace-sections">
          <div>
            <span>Weak topics</span>
            <p>${escapeHtml(weakTopics.map((topic) => topic.title).slice(0, 3).join(" / ") || "No weak topics listed")}</p>
          </div>
          <div>
            <span>Due work</span>
            <p>${escapeHtml(assignments.slice(0, 2).map((assignment) => `${assignment.title} (${formatDate(assignment.dueDate)})`).join(" / ") || "No due work listed")}</p>
          </div>
          <div>
            <span>Materials</span>
            <p>${escapeHtml(sources.slice(0, 2).map((source) => source.title).join(" / ") || "Upload course material in Academic Context")}</p>
          </div>
          <div>
            <span>Next action</span>
            <p>${escapeHtml(nextAction ? `${studentTaskTitle(nextAction.title)} / ${nextActionLabel}` : "Generate or sync work to create a next action")}</p>
          </div>
        </div>
        ${isClassroom && !classroomAssignments.length ? `<p class="muted-copy">No selected Classroom work is waiting for this course.</p>` : ""}
      </article>
    `;
  }).join("");
  const empty = state.courses.length ? "" : `
    <article class="course-card course-workspace-card" data-color="sky">
      <span class="workspace-label">Workspace preview</span>
      <strong>No courses yet</strong>
      <p>Add your subjects in Setup so StudentOS can plan today.</p>
    </article>
  `;
  els.coursesGrid.innerHTML = `${classroomStatusCard()}${courseCards || empty}`;
}

function academicContextAssignmentStatus(assignment) {
  if (assignment.handedIn === true || ["completed", "done", "graded", "returned", "submitted"].includes(String(assignment.status || "").toLowerCase())) {
    return "Already handed in";
  }
  const due = timestampFor(assignment.dueAt || assignment.dueDate);
  if (Number.isFinite(due) && due < Date.now()) return "Overdue";
  if (Number.isFinite(due) && due - Date.now() <= 72 * 60 * 60 * 1000) return "Due soon";
  return "Not handed in";
}

function academicContextOrigin(item) {
  return item.source === "google_classroom" || item.provider === "google_classroom" ? "Classroom" : "Manual upload";
}

function academicContextPreview(isPdf = true) {
  return `<div class="academic-context-preview" aria-hidden="true"><span>${isPdf ? "PDF" : "DOC"}</span><small>Preview</small></div>`;
}

function academicContextOpenAction(url) {
  return url ? `<a class="mini-action" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open</a>` : "";
}

function renderSources() {
  const assignments = [...(state.assignments || [])]
    .filter((assignment) => !assignment.archived)
    .sort(sortStudentWork);
  const materials = (state.sourceMaterials || [])
    .filter((source) => !source.deletedAt && source.artifactKind !== "assignment")
    .sort((left, right) => classroomFreshnessTimestamp(right) - classroomFreshnessTimestamp(left));
  const courseOnly = starterCourseOnlyClassroom();
  const reviewEnabled = currentClassroomPolicy().courseworkReviewEnabled === true;
  const classroomReviewItems = reviewEnabled
    ? (state.classroomItems || [])
      .filter((item) => item.selectionState === "discovered" && !item.academicContextIncluded)
      .sort((left, right) => classroomFreshnessTimestamp(right) - classroomFreshnessTimestamp(left))
      .slice(0, 12)
    : [];
  const capacity = currentAcademicContextCapacity();
  const connector = activeClassroomConnector();
  const classroomStatusCopy = courseOnly
    ? "Classroom courses can help set up your course list. Upload PDFs manually on Starter."
    : classroomReviewItems.length
      ? "New Classroom work found"
      : normalizedClassroomState(connector) === "connected"
        ? "Classroom connected"
        : "Classroom can be connected in Setup";

  if (els.academicContextSummary) {
    els.academicContextSummary.innerHTML = `
      <article><strong>${assignments.length}</strong><span>Assignments included</span></article>
      <article><strong>${materials.length}</strong><span>Materials included</span></article>
      <article><strong>${escapeHtml(classroomStatusCopy)}</strong><span>Classroom status</span></article>
      <article><strong>${escapeHtml(capacity.message || "You have room for more material.")}</strong><span>Context room</span></article>
    `;
  }

  const assignmentCards = assignments.map((assignment) => {
    const course = courseById(assignment.courseId);
    const source = (state.sourceMaterials || []).find((item) => item.id === assignment.sourceMaterialId || (assignment.sourceMaterialIds || []).includes(item.id));
    const status = academicContextAssignmentStatus(assignment);
    const origin = academicContextOrigin(assignment);
    const prompt = `Help me study for ${assignment.title} in ${course?.title || assignment.courseTitle || "this course"}.`;
    return `
      <article class="source-card academic-context-card">
        ${academicContextPreview(origin === "Manual upload")}
        <div class="academic-context-card-body">
          <strong>${escapeHtml(assignment.title)}</strong>
          <p>${escapeHtml(course?.title || assignment.courseTitle || "Course")} / due ${escapeHtml(formatDate(assignment.dueAt || assignment.dueDate))}</p>
          <div class="tag-row">${tag(origin, "source")}${tag(status, status === "Overdue" ? "urgent" : status === "Due soon" ? "medium" : "source")}</div>
          <div class="source-action-row">
            ${academicContextOpenAction(assignment.alternateLink || source?.linkUrl)}
            <button class="mini-action ai-context-button" type="button" data-ai-open data-ai-verb="Ask" data-ai-prompt="${escapeHtml(prompt)}">Ask StudentOS</button>
            <button class="mini-action danger-action" type="button" data-delete-context-kind="assignment" data-delete-context-id="${escapeHtml(assignment.id)}">Delete</button>
          </div>
        </div>
      </article>
    `;
  }).join("") || `<article class="source-card source-empty-card"><strong>No assignments included</strong><p>Upload an assignment PDF and set its deadline to add due work.</p></article>`;

  const materialCards = materials.map((source) => {
    const course = courseById(source.courseId);
    const origin = academicContextOrigin(source);
    const prompt = buildSourceAiPrompt(source, course);
    const ready = source.readyForStudy || source.status === "indexed" || source.status === "ready";
    return `
      <article class="source-card academic-context-card">
        ${academicContextPreview(origin === "Manual upload")}
        <div class="academic-context-card-body">
          <strong>${escapeHtml(source.title)}</strong>
          <p>${escapeHtml(course?.title || "Course")}</p>
          <div class="tag-row">${tag(origin, "source")}${tag(ready ? "Ready for study" : "Selected material", ready ? "source" : "medium")}</div>
          <div class="source-action-row">
            ${academicContextOpenAction(source.linkUrl || source.alternateLink)}
            <button class="mini-action ai-context-button" type="button" data-ai-open data-ai-verb="Ask" data-ai-prompt="${escapeHtml(prompt)}">Ask StudentOS</button>
            <button class="mini-action danger-action" type="button" data-delete-context-kind="material" data-delete-context-id="${escapeHtml(source.id)}">Delete</button>
          </div>
        </div>
      </article>
    `;
  }).join("") || `<article class="source-card source-empty-card"><strong>No materials included</strong><p>Upload a material PDF to make it ready for study.</p></article>`;

  const classroomReview = classroomReviewItems.length ? `
    <section class="academic-context-group classroom-review-card" aria-label="Classroom work to review">
      <div class="source-card-head"><div><span class="workspace-label">New Classroom work found</span><h3>Classroom work to review</h3><p>Choose what to add to your academic context.</p></div></div>
      <div class="academic-context-card-grid">
        ${classroomReviewItems.map((item) => `
          <article class="source-card academic-context-card compact">
            ${academicContextPreview(false)}
            <div class="academic-context-card-body">
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.courseTitle || "Classroom course")}${item.dueAt ? ` / due ${escapeHtml(formatDate(item.dueAt))}` : ""}</p>
              <div class="tag-row">${tag(item.itemType === "assignment" ? "Assignment" : "Material", "source")}${item.handedIn ? tag("Already handed in", "source") : ""}</div>
              <div class="source-action-row">
                <button class="mini-action" type="button" data-classroom-item-id="${escapeHtml(item.id)}">Add</button>
                <button class="mini-action" type="button" data-classroom-ignore-id="${escapeHtml(item.id)}">Ignore</button>
              </div>
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  ` : "";

  els.sourceList.innerHTML = `
    <section class="academic-context-group" aria-labelledby="academic-context-assignments-title">
      <div class="section-heading"><div><p class="eyebrow">Due work</p><h3 id="academic-context-assignments-title">Assignments</h3></div></div>
      <div class="academic-context-card-grid">${assignmentCards}</div>
    </section>
    <section class="academic-context-group" aria-labelledby="academic-context-materials-title">
      <div class="section-heading"><div><p class="eyebrow">Ready for study</p><h3 id="academic-context-materials-title">Materials</h3></div></div>
      <div class="academic-context-card-grid">${materialCards}</div>
    </section>
    ${classroomReview}
  `;
}

function renderSelects() {
  const courseOptions = state.courses.map((course) => `<option value="${course.id}">${escapeHtml(course.title)}</option>`).join("");
  const topicOptions = state.topics.map((topic) => `<option value="${topic.id}">${escapeHtml(topic.title)}</option>`).join("");
  const assignmentOptions = state.assignments.filter(assignmentNeedsAction).map((assignment) => `<option value="${assignment.id}">${escapeHtml(assignment.title)}</option>`).join("");
  els.sourceCourseSelect.innerHTML = `<option value="">Choose a course</option>${courseOptions}`;
  els.scoreTopicSelect.innerHTML = topicOptions;
  els.extensionAssignmentSelect.innerHTML = assignmentOptions;
  els.flowAssignmentSelect.innerHTML = assignmentOptions;
  syncAcademicContextUploadType();
}

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function quotaPercent(used, total) {
  const limit = Number(total || 0);
  if (!limit) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(used || 0) / limit) * 100)));
}

function accountAuthLabel(mode) {
  const value = String(mode || "").toLowerCase();
  if (value === "supabase_auth") return "Signed in with StudentOS Auth";
  if (value === "local_demo") return "Local preview";
  if (value === "local_preview") return "Local preview";
  return humanize(mode || "StudentOS session");
}

function accountVisibilityLabel(value) {
  const audience = String(value || "").toLowerCase();
  if (audience === "student_only") return "Student-only";
  if (audience.includes("guardian")) return "Guardian access prepared";
  if (audience.includes("institution")) return "Institution access prepared";
  return humanize(value || "Student-only");
}

function subscriptionLabel(status) {
  const value = String(status || "unselected").toLowerCase();
  if (["free", "unselected", "selected", "cancelled", "canceled"].includes(value)) return "Plan setup pending";
  if (value === "trialing") return "Trial Mode";
  if (value === "active") return "Active plan";
  if (value === "past_due") return "Payment review needed";
  return "Plan setup pending";
}

function usageLimitText(value, label) {
  const limit = Number(value || 0);
  if (!limit) return `No ${label.toLowerCase()} limit listed`;
  return `${limit.toLocaleString()} ${label}`;
}

function quotaBar(label, used, total, formatter = (value) => value) {
  const percent = quotaPercent(used, total);
  return `
    <div class="quota-row">
      <div>
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(formatter(used))} / ${escapeHtml(formatter(total))}</span>
      </div>
      <div class="quota-track" aria-label="${escapeHtml(label)} usage">
        <span style="width:${percent}%"></span>
      </div>
    </div>
  `;
}

function billingPreviewCopy(result, action = "checkout") {
  if (result?.redirectAllowed) {
    return result.message || "A payment preview is ready. No payment is completed from StudentOS until checkout is active.";
  }
  return action === "manage"
    ? "Payments are not active yet, so no billing portal was opened."
    : "Payments are not active yet, so no checkout was opened.";
}

function billingStatusLabel(status) {
  const value = String(status || "").toLowerCase();
  if (value === "scaffold_only" || value === "not_required") return "Preview only";
  if (value === "provider_configuration_ready") return "Payment setup preview";
  if (value === "payment_setup_ready") return "Payment setup preview";
  return humanize(status || "Preview ready");
}

function policyVersionNote(value, label) {
  const raw = String(value || "").trim();
  if (!raw) return `${label} ready`;
  const cleaned = raw.replace(/^(privacy|terms)[-_]/i, "").replace(/_/g, " ");
  if (!cleaned || cleaned.toLowerCase() === "current") return "Current version";
  return `Version ${cleaned}`;
}

function requestReference(id) {
  return id ? `
    <details class="account-request-meta account-reference-detail">
      <summary>Reference saved</summary>
      <small>${escapeHtml(id)}</small>
    </details>
  ` : "";
}

function exportStatusCopy(request, job) {
  if (!request) return "No export requests yet.";
  if (request.downloadAvailable) return "Your private export is ready to download.";
  const jobStatus = String(job?.status || request.status || "queued").toLowerCase();
  if (jobStatus.includes("failed")) return "Export packaging needs another try.";
  if (jobStatus.includes("complete")) return "Export package is ready.";
  return "Your export is being prepared.";
}

function deletionStatusCopy(request) {
  if (!request) return "No deletion requests.";
  const gracePeriod = request.gracePeriodEndsAt ? ` Grace period active until ${formatDate(request.gracePeriodEndsAt)}.` : "";
  return `Deletion request recorded.${gracePeriod} No data has been deleted yet.`;
}

function familyAccessStatusCopy(invitations = []) {
  if (!invitations.length) return "Family, guardian, teacher, and institution access is inactive.";
  return `${invitations.length} sharing preview ${invitations.length === 1 ? "record" : "records"} saved. Access stays off until you consent.`;
}

function familyAccessLabel(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("enabled")) return "Sharing preview ready";
  if (value.includes("disabled") || value.includes("inactive")) return "Access inactive";
  if (value.includes("consent")) return "Consent required";
  return "Safeguards previewed";
}

function localAccountSnapshot() {
  const selectedPlan = productPlan(state?.productLifecycle?.selectedPlanId);
  const plan = selectedPlan || pendingPlanSummary();
  const academicContext = state?.planAccess?.academicContext || {
    status: "unavailable",
    canAdd: false,
    message: "Plan setup pending. Finish setup before adding academic material.",
  };
  return {
    user: {
      email: authSession?.user?.email || authSession?.email || "student@studentos.local",
      authenticated: Boolean(authSession?.access_token),
      authMode: authSession?.access_token ? "supabase_auth" : "local_preview",
      emailVerificationReady: true,
      emailVerified: false,
    },
    profile: {
      displayName: state?.studentProfile?.displayName || "Student",
      role: "student",
      visibility: state?.studentProfile?.visibility || { defaultAudience: "student_only" },
      consent: state?.studentProfile?.preferences?.consent || {
        aiPersonalization: true,
        productResearch: false,
        externalProgressSharing: false,
        guardianSharingFuture: false,
      },
    },
    quota: {
      plan,
      subscription: {
        status: selectedPlan ? (state?.productLifecycle?.accessMode === "trial" ? "trialing" : "active") : "unselected",
        renewalAt: null,
        cancelAtPeriodEnd: false,
      },
      capabilities: state?.planAccess?.capabilities || null,
      academicContext,
      enforcementEnabled: runtimeConfig.saas?.quotas?.enforcementEnabled === true,
      paymentsEnabled: false,
    },
    requests: { exportRequests: [], deletionRequests: [] },
    lifecycle: {
      legal: {
        privacyVersion: runtimeConfig.accountManagement?.lifecycle?.privacyVersion || "privacy-current",
        termsVersion: runtimeConfig.accountManagement?.lifecycle?.termsVersion || "terms-current",
        accepted: false,
      },
      exportRequests: [],
      exportJobs: [],
      deletionRequests: [],
      roleInvitations: [],
      policy: runtimeConfig.accountManagement?.lifecycle || {},
    },
    actions: {
      passwordResetAvailable: true,
      dataExportRequestAvailable: true,
      accountDeletionRequestAvailable: true,
      directDeletionEnabled: false,
      paymentsEnabled: false,
    },
    secretsPrinted: false,
  };
}

function renderAccount() {
  if (!state || !els.accountSummary || !els.quotaPanel) return;
  const account = accountSnapshot || localAccountSnapshot();
  const consent = account.profile?.consent || {};
  const quota = account.quota || localAccountSnapshot().quota;
  const selectedPlan = productPlan(state.productLifecycle?.selectedPlanId);
  const accountSelectedPlan = productPlan(quota.plan?.selected?.planKey || quota.subscription?.planId);
  const plan = selectedPlan || accountSelectedPlan || pendingPlanSummary();
  const contextCapacity = quota.academicContext || currentAcademicContextCapacity();
  if (els.accountResetEmail && !els.accountResetEmail.value) {
    els.accountResetEmail.value = account.user?.email || "";
  }
  if (els.verificationEmail && !els.verificationEmail.value) {
    els.verificationEmail.value = account.user?.email || "";
  }
  if (els.consentForm) {
    for (const input of els.consentForm.querySelectorAll("input[type='checkbox']")) {
      input.checked = Boolean(consent[input.name]);
    }
  }
  els.accountSummary.innerHTML = `
    <div class="account-hero">
      <span class="avatar large-avatar" aria-hidden="true">${escapeHtml((account.profile?.displayName || "S").slice(0, 1).toUpperCase())}</span>
      <div>
        <strong>${escapeHtml(account.profile?.displayName || "Student")}</strong>
        <p>${escapeHtml(account.user?.email || "No email session")} - ${escapeHtml(accountAuthLabel(account.user?.authMode || "local_preview"))}</p>
      </div>
    </div>
    <div class="account-summary-list">
      <span><strong>${escapeHtml(plan.displayName || plan.label || "Plan setup pending")}</strong> current plan</span>
      <span><strong>${escapeHtml(account.user?.emailVerified ? "Verified" : "Verification ready")}</strong> email status</span>
      <span><strong>${escapeHtml(accountVisibilityLabel(account.profile?.visibility?.defaultAudience || "student_only"))}</strong> visibility</span>
      <span><strong>${escapeHtml(subscriptionLabel(quota.subscription?.status))}</strong>${quota.subscription?.renewalAt ? ` renews ${escapeHtml(formatDate(quota.subscription.renewalAt))}` : ""}</span>
    </div>
    <p>Progress visibility is student-only by default. Future parent, teacher, and institution views require explicit consent and clear permissions.</p>
  `;
  els.quotaPanel.innerHTML = `
    <div class="plan-card account-current-plan-card">
      <div>
        <span class="workspace-label">Current plan</span>
        <strong>${escapeHtml(plan.displayName || plan.label || "Plan setup pending")}</strong>
        <p>${escapeHtml(planValueStatement(plan))}</p>
      </div>
      <div class="account-plan-state">
        <span>${escapeHtml(contextCapacity.status === "full" ? "Academic context full" : contextCapacity.status === "almost_full" ? "Academic context almost full" : contextCapacity.status === "available" ? "Academic context ready" : "Plan setup pending")}</span>
        <p>${escapeHtml(contextCapacity.message || "Finish plan setup to prepare your academic context.")}</p>
      </div>
    </div>
    <ul class="pricing-feature-list">${planFeatureBullets(plan).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  `;
  renderLifecycle(account.lifecycle || {});
  renderPricing(publicPlanKey(plan));
  updateProductFeatureControls();
}

function renderLifecycle(lifecycle = {}) {
  const legal = lifecycle.legal || {};
  const exports = lifecycle.exportRequests || [];
  const exportJobs = lifecycle.exportJobs || [];
  const deletions = lifecycle.deletionRequests || [];
  const invitations = lifecycle.roleInvitations || [];
  if (els.legalStatus) {
    els.legalStatus.innerHTML = `
      <div class="account-status-list">
        <span><strong>${escapeHtml(legal.accepted ? "Accepted" : "Review needed")}</strong> current notice</span>
        <span><strong>Privacy notice</strong><small>${escapeHtml(policyVersionNote(legal.privacyVersion, "Privacy notice"))}</small></span>
        <span><strong>Terms</strong><small>${escapeHtml(policyVersionNote(legal.termsVersion, "Terms"))}</small></span>
      </div>
    `;
  }
  if (els.accountLifecycleStatus) {
    const latestExport = exports[0];
    const latestJob = exportJobs.find((job) => job.exportRequestId === latestExport?.id);
    const latestDeletion = deletions[0];
    els.accountLifecycleStatus.innerHTML = `
      <article class="lifecycle-item">
        <strong>Export</strong>
        <p>${escapeHtml(exportStatusCopy(latestExport, latestJob))}</p>
        ${latestExport ? requestReference(latestExport.id) : ""}
        ${latestExport?.downloadAvailable ? `<button class="mini-action" type="button" data-download-export-id="${escapeHtml(latestExport.id)}">Download private export</button>` : ""}
      </article>
      <article class="lifecycle-item">
        <strong>Deletion review</strong>
        <p>${escapeHtml(deletionStatusCopy(latestDeletion))}</p>
        ${latestDeletion ? requestReference(latestDeletion.id) : ""}
        ${latestDeletion ? `<button class="mini-action danger-action" type="button" data-deletion-dry-run-id="${escapeHtml(latestDeletion.id)}">Preview deletion safety</button>` : ""}
      </article>
      <article class="lifecycle-item">
        <strong>Family access</strong>
        <p>${escapeHtml(familyAccessStatusCopy(invitations))}</p>
      </article>
    `;
  }
}

function renderPricing(activePlanId = null) {
  if (!els.pricingPanel) return;
  const plans = publicPlanSummaries();
  if (!plans.length) {
    els.pricingPanel.innerHTML = `
      <article class="pricing-card pricing-empty-card">
        <strong>Plans unavailable</strong>
        <p>StudentOS could not load plan previews yet. Your current account settings remain available.</p>
      </article>
    `;
    return;
  }
  els.pricingPanel.innerHTML = plans
    .map((plan) => planSummaryCardMarkup(plan, { context: "account", activePlanId }))
    .join("");
}

function setView(viewName) {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${viewName}`);
  });
  const titles = { today: "Today", setup: "Setup", courses: "Courses", memory: "Academic Context", studio: "Studio", account: "Account" };
  els.viewTitle.textContent = titles[viewName] || "Today";
  if (viewName === "account") {
    loadAccountSnapshot().catch(() => null);
  }
}

function setVerb(verb) {
  activeVerb = verb;
  document.querySelectorAll(".verb-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.verb === verb);
  });
}

function isAiDrawerOpen() {
  return document.body.classList.contains("ai-drawer-open");
}

function openAiDrawer(options = {}) {
  const { verb, prompt } = options;
  if (!isAiDrawerOpen()) {
    aiDrawerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  if (verb) {
    setVerb(verb);
  }
  if (typeof prompt === "string" && prompt.trim()) {
    els.aiMessage.value = prompt.trim();
  }
  document.body.classList.add("ai-drawer-open");
  els.aiPanel.setAttribute("aria-hidden", "false");
  els.aiLauncher.setAttribute("aria-expanded", "true");
  els.aiScrim.hidden = false;
  window.requestAnimationFrame(() => {
    els.aiMessage.focus();
  });
}

function closeAiDrawer({ restoreFocus = true } = {}) {
  if (!isAiDrawerOpen()) return;
  document.body.classList.remove("ai-drawer-open");
  els.aiPanel.setAttribute("aria-hidden", "true");
  els.aiLauncher.setAttribute("aria-expanded", "false");
  els.aiScrim.hidden = true;
  if (restoreFocus && aiDrawerReturnFocus && document.contains(aiDrawerReturnFocus)) {
    aiDrawerReturnFocus.focus();
  }
  aiDrawerReturnFocus = null;
}

function handleAiContextButton(button) {
  openAiDrawer({
    verb: button.dataset.aiVerb,
    prompt: button.dataset.aiPrompt,
  });
}

async function loadAccountSnapshot() {
  try {
    accountSnapshot = await api("/api/account");
  } catch {
    accountSnapshot = null;
  }
  renderAccount();
  const selectedPlan = productPlan(state?.productLifecycle?.selectedPlanId);
  if (selectedPlan) {
    els.planBadge.textContent = selectedPlan.displayName || selectedPlan.label;
  }
}

async function loadBootstrap(options = {}) {
  bootstrapLoaded = false;
  updateShellVisibility();
  if (options.showLoading) {
    renderWorkspaceLoading(options.copy || "Loading your workspace...");
  } else {
    setAppLoading(true);
  }
  try {
    state = await api("/api/bootstrap");
    bootstrapLoaded = true;
    render();
    if (lifecycleDashboardReady() && (authSession?.access_token || !runtimeConfig.auth?.enabled)) {
      await loadAccountSnapshot();
      await loadClassroomStatus();
    } else {
      accountSnapshot = null;
      renderAccount();
    }
  } finally {
    setAppLoading(false);
  }
}

function renderLesson(lesson) {
  if (!lesson) return;
  els.lessonResult.innerHTML = `
    <strong>${escapeHtml(lesson.title)}</strong>
    <p>${escapeHtml(lesson.conceptExplanation)}</p>
    <pre class="diagram-box">${escapeHtml(lesson.diagram)}</pre>
    <div class="split-list">
      <div><strong>Common mistakes</strong>${list(lesson.commonMistakes)}</div>
      <div><strong>Practice prompts</strong>${list(lesson.practicePrompts)}</div>
    </div>
    <div class="tag-row">
      ${(lesson.sourceLabels || []).map((label) => tag(label, "source")).join("")}
      ${tag(lesson.examAdjustedStyle, "medium")}
    </div>
  `;
}

function renderAiPayload(result) {
  const extra = [];
  if (result.studyPlan?.blocks) {
    extra.push(`<strong>Study blocks</strong>${list(result.studyPlan.blocks)}`);
  }
  if (result.artifacts) {
    extra.push(`<strong>Notes</strong>${list(result.artifacts.notes)}`);
    if (result.artifacts.flashcards?.length) extra.push(`<strong>Flashcards</strong>${list(result.artifacts.flashcards.map((card) => `${card.front} / ${card.back}`))}`);
    extra.push(`<strong>Quiz</strong>${list(result.artifacts.quiz.map((question) => question.prompt))}`);
  }
  if (result.review) {
    extra.push(`<strong>Understanding checks</strong>${list(result.review.checks)}`);
    extra.push(`<p>${escapeHtml(result.review.nextAction)}</p>`);
  }
  if (result.explanation) {
    extra.push(`<p>${escapeHtml(result.explanation.concept)}</p><pre class="diagram-box">${escapeHtml(result.explanation.diagram)}</pre>`);
  }
  if (result.grounding?.snippets?.length) {
    extra.push(`
      <strong>Selected material</strong>
      <div class="source-snippets">
        ${result.grounding.snippets.map((item) => `
          <blockquote>
            <p>${escapeHtml(item.snippet)}</p>
            <cite>${escapeHtml(item.citationLabel || item.sourceTitle || "Selected material")}</cite>
          </blockquote>
        `).join("")}
      </div>
    `);
  }

  setResult(els.aiResponse, `
    <strong>StudentOS response</strong>
    <p>${escapeHtml(result.answer)}</p>
      <div class="tag-row">
        ${result.coverage?.status ? tag(humanize(result.coverage.status), toneForCoverage(result.coverage.status)) : ""}
      ${result.grounding?.insufficientContext ? tag("not enough material yet", "urgent") : ""}
      ${(result.sourceLabels || []).map((source) => tag(source.label, "source")).join("")}
    </div>
    ${result.grounding?.insufficiencyReason ? `<p>${escapeHtml(result.grounding.insufficiencyReason)}</p>` : ""}
    ${extra.join("")}
  `);
}

async function runAi(event) {
  event.preventDefault();
  await withButtonLoading(event.submitter || els.aiForm.querySelector("button[type='submit']"), "Running...", async () => {
    setLoading(els.aiResponse, "Checking your materials...");
    try {
      const result = await api("/api/ai/verb", {
        method: "POST",
        body: JSON.stringify({ verb: activeVerb, message: els.aiMessage.value }),
      });
      renderAiPayload(result);
    } catch (error) {
      setResult(els.aiResponse, `
        <strong>AI response unavailable</strong>
        <p>${escapeHtml(error.message || "StudentOS could not finish this response. Try again after checking your sources.")}</p>
        <div class="tag-row">
          ${tag("try again", "medium")}
          ${tag("selected material protected", "source")}
        </div>
      `);
    }
  }, { timeoutTarget: els.aiResponse, timeoutCopy: "AI help is taking longer than expected. You can try again.", timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS });
}

async function createContract() {
  const selectedId = els.flowAssignmentSelect.value || state.assignments[0]?.id;
  const assignment = assignmentById(selectedId) || state.assignments[0];
  setLoading(els.contractResult, "Checking assignment readiness...");
  const result = await api("/api/assignment-contract", {
    method: "POST",
    body: JSON.stringify({ assignmentId: assignment.id }),
  });
  setResult(els.contractResult, `
    <strong>${escapeHtml(humanize(result.contract.status))}</strong>
    <p>${escapeHtml(result.contract.rationale)}</p>
    <div class="tag-row">
      ${tag(`${result.contract.availableCredits} credits`, "source")}
      ${tag("review required", "medium")}
      ${tag("no submission", "urgent")}
    </div>
  `);
}

function renderFlow(flow) {
  setResult(els.flowResult, `
    <strong>Study plan ready: ${escapeHtml(humanize(flow.action))}</strong>
    <p>${escapeHtml(flow.nextAction)}</p>
    <div class="studio-result-strip">
      <span><strong>${escapeHtml(humanize(flow.coverage.status))}</strong> assignment readiness</span>
      <span><strong>${flow.testSession ? `${flow.testSession.questions.length} questions` : "Lesson first"}</strong> practice path</span>
      <span><strong>No submission</strong> student review required</span>
    </div>
    <strong>Topic coverage</strong>
    ${list(flow.coverage.topicCoverages.map((coverage) => `${coverage.title}: ${humanize(coverage.status)} (${coverage.reasons.join(", ") || "no signal"})`))}
    <strong>Study queue update</strong>
    <p>${escapeHtml(flow.roadmapItem.title)} / ${escapeHtml(flow.roadmapItem.priority)}</p>
  `);
  renderLesson(flow.lesson);
}

async function analyzeAssignmentFlow(assignmentId) {
  setLoading(els.flowResult, "Checking coverage and next learning step...");
  try {
    const result = await api("/api/assignment-flow", {
      method: "POST",
      body: JSON.stringify({ assignmentId }),
    });
    renderFlow(result.flow);
    await loadBootstrap();
  } catch (error) {
    setResult(els.flowResult, `
      <strong>Assignment flow unavailable</strong>
      <p>${escapeHtml(error.message || "StudentOS could not prepare this assignment. Check Classroom work and try again.")}</p>
      <div class="tag-row">
        ${tag("try again", "medium")}
        ${tag("no submission", "urgent")}
      </div>
    `);
  }
}

async function submitAssignmentFlow(event) {
  event.preventDefault();
  await withButtonLoading(event.submitter, "Checking...", () => analyzeAssignmentFlow(new FormData(event.currentTarget).get("assignmentId")), {
    timeoutTarget: els.flowResult,
    timeoutCopy: "Assignment readiness is taking longer than expected. You can try again.",
    timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
  });
}

function derivedAnswersForScore(topic, scorePercent) {
  if (scorePercent >= 90) {
    return [
      { question: `Core idea of ${topic.title}`, selected: "Correct", correct: "Correct", concept: topic.title, isCorrect: true },
    ];
  }
  return [
    {
      question: `Setup check for ${topic.title}`,
      selected: "Skipped the setup",
      correct: "Identify givens and method first",
      concept: topic.weakSignals?.[0] || topic.title,
      isCorrect: false,
    },
    {
      question: `Timed check for ${topic.title}`,
      selected: scorePercent >= 70 ? "Mostly correct" : "Unstable",
      correct: "Use the source-backed method",
      concept: topic.weakSignals?.[1] || "exam timing",
      isCorrect: scorePercent >= 80,
    },
  ];
}

async function recordScore(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const topicId = form.get("topicId");
  const topic = topicById(topicId);
  const scorePercent = Number(form.get("scorePercent"));
  await withButtonLoading(event.submitter, "Saving...", async () => {
    setLoading(els.scoreResult, "Saving practice score...");
    const result = await api("/api/tests/score", {
      method: "POST",
      body: JSON.stringify({
        topicId,
        courseId: topic?.courseId,
        scorePercent,
        type: "mcq",
        answers: derivedAnswersForScore(topic, scorePercent),
      }),
    });

    setResult(els.scoreResult, `
      <strong>Practice saved: ${result.result.scorePercent}%</strong>
      <p>${escapeHtml(result.scoreSummary)}</p>
      <div class="studio-result-strip">
        <span><strong>${escapeHtml(String(result.result.creditsAwarded))}</strong> study credit${result.result.creditsAwarded === 1 ? "" : "s"} updated</span>
        <span><strong>${escapeHtml((result.weakTopics || []).length ? "Review needed" : "On track")}</strong> weak-topic signal</span>
      </div>
      <strong>What to repair next</strong>
      ${list(result.correctionSheet.corrections.map((item) => `${item.concept}: ${item.repair}`))}
      <div class="tag-row">
        ${(result.weakTopics || []).map((weak) => tag(weak, "medium")).join("")}
        ${tag(result.nextRecommendedAction, result.result.scorePercent < 70 ? "urgent" : "source")}
      </div>
    `);
    renderLesson(result.tutorLesson);
    await loadBootstrap();
  }, { timeoutTarget: els.scoreResult, timeoutCopy: "Saving the score is taking longer than expected. You can try again." });
}

async function draftExtension(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await withButtonLoading(event.submitter, "Preparing...", async () => {
    setLoading(els.extensionResult, "Preparing extension draft...");
    const result = await api("/api/extension/draft", {
      method: "POST",
      body: JSON.stringify({
        assignmentId: form.get("assignmentId"),
        reason: form.get("reason"),
      }),
    });
    setResult(els.extensionResult, `
      <strong>Draft recommendation: ${escapeHtml(humanize(result.draft.recommendation))}</strong>
      <p>${escapeHtml(result.draft.explanation)}</p>
      <div class="tag-row">
        ${tag("draft only", "source")}
        ${tag("student review required", "medium")}
        ${result.draft.safeguards.map((item) => tag(humanize(item), "source")).join("")}
      </div>
    `);
  }, { timeoutTarget: els.extensionResult, timeoutCopy: "Drafting is taking longer than expected. You can try again." });
}

async function addSource(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const capacity = currentAcademicContextCapacity();
  if (capacity.canAdd !== true) {
    setResult(els.sourceResult, `<p>${escapeHtml(capacity.message)}</p>`);
    return;
  }
  const form = new FormData(formElement);
  const kind = String(form.get("artifactKind") || "assignment");
  const file = form.get("file");
  if (!state.courses?.length) {
    setResult(els.sourceResult, `<p>Add a course in Setup before uploading academic context.</p>`);
    return;
  }
  if (!file || !file.name || !/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) {
    setResult(els.sourceResult, `<p>Please upload a PDF for Academic Context.</p>`);
    return;
  }
  if (!form.get("courseId")) {
    setResult(els.sourceResult, `<p>${kind === "assignment" ? "Choose a course for this assignment." : "Choose a course for this material."}</p>`);
    return;
  }
  if (kind === "assignment" && !form.get("deadline")) {
    setResult(els.sourceResult, `<p>Set the assignment deadline before uploading.</p>`);
    return;
  }
  await withButtonLoading(event.submitter, kind === "assignment" ? "Uploading assignment..." : "Uploading material...", async () => {
    setLoading(els.sourceResult, `Adding this ${kind} to Academic Context...`);
    try {
      const result = await api("/api/sources/upload", {
        method: "POST",
        body: form,
      });
      setResult(els.sourceResult, `
        <strong>${escapeHtml(result.material.title)}</strong>
        <p>${result.material.extractionError ? "This PDF was added, but it needs another try before it is ready for study." : `${kind === "assignment" ? "Assignment" : "Material"} added to your academic context and ready for study.`}</p>
      `);
      formElement.reset();
      syncAcademicContextUploadType();
      await loadBootstrap();
    } catch (error) {
      setResult(els.sourceResult, `
        <strong>Could not add this PDF</strong>
        <p>${escapeHtml(error.message || "StudentOS could not finish adding this item. Check the PDF and try again.")}</p>
      `);
    }
  }, { timeoutTarget: els.sourceResult, timeoutCopy: "Uploading is taking longer than expected. You can try again.", timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS });
}

function openAcademicContextDeleteConfirmation(kind, itemId) {
  pendingAcademicContextDeletion = { kind, itemId };
  const dialog = els.academicContextDeleteDialog;
  if (!dialog) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeAcademicContextDeleteConfirmation() {
  pendingAcademicContextDeletion = null;
  const dialog = els.academicContextDeleteDialog;
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

async function deleteAcademicContextItem() {
  const pending = pendingAcademicContextDeletion;
  if (!pending) return;
  const result = await api(`/api/academic-context/items/${encodeURIComponent(pending.itemId)}?kind=${encodeURIComponent(pending.kind)}`, {
    method: "DELETE",
  });
  state = result.state || state;
  closeAcademicContextDeleteConfirmation();
  render();
  setResult(els.sourceResult, `<strong>Deleted permanently</strong><p>This item is no longer part of your academic context.</p>`);
}

async function deleteSource(sourceId) {
  setLoading(els.sourceResult, "Deleting private source...");
  const result = await api(`/api/sources/${encodeURIComponent(sourceId)}`, {
    method: "DELETE",
  });
  setResult(els.sourceResult, `
    <strong>Source deleted</strong>
    <p>This source was removed from the active library.</p>
    <div class="tag-row">${tag("Removed privately", "source")}${tag("Private", "source")}</div>
  `);
  await loadBootstrap();
}

async function retrySourceIndex(sourceId) {
  setLoading(els.sourceResult, "Preparing source refresh...");
  const result = await api(`/api/sources/${encodeURIComponent(sourceId)}/reindex`, {
    method: "POST",
    body: JSON.stringify({ force: true }),
  });
  setResult(els.sourceResult, `
    <strong>${escapeHtml(result.deduped ? "Source refresh already planned" : "Source refresh started")}</strong>
    <p>StudentOS will refresh this source privately.</p>
    <div class="tag-row">${tag(sourceStatusLabel(result.job.status), "source")}${tag("Handled privately", "source")}</div>
  `);
  await loadBootstrap();
}

async function retryFailedJobs() {
  setLoading(els.sourceResult, "Retrying source issues...");
  const result = await api("/api/jobs/retry-failed", {
    method: "POST",
    body: JSON.stringify({}),
  });
  setResult(els.sourceResult, `
    <strong>${escapeHtml(`${result.retried} source issue(s) retried`)}</strong>
    <div class="tag-row">${tag("Refresh planned", "source")}${tag("Handled privately", "source")}</div>
  `);
  await loadBootstrap();
}

function formJson(form) {
  return Object.fromEntries([...new FormData(form).entries()]);
}

function renderOnboardingResult(result) {
  const onboarding = result.onboarding;
  setResult(els.onboardingResult, `
    <strong>${escapeHtml(onboarding.courses.length)} course roadmap generated</strong>
    <p>${escapeHtml(`Goal: ${humanize(onboarding.academicGoal)} / ${onboarding.studyBreakPattern.label} study cycle`)}</p>
    <div class="tag-row">
      ${tag(`${onboarding.exams.length} exams`, "source")}
      ${tag(`${onboarding.weakTopics.length} weak topics`, onboarding.weakTopics.length ? "medium" : "source")}
      ${tag(`${onboarding.roadmap.filter((item) => item.status === "open").length} roadmap items`, "source")}
    </div>
  `);
}

async function submitOnboarding(event) {
  event.preventDefault();
  await withButtonLoading(event.submitter, "Preparing...", async () => {
    setLoading(els.onboardingResult, "Building your academic roadmap...");
    const result = await api("/api/onboarding", {
      method: "POST",
      body: JSON.stringify(formJson(event.currentTarget)),
    });
    state = result.state;
    renderOnboardingResult(result);
    render();
    setView("today");
  }, { timeoutTarget: els.onboardingResult, timeoutCopy: "Roadmap generation is taking longer than expected. You can try again.", timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS });
}

function consentPayloadFromForm(form) {
  return {
    aiPersonalization: Boolean(form.elements.aiPersonalization?.checked),
    productResearch: Boolean(form.elements.productResearch?.checked),
    externalProgressSharing: Boolean(form.elements.externalProgressSharing?.checked),
    guardianSharingFuture: Boolean(form.elements.guardianSharingFuture?.checked),
  };
}

async function submitConsent(event) {
  event.preventDefault();
  await withButtonLoading(event.submitter, "Saving...", async () => {
    setLoading(els.consentResult, "Saving privacy preferences...");
    const result = await api("/api/account/consent", {
      method: "POST",
      body: JSON.stringify(consentPayloadFromForm(event.currentTarget)),
    });
    accountSnapshot = result.account;
    setResult(els.consentResult, `
      <strong>Consent preferences saved</strong>
      <div class="tag-row">
        ${tag(result.consent.aiPersonalization ? "personalization on" : "personalization off", "source")}
        ${tag(result.consent.externalProgressSharing ? "external sharing on" : "student-only progress", result.consent.externalProgressSharing ? "medium" : "source")}
      </div>
    `);
    renderAccount();
  }, { timeoutTarget: els.consentResult, timeoutCopy: "Saving preferences is taking longer than expected. You can try again." });
}

async function acceptCurrentLegalTerms() {
  if (!els.legalAcceptCheck.checked) {
    setResult(els.legalResult, `<p>Confirm the checkbox before recording acceptance.</p>`);
    return;
  }
  setLoading(els.legalResult, "Recording your acceptance...");
  const result = await api("/api/account/legal/accept", {
    method: "POST",
    body: JSON.stringify({ accepted: true, acceptanceSource: "account_settings" }),
  });
  accountSnapshot = result.account;
  setResult(els.legalResult, `
    <strong>Acceptance recorded</strong>
    <p>Your current terms and privacy notice acceptance is saved.</p>
    <div class="tag-row">
      ${tag(policyVersionNote(result.acceptance.privacyVersion, "Privacy notice"), "source")}
      ${tag(policyVersionNote(result.acceptance.termsVersion, "Terms"), "source")}
    </div>
  `);
  renderAccount();
}

async function requestConsentWithdrawal() {
  setLoading(els.consentResult, "Creating consent review request...");
  const result = await api("/api/account/consent/withdrawal-request", {
    method: "POST",
    body: JSON.stringify({ consentKey: "externalProgressSharing" }),
  });
  accountSnapshot = result.account;
  setResult(els.consentResult, `
    <strong>Consent review request recorded</strong>
    <p>StudentOS recorded a review request for external progress sharing. No sharing changes until the request is reviewed.</p>
    <div class="tag-row">${tag("review request", "medium")}${tag("no sharing change yet", "source")}</div>
    ${requestReference(result.request.id)}
  `);
  renderAccount();
}

async function requestDataExport() {
  setLoading(els.accountActionResult, "Preparing your data export request...");
  try {
    const result = await api("/api/account/export-request", {
      method: "POST",
      body: JSON.stringify({ scope: "student_owned_data" }),
    });
    accountSnapshot = result.account;
    setResult(els.accountActionResult, `
      <strong>Export request created</strong>
      <p>Your export is being prepared. StudentOS will package your account data for authenticated download when it is ready.</p>
      <div class="tag-row">${tag("Export being prepared", "medium")}${tag("Handled privately", "source")}</div>
      ${requestReference(result.request.id)}
    `);
    renderAccount();
  } catch (error) {
    setResult(els.accountActionResult, `
      <strong>Export request unavailable</strong>
      <p>${escapeHtml(error.message || "StudentOS could not create this export request. Try again after checking account persistence.")}</p>
      <div class="tag-row">${tag("try again", "medium")}${tag("handled privately", "source")}</div>
    `);
  }
}

async function downloadReadyExport(requestId) {
  setLoading(els.accountActionResult, "Preparing your private export download...");
  const headers = {};
  if (authSession?.access_token) headers.Authorization = `Bearer ${authSession.access_token}`;
  const response = await fetch(apiUrl(`/api/account/exports/${encodeURIComponent(requestId)}/download`), { headers });
  if (!response.ok) {
    const body = await readJsonResponse(response, "StudentOS API returned invalid JSON for export download.").catch((error) => ({ error: error.message || `HTTP ${response.status}` }));
    if (response.status === 401) handleSessionExpiry();
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "studentos-export.json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setResult(els.accountActionResult, `
    <strong>Private export downloaded</strong>
    <p>The package was streamed through your authenticated StudentOS session.</p>
    <div class="tag-row">${tag("private stream", "source")}${tag("short-lived access", "source")}</div>
  `);
  await loadAccountSnapshot();
}

async function requestAccountDeletion() {
  setLoading(els.accountActionResult, "Preparing account deletion request...");
  const result = await api("/api/account/deletion-request", {
    method: "POST",
    body: JSON.stringify({ reason: "student_request_from_account_settings" }),
  });
  accountSnapshot = result.account;
  setResult(els.accountActionResult, `
    <strong>Deletion request recorded</strong>
    <p>Grace period active until ${escapeHtml(formatDate(result.request.gracePeriodEndsAt))}. No data has been deleted yet, and the request stays in private review.</p>
    <div class="tag-row">${tag("No data deleted yet", "urgent")}${tag("Private review", "medium")}${tag("Handled privately", "source")}</div>
    ${requestReference(result.request.id)}
  `);
  renderAccount();
}

async function requestDeletionDryRun(requestId) {
  setLoading(els.accountActionResult, "Preparing a deletion safety preview...");
  const result = await api(`/api/account/deletion-requests/${encodeURIComponent(requestId)}/dry-run`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  accountSnapshot = result.account;
  const summary = result.report.summary || {};
  const diff = result.report.diff || {};
  const diffCopy = diff.baseline
    ? "This is the baseline preview."
    : diff.changed
      ? "Affected counts changed since the previous preview."
      : "Affected counts match the previous preview.";
  setResult(els.accountActionResult, `
    <strong>Deletion safety preview ready</strong>
    <p>No data has been deleted yet. This preview covers your account information and private files. ${escapeHtml(diffCopy)}</p>
    <div class="tag-row">
      ${tag("Academic material included", "source")}
      ${tag("Study history included", "source")}
      ${tag("No data deleted yet", "urgent")}
    </div>
    ${requestReference(requestId)}
  `);
  renderAccount();
}

async function previewGuardianGroundwork() {
  setLoading(els.invitationResult, "Checking sharing safeguards...");
  const result = await api("/api/account/invitations/guardian-preview", {
    method: "POST",
    body: JSON.stringify({ explicitStudentConsent: false }),
  });
  setResult(els.invitationResult, `
    <strong>${escapeHtml(familyAccessLabel(result.invitation.status))}</strong>
    <p>No family, guardian, teacher, or institution access was enabled. Student consent is required before sharing is turned on.</p>
    <div class="tag-row">
      ${tag("student consent required", "source")}
      ${tag(result.invitation.enabled ? "enabled" : "inactive", result.invitation.enabled ? "medium" : "source")}
    </div>
    ${requestReference(result.invitation.id)}
  `);
  await loadAccountSnapshot();
}

async function previewPlanUpgrade(planId = "pro") {
  setLoading(els.accountActionResult, "Preparing billing preview...");
  const result = await api("/api/billing/checkout-preview", {
    method: "POST",
    body: JSON.stringify({ planId }),
  });
  setResult(els.accountActionResult, `
    <strong>${escapeHtml(billingStatusLabel(result.status))}</strong>
    <p>${escapeHtml(billingPreviewCopy(result))}</p>
    <div class="tag-row">
      ${tag(humanize(result.planId), "source")}
      ${tag(result.redirectAllowed ? "checkout preview ready" : "no payment opened", result.redirectAllowed ? "medium" : "source")}
    </div>
  `);
}

async function previewBillingManagement() {
  setLoading(els.accountActionResult, "Preparing billing management preview...");
  const result = await api("/api/billing/manage-preview", {
    method: "POST",
    body: JSON.stringify({}),
  });
  setResult(els.accountActionResult, `
    <strong>${escapeHtml(billingStatusLabel(result.status))}</strong>
    <p>${escapeHtml(billingPreviewCopy(result, "manage"))}</p>
    <div class="tag-row">
      ${tag(result.redirectAllowed ? "billing portal preview ready" : "no payment portal opened", result.redirectAllowed ? "medium" : "source")}
    </div>
  `);
}

async function connectClassroom() {
  setLoading(els.classroomPanel, "Preparing Classroom connection...");
  const result = await api("/api/classroom/oauth/start", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (result.authorizationUrl) {
    window.location.href = result.authorizationUrl;
    return;
  }
  classroomStatus = { connector: result.connector, syncSummary: null };
  classroomStatusLoaded = true;
  renderClassroomPanel();
}

async function syncClassroom() {
  setLoading(els.classroomPanel, starterCourseOnlyClassroom() ? "Refreshing Classroom courses..." : "Checking Classroom work...");
  const result = await api("/api/classroom/sync", {
    method: "POST",
    body: JSON.stringify({}),
  });
  state = result.state || state;
  classroomStatus = { connector: result.connector, syncSummary: result.summary, syncHistory: result.connector?.syncHistory || [], policy: result.policy || null };
  classroomStatusLoaded = true;
  render();
}

async function addClassroomItemToAcademicContext(itemId) {
  const result = await api("/api/classroom/selection", {
    method: "POST",
    body: JSON.stringify({ itemIds: [itemId] }),
  });
  state = result.state || state;
  render();
  if (els.sourceResult) setResult(els.sourceResult, `<p>${escapeHtml(result.message || "Selected Classroom work was added to your academic context.")}</p>`);
}

async function ignoreClassroomItem(itemId) {
  const result = await api("/api/classroom/selection", {
    method: "POST",
    body: JSON.stringify({ ignoreIds: [itemId] }),
  });
  state = result.state || state;
  render();
  if (els.sourceResult) setResult(els.sourceResult, `<p>${escapeHtml(result.message || "Classroom work was left out of your academic context.")}</p>`);
}

async function disconnectClassroom() {
  setLoading(els.classroomPanel, "Disconnecting Classroom...");
  const result = await api("/api/classroom/disconnect", {
    method: "POST",
    body: JSON.stringify({}),
  });
  classroomStatus = { connector: result.connector, syncSummary: null };
  classroomStatusLoaded = true;
  renderClassroomPanel();
}

function productFlowMessage(copy) {
  const target = document.getElementById("product-flow-message");
  if (target) setResult(target, `<p>${escapeHtml(copy)}</p>`);
}

function renderProductPersistenceStatus() {
  if (!els.productSaveStatus) return;
  if (productPersistenceError) {
    els.productSaveStatus.dataset.state = "error";
    els.productSaveStatus.textContent = "Some setup changes still need to be saved. StudentOS will retry before preparing your workspace.";
    return;
  }
  if (productPersistenceQueue.length) {
    els.productSaveStatus.dataset.state = "saving";
    els.productSaveStatus.textContent = "Saving your setup…";
    return;
  }
  els.productSaveStatus.dataset.state = "saved";
  els.productSaveStatus.textContent = "";
}

function localProductStep(lifecycle) {
  const completed = lifecycle.onboarding?.completedSteps || [];
  if (lifecycle.dashboardActivatedAt) return "dashboard";
  if (!completed.includes("about_you")) return "about_you";
  if (!completed.includes("education_system")) return "education_system";
  if (!lifecycle.selectedPlanId) return "pricing";
  if (!lifecycle.accessMode) return "trial_choice";
  if (!lifecycle.paymentMethodVerifiedAt) return "payment_method";
  if (!lifecycle.legalConsentCompleteAt) return "legal_consent";
  const onboardingStep = ONBOARDING_STEPS.slice(2).find((step) => !completed.includes(step));
  if (onboardingStep) return onboardingStep;
  if (!lifecycle.classroomChoice || (lifecycle.classroomChoice === "classroom" && !lifecycle.classroomConnectedAt)) return "classroom_setup";
  if (!lifecycle.materialsSelectedAt) return "materials";
  if (!lifecycle.setupSummaryReadyAt) return "setup_summary";
  if (lifecycle.workspaceReadyAt || lifecycle.tutorialOfferedAt) return "tutorial";
  return "workspace_preparation";
}

function refreshLocalProductLifecycle(lifecycle) {
  const derivedNextStep = localProductStep(lifecycle);
  lifecycle.derivedNextStep = derivedNextStep;
  lifecycle.nextStep = lifecycle.navigationStep || derivedNextStep;
  const index = PRODUCT_FLOW_STEPS.indexOf(lifecycle.nextStep);
  lifecycle.canGoPrevious = index > 0 && !(lifecycle.paymentMethodVerifiedAt && lifecycle.nextStep === "payment_method");
  lifecycle.onboarding.completedStepCount = lifecycle.onboarding.completedSteps.length;
  lifecycle.onboarding.progressPercent = Math.round((lifecycle.onboarding.completedSteps.length / ONBOARDING_STEPS.length) * 100);
}

function applyLocalOnboardingStep(step, answers) {
  const lifecycle = state.productLifecycle;
  lifecycle.onboarding.answers[step] = { ...answers };
  if (!lifecycle.onboarding.completedSteps.includes(step)) lifecycle.onboarding.completedSteps.push(step);
  lifecycle.onboarding.currentStep = ONBOARDING_STEPS.find((item) => !lifecycle.onboarding.completedSteps.includes(item)) || "complete";
  if (step === "about_you" && answers.displayName) state.studentProfile.displayName = answers.displayName;
  if (lifecycle.navigationStep === step) {
    const [returnStep, ...remaining] = lifecycle.navigationHistory || [];
    lifecycle.navigationStep = returnStep || null;
    lifecycle.navigationHistory = remaining;
  }
  lifecycle.state = lifecycle.onboarding.currentStep === "complete" ? "classroom_choice_pending" : "onboarding_progress_saved";
  refreshLocalProductLifecycle(lifecycle);
  render();
}

async function postProductPersistence(item) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await api("/api/product-flow", {
        method: "POST",
        body: JSON.stringify(item),
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 160 * (attempt + 1)));
    }
  }
  throw lastError;
}

function runProductPersistenceQueue() {
  if (productPersistenceRunner) return productPersistenceRunner;
  productPersistenceRunner = (async () => {
    productPersistenceError = null;
    renderProductPersistenceStatus();
    while (productPersistenceQueue.length) {
      try {
        await postProductPersistence(productPersistenceQueue[0]);
        productPersistenceQueue.shift();
        renderProductPersistenceStatus();
      } catch (error) {
        productPersistenceError = error;
        renderProductPersistenceStatus();
        break;
      }
    }
  })().finally(() => {
    productPersistenceRunner = null;
    renderProductPersistenceStatus();
  });
  return productPersistenceRunner;
}

function enqueueProductPersistence(action, payload) {
  productPersistenceQueue.push({ action, payload: JSON.parse(JSON.stringify(payload || {})) });
  renderProductPersistenceStatus();
  runProductPersistenceQueue();
}

async function flushProductPersistence() {
  await runProductPersistenceQueue();
  if (productPersistenceError || productPersistenceQueue.length) {
    await runProductPersistenceQueue();
  }
  if (productPersistenceError || productPersistenceQueue.length) {
    throw new Error("StudentOS could not save your latest setup changes. Check your connection and try again before preparing your workspace.");
  }
}

function renderProductUploadStatus() {
  const target = document.getElementById("product-upload-status");
  if (!target) return;
  target.innerHTML = [...productUploadResults.values()].map((item) => `
    <div class="academic-upload-item ${escapeHtml(item.status)}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.copy)}</span></div>
  `).join("");
}

function productFileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

async function uploadAcademicContextFile(file) {
  const capacity = currentAcademicContextCapacity();
  if (capacity.canAdd !== true) {
    productUploadResults.set(productFileKey(file), { name: file.name, status: "failed", copy: capacity.message });
    renderProductUploadStatus();
    return;
  }
  const key = productFileKey(file);
  productUploadResults.set(key, { name: file.name, status: "adding", copy: "Adding to your academic context…" });
  productUploadsPending += 1;
  renderProductUploadStatus();
  try {
    await flushProductPersistence();
    const form = new FormData();
    form.set("title", file.name);
    form.set("file", file);
    const result = await api("/api/sources/upload", { method: "POST", body: form });
    const material = result.material;
    state = result.state || state;
    if (!state.sourceMaterials.some((item) => item.id === material.id)) {
      state.sourceMaterials.push({ ...material, sourceType: "uploaded_file", createdAt: new Date().toISOString() });
    }
    const lifecycle = state.productLifecycle;
    lifecycle.materialsDraft ||= { materialIds: [], materialLabels: [] };
    if (!lifecycle.materialsDraft.materialIds.includes(material.id)) lifecycle.materialsDraft.materialIds.push(material.id);
    if (!lifecycle.materialsDraft.materialLabels.includes(material.title)) lifecycle.materialsDraft.materialLabels.push(material.title);
    productUploadResults.set(key, {
      name: file.name,
      status: "added",
      copy: "Added to your academic context.",
      materialId: material.id,
      materialTitle: material.title,
    });
    if (lifecycle.nextStep === "materials") renderProductFlow();
    updateProductFeatureControls();
  } catch (error) {
    productUploadResults.set(key, { name: file.name, status: "failed", copy: error.message || "This file could not be added. You can try again." });
  } finally {
    productUploadsPending -= 1;
    renderProductUploadStatus();
  }
}

function queueAcademicContextFiles(files) {
  for (const file of files) {
    productUploadTail = productUploadTail.then(() => uploadAcademicContextFile(file));
  }
}

async function flushProductUploads() {
  while (productUploadsPending || productUploadTail) {
    const current = productUploadTail;
    await current;
    if (current === productUploadTail && productUploadsPending === 0) break;
  }
}

async function flushProductSetupWrites() {
  await flushProductPersistence();
  await flushProductUploads();
  await flushProductPersistence();
}

async function transitionProductFlow(action, payload = {}, { flushPending = true } = {}) {
  try {
    if (flushPending) await flushProductPersistence();
    if (els.productFlowAskResponse) els.productFlowAskResponse.hidden = true;
    els.productFlowAskBtn?.setAttribute("aria-expanded", "false");
    const result = await api("/api/product-flow", {
      method: "POST",
      body: JSON.stringify({ action, payload }),
    });
    state = result.state;
    render();
    if (lifecycleDashboardReady()) {
      await loadAccountSnapshot();
      await loadClassroomStatus();
    }
    return result;
  } catch (error) {
    productFlowMessage(error.message);
    throw error;
  }
}

function legalProductPayload(form) {
  const data = new FormData(form);
  const consentKeys = [
    "termsOfService",
    "privacyPolicy",
    "trialBilling",
    "trialLimits",
    "paymentMandate",
    "cancellationWindow",
    "academicDataUse",
    "noOutcomeGuarantee",
    "responsibleUse",
    "aiAccuracy",
  ];
  return {
    consents: Object.fromEntries(consentKeys.map((key) => [key, data.get(key) === "on"])),
    ageGate: data.get("ageGate") || "",
    guardianConsentAcknowledged: data.get("guardianConsentAcknowledged") === "on",
  };
}

function materialProductPayload(form) {
  const checked = [...form.querySelectorAll("input[name='materialIds']:checked")];
  const representedIds = new Set([...form.querySelectorAll("input[name='materialIds']")].map((input) => input.value));
  const typedLabels = String(new FormData(form).get("materialLabels") || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const materialIds = checked.map((input) => input.value);
  const materialLabels = [...checked.map((input) => input.dataset.materialLabel || "Selected material"), ...typedLabels];
  for (const upload of productUploadResults.values()) {
    if (upload.status === "added" && upload.materialId && !representedIds.has(upload.materialId)) {
      materialIds.push(upload.materialId);
      materialLabels.push(upload.materialTitle || upload.name);
    }
  }
  return { materialIds: [...new Set(materialIds)], materialLabels: [...new Set(materialLabels)] };
}

async function saveCurrentProductFlowDraft() {
  await flushProductSetupWrites();
  const step = state?.productLifecycle?.nextStep;
  let payload = null;
  const onboardingForm = document.getElementById("product-onboarding-form");
  if (onboardingForm && onboardingForm.dataset.step === step) {
    payload = {
      step,
      answers: Object.fromEntries([...new FormData(onboardingForm).entries()]
        .filter(([key, value]) => key !== "skipStep" && typeof value === "string")),
    };
  } else if (step === "legal_consent") {
    const legalForm = document.getElementById("product-legal-form");
    if (legalForm) payload = { step, ...legalProductPayload(legalForm) };
  } else if (step === "materials") {
    const materialsForm = document.getElementById("product-materials-form");
    if (materialsForm) payload = { step, ...materialProductPayload(materialsForm) };
  }
  if (!payload) return;
  const result = await api("/api/product-flow", {
    method: "POST",
    body: JSON.stringify({ action: "save_step_draft", payload }),
  });
  state = result.state;
}

async function connectClassroomFromProductFlow() {
  productFlowMessage("Preparing the Classroom connection...");
  const result = await api("/api/classroom/oauth/start", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (result.authorizationUrl) {
    window.location.href = result.authorizationUrl;
    return;
  }
  if (result.connector?.connected) {
    await loadBootstrap({ showLoading: false });
    if (!productClassroomRefreshAttempted) await refreshClassroomForProductFlow();
    return;
  }
  productFlowMessage(result.message || "Classroom is already connected. Refresh StudentOS to continue.");
}

async function refreshClassroomForProductFlow() {
  productClassroomRefreshAttempted = true;
  productFlowMessage(starterCourseOnlyClassroom() ? "Refreshing your Classroom course list..." : "Checking for Classroom work you can choose...");
  try {
    const result = await api("/api/classroom/sync", {
      method: "POST",
      body: JSON.stringify({}),
    });
    state = result.state || state;
    classroomStatus = { connector: result.connector, syncSummary: result.summary, syncHistory: result.connector?.syncHistory || [], policy: result.policy || null };
    classroomStatusLoaded = true;
    render();
  } catch (error) {
    productFlowMessage(error.message || (starterCourseOnlyClassroom()
      ? "StudentOS could not refresh your course list yet. You can continue Setup and try again later."
      : "StudentOS could not check Classroom work yet. You can continue and add material later."));
  }
}

async function handleProductFlowClick(event) {
  const button = event.target.closest("[data-product-action]");
  if (!button) return;
  const action = button.dataset.productAction;
  try {
    await withButtonLoading(button, "Saving...", async () => {
      if (action === "select-plan") {
        const planId = normalizedProductPlanKey(button.dataset.planId);
        if (!planId) throw new Error("Choose a current StudentOS plan to continue.");
        await transitionProductFlow("select_plan", { planId });
      }
      else if (action === "choose-access") await transitionProductFlow("choose_access", { accessMode: button.dataset.accessMode });
      else if (action === "verify-payment") await transitionProductFlow("verify_payment_method_placeholder");
      else if (action === "choose-path") {
        productClassroomRefreshAttempted = false;
        await transitionProductFlow("choose_classroom_path", { choice: button.dataset.choice });
      }
      else if (action === "connect-classroom") await connectClassroomFromProductFlow();
      else if (action === "confirm-summary") {
        await flushProductSetupWrites();
        await transitionProductFlow("confirm_setup_summary");
      }
      else if (action === "prepare-workspace") {
        await flushProductSetupWrites();
        await transitionProductFlow("prepare_workspace");
      }
      else if (action === "choose-tutorial") await transitionProductFlow("choose_tutorial", { choice: button.dataset.choice });
      else if (action === "complete-tutorial") await transitionProductFlow("complete_tutorial");
      else if (action === "edit-setup") await transitionProductFlow("edit_setup", { targetStep: button.dataset.targetStep });
      else if (action === "previous-step") {
        await saveCurrentProductFlowDraft();
        await transitionProductFlow("navigate_previous");
      }
    }, {
      timeoutTarget: document.getElementById("product-flow-message"),
      timeoutCopy: "Saving this setup step is taking longer than expected. Please try again.",
    });
  } catch {
    // transitionProductFlow has already shown student-safe copy.
  }
}

async function handleProductFlowSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  try {
    if (form.id === "product-legal-form") {
      await withButtonLoading(event.submitter, "Saving...", () => transitionProductFlow("complete_legal", legalProductPayload(form)));
      return;
    }
    if (form.id === "product-onboarding-form") {
      const answers = Object.fromEntries([...new FormData(form).entries()]
        .filter(([key, value]) => key !== "skipStep" && typeof value === "string"));
      if (event.submitter?.value === "true") {
        for (const key of Object.keys(answers)) answers[key] = "";
      }
      const step = form.dataset.step;
      applyLocalOnboardingStep(step, answers);
      enqueueProductPersistence("save_onboarding_step", { step, answers });
      return;
    }
    if (form.id === "product-materials-form") {
      const pendingPayload = materialProductPayload(form);
      await withButtonLoading(event.submitter, "Saving...", async () => {
        await flushProductSetupWrites();
        const uploadedPayload = materialProductPayload(form);
        await transitionProductFlow("save_materials", {
          materialIds: [...new Set([...pendingPayload.materialIds, ...uploadedPayload.materialIds])],
          materialLabels: [...new Set([...pendingPayload.materialLabels, ...uploadedPayload.materialLabels])],
        });
      });
    }
  } catch {
    // transitionProductFlow has already shown student-safe copy.
  }
}

function handleProductFlowInput(event) {
  const form = event.target.closest("#product-onboarding-form");
  if (!form || event.target.type === "file" || !event.target.name) return;
  const step = form.dataset.step;
  const lifecycle = state?.productLifecycle;
  if (!lifecycle?.onboarding?.answers?.[step]) lifecycle.onboarding.answers[step] = {};
  lifecycle.onboarding.answers[step][event.target.name] = event.target.value;
}

function handleProductFlowChange(event) {
  if (event.target.id !== "product-academic-files") return;
  queueAcademicContextFiles([...event.target.files]);
  event.target.value = "";
}

function toggleProductFlowAsk() {
  const response = els.productFlowAskResponse;
  if (!response) return;
  const preparing = state?.productLifecycle?.nextStep === "workspace_preparation";
  response.hidden = !response.hidden;
  els.productFlowAskBtn?.setAttribute("aria-expanded", response.hidden ? "false" : "true");
  response.textContent = preparing
    ? "Your workspace is being prepared. Ask StudentOS will open fully when Today is ready."
    : "Finish the current setup step to activate your academic assistant. I can guide you through what comes next.";
}

function wireEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  els.aiLauncher.addEventListener("click", () => openAiDrawer());
  els.aiCloseBtn.addEventListener("click", () => closeAiDrawer());
  els.aiScrim.addEventListener("click", () => closeAiDrawer());
  els.productFlowContent?.addEventListener("click", handleProductFlowClick);
  els.productFlowContent?.addEventListener("submit", handleProductFlowSubmit);
  els.productFlowContent?.addEventListener("input", handleProductFlowInput);
  els.productFlowContent?.addEventListener("change", handleProductFlowChange);
  els.productFlowAskBtn?.addEventListener("click", toggleProductFlowAsk);
  els.productFlowLogoutBtn?.addEventListener("click", () => {
    logout().catch((error) => productFlowMessage(error.message));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isAiDrawerOpen()) {
      closeAiDrawer();
    }
  });
  window.addEventListener("hashchange", handleAuthLocationChange);
  document.addEventListener("click", (event) => {
    const classroomItemButton = event.target.closest("[data-classroom-item-id]");
    if (classroomItemButton) {
      withButtonLoading(classroomItemButton, "Adding...", () => addClassroomItemToAcademicContext(classroomItemButton.dataset.classroomItemId), {
        timeoutTarget: els.sourceResult,
        timeoutCopy: "Adding this Classroom work is taking longer than expected. Please try again.",
      }).catch((error) => {
        if (els.sourceResult) setResult(els.sourceResult, `<p>${escapeHtml(error.message)}</p>`);
      });
      return;
    }
    const classroomIgnoreButton = event.target.closest("[data-classroom-ignore-id]");
    if (classroomIgnoreButton) {
      withButtonLoading(classroomIgnoreButton, "Ignoring...", () => ignoreClassroomItem(classroomIgnoreButton.dataset.classroomIgnoreId), {
        timeoutTarget: els.sourceResult,
        timeoutCopy: "This Classroom choice is taking longer than expected. Please try again.",
      }).catch((error) => {
        if (els.sourceResult) setResult(els.sourceResult, `<p>${escapeHtml(error.message)}</p>`);
      });
      return;
    }
    const button = event.target.closest("[data-ai-open]");
    if (button) {
      handleAiContextButton(button);
    }
  });
  document.querySelectorAll(".verb-tab").forEach((button) => {
    button.addEventListener("click", () => setVerb(button.dataset.verb));
  });
  document.getElementById("refresh-btn").addEventListener("click", (event) => {
    withButtonLoading(event.currentTarget, "Loading...", () => loadBootstrap({ showLoading: true }), {
      timeoutTarget: els.dashboardSummary,
      timeoutCopy: "Workspace refresh is taking longer than expected. You can try again.",
      timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
    }).catch(renderWorkspaceLoadError);
  });
  els.classroomConnectBtn.addEventListener("click", () => {
    withButtonLoading(els.classroomConnectBtn, "Preparing...", connectClassroom, {
      timeoutTarget: els.classroomPanel,
      timeoutCopy: "Classroom connection is taking longer than expected. You can keep working while it finishes.",
      timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
    }).catch(renderClassroomError);
  });
  els.classroomSyncBtn.addEventListener("click", () => {
    withButtonLoading(els.classroomSyncBtn, "Checking...", syncClassroom, {
      timeoutTarget: els.classroomPanel,
      timeoutCopy: "The Classroom check is taking longer than expected. You can keep working while it finishes.",
      timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
    }).catch(renderClassroomError);
  });
  els.classroomDisconnectBtn.addEventListener("click", () => {
    withButtonLoading(els.classroomDisconnectBtn, "Disconnecting...", disconnectClassroom, {
      timeoutTarget: els.classroomPanel,
      timeoutCopy: "Classroom disconnect is taking longer than expected. You can keep working while it finishes.",
    }).catch(renderClassroomError);
  });
  document.getElementById("contract-btn").addEventListener("click", (event) => {
    withButtonLoading(event.currentTarget, "Checking...", createContract, {
      timeoutTarget: els.contractResult,
      timeoutCopy: "Assignment readiness is taking longer than expected. You can try again.",
    }).catch((error) => {
      setResult(els.contractResult, `<p>${escapeHtml(error.message)}</p>`);
    });
  });
  document.getElementById("assignment-flow-form").addEventListener("submit", submitAssignmentFlow);
  document.getElementById("score-form").addEventListener("submit", recordScore);
  document.getElementById("extension-form").addEventListener("submit", draftExtension);
  document.getElementById("source-form").addEventListener("submit", addSource);
  els.sourceKindSelect?.addEventListener("change", syncAcademicContextUploadType);
  els.sourceSearchInput?.addEventListener("input", (event) => {
    sourceSearchQuery = event.currentTarget.value;
    renderSources();
  });
  els.onboardingForm.addEventListener("submit", submitOnboarding);
  els.sourceList.addEventListener("click", (event) => {
    const contextDeleteButton = event.target.closest("[data-delete-context-id]");
    if (contextDeleteButton) {
      openAcademicContextDeleteConfirmation(contextDeleteButton.dataset.deleteContextKind, contextDeleteButton.dataset.deleteContextId);
      return;
    }
    const button = event.target.closest("[data-delete-source-id]");
    if (button) {
      withButtonLoading(button, "Deleting...", () => deleteSource(button.dataset.deleteSourceId), {
        timeoutTarget: els.sourceResult,
        timeoutCopy: "Deleting this source is taking longer than expected. You can try again.",
        timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
      }).catch((error) => {
        setResult(els.sourceResult, `<p>${escapeHtml(error.message)}</p>`);
      });
    }
    const reindexButton = event.target.closest("[data-reindex-source-id]");
    if (reindexButton) {
      withButtonLoading(reindexButton, "Preparing...", () => retrySourceIndex(reindexButton.dataset.reindexSourceId), {
        timeoutTarget: els.sourceResult,
        timeoutCopy: "Refreshing this source is taking longer than expected. You can try again.",
        timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
      }).catch((error) => {
        setResult(els.sourceResult, `<p>${escapeHtml(error.message)}</p>`);
      });
    }
    const retryFailedButton = event.target.closest("[data-retry-failed-jobs]");
    if (retryFailedButton) {
      withButtonLoading(retryFailedButton, "Retrying...", retryFailedJobs, {
        timeoutTarget: els.sourceResult,
        timeoutCopy: "Retrying source issues is taking longer than expected. You can try again.",
        timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
      }).catch((error) => {
        setResult(els.sourceResult, `<p>${escapeHtml(error.message)}</p>`);
      });
    }
  });
  els.academicContextDeleteCancel?.addEventListener("click", closeAcademicContextDeleteConfirmation);
  els.academicContextDeleteConfirm?.addEventListener("click", () => {
    withButtonLoading(els.academicContextDeleteConfirm, "Deleting...", deleteAcademicContextItem, {
      timeoutTarget: els.sourceResult,
      timeoutCopy: "Deletion is taking longer than expected. Please try again.",
      timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
    }).catch((error) => {
      setResult(els.sourceResult, `<p>${escapeHtml(error.message)}</p>`);
    });
  });
  els.academicContextDeleteDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeAcademicContextDeleteConfirmation();
  });
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => setAuthShellMode(button.dataset.authMode));
  });
  els.authForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const action = authShellMode === "signup" ? signUpWithPassword() : signInWithPassword();
    action.catch((error) => renderAuth(error.message));
  });
  els.signupBtn.addEventListener("click", () => {
    if (authShellMode !== "signup") {
      setAuthShellMode("signup");
      els.authEmail?.focus();
      return;
    }
    signUpWithPassword().catch((error) => renderAuth(error.message));
  });
  els.passwordResetBtn.addEventListener("click", () => {
    requestPasswordReset(els.authEmail.value, els.authMessage).catch((error) => {
      els.authMessage.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    });
  });
  els.logoutBtn.addEventListener("click", () => {
    logout().catch((error) => renderAuth(error.message));
  });
  els.accountResetForm.addEventListener("submit", (event) => {
    event.preventDefault();
    requestPasswordReset(new FormData(event.currentTarget).get("email"), els.passwordResetResult).catch((error) => {
      setResult(els.passwordResetResult, `<p>${escapeHtml(error.message)}</p>`);
    });
  });
  els.verificationResendForm.addEventListener("submit", (event) => {
    event.preventDefault();
    requestVerificationResend(new FormData(event.currentTarget).get("email")).catch((error) => {
      setResult(els.verificationResult, `<p>${escapeHtml(error.message)}</p>`);
    });
  });
  els.legalAcceptBtn.addEventListener("click", () => {
    withButtonLoading(els.legalAcceptBtn, "Saving...", acceptCurrentLegalTerms, {
      timeoutTarget: els.legalResult,
      timeoutCopy: "Saving acceptance is taking longer than expected. You can try again.",
    }).catch((error) => {
      setResult(els.legalResult, `<p>${escapeHtml(error.message)}</p>`);
    });
  });
  els.consentForm.addEventListener("submit", (event) => {
    submitConsent(event).catch((error) => {
      setResult(els.consentResult, `<p>${escapeHtml(error.message)}</p>`);
    });
  });
  els.consentWithdrawBtn.addEventListener("click", () => {
    withButtonLoading(els.consentWithdrawBtn, "Preparing...", requestConsentWithdrawal, {
      timeoutTarget: els.consentResult,
      timeoutCopy: "Preparing the review request is taking longer than expected. You can try again.",
    }).catch((error) => {
      setResult(els.consentResult, `<p>${escapeHtml(error.message)}</p>`);
    });
  });
  els.exportRequestBtn.addEventListener("click", () => {
    withButtonLoading(els.exportRequestBtn, "Preparing...", requestDataExport, {
      timeoutTarget: els.accountActionResult,
      timeoutCopy: "Preparing the export is taking longer than expected. You can try again.",
      timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
    }).catch((error) => {
      setResult(els.accountActionResult, `<p>${escapeHtml(error.message)}</p>`);
    });
  });
  els.deletionRequestBtn.addEventListener("click", () => {
    withButtonLoading(els.deletionRequestBtn, "Preparing...", requestAccountDeletion, {
      timeoutTarget: els.accountActionResult,
      timeoutCopy: "Preparing the deletion request is taking longer than expected. You can try again.",
      timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
    }).catch((error) => {
      setResult(els.accountActionResult, `<p>${escapeHtml(error.message)}</p>`);
    });
  });
  els.accountLifecycleStatus.addEventListener("click", (event) => {
    const downloadButton = event.target.closest("[data-download-export-id]");
    if (downloadButton) {
      withButtonLoading(downloadButton, "Preparing...", () => downloadReadyExport(downloadButton.dataset.downloadExportId), {
        timeoutTarget: els.accountActionResult,
        timeoutCopy: "Preparing the download is taking longer than expected. You can try again.",
        timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
      }).catch((error) => {
        setResult(els.accountActionResult, `<p>${escapeHtml(error.message)}</p>`);
      });
    }
    const dryRunButton = event.target.closest("[data-deletion-dry-run-id]");
    if (dryRunButton) {
      withButtonLoading(dryRunButton, "Checking...", () => requestDeletionDryRun(dryRunButton.dataset.deletionDryRunId), {
        timeoutTarget: els.accountActionResult,
        timeoutCopy: "Preparing the deletion safety preview is taking longer than expected. You can try again.",
        timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
      }).catch((error) => {
        setResult(els.accountActionResult, `<p>${escapeHtml(error.message)}</p>`);
      });
    }
  });
  els.guardianPreviewBtn.addEventListener("click", () => {
    withButtonLoading(els.guardianPreviewBtn, "Checking...", previewGuardianGroundwork, {
      timeoutTarget: els.invitationResult,
      timeoutCopy: "Checking sharing safeguards is taking longer than expected. You can try again.",
    }).catch((error) => {
      setResult(els.invitationResult, `<p>${escapeHtml(error.message)}</p>`);
    });
  });
  els.upgradeBtn.addEventListener("click", () => {
    withButtonLoading(els.upgradeBtn, "Preparing...", () => previewPlanUpgrade("pro"), {
      timeoutTarget: els.accountActionResult,
      timeoutCopy: "Preparing the plan preview is taking longer than expected. You can try again.",
    }).catch((error) => {
      setResult(els.accountActionResult, `<p>${escapeHtml(error.message)}</p>`);
    });
  });
  els.manageBillingBtn.addEventListener("click", () => {
    withButtonLoading(els.manageBillingBtn, "Preparing...", previewBillingManagement, {
      timeoutTarget: els.accountActionResult,
      timeoutCopy: "Preparing billing management is taking longer than expected. You can try again.",
    }).catch((error) => {
      setResult(els.accountActionResult, `<p>${escapeHtml(error.message)}</p>`);
    });
  });
  els.pricingPanel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-plan-preview]");
    if (!button || button.textContent.trim() === "Current plan") return;
    const planId = normalizedProductPlanKey(button.dataset.planPreview);
    if (!planId) {
      setResult(els.accountActionResult, "<p>Choose a current StudentOS plan to continue.</p>");
      return;
    }
    withButtonLoading(button, "Preparing...", () => previewPlanUpgrade(planId), {
      timeoutTarget: els.accountActionResult,
      timeoutCopy: "Preparing the plan preview is taking longer than expected. You can try again.",
    }).catch((error) => {
      setResult(els.accountActionResult, `<p>${escapeHtml(error.message)}</p>`);
    });
  });
  els.aiForm.addEventListener("submit", runAi);
  els.assignmentList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-flow-id]");
    if (button) {
      setView("studio");
      els.flowAssignmentSelect.value = button.dataset.flowId;
      withButtonLoading(button, "Checking...", () => analyzeAssignmentFlow(button.dataset.flowId), {
        timeoutTarget: els.flowResult,
        timeoutCopy: "Assignment readiness is taking longer than expected. You can try again.",
        timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
      }).catch((error) => {
        setResult(els.flowResult, `<p>${escapeHtml(error.message)}</p>`);
      });
    }
  });
}

captureAuthReturnSession();
updateShellVisibility();
wireEvents();
loadRuntimeConfig()
  .then(() => {
    if (authGateActive()) {
      setAppLoading(false);
      return null;
    }
    return loadBootstrap();
  })
  .catch((error) => {
    renderWorkspaceLoadError(error);
  });
