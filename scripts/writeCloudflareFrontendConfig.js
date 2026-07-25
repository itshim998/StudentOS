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
const body = `window.StudentOSRuntimeConfig = window.StudentOSRuntimeConfig || {
  apiBase: ${JSON.stringify(apiBase)},
};

(() => {
  const assets = [
    { id: "studentos-auth-redesign-styles", tag: "link", href: "/styles/auth-redesign.css" },
    { id: "studentos-auth-redesign-script", tag: "script", src: "/scripts/auth-redesign.js" },
    { id: "studentos-auth-accessibility-script", tag: "script", src: "/scripts/auth-accessibility.js" },
    { id: "studentos-ai-response-enhancements-script", tag: "script", src: "/scripts/ai-response-enhancements.js" },
  ];

  function writeParserBlockingAssets() {
    for (const asset of assets) {
      if (document.getElementById(asset.id)) continue;
      if (asset.tag === "link") {
        document.write(\`<link id="\${asset.id}" rel="stylesheet" href="\${asset.href}">\`);
      } else {
        document.write(\`<script id="\${asset.id}" src="\${asset.src}"><\\/script>\`);
      }
    }
  }

  function appendAssets() {
    for (const asset of assets) {
      if (document.getElementById(asset.id)) continue;
      if (asset.tag === "link") {
        const stylesheet = document.createElement("link");
        stylesheet.id = asset.id;
        stylesheet.rel = "stylesheet";
        stylesheet.href = asset.href;
        document.head.append(stylesheet);
      } else {
        const script = document.createElement("script");
        script.id = asset.id;
        script.src = asset.src;
        script.async = false;
        document.head.append(script);
      }
    }
  }

  if (document.readyState === "loading") {
    writeParserBlockingAssets();
  } else {
    appendAssets();
  }
})();
`;
writeFileSync(outputPath, body, "utf8");

const apiBaseHost = apiBase ? new URL(apiBase).host : "same-origin";
console.log(JSON.stringify({
  ok: true,
  output: "frontend/runtime-config.js",
  apiBaseHost,
  secretsPrinted: false,
}, null, 2));
