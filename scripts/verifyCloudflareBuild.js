import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const frontendRoot = join(root, "frontend");
const katexRoot = join(frontendRoot, "vendor", "katex");
const cssPath = join(katexRoot, "katex.min.css");
const jsPath = join(katexRoot, "katex.min.js");
const fontsPath = join(katexRoot, "fonts");
const indexPath = join(frontendRoot, "index.html");
const runtimeConfigPath = join(frontendRoot, "runtime-config.js");
const authRedesignCssPath = join(frontendRoot, "styles", "auth-redesign.css");
const authRedesignJsPath = join(frontendRoot, "scripts", "auth-redesign.js");
const studentOsLogoPath = join(frontendRoot, "assets", "studentos-logo.png");
const recoveryCssPath = join(frontendRoot, "styles", "recovery.css");
const recoveryJsPath = join(frontendRoot, "scripts", "features", "recovery.js");
const apiClientJsPath = join(frontendRoot, "scripts", "core", "api-client.js");
const featureAccessJsPath = join(frontendRoot, "scripts", "core", "feature-access.js");

function requireNonEmptyFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`Cloudflare build is missing ${label}.`);
  }
}

requireNonEmptyFile(cssPath, "frontend/vendor/katex/katex.min.css");
requireNonEmptyFile(jsPath, "frontend/vendor/katex/katex.min.js");
requireNonEmptyFile(runtimeConfigPath, "frontend/runtime-config.js");
requireNonEmptyFile(authRedesignCssPath, "frontend/styles/auth-redesign.css");
requireNonEmptyFile(authRedesignJsPath, "frontend/scripts/auth-redesign.js");
requireNonEmptyFile(studentOsLogoPath, "frontend/assets/studentos-logo.png");
requireNonEmptyFile(recoveryCssPath, "frontend/styles/recovery.css");
requireNonEmptyFile(recoveryJsPath, "frontend/scripts/features/recovery.js");
requireNonEmptyFile(apiClientJsPath, "frontend/scripts/core/api-client.js");
requireNonEmptyFile(featureAccessJsPath, "frontend/scripts/core/feature-access.js");

const logoSignature = readFileSync(studentOsLogoPath).subarray(0, 8).toString("hex");
if (logoSignature !== "89504e470d0a1a0a") {
  throw new Error("The StudentOS logo asset is not a valid PNG.");
}

if (!existsSync(fontsPath) || !statSync(fontsPath).isDirectory()) {
  throw new Error("Cloudflare build is missing the KaTeX fonts directory.");
}
const fonts = readdirSync(fontsPath).filter((name) => /\.(?:woff2?|ttf)$/i.test(name));
if (!fonts.length) throw new Error("Cloudflare build does not contain any KaTeX font files.");

const stylesheet = readFileSync(cssPath, "utf8").trimStart();
if (/^<!doctype\s+html|^<html[\s>]/i.test(stylesheet) || !stylesheet.includes("@font-face")) {
  throw new Error("The KaTeX stylesheet output is not valid KaTeX CSS.");
}
const indexHtml = readFileSync(indexPath, "utf8");
if (!indexHtml.includes('href="/vendor/katex/katex.min.css"')) {
  throw new Error("frontend/index.html does not reference the vendored KaTeX stylesheet.");
}
if (!indexHtml.includes('href="/styles/recovery.css"') || !indexHtml.includes('id="recovery-dialog"')) {
  throw new Error("frontend/index.html does not contain the Adaptive Recovery frontend boundary.");
}

const runtimeConfig = readFileSync(runtimeConfigPath, "utf8");
if (!runtimeConfig.includes("/styles/auth-redesign.css") || !runtimeConfig.includes("/scripts/auth-redesign.js")) {
  throw new Error("frontend/runtime-config.js does not load the StudentOS auth redesign assets.");
}

console.log(JSON.stringify({
  ok: true,
  css: "frontend/vendor/katex/katex.min.css",
  js: "frontend/vendor/katex/katex.min.js",
  authRedesignCss: "frontend/styles/auth-redesign.css",
  authRedesignJs: "frontend/scripts/auth-redesign.js",
  studentOsLogo: "frontend/assets/studentos-logo.png",
  recoveryCss: "frontend/styles/recovery.css",
  recoveryJs: "frontend/scripts/features/recovery.js",
  fontCount: fonts.length,
  htmlFallback: false,
  secretsPrinted: false,
}, null, 2));
