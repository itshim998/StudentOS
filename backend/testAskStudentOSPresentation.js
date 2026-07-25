import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

await import("../frontend/scripts/ai-response-enhancements.js");
await import("../frontend/scripts/ai-drawer-adaptive-layout.js");
const {
  completeWordPrefix,
  normalizeLooseMarkdownHeadings,
  renderProgressiveMarkdown,
} = globalThis.StudentOSAiResponseEnhancements || {};
const {
  normalizedVisibleText,
  isRedundantPreparingState,
  responseContainsTable,
  syncAdaptiveDrawer,
} = globalThis.StudentOSAiDrawerAdaptiveLayout || {};

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
globalThis.katex = {
  renderToString(source, options) {
    return `<span data-display="${options.displayMode}">${source}</span>`;
  },
};
assert.match(renderProgressiveMarkdown("Use $x^2$ here."), /data-display="false">x\^2<\/span>/);
delete globalThis.katex;

assert.equal(normalizedVisibleText("  Preparing   your answer...  "), "Preparing your answer...");
assert.equal(typeof syncAdaptiveDrawer, "function");

function fakeClassList() {
  const values = new Set();
  return {
    toggle(name, force) {
      if (force) values.add(name);
      else values.delete(name);
    },
    contains(name) {
      return values.has(name);
    },
  };
}

const response = {
  textContent: "Preparing your answer...",
  classList: fakeClassList(),
  dataset: {},
  attributes: new Map(),
  setAttribute(name, value) {
    this.attributes.set(name, value);
  },
  removeAttribute(name) {
    this.attributes.delete(name);
  },
  querySelector() {
    return null;
  },
};
const panel = {
  classList: fakeClassList(),
  dataset: {},
};
assert.equal(isRedundantPreparingState(response), true);
assert.equal(responseContainsTable(response), false);
assert.deepEqual(syncAdaptiveDrawer(panel, response), { preparingSuppressed: true, tableExpanded: false });
assert.equal(response.classList.contains("studentos-ai-loading-suppressed"), true);
assert.equal(panel.classList.contains("studentos-ai-table-expanded"), false);
assert.equal(response.attributes.get("aria-hidden"), "true");

response.textContent = "Answer content";
response.querySelector = () => ({ tagName: "TABLE" });
assert.deepEqual(syncAdaptiveDrawer(panel, response), { preparingSuppressed: false, tableExpanded: true });
assert.equal(response.classList.contains("studentos-ai-loading-suppressed"), false);
assert.equal(panel.classList.contains("studentos-ai-table-expanded"), true);
assert.equal(response.attributes.has("aria-hidden"), false);
assert.equal(panel.dataset.studentosLayout, "table");

const currentFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(currentFile), "..");
const runtimeConfig = fs.readFileSync(path.join(root, "frontend", "runtime-config.js"), "utf8");
const configWriter = fs.readFileSync(path.join(root, "scripts", "writeCloudflareFrontendConfig.js"), "utf8");
const enhancement = fs.readFileSync(path.join(root, "frontend", "scripts", "ai-response-enhancements.js"), "utf8");
const adaptiveDrawer = fs.readFileSync(path.join(root, "frontend", "scripts", "ai-drawer-adaptive-layout.js"), "utf8");

for (const loader of [runtimeConfig, configWriter]) {
  assert.match(loader, /studentos-ai-response-enhancements-script/);
  assert.match(loader, /\/scripts\/ai-response-enhancements\.js/);
  assert.match(loader, /studentos-ai-adaptive-drawer-script/);
  assert.match(loader, /\/scripts\/ai-drawer-adaptive-layout\.js/);
}
assert.match(enhancement, /#ai-panel > \.contract-zone/);
assert.match(enhancement, /\/api\/ai\/verb/);
assert.match(enhancement, /MutationObserver/);
assert.match(enhancement, /studentosProgressive/);
assert.match(adaptiveDrawer, /Preparing your answer/);
assert.match(adaptiveDrawer, /studentos-ai-loading-suppressed/);
assert.match(adaptiveDrawer, /studentos-ai-table-expanded/);
assert.match(adaptiveDrawer, /width 340ms/);
assert.match(adaptiveDrawer, /max-width: 860px/);

console.log("Ask StudentOS presentation checks passed.");
