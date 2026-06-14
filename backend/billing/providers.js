import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(left, right) {
  const leftBytes = Buffer.from(String(left || ""));
  const rightBytes = Buffer.from(String(right || ""));
  if (!leftBytes.length || leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

function hmac(secret, body) {
  return createHmac("sha256", String(secret || "")).update(String(body || "")).digest("hex");
}

function stripeSignatureValue(value) {
  const parts = String(value || "").split(",").map((part) => part.trim());
  return parts.find((part) => part.startsWith("v1="))?.slice(3) || String(value || "");
}

class BillingAdapter {
  constructor(config, provider) {
    this.config = config;
    this.provider = provider;
    this.providerConfig = config.providers[provider] || {};
  }

  publicStatus() {
    return {
      provider: this.provider,
      configured: Boolean(this.providerConfig.configured),
      liveChargesEnabled: Boolean(this.config.liveChargesEnabled),
      checkoutRedirectEnabled: Boolean(this.config.checkoutRedirectEnabled),
      webhookVerification: this.provider === "none" ? "disabled" : "provider_boundary",
      secretsExposed: false,
    };
  }

  createCheckoutPreview({ planId, userId }) {
    return {
      ok: true,
      provider: this.provider,
      planId,
      userId,
      status: this.config.checkoutRedirectEnabled ? "provider_configuration_ready" : "scaffold_only",
      redirectAllowed: false,
      checkoutUrl: null,
      message: this.config.checkoutRedirectEnabled
        ? "Provider configuration is ready. Live checkout redirects remain disabled until the provider-specific launch integration is completed."
        : "Billing checkout is scaffolded only. No payment redirect or charge was created.",
      secretsPrinted: false,
    };
  }

  createManageBillingPreview({ userId }) {
    return {
      ok: true,
      provider: this.provider,
      userId,
      status: "scaffold_only",
      redirectAllowed: false,
      portalUrl: null,
      message: "Billing management is scaffolded only. No provider portal redirect was created.",
      secretsPrinted: false,
    };
  }

  verifyWebhook() {
    return false;
  }

  prepareCancellation({ subscription, policy = "immediate", reconciliation = null } = {}) {
    return {
      provider: this.provider,
      status: this.provider === "none" ? "not_required" : "scaffold_only",
      requestedPolicy: policy === "cycle_end" ? "cycle_end" : "immediate",
      reconciliationStatus: reconciliation?.status || "unknown",
      subscriptionIdPresent: Boolean(subscription?.providerSubscriptionId),
      liveCallAllowed: false,
      providerCallExecuted: false,
      message: this.provider === "none"
        ? "No external billing cancellation is required."
        : "Provider cancellation is scaffolded only. No live provider request was sent.",
      secretsPrinted: false,
    };
  }
}

class NoneBillingAdapter extends BillingAdapter {
  verifyWebhook() {
    return false;
  }
}

class MockBillingAdapter extends BillingAdapter {
  verifyWebhook({ rawBody, headers = {} }) {
    const signature = headers["x-studentos-mock-signature"] || headers["X-StudentOS-Mock-Signature"];
    return safeEqual(signature, hmac(this.providerConfig.webhookSecret, rawBody));
  }
}

class RazorpayBillingAdapter extends BillingAdapter {
  verifyWebhook({ rawBody, headers = {} }) {
    const signature = headers["x-razorpay-signature"] || headers["X-Razorpay-Signature"];
    return Boolean(this.providerConfig.webhookSecret) &&
      safeEqual(signature, hmac(this.providerConfig.webhookSecret, rawBody));
  }
}

class StripeBillingAdapter extends BillingAdapter {
  verifyWebhook({ rawBody, headers = {} }) {
    const signature = stripeSignatureValue(headers["stripe-signature"] || headers["Stripe-Signature"]);
    return Boolean(this.providerConfig.webhookSecret) &&
      safeEqual(signature, hmac(this.providerConfig.webhookSecret, rawBody));
  }
}

class PaddleBillingAdapter extends BillingAdapter {
  verifyWebhook({ rawBody, headers = {} }) {
    const signature = headers["paddle-signature"] || headers["Paddle-Signature"];
    return Boolean(this.providerConfig.webhookSecret) &&
      safeEqual(signature, hmac(this.providerConfig.webhookSecret, rawBody));
  }
}

export function createBillingAdapter(config, provider = config.provider) {
  const adapters = {
    none: NoneBillingAdapter,
    mock: MockBillingAdapter,
    razorpay: RazorpayBillingAdapter,
    stripe: StripeBillingAdapter,
    paddle: PaddleBillingAdapter,
  };
  const Adapter = adapters[provider] || NoneBillingAdapter;
  return new Adapter(config, provider in adapters ? provider : "none");
}

export function createMockWebhookSignature(secret, rawBody) {
  return hmac(secret, rawBody);
}
