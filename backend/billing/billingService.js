import { getPlan, getPublicPlanCatalog } from "../saas/plans.js";
import {
  PLAN_KEYS,
  getPlanEntitlements,
  getPublicEntitlementSummary,
  getPublicPlanSummary,
  normalizePlanKey,
} from "../domain/planEntitlementService.js";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);
const WEBHOOK_TYPES = new Set([
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "payment_failed",
]);

function nowIso(now = new Date()) {
  return now.toISOString();
}

function recordId(prefix = "billing") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeText(value, max = 180) {
  return String(value || "").slice(0, max);
}

function safeMetadata(payload = {}) {
  return {
    sourceEventType: safeText(payload.type || payload.event || ""),
    planId: safeText(payload.planId || payload.plan_id || payload.metadata?.planId || payload.metadata?.plan_id || ""),
    providerCustomerId: safeText(payload.providerCustomerId || payload.customerId || payload.customer_id || ""),
    providerSubscriptionId: safeText(payload.providerSubscriptionId || payload.subscriptionId || payload.subscription_id || ""),
  };
}

export function ensureBillingState(state) {
  state.billingSubscriptions = state.billingSubscriptions || [];
  state.billingWebhookEvents = state.billingWebhookEvents || [];
  return state;
}

export function createUnselectedSubscription(userId, now = new Date()) {
  return {
    id: `billing_subscription_${userId}`,
    userId,
    planId: null,
    status: "unselected",
    provider: "none",
    providerCustomerId: null,
    providerSubscriptionId: null,
    renewalAt: null,
    cancelAtPeriodEnd: false,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
  };
}

export function getCurrentSubscription(state, fallbackPlan = null) {
  ensureBillingState(state);
  const latest = [...state.billingSubscriptions]
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt || "") - Date.parse(left.updatedAt || left.createdAt || ""))[0];
  if (latest) return latest;
  const lifecycle = state.studentProfile?.productLifecycle || {};
  const legacyReady = state.studentProfile?.id === "student_demo_001" || lifecycle.state === "dashboard_active";
  const planId = normalizePlanKey(lifecycle.selectedPlanId) ||
    normalizePlanKey(state.studentProfile?.preferences?.billingPlan) ||
    (legacyReady ? normalizePlanKey(fallbackPlan) : null);
  const fallback = createUnselectedSubscription(state.studentProfile.id);
  fallback.planId = planId;
  if (planId && lifecycle.accessMode === "trial" && lifecycle.paymentMethodVerifiedAt) {
    fallback.status = "trialing";
  } else if (planId && (lifecycle.paymentMethodVerifiedAt || legacyReady)) {
    fallback.status = "active";
  } else if (planId) {
    fallback.status = "selected";
  }
  return fallback;
}

export function resolveEntitlements(state, fallbackPlan = null) {
  const subscription = getCurrentSubscription(state, fallbackPlan);
  const lifecycle = state.studentProfile?.productLifecycle || {};
  const selectedPlanKey = normalizePlanKey(lifecycle.selectedPlanId) || normalizePlanKey(subscription.planId);
  const hasPersistedSubscription = (state.billingSubscriptions || []).length > 0;
  const trialAccess = subscription.status === "trialing" ||
    (!hasPersistedSubscription && lifecycle.accessMode === "trial" && Boolean(lifecycle.paymentMethodVerifiedAt));
  const paidAccess = ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status) && subscription.status !== "trialing";
  const activePlanKey = trialAccess
    ? PLAN_KEYS.TRIAL
    : paidAccess && selectedPlanKey !== PLAN_KEYS.TRIAL
      ? selectedPlanKey
      : null;
  const plan = getPlan(activePlanKey);
  const policy = getPlanEntitlements(activePlanKey);
  return {
    subscription: {
      id: subscription.id,
      planId: selectedPlanKey,
      status: subscription.status,
      provider: subscription.provider || "none",
      renewalAt: subscription.renewalAt || null,
      cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
    },
    plan: {
      id: plan.id,
      label: plan.label,
    },
    activePlanKey,
    selectedPlanKey,
    quotas: plan.quotas,
    features: plan.features,
    policy,
  };
}

function normalizeType(payload = {}) {
  const raw = String(payload.type || payload.event || payload.eventType || "")
    .toLowerCase()
    .replace(/[.\s-]+/g, "_");
  const aliases = {
    subscription_created: "subscription_created",
    subscription_updated: "subscription_updated",
    subscription_cancelled: "subscription_cancelled",
    subscription_canceled: "subscription_cancelled",
    payment_failed: "payment_failed",
  };
  return aliases[raw] || raw;
}

