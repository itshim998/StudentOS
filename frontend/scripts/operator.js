const API_BASE = window.StudentOSConfig?.apiBase || "";
const PUBLIC_FRONTEND_HOSTS = new Set([
  "studentos.sentiqlabs.com",
  "studentos-39s.pages.dev",
]);
const API_BASE_MISCONFIGURED_MESSAGE = "API base URL misconfigured. Cloudflare Pages must set STUDENTOS_PUBLIC_API_BASE_URL to the Azure backend URL.";
const els = {
  form: document.getElementById("operator-query-form"),
  userId: document.getElementById("operator-user-id"),
  operatorId: document.getElementById("operator-id"),
  token: document.getElementById("operator-token"),
  result: document.getElementById("operator-result"),
  exports: document.getElementById("operator-exports"),
  deletions: document.getElementById("operator-deletions"),
  evidence: document.getElementById("operator-evidence"),
  audit: document.getElementById("operator-audit"),
  billingEvents: document.getElementById("operator-billing-events"),
  monitoringBtn: document.getElementById("operator-monitoring-btn"),
  monitoring: document.getElementById("operator-monitoring"),
  cleanupBtn: document.getElementById("operator-cleanup-btn"),
  cleanupResult: document.getElementById("operator-cleanup-result"),
  mfaChallengeBtn: document.getElementById("operator-mfa-challenge-btn"),
  mfaVerifyBtn: document.getElementById("operator-mfa-verify-btn"),
  mfaCode: document.getElementById("operator-mfa-code"),
  mfaResult: document.getElementById("operator-mfa-result"),
  alerts: document.getElementById("operator-alerts"),
};

let snapshot = null;
let operatorSession = null;
let mfaChallenge = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[character]));
}

function humanize(value) {
  return String(value || "").replace(/_/g, " ");
}

function headers() {
  return {
    "Content-Type": "application/json",
    ...(operatorSession?.token ? { Authorization: `Bearer ${operatorSession.token}` } : {}),
  };
}

function apiUrl(path) {
  if (!API_BASE && PUBLIC_FRONTEND_HOSTS.has(window.location.hostname)) {
    throw new Error(API_BASE_MISCONFIGURED_MESSAGE);
  }
  return `${API_BASE}${path}`;
}

async function readJsonResponse(response, fallbackMessage) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const looksHtml = contentType.includes("text/html") || /^\s*<!doctype\s+html/i.test(text) || /^\s*<html[\s>]/i.test(text);
  if (looksHtml) throw new Error(API_BASE_MISCONFIGURED_MESSAGE);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(fallbackMessage);
  }
}

