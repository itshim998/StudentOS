const DEFAULT_SUPABASE_REQUEST_TIMEOUT_MS = Number(process.env.STUDENTOS_SUPABASE_REQUEST_TIMEOUT_MS || 20000);

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_SUPABASE_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const signal = options.signal || controller.signal;
    return await fetch(url, { ...options, signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`StudentOS data request timed out after ${timeoutMs}ms`);
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

function publicDataError(message, status) {
  const text = String(message || "").trim();
  if (status === 429 || /429|too many|rate limit/i.test(text)) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (/supabase|postgrest|postgres|pgvector|rpc|service role/i.test(text)) {
    return "We couldn’t complete that request. Please try again.";
  }
  return text || `StudentOS data request failed with ${status}`;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = publicDataError(body?.message || body?.error_description || body?.error, response.status);
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body;
}

export class SupabaseRestClient {
  constructor({ url, key, label, role = "service_role" }) {
    this.url = trimTrailingSlash(url);
    this.key = key;
    this.label = label;
    this.role = role;
  }

  isConfigured() {
    return Boolean(this.url && this.key);
  }

  headers(extra = {}) {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  restUrl(table, params = {}) {
    return `${this.url}/rest/v1/${table}${buildQuery(params)}`;
  }

  async select(table, { columns = "*", filters = {}, order, limit } = {}) {
    const params = { select: columns };
    for (const [column, value] of Object.entries(filters)) {
      params[column] = value;
    }
    if (order) params.order = order;
    if (limit) params.limit = String(limit);
    const response = await fetchWithTimeout(this.restUrl(table, params), {
      method: "GET",
      headers: this.headers(),
    });
    return parseJsonResponse(response);
  }

  async upsert(table, rows, { onConflict = "id", returning = "representation" } = {}) {
    const payload = Array.isArray(rows) ? rows : [rows];
    if (payload.length === 0) return [];
    const response = await fetchWithTimeout(this.restUrl(table, { on_conflict: onConflict }), {
      method: "POST",
      headers: this.headers({
        Prefer: `resolution=merge-duplicates,return=${returning}`,
      }),
      body: JSON.stringify(payload),
    });
    return parseJsonResponse(response);
  }

  async insert(table, rows, { returning = "representation" } = {}) {
    const payload = Array.isArray(rows) ? rows : [rows];
    if (payload.length === 0) return [];
    const response = await fetchWithTimeout(this.restUrl(table), {
      method: "POST",
      headers: this.headers({
        Prefer: `return=${returning}`,
      }),
      body: JSON.stringify(payload),
    });
    return parseJsonResponse(response);
  }

  async deleteRows(table, { filters = {}, returning = "minimal" } = {}) {
    const params = {};
    for (const [column, value] of Object.entries(filters)) {
      params[column] = value;
    }
    const response = await fetchWithTimeout(this.restUrl(table, params), {
      method: "DELETE",
      headers: this.headers({
        Prefer: `return=${returning}`,
      }),
    });
    return parseJsonResponse(response);
  }

  async rpc(functionName, body = {}) {
    const response = await fetchWithTimeout(`${this.url}/rest/v1/rpc/${encodeURIComponent(functionName)}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return parseJsonResponse(response);
  }

  async uploadObject(bucket, path, bytes, { contentType = "application/octet-stream", upsert = false } = {}) {
    const encodedPath = String(path || "")
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const response = await fetchWithTimeout(`${this.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, {
      method: "POST",
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        "Content-Type": contentType,
        "x-upsert": upsert ? "true" : "false",
      },
      body: bytes,
    });
    return parseJsonResponse(response);
  }

  async downloadObject(bucket, path) {
    const encodedPath = String(path || "")
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const response = await fetchWithTimeout(`${this.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, {
      method: "GET",
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
      },
    });
    if (!response.ok) {
      const error = new Error(`Private storage download failed with ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async deleteObjects(bucket, paths) {
    const payload = { prefixes: Array.isArray(paths) ? paths : [paths] };
    const response = await fetchWithTimeout(`${this.url}/storage/v1/object/${encodeURIComponent(bucket)}`, {
      method: "DELETE",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    return parseJsonResponse(response);
  }
}

export class SupabaseAuthClient {
  constructor({ url, anonKey, serviceRoleKey }) {
    this.url = trimTrailingSlash(url);
    this.anonKey = anonKey;
    this.serviceRoleKey = serviceRoleKey;
  }

  isConfigured() {
    return Boolean(this.url && this.anonKey);
  }

  authHeaders(token) {
    return {
      apikey: this.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  async getUser(accessToken) {
    if (!this.isConfigured() || !accessToken) return null;
    const response = await fetchWithTimeout(`${this.url}/auth/v1/user`, {
      method: "GET",
      headers: this.authHeaders(accessToken),
    });
    const body = await parseJsonResponse(response);
    return {
      id: body.id,
      email: body.email || body.user_metadata?.email || "",
      appMetadata: body.app_metadata || {},
      userMetadata: body.user_metadata || {},
      aud: body.aud,
      role: body.role,
      emailConfirmedAt: body.email_confirmed_at || body.confirmed_at || null,
    };
  }

  async recoverPassword(email, redirectTo = "") {
    if (!this.isConfigured()) {
      const error = new Error("StudentOS sign-in is not configured");
      error.status = 503;
      throw error;
    }
    const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
    const response = await fetchWithTimeout(`${this.url}/auth/v1/recover${query}`, {
      method: "POST",
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });
    return parseJsonResponse(response);
  }

  async resendVerification(email) {
    if (!this.isConfigured()) {
      const error = new Error("StudentOS sign-in is not configured");
      error.status = 503;
      throw error;
    }
    const response = await fetchWithTimeout(`${this.url}/auth/v1/resend`, {
      method: "POST",
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "signup", email }),
    });
    return parseJsonResponse(response);
  }

  async adminDeleteUser(userId) {
    if (!this.url || !this.serviceRoleKey || !userId) {
      const error = new Error("StudentOS account deletion is not configured");
      error.status = 503;
      throw error;
    }
    const response = await fetchWithTimeout(`${this.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
    });
    return parseJsonResponse(response);
  }
}
