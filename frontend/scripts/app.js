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
let aiDrawerReturnFocus = null;
let sourceSearchQuery = "";
let authShellMode = "signin";

const els = {
  publicAuthShell: document.getElementById("public-auth-shell"),
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

function authGateActive() {
  return Boolean(runtimeConfig.auth?.enabled && !authSession?.access_token);
}

function updateShellVisibility() {
  const showPublicAuth = authGateActive();
  if (els.publicAuthShell) {
    els.publicAuthShell.hidden = !showPublicAuth;
  }
  if (els.appShell) {
    els.appShell.hidden = showPublicAuth;
  }
  document.body.classList.toggle("auth-shell-active", showPublicAuth);
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
  if (lower.includes("insufficient") || lower.includes("scope")) {
    return "Classroom sync needs the approved read-only scopes. Reconnect Classroom, then sync again.";
  }
  if (lower.includes("expired") || lower.includes("revoked") || lower.includes("invalid credentials") || lower.includes("unauthorized")) {
    return "Classroom access expired or was revoked. Reconnect Classroom to continue read-only imports.";
  }
  if (lower.includes("quota") || lower.includes("rate") || lower.includes("429")) {
    return "Google Classroom is rate-limiting this sync. Wait a moment, then try again.";
  }
  return message || "Classroom import is temporarily unavailable. No Classroom work was modified.";
}

function renderClassroomError(error) {
  if (!els.classroomPanel) return;
  els.classroomPanel.innerHTML = `
    <strong>Classroom import unavailable</strong>
    <p>${escapeHtml(classroomErrorCopy(error))}</p>
    <div class="tag-row">
      ${tag("read only", "source")}
      ${tag("no writeback", "urgent")}
      ${tag("try again", "medium")}
    </div>
  `;
}

function isPublicFrontendOrigin() {
  return PUBLIC_FRONTEND_HOSTS.has(window.location.hostname);
}

function apiBaseMisconfiguredError() {
  return new Error(API_BASE_MISCONFIGURED_MESSAGE);
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
    throw new Error(body.error || `HTTP ${response.status}`);
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
  } catch (error) {
    classroomStatus = {
      connector: {
        state: "error",
        mode: runtimeConfig.classroom?.mode || "unknown",
        readOnlyImport: true,
        writeScopesEnabled: false,
      },
      error: error.message,
    };
  }
  renderClassroomPanel();
}

function getAcademicGoalLabel() {
  return humanize(state?.studentProfile?.preferences?.academicGoal || "exam_prep");
}

async function authRequest(path, body, token = "") {
  if (!runtimeConfig.auth?.enabled) {
    throw new Error("Supabase Auth is not configured");
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
  const payload = await readJsonResponse(response, "StudentOS Auth returned an invalid JSON response.").catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.msg || payload.error || "Auth request failed");
  }
  return payload;
}

