const API_BASE = window.StudentOSConfig?.apiBase || "";
const PUBLIC_FRONTEND_HOSTS = new Set([
  "studentos.sentiqlabs.com",
  "studentos-39s.pages.dev",
]);
const API_BASE_MISCONFIGURED_MESSAGE = "API base URL misconfigured. Cloudflare Pages must set STUDENTOS_PUBLIC_API_BASE_URL to the Azure backend URL.";
const result = document.getElementById("completion-result");
const copy = document.getElementById("completion-copy");
const form = document.getElementById("recovery-complete-form");
const password = document.getElementById("recovery-password");

function fragmentParams() {
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

function apiUrl(path) {
  if (!API_BASE && PUBLIC_FRONTEND_HOSTS.has(window.location.hostname)) {
    throw new Error(API_BASE_MISCONFIGURED_MESSAGE);
  }
  return `${API_BASE}${path}`;
}

async function readJsonResponse(response, fallbackMessage) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const looksHtml = contentType.includes("text/html") || /^\s*<!doctype\s+html/i.test(text) || /^\s*<html[\s>]/i.test(text);
  if (looksHtml) throw new Error(API_BASE_MISCONFIGURED_MESSAGE);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(fallbackMessage);
  }
}

async function loadConfig() {
  const response = await fetch(apiUrl("/api/config"), { headers: { Accept: "application/json" } });
  const body = await readJsonResponse(response, "StudentOS account configuration returned invalid JSON.");
  if (!response.ok) throw new Error("StudentOS account configuration is unavailable.");
  return body;
}

function show(message) {
  result.textContent = message;
}

async function updatePassword(config, accessToken, nextPassword) {
  const response = await fetch(`${config.auth.url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: config.auth.anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: nextPassword }),
  });
  const body = await readJsonResponse(response, "StudentOS Auth returned invalid JSON.").catch(() => ({}));
  if (!response.ok) throw new Error(body.error_description || body.msg || body.error || "Password update failed.");
  return body;
}

async function init() {
  const query = new URLSearchParams(window.location.search);
  const fragment = fragmentParams();
  const type = fragment.get("type") || query.get("type") || query.get("auth") || "";
  const accessToken = fragment.get("access_token") || "";
  if (type === "recovery" && accessToken) {
    copy.textContent = "Choose a new password for your StudentOS account.";
    form.hidden = false;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      show("Updating your password...");
      try {
        const config = await loadConfig();
        if (!config.auth?.enabled) throw new Error("StudentOS Auth is not configured.");
        await updatePassword(config, accessToken, password.value);
        form.hidden = true;
        show("Password updated. You can return to StudentOS and sign in.");
        history.replaceState(null, "", "/auth/complete?status=password_updated");
      } catch (error) {
        show(error.message);
      }
    });
    return;
  }
  if (["signup", "verified", "email_change"].includes(type) || query.get("status") === "verified") {
    copy.textContent = "Your email verification link has been processed.";
    show("Email verification complete. Return to StudentOS and sign in.");
    history.replaceState(null, "", "/auth/complete?status=verified");
    return;
  }
  copy.textContent = "This account link is incomplete or has expired.";
  show("Request a fresh verification or password reset link from StudentOS account settings.");
  if (window.location.hash) history.replaceState(null, "", "/auth/complete");
}

init().catch((error) => show(error.message));
