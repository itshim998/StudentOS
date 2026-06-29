import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CLASSROOM_WRITE_ACTIONS,
  FEATURE_KEYS,
  canUseClassroomAction,
  canUseFeature,
  getPublicPlanSummaries,
} from "./domain/planEntitlementService.js";

const app = await readFile(new URL("../frontend/scripts/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../frontend/styles/main.css", import.meta.url), "utf8");
const docs = await readFile(new URL("../docs/PASS35_5_PRICING_UI.md", import.meta.url), "utf8");
const publicPlans = getPublicPlanSummaries();

assert.deepEqual(publicPlans.map((plan) => plan.priceDisplay), [
  "₹99/month",
  "₹159/month",
  "₹259/month",
  "₹549/month",
]);
assert.equal(publicPlans.filter((plan) => plan.recommended).length, 1);
assert.equal(publicPlans.find((plan) => plan.recommended)?.planKey, "essential");

for (const field of ["positioning", "featureBullets", "bestFor", "recommended", "planKey", "priceDisplay"]) {
  assert(app.includes(`plan.${field}`) || app.includes(`plan?.${field}`), `pricing renderer must consume ${field}`);
}
assert(app.includes("function planSummaryCardMarkup"));
assert(app.includes('const PAID_PRODUCT_PLAN_KEYS = Object.freeze(["starter", "essential", "plus", "pro"])'));
assert(app.includes("normalizedProductPlanKey(button.dataset.planId)"));
assert(app.includes("normalizedProductPlanKey(button.dataset.planPreview)"));
assert(app.includes('data-plan-key="${escapeHtml(planKey)}"'));
assert(app.includes("Trial features are different from"));
assert(app.includes("plan stays saved while Trial Mode is active"));
assert(app.includes('label: "Plan setup pending"'));
assert.equal(app.includes('return "Legacy access"'), false);

for (const plan of publicPlans) {
  for (const bullet of plan.featureBullets) {
    assert.equal(app.includes(bullet), false, `frontend must not duplicate backend plan copy: ${bullet}`);
  }
}

const pricingRendererStart = app.indexOf("function publicPlanSummaries");
const pricingRendererEnd = app.indexOf("function renderProductProgress");
const pricingRenderer = app.slice(pricingRendererStart, pricingRendererEnd);
assert(pricingRendererStart >= 0 && pricingRendererEnd > pricingRendererStart);
assert.doesNotMatch(
  pricingRenderer,
  /\b(storage|GB|MB|tokens?|model|provider|Groq|Gemini|Pollinations|Supabase|backend|database|embeddings?|vectors?|chunks?|writeback|OAuth|API|rate limit|auto-submit)\b/i,
);

assert(css.includes(".plan-summary-card.recommended"));
assert(css.includes(".plan-recommended-badge"));
assert(css.includes(".plan-best-for"));
assert(css.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"));

for (const planKey of ["trial", "starter", "essential", "plus", "pro"]) {
  assert.equal(canUseFeature(planKey, FEATURE_KEYS.ASSIGNMENT_WRITEBACK), false);
  for (const action of CLASSROOM_WRITE_ACTIONS) {
    assert.equal(canUseClassroomAction(planKey, action), false);
  }
}

assert(docs.includes("public entitlement summaries"));
assert(docs.includes("Essential"));
assert(docs.includes("Trial Mode"));
assert(docs.includes("read-only"));

console.log(JSON.stringify({
  pass: "35.5",
  pricingSource: "public entitlement summaries",
  plans: publicPlans.map((plan) => plan.priceDisplay),
  recommendedPlan: "essential",
  realPaymentEnabled: false,
  classroomWritebackEnabled: false,
  secretsPrinted: false,
}, null, 2));
