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
let academicContextPreparationPoll = null;
let todayTodoGenerating = false;
let todayTodoMessage = "";
let selectedStudyItemId = null;
let studyWorkspaceMessage = "";
let studyMaterialGenerating = false;
let studyTestGenerating = false;
let studyTestCountdown = null;
let studyTestAutosave = null;
let studyTestExpiryRefreshPending = false;
let academicPdfObjectUrl = null;
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
  todayDashboardPanels: document.getElementById("today-dashboard-panels"),
  onboardingForm: document.getElementById("onboarding-form"),
  onboardingResult: document.getElementById("onboarding-result"),
  setupCourses: document.getElementById("setup-courses"),
  courseForm: document.getElementById("course-form"),
  courseId: document.getElementById("course-id"),
  courseName: document.getElementById("course-name"),
  courseCode: document.getElementById("course-code"),
  courseDepartment: document.getElementById("course-department"),
  courseTerm: document.getElementById("course-term"),
  courseSubmitButton: document.getElementById("course-submit-button"),
  courseEditCancel: document.getElementById("course-edit-cancel"),
  courseResult: document.getElementById("course-result"),
  savedCourses: document.getElementById("saved-courses"),
  roadmapList: document.getElementById("roadmap-list"),
  timetableList: document.getElementById("timetable-list"),
  assignmentList: document.getElementById("assignment-list"),
  coursesGrid: document.getElementById("courses-grid"),
  sourceSearchInput: document.getElementById("source-search-input"),
  sourceList: document.getElementById("source-list"),
  academicContextSummary: document.getElementById("academic-context-summary"),
  academicContextPrepareButton: document.getElementById("academic-context-prepare-button"),
  academicContextPreparationStatus: document.getElementById("academic-context-preparation-status"),
  academicContextAddButton: document.getElementById("academic-context-add-button"),
  academicContextUploadPanel: document.getElementById("academic-context-upload-panel"),
  academicContextCourseRecovery: document.getElementById("academic-context-course-recovery"),
  academicContextClassroomGuidance: document.getElementById("academic-context-classroom-guidance"),
  academicContextRoomStatus: document.getElementById("academic-context-room-status"),
  studyEvaluateContent: document.getElementById("study-evaluate-content"),
  sourceForm: document.getElementById("source-form"),
  sourceCourseSelect: document.getElementById("source-course-select"),
  sourceKindSelect: document.getElementById("source-kind-select"),
  sourceTitle: document.getElementById("source-title"),
  sourceDeadlineField: document.getElementById("source-deadline-field"),
  sourceDeadline: document.getElementById("source-deadline"),
  sourceSubmitButton: document.getElementById("source-submit-button"),
  sourceFile: document.getElementById("source-file"),
  sourceTitleError: document.getElementById("source-title-error"),
  sourceCourseError: document.getElementById("source-course-error"),
  sourceDeadlineError: document.getElementById("source-deadline-error"),
  sourceFileError: document.getElementById("source-file-error"),
  sourceCapacityMessage: document.getElementById("source-capacity-message"),
  sourceResult: document.getElementById("source-result"),
  examForm: document.getElementById("exam-form"),
  examId: document.getElementById("exam-id"),
  examCourseSelect: document.getElementById("exam-course-select"),
  examName: document.getElementById("exam-name"),
  examDate: document.getElementById("exam-date"),
  examTime: document.getElementById("exam-time"),
  examWeightage: document.getElementById("exam-weightage"),
  examNotes: document.getElementById("exam-notes"),
  examSubmitButton: document.getElementById("exam-submit-button"),
  examEditCancel: document.getElementById("exam-edit-cancel"),
  examResult: document.getElementById("exam-result"),
  examList: document.getElementById("exam-list"),
  academicContextDeleteDialog: document.getElementById("academic-context-delete-dialog"),
  academicContextDeleteCancel: document.getElementById("academic-context-delete-cancel"),
  academicContextDeleteConfirm: document.getElementById("academic-context-delete-confirm"),
  academicPdfViewer: document.getElementById("academic-pdf-viewer"),
  academicPdfViewerTitle: document.getElementById("academic-pdf-viewer-title"),
  academicPdfViewerStatus: document.getElementById("academic-pdf-viewer-status"),
  academicPdfViewerObject: document.getElementById("academic-pdf-viewer-object"),
  academicPdfViewerFallback: document.getElementById("academic-pdf-viewer-fallback"),
  academicPdfViewerClose: document.getElementById("academic-pdf-viewer-close"),
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
  if (state) {
    renderSources();
    renderCourses();
    updateProductFeatureControls();
  }
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

function academicContextFieldElements(field) {
  const map = {
    title: [els.sourceTitle, els.sourceTitleError],
    course: [els.sourceCourseSelect, els.sourceCourseError],
    deadline: [els.sourceDeadline, els.sourceDeadlineError],
    file: [els.sourceFile, els.sourceFileError],
  };
  return map[field] || [];
}

function setAcademicContextFieldMessage(field, message = "") {
  const [control, target] = academicContextFieldElements(field);
  if (target) target.textContent = message;
  if (control) {
    if (message) control.setAttribute("aria-invalid", "true");
    else control.removeAttribute("aria-invalid");
  }
}

function clearAcademicContextFieldMessages(field = "") {
  const fields = field ? [field] : ["title", "course", "deadline", "file"];
  fields.forEach((name) => setAcademicContextFieldMessage(name));
}

function sourceKindRequiresCourse(kind) {
  return kind !== "exam_schedule";
}

function sourceKindLabel(kind) {
  return {
    assignment: "assignment",
    material: "study material",
    syllabus: "syllabus",
    exam_schedule: "exam schedule",
  }[kind] || "PDF";
}

function validateAcademicContextUploadForm(form, kind, file) {
  clearAcademicContextFieldMessages();
  const invalid = [];
  if (!String(form.get("title") || "").trim()) {
    setAcademicContextFieldMessage("title", `Add a title for this ${kind}.`);
    invalid.push(els.sourceTitle);
  }
  const label = sourceKindLabel(kind);
  if (sourceKindRequiresCourse(kind) && !state.courses?.length) {
    setAcademicContextFieldMessage("course", "Add a course in Setup before uploading academic context.");
    invalid.push(els.sourceCourseSelect);
  } else if (sourceKindRequiresCourse(kind) && !form.get("courseId")) {
    setAcademicContextFieldMessage("course", `Choose a course for this ${label}.`);
    invalid.push(els.sourceCourseSelect);
  }
  if (kind === "assignment" && !form.get("deadline")) {
    setAcademicContextFieldMessage("deadline", "Set the assignment deadline before uploading.");
    invalid.push(els.sourceDeadline);
  }
  if (!file || !file.name || !/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) {
    setAcademicContextFieldMessage("file", "Choose a PDF file.");
    invalid.push(els.sourceFile);
  }
  invalid.find((control) => control && !control.disabled)?.focus();
  return invalid.length === 0;
}

function academicContextUploadErrorCopy(error, kind) {
  const message = String(error?.message || "");
  const lower = message.toLowerCase();
  if (lower.includes("pdf") || lower.includes("file")) return "Choose a PDF file and try again.";
  if (lower.includes("course")) return `Choose a course for this ${sourceKindLabel(kind)}.`;
  if (kind === "assignment" && (lower.includes("deadline") || lower.includes("due"))) return "Set the assignment deadline before uploading.";
  if (lower.includes("room") || lower.includes("limit") || lower.includes("plan")) return currentAcademicContextCapacity().message;
  return `StudentOS could not add this ${kind}. Check the details and try again.`;
}

function syncAcademicContextUploadType() {
  const kind = els.sourceKindSelect?.value || "assignment";
  const assignment = kind === "assignment";
  if (els.sourceDeadlineField) els.sourceDeadlineField.hidden = !assignment;
  if (els.sourceDeadline) {
    els.sourceDeadline.required = assignment;
    if (!assignment) els.sourceDeadline.value = "";
  }
  if (!assignment) clearAcademicContextFieldMessages("deadline");
  const kindHelp = document.getElementById("source-kind-help");
  if (kindHelp) {
    kindHelp.textContent = assignment
      ? "Assignments require a course and deadline."
      : kind === "exam_schedule"
        ? "Exam schedule PDFs can cover one course or the whole semester."
        : `${sourceKindLabel(kind).replace(/^./, (letter) => letter.toUpperCase())} PDFs require a course and no deadline.`;
  }
  if (els.sourceCourseSelect) els.sourceCourseSelect.required = sourceKindRequiresCourse(kind);
  if (els.sourceSubmitButton) els.sourceSubmitButton.textContent = `Upload ${sourceKindLabel(kind)}`;
}

function renderAcademicContextCourseRecovery(noCourses) {
  if (!els.academicContextCourseRecovery) return;
  els.academicContextCourseRecovery.hidden = !noCourses;
  if (!noCourses) {
    els.academicContextCourseRecovery.innerHTML = "";
    return;
  }
  const connector = activeClassroomConnector();
  const stateName = normalizedClassroomState(connector);
  const connected = stateName === "connected";
  const reconnect = stateName === "reconnect_required";
  const connectionAction = connected
    ? `<button class="secondary-button" type="button" data-course-refresh>Refresh course list</button>`
    : ["disconnected", "reconnect_required"].includes(stateName)
      ? `<button class="secondary-button" type="button" data-course-connect>${reconnect ? "Reconnect Classroom" : "Connect Classroom"}</button>`
      : "";
  els.academicContextCourseRecovery.innerHTML = `
    <strong>No courses found yet.</strong>
    <p>Refresh your Classroom course list or add a course in Setup before uploading academic context.</p>
    <p class="muted-copy">StudentOS will only refresh your course names. It will not import assignments or materials.</p>
    <div class="inline-actions">
      ${connectionAction}
      <button class="text-button" type="button" data-open-courses>Add course manually</button>
    </div>
  `;
}

