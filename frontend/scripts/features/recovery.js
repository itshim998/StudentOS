const ACTIVE_RUN_STATUSES = new Set(["queued", "preparing", "reviewing", "planning"]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function operationId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `recovery-${prefix}-${random}`;
}

function formatDateTime(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(parsed));
}

function safeStoredId(value) {
  const normalized = String(value || "").trim();
  return SAFE_ID.test(normalized) ? normalized : null;
}

function safeSessionRecord(value) {
  if (!value || typeof value !== "object") return {};
  return {
    runId: safeStoredId(value.runId),
    previewId: safeStoredId(value.previewId),
    analyzeKey: safeStoredId(value.analyzeKey),
    applyKey: safeStoredId(value.applyKey),
    rejectKey: safeStoredId(value.rejectKey),
  };
}

function errorCopy(error) {
  const code = String(error?.code || "");
  if (["RECOVERY_ENGINE_DISABLED", "RECOVERY_UI_DISABLED", "RECOVERY_SESSION_REQUIRED"].includes(code)) {
    return { kind: "inaccessible", title: "Plan adjustment is not available", copy: "Your current plan has not changed.", retryable: false };
  }
  if (["RECOVERY_SETUP_REQUIRED", "RECOVERY_PLAN_UNAVAILABLE"].includes(code)) {
    return { kind: "inaccessible", title: "Plan adjustment is not available here", copy: "Your current plan has not changed.", retryable: false };
  }
  if (code === "RECOVERY_CONTEXT_INSUFFICIENT") {
    return { kind: "failed", title: "More academic context is needed", copy: "Add or prepare your coursework, deadlines, or study evidence, then try again. Your current plan is unchanged.", retryable: false };
  }
  if (code === "RECOVERY_ALLOWANCE_EXHAUSTED") {
    return { kind: "failed", title: "Plan review is unavailable right now", copy: "You can keep using today’s plan and request another review after your planning allowance refreshes.", retryable: false };
  }
  if (code === "RECOVERY_RATE_LIMITED") {
    return { kind: "failed", title: "Plan review is busy right now", copy: "Your current plan is unchanged. Wait a moment, then try again.", retryable: true };
  }
  if (["RECOVERY_PREVIEW_STALE", "RECOVERY_PREVIEW_ALREADY_APPLIED"].includes(code)) {
    return { kind: "stale", title: "This plan review is no longer current", copy: "Your academic information or today’s plan changed. Request a fresh review before applying anything.", retryable: true };
  }
  return {
    kind: "failed",
    title: "StudentOS could not finish this plan review",
    copy: "Your current plan is unchanged. Check your connection and try again when you’re ready.",
    retryable: error?.retryable !== false,
  };
}

function planSummaryMarkup(label, plan = {}) {
  const minutes = Number(plan.totalMinutes || 0);
  const tasks = Number(plan.taskCount || 0);
  return `
    <section class="recovery-plan-summary">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(`${tasks} ${tasks === 1 ? "task" : "tasks"}`)}</strong>
      <p>${escapeHtml(minutes ? `${minutes} planned minutes` : "No planned minutes")}</p>
    </section>
  `;
}

function changeDetail(change) {
  const before = change?.before || {};
  const after = change?.after || {};
  if (change?.type === "task_moved") return [before.scheduledStart, after.scheduledStart].filter(Boolean).join(" → ");
  if (change?.type === "duration_changed") return `${Number(before.durationMinutes || 0)} min → ${Number(after.durationMinutes || 0)} min`;
  if (change?.type === "priority_changed") return [before.priority, after.priority].filter(Boolean).join(" → ");
  return after.durationMinutes ? `${Number(after.durationMinutes)} min` : before.durationMinutes ? `${Number(before.durationMinutes)} min` : "";
}

function changeGroupMarkup(label, changes = [], open = false) {
  if (!changes.length) return "";
  return `
    <details class="recovery-change-group" ${open ? "open" : ""}>
      <summary>${escapeHtml(label)} <span>${changes.length}</span></summary>
      <div class="recovery-change-list">
        ${changes.map((change) => `
          <article class="recovery-change-item">
            <div>
              <strong>${escapeHtml(change.title || "Study task")}</strong>
              <p>${escapeHtml(change.explanation || "This change keeps today’s plan focused.")}</p>
            </div>
            ${changeDetail(change) ? `<span>${escapeHtml(changeDetail(change))}</span>` : ""}
          </article>
        `).join("")}
      </div>
    </details>
  `;
}

