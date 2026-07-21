import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const roots = ["backend", "scripts"];
const files = [];

function collect(relativeDirectory) {
  for (const entry of readdirSync(relativeDirectory)) {
    const relativePath = path.join(relativeDirectory, entry);
    const stat = statSync(relativePath);
    if (stat.isDirectory()) collect(relativePath);
    else if (relativePath.endsWith(".js")) files.push(relativePath);
  }
}

for (const root of roots) collect(root);

const failures = [];
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) failures.push({ file, error: String(result.stderr || result.stdout || "syntax_check_failed").trim().slice(0, 500) });
}

console.log(JSON.stringify({
  ok: failures.length === 0,
  checkedFiles: files.length,
  failures,
  secretsPrinted: false,
}, null, 2));

if (failures.length) process.exit(1);