function updateProductFeatureControls() {
  const capacity = currentAcademicContextCapacity();
  const noCourses = !(state?.courses || []).length;
  const courseRequired = sourceKindRequiresCourse(els.sourceKindSelect?.value || "assignment");
  const blockMaterialAdd = capacity.canAdd !== true || (courseRequired && noCourses);
  if (els.sourceFile) els.sourceFile.disabled = blockMaterialAdd;
  if (els.sourceCourseSelect) els.sourceCourseSelect.disabled = blockMaterialAdd;
  if (els.sourceKindSelect) els.sourceKindSelect.disabled = blockMaterialAdd;
  if (els.sourceTitle) els.sourceTitle.disabled = blockMaterialAdd;
  if (els.sourceDeadline) els.sourceDeadline.disabled = blockMaterialAdd;
  const sourceSubmit = document.querySelector("#source-form button[type='submit']");
  if (sourceSubmit) {
    sourceSubmit.disabled = blockMaterialAdd;
    sourceSubmit.title = noCourses ? "Add a course in Setup before uploading academic context." : blockMaterialAdd ? capacity.message : "";
  }
  if (els.sourceForm) els.sourceForm.setAttribute("aria-disabled", blockMaterialAdd ? "true" : "false");
  if (els.sourceCapacityMessage) {
    els.sourceCapacityMessage.textContent = noCourses && courseRequired
      ? "No courses found yet. Refresh your Classroom course list or add a course in Setup before uploading academic context."
      : capacity.message;
    els.sourceCapacityMessage.classList.toggle("warning-copy", capacity.status === "full");
  }
  if (els.academicContextRoomStatus) els.academicContextRoomStatus.textContent = capacity.message;
  if (noCourses && courseRequired) setAcademicContextFieldMessage("course", "Add a course in Setup before uploading academic context.");
  else if (els.sourceCourseError?.textContent === "Add a course in Setup before uploading academic context.") clearAcademicContextFieldMessages("course");
  renderAcademicContextCourseRecovery(noCourses && courseRequired);
  syncAcademicContextUploadType();
  if (els.examForm) {
    for (const control of els.examForm.querySelectorAll("input:not([type='hidden']), select, textarea, button")) {
      control.disabled = noCourses;
    }
    if (els.examSubmitButton) els.examSubmitButton.title = noCourses ? "Add a course in Setup before adding an exam." : "";
  }

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
    .filter((course) => !["google_classroom", "manual"].includes(course.source))
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

function courseSourceLabel(course = {}) {
  if (course.source === "google_classroom") return "From Classroom";
  if (course.source === "manual") return "Added manually";
  return "From Setup";
}

function courseManagementErrorCopy(error) {
  const message = String(error?.message || "");
  if (/course name|already in your saved courses|could not be found|original setup|assignments and materials/i.test(message)) return message;
  return "StudentOS could not save this course right now. Please try again.";
}

function resetCourseForm() {
  if (!els.courseForm) return;
  els.courseForm.reset();
  els.courseId.value = "";
  els.courseSubmitButton.textContent = "Add course";
  els.courseEditCancel.hidden = true;
}

function renderCourseManagement() {
  if (!els.savedCourses) return;
  const courses = state?.courses || [];
  if (!courses.length) {
    els.savedCourses.innerHTML = `
      <article class="saved-course-item">
        <strong>No saved courses yet</strong>
        <p>Add your first course above. It will be ready in Academic Context immediately.</p>
      </article>
    `;
    return;
  }
  els.savedCourses.innerHTML = courses.map((course) => {
    const details = [course.courseCode, course.department, course.term].filter(Boolean).join(" / ");
    const manualActions = course.source === "manual" ? `
      <div class="inline-actions">
        <button class="mini-action" type="button" data-edit-course-id="${escapeHtml(course.id)}">Edit</button>
        <button class="mini-action" type="button" data-archive-course-id="${escapeHtml(course.id)}">Archive</button>
      </div>
    ` : "";
    return `
      <article class="saved-course-item">
        <div>
          <strong>${escapeHtml(course.title)}</strong>
          <p>${escapeHtml(details || courseSourceLabel(course))}</p>
          ${details ? `<span class="muted-copy">${escapeHtml(courseSourceLabel(course))}</span>` : ""}
        </div>
        ${manualActions}
      </article>
    `;
  }).join("");
}

function openCourseSetup() {
  setView("setup");
  window.requestAnimationFrame(() => {
    els.setupCourses?.scrollIntoView({ behavior: "smooth", block: "start" });
    els.courseName?.focus({ preventScroll: true });
  });
}

function beginCourseEdit(courseId) {
  const course = courseById(courseId);
  if (!course || course.source !== "manual") return;
  openCourseSetup();
  els.courseId.value = course.id;
  els.courseName.value = course.title || "";
  els.courseCode.value = course.courseCode || "";
  els.courseDepartment.value = course.department || "";
  els.courseTerm.value = course.term || "";
  els.courseSubmitButton.textContent = "Save course";
  els.courseEditCancel.hidden = false;
  els.courseName.focus();
}

async function saveCourse(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const courseId = String(values.courseId || "").trim();
  const result = await api(courseId ? `/api/courses/${encodeURIComponent(courseId)}` : "/api/courses", {
    method: courseId ? "PATCH" : "POST",
    body: JSON.stringify(values),
  });
  state = result.state || state;
  resetCourseForm();
  render();
  setView("setup");
  setResult(els.courseResult, `<strong>${courseId ? "Course details saved." : "Course added."}</strong><p>${escapeHtml(result.message || "This course can now be used when uploading academic context.")}</p>`);
}

async function archiveCourse(courseId) {
  const course = courseById(courseId);
  if (!course || course.source !== "manual") return;
  if (!window.confirm(`Archive ${course.title}?`)) return;
  const result = await api(`/api/courses/${encodeURIComponent(courseId)}`, { method: "DELETE" });
  state = result.state || state;
  resetCourseForm();
  render();
  setView("setup");
  setResult(els.courseResult, `<strong>Course archived.</strong><p>You can add it again later if you need it.</p>`);
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
  renderCourseManagement();
  renderClassroomPanel();
  renderDashboardSummary();
  renderStudyAndEvaluate();
  renderRoadmap();
  renderTimetable();
  renderAssignments();
  renderCourses();
  renderSources();
  renderSelects();
  renderAccount();
  updateProductFeatureControls();
}

function currentActivePlanKey() {
  return String(state?.planAccess?.activePlanKey || state?.planAccess?.selectedPlanKey || state?.productLifecycle?.selectedPlanId || "").toLowerCase();
}

function usesAcademicTodayFlow() {
  return ["trial", "starter", "essential", "plus", "pro"].includes(currentActivePlanKey());
}

function localDateOnly(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function academicContextReadiness() {
  if (state?.academicContext?.status) return state.academicContext;
  const hasContext = Boolean((state?.courses || []).length || (state?.exams || []).length || (state?.assignments || []).length || (state?.sourceMaterials || []).length);
  return {
    status: hasContext ? "context_needs_preparation" : "context_empty",
    hasContext,
    hasUsefulContext: Boolean((state?.exams || []).length || (state?.assignments || []).length || (state?.sourceMaterials || []).length),
    canPrepare: hasContext,
    canGenerateTodo: false,
    message: hasContext ? "Your academic context is ready to prepare." : "Add your academic context first.",
  };
}

function todayTodoItemMarkup(item) {
  const related = [item.related_course, item.related_context].filter(Boolean);
  return `
    <li class="today-todo-item" data-priority="${escapeHtml(item.priority || "medium")}">
      <div class="today-todo-item-copy">
        <div class="today-todo-title-row">
          <h4>${escapeHtml(item.title)}</h4>
          ${tag(humanize(item.priority || "medium"), item.priority === "high" ? "urgent" : item.priority || "medium")}
        </div>
        <p>${escapeHtml(item.reason)}</p>
        ${related.length ? `<small>${escapeHtml(related.join(" / "))}</small>` : ""}
      </div>
      <strong class="today-todo-time">${escapeHtml(item.time_hint)}</strong>
    </li>
  `;
}

function contextPreparationSummaryMarkup(readiness) {
  const summary = readiness?.summary || {};
  const labels = [
    summary.coursesReady ? "Courses ready" : "",
    summary.assignmentsReady ? "Assignments ready" : "",
    summary.examDatesReady ? "Exam dates ready" : "",
    summary.materialsReady ? "Study material ready" : "",
    summary.selectedClassroomNeedsManualUpload ? "Some selected Classroom files need manual upload" : "",
  ].filter(Boolean);
  return labels.length ? `<div class="context-preparation-summary">${labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>` : "";
}

function renderStarterToday() {
  const readiness = academicContextReadiness();
  const currentPlan = state.todayPlan?.date === localDateOnly() ? state.todayPlan : null;
  if (els.todayDashboardPanels) els.todayDashboardPanels.hidden = true;
  document.getElementById("view-today")?.classList.add("starter-today-flow");

  if (todayTodoGenerating) {
    setResult(els.dashboardSummary, `
      <article class="starter-today-state starter-today-waiting" role="status" aria-live="polite">
        <span class="starter-context-spinner" aria-hidden="true"></span>
        <h3>Planning the rest of today.</h3>
        <p>StudentOS is using your prepared academic context and the time you have left today.</p>
      </article>
    `);
    return;
  }

  if (readiness.status === "context_preparing") {
    setResult(els.dashboardSummary, `
      <article class="starter-today-state starter-today-waiting" role="status" aria-live="polite">
        <span class="starter-context-spinner" aria-hidden="true"></span>
        <h3>Setting things up for you.</h3>
        <p>StudentOS is preparing your academic context so your study plan can use your courses, syllabus, assignments, and materials.</p>
        <small>${escapeHtml(readiness.someMaterialPreparing ? "Some material is still being prepared." : "Organizing your courses and checking assignments and dates")}</small>
      </article>
    `);
    return;
  }

  if (readiness.status === "context_classroom_backfill") {
    setResult(els.dashboardSummary, `
      <article class="starter-today-state starter-today-waiting" role="status" aria-live="polite">
        <span class="starter-context-spinner" aria-hidden="true"></span>
        <h3>Checking selected Classroom work.</h3>
        <p>StudentOS is checking only the Classroom work you chose for Academic Context.</p>
      </article>
    `);
    return;
  }

  if (readiness.status === "context_empty") {
    setResult(els.dashboardSummary, `
      <article class="starter-today-state">
        <p class="eyebrow">Today</p>
        <h3>Add your academic context first.</h3>
        <p>Add your courses, syllabus, exam dates, assignments, and materials so StudentOS can plan your day properly.</p>
        <div class="starter-today-actions"><button class="primary-button" type="button" data-today-action="academic-context">Go to Academic Context</button></div>
      </article>
    `);
    return;
  }

  if (["context_needs_preparation", "context_selected_metadata"].includes(readiness.status)) {
    setResult(els.dashboardSummary, `
      <article class="starter-today-state">
        <p class="eyebrow">Today</p>
        <h3>${escapeHtml(readiness.status === "context_selected_metadata" ? "Selected Classroom work is ready to check." : "Your academic context is ready to prepare.")}</h3>
        <p>${escapeHtml(readiness.status === "context_selected_metadata" ? "StudentOS will check only the work you selected, then prepare your context and plan the rest of today." : "StudentOS can organize your courses, PDFs, exam dates, and assignments before planning your day.")}</p>
        ${contextPreparationSummaryMarkup(readiness)}
        ${todayTodoMessage ? `<p class="starter-today-message">${escapeHtml(todayTodoMessage)}</p>` : ""}
        <div class="starter-today-actions">
          <button class="primary-button" type="button" data-today-action="prepare-context">Prepare Academic Context</button>
          <button class="text-button" type="button" data-today-action="academic-context">Review Academic Context</button>
        </div>
      </article>
    `);
    return;
  }

  if (readiness.status === "context_needs_manual_upload") {
    setResult(els.dashboardSummary, `
      <article class="starter-today-state">
        <p class="eyebrow">Today</p>
        <h3>Some selected Classroom work needs a manual upload.</h3>
        <p>Add the related file, syllabus, exam date, assignment, or material so StudentOS can generate a useful plan.</p>
        ${contextPreparationSummaryMarkup(readiness)}
        <div class="starter-today-actions"><button class="primary-button" type="button" data-today-action="academic-context">Go to Academic Context</button></div>
      </article>
    `);
    return;
  }

  if (readiness.status === "context_failed") {
    setResult(els.dashboardSummary, `
      <article class="starter-today-state">
        <p class="eyebrow">Today</p>
        <h3>StudentOS could not prepare everything.</h3>
        <p>Review Academic Context and try again.</p>
        <div class="starter-today-actions">
          <button class="primary-button" type="button" data-today-action="academic-context">Review Academic Context</button>
          <button class="text-button" type="button" data-today-action="prepare-context">Try again</button>
        </div>
      </article>
    `);
    return;
  }

  if (!currentPlan) {
    setResult(els.dashboardSummary, `
      <article class="starter-today-state">
        <p class="eyebrow">Today</p>
        <h3>Your academic context is ready.</h3>
        <p>Generate a focused TO-DO list for the rest of today.</p>
        ${contextPreparationSummaryMarkup(readiness)}
        ${todayTodoMessage ? `<p class="starter-today-message">${escapeHtml(todayTodoMessage)}</p>` : ""}
        <div class="starter-today-actions"><button class="primary-button" type="button" data-today-action="generate-todo">Generate today’s TO-DO list</button></div>
      </article>
    `);
    return;
  }

  setResult(els.dashboardSummary, `
    <article class="starter-today-state starter-today-plan">
      <div class="starter-today-plan-header">
        <div>
          <p class="eyebrow">Today</p>
          <h3>Today’s focused plan</h3>
          <p>${escapeHtml(currentPlan.summary || "A focused plan for the rest of today.")}</p>
        </div>
        <span>Generated ${escapeHtml(formatTime(currentPlan.generated_at))}</span>
      </div>
      <ol class="today-todo-list">${(currentPlan.items || []).map(todayTodoItemMarkup).join("")}</ol>
      <div class="starter-today-actions"><button class="secondary-button" type="button" data-today-action="generate-todo">Regenerate</button></div>
    </article>
  `);
}

function currentStudyPlan() {
  const plan = state?.todayPlan?.date === localDateOnly() ? state.todayPlan : null;
  if (!plan?.items) return plan;
  plan.items = plan.items.map((item, index) => ({
    ...item,
    id: item.id || `todo_${plan.date}_${index + 1}_${String(item.title || "study-item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42)}`,
    study_status: ["not_started", "studying", "done"].includes(item.study_status) ? item.study_status : "not_started",
  }));
  return plan;
}

function studyStatusLabel(status) {
  return status === "done" ? "Done" : status === "studying" ? "Studying" : "Not started";
}

function studyCourseForItem(item) {
  const related = String(item?.related_course || "").trim().toLowerCase();
  if (!related) return null;
  return (state.courses || []).find((course) => [course.title, course.name, course.code]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase() === related || String(value).toLowerCase().includes(related) || related.includes(String(value).toLowerCase()))) || null;
}

function normalizeAcademicContextKind(item = {}) {
  const payload = item?.payload && typeof item.payload === "object" ? item.payload : {};
  const aliases = {
    syllabus: "syllabus",
    course_outline: "syllabus",
    material: "study_material",
    study_material: "study_material",
    study_materials: "study_material",
    classroom_selected_material: "study_material",
    google_classroom_selected_material: "study_material",
    notes: "study_material",
    handout: "study_material",
    reading: "study_material",
    assignment: "assignment",
    coursework: "assignment",
    exam_schedule: "exam_schedule",
    exam_dates: "exam_schedule",
    generated_study_material: "generated_study_material",
    studentos_generated: "generated_study_material",
    unknown: "unknown",
  };
  const recognized = (value) => aliases[String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")] || null;
  const explicitValues = [
    item.contextKind, payload.contextKind, item.materialKind, payload.materialKind,
    item.artifactKind, payload.artifactKind, item.includedAs, payload.includedAs,
    item.kind, payload.kind, item.sourceType, payload.sourceType, item.source, item.origin,
  ];
  if (explicitValues.some((value) => recognized(value) === "generated_study_material")) return "generated_study_material";
  for (const value of explicitValues) {
    const kind = recognized(value);
    if (kind) return kind;
  }
  const title = String(item.title || item.filename || payload.title || payload.filename || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (/syllabus|course_outline/.test(title)) return "syllabus";
  if (/exam_(?:schedule|dates?)|exam_timetable/.test(title)) return "exam_schedule";
  if (/assignment|coursework/.test(title)) return "assignment";
  if (/(?:^|_)notes?(?:_|$)|handout|reading|study_material/.test(title)) return "study_material";
  return "unknown";
}

function isReadableStudyMaterial(item) {
  return ["study_material", "generated_study_material"].includes(normalizeAcademicContextKind(item));
}

function studyMasteryQueue(item) {
  return item?.topic_mastery_queue?.topics?.length ? item.topic_mastery_queue : null;
}

function activeStudyMasteryTopic(item) {
  const queue = studyMasteryQueue(item);
  return queue?.topics.find((topic) => topic.id === queue.activeTopicId) || queue?.topics.find((topic) => topic.status !== "done") || queue?.topics[0] || null;
}

function currentStudyMasteryTarget(item) {
  const topic = activeStudyMasteryTopic(item);
  if (!topic || topic.status === "done") return { topic, subpart: null, materialId: topic?.generatedMaterialId || topic?.subparts?.at(-1)?.generatedMaterialId || null };
  const subpart = topic.subparts?.find((part) => part.status !== "done") || null;
  return { topic, subpart, materialId: subpart?.generatedMaterialId || topic.generatedMaterialId || null };
}

function relatedStudyMaterial(item) {
  if (!item) return null;
  const target = currentStudyMasteryTarget(item);
  if (target?.materialId) {
    const exact = (state.sourceMaterials || []).find((source) => source.id === target.materialId && !source.deletedAt && isReadableStudyMaterial(source));
    if (exact) return exact;
  }
  if (studyMasteryQueue(item)) return null;
  if (item.generated_material_id) {
    const generated = (state.sourceMaterials || []).find((source) => source.id === item.generated_material_id && !source.deletedAt && isReadableStudyMaterial(source));
    if (generated) return generated;
  }
  const linked = (state.sourceMaterials || []).find((source) => source.todoItemId === item.id && !source.deletedAt && isReadableStudyMaterial(source));
  if (linked) return linked;
  const course = studyCourseForItem(item);
  const terms = [item.title, item.related_context]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4);
  return (state.sourceMaterials || [])
    .filter((source) => !source.deletedAt && isIncludedAcademicContextItem(source) && isReadableStudyMaterial(source))
    .map((source) => {
      const text = `${source.title || ""} ${source.extractionSummary || ""}`.toLowerCase();
      const courseMatch = course?.id && source.courseId === course.id ? 20 : 0;
      const termMatch = terms.reduce((score, term) => score + (text.includes(term) ? 2 : 0), 0);
      return { source, score: courseMatch + termMatch };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.source || null;
}

function generatedStudyTextMarkup(content) {
  const lines = String(content || "").split(/\r?\n/);
  const output = [];
  let listType = null;
  const closeList = () => { if (listType) output.push(`</${listType}>`); listType = null; };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { closeList(); continue; }
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) { closeList(); output.push(`<h5>${escapeHtml(heading[1])}</h5>`); continue; }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      const desired = bullet ? "ul" : "ol";
      if (listType !== desired) { closeList(); listType = desired; output.push(`<${desired}>`); }
      output.push(`<li>${escapeHtml((bullet || numbered)[1])}</li>`);
      continue;
    }
    closeList();
    output.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList();
  return output.join("");
}

function studyMaterialMarkup(material) {
  if (material?.generatedContent) {
    return `
      <article class="study-generated-material">
        <div class="study-material-heading">
          <div><p class="eyebrow">Generated by StudentOS</p><h4>${escapeHtml(material.title)}</h4></div>
          ${tag("Saved to Academic Context", "source")}
        </div>
        <div class="study-generated-copy">${generatedStudyTextMarkup(material.generatedContent)}</div>
      </article>
    `;
  }
  const url = material?.linkUrl || material?.alternateLink;
  return `
    <article class="study-existing-material">
      <div>
        <p class="eyebrow">Related material</p>
        <h4>${escapeHtml(material.title || "Study material")}</h4>
        ${material.extractedSnippet ? `<p>${escapeHtml(material.extractedSnippet)}</p>` : `<p>This material is ready in Academic Context.</p>`}
      </div>
      ${material.isPrivate
        ? `<button class="primary-button" type="button" data-open-academic-pdf="${escapeHtml(material.id)}" data-pdf-title="${escapeHtml(material.title || "Study material")}">Open material</button>`
        : url
          ? `<a class="primary-button" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open material</a>`
          : ""}
    </article>
  `;
}

function studyMaterialEmptyCopy(item) {
  const course = studyCourseForItem(item);
  const matchesCourse = (record) => !course?.id || !record.courseId || record.courseId === course.id;
  const sources = (state.sourceMaterials || []).filter((source) => !source.deletedAt && isIncludedAcademicContextItem(source) && matchesCourse(source));
  const hasSyllabus = sources.some((source) => normalizeAcademicContextKind(source) === "syllabus");
  const hasExamSchedule = sources.some((source) => normalizeAcademicContextKind(source) === "exam_schedule") ||
    (state.exams || []).some((exam) => !exam.archived && matchesCourse(exam));
  if (hasSyllabus && hasExamSchedule) {
    return "StudentOS has your syllabus and exam date, but not a study handout or notes for this topic.";
  }
  if (hasSyllabus) return "StudentOS has your syllabus, but not a study handout or notes for this topic.";
  if (hasExamSchedule) return "StudentOS has your exam date, but not a study handout or notes for this topic.";
  return "Add a study handout or notes, or create a concise lesson for this task.";
}

function currentStudyTestSession(item) {
  if (!item) return null;
  const topic = activeStudyMasteryTopic(item);
  return (state.testSessions || []).find((session) => session.todoItemId === item.id && (!topic?.id || !session.parentTopicId || session.parentTopicId === topic.id)) || null;
}

function masteryStatusLabel(status) {
  return status === "done" ? "Done" : status === "studying" ? "Studying" : "Pending";
}

function topicMasteryChecklistMarkup(item) {
  const queue = studyMasteryQueue(item);
  if (!queue) return "";
  return `
    <section class="topic-mastery" aria-labelledby="topic-mastery-title">
      <header><div><p class="eyebrow">Topic mastery</p><h4 id="topic-mastery-title">${escapeHtml([queue.courseTitle, queue.examName].filter(Boolean).join(" — "))}</h4></div></header>
      ${queue.guidance ? `<p class="topic-mastery-guidance">${escapeHtml(queue.guidance)}</p>` : ""}
      <ol class="topic-mastery-list">${queue.topics.map((topic) => {
        const current = topic.id === queue.activeTopicId;
        return `<li class="topic-mastery-topic ${escapeHtml(topic.status)}${current ? " current" : ""}">
          <div><span class="topic-status-mark" aria-hidden="true"></span><strong>${escapeHtml(topic.title)}</strong><small>${escapeHtml(masteryStatusLabel(topic.status))}</small></div>
          ${topic.module ? `<p>${escapeHtml(topic.module)}</p>` : ""}
          ${topic.subparts?.length ? `<ol>${topic.subparts.map((part) => `<li class="${escapeHtml(part.status)}"><span class="topic-status-mark" aria-hidden="true"></span><span>Part ${part.index}: ${escapeHtml(part.title)}</span><small>${escapeHtml(masteryStatusLabel(part.status))}</small></li>`).join("")}</ol>` : ""}
        </li>`;
      }).join("")}</ol>
    </section>
  `;
}

function studyTestStatusLabel(status) {
  return {
    ready_to_start: "Ready to start",
    in_progress: "In progress",
    time_expired: "Time expired",
    submitted_pending_evaluation: "Submitted for evaluation",
    ready_for_evaluation: "Ready for evaluation",
    evaluated: "Evaluated",
  }[status] || humanize(status || "not generated");
}

function studyTestTimeLeft(deadlineAt) {
  return Math.max(0, new Date(deadlineAt || 0).getTime() - Date.now());
}

function studyTestTimerText(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function studyTestSummaryMarkup(paper) {
  return `
    <dl class="study-test-summary">
      <div><dt>Estimated time</dt><dd>${escapeHtml(`${paper.estimated_minutes} minutes`)}</dd></div>
      <div><dt>Total marks</dt><dd>${escapeHtml(paper.total_marks)}</dd></div>
      <div><dt>Questions</dt><dd>${paper.questions.length}</dd></div>
      <div><dt>Topic / course</dt><dd>${escapeHtml(`${paper.topic} / ${paper.course}`)}</dd></div>
    </dl>
  `;
}

function studyTestWarningMarkup(session) {
  const paper = session.testPaper;
  return `
    <section class="study-test-warning" aria-labelledby="study-test-warning-title">
      <p class="eyebrow">Before you start</p>
      <h4 id="study-test-warning-title">This test cannot be paused. Start only when you can complete it in one sitting.</h4>
      ${studyTestSummaryMarkup(paper)}
      <fieldset class="study-answer-mode">
        <legend>How will you answer?</legend>
        <label><input type="radio" name="study-answer-mode" value="typed"> <span><strong>Type answers in StudentOS</strong><small>Your answers will be saved as you work.</small></span></label>
        <label><input type="radio" name="study-answer-mode" value="handwritten"> <span><strong>Upload handwritten answer sheet later</strong><small>Write on paper while the test remains open here.</small></span></label>
      </fieldset>
      <p class="study-test-stays-here">The question paper stays inside StudentOS.</p>
      <button class="primary-button" type="button" data-study-test-start="${escapeHtml(session.id)}">Start test</button>
    </section>
  `;
}

function studyTestQuestionMarkup(question, session) {
  const answer = session.answers?.[String(question.question_number)] || "";
  const choices = question.choices?.length
    ? `<ol class="study-test-choices" type="A">${question.choices.map((choice) => `<li>${escapeHtml(choice)}</li>`).join("")}</ol>`
    : "";
  const answerArea = session.answerMode === "typed"
    ? `<label class="study-test-answer"><span>Your answer</span><textarea data-study-test-answer="${question.question_number}" rows="${question.type === "long_answer" ? 7 : 4}">${escapeHtml(answer)}</textarea></label>`
    : "";
  return `
    <article class="study-test-question">
      <header><span>Question ${question.question_number}</span><span>${escapeHtml(humanize(question.type))} · ${question.marks} mark${question.marks === 1 ? "" : "s"}</span></header>
      <p>${escapeHtml(question.prompt)}</p>
      ${choices}
      ${answerArea}
    </article>
  `;
}

function studyTestAttemptMarkup(session) {
  const paper = session.testPaper;
  return `
    <section class="study-test-attempt" data-study-test-session="${escapeHtml(session.id)}">
      <header class="study-test-attempt-header">
        <div><p class="eyebrow">Strict test</p><h4>${escapeHtml(paper.test_title)}</h4><p>${escapeHtml(`${paper.topic} · ${paper.course}`)}</p></div>
        <div class="study-test-timer" aria-live="polite"><small>Time remaining</small><strong data-study-test-timer>${studyTestTimerText(studyTestTimeLeft(session.deadlineAt))}</strong></div>
      </header>
      <div class="study-test-instructions"><strong>Instructions</strong><ul>${paper.instructions.map((instruction) => `<li>${escapeHtml(instruction)}</li>`).join("")}</ul></div>
      ${session.answerMode === "handwritten" ? `<p class="study-handwritten-guidance">After you finish on paper, you will upload your answer sheet for evaluation.</p>` : `<p class="study-test-save-state" data-study-test-save-state>${session.lastSavedAt ? "Answers saved." : "Answers save as you work."}</p>`}
      <div class="study-test-questions">${paper.questions.map((question) => studyTestQuestionMarkup(question, session)).join("")}</div>
      <div class="study-test-finish">
        <p>${session.answerMode === "handwritten" ? "Finish when your paper answers are complete." : "Submit when you have finished every answer."}</p>
        <button class="primary-button" type="button" data-study-test-finish="${escapeHtml(session.id)}">${session.answerMode === "handwritten" ? "I’ve finished" : "Submit for evaluation"}</button>
      </div>
    </section>
  `;
}

function studyTestClosedMarkup(session) {
  if (session.status === "evaluated" && session.evaluation) return studyTestResultMarkup(session);
  const expired = session.status === "time_expired";
  const handwritten = session.answerMode === "handwritten";
  const title = expired ? "Time is up. This attempt is locked." : studyTestStatusLabel(session.status);
  const copy = expired
    ? (handwritten ? "Your question paper is locked. Your handwritten work can be added during evaluation." : "Your saved answers are locked and ready for the evaluation step.")
    : handwritten
      ? "Your handwritten answer sheet can be added during the evaluation step."
      : "Your answers are saved. Scoring will be completed in the evaluation step.";
  return `
    <section class="study-test-closed">
      <p class="eyebrow">${escapeHtml(studyTestStatusLabel(session.status))}</p>
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(copy)}</p>
      ${studyTestSummaryMarkup(session.testPaper)}
      <div class="study-evaluation-submit">
        ${handwritten ? `
          <label class="study-answer-sheet-field">
            <span>Handwritten answer sheet</span>
            <input type="file" data-study-answer-sheet accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
            <small>${session.answerSheetDraft?.filename ? `Saved for retry: ${escapeHtml(session.answerSheetDraft.filename)}` : "Upload your handwritten answer sheet as PDF or DOCX."}</small>
          </label>
        ` : `<p>Your saved typed answers will be evaluated against this test.</p>`}
        <button class="primary-button" type="button" data-study-test-evaluate="${escapeHtml(session.id)}">${session.answerSheetDraft?.filename ? "Retry evaluation" : "Evaluate my test"}</button>
      </div>
    </section>
  `;
}

function studyTestResultMarkup(session) {
  const result = session.evaluation;
  const strengths = result.strengths?.length ? result.strengths : ["You completed the test and now have a clear revision path."];
  const weakTopics = result.weak_topics?.length ? result.weak_topics : ["No specific weak topic was identified."];
  return `
    <section class="study-test-result" aria-labelledby="study-test-result-title">
      <header class="study-result-header">
        <div><p class="eyebrow">Your result</p><h4 id="study-test-result-title">${escapeHtml(`${result.scored_marks} / ${result.total_marks}`)}</h4><p>${escapeHtml(`${result.percentage}%`)}</p></div>
        <div class="study-result-score" aria-label="Score ${escapeHtml(result.percentage)} percent"><strong>${escapeHtml(result.percentage)}%</strong><span>${escapeHtml(session.testPaper.topic)}</span></div>
      </header>
      <div class="study-result-overview">
        <section><h5>What went well</h5><ul>${strengths.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul></section>
        <section><h5>What to revise</h5><ul>${weakTopics.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul></section>
      </div>
      <section class="study-result-questions">
        <div class="study-result-section-heading"><p class="eyebrow">Corrections</p><h5>Question-by-question feedback</h5></div>
        ${result.question_results.map((question) => `
          <article class="study-result-question">
            <header><strong>Question ${escapeHtml(question.question_number)}</strong><span>${escapeHtml(`${question.marks_awarded} / ${question.max_marks} marks`)}</span></header>
            <p><strong>Feedback</strong>${escapeHtml(question.feedback)}</p>
            <p><strong>Correction</strong>${escapeHtml(question.correction)}</p>
          </article>
        `).join("")}
      </section>
      <section class="study-result-next">
        <div><h5>Next steps</h5><ul>${result.next_steps.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul></div>
        <div><h5>Short revision plan</h5><p>${escapeHtml(result.short_revision_plan)}</p></div>
      </section>
      <div class="study-result-actions" aria-label="Result actions">
        <button class="secondary-button" type="button" data-study-review-corrections>Review corrections</button>
        <button class="secondary-button" type="button" data-study-go-today>Back to Today</button>
        <button class="primary-button" type="button" data-study-continue>Continue Study and Evaluate</button>
      </div>
    </section>
  `;
}

function studyTestMarkup(session) {
  if (session.status === "ready_to_start") return studyTestWarningMarkup(session);
  if (session.status === "in_progress") return studyTestAttemptMarkup(session);
  return studyTestClosedMarkup(session);
}

function startStudyTestCountdown(session) {
  if (studyTestCountdown) window.clearInterval(studyTestCountdown);
  studyTestCountdown = null;
  if (session?.status !== "in_progress" || !session.deadlineAt) return;
  const tick = () => {
    const remaining = studyTestTimeLeft(session.deadlineAt);
    const timer = els.studyEvaluateContent?.querySelector("[data-study-test-timer]");
    if (timer) timer.textContent = studyTestTimerText(remaining);
    if (remaining <= 0) {
      window.clearInterval(studyTestCountdown);
      studyTestCountdown = null;
      refreshStudyTestSession(session.id);
    }
  };
  tick();
  studyTestCountdown = window.setInterval(tick, 1000);
}

function studyQueueItemMarkup(item) {
  const selected = item.id === selectedStudyItemId;
  return `
    <button class="study-queue-item${selected ? " active" : ""}" type="button" data-study-item-id="${escapeHtml(item.id)}" aria-pressed="${selected ? "true" : "false"}">
      <span class="study-queue-main">
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.related_course || "Course not specified")}</small>
        <span>${escapeHtml(item.reason)}</span>
      </span>
      <span class="study-queue-meta">
        ${tag(humanize(item.priority || "medium"), item.priority === "high" ? "urgent" : item.priority || "medium")}
        <small>${escapeHtml(item.time_hint || "Time not set")}</small>
        <em data-study-status>${escapeHtml(studyStatusLabel(item.study_status))}</em>
      </span>
    </button>
  `;
}

function renderStudyAndEvaluate() {
  if (!els.studyEvaluateContent) return;
  const plan = currentStudyPlan();
  if (!plan?.items?.length) {
    selectedStudyItemId = null;
    els.studyEvaluateContent.innerHTML = `
      <section class="study-empty-state">
        <h4>Generate today’s TO-DO list first.</h4>
        <p>Your study queue will use the real items in today’s plan.</p>
        <button class="primary-button" type="button" data-study-go-today>Go to Today</button>
      </section>
    `;
    return;
  }
  if (!selectedStudyItemId) {
    const activeSession = (state.testSessions || []).find((session) => session.status === "in_progress");
    if (activeSession && plan.items.some((item) => item.id === activeSession.todoItemId)) selectedStudyItemId = activeSession.todoItemId;
  }
  if (selectedStudyItemId && !plan.items.some((item) => item.id === selectedStudyItemId)) selectedStudyItemId = null;
  const selected = plan.items.find((item) => item.id === selectedStudyItemId) || null;
  const masteryTarget = currentStudyMasteryTarget(selected);
  const activeTopic = masteryTarget?.topic || null;
  const material = relatedStudyMaterial(selected);
  const testSession = currentStudyTestSession(selected);
  const status = selected ? studyStatusLabel(selected.study_status) : "";
  els.studyEvaluateContent.innerHTML = `
    <aside class="study-queue" aria-labelledby="study-queue-title">
      <div class="study-section-heading">
        <div><p class="eyebrow">Today</p><h4 id="study-queue-title">Today’s study queue</h4></div>
        <span>${plan.items.length} item${plan.items.length === 1 ? "" : "s"}</span>
      </div>
      <div class="study-queue-list">${plan.items.map(studyQueueItemMarkup).join("")}</div>
    </aside>
    <section class="study-workspace" aria-label="Selected task workspace">
      ${selected ? `
        <header class="study-workspace-header">
          <div>
            <p class="eyebrow">Selected task</p>
            <h4>${escapeHtml(selected.title)}</h4>
            <p>${escapeHtml(selected.reason)}</p>
          </div>
          ${tag(status, selected.study_status === "done" ? "source" : selected.study_status === "studying" ? "medium" : "low")}
        </header>
        ${topicMasteryChecklistMarkup(selected)}
        ${testSession ? studyTestMarkup(testSession) : `
          <dl class="study-task-details">
            <div><dt>Course</dt><dd>${escapeHtml(selected.related_course || "Not specified")}</dd></div>
            <div><dt>Related context</dt><dd>${escapeHtml(selected.related_context || "No additional context")}</dd></div>
            <div><dt>Suggested time</dt><dd>${escapeHtml(selected.time_hint || "Not specified")}</dd></div>
            <div><dt>Study status</dt><dd>${escapeHtml(status)}</dd></div>
          </dl>
          <div class="study-material-area">
            ${material ? studyMaterialMarkup(material) : `
              <div class="study-material-empty">
                <h4>${escapeHtml(masteryTarget?.subpart?.title || activeTopic?.title || "No study note is available yet.")}</h4>
                <p>${activeTopic ? "Create the next note in the exact syllabus order." : escapeHtml(studyMaterialEmptyCopy(selected))}</p>
                <button class="primary-button" type="button" data-study-generate-material ${studyMaterialGenerating || activeTopic?.status === "done" ? "disabled" : ""}>${studyMaterialGenerating ? "Creating note..." : activeTopic?.subparts?.some((part) => part.status === "done") ? "Generate next note" : "Generate note"}</button>
              </div>
            `}
          </div>
          <div class="study-completion-area">
            ${activeTopic?.status === "done" ? `
              <div><strong>Topic notes complete.</strong><p>The test covers the full syllabus topic, not one subpart.</p></div>
              <button class="secondary-button" type="button" data-study-generate-test ${studyTestGenerating ? "disabled" : ""}>${studyTestGenerating ? "Generating test..." : "Generate test"}</button>
            ` : material ? `
              <div><strong>Finished this note?</strong><p>Mark it done to continue in syllabus order.</p></div>
              <button class="primary-button" type="button" data-study-mark-done>Mark note done</button>
            ` : `
              <div><strong>Generate one note at a time.</strong><p>The next action appears after you read and complete the current note.</p></div>
            `}
          </div>
        `}
        ${studyWorkspaceMessage ? `<p class="study-workspace-message" role="status">${escapeHtml(studyWorkspaceMessage)}</p>` : ""}
      ` : `
        <div class="study-choose-state">
          <p class="eyebrow">Study workspace</p>
          <h4>Choose what you want to study now.</h4>
          <p>Select an item from today’s queue to open its material and study details.</p>
        </div>
      `}
    </section>
  `;
  startStudyTestCountdown(testSession);
}

function renderDashboardSummary() {
  if (usesAcademicTodayFlow()) {
    renderStarterToday();
    return;
  }
  if (els.todayDashboardPanels) els.todayDashboardPanels.hidden = false;
  document.getElementById("view-today")?.classList.remove("starter-today-flow");
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
      <div class="inline-actions">
        ${stateName === "connected" ? `<button class="mini-action" type="button" data-course-refresh>Refresh course list</button>` : ""}
        ${["disconnected", "reconnect_required"].includes(stateName) ? `<button class="mini-action" type="button" data-course-connect>${stateName === "reconnect_required" ? "Reconnect Classroom" : "Connect Classroom"}</button>` : ""}
      </div>
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
  if (item.source === "studentos_generated" || item.origin === "studentos_generated") return "Generated by StudentOS";
  return item.source === "google_classroom" || item.provider === "google_classroom" ? "Classroom" : "Manual upload";
}

function academicContextPreview(isPdf = true) {
  const type = isPdf ? "PDF" : "DOC";
  return `<div class="academic-context-preview" role="img" aria-label="${type} document preview placeholder"><span>${type}</span><small>Document</small></div>`;
}

function academicContextTextPreview() {
  return `<div class="academic-context-preview academic-context-text-preview" role="img" aria-label="Generated text material"><span>TEXT</span><small>Study guide</small></div>`;
}

function academicContextOpenAction(source, title, url = null) {
  if (source?.isPrivate) {
    return `<button class="mini-action" type="button" data-open-academic-pdf="${escapeHtml(source.id)}" data-pdf-title="${escapeHtml(title)}" aria-label="Open ${escapeHtml(title)}">Open</button>`;
  }
  return url ? `<a class="mini-action" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(title)}">Open</a>` : "";
}

function academicContextKindLabel(source) {
  return {
    syllabus: "Syllabus",
    study_material: "Study material",
    assignment: "Assignment",
    exam_schedule: "Exam schedule",
    generated_study_material: "Generated study material",
    unknown: "Academic document",
  }[normalizeAcademicContextKind(source)] || "Academic document";
}

function academicContextMaterialStatus(source) {
  const status = String(source.status || source.extractionStatus || "").toLowerCase();
  if (source.extractionError || ["failed", "needs_ocr", "needs_attention"].includes(status)) return "Needs attention";
  if (source.readyForStudy || ["indexed", "ready", "completed"].includes(status)) {
    return isReadableStudyMaterial(source) ? "Ready for study" : "Ready for planning";
  }
  return "Preparing";
}

function isIncludedAcademicContextItem(item) {
  return item?.academicContextIncluded === true || ["selected", "imported"].includes(String(item?.selectionState || "").toLowerCase());
}

function renderAcademicContextPreparationStatus() {
  const readiness = academicContextReadiness();
  if (els.academicContextPreparationStatus) {
    const detail = readiness.status === "context_ready" && readiness.preparedAt
      ? `Prepared ${formatDate(readiness.preparedAt)}`
      : readiness.message;
    els.academicContextPreparationStatus.innerHTML = `
      <span class="status-dot" aria-hidden="true"></span>
      <div>
        <p><strong>${escapeHtml(readiness.message)}</strong>${detail !== readiness.message ? `<small>${escapeHtml(detail)}</small>` : ""}</p>
        ${contextPreparationSummaryMarkup(readiness)}
        ${readiness.manualUploadGuidance ? `<small>${escapeHtml(readiness.manualUploadGuidance)}</small>` : ""}
      </div>
    `;
    els.academicContextPreparationStatus.dataset.status = readiness.status;
  }
  if (els.academicContextPrepareButton) {
    els.academicContextPrepareButton.disabled = ["context_preparing", "context_classroom_backfill"].includes(readiness.status) || !readiness.canPrepare;
    els.academicContextPrepareButton.textContent = readiness.status === "context_preparing"
      ? "Preparing..."
      : readiness.status === "context_classroom_backfill"
        ? "Checking selected work..."
      : readiness.status === "context_ready"
        ? "Prepare again"
        : readiness.status === "context_failed"
          ? "Try preparing again"
          : "Prepare Academic Context";
  }
}

function renderExamSchedule() {
  if (!els.examList) return;
  const exams = [...(state.exams || [])]
    .filter((exam) => !exam.archived)
    .sort((left, right) => timestampFor(left.examDate) - timestampFor(right.examDate));
  els.examList.innerHTML = exams.length ? exams.map((exam) => {
    const course = courseById(exam.courseId);
    const editable = !exam.source || exam.source === "manual";
    const detail = [formatDate(exam.examDate), exam.examTime || "", exam.marksWeightage || exam.weight || ""].filter(Boolean).join(" / ");
    return `
      <article class="exam-entry-card">
        <div>
          <strong>${escapeHtml(exam.title)}</strong>
          <p>${escapeHtml(course?.title || "Course")}</p>
          <small>${escapeHtml(detail)}</small>
          ${exam.notes ? `<p>${escapeHtml(exam.notes)}</p>` : ""}
        </div>
        ${editable ? `<div class="inline-actions">
          <button class="mini-action" type="button" data-edit-exam-id="${escapeHtml(exam.id)}">Edit</button>
          <button class="mini-action danger-action" type="button" data-delete-exam-id="${escapeHtml(exam.id)}">Delete</button>
        </div>` : ""}
      </article>
    `;
  }).join("") : `<p class="muted-copy">No exam dates added yet.</p>`;
}

function renderSources() {
  const assignments = [...(state.assignments || [])]
    .filter((assignment) => !assignment.archived && isIncludedAcademicContextItem(assignment))
    .sort(sortStudentWork);
  const allMaterials = (state.sourceMaterials || [])
    .filter((source) => !source.deletedAt && normalizeAcademicContextKind(source) !== "assignment" && isIncludedAcademicContextItem(source))
    .sort((left, right) => classroomFreshnessTimestamp(right) - classroomFreshnessTimestamp(left));
  const syllabi = allMaterials.filter((source) => normalizeAcademicContextKind(source) === "syllabus");
  const examSchedules = allMaterials.filter((source) => normalizeAcademicContextKind(source) === "exam_schedule");
  const materials = allMaterials.filter((source) => ["study_material", "generated_study_material"].includes(normalizeAcademicContextKind(source)));
  const courseOnly = starterCourseOnlyClassroom();
  const reviewEnabled = currentClassroomPolicy().courseworkReviewEnabled === true;
  const classroomReviewItems = reviewEnabled
    ? (state.classroomItems || [])
      .filter((item) => item.selectionState === "discovered" && !item.academicContextIncluded)
      .sort((left, right) => classroomFreshnessTimestamp(right) - classroomFreshnessTimestamp(left))
      .slice(0, 12)
    : [];
  if (els.academicContextSummary) {
    els.academicContextSummary.innerHTML = `
      <article data-summary-kind="courses"><span>Courses</span><strong>${(state.courses || []).length}</strong></article>
      <article data-summary-kind="exams"><span>Exam dates</span><strong>${(state.exams || []).length}</strong></article>
      <article data-summary-kind="assignments"><span>Assignments</span><strong>${assignments.length}</strong></article>
      <article data-summary-kind="materials"><span>PDFs</span><strong>${allMaterials.length}</strong></article>
    `;
  }
  renderAcademicContextPreparationStatus();
  renderExamSchedule();
  if (els.academicContextClassroomGuidance) {
    els.academicContextClassroomGuidance.innerHTML = courseOnly
      ? `<p><strong>Starter and Classroom</strong><span>Starter uses Classroom only to help set up your course list. Upload PDFs manually to add assignments or materials.</span></p>`
      : reviewEnabled && classroomReviewItems.length
        ? `<p><strong>Classroom review</strong><span>${classroomReviewItems.length} new item${classroomReviewItems.length === 1 ? " is" : "s are"} waiting for you to choose what to add.</span></p>`
        : reviewEnabled
          ? `<p><strong>Classroom review</strong><span>No new Classroom work to review.</span></p>`
          : "";
  }

  const assignmentCards = assignments.map((assignment) => {
    const course = courseById(assignment.courseId);
    const source = (state.sourceMaterials || []).find((item) => item.id === assignment.sourceMaterialId || (assignment.sourceMaterialIds || []).includes(item.id));
    const status = academicContextAssignmentStatus(assignment);
    const origin = academicContextOrigin(assignment);
    const dueDate = assignment.dueAt || assignment.dueDate;
    const prompt = `Help me study for ${assignment.title} in ${course?.title || assignment.courseTitle || "this course"}.`;
    return `
      <article class="source-card academic-context-card academic-context-assignment-card" data-academic-context-status="${escapeHtml(status.toLowerCase().replaceAll(" ", "-"))}">
        ${academicContextPreview(origin === "Manual upload")}
        <div class="academic-context-card-body">
          <div class="academic-context-card-copy">
            <h4>${escapeHtml(assignment.title)}</h4>
            <p>${escapeHtml(course?.title || assignment.courseTitle || "Course")}</p>
          </div>
          <div class="academic-context-card-meta">
            <span><small>Due</small><strong>${escapeHtml(formatDate(dueDate))}</strong></span>
            <span><small>Origin</small><strong>${escapeHtml(origin)}</strong></span>
          </div>
          <div class="tag-row">${tag(status, status === "Overdue" ? "urgent" : status === "Due soon" ? "medium" : "source")}</div>
          <div class="source-action-row">
            ${academicContextOpenAction(source, assignment.title, assignment.alternateLink || source?.linkUrl)}
            <button class="mini-action ai-context-button" type="button" data-ai-open data-ai-verb="Ask" data-ai-prompt="${escapeHtml(prompt)}" aria-label="Ask StudentOS about ${escapeHtml(assignment.title)}">Ask StudentOS</button>
            <button class="mini-action danger-action" type="button" data-delete-context-kind="assignment" data-delete-context-id="${escapeHtml(assignment.id)}" aria-label="Delete ${escapeHtml(assignment.title)}">Delete</button>
          </div>
        </div>
      </article>
    `;
  }).join("") || `<article class="source-card source-empty-card"><strong>No assignments added yet.</strong><p>Upload an assignment PDF with a deadline so StudentOS can plan it.</p></article>`;

  const materialCardMarkup = (sources, emptyTitle, emptyCopy) => sources.map((source) => {
    const course = courseById(source.courseId);
    const origin = academicContextOrigin(source);
    const generated = origin === "Generated by StudentOS";
    const prompt = buildSourceAiPrompt(source, course);
    const readiness = academicContextMaterialStatus(source);
    return `
      <article class="source-card academic-context-card academic-context-material-card" data-academic-context-status="${escapeHtml(readiness.toLowerCase().replaceAll(" ", "-"))}">
        ${generated ? academicContextTextPreview() : academicContextPreview(origin === "Manual upload")}
        <div class="academic-context-card-body">
          <div class="academic-context-card-copy">
            <h4>${escapeHtml(source.title)}</h4>
            <p>${escapeHtml(course?.title || "Course")}</p>
          </div>
          <div class="academic-context-card-meta academic-context-material-meta">
            <span><small>Origin</small><strong>${escapeHtml(origin)}</strong></span>
            <span><small>Included as</small><strong>${escapeHtml(academicContextKindLabel(source))}</strong></span>
          </div>
          <div class="tag-row">${tag(readiness, readiness === "Needs attention" ? "urgent" : readiness === "Preparing" ? "medium" : "source")}${generated ? tag("Generated by StudentOS", "source") : ""}</div>
          <div class="source-action-row">
            ${generated
              ? `<button class="mini-action" type="button" data-open-generated-study="${escapeHtml(source.todoItemId || "")}">View material</button>`
              : academicContextOpenAction(source, source.title, source.linkUrl || source.alternateLink)}
            <button class="mini-action ai-context-button" type="button" data-ai-open data-ai-verb="Ask" data-ai-prompt="${escapeHtml(prompt)}" aria-label="Ask StudentOS about ${escapeHtml(source.title)}">Ask StudentOS</button>
            <button class="mini-action danger-action" type="button" data-delete-context-kind="material" data-delete-context-id="${escapeHtml(source.id)}" aria-label="Delete ${escapeHtml(source.title)}">Delete</button>
          </div>
        </div>
      </article>
    `;
  }).join("") || `<article class="source-card source-empty-card"><strong>${escapeHtml(emptyTitle)}</strong><p>${escapeHtml(emptyCopy)}</p></article>`;

  const syllabusCards = materialCardMarkup(syllabi, "No syllabus added yet.", "Upload a course syllabus PDF so StudentOS can plan from the course outline.");
  const materialCards = materialCardMarkup(materials, "No study materials added yet.", "Upload a PDF handout or reading to help StudentOS understand your course.");
  const examScheduleCards = materialCardMarkup(examSchedules, "No exam schedule PDF added.", "Manual exam dates above are enough. Add a PDF only if it helps.");

  const classroomReview = classroomReviewItems.length ? `
    <section class="academic-context-group classroom-review-card" aria-label="Classroom work to review">
      <div class="source-card-head"><div><span class="workspace-label">Choose what to add</span><h3>Classroom work to review</h3><p>New Classroom work found. Choose what to add to your academic context.</p></div></div>
      <div class="academic-context-card-grid">
        ${classroomReviewItems.map((item) => {
          const itemType = item.itemType === "assignment" ? "Assignment" : "Material";
          const handedIn = item.handedIn === true || ["turned_in", "returned", "submitted", "graded"].includes(String(item.submissionState || item.status || "").toLowerCase());
          return `
            <article class="source-card academic-context-card academic-context-review-item compact">
              ${academicContextPreview(false)}
              <div class="academic-context-card-body">
                <div class="academic-context-card-copy">
                  <h4>${escapeHtml(item.title)}</h4>
                  <p>${escapeHtml(item.courseTitle || "Classroom course")}</p>
                </div>
                ${item.dueAt ? `<div class="academic-context-card-meta"><span><small>Due</small><strong>${escapeHtml(formatDate(item.dueAt))}</strong></span></div>` : ""}
                <div class="tag-row">${tag(itemType, "source")}${handedIn ? tag("Already handed in", "source") : ""}</div>
                <div class="source-action-row">
                  <button class="mini-action primary-button" type="button" data-classroom-item-id="${escapeHtml(item.id)}">Add to Academic Context</button>
                  <button class="mini-action" type="button" data-classroom-ignore-id="${escapeHtml(item.id)}">Ignore</button>
                </div>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  ` : "";

  els.sourceList.innerHTML = `
    <section class="academic-context-group" aria-labelledby="academic-context-assignments-title">
      <div class="section-heading"><div><p class="eyebrow">Active academic work</p><h3 id="academic-context-assignments-title">Assignments</h3></div></div>
      <div class="academic-context-card-grid">${assignmentCards}</div>
    </section>
    <section class="academic-context-group" aria-labelledby="academic-context-materials-title">
      <div class="section-heading"><div><p class="eyebrow">Course outline</p><h3>Syllabus</h3></div></div>
      <div class="academic-context-card-grid">${syllabusCards}</div>
    </section>
    <section class="academic-context-group" aria-labelledby="academic-context-materials-title">
      <div class="section-heading"><div><p class="eyebrow">Ready for study</p><h3 id="academic-context-materials-title">Study materials</h3></div></div>
      <div class="academic-context-card-grid">${materialCards}</div>
    </section>
    <section class="academic-context-group" aria-labelledby="academic-context-exam-pdfs-title">
      <div class="section-heading"><div><p class="eyebrow">Optional PDF</p><h3 id="academic-context-exam-pdfs-title">Exam schedules</h3></div></div>
      <div class="academic-context-card-grid">${examScheduleCards}</div>
    </section>
    ${classroomReview}
  `;
}

function renderSelects() {
  const courseOptions = state.courses.map((course) => `<option value="${course.id}">${escapeHtml(course.title)}</option>`).join("");
  const topicOptions = state.topics.map((topic) => `<option value="${topic.id}">${escapeHtml(topic.title)}</option>`).join("");
  const assignmentOptions = state.assignments.filter(assignmentNeedsAction).map((assignment) => `<option value="${assignment.id}">${escapeHtml(assignment.title)}</option>`).join("");
  els.sourceCourseSelect.innerHTML = `<option value="">Choose a course</option>${courseOptions}`;
  if (els.examCourseSelect) els.examCourseSelect.innerHTML = `<option value="">Choose a course</option>${courseOptions}`;
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
  const titles = { today: "Today", setup: "Setup", courses: "Courses", memory: "Academic Context", study: "Study and Evaluate", studio: "Studio", account: "Account" };
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
    if (academicContextReadiness().status === "context_preparing") scheduleAcademicContextPreparationPoll();
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
  const usedMaterialSnippets = result.grounding?.uploadedMaterialUsed === true
    ? result.grounding?.snippets || []
    : [];
  const usedSourceLabels = usedMaterialSnippets.length ? result.sourceLabels || [] : [];
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
  if (usedMaterialSnippets.length) {
    extra.push(`
      <strong>Selected material</strong>
      <div class="source-snippets">
        ${usedMaterialSnippets.map((item) => `
          <blockquote>
            <p>${escapeHtml(item.snippet)}</p>
            <cite>${escapeHtml(item.citationLabel || item.sourceTitle || "Selected material")}</cite>
          </blockquote>
        `).join("")}
      </div>
    `);
  }
  if (result.weeklyAiHelp?.low && !result.weeklyAiHelp?.blocked) {
    extra.push(`<p>You are close to this week’s AI help limit. AI help remaining this week: ${Number(result.weeklyAiHelp.remaining || 0)}.</p>`);
  }

  setResult(els.aiResponse, `
    <strong>StudentOS response</strong>
    <p>${escapeHtml(result.answer)}</p>
      <div class="tag-row">
        ${result.coverage?.status ? tag(humanize(result.coverage.status), toneForCoverage(result.coverage.status)) : ""}
      ${result.grounding?.insufficientContext ? tag("not enough material yet", "urgent") : ""}
      ${usedSourceLabels.map((source) => tag(source.label, "source")).join("")}
    </div>
    ${result.grounding?.insufficiencyReason ? `<p>${escapeHtml(result.grounding.insufficiencyReason)}</p>` : ""}
    ${extra.join("")}
  `);
}

async function runAi(event) {
  event.preventDefault();
  await withButtonLoading(event.submitter || els.aiForm.querySelector("button[type='submit']"), "Running...", async () => {
    setLoading(els.aiResponse, "Preparing your answer...");
    try {
      const result = await api("/api/ai/verb", {
        method: "POST",
        body: JSON.stringify({ verb: activeVerb, message: els.aiMessage.value }),
      });
      renderAiPayload(result);
    } catch (error) {
      setResult(els.aiResponse, `
        <strong>AI response unavailable</strong>
        <p>I could not complete that answer right now. Please try again.</p>
        <div class="tag-row">
          ${tag("try again", "medium")}
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

function resetExamForm() {
  els.examForm?.reset();
  if (els.examId) els.examId.value = "";
  if (els.examSubmitButton) els.examSubmitButton.textContent = "Add exam";
  if (els.examEditCancel) els.examEditCancel.hidden = true;
}

function beginExamEdit(examId) {
  const exam = (state.exams || []).find((item) => item.id === examId);
  if (!exam || !els.examForm) return;
  els.examId.value = exam.id;
  els.examCourseSelect.value = exam.courseId || "";
  els.examName.value = exam.title || "";
  els.examDate.value = String(exam.examDate || "").slice(0, 10);
  els.examTime.value = exam.examTime || "";
  els.examWeightage.value = exam.marksWeightage || exam.weight || "";
  els.examNotes.value = exam.notes || "";
  els.examSubmitButton.textContent = "Save exam";
  els.examEditCancel.hidden = false;
  els.examName.focus();
}

async function saveExam(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  if (!formElement.reportValidity()) return;
  const values = Object.fromEntries(new FormData(formElement).entries());
  const examId = String(values.examId || "");
  await withButtonLoading(event.submitter || els.examSubmitButton, examId ? "Saving..." : "Adding...", async () => {
    const result = await api(examId ? `/api/academic-context/exams/${encodeURIComponent(examId)}` : "/api/academic-context/exams", {
      method: examId ? "PATCH" : "POST",
      body: JSON.stringify(values),
    });
    state = result.state || state;
    resetExamForm();
    render();
    setView("memory");
    setResult(els.examResult, `<strong>${escapeHtml(result.message || "Exam date saved.")}</strong>`);
  }, { timeoutTarget: els.examResult, timeoutCopy: "Saving this exam is taking longer than expected. Please try again." });
}

async function deleteExam(examId) {
  const result = await api(`/api/academic-context/exams/${encodeURIComponent(examId)}`, { method: "DELETE" });
  state = result.state || state;
  resetExamForm();
  render();
  setView("memory");
  setResult(els.examResult, `<strong>${escapeHtml(result.message || "Exam removed from Academic Context.")}</strong>`);
}

function scheduleAcademicContextPreparationPoll(delayMs = 900) {
  if (academicContextPreparationPoll) window.clearTimeout(academicContextPreparationPoll);
  academicContextPreparationPoll = window.setTimeout(() => {
    academicContextPreparationPoll = null;
    pollAcademicContextPreparation().catch((error) => {
      todayTodoMessage = error.message;
      render();
    });
  }, delayMs);
}

async function pollAcademicContextPreparation() {
  const result = await api("/api/academic-context/status");
  state = result.state || state;
  render();
  if (academicContextReadiness().status === "context_preparing") scheduleAcademicContextPreparationPoll(1200);
}

async function prepareAcademicContext() {
  todayTodoMessage = "";
  const oneClickTodo = currentActivePlanKey() !== "starter";
  state.academicContext = {
    ...academicContextReadiness(),
    status: oneClickTodo ? "context_classroom_backfill" : "context_preparing",
    message: oneClickTodo ? "Checking selected Classroom work." : "Setting things up for you.",
  };
  setView("today");
  render();
  try {
    const result = await api("/api/academic-context/prepare", { method: "POST", body: JSON.stringify({}) });
    state = result.state || state;
    todayTodoMessage = result.message || "";
    render();
    if (result.autoGenerateTodo) await generateTodayTodo();
    else if (academicContextReadiness().status === "context_preparing") scheduleAcademicContextPreparationPoll();
  } catch (error) {
    todayTodoMessage = error.message;
    await loadBootstrap();
    setView("today");
  }
}

function browserTodoClock() {
  const now = new Date();
  return {
    currentDate: localDateOnly(now),
    currentTime: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

async function generateTodayTodo() {
  todayTodoGenerating = true;
  todayTodoMessage = "";
  render();
  try {
    const result = await api("/api/today/todo", {
      method: "POST",
      body: JSON.stringify(browserTodoClock()),
    });
    state = result.state || state;
    if (!result.generated) todayTodoMessage = result.message || "StudentOS could not generate today’s plan. Please try again.";
  } catch (error) {
    todayTodoMessage = error.message;
  } finally {
    todayTodoGenerating = false;
    render();
    setView("today");
  }
}

async function selectStudyItem(itemId) {
  const item = currentStudyPlan()?.items?.find((entry) => entry.id === itemId);
  if (!item) return;
  selectedStudyItemId = itemId;
  studyWorkspaceMessage = "";
  renderStudyAndEvaluate();
  if (item.study_status !== "not_started") return;
  try {
    const result = await api("/api/study/status", {
      method: "POST",
      body: JSON.stringify({ itemId, status: "studying" }),
    });
    state = result.state || state;
    renderStudyAndEvaluate();
  } catch (error) {
    studyWorkspaceMessage = error.message;
    renderStudyAndEvaluate();
  }
}

async function createStudyMaterial() {
  if (!selectedStudyItemId || studyMaterialGenerating) return;
  studyMaterialGenerating = true;
  studyWorkspaceMessage = "";
  renderStudyAndEvaluate();
  try {
    const result = await api("/api/study/material", {
      method: "POST",
      body: JSON.stringify({ itemId: selectedStudyItemId }),
    });
    state = result.state || state;
    studyWorkspaceMessage = result.generated
      ? (result.message || "Study material created and saved to Academic Context.")
      : (result.message || "StudentOS could not create this study material right now. Please try again.");
  } catch (error) {
    studyWorkspaceMessage = error.message;
  } finally {
    studyMaterialGenerating = false;
    render();
    setView("study");
  }
}

async function markStudyDone() {
  if (!selectedStudyItemId) return;
  const result = await api("/api/study/status", {
    method: "POST",
    body: JSON.stringify({ itemId: selectedStudyItemId, status: "done" }),
  });
  state = result.state || state;
  studyWorkspaceMessage = result.message || "Study marked done.";
  render();
  setView("study");
}

async function createStudyTest() {
  if (!selectedStudyItemId || studyTestGenerating) return;
  studyTestGenerating = true;
  studyWorkspaceMessage = "";
  renderStudyAndEvaluate();
  try {
    const result = await api("/api/study/test", {
      method: "POST",
      body: JSON.stringify({ itemId: selectedStudyItemId }),
    });
    state = result.state || state;
    studyWorkspaceMessage = result.generated
      ? (result.message || "Your test is ready. Review the warning before you start.")
      : (result.message || "StudentOS could not create this test right now. Please try again.");
  } catch (error) {
    studyWorkspaceMessage = error.message;
  } finally {
    studyTestGenerating = false;
    render();
    setView("study");
  }
}

async function startStudyTest(sessionId) {
  const answerMode = els.studyEvaluateContent?.querySelector('input[name="study-answer-mode"]:checked')?.value;
  if (!answerMode) {
    studyWorkspaceMessage = "Choose how you will answer before starting the test.";
    renderStudyAndEvaluate();
    return;
  }
  const result = await api(`/api/study/tests/${encodeURIComponent(sessionId)}/start`, {
    method: "POST",
    body: JSON.stringify({ answerMode }),
  });
  state = result.state || state;
  studyWorkspaceMessage = result.message || "Test started. The timer cannot be paused.";
  renderStudyAndEvaluate();
}

function typedStudyTestAnswers() {
  return Object.fromEntries([...els.studyEvaluateContent.querySelectorAll("[data-study-test-answer]")]
    .map((input) => [input.dataset.studyTestAnswer, input.value]));
}

async function saveCurrentStudyTestAnswers(sessionId) {
  const answers = typedStudyTestAnswers();
  const result = await api(`/api/study/tests/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ answers }),
  });
  state = result.state || state;
  const saveState = els.studyEvaluateContent?.querySelector("[data-study-test-save-state]");
  if (saveState) saveState.textContent = "Answers saved.";
}

function scheduleStudyTestAutosave(input) {
  const sessionId = input.closest("[data-study-test-session]")?.dataset.studyTestSession;
  if (!sessionId) return;
  const saveState = els.studyEvaluateContent?.querySelector("[data-study-test-save-state]");
  if (saveState) saveState.textContent = "Saving answers...";
  if (studyTestAutosave) window.clearTimeout(studyTestAutosave);
  studyTestAutosave = window.setTimeout(() => {
    studyTestAutosave = null;
    saveCurrentStudyTestAnswers(sessionId).catch(async (error) => {
      if (saveState) saveState.textContent = error.message;
      if (/time is up|locked/i.test(error.message)) await refreshStudyTestSession(sessionId);
    });
  }, 700);
}

async function finishStudyTest(sessionId) {
  const session = (state.testSessions || []).find((entry) => entry.id === sessionId);
  if (studyTestAutosave) {
    window.clearTimeout(studyTestAutosave);
    studyTestAutosave = null;
  }
  if (session?.answerMode === "typed") await saveCurrentStudyTestAnswers(sessionId);
  const result = await api(`/api/study/tests/${encodeURIComponent(sessionId)}/finish`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  state = result.state || state;
  studyWorkspaceMessage = result.message || "Your test attempt is saved.";
  renderStudyAndEvaluate();
}

async function evaluateStudyTestAttempt(sessionId) {
  const session = (state.testSessions || []).find((entry) => entry.id === sessionId);
  let body = JSON.stringify({});
  if (session?.answerMode === "handwritten") {
    const file = els.studyEvaluateContent?.querySelector("[data-study-answer-sheet]")?.files?.[0] || null;
    const extension = file?.name?.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
    if (!file && !session.answerSheetDraft?.filename) {
      studyWorkspaceMessage = "Upload your handwritten answer sheet as PDF or DOCX.";
      renderStudyAndEvaluate();
      return;
    }
    if (file && ![".pdf", ".docx"].includes(extension)) {
      studyWorkspaceMessage = "Upload your handwritten answer sheet as PDF or DOCX.";
      renderStudyAndEvaluate();
      return;
    }
    if (file) {
      body = new FormData();
      body.append("answerSheet", file);
    }
  }
  const result = await api(`/api/study/tests/${encodeURIComponent(sessionId)}/evaluate`, { method: "POST", body });
  state = result.state || state;
  studyWorkspaceMessage = result.message || (result.evaluated ? "Your result is ready." : "StudentOS could not evaluate this test right now. Your answers are safe. Please try again.");
  render();
  setView("study");
}

function continueStudyAndEvaluate() {
  const items = currentStudyPlan()?.items || [];
  const next = items.find((item) => currentStudyTestSession(item)?.status !== "evaluated") || null;
  if (next) selectedStudyItemId = next.id;
  studyWorkspaceMessage = next ? "Choose the next step for this study item." : "Today’s Study and Evaluate items are complete.";
  renderStudyAndEvaluate();
}

async function refreshStudyTestSession(sessionId) {
  if (studyTestExpiryRefreshPending) return;
  studyTestExpiryRefreshPending = true;
  try {
    const result = await api(`/api/study/tests/${encodeURIComponent(sessionId)}`);
    state = result.state || state;
    renderStudyAndEvaluate();
  } catch (error) {
    studyWorkspaceMessage = error.message;
    renderStudyAndEvaluate();
  } finally {
    studyTestExpiryRefreshPending = false;
  }
}

function releaseAcademicPdfObjectUrl() {
  if (!academicPdfObjectUrl) return;
  URL.revokeObjectURL(academicPdfObjectUrl);
  academicPdfObjectUrl = null;
}

function closeAcademicPdfViewer() {
  const dialog = els.academicPdfViewer;
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
}

async function openAcademicPdf(materialId, title = "Academic Context PDF") {
  const dialog = els.academicPdfViewer;
  if (!dialog) return;
  releaseAcademicPdfObjectUrl();
  els.academicPdfViewerTitle.textContent = title;
  els.academicPdfViewerStatus.textContent = "Opening document...";
  els.academicPdfViewerStatus.hidden = false;
  els.academicPdfViewerObject.hidden = true;
  els.academicPdfViewerObject.removeAttribute("data");
  els.academicPdfViewerFallback.removeAttribute("href");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  try {
    const headers = {};
    if (authSession?.access_token) headers.Authorization = `Bearer ${authSession.access_token}`;
    const response = await fetch(apiUrl(`/api/academic-context/materials/${encodeURIComponent(materialId)}/open`), { headers });
    if (!response.ok) {
      const body = await readJsonResponse(response, "This material could not be opened.");
      throw new Error(studentFacingRequestError(body.error || "This material could not be opened.", response.status));
    }
    academicPdfObjectUrl = URL.createObjectURL(await response.blob());
    els.academicPdfViewerFallback.href = academicPdfObjectUrl;
    els.academicPdfViewerObject.data = academicPdfObjectUrl;
    els.academicPdfViewerObject.hidden = false;
    els.academicPdfViewerStatus.hidden = true;
  } catch (error) {
    els.academicPdfViewerStatus.textContent = error.message;
    els.academicPdfViewerStatus.hidden = false;
  }
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
  const kindLabel = sourceKindLabel(kind);
  const file = form.get("file");
  if (!validateAcademicContextUploadForm(form, kind, file)) {
    setResult(els.sourceResult, `<p>Check the highlighted details before uploading.</p>`);
    return;
  }
  await withButtonLoading(event.submitter, `Uploading ${kindLabel}...`, async () => {
    setLoading(els.sourceResult, `Adding this ${kindLabel} to Academic Context...`);
    try {
      const result = await api("/api/sources/upload", {
        method: "POST",
        body: form,
      });
      const readyCopy = {
        assignment: " is ready for assignment planning.",
        material: " is ready for study.",
        syllabus: " is ready for course planning.",
        exam_schedule: " is ready for exam planning.",
      }[kind] || " is ready in Academic Context.";
      setResult(els.sourceResult, `
        <strong>Added to Academic Context.</strong>
        <p>${escapeHtml(result.material.title)}${result.material.extractionError ? " was added and needs attention." : readyCopy}</p>
      `);
      formElement.reset();
      clearAcademicContextFieldMessages();
      syncAcademicContextUploadType();
      await loadBootstrap();
    } catch (error) {
      setResult(els.sourceResult, `
        <strong>Could not add this PDF</strong>
        <p>${escapeHtml(academicContextUploadErrorCopy(error, kind))}</p>
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
  window.requestAnimationFrame(() => els.academicContextDeleteCancel?.focus());
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
  setResult(els.sourceResult, `<strong>Removed from Academic Context.</strong><p>StudentOS will no longer use this item.</p>`);
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

async function connectClassroom(purpose = "setup") {
  setLoading(els.classroomPanel, "Preparing Classroom connection...");
  const result = await api("/api/classroom/oauth/start", {
    method: "POST",
    body: JSON.stringify({ purpose }),
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

async function refreshClassroomCourses() {
  if (els.sourceResult) setLoading(els.sourceResult, "Refreshing your course list...");
  const result = await api("/api/classroom/courses/refresh", {
    method: "POST",
    body: JSON.stringify({}),
  });
  state = result.state || state;
  classroomStatus = { connector: result.connector, syncSummary: result.summary, syncHistory: result.connector?.syncHistory || [], policy: result.policy || null };
  classroomStatusLoaded = true;
  render();
  if (els.sourceResult) {
    setResult(els.sourceResult, `<strong>Courses refreshed.</strong><p>StudentOS only refreshed your course names. It did not import assignments or materials.</p>`);
  }
}

async function addClassroomItemToAcademicContext(itemId) {
  const result = await api("/api/classroom/selection", {
    method: "POST",
    body: JSON.stringify({ itemIds: [itemId] }),
  });
  state = result.state || state;
  render();
  if (els.sourceResult) setResult(els.sourceResult, `<strong>Added to Academic Context.</strong><p>${escapeHtml(result.message || "Selected Classroom work is ready to use.")}</p>`);
}

async function ignoreClassroomItem(itemId) {
  const result = await api("/api/classroom/selection", {
    method: "POST",
    body: JSON.stringify({ ignoreIds: [itemId] }),
  });
  state = result.state || state;
  render();
  if (els.sourceResult) setResult(els.sourceResult, `<strong>Left out for now.</strong><p>${escapeHtml(result.message || "This Classroom work was not added to your academic context.")}</p>`);
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
  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-study-test-answer]")) scheduleStudyTestAutosave(event.target);
  });
  document.addEventListener("click", (event) => {
    const studyItem = event.target.closest("[data-study-item-id]");
    if (studyItem) {
      selectStudyItem(studyItem.dataset.studyItemId);
      return;
    }
    if (event.target.closest("[data-study-go-today]")) {
      setView("today");
      return;
    }
    const openGeneratedStudy = event.target.closest("[data-open-generated-study]");
    if (openGeneratedStudy) {
      selectedStudyItemId = openGeneratedStudy.dataset.openGeneratedStudy;
      studyWorkspaceMessage = "";
      renderStudyAndEvaluate();
      setView("study");
      return;
    }
    const openAcademicPdfButton = event.target.closest("[data-open-academic-pdf]");
    if (openAcademicPdfButton) {
      openAcademicPdf(openAcademicPdfButton.dataset.openAcademicPdf, openAcademicPdfButton.dataset.pdfTitle);
      return;
    }
    const generateStudyMaterialButton = event.target.closest("[data-study-generate-material]");
    if (generateStudyMaterialButton) {
      createStudyMaterial();
      return;
    }
    const markStudyDoneButton = event.target.closest("[data-study-mark-done]");
    if (markStudyDoneButton) {
      withButtonLoading(markStudyDoneButton, "Saving...", markStudyDone, {
        timeoutTarget: els.studyEvaluateContent,
        timeoutCopy: "Saving this study item is taking longer than expected. Please try again.",
      }).catch((error) => {
        studyWorkspaceMessage = error.message;
        renderStudyAndEvaluate();
      });
      return;
    }
    const generateStudyTestButton = event.target.closest("[data-study-generate-test]");
    if (generateStudyTestButton) {
      createStudyTest();
      return;
    }
    const startStudyTestButton = event.target.closest("[data-study-test-start]");
    if (startStudyTestButton) {
      withButtonLoading(startStudyTestButton, "Starting...", () => startStudyTest(startStudyTestButton.dataset.studyTestStart), {
        timeoutTarget: els.studyEvaluateContent,
        timeoutCopy: "Starting this test is taking longer than expected. Please try again.",
      }).catch((error) => {
        studyWorkspaceMessage = error.message;
        renderStudyAndEvaluate();
      });
      return;
    }
    const finishStudyTestButton = event.target.closest("[data-study-test-finish]");
    if (finishStudyTestButton) {
      withButtonLoading(finishStudyTestButton, "Saving...", () => finishStudyTest(finishStudyTestButton.dataset.studyTestFinish), {
        timeoutTarget: els.studyEvaluateContent,
        timeoutCopy: "Saving this test is taking longer than expected. Please try again.",
      }).catch(async (error) => {
        studyWorkspaceMessage = error.message;
        if (/time is up|locked/i.test(error.message)) await refreshStudyTestSession(finishStudyTestButton.dataset.studyTestFinish);
        else renderStudyAndEvaluate();
      });
      return;
    }
    const evaluateStudyTestButton = event.target.closest("[data-study-test-evaluate]");
    if (evaluateStudyTestButton) {
      withButtonLoading(evaluateStudyTestButton, "Evaluating...", () => evaluateStudyTestAttempt(evaluateStudyTestButton.dataset.studyTestEvaluate), {
        timeoutTarget: els.studyEvaluateContent,
        timeoutCopy: "Evaluation is taking longer than expected. Your answers are safe; please try again.",
      }).catch((error) => {
        studyWorkspaceMessage = error.message;
        renderStudyAndEvaluate();
      });
      return;
    }
    const reviewCorrectionsButton = event.target.closest("[data-study-review-corrections]");
    if (reviewCorrectionsButton) {
      els.studyEvaluateContent?.querySelector(".study-result-questions")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const continueStudyButton = event.target.closest("[data-study-continue]");
    if (continueStudyButton) {
      continueStudyAndEvaluate();
      return;
    }
    const todayAction = event.target.closest("[data-today-action]");
    if (todayAction) {
      const action = todayAction.dataset.todayAction;
      if (action === "academic-context") setView("memory");
      if (action === "prepare-context") {
        withButtonLoading(todayAction, "Preparing...", prepareAcademicContext, {
          timeoutTarget: els.dashboardSummary,
          timeoutCopy: "Academic Context preparation is taking longer than expected. Please try again.",
          timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
        }).catch((error) => {
          todayTodoMessage = error.message;
          render();
        });
      }
      if (action === "generate-todo") {
        withButtonLoading(todayAction, "Generating...", generateTodayTodo, {
          timeoutTarget: els.dashboardSummary,
          timeoutCopy: "Today’s plan is taking longer than expected. Please try again.",
          timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
        }).catch((error) => {
          todayTodoMessage = error.message;
          todayTodoGenerating = false;
          render();
        });
      }
      return;
    }
    const editExamButton = event.target.closest("[data-edit-exam-id]");
    if (editExamButton) {
      beginExamEdit(editExamButton.dataset.editExamId);
      return;
    }
    const deleteExamButton = event.target.closest("[data-delete-exam-id]");
    if (deleteExamButton) {
      withButtonLoading(deleteExamButton, "Deleting...", () => deleteExam(deleteExamButton.dataset.deleteExamId), {
        timeoutTarget: els.examResult,
        timeoutCopy: "Removing this exam is taking longer than expected. Please try again.",
      }).catch((error) => setResult(els.examResult, `<p>${escapeHtml(error.message)}</p>`));
      return;
    }
    const courseRefreshButton = event.target.closest("[data-course-refresh]");
    if (courseRefreshButton) {
      withButtonLoading(courseRefreshButton, "Refreshing...", refreshClassroomCourses, {
        timeoutTarget: els.sourceResult || els.classroomPanel,
        timeoutCopy: "Refreshing your course list is taking longer than expected. Please try again.",
        timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
      }).catch((error) => {
        if (els.sourceResult) setResult(els.sourceResult, `<p>${escapeHtml(error.message)}</p>`);
        else renderClassroomError(error);
      });
      return;
    }
    const courseConnectButton = event.target.closest("[data-course-connect]");
    if (courseConnectButton) {
      withButtonLoading(courseConnectButton, "Preparing...", () => connectClassroom("course_recovery"), {
        timeoutTarget: els.sourceResult || els.classroomPanel,
        timeoutCopy: "Classroom connection is taking longer than expected. Please try again.",
        timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
      }).catch((error) => {
        if (els.sourceResult) setResult(els.sourceResult, `<p>${escapeHtml(error.message)}</p>`);
        else renderClassroomError(error);
      });
      return;
    }
    const openCoursesButton = event.target.closest("[data-open-courses]");
    if (openCoursesButton) {
      openCourseSetup();
      return;
    }
    const editCourseButton = event.target.closest("[data-edit-course-id]");
    if (editCourseButton) {
      beginCourseEdit(editCourseButton.dataset.editCourseId);
      return;
    }
    const archiveCourseButton = event.target.closest("[data-archive-course-id]");
    if (archiveCourseButton) {
      withButtonLoading(archiveCourseButton, "Archiving...", () => archiveCourse(archiveCourseButton.dataset.archiveCourseId), {
        timeoutTarget: els.courseResult,
        timeoutCopy: "Archiving this course is taking longer than expected. Please try again.",
      }).catch((error) => {
        setResult(els.courseResult, `<p>${escapeHtml(courseManagementErrorCopy(error))}</p>`);
      });
      return;
    }
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
  els.academicPdfViewerClose?.addEventListener("click", closeAcademicPdfViewer);
  els.academicPdfViewer?.addEventListener("close", () => {
    els.academicPdfViewerObject?.removeAttribute("data");
    releaseAcademicPdfObjectUrl();
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
  els.academicContextAddButton?.addEventListener("click", () => {
    els.academicContextUploadPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      const firstControl = [els.sourceKindSelect, els.sourceTitle].find((control) => control && !control.disabled);
      firstControl?.focus({ preventScroll: true });
    }, 250);
  });
  els.academicContextPrepareButton?.addEventListener("click", () => {
    withButtonLoading(els.academicContextPrepareButton, "Preparing...", prepareAcademicContext, {
      timeoutTarget: els.academicContextPreparationStatus,
      timeoutCopy: "Academic Context preparation is taking longer than expected. Please try again.",
      timeoutMs: LONG_ACTION_LOADING_TIMEOUT_MS,
    }).catch((error) => setResult(els.academicContextPreparationStatus, `<p>${escapeHtml(error.message)}</p>`));
  });
  els.sourceKindSelect?.addEventListener("change", () => {
    syncAcademicContextUploadType();
    clearAcademicContextFieldMessages("deadline");
    updateProductFeatureControls();
  });
  els.sourceTitle?.addEventListener("input", () => clearAcademicContextFieldMessages("title"));
  els.sourceCourseSelect?.addEventListener("change", () => clearAcademicContextFieldMessages("course"));
  els.sourceDeadline?.addEventListener("input", () => clearAcademicContextFieldMessages("deadline"));
  els.sourceFile?.addEventListener("change", () => clearAcademicContextFieldMessages("file"));
  els.examForm?.addEventListener("submit", saveExam);
  els.examEditCancel?.addEventListener("click", resetExamForm);
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
  els.courseForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    withButtonLoading(event.submitter || els.courseSubmitButton, els.courseId.value ? "Saving..." : "Adding...", () => saveCourse(event.currentTarget), {
      timeoutTarget: els.courseResult,
      timeoutCopy: "Saving this course is taking longer than expected. Please try again.",
    }).catch((error) => {
      setResult(els.courseResult, `<p>${escapeHtml(courseManagementErrorCopy(error))}</p>`);
    });
  });
  els.courseEditCancel?.addEventListener("click", resetCourseForm);
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