async function internalApi(path, options = {}) {
  const response = await fetch(apiUrl(path), { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const body = await readJsonResponse(response, `StudentOS API returned invalid JSON for ${path}.`).catch((error) => ({ error: error.message }));
  if (response.status === 401 || response.status === 403) operatorSession = null;
  if (!response.ok) throw new Error(body.error || `Request failed with ${response.status}`);
  return body;
}

async function authorizeOperator() {
  const response = await fetch(apiUrl("/api/internal/operator/session"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-StudentOS-Internal-Token": els.token.value,
    },
    body: JSON.stringify({ operatorId: els.operatorId.value.trim() }),
  });
  const body = await readJsonResponse(response, "StudentOS API returned invalid JSON for operator authorization.").catch((error) => ({ error: error.message }));
  els.token.value = "";
  if (!response.ok) throw new Error(body.error || `Authorization failed with ${response.status}`);
  operatorSession = {
    token: body.sessionToken,
    operator: body.operator,
    expiresAt: body.expiresAt,
    operatorMfa: body.operatorMfa,
  };
  return operatorSession;
}

async function createMfaChallenge() {
  const result = await internalApi("/api/internal/operator/mfa/challenge", { method: "POST", body: "{}" });
  mfaChallenge = result.challenge;
  return result;
}

async function verifyMfa() {
  if (!mfaChallenge?.challengeId) throw new Error("Create an MFA challenge first");
  const result = await internalApi("/api/internal/operator/mfa/verify", {
    method: "POST",
    body: JSON.stringify({
      challengeId: mfaChallenge.challengeId,
      code: els.mfaCode.value,
    }),
  });
  operatorSession = {
    token: result.sessionToken,
    operator: result.operator,
    expiresAt: result.expiresAt,
  };
  els.mfaCode.value = "";
  return result;
}

function summaryTags(summary = {}) {
  return [
    `${summary.databaseRows || 0} rows`,
    `${summary.storageObjects || 0} files`,
    `${summary.sourceChunks || 0} source sections`,
    `${summary.memoryItems || 0} study records`,
  ].map((label) => `<span class="tag source">${escapeHtml(label)}</span>`).join("");
}

function diffText(diff = {}) {
  if (diff.baseline) return "Baseline dry run";
  if (!diff.changed) return "No affected-count changes since prior dry run";
  const changed = Object.entries(diff.summaryDelta || {})
    .filter(([, value]) => Number(value) !== 0)
    .map(([key, value]) => `${humanize(key)} ${Number(value) > 0 ? "+" : ""}${value}`)
    .join(", ");
  return changed || "Affected counts changed";
}

function render() {
  const requests = snapshot?.exportRequests || [];
  const reviews = snapshot?.deletionReviews || [];
  const evidence = snapshot?.deletionEvidence || [];
  const safety = snapshot?.finalDeletionSafety || {};
  els.exports.innerHTML = requests.length
    ? requests.map((request) => `
      <article class="operator-item">
        <strong>${escapeHtml(request.id)}</strong>
        <p>${escapeHtml(humanize(request.status))} / ${escapeHtml(request.requestedAt || "")}</p>
      </article>`).join("")
    : `<p class="muted-copy">No export requests for this user.</p>`;
  els.deletions.innerHTML = (snapshot?.deletionRequests || []).length
    ? snapshot.deletionRequests.map((request) => {
      const dryRun = request.dryRunReport || {};
      const requestReviews = reviews.filter((review) => review.deletionRequestId === request.id);
      const approvals = new Set(requestReviews
        .filter((review) => review.decision === "approve_scaffold")
        .map((review) => review.operatorId)).size;
      return `
        <article class="operator-item">
          <strong>${escapeHtml(request.id)}</strong>
          <p>${escapeHtml(humanize(request.status))} / ${escapeHtml(diffText(dryRun.diff))}</p>
          <div class="tag-row">${summaryTags(dryRun.summary)}</div>
          <p>${escapeHtml(`${approvals}/${safety.requiredApprovals || 2} distinct approvals / ${requestReviews.length} review event(s) recorded`)}</p>
          <form class="operator-review-form" data-request-id="${escapeHtml(request.id)}">
            <label>Operator note<textarea name="note" required rows="3"></textarea></label>
            <label>Decision<select name="decision"><option value="approve_scaffold">Record approval scaffold</option><option value="reject">Reject request</option></select></label>
            <button class="secondary-button" type="submit">Record review</button>
          </form>
          <form class="operator-execute-form" data-request-id="${escapeHtml(request.id)}">
            <label>Execution note<textarea name="note" required rows="3"></textarea></label>
            <label><input name="acknowledgeLargeDiff" type="checkbox"> Acknowledge an unexpectedly large dry-run diff after review</label>
            <label><input name="billingWaiverAcknowledged" type="checkbox"> Request a manually evidenced billing-cancellation waiver</label>
            <label>Billing waiver evidence<textarea name="billingWaiverNote" rows="3"></textarea></label>
            <button class="secondary-button danger-action" type="submit">Run guarded execution check</button>
          </form>
        </article>`;
    }).join("")
    : `<p class="muted-copy">No deletion requests for this user.</p>`;
  els.evidence.innerHTML = evidence.length
    ? evidence.map((item) => `
      <article class="operator-item">
        <strong>${escapeHtml(humanize(item.evidenceType))}</strong>
        <p>${escapeHtml(humanize(item.status))} / ${escapeHtml(item.createdAt || "")}</p>
        <div class="tag-row">${summaryTags(item.affectedCounts)}</div>
      </article>`).join("")
    : `<p class="muted-copy">No immutable deletion evidence recorded for this user.</p>`;
  els.audit.innerHTML = (snapshot?.operatorAuditEvents || []).length
    ? snapshot.operatorAuditEvents.map((event) => `
      <article class="operator-item">
        <strong>${escapeHtml(humanize(event.action))}</strong>
        <p>${escapeHtml(event.operatorRole || "")} / ${escapeHtml(event.createdAt || "")}</p>
      </article>`).join("")
    : `<p class="muted-copy">No operator audit events recorded for this user.</p>`;
  els.billingEvents.innerHTML = (snapshot?.billingCancellationEvents || []).length
    ? snapshot.billingCancellationEvents.map((event) => `
      <article class="operator-item">
        <strong>${escapeHtml(humanize(event.status))}</strong>
        <p>${escapeHtml(event.createdAt || "")}</p>
      </article>`).join("")
    : `<p class="muted-copy">No billing-cancellation evaluations recorded for this user.</p>`;
  els.alerts.innerHTML = (snapshot?.monitoringAlertEvents || []).length
    ? snapshot.monitoringAlertEvents.map((event) => `
      <article class="operator-item">
        <strong>${escapeHtml(humanize(event.alertType))}</strong>
        <p>${escapeHtml(event.severity || "")} / ${escapeHtml(event.createdAt || "")}</p>
      </article>`).join("")
    : `<p class="muted-copy">No monitoring alerts recorded for this user.</p>`;
}

async function loadSnapshot() {
  const userId = encodeURIComponent(els.userId.value.trim());
  snapshot = await internalApi(`/api/internal/account-ops?userId=${userId}`);
  els.result.innerHTML = `<strong>Internal review loaded</strong><p>Final deletion remains disabled.</p>`;
  render();
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const session = await authorizeOperator();
    els.result.innerHTML = `<strong>Short-lived session authorized</strong><p>${escapeHtml(session.operator.role)} / expires ${escapeHtml(session.expiresAt)}</p>`;
    await loadSnapshot();
  } catch (error) {
    els.result.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
});

