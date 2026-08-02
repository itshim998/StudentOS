export class ApiResponseError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiResponseError";
    this.status = Number(options.status || 0);
    this.code = options.code || null;
    this.retryable = options.retryable === true;
    this.correlationId = options.correlationId || null;
    this.invalidResponse = options.invalidResponse === true;
  }
}

export async function readJsonResponse(response, fallbackMessage) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const looksHtml = contentType.includes("text/html") || /^\s*<!doctype\s+html/i.test(text) || /^\s*<html[\s>]/i.test(text);
  if (looksHtml) {
    throw new ApiResponseError(fallbackMessage, { status: response.status, invalidResponse: true });
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ApiResponseError(fallbackMessage, { status: response.status, invalidResponse: true });
  }
}

export async function requestJson({
  url,
  options = {},
  accessToken = "",
  onUnauthorized = null,
  invalidResponseMessage = "StudentOS returned an invalid response.",
} = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = isFormData
    ? { ...(options.headers || {}) }
    : { "Content-Type": "application/json", ...(options.headers || {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(url, { ...options, headers });
  const body = await readJsonResponse(response, invalidResponseMessage);
  if (!response.ok) {
    if (response.status === 401 && typeof onUnauthorized === "function") onUnauthorized();
    throw new ApiResponseError(body.error || `HTTP ${response.status}`, {
      status: response.status,
      code: body.code,
      retryable: body.retryable,
      correlationId: body.correlationId,
    });
  }
  return body;
}
