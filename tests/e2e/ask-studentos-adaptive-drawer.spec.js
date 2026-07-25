import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ADAPTIVE_DRAWER_SCRIPT = path.join(ROOT, "frontend", "scripts", "ai-drawer-adaptive-layout.js");

async function mountDrawer(page) {
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style>
          * { box-sizing: border-box; }
          html, body { width: 100%; min-height: 100%; margin: 0; }
          body { font-family: Arial, sans-serif; background: #eef4ef; }
          .ai-panel {
            position: fixed;
            top: 24px;
            right: 24px;
            bottom: 24px;
            width: min(420px, calc(100vw - 32px));
            padding: 18px;
            overflow: auto;
            border: 1px solid #d8e1da;
            border-radius: 22px;
            background: white;
          }
          .ai-form { display: grid; gap: 10px; width: 100%; }
          textarea, button { width: 100%; }
          textarea { min-height: 120px; }
          button { min-height: 42px; }
          #ai-response {
            width: 100%;
            margin-top: 12px;
            padding: 16px;
            background: #edf7f1;
          }
          .study-academic-copy { width: 100%; }
          .study-generated-table-wrap { max-width: 100%; overflow-x: auto; }
          table { border-collapse: collapse; }
          th, td { padding: 8px; border: 1px solid #ccd8cf; text-align: left; }
          .after-table { margin-top: 16px; }
          @media (max-width: 860px) {
            .ai-panel {
              inset: auto 12px 12px;
              top: 12px;
              width: auto;
            }
          }
        </style>
      </head>
      <body>
        <aside id="ai-panel" class="ai-panel" aria-label="Ask StudentOS">
          <form class="ai-form">
            <textarea>Why cannot a CPU be used for AI instead of GPU?</textarea>
            <button type="submit">Running...</button>
          </form>
          <div id="ai-response" aria-busy="true">
            <span>Preparing your answer...</span>
          </div>
        </aside>
      </body>
    </html>
  `);
  await page.addScriptTag({ path: ADAPTIVE_DRAWER_SCRIPT });
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.StudentOSAiDrawerAdaptiveLayout))).toBe(true);
}

test.describe("Ask StudentOS adaptive table drawer", () => {
  test("shows only Running while the answer request is pending", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mountDrawer(page);

    const response = page.locator("#ai-response");
    await expect(page.getByRole("button", { name: "Running..." })).toBeVisible();
    await expect(response).toHaveClass(/studentos-ai-loading-suppressed/);
    await expect(response).toHaveCSS("display", "none");
    await expect(response).toHaveAttribute("aria-hidden", "true");

    await response.evaluate((element) => {
      element.removeAttribute("aria-busy");
      element.innerHTML = '<strong>StudentOS response</strong><div class="study-academic-copy"><p>A CPU can run AI workloads.</p></div>';
    });

    await expect(response).not.toHaveClass(/studentos-ai-loading-suppressed/);
    await expect(response).not.toHaveAttribute("aria-hidden", "true");
    await expect(response).toBeVisible();
  });

  test("expands leftward for tables and lets all answer content use the wider layout", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mountDrawer(page);

    const panel = page.locator("#ai-panel");
    const response = page.locator("#ai-response");
    await response.evaluate((element) => {
      element.removeAttribute("aria-busy");
      element.innerHTML = '<strong>StudentOS response</strong><div class="study-academic-copy"><p>Initial answer without a table.</p></div>';
    });
    await expect(response).toBeVisible();

    const before = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    expect(before.width).toBeLessThan(500);

    await response.evaluate((element) => {
      element.innerHTML = `
        <strong>StudentOS response</strong>
        <div class="study-academic-copy">
          <p>Short answer: CPUs can run AI, but GPUs are usually faster for parallel workloads.</p>
          <div class="study-generated-table-wrap">
            <table>
              <thead><tr><th>Aspect</th><th>CPU</th><th>GPU</th><th>Best use</th></tr></thead>
              <tbody>
                <tr><td>Core design</td><td>Few powerful cores</td><td>Many parallel cores</td><td>Different workloads</td></tr>
                <tr><td>AI training</td><td>Possible but slower</td><td>Highly efficient</td><td>GPU preferred</td></tr>
              </tbody>
            </table>
          </div>
          <p class="after-table">Inference and the explanatory text below the table must use the same expanded answer width without being clipped or forced into the old narrow column.</p>
        </div>
      `;
    });

    await expect(panel).toHaveClass(/studentos-ai-table-expanded/);
    await expect.poll(async () => panel.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(760);

    const after = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const transition = getComputedStyle(element).transition;
      return { left: rect.left, right: rect.right, width: rect.width, transition };
    });
    expect(after.width).toBeGreaterThan(before.width + 300);
    expect(after.left).toBeLessThan(before.left - 300);
    expect(Math.abs(after.right - before.right)).toBeLessThanOrEqual(1);
    expect(after.transition).toContain("width");

    const layout = await page.evaluate(() => {
      const panelRect = document.getElementById("ai-panel").getBoundingClientRect();
      const responseRect = document.getElementById("ai-response").getBoundingClientRect();
      const paragraphRect = document.querySelector(".after-table").getBoundingClientRect();
      const tableWrap = document.querySelector(".study-generated-table-wrap");
      return {
        responseWidth: responseRect.width,
        paragraphWidth: paragraphRect.width,
        paragraphRight: paragraphRect.right,
        panelInnerRight: panelRect.right - 18,
        tableClientWidth: tableWrap.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(layout.responseWidth).toBeGreaterThan(700);
    expect(layout.paragraphWidth).toBeGreaterThan(650);
    expect(layout.paragraphRight).toBeLessThanOrEqual(layout.panelInnerRight + 1);
    expect(layout.tableClientWidth).toBeGreaterThan(650);
    expect(layout.documentOverflow).toBeLessThanOrEqual(1);

    await response.evaluate((element) => {
      element.innerHTML = '<strong>StudentOS response</strong><div class="study-academic-copy"><p>A later answer without a table.</p></div>';
    });
    await expect(panel).not.toHaveClass(/studentos-ai-table-expanded/);
    await expect.poll(async () => panel.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(500);
  });

  test("keeps table answers inside the viewport on compact screens", async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 820 });
    await mountDrawer(page);

    const panel = page.locator("#ai-panel");
    const response = page.locator("#ai-response");
    await response.evaluate((element) => {
      element.removeAttribute("aria-busy");
      element.innerHTML = `
        <div class="study-academic-copy">
          <div class="study-generated-table-wrap">
            <table>
              <thead><tr><th>Aspect</th><th>CPU</th><th>GPU</th><th>Notes</th></tr></thead>
              <tbody><tr><td>Parallelism</td><td>Lower</td><td>Higher</td><td>Workload dependent</td></tr></tbody>
            </table>
          </div>
          <p class="after-table">The rest of the answer remains readable below the table.</p>
        </div>
      `;
    });

    await expect(panel).toHaveClass(/studentos-ai-table-expanded/);
    const compact = await page.evaluate(() => {
      const panelRect = document.getElementById("ai-panel").getBoundingClientRect();
      const wrap = document.querySelector(".study-generated-table-wrap");
      return {
        left: panelRect.left,
        right: panelRect.right,
        viewport: window.innerWidth,
        scrollable: wrap.scrollWidth >= wrap.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(compact.left).toBeGreaterThanOrEqual(0);
    expect(compact.right).toBeLessThanOrEqual(compact.viewport);
    expect(compact.scrollable).toBe(true);
    expect(compact.documentOverflow).toBeLessThanOrEqual(1);
  });
});