export function normalizeProviderWebhook({ provider, payload = {} }) {
  const metadata = payload.metadata || payload.data?.metadata || payload.data?.object?.metadata || {};
  const object = payload.data?.object || payload.data || payload;
  const type = normalizeType(payload);
  const rawPlanId = payload.planId || payload.plan_id || metadata.planId || metadata.plan_id || object.planId || object.plan_id || "";
  return {
    id: safeText(payload.id || payload.eventId || object.eventId || recordId("provider_event")),
    provider,
    type,
    userId: safeText(payload.userId || payload.user_id || metadata.userId || metadata.user_id || object.userId || object.user_id),
    planId: normalizePlanKey(rawPlanId) || "",
    status: safeText(payload.status || object.status || ""),
    renewalAt: payload.renewalAt || payload.renewal_at || object.renewalAt || object.current_period_end || null,
    providerCustomerId: safeText(payload.providerCustomerId || payload.customerId || payload.customer_id || object.customer || object.customer_id),
    providerSubscriptionId: safeText(payload.providerSubscriptionId || payload.subscriptionId || payload.subscription_id || object.subscription || object.subscription_id || object.id),
    rawMetadata: safeMetadata(payload),
  };
}

function subscriptionStatusForEvent(event) {
  if (event.type === "subscription_cancelled") return "cancelled";
  if (event.type === "payment_failed") return "past_due";
  if (["active", "trialing", "past_due", "cancelled"].includes(event.status)) return event.status;
  return event.planId ? "active" : "unselected";
}

function upsertSubscription(state, event, now = new Date()) {
  const existing = getCurrentSubscription(state);
  const subscription = {
    ...existing,
    id: existing.id || `billing_subscription_${event.userId}`,
    userId: event.userId,
    planId: event.planId || existing.planId || null,
    status: subscriptionStatusForEvent(event),
    provider: event.provider,
    providerCustomerId: event.providerCustomerId || existing.providerCustomerId || null,
    providerSubscriptionId: event.providerSubscriptionId || existing.providerSubscriptionId || null,
    renewalAt: event.renewalAt || existing.renewalAt || null,
    cancelAtPeriodEnd: event.type === "subscription_cancelled",
    createdAt: existing.createdAt || nowIso(now),
    updatedAt: nowIso(now),
  };
  const index = state.billingSubscriptions.findIndex((item) => item.id === subscription.id);
  if (index >= 0) state.billingSubscriptions[index] = subscription;
  else state.billingSubscriptions.push(subscription);
  state.studentProfile.preferences = state.studentProfile.preferences || {};
  const normalizedPlanKey = normalizePlanKey(subscription.planId);
  if (normalizedPlanKey && normalizedPlanKey !== PLAN_KEYS.TRIAL) {
    state.studentProfile.preferences.billingPlan = normalizedPlanKey;
  }
  return subscription;
}

export function processBillingWebhook({ state, event, now = new Date() }) {
  ensureBillingState(state);
  if (!event?.id || !event?.provider || !event?.userId || !WEBHOOK_TYPES.has(event.type)) {
    const error = new Error("Invalid billing webhook event");
    error.status = 400;
    throw error;
  }
  const webhookEventId = `billing_webhook_${event.provider}_${event.id}`;
  const existing = state.billingWebhookEvents.find((item) => item.id === webhookEventId);
  if (existing) {
    return {
      duplicate: true,
      webhookEvent: existing,
      subscription: getCurrentSubscription(state),
    };
  }
  const subscription = upsertSubscription(state, event, now);
  const webhookEvent = {
    id: webhookEventId,
    userId: event.userId,
    provider: event.provider,
    providerEventId: event.id,
    eventType: event.type,
    status: "processed",
    subscriptionId: subscription.id,
    metadata: event.rawMetadata || {},
    processedAt: nowIso(now),
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
  };
  state.billingWebhookEvents.push(webhookEvent);
  state.auditLog.push({
    id: recordId("audit_billing"),
    actorId: event.userId,
    action: `billing.${event.type}`,
    targetType: "billing_subscription",
    targetId: subscription.id,
    riskLevel: event.type === "payment_failed" ? "medium" : "low",
    metadata: {
      provider: event.provider,
      planId: subscription.planId,
      status: subscription.status,
      providerEventId: event.id,
    },
    createdAt: nowIso(now),
  });
  return {
    duplicate: false,
    webhookEvent,
    subscription,
  };
}

export function getBillingSnapshot({ state, saasConfig, providerStatus }) {
  const entitlements = resolveEntitlements(state, saasConfig?.billing?.defaultPlan || null);
  return {
    subscription: entitlements.subscription,
    entitlements: {
      plan: entitlements.plan,
      selectedPlan: getPublicPlanSummary(entitlements.selectedPlanKey),
      access: getPublicEntitlementSummary(entitlements.activePlanKey),
    },
    provider: providerStatus,
    plans: getPublicPlanCatalog(),
    checkout: {
      redirectEnabled: Boolean(providerStatus?.checkoutRedirectEnabled),
      realChargesActive: Boolean(providerStatus?.liveChargesEnabled),
    },
    secretsPrinted: false,
  };
}