function renderAuth(message = "") {
  if (!runtimeConfig.auth?.enabled) {
    els.authForm.hidden = true;
    els.logoutBtn.hidden = true;
    setText(els.authSession, "Local demo session");
    setText(els.authHelp, "Local demo keeps account actions available without contacting Supabase Auth.");
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
    <div class="tag-row">
      ${tag(humanize(result.mode), "source")}
      ${tag(result.resetEmailRequested ? "reset email requested" : "preview ready", result.resetEmailRequested ? "source" : "medium")}
      ${tag("protected request", "source")}
    </div>
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
      ${tag(humanize(result.mode), "source")}
      ${tag(result.verificationEmailRequested ? "verification email requested" : "preview ready", result.verificationEmailRequested ? "source" : "medium")}
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

function sortedByDate(items, getValue) {
  return [...(items || [])].sort((left, right) => timestampFor(getValue(left)) - timestampFor(getValue(right)));
}

function getNextActions() {
  const roadmap = (state.roadmap || []).filter((item) => item.status === "open");
  return state.todayNextActions?.length ? state.todayNextActions : sortedByDate(roadmap, (item) => item.dueAt);
}

function getDueAssignments() {
  return sortedByDate(state.assignments || [], (assignment) => assignment.dueDate);
}

function getNextTimetableBlock() {
  return sortedByDate(state.timetable || [], (item) => item.startsAt)[0] || null;
}

function getCourseTopics(courseId) {
  return (state.topics || []).filter((topic) => topic.courseId === courseId);
}

function getCourseAssignments(courseId) {
  return sortedByDate((state.assignments || []).filter((assignment) => assignment.courseId === courseId), (assignment) => assignment.dueDate);
}

function getCourseSources(courseId) {
  return (state.sourceMaterials || []).filter((source) => source.courseId === courseId && !source.deletedAt);
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
  if (mode === "supabase") return "Cloud sync";
  if (mode === "mock") return "Demo mode";
  return humanize(mode || "unknown mode");
}

function classroomModeLabel(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "mock") return "Demo Classroom";
  if (mode === "oauth") return "Connected";
  if (mode === "disabled") return "Not connected";
  if (mode === "disconnected") return "Not connected";
  return humanize(value || "Not connected");
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
  if (value.includes("web")) return "outside reference shown";
  return "material check";
}

function providerLabel(provider) {
  if (!provider) return "";
  return provider === "mock" ? "Demo response" : "AI response";
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

function render() {
  if (!state) return;
  const plan = accountSnapshot?.quota?.plan || state.saas?.quotas?.defaultPlan || runtimeConfig.saas?.quotas?.defaultPlan || { label: "Free" };
  els.studentName.textContent = state.studentProfile.displayName || "Student";
  els.creditBalance.textContent = state.creditBalance || 0;
  els.planBadge.textContent = plan.label || "Free";
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
  els.dashboardSummary.innerHTML = `
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
  `;
}

function renderRoadmap() {
  const actions = getNextActions();
  if (!actions.length) {
    els.roadmapList.innerHTML = `
      <article class="item-card roadmap-empty-card">
        <strong>Queue is clear</strong>
        <p>Generate a roadmap in Setup or sync Classroom to build today's study list.</p>
        <div class="item-meta">
          ${tag("Today ready", "source")}
          ${tag("student controlled", "source")}
        </div>
      </article>
    `;
    return;
  }
  els.roadmapList.innerHTML = actions.slice(0, 5).map((item) => {
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
  }).join("");
}

function renderTimetable() {
  const blocks = sortedByDate(state.timetable || [], (item) => item.startsAt);
  if (!blocks.length) {
    els.timetableList.innerHTML = `
      <article class="item-card timetable-empty-card">
        <strong>No blocks listed</strong>
        <p>Add classes or study blocks in Setup so Today can protect your time.</p>
        <div class="item-meta">${tag("schedule open", "medium")}</div>
      </article>
    `;
    return;
  }
  els.timetableList.innerHTML = blocks.map((item) => {
    const course = courseById(item.courseId);
    return `
      <article class="item-card timetable-card">
        <strong>${escapeHtml(item.title)}</strong>
        <p>${formatTime(item.startsAt)} - ${formatTime(item.endsAt)} / ${escapeHtml(item.location)}</p>
        <div class="item-meta">${tag(course?.title || "Study")}</div>
      </article>
    `;
  }).join("");
}

function renderClassroomPanel() {
  if (!els.classroomPanel) return;
  const connector = classroomStatus?.connector || runtimeConfig.classroom || {};
  const summary = classroomStatus?.syncSummary || connector.syncSummary || null;
  const history = classroomStatus?.syncHistory || connector.syncHistory || [];
  const providerEmail = connector.providerAccountEmail || connector.tokenMetadata?.providerAccountEmail || "";
  const scopes = connector.scopes || [];
  const lastSync = connector.lastSyncAt || history[0]?.completedAt || "";
  const reconnectCopy = ["expired", "error"].includes(connector.state)
    ? `<p class="warning-copy">Reconnect required before StudentOS can refresh Classroom assignments.</p>`
    : "";
  const safeError = connector.lastError || history.find((run) => run.errorSummary)?.errorSummary || "";
  const safeErrorCode = connector.lastErrorCode || history.find((run) => run.payload?.errorCode)?.payload?.errorCode || "";
  const emptyClassroom = summary?.emptyClassroom || history.some((run) => run.payload?.emptyClassroom);
  els.classroomPanel.innerHTML = `
    <div class="classroom-compact-head">
      <div>
        <strong>${escapeHtml(classroomModeLabel(connector.state || connector.mode || "mock"))}</strong>
        <p>Read-only Classroom import. StudentOS cannot submit, grade, turn in, or modify Classroom work.</p>
      </div>
      ${summary ? `<span>${escapeHtml(`${summary.importedAssignments || 0} new / ${summary.updatedAssignments || 0} updated`)}</span>` : ""}
    </div>
    ${reconnectCopy}
    <div class="tag-row">
      ${tag(classroomModeLabel(connector.mode || "mock"), "source")}
      ${tag(connector.readOnlyImport === false ? "not ready" : "read only", "source")}
      ${tag(connector.writeScopesEnabled ? "write scope risk" : "no write scopes", connector.writeScopesEnabled ? "urgent" : "source")}
      ${lastSync ? tag(`synced ${formatDate(lastSync)}`, "source") : ""}
    </div>
    <p>${providerEmail ? `Account: ${escapeHtml(providerEmail)} / ` : ""}${lastSync ? `Last sync ${escapeHtml(formatDate(lastSync))}` : "Manual sync only"}</p>
    ${safeError ? `<p class="warning-copy">${escapeHtml(safeErrorCode ? `${humanize(safeErrorCode)}: ${safeError}` : safeError)}</p>` : ""}
    ${emptyClassroom ? `<p class="muted-copy">No active Classroom courses or coursework were found. StudentOS is connected and ready; sync again after new Classroom work appears.</p>` : ""}
    ${summary || scopes.length || history.length || connector.tokenPersistence || connector.tokenMetadata?.encryptedAtRest ? `
      <details class="classroom-details">
        <summary>Sync details</summary>
        ${summary ? `<p>${escapeHtml(`${summary.importedCourses || 0} course(s), ${summary.importedAssignments || 0} new assignment(s), ${summary.updatedAssignments || 0} updated${summary.emptyClassroom ? " / empty Classroom account" : ""}`)}</p>` : ""}
        ${scopes.length ? `<p class="muted-copy">Scopes: ${scopes.map((scope) => escapeHtml(scope.replace("https://www.googleapis.com/auth/", ""))).join(", ")}</p>` : ""}
        ${connector.tokenPersistence ? `<p class="muted-copy">Token storage: ${escapeHtml(humanize(connector.tokenPersistence))}${connector.tokenMetadata?.encryptedAtRest ? " / encrypted at rest" : ""}</p>` : ""}
        ${history.length ? `
          <div class="mini-history">
            ${history.slice(0, 4).map((run) => `
              <span>${escapeHtml(humanize(run.status))}: ${escapeHtml(formatDate(run.completedAt || run.startedAt))} / ${run.importedAssignments || 0}+${run.updatedAssignments || 0} assignments${run.errorCount ? ` / ${run.errorCount} issue(s)` : ""}</span>
            `).join("")}
          </div>
        ` : ""}
      </details>
    ` : ""}
  `;
}

function classroomStatusCard() {
  const connector = classroomStatus?.connector || runtimeConfig.classroom || {};
  const summary = classroomStatus?.syncSummary || connector.syncSummary || null;
  const history = classroomStatus?.syncHistory || connector.syncHistory || [];
  const providerEmail = connector.providerAccountEmail || connector.tokenMetadata?.providerAccountEmail || "";
  const lastSync = connector.lastSyncAt || history[0]?.completedAt || "";
  const classroomCourses = state.courses.filter((course) => course.source === "google_classroom").length;
  const classroomAssignments = state.assignments.filter((assignment) => assignment.source === "google_classroom").length;
  const safeError = connector.lastError || history.find((run) => run.errorSummary)?.errorSummary || "";
  const safeErrorCode = connector.lastErrorCode || history.find((run) => run.payload?.errorCode)?.payload?.errorCode || "";
  const emptyClassroom = summary?.emptyClassroom || history.some((run) => run.payload?.emptyClassroom);
  return `
    <article class="course-card course-workspace-card classroom-import-card" data-color="sky">
      <header class="course-card-head">
        <div>
          <span class="workspace-label">Connector workspace</span>
          <strong>Google Classroom import</strong>
          <p>${providerEmail ? `Connected as ${escapeHtml(providerEmail)}` : "Read-only Classroom connector"}</p>
        </div>
      </header>
      <div class="tag-row">
        ${tag(classroomModeLabel(connector.state || connector.mode || "disconnected"), ["expired", "error"].includes(connector.state) ? "urgent" : "source")}
        ${tag(`${classroomCourses} course(s)`, "source")}
        ${tag(`${classroomAssignments} assignment(s)`, "source")}
        ${tag(connector.readOnlyImport === false ? "not ready" : "read only", "source")}
        ${tag(connector.writeScopesEnabled ? "write scope risk" : "no write scopes", connector.writeScopesEnabled ? "urgent" : "source")}
        ${lastSync ? tag(`synced ${formatDate(lastSync)}`, "source") : tag("manual sync", "medium")}
        ${tag("no writeback", "urgent")}
      </div>
      <div class="course-signal-grid">
        <span><strong>${classroomCourses}</strong> imported courses</span>
        <span><strong>${classroomAssignments}</strong> imported assignments</span>
        <span><strong>${lastSync ? formatDate(lastSync) : "Manual"}</strong> sync</span>
      </div>
      ${emptyClassroom ? `<p class="muted-copy">No active Classroom courses or coursework were found yet.</p>` : ""}
      ${safeError ? `<p class="warning-copy">${escapeHtml(safeErrorCode ? `${humanize(safeErrorCode)}: ${safeError}` : safeError)}</p>` : ""}
    </article>
  `;
}

function renderAssignments() {
  if (!state.assignments.length) {
    els.assignmentList.innerHTML = `
      <article class="item-card assignment-card">
        <strong>No assignments yet</strong>
        <p>Connect and sync Google Classroom, or add work from your courses to start the learning loop.</p>
        <div class="item-meta">
          ${tag("Classroom ready", "source")}
          ${tag("no submission", "urgent")}
        </div>
      </article>
    `;
    return;
  }
  const assignments = getDueAssignments();
  els.assignmentList.innerHTML = assignments.map((assignment, index) => {
    const course = courseById(assignment.courseId);
    const insight = assignmentInsightById(assignment.id);
    const isClassroom = assignment.source === "google_classroom";
    const isPrimary = index === 0;
    return `
      <article class="item-card assignment-card ${isPrimary ? "assignment-card-primary" : ""}">
        ${isPrimary ? `<span class="queue-label">Nearest due</span>` : ""}
        <strong>${escapeHtml(assignment.title)}</strong>
        <p>${escapeHtml(course?.title || "Course")} / due ${formatDate(assignment.dueDate)}</p>
        <div class="item-meta">
          ${tag(assignment.status === "due_soon" ? "due soon" : assignment.status, assignment.status === "due_soon" ? "medium" : "low")}
          ${isClassroom ? tag("Google Classroom", "source") : tag(humanize(assignment.source))}
          ${assignment.readOnly ? tag("read only", "source") : ""}
          ${isClassroom ? tag("learning flow ready", "medium") : ""}
          ${assignment.submissionStatus ? tag(humanize(assignment.submissionStatus), "source") : ""}
          ${insight ? tag(humanize(insight.status), toneForCoverage(insight.status)) : ""}
        </div>
        ${insight ? `<p class="muted-copy">${escapeHtml(insight.summary)}</p>` : ""}
        <button class="mini-action" type="button" data-flow-id="${assignment.id}">${isClassroom ? "Analyze assignment" : "Analyze"}</button>
      </article>
    `;
  }).join("");
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
          ${course.readOnly ? tag("Read only", "source") : ""}
          ${isClassroom || course.readOnly ? tag("No submissions or grade changes", "urgent") : ""}
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
  const activeSources = (state.sourceMaterials || []).filter((source) => !source.deletedAt);
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
  if (value === "local_demo") return "Demo session";
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
  const value = String(status || "free").toLowerCase();
  if (value === "free") return "Free plan";
  if (value === "active") return "Active plan";
  if (value === "past_due") return "Payment review needed";
  return humanize(status || "Free plan");
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
    free: "Start with daily planning, course context, and a private source library.",
    pro: "More room for heavier study weeks, deeper source libraries, and advanced workflows.",
    group: "Higher limits for study groups, mentors, or small academic teams.",
    institution: "Institution-scale limits for schools and managed academic programs.",
  };
  return copy[plan.id] || "A StudentOS plan for academic planning and private materials.";
}

function planFeatureBullets(plan) {
  const quotas = plan.quotas || {};
  const bullets = [
    `${usageLimitText(quotas.aiRequestsPerDay, "AI help per day")}`,
    `${usageLimitText(quotas.maxSources, "sources in your library")}`,
    `${usageLimitText(quotas.maxCourses, "courses")}`,
    `${formatBytes(quotas.storageBytes || 0)} private storage`,
  ];
  if (plan.features?.advancedAutomation) bullets.push("Advanced assignment and revision workflows");
  else bullets.push("Core planning, review, and study workflows");
  if (plan.features?.groupSpaces) bullets.push("Group workspace eligibility");
  if (plan.features?.parentTeacherViews) bullets.push("Family and institution access groundwork");
  return bullets.slice(0, 6);
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
  const plan = runtimeConfig.saas?.quotas?.defaultPlan || { id: "free", label: "Free", quotas: {}, features: {} };
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
        status: plan.id === "free" ? "free" : "active",
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
  const plan = quota.plan || { label: "Free", features: {} };
  const limits = quota.quotas || {};
  const usage = quota.usage || {};
  const billing = runtimeConfig.billing || {};
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
      <span><strong>${escapeHtml(plan.label || "Free")}</strong> current plan</span>
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
        <strong>${escapeHtml(plan.label || "Free")}</strong>
        <p>${quota.enforcementEnabled ? "Plan limits are active for this account." : "Limits are visible here, but relaxed for this preview."}</p>
      </div>
      <div class="account-plan-state">
        <span>${billing.liveChargesEnabled ? "Payment launch review required" : "Payments are not active yet"}</span>
        <p>${plan.features?.advancedAutomation ? "Advanced workflows are eligible on this plan." : "Core study workflows are available."}</p>
      </div>
    </div>
    <div class="account-usage-list">
      ${quotaBar("Daily AI help", usage.aiRequestsToday, limits.aiRequestsPerDay || 0)}
      ${quotaBar("Sources", usage.sourceCount, limits.maxSources || 0)}
      ${quotaBar("Courses", usage.courses, limits.maxCourses || 0)}
      ${quotaBar("Study updates", usage.workerJobsToday, limits.workerJobsPerDay || 0)}
      ${quotaBar("Storage", usage.storageBytes, limits.storageBytes || 0, formatBytes)}
    </div>
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

function renderPricing(activePlanId = "free") {
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
        <span>${plan.id === activePlanId ? "Current plan" : "Plan preview"}</span>
        <strong>${escapeHtml(plan.label)}</strong>
        <p>${escapeHtml(planValueStatement(plan))}</p>
      </div>
      <div class="pricing-limit-list" aria-label="${escapeHtml(plan.label)} usage limits">
        <span><strong>${escapeHtml((plan.quotas.aiRequestsPerDay || 0).toLocaleString())}</strong> AI help/day</span>
        <span><strong>${escapeHtml((plan.quotas.maxSources || 0).toLocaleString())}</strong> sources</span>
        <span><strong>${escapeHtml(formatBytes(plan.quotas.storageBytes || 0))}</strong> storage</span>
      </div>
      <ul class="pricing-feature-list">
        ${planFeatureBullets(plan).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
      <button class="${plan.id === activePlanId ? "secondary-button" : "primary-button"} wide pricing-cta" type="button" data-plan-preview="${escapeHtml(plan.id)}">
        ${plan.id === activePlanId ? "Current plan" : `Preview ${escapeHtml(plan.label)}`}
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

async function loadBootstrap() {
  state = await api("/api/bootstrap");
  render();
  if (authSession?.access_token || !runtimeConfig.auth?.enabled) {
    await loadAccountSnapshot();
  } else {
    accountSnapshot = null;
    renderAccount();
  }
  await loadClassroomStatus();
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

  els.aiResponse.innerHTML = `
    <strong>${escapeHtml(result.verb)} result</strong>
    <p>${escapeHtml(result.answer)}</p>
    <div class="tag-row">
      ${result.coverage?.status ? tag(humanize(result.coverage.status), toneForCoverage(result.coverage.status)) : ""}
      ${result.provider ? tag(providerLabel(result.provider), result.provider === "mock" ? "medium" : "source") : ""}
      ${result.grounding?.retrievalMode ? tag(retrievalModeLabel(result.grounding.retrievalMode), "source") : ""}
      ${result.grounding?.insufficientContext ? tag("limited material context", "urgent") : ""}
      ${result.grounding?.confidence?.label ? tag(`${result.grounding.confidence.label} material match`, result.grounding.confidence.lowConfidence ? "urgent" : "source") : ""}
      ${(result.sourceLabels || []).map((source) => tag(source.label, "source")).join("")}
      ${result.webFallback?.allowed ? tag("outside reference shown", "medium") : ""}
    </div>
    ${result.grounding?.insufficiencyReason ? `<p>${escapeHtml(result.grounding.insufficiencyReason)}</p>` : ""}
    ${extra.join("")}
  `;
}

async function runAi(event) {
  event.preventDefault();
  els.aiResponse.innerHTML = `<p>Checking your materials...</p>`;
  try {
    const result = await api("/api/ai/verb", {
      method: "POST",
      body: JSON.stringify({ verb: activeVerb, message: els.aiMessage.value }),
    });
    renderAiPayload(result);
  } catch (error) {
    els.aiResponse.innerHTML = `
      <strong>AI response unavailable</strong>
      <p>${escapeHtml(error.message || "StudentOS could not finish this response. Try again after checking your sources.")}</p>
      <div class="tag-row">
        ${tag("try again", "medium")}
        ${tag("citations not invented", "source")}
      </div>
    `;
  }
}

async function createContract() {
  const selectedId = els.flowAssignmentSelect.value || state.assignments[0]?.id;
  const assignment = assignmentById(selectedId) || state.assignments[0];
  els.contractResult.innerHTML = `<p>Checking assignment readiness...</p>`;
  const result = await api("/api/assignment-contract", {
    method: "POST",
    body: JSON.stringify({ assignmentId: assignment.id }),
  });
  els.contractResult.innerHTML = `
    <strong>${escapeHtml(humanize(result.contract.status))}</strong>
    <p>${escapeHtml(result.contract.rationale)}</p>
    <div class="tag-row">
      ${tag(`${result.contract.availableCredits} credits`, "source")}
      ${tag("review required", "medium")}
      ${tag("no submission", "urgent")}
    </div>
  `;
}

function renderFlow(flow) {
  els.flowResult.innerHTML = `
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
  `;
  renderLesson(flow.lesson);
}

async function analyzeAssignmentFlow(assignmentId) {
  els.flowResult.innerHTML = `<p>Checking coverage and next learning step...</p>`;
  try {
    const result = await api("/api/assignment-flow", {
      method: "POST",
      body: JSON.stringify({ assignmentId }),
    });
    renderFlow(result.flow);
    await loadBootstrap();
  } catch (error) {
    els.flowResult.innerHTML = `
      <strong>Assignment flow unavailable</strong>
      <p>${escapeHtml(error.message || "StudentOS could not analyze this assignment. Refresh synced data and try again.")}</p>
      <div class="tag-row">
        ${tag("try again", "medium")}
        ${tag("no submission", "urgent")}
      </div>
    `;
  }
}

async function submitAssignmentFlow(event) {
  event.preventDefault();
  await analyzeAssignmentFlow(new FormData(event.currentTarget).get("assignmentId"));
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

  els.scoreResult.innerHTML = `
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
  `;
  renderLesson(result.tutorLesson);
  await loadBootstrap();
}

async function draftExtension(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const result = await api("/api/extension/draft", {
    method: "POST",
    body: JSON.stringify({
      assignmentId: form.get("assignmentId"),
      reason: form.get("reason"),
    }),
  });
  els.extensionResult.innerHTML = `
    <strong>Draft recommendation: ${escapeHtml(humanize(result.draft.recommendation))}</strong>
    <p>${escapeHtml(result.draft.explanation)}</p>
    <div class="tag-row">
      ${tag("draft only", "source")}
      ${tag("student review required", "medium")}
      ${result.draft.safeguards.map((item) => tag(humanize(item), "source")).join("")}
    </div>
  `;
}

async function addSource(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  if (!form.get("file") || !form.get("file").name) {
    els.sourceResult.innerHTML = `<p>Choose a file first.</p>`;
    return;
  }
  els.sourceResult.innerHTML = `<p>Uploading to private source library...</p>`;
  try {
    const result = await api("/api/sources/upload", {
      method: "POST",
      body: form,
    });
    els.sourceResult.innerHTML = `
      <strong>${escapeHtml(result.material.title)}</strong>
      <p>${escapeHtml(result.material.extractionSummary || result.extractionSummary || "Private source registered.")}</p>
      ${result.material.extractionError ? `<p>${escapeHtml(humanize(result.material.extractionError))}</p>` : ""}
      <div class="tag-row">${tag("Private", "source")}${tag(sourceStatusLabel(result.material.status || result.status))}${tag(indexedSectionsLabel(result.material.chunkCount || result.chunkCount || 0), "source")}${tag("Private to your account", "source")}</div>
    `;
    await loadBootstrap();
  } catch (error) {
    els.sourceResult.innerHTML = `
      <strong>Source upload unavailable</strong>
      <p>${escapeHtml(error.message || "StudentOS could not finish this source upload. Check storage and try again.")}</p>
      <div class="tag-row">
        ${tag("try again", "medium")}
        ${tag("Private", "source")}
        ${tag("Private to your account", "source")}
      </div>
    `;
  }
}

async function deleteSource(sourceId) {
  els.sourceResult.innerHTML = `<p>Deleting private source...</p>`;
  const result = await api(`/api/sources/${encodeURIComponent(sourceId)}`, {
    method: "DELETE",
  });
  els.sourceResult.innerHTML = `
    <strong>Source deleted</strong>
    <p>This source was removed from the active library.</p>
    <div class="tag-row">${tag("Removed privately", "source")}${tag("Private", "source")}</div>
  `;
  await loadBootstrap();
}

async function retrySourceIndex(sourceId) {
  els.sourceResult.innerHTML = `<p>Preparing source refresh...</p>`;
  const result = await api(`/api/sources/${encodeURIComponent(sourceId)}/reindex`, {
    method: "POST",
    body: JSON.stringify({ force: true }),
  });
  els.sourceResult.innerHTML = `
    <strong>${escapeHtml(result.deduped ? "Source refresh already planned" : "Source refresh started")}</strong>
    <p>StudentOS will refresh this source privately.</p>
    <div class="tag-row">${tag(sourceStatusLabel(result.job.status), "source")}${tag("Handled privately", "source")}</div>
  `;
  await loadBootstrap();
}

async function retryFailedJobs() {
  els.sourceResult.innerHTML = `<p>Retrying source issues...</p>`;
  const result = await api("/api/jobs/retry-failed", {
    method: "POST",
    body: JSON.stringify({}),
  });
  els.sourceResult.innerHTML = `
    <strong>${escapeHtml(`${result.retried} source issue(s) retried`)}</strong>
    <div class="tag-row">${tag("Refresh planned", "source")}${tag("Handled privately", "source")}</div>
  `;
  await loadBootstrap();
}

function formJson(form) {
  return Object.fromEntries([...new FormData(form).entries()]);
}

function renderOnboardingResult(result) {
  const onboarding = result.onboarding;
  els.onboardingResult.innerHTML = `
    <strong>${escapeHtml(onboarding.courses.length)} course roadmap generated</strong>
    <p>${escapeHtml(`Goal: ${humanize(onboarding.academicGoal)} / ${onboarding.studyBreakPattern.label} study cycle`)}</p>
    <div class="tag-row">
      ${tag(`${onboarding.exams.length} exams`, "source")}
      ${tag(`${onboarding.weakTopics.length} weak topics`, onboarding.weakTopics.length ? "medium" : "source")}
      ${tag(`${onboarding.roadmap.filter((item) => item.status === "open").length} roadmap items`, "source")}
    </div>
  `;
}

async function submitOnboarding(event) {
  event.preventDefault();
  els.onboardingResult.innerHTML = `<p>Building your academic roadmap...</p>`;
  const result = await api("/api/onboarding", {
    method: "POST",
    body: JSON.stringify(formJson(event.currentTarget)),
  });
  state = result.state;
  renderOnboardingResult(result);
  render();
  setView("today");
}

async function seedDemoProfile() {
  els.onboardingResult.innerHTML = `<p>Loading demo student profile...</p>`;
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
  els.consentResult.innerHTML = `<p>Saving privacy preferences...</p>`;
  const result = await api("/api/account/consent", {
    method: "POST",
    body: JSON.stringify(consentPayloadFromForm(event.currentTarget)),
  });
  accountSnapshot = result.account;
  els.consentResult.innerHTML = `
    <strong>Consent preferences saved</strong>
    <div class="tag-row">
      ${tag(result.consent.aiPersonalization ? "personalization on" : "personalization off", "source")}
      ${tag(result.consent.externalProgressSharing ? "external sharing on" : "student-only progress", result.consent.externalProgressSharing ? "medium" : "source")}
    </div>
  `;
  renderAccount();
}

async function acceptCurrentLegalTerms() {
  if (!els.legalAcceptCheck.checked) {
    els.legalResult.innerHTML = `<p>Confirm the checkbox before recording acceptance.</p>`;
    return;
  }
  els.legalResult.innerHTML = `<p>Recording your acceptance...</p>`;
  const result = await api("/api/account/legal/accept", {
    method: "POST",
    body: JSON.stringify({ accepted: true, acceptanceSource: "account_settings" }),
  });
  accountSnapshot = result.account;
  els.legalResult.innerHTML = `
    <strong>Acceptance recorded</strong>
    <p>Your current terms and privacy notice acceptance is saved.</p>
    <div class="tag-row">
      ${tag(policyVersionNote(result.acceptance.privacyVersion, "Privacy notice"), "source")}
      ${tag(policyVersionNote(result.acceptance.termsVersion, "Terms"), "source")}
    </div>
  `;
  renderAccount();
}

async function requestConsentWithdrawal() {
  els.consentResult.innerHTML = `<p>Creating consent review request...</p>`;
  const result = await api("/api/account/consent/withdrawal-request", {
    method: "POST",
    body: JSON.stringify({ consentKey: "externalProgressSharing" }),
  });
  accountSnapshot = result.account;
  els.consentResult.innerHTML = `
    <strong>Consent review request recorded</strong>
    <p>StudentOS recorded a review request for external progress sharing. No sharing changes until the request is reviewed.</p>
    <div class="tag-row">${tag("review request", "medium")}${tag("no sharing change yet", "source")}</div>
    ${requestReference(result.request.id)}
  `;
  renderAccount();
}

async function requestDataExport() {
  els.accountActionResult.innerHTML = `<p>Preparing your data export request...</p>`;
  try {
    const result = await api("/api/account/export-request", {
      method: "POST",
      body: JSON.stringify({ scope: "student_owned_data" }),
    });
    accountSnapshot = result.account;
    els.accountActionResult.innerHTML = `
      <strong>Export request created</strong>
      <p>Your export is being prepared. StudentOS will package your account data for authenticated download when it is ready.</p>
      <div class="tag-row">${tag("Export being prepared", "medium")}${tag("Handled privately", "source")}</div>
      ${requestReference(result.request.id)}
    `;
    renderAccount();
  } catch (error) {
    els.accountActionResult.innerHTML = `
      <strong>Export request unavailable</strong>
      <p>${escapeHtml(error.message || "StudentOS could not create this export request. Try again after checking account persistence.")}</p>
      <div class="tag-row">${tag("try again", "medium")}${tag("handled privately", "source")}</div>
    `;
  }
}

async function downloadReadyExport(requestId) {
  els.accountActionResult.innerHTML = `<p>Preparing your private export download...</p>`;
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
  els.accountActionResult.innerHTML = `
    <strong>Private export downloaded</strong>
    <p>The package was streamed through your authenticated StudentOS session.</p>
    <div class="tag-row">${tag("private stream", "source")}${tag("short-lived access", "source")}</div>
  `;
  await loadAccountSnapshot();
}

async function requestAccountDeletion() {
  els.accountActionResult.innerHTML = `<p>Preparing account deletion request...</p>`;
  const result = await api("/api/account/deletion-request", {
    method: "POST",
    body: JSON.stringify({ reason: "student_request_from_account_settings" }),
  });
  accountSnapshot = result.account;
  els.accountActionResult.innerHTML = `
    <strong>Deletion request recorded</strong>
    <p>Grace period active until ${escapeHtml(formatDate(result.request.gracePeriodEndsAt))}. No data has been deleted yet, and the request stays in private review.</p>
    <div class="tag-row">${tag("No data deleted yet", "urgent")}${tag("Private review", "medium")}${tag("Handled privately", "source")}</div>
    ${requestReference(result.request.id)}
  `;
  renderAccount();
}

async function requestDeletionDryRun(requestId) {
  els.accountActionResult.innerHTML = `<p>Preparing a deletion safety preview...</p>`;
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
  els.accountActionResult.innerHTML = `
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
  `;
  renderAccount();
}

async function previewGuardianGroundwork() {
  els.invitationResult.innerHTML = `<p>Checking family and institution sharing safeguards...</p>`;
  const result = await api("/api/account/invitations/guardian-preview", {
    method: "POST",
    body: JSON.stringify({ explicitStudentConsent: false }),
  });
  els.invitationResult.innerHTML = `
    <strong>${escapeHtml(familyAccessLabel(result.invitation.status))}</strong>
    <p>No family, guardian, teacher, or institution access was enabled. Student consent is required before sharing is turned on.</p>
    <div class="tag-row">
      ${tag("student consent required", "source")}
      ${tag(result.invitation.enabled ? "enabled" : "inactive", result.invitation.enabled ? "medium" : "source")}
    </div>
    ${requestReference(result.invitation.id)}
  `;
  await loadAccountSnapshot();
}

async function previewPlanUpgrade(planId = "pro") {
  els.accountActionResult.innerHTML = `<p>Preparing billing preview...</p>`;
  const result = await api("/api/billing/checkout-preview", {
    method: "POST",
    body: JSON.stringify({ planId }),
  });
  els.accountActionResult.innerHTML = `
    <strong>${escapeHtml(billingStatusLabel(result.status))}</strong>
    <p>${escapeHtml(billingPreviewCopy(result))}</p>
    <div class="tag-row">
      ${tag(humanize(result.planId), "source")}
      ${tag(result.redirectAllowed ? "checkout preview ready" : "no payment opened", result.redirectAllowed ? "medium" : "source")}
    </div>
  `;
}

async function previewBillingManagement() {
  els.accountActionResult.innerHTML = `<p>Preparing billing management preview...</p>`;
  const result = await api("/api/billing/manage-preview", {
    method: "POST",
    body: JSON.stringify({}),
  });
  els.accountActionResult.innerHTML = `
    <strong>${escapeHtml(billingStatusLabel(result.status))}</strong>
    <p>${escapeHtml(billingPreviewCopy(result, "manage"))}</p>
    <div class="tag-row">
      ${tag(result.redirectAllowed ? "billing portal preview ready" : "no payment portal opened", result.redirectAllowed ? "medium" : "source")}
    </div>
  `;
}

async function connectClassroom() {
  els.classroomPanel.innerHTML = `<p>Preparing read-only Classroom connection...</p>`;
  const result = await api("/api/classroom/oauth/start", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (result.authorizationUrl) {
    window.location.href = result.authorizationUrl;
    return;
  }
  classroomStatus = { connector: result.connector, syncSummary: null };
  renderClassroomPanel();
}

async function syncClassroom() {
  els.classroomPanel.innerHTML = `<p>Syncing Classroom in read-only mode...</p>`;
  const result = await api("/api/classroom/sync", {
    method: "POST",
    body: JSON.stringify({}),
  });
  state = result.state || state;
  classroomStatus = { connector: result.connector, syncSummary: result.summary, syncHistory: result.connector?.syncHistory || [] };
  render();
}

async function disconnectClassroom() {
  els.classroomPanel.innerHTML = `<p>Disconnecting Classroom...</p>`;
  const result = await api("/api/classroom/disconnect", {
    method: "POST",
    body: JSON.stringify({}),
  });
  classroomStatus = { connector: result.connector, syncSummary: null };
  renderClassroomPanel();
}

function wireEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  els.aiLauncher.addEventListener("click", () => openAiDrawer());
  els.aiCloseBtn.addEventListener("click", () => closeAiDrawer());
  els.aiScrim.addEventListener("click", () => closeAiDrawer());
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
  document.getElementById("refresh-btn").addEventListener("click", loadBootstrap);
  els.classroomConnectBtn.addEventListener("click", () => {
    connectClassroom().catch(renderClassroomError);
  });
  els.classroomSyncBtn.addEventListener("click", () => {
    syncClassroom().catch(renderClassroomError);
  });
  els.classroomDisconnectBtn.addEventListener("click", () => {
    disconnectClassroom().catch(renderClassroomError);
  });
  document.getElementById("contract-btn").addEventListener("click", createContract);
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
    seedDemoProfile().catch((error) => {
      els.onboardingResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    });
  });
  els.sourceList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-source-id]");
    if (button) {
      deleteSource(button.dataset.deleteSourceId).catch((error) => {
        els.sourceResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
      });
    }
    const reindexButton = event.target.closest("[data-reindex-source-id]");
    if (reindexButton) {
      retrySourceIndex(reindexButton.dataset.reindexSourceId).catch((error) => {
        els.sourceResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
      });
    }
    const retryFailedButton = event.target.closest("[data-retry-failed-jobs]");
    if (retryFailedButton) {
      retryFailedJobs().catch((error) => {
        els.sourceResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
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
      els.passwordResetResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    });
  });
  els.verificationResendForm.addEventListener("submit", (event) => {
    event.preventDefault();
    requestVerificationResend(new FormData(event.currentTarget).get("email")).catch((error) => {
      els.verificationResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    });
  });
  els.legalAcceptBtn.addEventListener("click", () => {
    acceptCurrentLegalTerms().catch((error) => {
      els.legalResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    });
  });
  els.consentForm.addEventListener("submit", (event) => {
    submitConsent(event).catch((error) => {
      els.consentResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    });
  });
  els.consentWithdrawBtn.addEventListener("click", () => {
    requestConsentWithdrawal().catch((error) => {
      els.consentResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    });
  });
  els.exportRequestBtn.addEventListener("click", () => {
    requestDataExport().catch((error) => {
      els.accountActionResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    });
  });
  els.deletionRequestBtn.addEventListener("click", () => {
    requestAccountDeletion().catch((error) => {
      els.accountActionResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    });
  });
  els.accountLifecycleStatus.addEventListener("click", (event) => {
    const downloadButton = event.target.closest("[data-download-export-id]");
    if (downloadButton) {
      downloadReadyExport(downloadButton.dataset.downloadExportId).catch((error) => {
        els.accountActionResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
      });
    }
    const dryRunButton = event.target.closest("[data-deletion-dry-run-id]");
    if (dryRunButton) {
      requestDeletionDryRun(dryRunButton.dataset.deletionDryRunId).catch((error) => {
        els.accountActionResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
      });
    }
  });
  els.guardianPreviewBtn.addEventListener("click", () => {
    previewGuardianGroundwork().catch((error) => {
      els.invitationResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    });
  });
  els.upgradeBtn.addEventListener("click", () => {
    previewPlanUpgrade("pro").catch((error) => {
      els.accountActionResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    });
  });
  els.manageBillingBtn.addEventListener("click", () => {
    previewBillingManagement().catch((error) => {
      els.accountActionResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    });
  });
  els.pricingPanel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-plan-preview]");
    if (!button || button.textContent.trim() === "Current plan") return;
    previewPlanUpgrade(button.dataset.planPreview).catch((error) => {
      els.accountActionResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    });
  });
  els.aiForm.addEventListener("submit", runAi);
  els.assignmentList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-flow-id]");
    if (button) {
      setView("studio");
      els.flowAssignmentSelect.value = button.dataset.flowId;
      analyzeAssignmentFlow(button.dataset.flowId).catch((error) => {
        els.flowResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
      });
    }
  });
}

wireEvents();
loadRuntimeConfig()
  .then(() => {
    if (authGateActive()) return null;
    return loadBootstrap();
  })
  .catch((error) => {
    els.aiResponse.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  });
