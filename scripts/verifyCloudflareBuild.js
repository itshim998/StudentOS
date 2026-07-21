import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const frontendRoot = join(root, "frontend");
const katexRoot = join(frontendRoot, "vendor", "katex");
const cssPath = join(katexRoot, "katex.min.css");
const jsPath = join(katexRoot, "katex.min.js");
const fontsPath = join(katexRoot, "fonts");
const indexPath = join(frontendRoot, "index.html");

function requireNonEmptyFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`Cloudflare build is missing ${label}.`);
  }
}

requireNonEmptyFile(cssPath, "frontend/vendor/katex/katex.min.css");
requireNonEmptyFile(jsPath, "frontend/vendor/katex/katex.min.js");

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

console.log(JSON.stringify({
  ok: true,
  css: "frontend/vendor/katex/katex.min.css",
  js: "frontend/vendor/katex/katex.min.js",
  fontCount: fonts.length,
  htmlFallback: false,
  secretsPrinted: false,
}, null, 2));
