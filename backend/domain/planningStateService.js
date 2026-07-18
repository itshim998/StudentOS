export function markPlanningStateStale(state, reason = "planning_context_changed", { now = new Date(), clearPlan = true } = {}) {
  state.studentProfile = state.studentProfile || { id: "student_unknown", preferences: {} };
  const previous = state.studentProfile.planningState || {};
  state.studentProfile.planningState = {
    status: "stale",
    revision: Number(previous.revision || 0) + 1,
    changedAt: now.toISOString(),
    changeReason: String(reason || "planning_context_changed").slice(0, 80),
    plannedAt: null,
  };
  if (clearPlan) state.studentProfile.dailyTodoPlan = null;
  else if (state.studentProfile.dailyTodoPlan) state.studentProfile.dailyTodoPlan.planning_stale = true;
  return state.studentProfile.planningState;
}

export function markPlanningStateCurrent(state, plan, { now = new Date() } = {}) {
  state.studentProfile = state.studentProfile || { id: "student_unknown", preferences: {} };
  const previous = state.studentProfile.planningState || {};
  const revision = Number(previous.revision || 0);
  if (plan) plan.planning_revision = revision;
  state.studentProfile.planningState = {
    status: "current",
    revision,
    changedAt: previous.changedAt || now.toISOString(),
    changeReason: previous.changeReason || null,
    plannedAt: now.toISOString(),
  };
  return state.studentProfile.planningState;
}
