import { writeFileSync } from "node:fs";
import path from "node:path";

const rawApiBase = String(process.env.STUDENTOS_PUBLIC_API_BASE_URL || "").trim();
const outputPath = path.join(process.cwd(), "frontend", "runtime-config.js");

function normalizePublicApiBase(value) {
  if (!value) return "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("STUDENTOS_PUBLIC_API_BASE_URL must be a valid absolute URL.");
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("STUDENTOS_PUBLIC_API_BASE_URL must use http or https.");
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

const apiBase = normalizePublicApiBase(rawApiBase);
const body = `window.StudentOSRuntimeConfig = window.StudentOSRuntimeConfig || {\n  apiBase: ${JSON.stringify(apiBase)},\n};\n\n(() => {\n  if (!document.getElementById("studentos-auth-redesign-styles")) {\n    const stylesheet = document.createElement("link");\n    stylesheet.id = "studentos-auth-redesign-styles";\n    stylesheet.rel = "stylesheet";\n    stylesheet.href = "/styles/auth-redesign.css";\n    document.head.append(stylesheet);\n  }\n\n  if (!document.getElementById("studentos-auth-redesign-script")) {\n    const script = document.createElement("script");\n    script.id = "studentos-auth-redesign-script";\n    script.src = "/scripts/auth-redesign.js";\n    script.async = false;\n    document.head.append(script);\n  }\n})();\n`;
writeFileSync(outputPath, body, "utf8");

const apiBaseHost = apiBase ? new URL(apiBase).host : "same-origin";
console.log(JSON.stringify({
  ok: true,
  output: "frontend/runtime-config.js",
  apiBaseHost,
  secretsPrinted: false,
}, null, 2));
