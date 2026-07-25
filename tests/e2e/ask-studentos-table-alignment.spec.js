import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ADAPTIVE_DRAWER_SCRIPT = path.join(ROOT, "frontend", "scripts", "ai-drawer-adaptive-layout.js");

async function mountResponse(page, tableMarkup) {
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, sans-serif; }
          .ai-panel { width: 800px; padding: 18px; }
          .study-generated-table-wrap { width: 100%; overflow-x: auto; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ccd8cf; padding: 8px; text-align: left; }
        </style>
      </head>
      <body>
        <aside id="ai-panel" class="ai-panel">
          <div id="ai-response">
            <div class="study-academic-copy">
              <div class="study-generated-table-wrap">${tableMarkup}</div>
              <p id="after-table">Explanation below the table remains part of the answer.</p>
            </div>
          </div>
        </aside>
      </body>
    </html>
  `);
  await page.addScriptTag({ path: ADAPTIVE_DRAWER_SCRIPT });
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.StudentOSAiDrawerAdaptiveLayout))).toBe(true);
}

test.describe("Ask StudentOS table column alignment", () => {
  test("moves an accidental title header into a caption and restores the intended columns", async ({ page }) => {
    await mountResponse(page, `
      <table>
        <thead>
          <tr>
            <th>Stemming vs. Lemmatization - Quick Comparison</th>
            <th>Aspect</th>
            <th>Stemming</th>
            <th>Lemmatization</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Goal</td><td>Strip a word to a crude stem</td><td>Reduce a word to its lemma</td><td></td></tr>
          <tr><td>Method</td><td>Heuristic string rules</td><td>Morphological analysis</td><td></td></tr>
        </tbody>
      </table>
    `);

    const table = page.locator("table");
    await expect(table).toHaveAttribute("data-studentos-column-alignment", "repaired");
    await expect(table.locator("caption")).toHaveText("Stemming vs. Lemmatization - Quick Comparison");
    await expect(table.locator("thead th")).toHaveCount(3);
    await expect(table.locator("thead th").nth(0)).toHaveText("Aspect");
    await expect(table.locator("thead th").nth(1)).toHaveText("Stemming");
    await expect(table.locator("thead th").nth(2)).toHaveText("Lemmatization");

    const firstRow = table.locator("tbody tr").first();
    await expect(firstRow.locator("td")).toHaveCount(3);
    await expect(firstRow.locator("td").nth(0)).toHaveText("Goal");
    await expect(firstRow.locator("td").nth(1)).toHaveText("Strip a word to a crude stem");
    await expect(firstRow.locator("td").nth(2)).toHaveText("Reduce a word to its lemma");
    await expect(page.locator("#after-table")).toBeVisible();
  });

  test("does not alter a correctly aligned table", async ({ page }) => {
    await mountResponse(page, `
      <table>
        <thead><tr><th>Aspect</th><th>Stemming</th><th>Lemmatization</th></tr></thead>
        <tbody><tr><td>Goal</td><td>Produce a stem</td><td>Produce a lemma</td></tr></tbody>
      </table>
    `);

    const table = page.locator("table");
    await expect(table.locator("caption")).toHaveCount(0);
    await expect(table.locator("thead th")).toHaveCount(3);
    await expect(table.locator("tbody td")).toHaveCount(3);
    await expect(table).not.toHaveAttribute("data-studentos-column-alignment", "repaired");
  });
});
