import assert from "node:assert/strict";
import { createSeedState } from "./domain/studentosDomain.js";
import {
  getBillingSnapshot,
  normalizeProviderWebhook,
  processBillingWebhook,
  resolveEntitlements,
} from "./billing/billingService.js";
import { getBillingProviderConfig, getSafeBillingProviderStatus } from "./billing/providerConfig.js";
import { createBillingAdapter, createMockWebhookSignature } from "./billing/providers.js";
import { checkUsagePolicy } from "./security/usagePolicy.js";
import { getSaasConfig } from "./config/saasConfig.js";
import { getSupabaseEnvironment } from "./config/supabaseEnv.js";
import { redactSecrets } from "./observability/logger.js";

const now = new Date("2026-05-31T10:00:00+05:30");
const userId = "student_demo_001";
const state = createSeedState(now);
const mockSecret = "mock_webhook_should_not_print";
const billingConfig = getBillingProviderConfig({
  STUDENTOS_BILLING_PROVIDER: "mock",
  STUDENTOS_BILLING_MOCK_WEBHOOK_SECRET: mockSecret,
});
const adapter = createBillingAdapter(billingConfig);
const safeStatus = getSafeBillingProviderStatus(billingConfig);

assert.equal(safeStatus.provider, "mock");
assert.equal(safeStatus.configured, true);
assert.equal(safeStatus.liveChargesEnabled, false);
assert.equal(JSON.stringify(safeStatus).includes(mockSecret), false);

const checkout = adapter.createCheckoutPreview({ planId: "pro", userId });
assert.equal(checkout.status, "scaffold_only");
assert.equal(checkout.redirectAllowed, false);
assert.equal(checkout.checkoutUrl, null);

const rawCreated = JSON.stringify({
  id: "evt_created_1",
  type: "subscription_created",
  userId,
  planId: "pro",
  status: "active",
  providerCustomerId: "customer_demo_1",
  providerSubscriptionId: "subscription_demo_1",
  renewalAt: "2026-06-30T00:00:00.000Z",
});
assert.equal(adapter.verifyWebhook({
  rawBody: rawCreated,
  headers: { "x-studentos-mock-signature": createMockWebhookSignature(mockSecret, rawCreated) },
}), true);
assert.equal(adapter.verifyWebhook({
  rawBody: rawCreated,
  headers: { "x-studentos-mock-signature": "wrong" },
}), false);

const createdEvent = normalizeProviderWebhook({ provider: "mock", payload: JSON.parse(rawCreated) });
const created = processBillingWebhook({ state, event: createdEvent, now });
assert.equal(created.duplicate, false);
assert.equal(created.subscription.planId, "pro");
assert.equal(created.subscription.status, "active");
assert.equal(resolveEntitlements(state).plan.id, "pro");

const duplicate = processBillingWebhook({ state, event: createdEvent, now });
assert.equal(duplicate.duplicate, true);
assert.equal(state.billingWebhookEvents.length, 1);

const updatedEvent = normalizeProviderWebhook({
  provider: "mock",
  payload: {
    id: "evt_updated_1",
    type: "subscription_updated",
    userId,
    planId: "group",
    status: "active",
    providerSubscriptionId: "subscription_demo_1",
  },
});
processBillingWebhook({ state, event: updatedEvent, now });
assert.equal(updatedEvent.planId, "", "retired plans must not enter the launch entitlement catalog");
assert.equal(resolveEntitlements(state).plan.id, "pro");

const paymentFailedEvent = normalizeProviderWebhook({
  provider: "mock",
  payload: {
    id: "evt_failed_1",
    type: "payment_failed",
    userId,
    providerSubscriptionId: "subscription_demo_1",
  },
});
processBillingWebhook({ state, event: paymentFailedEvent, now });
assert.equal(resolveEntitlements(state).plan.id, "pro");
assert.equal(resolveEntitlements(state).subscription.status, "past_due");

const cancelledEvent = normalizeProviderWebhook({
  provider: "mock",
  payload: {
    id: "evt_cancel_1",
    type: "subscription_cancelled",
    userId,
    providerSubscriptionId: "subscription_demo_1",
  },
});
processBillingWebhook({ state, event: cancelledEvent, now });
assert.equal(resolveEntitlements(state).plan.id, "unselected");
assert.equal(resolveEntitlements(state).subscription.status, "cancelled");

const enforcedConfig = getSaasConfig({
  env: {
    STUDENTOS_QUOTA_ENFORCEMENT: "true",
    STUDENTOS_DEFAULT_PLAN: "starter",
  },
  supabaseConfig: getSupabaseEnvironment({ STUDENTOS_MODE: "mock" }),
  billingConfig,
});
const freeState = createSeedState(now);
freeState.aiMessages = Array.from({ length: 25 }, (_, index) => ({
  id: `free_msg_${index}`,
  role: "user",
  content: "quota check",
}));
assert.equal(checkUsagePolicy({ saasConfig: enforcedConfig, state: freeState, action: "ai_call" }).allowed, false);

const proState = createSeedState(now);
processBillingWebhook({
  state: proState,
  event: normalizeProviderWebhook({
    provider: "mock",
    payload: { id: "evt_pro_quota", type: "subscription_created", userId, planId: "pro", status: "active" },
  }),
  now,
});
proState.aiMessages = Array.from({ length: 25 }, (_, index) => ({
  id: `pro_msg_${index}`,
  role: "user",
  content: "quota check",
}));
const proPolicy = checkUsagePolicy({ saasConfig: enforcedConfig, state: proState, action: "ai_call" });
assert.equal(proPolicy.allowed, true);
assert.equal(proPolicy.plan.id, "pro");
assert.equal(proPolicy.features.advancedAutomation, true);

const billingSnapshot = getBillingSnapshot({
  state: proState,
  saasConfig: enforcedConfig,
  providerStatus: safeStatus,
});
assert.equal(billingSnapshot.entitlements.plan.id, "pro");
assert.equal(billingSnapshot.checkout.realChargesActive, false);
assert.equal(JSON.stringify(billingSnapshot).includes(mockSecret), false);

const liveButSafeConfig = getBillingProviderConfig({
  STUDENTOS_BILLING_PROVIDER: "stripe",
  STUDENTOS_BILLING_LIVE_CHARGES_ENABLED: "true",
  STUDENTOS_BILLING_CHECKOUT_REDIRECT_ENABLED: "true",
  STRIPE_SECRET_KEY: "stripe_secret_should_not_print",
  STRIPE_WEBHOOK_SECRET: "stripe_webhook_should_not_print",
});
const liveButSafePreview = createBillingAdapter(liveButSafeConfig).createCheckoutPreview({ planId: "pro", userId });
assert.equal(liveButSafeConfig.checkoutRedirectEnabled, true);
assert.equal(liveButSafePreview.redirectAllowed, false);
assert.equal(liveButSafePreview.checkoutUrl, null);
assert.equal(JSON.stringify(getSafeBillingProviderStatus(liveButSafeConfig)).includes("stripe_secret_should_not_print"), false);

const logText = redactSecrets("STRIPE_SECRET_KEY=stripe_secret_should_not_print PADDLE_API_KEY=paddle_secret_should_not_print");
assert.equal(logText.includes("stripe_secret_should_not_print"), false);
assert.equal(logText.includes("paddle_secret_should_not_print"), false);

console.log("PASS | StudentOS Pass 16 billing and entitlement tests passed");
