import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

await import("../frontend/scripts/ai-response-enhancements.js");
const {
  completeWordPrefix,
  normalizeLooseMarkdownHeadings,
  renderProgressiveMarkdown,
} = globalThis.StudentOSAiResponseEnhancements || {};

assert.equal(typeof completeWordPrefix, "function");
assert.equal(completeWordPrefix("Hello wor"), "Hello ");
assert.equal(completeWordPrefix("Hello world "), "Hello world ");
assert.equal(completeWordPrefix("Single"), "");

const looseHeading = "This is the overview. ### Quick study tip";
const normalized = normalizeLooseMarkdownHeadings(looseHeading);
assert.match(normalized, /overview\.\n\n### Quick study tip/);
const looseHeadingMarkup = renderProgressiveMarkdown(looseHeading);
assert.match(looseHeadingMarkup, /<h6>Quick study tip<\/h6>/);
assert.doesNotMatch(looseHeadingMarkup, /###/);

assert.equal(renderProgressiveMarkdown("### Subheading"), "<h6>Subheading</h6>");
assert.match(renderProgressiveMarkdown("Use **active recall** now."), /<strong>active recall<\/strong>/);
assert.match(renderProgressiveMarkdown("| Topic | Time |\n| --- | --- |\n| Recall | 15 min |"), /<table>/);
assert.match(renderProgressiveMarkdown("```md\n### literal\n```"), /<code>### literal<\/code>/);
assert.equal(renderProgressiveMarkdown("### "), "");

const currentFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(currentFile), "..");
const runtimeConfig = fs.readFileSync(path.join(root, "frontend", "runtime-config.js"), "utf8");
const configWriter = fs.readFileSync(path.join(root, "scripts", "writeCloudflareFrontendConfig.js"), "utf8");
const enhancement = fs.readFileSync(path.join(root, "frontend", "scripts", "ai-response-enhancements.js"), "utf8");

for (const loader of [runtimeConfig, configWriter]) {
  assert.match(loader, /studentos-ai-response-enhancements-script/);
  assert.match(loader, /\/scripts\/ai-response-enhancements\.js/);
}
assert.match(enhancement, /#ai-panel > \.contract-zone/);
assert.match(enhancement, /\/api\/ai\/verb/);
assert.match(enhancement, /MutationObserver/);
assert.match(enhancement, /studentosProgressive/);

console.log("Ask StudentOS presentation checks passed.");
