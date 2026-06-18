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

const els = {
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
  authForm: document.getElementById("auth-form"),
  signupBtn: document.getElementById("signup-btn"),
  passwordResetBtn: document.getElementById("password-reset-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  authSession: document.getElementById("auth-session"),
  authHelp: document.getElementById("auth-help"),
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
  pricingPanel: document.getElementById("pricing-panel"),
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
      ${tag("safe error", "medium")}
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
    els.authSession.textContent = "Local demo";
    els.authHelp.textContent = "Local mode keeps account actions scaffolded without contacting Supabase Auth.";
    return;
  }
  if (authSession?.access_token) {
    els.authForm.hidden = true;
    els.logoutBtn.hidden = false;
    els.authSession.textContent = authSession.user?.email || authSession.email || "Signed in";
    els.authHelp.textContent = "Session active. Account settings and export requests stay backend-mediated.";
    return;
  }
  els.authForm.hidden = false;
  els.logoutBtn.hidden = true;
  els.authSession.textContent = message || "Auth ready";
  els.authHelp.textContent = "Sign up may require email verification depending on the StudentOS Auth project settings.";
}

async function signInWithPassword(event) {
  event.preventDefault();
  renderAuth("Signing in...");
  const session = await authRequest("/token?grant_type=password", {
    email: els.authEmail.value,
    password: els.authPassword.value,
  });
  storeSession(session);
  renderAuth();
  await loadBootstrap();
}

