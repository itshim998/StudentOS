import { getCurrentSubscription } from "./billingService.js";

function readValue(env, key, fallback = "") {
  return String(env[key] || fallback).trim();
}

function readBool(env, key, fallback = false) {
  const value = readValue(env, key);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function safeText(value, fallback = "", maxLength = 300) {
  return String(value || fallback).trim().slice(0, maxLength);
}

export function getBillingCancellationConfig(env = process.env) {
  const policy = readValue(env, "STUDENTOS_BILLING_CANCELLATION_POLICY", "immediate").toLowerCase();
  return {
    providerCallsEnabled: readBool(env, "STUDENTOS_BILLING_CANCELLATION_PROVIDER_CALLS_ENABLED", false),
    manualWaiverEnabled: readBool(env, "STUDENTOS_BILLING_CANCELLATION_MANUAL_WAIVER_ENABLED", false),
    cancellationPolicy: policy === "cycle_end" ? "cycle_end" : "immediate",
  };
}

export function getSafeBillingCancellationStatus(config = getBillingCancellationConfig()) {
  return {
    providerCallsEnabled: config.providerCallsEnabled,
    manualWaiverEnabled: config.manualWaiverEnabled,
    cancellationPolicy: config.cancellationPolicy,
    scaffoldedProviders: ["razorpay", "stripe", "paddle"],
    liveCancellationImplemented: false,
    secretsExposed: false,
  };
}

function providerStatus(subscription = {}) {
  return String(subscription.status || subscription.providerStatus || subscription.metadata?.status || "")
    .toLowerCase()
    .replace(/[.\s-]+/g, "_");
}

function isCycleEndScheduled(subscription = {}) {
  return subscription.cancelAtPeriodEnd === true ||
    subscription.cancel_at_period_end === true ||
    subscription.metadata?.cancelAtPeriodEnd === true ||
    Boolean(subscription.cancelAt || subscription.cancel_at || subscription.cancelledAtPeriodEnd);
}

export function normalizeProviderCancellationState(subscription = {}, config = getBillingCancellationConfig()) {
  const provider = String(subscription.provider || "none").toLowerCase();
  const status = providerStatus(subscription);
  const cancelledStatuses = new Set([
    "cancelled",
    "canceled",
    "deleted",
    "ended",
    "expired",
    "free",
  ]);
  const activeStatuses = new Set([
    "active",
    "trialing",
    "past_due",
    "authenticated",
    "created",
    "halted",
    "paused",
  ]);
  if (!provider || provider === "none" || status === "free") {
    return {
      provider,
      status: "not_required",
      satisfied: true,
      cycleEndAccepted: false,
    };
  }
  if (cancelledStatuses.has(status)) {
    return {
      provider,
      status: "provider_cancelled",
      satisfied: true,
      cycleEndAccepted: false,
    };
  }
  if (isCycleEndScheduled(subscription)) {
    const cycleEndAccepted = config.cancellationPolicy === "cycle_end";
    return {
      provider,
      status: "provider_cancelled_at_period_end",
      satisfied: cycleEndAccepted,
      cycleEndAccepted,
    };
  }
  if (activeStatuses.has(status)) {
    return {
      provider,
      status: "provider_cancellation_required",
      satisfied: false,
      cycleEndAccepted: false,
    };
  }
  return {
    provider,
    status: "provider_cancellation_review_required",
    satisfied: false,
    cycleEndAccepted: false,
  };
}

export function evaluateBillingCancellation({
  state,
  adapter,
  config = getBillingCancellationConfig(),
  waiver = {},
  canWaive = false,
} = {}) {
  const subscription = getCurrentSubscription(state);
  const reconciliation = normalizeProviderCancellationState(subscription, config);
  if (reconciliation.satisfied) {
    return {
      satisfied: true,
      blocksExecution: false,
      status: reconciliation.status,
      provider: subscription.provider || "none",
      subscriptionIdPresent: Boolean(subscription.providerSubscriptionId),
      providerCallExecuted: false,
      waived: false,
      reconciliation,
    };
  }
  const note = safeText(waiver.note);
  if (waiver.acknowledged === true && canWaive && config.manualWaiverEnabled && note.length >= 12) {
    return {
      satisfied: true,
      blocksExecution: false,
      status: "manually_waived_with_evidence",
      provider: subscription.provider,
      subscriptionIdPresent: Boolean(subscription.providerSubscriptionId),
      providerCallExecuted: false,
      waived: true,
      waiverNote: note,
      reconciliation,
    };
  }
  const scaffold = adapter?.prepareCancellation?.({ subscription, policy: config.cancellationPolicy, reconciliation }) || {
    provider: subscription.provider,
    status: "provider_adapter_unavailable",
    liveCallAllowed: false,
  };
  return {
    satisfied: false,
    blocksExecution: true,
    status: reconciliation.status || scaffold.status || "provider_cancellation_review_required",
    provider: subscription.provider,
    subscriptionIdPresent: Boolean(subscription.providerSubscriptionId),
    providerCallExecuted: false,
    waived: false,
    reconciliation,
    scaffold,
  };
}
