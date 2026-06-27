const API_BASE = window.StudentOSConfig?.apiBase || "";
const PUBLIC_FRONTEND_HOSTS = new Set([
  "studentos.sentiqlabs.com",
  "studentos-39s.pages.dev",
]);
const API_BASE_MISCONFIGURED_MESSAGE = "API base URL misconfigured. Cloudflare Pages must set STUDENTOS_PUBLIC_API_BASE_URL to the Azure backend URL.";

let state = null;
let activeVerb = "Ask";
let runtimeConfig = { auth: { enabled: false } };
let authSession = readStoredSession();
let accountSnapshot = null;
let classroomStatus = null;
let classroomStatusLoaded = false;
let aiDrawerReturnFocus = null;
let sourceSearchQuery = "";
let authShellMode = "signin";
const ACTION_LOADING_TIMEOUT_MS = 30000;
const LONG_ACTION_LOADING_TIMEOUT_MS = 60000;

const els = {
  publicAuthShell: document.getElementById("public-auth-shell"),
  productFlowShell: document.getElementById("product-flow-shell"),
  productFlowContent: document.getElementById("product-flow-content"),
  productFlowProgress: document.getElementById("product-flow-progress"),
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
  demoSeedBtn: document.getElementById("demo-seed-btn"),
  roadmapList: document.getElementById("roadmap-list"),
  timetableList: document.getElementById("timetable-list"),
  assignmentList: document.getElementById("assignment-list"),
  coursesGrid: document.getElementById("courses-grid"),
  sourceSearchInput: document.getElementById("source-search-input"),
  sourceList: document.getElementById("source-list"),
  sourceCourseSelect: document.getElementById("source-course-select"),
  sourceFile: document.getElementById("source-file"),
  sourceResult: document.getElementById("source-result"),
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
  authSession = session?.access_token ? session : null;
  if (authSession) {
    sessionStorage.setItem("studentos.auth.session", JSON.stringify(authSession));
  } else {
    sessionStorage.removeItem("studentos.auth.session");
  }
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

function productSetupActive() {
  return Boolean(state?.productLifecycle && state.productLifecycle.dashboardActive !== true);
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

function handleSessionExpiry() {
  storeSession(null);
  accountSnapshot = null;
  renderAuth("Session expired. Sign in again to continue.");
}

function classroomErrorCopy(error) {
  const message = String(error?.message || "");
  const lower = message.toLowerCase();
  if (lower.includes("insufficient") || lower.includes("scope") || lower.includes("expired") || lower.includes("revoked") || lower.includes("invalid credentials") || lower.includes("unauthorized") || lower.includes("reconnect")) {
    return "Reconnect Classroom to refresh imported assignments.";
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
  if (/\b(supabase|groq|pollinations|gemini|openai|gpt|gpt-oss|anthropic|claude|provider|model)\b/i.test(text)) {
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
  renderAuth();
  if (els.demoSeedBtn) {
    els.demoSeedBtn.hidden = runtimeConfig.onboarding?.demoSeedEnabled !== true;
  }
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
  return humanize(state?.studentProfile?.preferences?.academicGoal || "exam_prep");
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
    setText(els.authShellCopy, "StudentOS sign-in is temporarily unavailable. StudentOS will not open a demo session on this domain.");
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
    setText(els.authSession, "Local demo session");
    setText(els.authHelp, "Local demo keeps account actions available without contacting live sign-in.");
    setText(els.railSessionStatus, "Demo session");
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
  const session = await authRequest("/signup", {
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
  const leftClassroom = left.source === "google_classroom";
  const rightClassroom = right.source === "google_classroom";
  if (leftClassroom && rightClassroom) {
    const freshness = classroomFreshnessTimestamp(right) - classroomFreshnessTimestamp(left);
    if (freshness) return freshness;
    return String(left.id || left.title || "").localeCompare(String(right.id || right.title || ""));
  }
  if (leftClassroom !== rightClassroom) return leftClassroom ? -1 : 1;
  return timestampFor(left.dueDate || left.dueAt) - timestampFor(right.dueDate || right.dueAt);
}

function getNextActions() {
  const roadmap = (state.roadmap || []).filter((item) => item.status === "open");
  return state.todayNextActions?.length ? state.todayNextActions : sortedByDate(roadmap, (item) => item.dueAt);
}

function getDueAssignments() {
  return [...(state.assignments || [])].sort(sortStudentWork);
}

function getNextTimetableBlock() {
  return sortedByDate(state.timetable || [], (item) => item.startsAt)[0] || null;
}

function getCourseTopics(courseId) {
  return (state.topics || []).filter((topic) => topic.courseId === courseId);
}

function getCourseAssignments(courseId) {
  return (state.assignments || []).filter((assignment) => assignment.courseId === courseId).sort(sortStudentWork);
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
  return source.status === "indexed" || source.embeddingStatus === "embedded" || Number(source.chunkCount || 0) > 0;
}

function sourceEmbeddedChunks(source) {
  if (!source?.id) return Number(source?.chunkCount || 0);
  const embedded = (state.sourceChunks || []).filter((chunk) =>
    chunk.sourceMaterialId === source.id && chunk.embeddingStatus === "embedded"
  ).length;
  return embedded || Number(source.chunkCount || 0);
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
  return source.filename || source.mimeType || humanize(source.kind || source.storageMode || "source");
}

function sourceHealthLabel(source, latestJob, embeddedCount) {
  if (source.extractionError || latestJob?.status === "failed") return "needs attention";
  if (source.ocrRequired || source.status === "needs_ocr") return "OCR needed";
  if (sourceIsIndexed(source) || embeddedCount > 0) return "Ready";
  return humanize(source.status || source.extractionStatus || "registered");
}

function backendModeLabel(mode) {
  if (mode === "private_cloud_sync") return "Cloud sync";
  if (mode === "local_preview") return "Demo mode";
  if (mode === "supabase") return "Cloud sync";
  if (mode === "mock") return "Demo mode";
  return humanize(mode || "unknown mode");
}

function classroomModeLabel(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "mock") return "Demo Classroom ready";
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
  if (mode === "mock") return "connected";
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
      title: connector.mode === "mock" ? "Demo Classroom ready" : "Classroom connected",
      message: connector.mode === "mock"
        ? "Demo assignments can be synced into your study plan."
        : "StudentOS can refresh coursework for your study plan. You stay in control of submissions.",
      badge: "planning import active",
      detail: lastSync ? `Last refreshed ${formatDate(lastSync)}` : summary ? "Classroom coursework has been added to your study plan." : "Ready to refresh assignments.",
    };
  }
  if (stateName === "disconnected") {
    return {
      title: "Classroom can be connected",
      message: "Connect when you want StudentOS to include Classroom coursework in your study plan.",
      badge: "optional setup",
      detail: "No Classroom connection is active.",
    };
  }
  if (stateName === "reconnect_required") {
    return {
      title: "Reconnect Classroom",
      message: "Reconnect Classroom to refresh imported assignments.",
      badge: "reconnect needed",
      detail: "Existing StudentOS work was not changed.",
    };
  }
  return {
    title: "Classroom setup is not active",
    message: "Your workspace is ready. Classroom importing can be turned on later.",
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
  return pattern || "25 min focus / 5 min break";
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

function retrievalModeLabel(mode) {
  const value = String(mode || "").toLowerCase();
  if (!value) return "";
  if (value.includes("uploaded") || value.includes("source") || value.includes("rag")) return "uses your materials";
  if (value.includes("web")) return "reference check";
  return "";
}

function retrievalModeTag(grounding = {}) {
  const label = retrievalModeLabel(grounding.retrievalMode);
  return label ? tag(label, "source") : "";
}

function buildSourceAiPrompt(source, course, embeddedCount) {
  return [
    `Explain this source for study use: ${source.title}.`,
    `Course: ${course?.title || "Course not set"}.`,
    `Type: ${sourceTypeLabel(source)}.`,
    `Source sections: ${embeddedCount}.`,
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
  "pricing",
  "trial_choice",
  "payment_method",
  "legal_consent",
  "about_you",
  "education_system",
  "daily_schedule",
  "exam_pattern",
  "academic_context",
  "classroom_setup",
  "materials",
  "setup_summary",
  "workspace_preparation",
  "tutorial",
]);

const ONBOARDING_PAGE_COPY = Object.freeze({
  about_you: {
    title: "About You",
    copy: "Let’s start with what you would like StudentOS to call you.",
    fields: [{ name: "displayName", label: "Your name", required: true, placeholder: "Your name" }],
  },
  education_system: {
    title: "Education System",
    copy: "Share the academic setting you are working in. You can refine this later.",
    fields: [
      { name: "level", label: "Level or year", placeholder: "For example, Grade 12 or second year" },
      { name: "institution", label: "School, college, or institution", placeholder: "Optional" },
      { name: "course", label: "Stream or course", placeholder: "Optional" },
    ],
  },
  daily_schedule: {
    title: "Daily Schedule",
    copy: "Tell StudentOS when study usually fits into your day.",
    fields: [{ name: "schedule", label: "Typical study times", placeholder: "For example, weekdays after 6 PM", multiline: true }],
  },
  exam_pattern: {
    title: "Exam and Assessment Pattern",
    copy: "Add the assessment rhythm you want Today to keep in mind.",
    fields: [{ name: "examPattern", label: "Exams and assessments", placeholder: "For example, monthly tests and a semester exam", multiline: true }],
  },
  academic_context: {
    title: "Syllabus and Academic Context",
    copy: "List the subjects or courses that should shape your first workspace.",
    fields: [
      { name: "subjects", label: "Subjects or courses", placeholder: "One per line is fine", multiline: true },
      { name: "syllabusNotes", label: "Syllabus notes", placeholder: "Add anything useful, or skip for now", multiline: true },
    ],
  },
});

function productPlan(planId) {
  return (runtimeConfig.billing?.plans || []).find((plan) => plan.id === planId) || null;
}

function productPlanName(planId) {
  return productPlan(planId)?.label || humanize(planId || "selected plan");
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
  const plans = runtimeConfig.billing?.plans || [];
  return `
    <p class="eyebrow">Choose your plan</p>
    <h2 id="product-flow-title">Build your academic workspace</h2>
    <p class="product-flow-lead">Choose the support level that fits your semester. StudentOS has no free tier, and every plan can begin with optional Trial Mode.</p>
    <div class="product-pricing-grid">
      ${plans.map((plan) => `
        <article class="product-plan-card">
          <p class="eyebrow">${escapeHtml(plan.label)}</p>
          <h3>₹${escapeHtml(plan.priceMonthlyInr) }<small>/month</small></h3>
          <ul>${(plan.highlights || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <button class="primary-button wide" type="button" data-product-action="select-plan" data-plan-id="${escapeHtml(plan.id)}">Choose ${escapeHtml(plan.label)}</button>
        </article>
      `).join("")}
    </div>
  `;
}

function trialChoiceMarkup(lifecycle) {
  const label = productPlanName(lifecycle.selectedPlanId);
  return `
    <p class="eyebrow">How would you like to start?</p>
    <h2 id="product-flow-title">You selected ${escapeHtml(label)}</h2>
    <p class="product-flow-lead">Trial Mode gives you limited access for 7 days before your ${escapeHtml(label)} subscription starts. Trial features are not the same as ${escapeHtml(label)}.</p>
    <div class="product-choice-grid">
      <button class="choice-card" type="button" data-product-action="choose-access" data-access-mode="trial">
        <strong>Start with Trial Mode</strong>
        <span>Try the guided workspace with limited access for 7 days.</span>
      </button>
      <button class="choice-card" type="button" data-product-action="choose-access" data-access-mode="paid_plan">
        <strong>Start ${escapeHtml(label)} now</strong>
        <span>Continue directly with your selected plan.</span>
      </button>
    </div>
    <button class="text-button" type="button" data-product-action="back-to-pricing">Choose a different plan</button>
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
      <p>${enabled ? "For current development, you can safely continue through the access check without a real charge or recurring mandate." : "This access step is not available in this environment yet. Your workspace will stay locked until verified billing is enabled."}</p>
    </div>
    <button class="primary-button" type="button" data-product-action="verify-payment" ${enabled ? "" : "disabled"}>Continue in development mode</button>
    <p class="form-help">Selected start: ${escapeHtml(lifecycle.accessMode === "trial" ? "7-day Trial Mode" : productPlanName(lifecycle.selectedPlanId))}</p>
  `;
}

function legalStepMarkup() {
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
  return `
    <p class="eyebrow">Required agreement</p>
    <h2 id="product-flow-title">Review before we build your workspace</h2>
    <p class="product-flow-lead">Please review each item separately. All acknowledgements are required before onboarding.</p>
    <form id="product-legal-form" class="product-flow-form">
      <fieldset class="legal-check-list">
        <legend>Terms, privacy, and responsible use</legend>
        ${agreements.map(([name, label]) => `<label class="check-row"><input name="${name}" type="checkbox" required><span>${escapeHtml(label)}</span></label>`).join("")}
      </fieldset>
      <fieldset class="age-gate-list">
        <legend>Age and consent</legend>
        <label class="check-row"><input name="ageGate" type="radio" value="adult" required><span>I am 18 or older.</span></label>
        <label class="check-row"><input name="ageGate" type="radio" value="minor" required><span>I am under 18 and have parent/guardian consent.</span></label>
        <label class="check-row guardian-ack"><input name="guardianConsentAcknowledged" type="checkbox"><span>If I am under 18, I confirm my parent or guardian has reviewed and agreed to this setup.</span></label>
      </fieldset>
      <div id="product-flow-message" class="result-box" aria-live="polite"></div>
      <button class="primary-button" type="submit">Agree and continue</button>
    </form>
  `;
}

function onboardingStepMarkup(lifecycle, step) {
  const page = ONBOARDING_PAGE_COPY[step];
  const saved = lifecycle.onboarding?.answers?.[step] || {};
  return `
    <p class="eyebrow">Guided setup</p>
    <h2 id="product-flow-title">${escapeHtml(page.title)}</h2>
    <p class="product-flow-lead">${escapeHtml(page.copy)}</p>
    <form id="product-onboarding-form" class="product-flow-form" data-step="${escapeHtml(step)}">
      ${page.fields.map((field) => `
        <label>${escapeHtml(field.label)}
          ${field.multiline
            ? `<textarea name="${escapeHtml(field.name)}" rows="4" placeholder="${escapeHtml(field.placeholder)}">${escapeHtml(saved[field.name] || "")}</textarea>`
            : `<input name="${escapeHtml(field.name)}" type="text" value="${escapeHtml(saved[field.name] || (field.name === "displayName" ? state.studentProfile?.displayName || "" : ""))}" placeholder="${escapeHtml(field.placeholder)}" ${field.required ? "required" : ""}>`}
        </label>
      `).join("")}
      <div id="product-flow-message" class="result-box" aria-live="polite"></div>
      <div class="product-form-actions">
        <button class="primary-button" type="submit">Save and continue</button>
        ${step === "about_you" ? "" : `<button class="text-button" type="submit" name="skipStep" value="true">Skip for now</button>`}
      </div>
    </form>
  `;
}

function classroomStepMarkup(lifecycle) {
  if (lifecycle.classroomChoice === "classroom" && !lifecycle.classroomConnectedAt) {
    return `
      <p class="eyebrow">Classroom setup</p>
      <h2 id="product-flow-title">Connect Google Classroom</h2>
      <p class="product-flow-lead">Connect your account so StudentOS can show coursework you may want to add to your academic context.</p>
      <div id="product-flow-message" class="result-box" aria-live="polite"></div>
      <button class="primary-button" type="button" data-product-action="connect-classroom">Connect Google Classroom</button>
      <button class="text-button" type="button" data-product-action="choose-path" data-choice="manual">My institution does not use Classroom</button>
    `;
  }
  return `
    <p class="eyebrow">Classroom or manual setup</p>
    <h2 id="product-flow-title">How should StudentOS find your coursework?</h2>
    <p class="product-flow-lead">Choose the path that matches your institution. Both paths lead to the same calm academic workspace.</p>
    <div class="product-choice-grid">
      <button class="choice-card" type="button" data-product-action="choose-path" data-choice="classroom">
        <strong>Connect Google Classroom</strong>
        <span>Choose coursework to include in your academic context.</span>
      </button>
      <button class="choice-card" type="button" data-product-action="choose-path" data-choice="manual">
        <strong>My institution does not use Classroom</strong>
        <span>Add your own subjects and materials now or later.</span>
      </button>
    </div>
  `;
}

function materialCandidates() {
  const rows = [
    ...(state.sourceMaterials || []).map((item) => ({ id: item.id, title: item.title, date: item.createdAt || item.importedAt || "" })),
    ...(state.assignments || []).filter((item) => item.source === "google_classroom").map((item) => ({ id: item.id, title: item.title, date: item.classroomUpdatedAt || item.dueDate || "" })),
  ];
  return rows.sort((left, right) => timestampFor(right.date) - timestampFor(left.date));
}

function materialsStepMarkup(lifecycle) {
  const candidates = materialCandidates();
  const classroom = lifecycle.classroomChoice === "classroom";
  return `
    <p class="eyebrow">Select academic materials</p>
    <h2 id="product-flow-title">Choose what belongs in your first workspace</h2>
    <p class="product-flow-lead">${classroom ? "Select the newest coursework and materials you want StudentOS to organize." : "Add a few material names now, or continue and add them later."}</p>
    <form id="product-materials-form" class="product-flow-form">
      ${candidates.length ? `<div class="material-choice-list">${candidates.map((item) => `
        <label class="check-row"><input name="materialIds" type="checkbox" value="${escapeHtml(item.id)}" data-material-label="${escapeHtml(item.title)}"><span>${escapeHtml(item.title)}</span></label>
      `).join("")}</div>` : `<div class="product-empty-state"><strong>No materials are waiting yet</strong><p>You can continue now and add material when your workspace is ready.</p></div>`}
      ${classroom ? "" : `<label>Materials you may add<textarea name="materialLabels" rows="4" placeholder="For example, Chemistry syllabus&#10;Statistics lecture notes"></textarea></label>`}
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
      <div><dt>Stream or course</dt><dd>${escapeHtml(summaryValue(lifecycle, "course"))}</dd></div>
      <div><dt>Subjects or courses</dt><dd>${escapeHtml(summaryValue(lifecycle, "subjects"))}</dd></div>
      <div><dt>Exam pattern</dt><dd>${escapeHtml(summaryValue(lifecycle, "examPattern"))}</dd></div>
      <div><dt>Timetable</dt><dd>${escapeHtml(summaryValue(lifecycle, "schedule"))}</dd></div>
      <div><dt>Setup path</dt><dd>${escapeHtml(lifecycle.classroomChoice === "classroom" ? "Google Classroom" : "Manual academic context")}</dd></div>
      <div><dt>Selected materials</dt><dd>${escapeHtml(materialLabels.length ? materialLabels.join(", ") : "Add later")}</dd></div>
    </dl>
    <div class="product-form-actions">
      <button class="primary-button" type="button" data-product-action="confirm-summary">Yes, prepare my workspace</button>
      <button class="secondary-button" type="button" data-product-action="confirm-summary">Continue with what I have</button>
      <button class="text-button" type="button" data-product-action="edit-setup" data-target-step="about_you">Edit summary</button>
      <button class="text-button" type="button" data-product-action="edit-setup" data-target-step="academic_context">Add more details</button>
    </div>
    <div id="product-flow-message" class="result-box" aria-live="polite"></div>
  `;
}

function preparationStepMarkup(lifecycle) {
  const started = Boolean(lifecycle.workspacePreparationStartedAt);
  return `
    <p class="eyebrow">Preparing Workspace</p>
    <h2 id="product-flow-title">${started ? "Your workspace is taking shape" : "Ready to prepare your workspace"}</h2>
    <p class="product-flow-lead">StudentOS will organize what you shared into a useful first day.</p>
    <ul class="preparation-list">
      <li>Reading your academic context</li>
      <li>Organizing your courses</li>
      <li>Preparing your first study plan</li>
      <li>Checking upcoming work</li>
      <li>Building your Today view</li>
    </ul>
    <button class="primary-button" type="button" data-product-action="${started ? "complete-preparation" : "start-preparation"}">${started ? "Continue when ready" : "Prepare workspace"}</button>
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
  if (!lifecycle || !els.productFlowContent) return;
  renderProductProgress(lifecycle);
  const step = lifecycle.nextStep;
  if (step === "pricing") els.productFlowContent.innerHTML = pricingStepMarkup();
  else if (step === "trial_choice") els.productFlowContent.innerHTML = trialChoiceMarkup(lifecycle);
  else if (step === "payment_method") els.productFlowContent.innerHTML = paymentStepMarkup(lifecycle);
  else if (step === "legal_consent") els.productFlowContent.innerHTML = legalStepMarkup();
  else if (ONBOARDING_PAGE_COPY[step]) els.productFlowContent.innerHTML = onboardingStepMarkup(lifecycle, step);
  else if (step === "classroom_setup") els.productFlowContent.innerHTML = classroomStepMarkup(lifecycle);
  else if (step === "materials") els.productFlowContent.innerHTML = materialsStepMarkup(lifecycle);
  else if (step === "setup_summary") els.productFlowContent.innerHTML = setupSummaryMarkup(lifecycle);
  else if (step === "workspace_preparation") els.productFlowContent.innerHTML = preparationStepMarkup(lifecycle);
  else if (step === "tutorial") els.productFlowContent.innerHTML = tutorialStepMarkup(lifecycle);
  else els.productFlowContent.innerHTML = `<p class="eyebrow">Setup</p><h2 id="product-flow-title">Continue your StudentOS setup</h2><p>Your next step is ready.</p>`;
}

function render() {
  if (!state) return;
  updateShellVisibility();
  if (productSetupActive()) {
    renderProductFlow();
    return;
  }
  const lifecyclePlan = productPlan(state.productLifecycle?.selectedPlanId);
  const plan = lifecyclePlan || accountSnapshot?.quota?.plan || state.saas?.quotas?.defaultPlan || runtimeConfig.saas?.quotas?.defaultPlan || { label: "Starter" };
  els.studentName.textContent = state.studentProfile.displayName || "Student";
  els.creditBalance.textContent = state.creditBalance || 0;
  els.planBadge.textContent = plan.label || "Starter";
  els.studyRhythm.textContent = humanize(state.studentProfile.studyRhythm || "steady");
  els.creditEligibility.textContent = humanize(state.studentProfile.convenienceEligibility || "learning first");
  const backendPersistence = runtimeConfig.persistence || {};
  els.connectorStatus.textContent = backendModeLabel(backendPersistence.mode || state.persistence?.mode || "unknown mode");
  renderClassroomPanel();
  renderDashboardSummary();
  renderRoadmap();
  renderTimetable();
  renderAssignments();
  renderCourses();
  renderSources();
  renderSelects();
  renderAccount();
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
  const nextCourse = courseById(nextAction?.courseId || dueSoon?.courseId);
  const nextTopic = topicById(nextAction?.topicId || dueSoon?.topicIds?.[0]);
  const nextExam = upcomingExams[0] || null;
  const availability = preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes || 90;
  const doNowTitle = studentTaskTitle(nextAction?.title || dueSoon?.title || "Plan first study block");
  const doNowContext = [
    nextCourse?.title || nextAction?.courseTitle,
    nextTopic?.title || nextAction?.topicTitle,
  ].filter(Boolean).join(" / ") || "Academic focus";
  const riskCopy = weakTopics.map((topic) => topic.title).join(" / ") || "No weak topics yet";
  const planPrompt = buildTodayPlanPrompt(nextAction, dueSoon, nextBlock);
  setResult(els.dashboardSummary, `
    <article class="today-brief-card">
      <div class="today-brief-copy">
        <p class="eyebrow">Today Command Center</p>
        <h3><span>Do now</span>${escapeHtml(doNowTitle)}</h3>
        <p>Goal: ${escapeHtml(getAcademicGoalLabel())} / ${escapeHtml(preferences.stream || state.studentProfile?.gradeBand || "Academic plan")}</p>
        <div class="tag-row">
          ${tag(doNowContext, "source")}
          ${tag(`${availability} min available`, "source")}
          ${tag(studyBreakLabel(preferences.studyBreakPattern), "medium")}
        </div>
      </div>
      <div class="today-brief-actions">
        <button class="primary-button ai-context-button" type="button" data-ai-open data-ai-verb="Plan" data-ai-prompt="${escapeHtml(planPrompt)}">Plan this block</button>
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
        <span>Due soon</span>
        <strong>${escapeHtml(dueSoon ? formatDate(dueSoon.dueDate) : "None")}</strong>
        <p>${escapeHtml(dueSoon?.title || "No due work listed")}</p>
      </article>
      <article class="today-status-item" role="listitem">
        <span>Next block</span>
        <strong>${escapeHtml(nextBlock ? formatTime(nextBlock.startsAt) : "Open")}</strong>
        <p>${escapeHtml(nextBlock?.title || "Use the study window")}</p>
      </article>
      <article class="today-status-item" role="listitem">
        <span>Materials</span>
        <strong>${activeSources.length ? "Sources ready" : "Add sources"}</strong>
        <p>${escapeHtml(activeSources.filter((source) => source.status === "needs_ocr").length ? "Some need review" : `${indexedSources.length} ready for study`)}</p>
      </article>
      <article class="today-status-item" role="listitem">
        <span>Roadmap</span>
        <strong>${openRoadmap.length ? `${openRoadmap.length} next` : "Clear"}</strong>
        <p>${escapeHtml(completedRoadmap.length ? `${completedRoadmap.length} finished` : "Generate or sync work")}</p>
      </article>
    </div>
  `);
}

function renderRoadmap() {
  const actions = getNextActions();
  if (!actions.length) {
    setResult(els.roadmapList, `
      <article class="item-card roadmap-empty-card">
        <strong>Queue is clear</strong>
        <p>Generate a roadmap in Setup or sync Classroom to build today's study list.</p>
        <div class="item-meta">
          ${tag("Today ready", "source")}
          ${tag("student controlled", "source")}
        </div>
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
        <p>Add classes or study blocks in Setup so Today can protect your time.</p>
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
  setResult(els.classroomPanel, `
    <div class="classroom-compact-head">
      <div>
        <strong>${escapeHtml(ui.title || classroomModeLabel(stateName))}</strong>
        <p>${escapeHtml(ui.message || "StudentOS can include Classroom coursework in your study plan.")}</p>
      </div>
      ${summary ? `<span>${escapeHtml(`${summary.importedAssignments || 0} new / ${summary.updatedAssignments || 0} updated`)}</span>` : ""}
    </div>
    <div class="tag-row">
      ${tag(ui.badge || classroomModeLabel(stateName), stateName === "reconnect_required" ? "medium" : "source")}
      ${lastSync ? tag(`synced ${formatDate(lastSync)}`, "source") : ""}
      ${providerEmail && stateName === "connected" ? tag("connected account", "source") : ""}
    </div>
    ${ui.detail ? `<p>${escapeHtml(ui.detail)}</p>` : actions.sync ? `<p>Use Sync Classroom when you want the latest assignments in StudentOS.</p>` : ""}
    ${emptyClassroom ? `<p class="muted-copy">No active Classroom coursework was found. StudentOS is ready to refresh when new work appears.</p>` : ""}
    ${showDetails ? `
      <details class="classroom-details">
        <summary>Sync details</summary>
        ${summary ? `<p>${escapeHtml(`${summary.importedCourses || 0} course(s), ${summary.importedAssignments || 0} new assignment(s), ${summary.updatedAssignments || 0} updated${summary.emptyClassroom ? " / no active coursework" : ""}`)}</p>` : ""}
        ${history.length ? `
          <div class="mini-history">
            ${history.slice(0, 4).map((run) => `
              <span>${escapeHtml(humanize(run.status))}: ${escapeHtml(formatDate(run.completedAt || run.startedAt))} / ${run.importedAssignments || 0}+${run.updatedAssignments || 0} assignments${run.errorCount ? " / needs review" : ""}</span>
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
  const classroomCourses = state.courses.filter((course) => course.source === "google_classroom").length;
  const classroomAssignments = state.assignments.filter((assignment) => assignment.source === "google_classroom").length;
  const stateName = normalizedClassroomState(connector);
  const ui = classroomUi(connector, summary, history);
  const emptyClassroom = summary?.emptyClassroom || history.some((run) => run.payload?.emptyClassroom);
  if (["disabled", "setup_required", "status_pending"].includes(stateName) && !classroomCourses && !classroomAssignments) {
    return "";
  }
  return `
    <article class="course-card course-workspace-card classroom-import-card" data-color="sky">
      <header class="course-card-head">
        <div>
          <span class="workspace-label">Connector workspace</span>
          <strong>Google Classroom import</strong>
          <p>${providerEmail ? `Connected as ${escapeHtml(providerEmail)}` : "Classroom planning import"}</p>
        </div>
      </header>
      <div class="tag-row">
        ${tag(ui.badge || classroomModeLabel(stateName), stateName === "reconnect_required" ? "medium" : "source")}
        ${tag(`${classroomCourses} course(s)`, "source")}
        ${tag(`${classroomAssignments} assignment(s)`, "source")}
        ${lastSync ? tag(`synced ${formatDate(lastSync)}`, "source") : tag("manual sync", "medium")}
        ${tag("student controlled", "source")}
      </div>
      <div class="course-signal-grid">
        <span><strong>${classroomCourses}</strong> imported courses</span>
        <span><strong>${classroomAssignments}</strong> imported assignments</span>
        <span><strong>${lastSync ? formatDate(lastSync) : "Manual"}</strong> sync</span>
      </div>
      ${emptyClassroom ? `<p class="muted-copy">No active Classroom coursework was found yet.</p>` : ""}
      ${stateName === "reconnect_required" ? `<p class="warning-copy">Reconnect Classroom to refresh imported assignments.</p>` : ""}
    </article>
  `;
}

function renderAssignments() {
  if (!state.assignments.length) {
    const connector = activeClassroomConnector();
    const actions = classroomActions(connector);
    const emptyCopy = actions.connect || actions.reconnect
      ? "Connect Classroom, or add work from your courses to start the learning loop."
      : "Add work from your courses to start the learning loop.";
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
  const assignments = getDueAssignments();
  setResult(els.assignmentList, assignments.map((assignment, index) => {
    const course = courseById(assignment.courseId);
    const insight = assignmentInsightById(assignment.id);
    const isClassroom = assignment.source === "google_classroom";
    const isPrimary = index === 0;
    const primaryLabel = isClassroom ? "Latest Classroom" : "Nearest due";
    return `
      <article class="item-card assignment-card ${isPrimary ? "assignment-card-primary" : ""}">
        ${isPrimary ? `<span class="queue-label">${escapeHtml(primaryLabel)}</span>` : ""}
        <strong>${escapeHtml(assignment.title)}</strong>
        <p>${escapeHtml(course?.title || "Course")} / due ${formatDate(assignment.dueDate)}</p>
        <div class="item-meta">
          ${tag(assignment.status === "due_soon" ? "due soon" : assignment.status, assignment.status === "due_soon" ? "medium" : "low")}
          ${isClassroom ? tag("Google Classroom", "source") : tag(humanize(assignment.source))}
          ${assignment.readOnly ? tag("planning only", "source") : ""}
          ${isClassroom ? tag("learning flow ready", "medium") : ""}
          ${assignment.submissionStatus ? tag(humanize(assignment.submissionStatus), "source") : ""}
          ${insight ? tag(humanize(insight.status), toneForCoverage(insight.status)) : ""}
        </div>
        ${insight ? `<p class="muted-copy">${escapeHtml(insight.summary)}</p>` : ""}
        <button class="mini-action" type="button" data-flow-id="${assignment.id}">${isClassroom ? "Analyze assignment" : "Analyze"}</button>
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
    return `
      <article class="course-card course-workspace-card" data-color="${escapeHtml(course.color || "mint")}">
        <header class="course-card-head">
          <div>
            <span class="workspace-label">Workspace preview</span>
            <strong>${escapeHtml(course.title)}</strong>
            <p>${escapeHtml(course.teacher || "Teacher")} / exam ${formatDate(course.examDate)}</p>
          </div>
          <button class="mini-action ai-context-button" type="button" data-ai-open data-ai-verb="Ask" data-ai-prompt="${escapeHtml(prompt)}">Ask about course</button>
        </header>

        <div class="course-progress-row">
          <div class="progress-track" aria-label="Mastery progress">
            <div class="progress-fill" style="width:${progress}%"></div>
          </div>
          <span>${steadyTopics.length ? `${steadyTopics.length} topic${steadyTopics.length === 1 ? "" : "s"} on track` : "Revision starting"}</span>
        </div>

        <div class="course-signal-grid">
          <span><strong>${weakTopics.length}</strong> weak topics</span>
          <span><strong>${assignments.length}</strong> due items</span>
          <span><strong>${escapeHtml(sourcesReadyLabel)}</strong> sources</span>
          <span><strong>${escapeHtml(nextActionReadyLabel)}</strong> next action</span>
        </div>

        <div class="tag-row">
          ${isClassroom ? tag("Google Classroom", "source") : ""}
          ${course.readOnly ? tag("planning only", "source") : ""}
          ${isClassroom || course.readOnly ? tag("Student controlled", "source") : ""}
          ${revisionCount ? tag("Needs revision", "medium") : tag("On track", "source")}
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
            <p>${escapeHtml(sources.slice(0, 2).map((source) => source.title).join(" / ") || "Upload course material in Memory")}</p>
          </div>
          <div>
            <span>Next action</span>
            <p>${escapeHtml(nextAction ? `${studentTaskTitle(nextAction.title)} / ${nextActionLabel}` : "Generate or sync work to create a next action")}</p>
          </div>
        </div>
        ${isClassroom && !classroomAssignments.length ? `<p class="muted-copy">Classroom course imported. Sync again when coursework is published.</p>` : ""}
      </article>
    `;
  }).join("");
  const empty = state.courses.length ? "" : `
    <article class="course-card course-workspace-card" data-color="sky">
      <span class="workspace-label">Workspace preview</span>
      <strong>No courses yet</strong>
      <p>Use Setup or sync Google Classroom to create your StudentOS course map.</p>
      <div class="tag-row">
        ${tag("Classroom ready", "source")}
        ${tag("student-only", "source")}
      </div>
    </article>
  `;
  els.coursesGrid.innerHTML = `${classroomStatusCard()}${courseCards || empty}`;
}

function renderSources() {
  const health = state.queueHealth || { counts: {}, failedJobs: [], processingJobs: [], retryableFailed: 0 };
  const activeSources = (state.sourceMaterials || [])
    .filter((source) => !source.deletedAt)
    .sort((left, right) => {
      const freshness = classroomFreshnessTimestamp(right) - classroomFreshnessTimestamp(left);
      if (freshness) return freshness;
      return String(left.id || left.title || "").localeCompare(String(right.id || right.title || ""));
    });
  const indexedSources = activeSources.filter(sourceIsIndexed);
  const needsAttentionCount = activeSources.filter((source) => source.extractionError || source.ocrRequired || source.status === "needs_ocr").length;
  const search = sourceSearchQuery.trim().toLowerCase();
  const failedCount = health.counts?.failed || 0;
  const stuckCount = health.stuckJobsCount || 0;
  const reviewCount = failedCount + stuckCount + needsAttentionCount;
  const queueCard = `
    <article class="source-card library-health-card">
      <div class="library-health-head">
        <div>
          <span class="workspace-label">Sources ready</span>
          <strong>${activeSources.length ? `${indexedSources.length} ready for study` : "No sources yet"}</strong>
          <p>Your uploads stay private. Sources that need attention are called out without exposing processing details first.</p>
        </div>
        <button class="mini-action" type="button" data-retry-failed-jobs>Retry source issues</button>
      </div>
      <div class="tag-row">
        ${tag(activeSources.length ? "Saved privately" : "Upload ready", "source")}
        ${reviewCount ? tag("Needs review", "urgent") : tag("Sources ready", "source")}
        ${tag("Uses your materials", "source")}
      </div>
      <details class="source-technical-details">
        <summary>Library details</summary>
        <div class="source-health-grid">
          <span><strong>${activeSources.length}</strong> saved sources</span>
          <span><strong>${health.counts?.queued || 0}</strong> waiting</span>
          <span><strong>${health.counts?.processing || 0}</strong> preparing</span>
          <span><strong>${failedCount}</strong> needs review</span>
          <span><strong>${stuckCount}</strong> delayed</span>
          <span><strong>${health.counts?.completed || 0}</strong> ready</span>
        </div>
        ${health.processingJobs?.length ? `<p>${health.processingJobs.map((job) => escapeHtml(humanize(job.jobType))).join(", ")}</p>` : ""}
        ${health.failedJobs?.length ? `<p>${health.failedJobs.map((job) => escapeHtml(`${humanize(job.jobType)}: ${humanize(job.lastError || "failed")}`)).join(" / ")}</p>` : ""}
        ${health.failedReasons && Object.keys(health.failedReasons).length ? `<p>${Object.entries(health.failedReasons).map(([reason, count]) => escapeHtml(`${humanize(reason)} (${count})`)).join(" / ")}</p>` : ""}
      </details>
    </article>
  `;
  const sourceCards = activeSources.map((source) => {
    const course = courseById(source.courseId);
    const latestJob = latestSourceJob(source);
    const embeddedCount = sourceEmbeddedChunks(source);
    const healthLabel = sourceHealthLabel(source, latestJob, embeddedCount);
    const matchesSearch = !search || sourceSearchText(source, course, latestJob, embeddedCount).includes(search);
    if (!matchesSearch) return "";
    const prompt = buildSourceAiPrompt(source, course, embeddedCount);
    const needsReview = /needs|ocr|failed/i.test(`${healthLabel} ${latestJob?.status || ""} ${source.status || ""}`);
    const readyLabel = needsReview ? "Needs review" : (sourceIsIndexed(source) || embeddedCount ? "Ready" : "Saved privately");
    return `
      <article class="source-card source-library-card">
        <div class="source-card-head">
          <div>
            <span class="workspace-label">Private source</span>
            <strong>${escapeHtml(source.title)}</strong>
            <p>${escapeHtml(course?.title || "Course")} / ${escapeHtml(sourceTypeLabel(source))}</p>
          </div>
          <button class="mini-action ai-context-button" type="button" data-ai-open data-ai-verb="Ask" data-ai-prompt="${escapeHtml(prompt)}">${needsReview ? "Review source" : "Explain source"}</button>
        </div>
        <div class="tag-row">
          ${tag(readyLabel, needsReview ? "urgent" : "source")}
          ${tag(sourceVisibilityLabel(source), "source")}
          ${tag("Uses your materials", "source")}
        </div>
        <details class="source-technical-details">
          <summary>Source details</summary>
          <div class="source-health-grid source-card-metrics">
            <span><strong>${escapeHtml(sourceStatusLabel(healthLabel))}</strong> status</span>
            <span><strong>${embeddedCount}</strong> source sections</span>
            <span><strong>${source.citationLabel ? "ready" : "pending"}</strong> citation</span>
            <span><strong>${escapeHtml(source.webFallbackAllowed ? "outside references labeled" : "your materials only")}</strong> reference use</span>
          </div>
          ${source.extractionSummary ? `<p>${escapeHtml(source.extractionSummary)}</p>` : ""}
          ${source.extractionError || latestJob?.lastError ? `<p class="warning-copy">${escapeHtml(humanize(source.extractionError || latestJob.lastError))}</p>` : ""}
          ${source.extractedSnippet ? `<blockquote class="source-preview">${escapeHtml(source.extractedSnippet)}</blockquote>` : ""}
          <div class="source-action-row">
            <button class="mini-action" type="button" data-reindex-source-id="${source.id}">Retry source</button>
            <button class="mini-action danger-action" type="button" data-delete-source-id="${source.id}">Delete</button>
          </div>
        </details>
      </article>
    `;
  }).join("");
  const noSources = activeSources.length ? "" : `
    <article class="source-card source-empty-card">
      <strong>No source materials yet</strong>
      <p>Upload a private source to begin building your StudentOS source library.</p>
      <div class="tag-row">${tag("private upload ready", "source")}${tag("Private", "source")}</div>
    </article>
  `;
  const noMatches = activeSources.length && search && !sourceCards.trim() ? `
    <article class="source-card source-empty-card">
      <strong>No matching sources</strong>
      <p>Search checks titles, courses, source types, snippets, citation labels, and source status from the loaded library.</p>
      <div class="tag-row">${tag("searching this library", "source")}</div>
    </article>
  ` : "";
  els.sourceList.innerHTML = queueCard + (sourceCards || noMatches || noSources);
}

function renderSelects() {
  const courseOptions = state.courses.map((course) => `<option value="${course.id}">${escapeHtml(course.title)}</option>`).join("");
  const topicOptions = state.topics.map((topic) => `<option value="${topic.id}">${escapeHtml(topic.title)}</option>`).join("");
  const assignmentOptions = state.assignments.map((assignment) => `<option value="${assignment.id}">${escapeHtml(assignment.title)}</option>`).join("");
  els.sourceCourseSelect.innerHTML = courseOptions;
  els.scoreTopicSelect.innerHTML = topicOptions;
  els.extensionAssignmentSelect.innerHTML = assignmentOptions;
  els.flowAssignmentSelect.innerHTML = assignmentOptions;
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
  const value = String(status || "active").toLowerCase();
  if (value === "free") return "Legacy access";
  if (value === "active") return "Active plan";
  if (value === "past_due") return "Payment review needed";
  return humanize(status || "Active plan");
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

function planValueStatement(plan) {
  const copy = {
    starter: "Build a focused academic workspace and know what to do today.",
    essential: "Bring coursework and syllabus context into one study plan.",
    plus: "Create deeper revision plans for a heavier semester.",
    pro: "Get priority workspace preparation for demanding academic work.",
  };
  return copy[plan.id] || "A StudentOS plan for calm academic planning.";
}

function planFeatureBullets(plan) {
  return (plan.highlights || ["Build your academic workspace", "Prepare from your syllabus", "Know what to do today"]).slice(0, 6);
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
  const plan = selectedPlan || runtimeConfig.saas?.quotas?.defaultPlan || { id: "starter", label: "Starter", quotas: {}, features: {} };
  const activeSources = (state?.sourceMaterials || []).filter((source) => !source.deletedAt);
  return {
    user: {
      email: authSession?.user?.email || authSession?.email || "demo@studentos.local",
      authenticated: Boolean(authSession?.access_token),
      authMode: authSession?.access_token ? "supabase_auth" : "local_demo",
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
        status: "active",
        renewalAt: null,
        cancelAtPeriodEnd: false,
      },
      usage: {
        aiRequestsToday: (state?.aiMessages || []).filter((message) => message.role === "user").length,
        sourceCount: activeSources.length,
        uploadsToday: activeSources.length,
        courses: (state?.courses || []).length,
        workerJobsToday: (state?.backgroundJobs || []).length,
        reindexJobsToday: (state?.backgroundJobs || []).filter((job) => job.jobType === "source_reindex").length,
        storageBytes: activeSources.reduce((total, source) => total + Number(source.sizeBytes || 0), 0),
      },
      quotas: plan.quotas || {},
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
  const plan = selectedPlan || quota.plan || { label: "Starter", features: {} };
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
        <p>${escapeHtml(account.user?.email || "No email session")} - ${escapeHtml(accountAuthLabel(account.user?.authMode || "local_demo"))}</p>
      </div>
    </div>
    <div class="account-summary-list">
      <span><strong>${escapeHtml(plan.label || "Starter")}</strong> current plan</span>
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
        <strong>${escapeHtml(plan.label || "Starter")}</strong>
        <p>${escapeHtml(planValueStatement(plan))}</p>
      </div>
      <div class="account-plan-state">
        <span>Academic context ready</span>
        <p>You can add courses and selected material as your semester changes.</p>
      </div>
    </div>
    <ul class="pricing-feature-list">${planFeatureBullets(plan).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  `;
  renderLifecycle(account.lifecycle || {});
  renderPricing(plan.id);
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

function renderPricing(activePlanId = "starter") {
  if (!els.pricingPanel) return;
  const plans = runtimeConfig.billing?.plans || runtimeConfig.saas?.billing?.plans || [];
  if (!plans.length) {
    els.pricingPanel.innerHTML = `
      <article class="pricing-card pricing-empty-card">
        <strong>Plans unavailable</strong>
        <p>StudentOS could not load plan previews yet. Your current account settings remain available.</p>
      </article>
    `;
    return;
  }
  els.pricingPanel.innerHTML = plans.map((plan) => `
    <article class="pricing-card ${plan.id === activePlanId ? "active" : ""}">
      <div class="pricing-card-head">
        <span>${plan.id === activePlanId ? "Current plan" : "Plan option"}</span>
        <strong>${escapeHtml(plan.label)}</strong>
        <h4>₹${escapeHtml(plan.priceMonthlyInr)}<small>/month</small></h4>
        <p>${escapeHtml(planValueStatement(plan))}</p>
      </div>
      <ul class="pricing-feature-list">
        ${planFeatureBullets(plan).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
      <button class="${plan.id === activePlanId ? "secondary-button" : "primary-button"} wide pricing-cta" type="button" data-plan-preview="${escapeHtml(plan.id)}">
        ${plan.id === activePlanId ? "Current plan" : `Choose ${escapeHtml(plan.label)}`}
      </button>
    </article>
  `).join("");
}

function setView(viewName) {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${viewName}`);
  });
  const titles = { today: "Today", setup: "Setup", courses: "Courses", memory: "Memory", studio: "Studio", account: "Account" };
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
  if (accountSnapshot?.quota?.plan?.label) {
    els.planBadge.textContent = accountSnapshot.quota.plan.label;
  }
}

async function loadBootstrap(options = {}) {
  if (options.showLoading) {
    renderWorkspaceLoading(options.copy || "Loading your workspace...");
  } else {
    setAppLoading(true);
  }
  try {
    state = await api("/api/bootstrap");
    render();
    if (authSession?.access_token || !runtimeConfig.auth?.enabled) {
      await loadAccountSnapshot();
    } else {
      accountSnapshot = null;
      renderAccount();
    }
    await loadClassroomStatus();
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
    extra.push(`<strong>Flashcards</strong>${list(result.artifacts.flashcards.map((card) => `${card.front} / ${card.back}`))}`);
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
      <strong>Cited snippets</strong>
      <div class="source-snippets">
        ${result.grounding.snippets.map((item) => `
          <blockquote>
            <p>${escapeHtml(item.snippet)}</p>
            <cite>${escapeHtml(item.citationLabel || item.sourceTitle || "Uploaded source")} ${item.confidenceLabel ? `/ ${escapeHtml(item.confidenceLabel)} confidence` : ""}</cite>
          </blockquote>
        `).join("")}
      </div>
    `);
  }

  setResult(els.aiResponse, `
    <strong>${escapeHtml(result.verb)} result</strong>
    <p>${escapeHtml(result.answer)}</p>
      <div class="tag-row">
        ${result.coverage?.status ? tag(humanize(result.coverage.status), toneForCoverage(result.coverage.status)) : ""}
      ${retrievalModeTag(result.grounding)}
      ${result.grounding?.insufficientContext ? tag("not enough material yet", "urgent") : ""}
      ${(result.sourceLabels || []).map((source) => tag(source.label, "source")).join("")}
      ${result.webFallback?.allowed ? tag("references labeled", "medium") : ""}
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
          ${tag("citations not invented", "source")}
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
      <p>${escapeHtml(error.message || "StudentOS could not analyze this assignment. Refresh synced data and try again.")}</p>
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

function sampleAnswersForScore(topic, scorePercent) {
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
        answers: sampleAnswersForScore(topic, scorePercent),
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
  const form = new FormData(event.currentTarget);
  if (!form.get("file") || !form.get("file").name) {
    setResult(els.sourceResult, `<p>Choose a file first.</p>`);
    return;
  }
  await withButtonLoading(event.submitter, "Uploading...", async () => {
    setLoading(els.sourceResult, "Uploading to private source library...");
    try {
      const result = await api("/api/sources/upload", {
        method: "POST",
        body: form,
      });
      setResult(els.sourceResult, `
        <strong>${escapeHtml(result.material.title)}</strong>
        <p>${escapeHtml(result.material.extractionSummary || result.extractionSummary || "Private source registered.")}</p>
        ${result.material.extractionError ? `<p>${escapeHtml(humanize(result.material.extractionError))}</p>` : ""}
        <div class="tag-row">${tag("Private", "source")}${tag(sourceStatusLabel(result.material.status || result.status))}${tag(indexedSectionsLabel(result.material.chunkCount || result.chunkCount || 0), "source")}${tag("Private to your account", "source")}</div>
      `);
      await loadBootstrap();
    } catch (error) {
      setResult(els.sourceResult, `
        <strong>Source upload unavailable</strong>
        <p>${escapeHtml(error.message || "StudentOS could not finish adding this material. Check the file and try again.")}</p>
        <div class="tag-row">
          ${tag("try again", "medium")}
          ${tag("Private", "source")}
          ${tag("Private to your account", "source")}
        </div>
      `);
    }
  }, { timeoutTarget: els.sourceResult, timeoutCopy: "Uploading is taking longer than expected. You can try again.", timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS });
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

async function seedDemoProfile() {
  setLoading(els.onboardingResult, "Loading demo student profile...");
  const result = await api("/api/demo/seed", {
    method: "POST",
    body: JSON.stringify({}),
  });
  state = result.state;
  renderOnboardingResult(result);
  render();
  setView("today");
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
    <p>No data has been deleted yet. This preview covers ${escapeHtml(summary.databaseRows || 0)} account record(s) and ${escapeHtml(summary.storageObjects || 0)} private file(s). ${escapeHtml(diffCopy)}</p>
    <div class="tag-row">
      ${tag(`${summary.sourceChunks || 0} source sections`, "source")}
      ${tag(`${summary.memoryItems || 0} study records`, "source")}
      ${tag(`${summary.embeddingMetadata || 0} search records`, "source")}
      ${tag(`${summary.backgroundJobs || 0} study update records`, "source")}
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
  setLoading(els.classroomPanel, "Syncing Classroom assignments...");
  const result = await api("/api/classroom/sync", {
    method: "POST",
    body: JSON.stringify({}),
  });
  state = result.state || state;
  classroomStatus = { connector: result.connector, syncSummary: result.summary, syncHistory: result.connector?.syncHistory || [] };
  classroomStatusLoaded = true;
  render();
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

async function transitionProductFlow(action, payload = {}) {
  try {
    if (els.productFlowAskResponse) els.productFlowAskResponse.hidden = true;
    els.productFlowAskBtn?.setAttribute("aria-expanded", "false");
    const result = await api("/api/product-flow", {
      method: "POST",
      body: JSON.stringify({ action, payload }),
    });
    state = result.state;
    render();
    if (state.productLifecycle?.dashboardActive) {
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
    return;
  }
  productFlowMessage(result.message || "Classroom is already connected. Refresh StudentOS to continue.");
}

async function handleProductFlowClick(event) {
  const button = event.target.closest("[data-product-action]");
  if (!button) return;
  const action = button.dataset.productAction;
  try {
    await withButtonLoading(button, "Saving...", async () => {
      if (action === "select-plan") await transitionProductFlow("select_plan", { planId: button.dataset.planId });
      else if (action === "back-to-pricing") await transitionProductFlow("reset_plan");
      else if (action === "choose-access") await transitionProductFlow("choose_access", { accessMode: button.dataset.accessMode });
      else if (action === "verify-payment") await transitionProductFlow("verify_payment_method_placeholder");
      else if (action === "choose-path") await transitionProductFlow("choose_classroom_path", { choice: button.dataset.choice });
      else if (action === "connect-classroom") await connectClassroomFromProductFlow();
      else if (action === "confirm-summary") await transitionProductFlow("confirm_setup_summary");
      else if (action === "start-preparation") await transitionProductFlow("start_workspace_preparation");
      else if (action === "complete-preparation") await transitionProductFlow("complete_workspace_preparation");
      else if (action === "choose-tutorial") await transitionProductFlow("choose_tutorial", { choice: button.dataset.choice });
      else if (action === "complete-tutorial") await transitionProductFlow("complete_tutorial");
      else if (action === "edit-setup") await transitionProductFlow("edit_setup", { targetStep: button.dataset.targetStep });
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
      const answers = Object.fromEntries([...new FormData(form).entries()].filter(([key]) => key !== "skipStep"));
      if (event.submitter?.value === "true") {
        for (const key of Object.keys(answers)) answers[key] = "";
      }
      await withButtonLoading(event.submitter, "Saving...", () => transitionProductFlow("save_onboarding_step", {
        step: form.dataset.step,
        answers,
      }));
      return;
    }
    if (form.id === "product-materials-form") {
      const checked = [...form.querySelectorAll("input[name='materialIds']:checked")];
      const typedLabels = String(new FormData(form).get("materialLabels") || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      await withButtonLoading(event.submitter, "Saving...", () => transitionProductFlow("save_materials", {
        materialIds: checked.map((input) => input.value),
        materialLabels: [...checked.map((input) => input.dataset.materialLabel || "Selected material"), ...typedLabels],
      }));
    }
  } catch {
    // transitionProductFlow has already shown student-safe copy.
  }
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
  els.productFlowAskBtn?.addEventListener("click", toggleProductFlowAsk);
  els.productFlowLogoutBtn?.addEventListener("click", () => {
    logout().catch((error) => productFlowMessage(error.message));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isAiDrawerOpen()) {
      closeAiDrawer();
    }
  });
  window.addEventListener("hashchange", syncAuthHash);
  document.addEventListener("click", (event) => {
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
    withButtonLoading(els.classroomSyncBtn, "Syncing...", syncClassroom, {
      timeoutTarget: els.classroomPanel,
      timeoutCopy: "Classroom sync is taking longer than expected. You can keep working while it finishes.",
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
  els.sourceSearchInput?.addEventListener("input", (event) => {
    sourceSearchQuery = event.currentTarget.value;
    renderSources();
  });
  els.onboardingForm.addEventListener("submit", submitOnboarding);
  els.demoSeedBtn.addEventListener("click", () => {
    withButtonLoading(els.demoSeedBtn, "Loading...", seedDemoProfile, {
      timeoutTarget: els.onboardingResult,
      timeoutCopy: "Loading the demo profile is taking longer than expected. You can try again.",
      timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
    }).catch((error) => {
      setResult(els.onboardingResult, `<p>${escapeHtml(error.message)}</p>`);
    });
  });
  els.sourceList.addEventListener("click", (event) => {
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
    withButtonLoading(button, "Preparing...", () => previewPlanUpgrade(button.dataset.planPreview), {
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
