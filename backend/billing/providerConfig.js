const SUPPORTED_PROVIDERS = Object.freeze(["none", "mock", "razorpay", "stripe", "paddle"]);

function readValue(env, key, fallback = "") {
  return String(env[key] || fallback).trim();
}

function readBool(env, key, fallback = false) {
  const value = readValue(env, key);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function normalizeProvider(value) {
  const provider = String(value || "none").trim().toLowerCase();
  return SUPPORTED_PROVIDERS.includes(provider) ? provider : "none";
}

export function getBillingProviderConfig(env = process.env, { providerOverride = "" } = {}) {
  const provider = normalizeProvider(providerOverride || readValue(env, "STUDENTOS_BILLING_PROVIDER", "none"));
  const liveChargesRequested = readBool(env, "STUDENTOS_BILLING_LIVE_CHARGES_ENABLED", false);
  const providers = {
    none: {
      configured: true,
    },
    mock: {
      configured: true,
      webhookSecret: readValue(env, "STUDENTOS_BILLING_MOCK_WEBHOOK_SECRET", "studentos-local-mock-webhook"),
    },
    razorpay: {
      configured: Boolean(readValue(env, "RAZORPAY_KEY_ID") && readValue(env, "RAZORPAY_KEY_SECRET")),
      keyId: readValue(env, "RAZORPAY_KEY_ID"),
      keySecret: readValue(env, "RAZORPAY_KEY_SECRET"),
      webhookSecret: readValue(env, "RAZORPAY_WEBHOOK_SECRET"),
    },
    stripe: {
      configured: Boolean(readValue(env, "STRIPE_SECRET_KEY")),
      secretKey: readValue(env, "STRIPE_SECRET_KEY"),
      webhookSecret: readValue(env, "STRIPE_WEBHOOK_SECRET"),
    },
    paddle: {
      configured: Boolean(readValue(env, "PADDLE_API_KEY")),
      apiKey: readValue(env, "PADDLE_API_KEY"),
      webhookSecret: readValue(env, "PADDLE_WEBHOOK_SECRET"),
    },
  };
  const selected = providers[provider];
  const checkoutRedirectEnabled = liveChargesRequested &&
    readBool(env, "STUDENTOS_BILLING_CHECKOUT_REDIRECT_ENABLED", false) &&
    selected.configured &&
    !["none", "mock"].includes(provider);
  return {
    provider,
    supportedProviders: SUPPORTED_PROVIDERS,
    liveChargesRequested,
    liveChargesEnabled: checkoutRedirectEnabled,
    checkoutRedirectEnabled,
    providers,
  };
}

export function getSafeBillingProviderStatus(config = getBillingProviderConfig()) {
  return {
    provider: config.provider,
    supportedProviders: config.supportedProviders,
    configured: Boolean(config.providers?.[config.provider]?.configured),
    liveChargesRequested: config.liveChargesRequested,
    liveChargesEnabled: config.liveChargesEnabled,
    checkoutRedirectEnabled: config.checkoutRedirectEnabled,
    webhookScaffolded: true,
    secretsExposed: false,
  };
}