async function signUpWithPassword() {
  renderAuth("Creating account...");
  const session = await authRequest("/signup", {
    email: els.authEmail.value,
    password: els.authPassword.value,
  });
  if (session.access_token) {
    storeSession(session);
    await loadBootstrap();
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
  await loadBootstrap();
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
      ${tag(result.resetEmailRequested ? "reset email requested" : "scaffold", result.resetEmailRequested ? "source" : "medium")}
      ${tag("no secrets exposed", "source")}
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
      ${tag(result.verificationEmailRequested ? "verification email requested" : "scaffold", result.verificationEmailRequested ? "source" : "medium")}
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
  els.connectorStatus.textContent = backendPersistence.mode === "supabase"
    ? "Supabase mode"
    : backendPersistence.mode === "mock"
      ? "Mock mode"
      : humanize(backendPersistence.mode || state.persistence?.mode || "unknown mode");
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
    .sort((left, right) => Date.parse(left.examDate || "") - Date.parse(right.examDate || ""))
    .slice(0, 3);
  const weakTopics = (state.topics || [])
    .filter((topic) => (topic.weakSignals || []).length || topic.mastery === "revision_required")
    .slice(0, 5);
  const openRoadmap = (state.roadmap || []).filter((item) => item.status === "open");
  const completedRoadmap = (state.roadmap || []).filter((item) => item.status === "done" || item.status === "completed");
  const activeSources = (state.sourceMaterials || []).filter((source) => !source.deletedAt);
  els.dashboardSummary.innerHTML = `
    <article class="summary-card">
      <span>Goal</span>
      <strong>${escapeHtml(getAcademicGoalLabel())}</strong>
      <p>${escapeHtml(preferences.stream || state.studentProfile.gradeBand || "Academic plan")}</p>
    </article>
    <article class="summary-card">
      <span>Upcoming exams</span>
      <strong>${escapeHtml(upcomingExams[0] ? formatDate(upcomingExams[0].examDate) : "None")}</strong>
      <p>${escapeHtml(upcomingExams.map((exam) => `${exam.title} ${formatDate(exam.examDate)}`).join(" / ") || "Add exams in setup")}</p>
    </article>
    <article class="summary-card">
      <span>Today focus</span>
      <strong>${escapeHtml(state.todayNextActions?.[0]?.title || "Plan first block")}</strong>
      <p>${escapeHtml(`${preferences.dailyStudyAvailabilityMinutes || preferences.dailyStudyWindowMinutes || 90} min / ${preferences.studyBreakPattern || "25/5"} cycle`)}</p>
    </article>
    <article class="summary-card">
      <span>Weak topics</span>
      <strong>${weakTopics.length}</strong>
      <p>${escapeHtml(weakTopics.map((topic) => topic.title).join(" / ") || "No weak topics yet")}</p>
    </article>
    <article class="summary-card">
      <span>Materials</span>
      <strong>${activeSources.length}</strong>
      <p>${escapeHtml(`${activeSources.filter((source) => source.status === "indexed").length} indexed / ${activeSources.filter((source) => source.status === "needs_ocr").length} need OCR`)}</p>
    </article>
    <article class="summary-card">
      <span>Roadmap</span>
      <strong>${openRoadmap.length} open</strong>
      <p>${escapeHtml(`${completedRoadmap.length} completed / ${state.creditBalance || 0} credits`)}</p>
    </article>
  `;
}

function renderRoadmap() {
  const actions = state.todayNextActions?.length ? state.todayNextActions : state.roadmap;
  els.roadmapList.innerHTML = actions.slice(0, 5).map((item) => {
    const topic = topicById(item.topicId);
    const course = courseById(item.courseId);
    return `
      <article class="item-card">
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.courseTitle || course?.title || "Course")} / ${escapeHtml(item.topicTitle || topic?.title || "Topic")}</p>
        <div class="item-meta">
          ${tag(item.priority, item.priority)}
          ${tag(formatDate(item.dueAt))}
          ${tag(humanize(item.kind))}
          ${item.examPressure ? tag(`Exam pressure: ${item.examPressure}`, item.examPressure === "critical" ? "urgent" : "medium") : ""}
        </div>
      </article>
    `;
  }).join("");
}

function renderTimetable() {
  els.timetableList.innerHTML = state.timetable.map((item) => {
    const course = courseById(item.courseId);
    return `
      <article class="item-card">
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
    <strong>${escapeHtml(humanize(connector.state || connector.mode || "mock"))}</strong>
    <p>StudentOS can read Classroom assignments but cannot submit, grade, turn in, or modify Classroom work.</p>
    ${reconnectCopy}
    <div class="tag-row">
      ${tag(humanize(connector.mode || "mock"), "source")}
      ${tag(connector.readOnlyImport === false ? "not ready" : "read only", "source")}
      ${tag(connector.writeScopesEnabled ? "write scope risk" : "no write scopes", connector.writeScopesEnabled ? "urgent" : "source")}
      ${connector.tokenPersistence ? tag(humanize(connector.tokenPersistence), "source") : ""}
      ${connector.tokenMetadata?.encryptedAtRest ? tag("encrypted tokens", "source") : ""}
      ${lastSync ? tag(`synced ${formatDate(lastSync)}`, "source") : ""}
    </div>
    <p>${providerEmail ? `Account: ${escapeHtml(providerEmail)} / ` : ""}${lastSync ? `Last sync ${escapeHtml(formatDate(lastSync))}` : "Manual sync only"}</p>
    ${safeError ? `<p class="warning-copy">${escapeHtml(safeErrorCode ? `${humanize(safeErrorCode)}: ${safeError}` : safeError)}</p>` : ""}
    ${emptyClassroom ? `<p class="muted-copy">No active Classroom courses or coursework were found. StudentOS is connected and ready; sync again after new Classroom work appears.</p>` : ""}
    ${scopes.length ? `<p class="muted-copy">Scopes: ${scopes.map((scope) => escapeHtml(scope.replace("https://www.googleapis.com/auth/", ""))).join(", ")}</p>` : ""}
    ${summary ? `<p>${escapeHtml(`${summary.importedCourses || 0} course(s), ${summary.importedAssignments || 0} new assignment(s), ${summary.updatedAssignments || 0} updated${summary.emptyClassroom ? " / empty Classroom account" : ""}`)}</p>` : ""}
    ${history.length ? `
      <div class="mini-history">
        ${history.slice(0, 4).map((run) => `
          <span>${escapeHtml(humanize(run.status))}: ${escapeHtml(formatDate(run.completedAt || run.startedAt))} / ${run.importedAssignments || 0}+${run.updatedAssignments || 0} assignments${run.errorCount ? ` / ${run.errorCount} issue(s)` : ""}</span>
        `).join("")}
      </div>
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
    <article class="course-card classroom-import-card" data-color="sky">
      <div>
        <strong>Google Classroom import</strong>
        <p>${providerEmail ? `Connected as ${escapeHtml(providerEmail)}` : "Read-only Classroom connector"}</p>
      </div>
      <div class="tag-row">
        ${tag(humanize(connector.state || connector.mode || "disconnected"), ["expired", "error"].includes(connector.state) ? "urgent" : "source")}
        ${tag(`${classroomCourses} course(s)`, "source")}
        ${tag(`${classroomAssignments} assignment(s)`, "source")}
        ${lastSync ? tag(`synced ${formatDate(lastSync)}`, "source") : tag("manual sync", "medium")}
        ${tag("no writeback", "urgent")}
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
  els.assignmentList.innerHTML = state.assignments.map((assignment) => {
    const course = courseById(assignment.courseId);
    const insight = assignmentInsightById(assignment.id);
    const isClassroom = assignment.source === "google_classroom";
    return `
      <article class="item-card assignment-card">
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
    const topics = state.topics.filter((topic) => topic.courseId === course.id);
    const assignments = state.assignments.filter((assignment) => assignment.courseId === course.id);
    const classroomAssignments = assignments.filter((assignment) => assignment.source === "google_classroom");
    const secureCount = topics.filter((topic) => ["secure", "strong"].includes(topic.mastery)).length;
    const progress = topics.length ? Math.round((secureCount / topics.length) * 100) : 0;
    const isClassroom = course.source === "google_classroom";
    return `
      <article class="course-card" data-color="${escapeHtml(course.color || "mint")}">
        <div>
          <strong>${escapeHtml(course.title)}</strong>
          <p>${escapeHtml(course.teacher)} / exam ${formatDate(course.examDate)}</p>
        </div>
        <div class="progress-track" aria-label="Mastery progress">
          <div class="progress-fill" style="width:${progress}%"></div>
        </div>
        <div class="tag-row">
          ${isClassroom ? tag("Google Classroom", "source") : ""}
          ${course.readOnly ? tag("read only", "source") : ""}
          ${classroomAssignments.length ? tag(`${classroomAssignments.length} imported assignment(s)`, "medium") : ""}
          ${topics.map((topic) => tag(`${topic.title}: ${humanize(topic.mastery)}`, topic.mastery === "revision_required" ? "urgent" : "")).join("")}
        </div>
        ${isClassroom && !classroomAssignments.length ? `<p class="muted-copy">Classroom course imported. Sync again when coursework is published.</p>` : ""}
      </article>
    `;
  }).join("");
  const empty = state.courses.length ? "" : `
    <article class="course-card" data-color="sky">
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
  const queueCard = `
    <article class="source-card">
      <strong>Queue health</strong>
      <p>Background extraction and reindex work is private and backend-run.</p>
      <div class="tag-row">
        ${tag(`${health.counts.queued || 0} queued`, "source")}
        ${tag(`${health.counts.processing || 0} processing`, "source")}
        ${tag(`${health.counts.failed || 0} failed`, (health.counts.failed || 0) ? "urgent" : "source")}
        ${tag(`${health.counts.completed || 0} completed`, "source")}
        ${tag(`${health.averageProcessingAgeSeconds || 0}s avg processing`, "source")}
        ${tag(`${health.stuckJobsCount || 0} stuck`, (health.stuckJobsCount || 0) ? "urgent" : "source")}
      </div>
      ${health.processingJobs?.length ? `<p>${health.processingJobs.map((job) => escapeHtml(`${humanize(job.jobType)} ${job.id}`)).join(", ")}</p>` : ""}
      ${health.failedJobs?.length ? `<p>${health.failedJobs.map((job) => escapeHtml(`${humanize(job.jobType)}: ${humanize(job.lastError || "failed")}`)).join(" / ")}</p>` : ""}
      ${health.failedReasons && Object.keys(health.failedReasons).length ? `<p>${Object.entries(health.failedReasons).map(([reason, count]) => escapeHtml(`${humanize(reason)} (${count})`)).join(" / ")}</p>` : ""}
      <button class="mini-action" type="button" data-retry-failed-jobs>Retry failed</button>
    </article>
  `;
  const sourceCards = state.sourceMaterials.filter((source) => !source.deletedAt).map((source) => {
    const course = courseById(source.courseId);
    const sourceJobs = (state.backgroundJobs || [])
      .filter((job) => job.sourceId === source.id)
      .sort((left, right) => Date.parse(right.updatedAt || right.createdAt || "") - Date.parse(left.updatedAt || left.createdAt || ""));
    const latestJob = sourceJobs[0];
    return `
      <article class="source-card">
        <strong>${escapeHtml(source.title)}</strong>
        <p>${escapeHtml(course?.title || "Course")} / ${escapeHtml(source.filename || humanize(source.kind))}</p>
        <div class="tag-row">
          ${tag(humanize(source.status || source.extractionStatus || source.storageMode))}
          ${source.isPrivate ? tag("private", "source") : tag(humanize(source.storageMode))}
          ${source.mimeType ? tag(source.mimeType) : ""}
          ${source.sizeBytes ? tag(`${Math.round(source.sizeBytes / 1024)} KB`) : ""}
          ${source.chunkCount !== undefined ? tag(`${source.chunkCount} chunks`, "source") : ""}
          ${source.extractionProvider ? tag(source.extractionProvider, "source") : ""}
          ${source.ocrRequired || source.status === "needs_ocr" ? tag("OCR needed", "urgent") : ""}
          ${latestJob ? tag(`${humanize(latestJob.jobType)} ${humanize(latestJob.status)}`, latestJob.status === "failed" ? "urgent" : "source") : ""}
          ${source.webFallbackAllowed ? tag("web fallback labeled", "source") : tag("material only")}
        </div>
        ${source.extractionSummary ? `<p>${escapeHtml(source.extractionSummary)}</p>` : ""}
        ${source.extractionError ? `<p>${escapeHtml(humanize(source.extractionError))}</p>` : ""}
        ${source.extractedSnippet ? `<p>${escapeHtml(source.extractedSnippet)}</p>` : ""}
        ${source.id ? `<p>${escapeHtml((state.sourceChunks || []).filter((chunk) => chunk.sourceMaterialId === source.id && chunk.embeddingStatus === "embedded").length)} embedded chunk(s)</p>` : ""}
        ${latestJob?.lastError ? `<p>${escapeHtml(humanize(latestJob.lastError))}</p>` : ""}
        <button class="mini-action" type="button" data-reindex-source-id="${source.id}">Retry index</button>
        <button class="mini-action" type="button" data-delete-source-id="${source.id}">Delete</button>
      </article>
    `;
  }).join("");
  els.sourceList.innerHTML = queueCard + sourceCards;
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
        <p>${escapeHtml(account.user?.email || "No email session")} / ${escapeHtml(humanize(account.user?.authMode || "local_demo"))}</p>
      </div>
    </div>
    <div class="tag-row">
      ${tag(plan.label || "Free", "source")}
      ${tag(account.user?.emailVerified ? "email verified" : "verification ready", account.user?.emailVerified ? "source" : "medium")}
      ${tag(humanize(account.profile?.role || "student"), "source")}
      ${tag(humanize(account.profile?.visibility?.defaultAudience || "student_only"), "source")}
      ${tag(`subscription ${humanize(quota.subscription?.status || "free")}`, quota.subscription?.status === "past_due" ? "medium" : "source")}
      ${quota.subscription?.renewalAt ? tag(`renews ${formatDate(quota.subscription.renewalAt)}`, "source") : ""}
    </div>
    <p>Progress visibility is student-only by default. Future parent, teacher, and institution views require explicit consent and scoped roles.</p>
  `;
  els.quotaPanel.innerHTML = `
    <div class="plan-card">
      <strong>${escapeHtml(plan.label || "Free")} plan</strong>
      <p>${quota.enforcementEnabled ? "Quota enforcement is active." : "Quota enforcement is configured but relaxed for this environment."}</p>
      <div class="tag-row">
        ${plan.features?.essentialLearning ? tag("essential learning included", "source") : ""}
        ${plan.features?.advancedAutomation ? tag("advanced automation", "source") : tag("automation limited", "medium")}
        ${plan.features?.groupSpaces ? tag("group spaces", "source") : ""}
        ${tag(billing.provider || "none", "source")}
        ${tag(billing.liveChargesEnabled ? "launch review required" : "payments inactive", "medium")}
      </div>
    </div>
    ${quotaBar("AI requests", usage.aiRequestsToday, limits.aiRequestsPerDay || 0)}
    ${quotaBar("Sources", usage.sourceCount, limits.maxSources || 0)}
    ${quotaBar("Courses", usage.courses, limits.maxCourses || 0)}
    ${quotaBar("Worker jobs", usage.workerJobsToday, limits.workerJobsPerDay || 0)}
    ${quotaBar("Storage", usage.storageBytes, limits.storageBytes || 0, formatBytes)}
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
      <div class="tag-row">
        ${tag(legal.privacyVersion || "privacy version pending", "source")}
        ${tag(legal.termsVersion || "terms version pending", "source")}
        ${tag(legal.accepted ? "accepted" : "acceptance needed", legal.accepted ? "source" : "medium")}
      </div>
    `;
  }
  if (els.accountLifecycleStatus) {
    const latestExport = exports[0];
    const latestJob = exportJobs.find((job) => job.exportRequestId === latestExport?.id);
    const latestDeletion = deletions[0];
    els.accountLifecycleStatus.innerHTML = `
      <article class="lifecycle-item">
        <strong>Latest export</strong>
        <p>${latestExport ? `${escapeHtml(humanize(latestExport.status))} / ${escapeHtml(humanize(latestJob?.status || "queued"))}` : "No export requests yet."}</p>
        ${latestExport?.downloadAvailable ? `<button class="mini-action" type="button" data-download-export-id="${escapeHtml(latestExport.id)}">Download private export</button>` : ""}
      </article>
      <article class="lifecycle-item">
        <strong>Deletion review</strong>
        <p>${latestDeletion ? `${escapeHtml(humanize(latestDeletion.status))} / grace period until ${escapeHtml(formatDate(latestDeletion.gracePeriodEndsAt))}` : "No deletion requests."}</p>
        ${latestDeletion ? `<button class="mini-action danger-action" type="button" data-deletion-dry-run-id="${escapeHtml(latestDeletion.id)}">Preview deletion dry run</button>` : ""}
      </article>
      <article class="lifecycle-item">
        <strong>Future roles</strong>
        <p>${invitations.length ? `${invitations.length} preview record(s), still disabled by default.` : "Guardian, teacher, and institution roles are inactive."}</p>
      </article>
    `;
  }
}

function renderPricing(activePlanId = "free") {
  if (!els.pricingPanel) return;
  const plans = runtimeConfig.billing?.plans || runtimeConfig.saas?.billing?.plans || [];
  els.pricingPanel.innerHTML = plans.map((plan) => `
    <article class="pricing-card ${plan.id === activePlanId ? "active" : ""}">
      <div>
        <strong>${escapeHtml(plan.label)}</strong>
        <p>${escapeHtml(plan.features.advancedAutomation ? "Higher limits with advanced convenience workflows." : "Essential StudentOS learning tools with safe starter limits.")}</p>
      </div>
      <div class="tag-row">
        ${tag(`${plan.quotas.aiRequestsPerDay} AI/day`, "source")}
        ${tag(`${plan.quotas.maxSources} sources`, "source")}
        ${tag(formatBytes(plan.quotas.storageBytes), "source")}
        ${plan.features.groupSpaces ? tag("group spaces", "source") : ""}
      </div>
      <button class="${plan.id === activePlanId ? "secondary-button" : "primary-button"} wide" type="button" data-plan-preview="${escapeHtml(plan.id)}">
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
      ${result.provider ? tag(result.provider, result.provider === "mock" ? "medium" : "source") : ""}
      ${result.modelUsed ? tag(result.modelUsed, "source") : ""}
      ${result.grounding?.retrievalMode ? tag(result.grounding.retrievalMode, "source") : ""}
      ${result.grounding?.insufficientContext ? tag("limited source context", "urgent") : ""}
      ${result.grounding?.confidence?.label ? tag(`${result.grounding.confidence.label} retrieval`, result.grounding.confidence.lowConfidence ? "urgent" : "source") : ""}
      ${(result.sourceLabels || []).map((source) => tag(source.label, "source")).join("")}
      ${result.webFallback?.allowed ? tag(result.webFallback.label, "medium") : ""}
    </div>
    ${result.grounding?.insufficiencyReason ? `<p>${escapeHtml(result.grounding.insufficiencyReason)}</p>` : ""}
    ${extra.join("")}
  `;
}

async function runAi(event) {
  event.preventDefault();
  els.aiResponse.innerHTML = `<p>Thinking with source context...</p>`;
  try {
    const result = await api("/api/ai/verb", {
      method: "POST",
      body: JSON.stringify({ verb: activeVerb, message: els.aiMessage.value }),
    });
    renderAiPayload(result);
  } catch (error) {
    els.aiResponse.innerHTML = `
      <strong>AI response unavailable</strong>
      <p>${escapeHtml(error.message || "StudentOS could not finish this grounded response. Try again after checking source indexing.")}</p>
      <div class="tag-row">
        ${tag("safe error", "medium")}
        ${tag("citations not invented", "source")}
      </div>
    `;
  }
}

async function createContract() {
  const selectedId = els.flowAssignmentSelect.value || state.assignments[0]?.id;
  const assignment = assignmentById(selectedId) || state.assignments[0];
  els.contractResult.innerHTML = `<p>Checking contract...</p>`;
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
    <strong>${escapeHtml(humanize(flow.coverage.status))}: ${escapeHtml(humanize(flow.action))}</strong>
    <p>${escapeHtml(flow.nextAction)}</p>
    <div class="tag-row">
      ${tag("student review required", "medium")}
      ${tag("no real submission", "urgent")}
      ${flow.testSession ? tag(`${flow.testSession.questions.length} MCQs`, "source") : tag("lesson before test", "medium")}
    </div>
    <strong>Topic coverage</strong>
    ${list(flow.coverage.topicCoverages.map((coverage) => `${coverage.title}: ${humanize(coverage.status)} (${coverage.reasons.join(", ") || "no signal"})`))}
    <strong>Roadmap update</strong>
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
        ${tag("safe error", "medium")}
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
    <strong>${result.result.scorePercent}% / ${result.result.creditsAwarded} credit(s)</strong>
    <p>${escapeHtml(result.scoreSummary)}</p>
    <strong>Corrections</strong>
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
    <strong>${escapeHtml(humanize(result.draft.recommendation))}</strong>
    <p>${escapeHtml(result.draft.explanation)}</p>
    <div class="tag-row">${result.draft.safeguards.map((item) => tag(humanize(item), "source")).join("")}</div>
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
      <div class="tag-row">${tag("private", "source")}${tag(result.material.status || result.status)}${tag(`${result.material.chunkCount || result.chunkCount || 0} chunks`, "source")}${tag("not public", "urgent")}</div>
    `;
    await loadBootstrap();
  } catch (error) {
    els.sourceResult.innerHTML = `
      <strong>Source upload unavailable</strong>
      <p>${escapeHtml(error.message || "StudentOS could not finish this source upload. Check storage and try again.")}</p>
      <div class="tag-row">
        ${tag("safe error", "medium")}
        ${tag("private", "source")}
        ${tag("not public", "urgent")}
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
    <p>${escapeHtml(result.sourceId)} was removed from the active library.</p>
    <div class="tag-row">${tag("private delete", "source")}${tag("not public", "urgent")}</div>
  `;
  await loadBootstrap();
}

async function retrySourceIndex(sourceId) {
  els.sourceResult.innerHTML = `<p>Queueing source reindex...</p>`;
  const result = await api(`/api/sources/${encodeURIComponent(sourceId)}/reindex`, {
    method: "POST",
    body: JSON.stringify({ force: true }),
  });
  els.sourceResult.innerHTML = `
    <strong>${escapeHtml(result.deduped ? "Reindex already queued" : "Reindex queued")}</strong>
    <p>${escapeHtml(result.job.id)}</p>
    <div class="tag-row">${tag(humanize(result.job.status), "source")}${tag(humanize(result.job.jobType), "source")}</div>
  `;
  await loadBootstrap();
}

async function retryFailedJobs() {
  els.sourceResult.innerHTML = `<p>Retrying failed jobs...</p>`;
  const result = await api("/api/jobs/retry-failed", {
    method: "POST",
    body: JSON.stringify({}),
  });
  els.sourceResult.innerHTML = `
    <strong>${escapeHtml(`${result.retried} failed job(s) retried`)}</strong>
    <div class="tag-row">${tag(`${result.queueHealth?.counts?.queued || 0} queued`, "source")}${tag("backend only", "source")}</div>
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
    <p>${escapeHtml(result.acceptance.privacyVersion)} / ${escapeHtml(result.acceptance.termsVersion)}</p>
  `;
  renderAccount();
}

async function requestConsentWithdrawal() {
  els.consentResult.innerHTML = `<p>Creating consent withdrawal request...</p>`;
  const result = await api("/api/account/consent/withdrawal-request", {
    method: "POST",
    body: JSON.stringify({ consentKey: "externalProgressSharing" }),
  });
  accountSnapshot = result.account;
  els.consentResult.innerHTML = `
    <strong>Withdrawal request recorded</strong>
    <p>${escapeHtml(humanize(result.request.consentKey))} / ${escapeHtml(humanize(result.request.status))}</p>
    <div class="tag-row">${tag("review scaffold", "medium")}${tag("no external action", "source")}</div>
  `;
  renderAccount();
}

async function requestDataExport() {
  els.accountActionResult.innerHTML = `<p>Creating data export request...</p>`;
  try {
    const result = await api("/api/account/export-request", {
      method: "POST",
      body: JSON.stringify({ scope: "student_owned_data" }),
    });
    accountSnapshot = result.account;
    els.accountActionResult.innerHTML = `
      <strong>Export request created</strong>
      <p>${escapeHtml(result.request.id)} / ${escapeHtml(humanize(result.request.status))}</p>
      <div class="tag-row">${tag("queued for private packaging", "medium")}${tag("backend only", "source")}</div>
    `;
    renderAccount();
  } catch (error) {
    els.accountActionResult.innerHTML = `
      <strong>Export request unavailable</strong>
      <p>${escapeHtml(error.message || "StudentOS could not create this export request. Try again after checking account persistence.")}</p>
      <div class="tag-row">${tag("safe error", "medium")}${tag("backend only", "source")}</div>
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
  els.accountActionResult.innerHTML = `<p>Creating account deletion request...</p>`;
  const result = await api("/api/account/deletion-request", {
    method: "POST",
    body: JSON.stringify({ reason: "student_request_from_account_settings" }),
  });
  accountSnapshot = result.account;
  els.accountActionResult.innerHTML = `
    <strong>Deletion request recorded</strong>
    <p>${escapeHtml(result.request.id)} / grace period until ${escapeHtml(formatDate(result.request.gracePeriodEndsAt))}</p>
    <div class="tag-row">${tag("no immediate deletion", "urgent")}${tag("manual review", "medium")}${tag("backend only", "source")}</div>
  `;
  renderAccount();
}

async function requestDeletionDryRun(requestId) {
  els.accountActionResult.innerHTML = `<p>Generating a read-only deletion preview...</p>`;
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
    <strong>Deletion dry run ready</strong>
    <p>No rows or files were deleted. This preview covers ${escapeHtml(summary.databaseRows || 0)} database row(s) and ${escapeHtml(summary.storageObjects || 0)} private storage object(s). ${escapeHtml(diffCopy)}</p>
    <div class="tag-row">
      ${tag(`${summary.sourceChunks || 0} chunks`, "source")}
      ${tag(`${summary.memoryItems || 0} memory items`, "source")}
      ${tag(`${summary.embeddingMetadata || 0} embeddings`, "source")}
      ${tag(`${summary.backgroundJobs || 0} jobs`, "source")}
      ${tag("destructive actions disabled", "urgent")}
    </div>
  `;
  renderAccount();
}

async function previewGuardianGroundwork() {
  els.invitationResult.innerHTML = `<p>Checking guardian invitation groundwork...</p>`;
  const result = await api("/api/account/invitations/guardian-preview", {
    method: "POST",
    body: JSON.stringify({ explicitStudentConsent: false }),
  });
  els.invitationResult.innerHTML = `
    <strong>${escapeHtml(humanize(result.invitation.status))}</strong>
    <p>${escapeHtml(result.message)}</p>
    <div class="tag-row">
      ${tag("student consent required", "source")}
      ${tag(result.invitation.enabled ? "enabled" : "inactive", result.invitation.enabled ? "medium" : "source")}
    </div>
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
    <strong>${escapeHtml(humanize(result.status))}</strong>
    <p>${escapeHtml(result.message)}</p>
    <div class="tag-row">
      ${tag(humanize(result.provider), "source")}
      ${tag(humanize(result.planId), "source")}
      ${tag(result.redirectAllowed ? "redirect allowed" : "no payment redirect", result.redirectAllowed ? "medium" : "source")}
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
    <strong>${escapeHtml(humanize(result.status))}</strong>
    <p>${escapeHtml(result.message)}</p>
    <div class="tag-row">
      ${tag(humanize(result.provider), "source")}
      ${tag(result.redirectAllowed ? "redirect allowed" : "no provider redirect", result.redirectAllowed ? "medium" : "source")}
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
  els.authForm.addEventListener("submit", signInWithPassword);
  els.signupBtn.addEventListener("click", () => {
    signUpWithPassword().catch((error) => renderAuth(error.message));
  });
  els.passwordResetBtn.addEventListener("click", () => {
    setView("account");
    requestPasswordReset(els.authEmail.value, els.passwordResetResult).catch((error) => {
      els.passwordResetResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
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
  .then(loadBootstrap)
  .catch((error) => {
    els.aiResponse.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  });