els.deletions.addEventListener("submit", (event) => {
  const form = event.target.closest(".operator-review-form");
  if (!form) return;
  event.preventDefault();
  const body = Object.fromEntries(new FormData(form).entries());
  const userId = encodeURIComponent(els.userId.value.trim());
  internalApi(`/api/internal/account-deletions/${encodeURIComponent(form.dataset.requestId)}/review?userId=${userId}`, {
    method: "POST",
    body: JSON.stringify(body),
  }).then(loadSnapshot).catch((error) => {
    els.result.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  });
});

els.deletions.addEventListener("submit", (event) => {
  const form = event.target.closest(".operator-execute-form");
  if (!form) return;
  event.preventDefault();
  const userId = encodeURIComponent(els.userId.value.trim());
  internalApi(`/api/internal/account-deletions/${encodeURIComponent(form.dataset.requestId)}/execute?userId=${userId}`, {
    method: "POST",
    body: JSON.stringify({
      note: form.elements.note?.value || "",
      acknowledgeLargeDiff: Boolean(form.elements.acknowledgeLargeDiff?.checked),
      billingWaiver: {
        acknowledged: Boolean(form.elements.billingWaiverAcknowledged?.checked),
        note: form.elements.billingWaiverNote?.value || "",
      },
    }),
  }).then((result) => {
    els.result.innerHTML = result.executed
      ? `<strong>Deletion execution completed</strong><p>Review immutable evidence immediately.</p>`
      : `<strong>Execution refused safely</strong><p>${escapeHtml((result.blockers || []).map(humanize).join(", "))}</p>`;
    return loadSnapshot();
  }).catch((error) => {
    els.result.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  });
});

els.cleanupBtn.addEventListener("click", () => {
  els.cleanupResult.innerHTML = `<p>Cleaning expired private export packages...</p>`;
  internalApi("/api/internal/exports/retention-cleanup", {
    method: "POST",
    body: JSON.stringify({ limit: 100, note: "Expired export retention cleanup requested from the operator console." }),
  }).then((result) => {
    els.cleanupResult.innerHTML = `<strong>${escapeHtml(result.cleaned.length)} export package(s) cleaned</strong><p>Source materials were not touched.</p>`;
  }).catch((error) => {
    els.cleanupResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  });
});

els.monitoringBtn.addEventListener("click", () => {
  const userId = encodeURIComponent(els.userId.value.trim());
  els.monitoring.innerHTML = `<p>Loading redacted monitoring status...</p>`;
  internalApi(`/api/internal/monitoring/status?userId=${userId}`).then((result) => {
    els.monitoring.innerHTML = `
      <strong>${result.ok ? "Services reported safely" : "Status unavailable"}</strong>
      <p>${escapeHtml(result.authProject?.mode || "unknown")} / ${escapeHtml(result.dataShards?.length || 0)} data shards / StudentOS billing / MFA ${escapeHtml(result.operatorMfa?.required ? "required" : "not required")}</p>`;
  }).catch((error) => {
    els.monitoring.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  });
});

els.mfaChallengeBtn.addEventListener("click", () => {
  els.mfaResult.innerHTML = `<p>Creating MFA challenge...</p>`;
  createMfaChallenge().then((result) => {
    els.mfaResult.innerHTML = `
      <strong>${escapeHtml(humanize(result.challenge.status))}</strong>
      <p>${escapeHtml((result.challenge.methods || []).join(", "))} / expires ${escapeHtml(result.challenge.expiresAt || "")}</p>`;
  }).catch((error) => {
    els.mfaResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  });
});

els.mfaVerifyBtn.addEventListener("click", () => {
  els.mfaResult.innerHTML = `<p>Verifying MFA...</p>`;
  verifyMfa().then((result) => {
    els.mfaResult.innerHTML = `<strong>MFA verified</strong><p>Session refreshed until ${escapeHtml(result.expiresAt || "")}</p>`;
  }).catch((error) => {
    els.mfaResult.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  });
});
