import { randomUUID } from "node:crypto";

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /api[_-]?key[:=]\s*[A-Za-z0-9._-]+/gi,
  /apikey[A-Za-z0-9._:= -]*/gi,
  /service[_-]?role[_-]?key[:=]\s*[A-Za-z0-9._-]+/gi,
  /secret[:=]\s*[A-Za-z0-9._-]+/gi,
  /(STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_[1-4]=)[^\s]+/gi,
  /(GROQ_API_KEY(?:_[1-5])?=)[^\s]+/gi,
  /(POLLINATIONS_API_KEY=)[^\s]+/gi,
  /(STUDENTOS_BILLING_MOCK_WEBHOOK_SECRET=)[^\s]+/gi,
  /(RAZORPAY_(?:KEY_SECRET|WEBHOOK_SECRET)=)[^\s]+/gi,
  /(STRIPE_(?:SECRET_KEY|WEBHOOK_SECRET)=)[^\s]+/gi,
  /(PADDLE_(?:API_KEY|WEBHOOK_SECRET)=)[^\s]+/gi,
  /(STUDENTOS_INTERNAL_OPS_TOKEN=)[^\s]+/gi,
  /(STUDENTOS_OPERATOR_SESSION_SECRET=)[^\s]+/gi,
  /(STUDENTOS_OPERATOR_MFA_MOCK_CODE=)[^\s]+/gi,
  /(STUDENTOS_GOOGLE_CLASSROOM_OAUTH_STATE_SECRET=)[^\s]+/gi,
  /(STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET=)[^\s]+/gi,
  /(GOOGLE_CLIENT_SECRET=)[^\s]+/gi,
];

function isSensitiveObjectKey(key) {
  const normalized = String(key || "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
  return [
    "api_key",
    "apikey",
    "anon_key",
    "service_role",
    "service_role_key",
    "jwt_secret",
    "access_token",
    "refresh_token",
    "authorization",
    "bearer",
    "password",
    "private_key",
  ].includes(normalized) ||
    normalized.endsWith("_secret") ||
    normalized.endsWith("_token") ||
    normalized.endsWith("_code") ||
    normalized.includes("mfa_mock");
}

export function createRequestId() {
  return `req_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function redactSecrets(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, (match, prefix = "") =>
      typeof prefix === "string" && prefix.endsWith("=") ? `${prefix}[redacted]` : "[redacted]"), value);
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = isSensitiveObjectKey(key) ? "[redacted]" : redactSecrets(item);
    }
    return output;
  }
  return value;
}

export function createLogger({ service = "studentos-api", env = "development" } = {}) {
  function write(level, message, metadata = {}) {
    const entry = redactSecrets({
      ts: new Date().toISOString(),
      level,
      service,
      env,
      message,
      ...metadata,
    });
    console.log(JSON.stringify(entry));
  }
  return {
    info: (message, metadata) => write("info", message, metadata),
    warn: (message, metadata) => write("warn", message, metadata),
    error: (message, metadata) => write("error", message, metadata),
  };
}