function previewChangesMarkup(changes = {}) {
  const groups = [
    ["Added tasks", changes.added || []],
    ["Moved tasks", changes.moved || []],
    ["Duration or priority changes", changes.adjusted || []],
    ["Reassessments", changes.reassessments || []],
    ["Deferred for later", changes.deferred || []],
    ["Important notes", changes.warnings || []],
  ];
  const firstWithItems = groups.findIndex(([, items]) => items.length);
  const markup = groups.map(([label, items], index) => changeGroupMarkup(label, items, index === firstWithItems)).join("");
  return markup || '<p class="recovery-empty-changes">No changes to today’s task order are needed.</p>';
}

export function createRecoveryFeature({
  entryRoot,
  dialog,
  contentRoot,
  closeButton,
  api,
  getAccess,
  getContextKey,
  onApplied,
  pollIntervalMs = 1500,
  maxPolls = 80,
} = {}) {
  let access = { status: "disabled", available: false };
  let contextKey = "";
  let returnFocus = null;
  let pollTimer = null;
  let pollController = null;
  let pollGeneration = 0;
  let pollCount = 0;
  let networkFailures = 0;
  let actionInFlight = false;
  let confirmingApply = false;
  let status = "idle";
  let run = null;
  let preview = null;
  let failure = null;
  let stored = {};

  function storageKey() {
    return contextKey ? `studentos.recovery.v1:${encodeURIComponent(contextKey)}` : "";
  }

  function readStored() {
    if (!storageKey()) return {};
    try {
      return safeSessionRecord(JSON.parse(sessionStorage.getItem(storageKey()) || "{}"));
    } catch {
      return {};
    }
  }

  function writeStored() {
    if (!storageKey()) return;
    try {
      sessionStorage.setItem(storageKey(), JSON.stringify(safeSessionRecord(stored)));
    } catch {
      // Recovery continues in memory when session storage is unavailable.
    }
  }

  function clearStored() {
    if (storageKey()) {
      try {
        sessionStorage.removeItem(storageKey());
      } catch {
        // No-op: storage is an optional refresh convenience.
      }
    }
    stored = {};
  }

  function stopPolling() {
    pollGeneration += 1;
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = null;
    pollController?.abort();
    pollController = null;
  }

  function renderEntry() {
    if (!entryRoot) return;
    const visible = access.available === true;
    entryRoot.hidden = !visible;
    if (!visible) {
      entryRoot.replaceChildren();
      return;
    }
    const pending = Boolean(stored.runId || stored.previewId);
    entryRoot.innerHTML = `
      <button id="recovery-open-btn" class="recovery-entry-button" type="button" aria-haspopup="dialog" aria-controls="recovery-dialog">
        <span>
          <strong>${escapeHtml(pending ? "Continue plan review" : "Adjust today’s plan")}</strong>
          <small>${escapeHtml(pending ? "A previous review is ready to continue." : "Review missed work, deadlines, and the time you have left.")}</small>
        </span>
        <span aria-hidden="true">→</span>
      </button>
    `;
  }

  function renderIdle() {
    return `
      <section class="recovery-state recovery-idle-state">
        <p class="eyebrow">Plan review</p>
        <h3>Review what needs adjusting</h3>
        <p>StudentOS can review missed work, weak-topic evidence, deadlines, and the study time you have available. Nothing changes until you review and confirm a proposal.</p>
        <button class="primary-button" type="button" data-recovery-action="analyze">Review my plan</button>
      </section>
    `;
  }

  function renderProgress() {
    const reviewing = status === "reviewing" || status === "planning";
    return `
      <section class="recovery-state recovery-progress-state" role="status" aria-live="polite">
        <span class="recovery-spinner" aria-hidden="true"></span>
        <p class="eyebrow">Plan review</p>
        <h3>${escapeHtml(reviewing ? "Reviewing your study evidence and planning" : "Preparing your plan review")}</h3>
        <p>${escapeHtml(reviewing ? "StudentOS is comparing what changed with today’s current plan." : "StudentOS is gathering the academic information needed for a careful proposal.")}</p>
        <ol class="recovery-progress-list" aria-label="Plan review progress">
          <li class="is-complete">Prepare the review</li>
          <li class="${reviewing ? "is-active" : ""}">Review evidence and deadlines</li>
          <li>Build a proposal for you to review</li>
        </ol>
      </section>
    `;
  }

  function renderPreview() {
    const expiry = formatDateTime(preview?.expiresAt);
    const evidence = preview?.evidenceSummary || {};
    return `
      <section class="recovery-state recovery-ready-state">
        <p class="eyebrow">Ready for review</p>
        <h3>Review the proposed plan</h3>
        <p>${escapeHtml(preview?.summary || "A focused update is ready for review.")}</p>
        <p class="recovery-evidence-summary">Based on ${Number(evidence.supportingItemCount || 0)} supporting ${Number(evidence.supportingItemCount || 0) === 1 ? "item" : "items"} across ${Number(evidence.topicCount || 0)} ${Number(evidence.topicCount || 0) === 1 ? "topic" : "topics"}.</p>
        <div class="recovery-plan-comparison" aria-label="Current and proposed plan summary">
          ${planSummaryMarkup("Current plan", preview?.currentPlan)}
          ${planSummaryMarkup("Proposed plan", preview?.proposedPlan)}
        </div>
        <div class="recovery-change-groups">
          ${previewChangesMarkup(preview?.changes)}
        </div>
        ${expiry ? `<p class="recovery-expiry">Review available until ${escapeHtml(expiry)}.</p>` : ""}
        ${confirmingApply ? `
          <div class="recovery-confirmation" role="alert">
            <strong>Update Today’s plan?</strong>
            <p>This will update only your StudentOS plan for Today. It will not change Classroom or submit assignments.</p>
            <div class="recovery-actions">
              <button class="primary-button" type="button" data-recovery-action="confirm-apply" ${actionInFlight ? "disabled" : ""}>${actionInFlight ? "Updating…" : "Update Today’s plan"}</button>
              <button class="secondary-button" type="button" data-recovery-action="cancel-apply" ${actionInFlight ? "disabled" : ""}>Keep reviewing</button>
            </div>
          </div>
        ` : `
          <div class="recovery-actions">
            <button class="primary-button" type="button" data-recovery-action="apply" ${actionInFlight || preview?.applyAvailable === false ? "disabled" : ""}>Apply changes</button>
            <button class="secondary-button" type="button" data-recovery-action="reject" ${actionInFlight || preview?.rejectAvailable === false ? "disabled" : ""}>Keep current plan</button>
          </div>
        `}
      </section>
    `;
  }

  function renderTerminal() {
    const copyByStatus = {
      applied: ["Plan updated", "Today now shows the plan you approved. You can request another review later if your academic information changes."],
      rejected: ["Current plan kept", "No proposed changes were applied. You can request a fresh review later."],
      stale: ["This plan review is no longer current", "Your academic information or Today’s plan changed. Request a fresh review before applying anything."],
      expired: ["This plan review expired", "Your current plan is unchanged. Request a fresh review when you’re ready."],
      inaccessible: [failure?.title || "Plan adjustment is unavailable", failure?.copy || "Your current plan has not changed."],
      failed: [failure?.title || "StudentOS could not finish this plan review", failure?.copy || "Your current plan is unchanged. Try again when you’re ready."],
    };
    const [title, copy] = copyByStatus[status] || copyByStatus.failed;
    const canRetry = ["rejected", "stale", "expired"].includes(status) || (status === "failed" && failure?.retryable !== false);
    return `
      <section class="recovery-state recovery-terminal-state" role="status" aria-live="polite">
        <p class="eyebrow">Plan review</p>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(copy)}</p>
        ${canRetry ? '<button class="primary-button" type="button" data-recovery-action="fresh">Start a fresh review</button>' : ""}
      </section>
    `;
  }

  function render() {
    if (!contentRoot) return;
    if (status === "idle") contentRoot.innerHTML = renderIdle();
    else if (ACTIVE_RUN_STATUSES.has(status)) contentRoot.innerHTML = renderProgress();
    else if (status === "ready") contentRoot.innerHTML = renderPreview();
    else contentRoot.innerHTML = renderTerminal();
  }

  function schedulePoll(callback, delay = pollIntervalMs) {
    pollTimer = window.setTimeout(callback, Math.max(250, delay));
  }

  async function loadPreview(previewId, generation) {
    if (!previewId || generation !== pollGeneration || !dialog?.open) return;
    const response = await api(`/api/recovery/previews/${encodeURIComponent(previewId)}`, { signal: pollController?.signal });
    if (generation !== pollGeneration) return;
    preview = response.preview;
    stored.previewId = safeStoredId(preview?.id);
    writeStored();
    if (preview?.status === "ready_for_review" && preview?.applyAvailable !== false) status = "ready";
    else if (preview?.status === "applied") status = "applied";
    else if (preview?.status === "rejected") status = "rejected";
    else if (preview?.status === "expired") status = "expired";
    else status = "stale";
    stopPolling();
    renderEntry();
    render();
  }

  function startPolling() {
    stopPolling();
    const generation = pollGeneration;
    pollCount = 0;
    networkFailures = 0;
    const poll = async () => {
      if (generation !== pollGeneration || !dialog?.open || !stored.runId) return;
      if (pollCount >= maxPolls) {
        stopPolling();
        failure = { title: "This plan review is taking longer than expected", copy: "Your current plan is unchanged. Close this view and try again later.", retryable: true };
        status = "failed";
        render();
        return;
      }
      pollCount += 1;
      pollController = new AbortController();
      try {
        const response = await api(`/api/recovery/runs/${encodeURIComponent(stored.runId)}`, { signal: pollController.signal });
        if (generation !== pollGeneration) return;
        run = response.run;
        networkFailures = 0;
        const runStatus = run?.status;
        if (ACTIVE_RUN_STATUSES.has(runStatus)) {
          status = runStatus;
          render();
          schedulePoll(poll);
          return;
        }
        if (runStatus === "ready_for_review" && run.previewId) {
          stored.previewId = safeStoredId(run.previewId);
          writeStored();
          await loadPreview(stored.previewId, generation);
          return;
        }
        stopPolling();
        if (runStatus === "applied") status = "applied";
        else if (runStatus === "rejected") status = "rejected";
        else if (runStatus === "superseded") status = "stale";
        else {
          failure = errorCopy({ code: run?.error?.code, retryable: run?.error?.retryable });
          status = failure.kind;
        }
        render();
      } catch (error) {
        if (error?.name === "AbortError" || generation !== pollGeneration) return;
        networkFailures += 1;
        if (networkFailures <= 3) {
          schedulePoll(poll, pollIntervalMs * networkFailures);
          return;
        }
        stopPolling();
        failure = errorCopy(error);
        status = failure.kind;
        render();
      }
    };
    poll();
  }

  async function resumeStoredReview() {
    if (stored.previewId) {
      stopPolling();
      const generation = pollGeneration;
      pollController = new AbortController();
      try {
        await loadPreview(stored.previewId, generation);
      } catch (error) {
        if (error?.name === "AbortError") return;
        stored.previewId = null;
        writeStored();
        if (stored.runId) startPolling();
      }
      return;
    }
    if (stored.runId) startPolling();
  }

  async function analyze() {
    if (actionInFlight || !access.available) return;
    actionInFlight = true;
    failure = null;
    status = "preparing";
    render();
    stored.analyzeKey = stored.analyzeKey || operationId("analyze");
    writeStored();
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    try {
      const response = await api("/api/recovery/analyze", {
        method: "POST",
        headers: { "Idempotency-Key": stored.analyzeKey },
        body: JSON.stringify({ currentDate: date, currentTime: time, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }),
      });
      run = response.run;
      stored.runId = safeStoredId(response.runId || run?.id);
      stored.previewId = safeStoredId(run?.previewId);
      writeStored();
      renderEntry();
      if (!stored.runId) throw new Error("Plan review did not return a safe identifier.");
      startPolling();
    } catch (error) {
      failure = errorCopy(error);
      status = failure.kind;
      render();
    } finally {
      actionInFlight = false;
    }
  }

  async function applyPreview() {
    if (actionInFlight || !preview?.id || preview.applyAvailable === false) return;
    actionInFlight = true;
    stored.applyKey = stored.applyKey || operationId(`apply-${preview.id}`);
    writeStored();
    render();
    try {
      const response = await api(`/api/recovery/previews/${encodeURIComponent(preview.id)}/apply`, {
        method: "POST",
        headers: { "Idempotency-Key": stored.applyKey },
        body: "{}",
      });
      preview = response.preview;
      status = "applied";
      confirmingApply = false;
      clearStored();
      renderEntry();
      render();
      await Promise.resolve(onApplied?.()).catch(() => null);
    } catch (error) {
      failure = errorCopy(error);
      status = failure.kind;
      confirmingApply = false;
      render();
    } finally {
      actionInFlight = false;
      render();
    }
  }

  async function rejectPreview() {
    if (actionInFlight || !preview?.id || preview.rejectAvailable === false) return;
    actionInFlight = true;
    stored.rejectKey = stored.rejectKey || operationId(`reject-${preview.id}`);
    writeStored();
    render();
    try {
      const response = await api(`/api/recovery/previews/${encodeURIComponent(preview.id)}/reject`, {
        method: "POST",
        headers: { "Idempotency-Key": stored.rejectKey },
        body: "{}",
      });
      preview = response.preview;
      status = "rejected";
      clearStored();
      renderEntry();
    } catch (error) {
      failure = errorCopy(error);
      status = failure.kind;
    } finally {
      actionInFlight = false;
      render();
    }
  }

  function freshAnalysis() {
    stopPolling();
    clearStored();
    run = null;
    preview = null;
    failure = null;
    confirmingApply = false;
    status = "idle";
    renderEntry();
    render();
    analyze();
  }

  function open(trigger = null) {
    if (!access.available || !dialog) return;
    returnFocus = trigger || document.activeElement;
    if (!dialog.open) dialog.showModal();
    if (stored.runId || stored.previewId) {
      status = "preparing";
      render();
      resumeStoredReview();
    } else {
      status = "idle";
      render();
    }
    window.requestAnimationFrame(() => dialog.querySelector("h2")?.focus({ preventScroll: true }));
  }

  function close({ restoreFocus = true } = {}) {
    stopPolling();
    if (dialog?.open) dialog.close();
    const focusTarget = returnFocus && document.contains(returnFocus)
      ? returnFocus
      : entryRoot?.querySelector("#recovery-open-btn");
    if (restoreFocus && focusTarget && document.contains(focusTarget)) focusTarget.focus({ preventScroll: true });
    returnFocus = null;
  }

  function resetForContext(nextContextKey) {
    stopPolling();
    close({ restoreFocus: false });
    contextKey = nextContextKey;
    stored = readStored();
    run = null;
    preview = null;
    failure = null;
    confirmingApply = false;
    status = "idle";
  }

  function update() {
    const nextContextKey = String(getContextKey?.() || "").trim();
    if (nextContextKey !== contextKey) resetForContext(nextContextKey);
    access = getAccess?.() || { status: "disabled", available: false };
    if (!access.available) {
      stopPolling();
      if (dialog?.open) {
        failure = { title: "Plan adjustment is not available", copy: "Your current plan has not changed.", retryable: false };
        status = "inaccessible";
        render();
      }
    }
    renderEntry();
  }

  entryRoot?.addEventListener("click", (event) => {
    const trigger = event.target.closest("#recovery-open-btn");
    if (trigger) open(trigger);
  });
  closeButton?.addEventListener("click", () => close());
  dialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  contentRoot?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-recovery-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.recoveryAction;
    if (action === "analyze") analyze();
    else if (action === "apply") {
      confirmingApply = true;
      render();
      contentRoot.querySelector('[data-recovery-action="confirm-apply"]')?.focus();
    } else if (action === "cancel-apply") {
      confirmingApply = false;
      render();
      contentRoot.querySelector('[data-recovery-action="apply"]')?.focus();
    } else if (action === "confirm-apply") applyPreview();
    else if (action === "reject") rejectPreview();
    else if (action === "fresh") freshAnalysis();
  });

  update();
  return Object.freeze({ update, close, open, stopPolling });
}
