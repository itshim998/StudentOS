/**
 * vendorKatex.js — Copy KaTeX distribution files into frontend/vendor/katex/
 * Run once after `npm install` to make KaTeX available as static assets.
 *
 * Usage:  node scripts/vendorKatex.js
 */

import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "node_modules", "katex", "dist");
const DEST = join(ROOT, "frontend", "vendor", "katex");

if (!existsSync(SRC)) {
  console.error("KaTeX dist not found. Run `npm install` first.");
  process.exit(1);
}

mkdirSync(DEST, { recursive: true });

// Copy core files
for (const file of ["katex.min.js", "katex.min.css"]) {
  cpSync(join(SRC, file), join(DEST, file));
  console.log(`  copied ${file}`);
}

// Copy fonts directory
const fontsSrc = join(SRC, "fonts");
const fontsDest = join(DEST, "fonts");
if (existsSync(fontsSrc)) {
  cpSync(fontsSrc, fontsDest, { recursive: true });
  console.log("  copied fonts/");
}

console.log("KaTeX vendor files ready in frontend/vendor/katex/");
