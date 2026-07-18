import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getAccountSnapshot,
  updateConsentPreferences,
} from "./account/accountService.js";
import {
  createRoleInvitationGroundwork,
  getAccountLifecycleConfig,
  recordLegalAcceptance,
} from "./account/lifecycleService.js";
import { getSaasConfig } from "./config/saasConfig.js";
import { initialStateForUser } from "./repository/studentOsRepository.js";

const root = new URL("../", import.meta.url);
const [html, frontendJs, css] = await Promise.all([
  readFile(new URL("frontend/index.html", root), "utf8"),
  readFile(new URL("frontend/scripts/app.js", root), "utf8"),
  readFile(new URL("frontend/styles/main.css", root), "utf8"),
]);

const accountMarkup = html.match(/<section class="view" id="view-account"[\s\S]*?<\/main>/)?.[0] || "";
assert(accountMarkup.includes('id="consent-form"'));
assert.equal((accountMarkup.match(/class="consent-option"/g) || []).length, 3);
assert(accountMarkup.includes("Use my StudentOS activity to personalize tutoring."));
assert(accountMarkup.includes("Allow de-identified quality review to improve StudentOS."));
assert(accountMarkup.includes("Allow progress sharing outside my account only after I approve it."));
assert.doesNotMatch(accountMarkup, /Terms and privacy notice|Record acceptance|Acceptance recorded/i);
assert.doesNotMatch(accountMarkup, /Prepare family or mentor|Access sharing|Preview sharing safeguards|Family access/i);
assert.doesNotMatch(accountMarkup, /Request withdrawal/i);
assert.doesNotMatch(html, /rail-session-card|rail-session-status|rail-session-help/);
assert(html.includes('id="profile-menu"'));
assert(html.includes('id="profile-email"'));
assert(html.includes('id="profile-account-settings"'));
assert(html.includes('id="logout-btn"'));
assert(frontendJs.includes('closeProfileMenu({ restoreFocus: true })'));
assert(frontendJs.includes('setView("account")'));

const passStyles = css.split("/* PASS 36.3: page-scoped de-boxing.")[1] || "";
assert(passStyles.includes("#view-account .consent-option"));
assert(passStyles.includes("grid-template-columns: 20px minmax(0, 1fr)"));
assert(passStyles.includes("#view-courses .course-card"));
assert(passStyles.includes("#view-memory .academic-context-card"));
assert(css.includes("#view-studio .studio-primary-workflow"));
assert.doesNotMatch(passStyles, /#view-today|#view-study/);

const state = initialStateForUser({ id: "pass363_student", email: "pass363@studentos.local" });
const config = getAccountLifecycleConfig({});
const session = {
  authenticated: true,
  mode: "supabase_auth",
  user: { id: state.studentProfile.id, email: "pass363@studentos.local" },
};
const saasConfig = getSaasConfig({ env: {}, supabaseConfig: { mode: "mock" } });

const unchangedAuditCount = state.auditLog.length;
const unchangedConsentCount = state.userConsents.length;
updateConsentPreferences(state, {
  aiPersonalization: true,
  productResearch: false,
  externalProgressSharing: false,
}, new Date("2026-07-18T08:00:00.000Z"), config);
assert.equal(state.auditLog.length, unchangedAuditCount);
assert.equal(state.userConsents.length, unchangedConsentCount);

const grantTime = new Date("2026-07-18T08:05:00.000Z");
updateConsentPreferences(state, { productResearch: true }, grantTime, config);
let researchConsent = state.userConsents.find((item) => item.consentKey === "productResearch");
assert.equal(state.studentProfile.preferences.consent.productResearch, true);
assert.equal(researchConsent.granted, true);
assert.equal(researchConsent.status, "granted");
assert.equal(researchConsent.withdrawnAt, null);

const auditCountAfterGrant = state.auditLog.length;
updateConsentPreferences(state, { productResearch: true }, new Date("2026-07-18T08:06:00.000Z"), config);
assert.equal(state.auditLog.length, auditCountAfterGrant, "Idempotent saves must not append duplicate events");

const withdrawalTime = new Date("2026-07-18T08:10:00.000Z");
updateConsentPreferences(state, { productResearch: false }, withdrawalTime, config);
researchConsent = state.userConsents.find((item) => item.consentKey === "productResearch");
assert.equal(state.studentProfile.preferences.consent.productResearch, false);
assert.equal(researchConsent.granted, false);
assert.equal(researchConsent.status, "withdrawal_requested");
assert.equal(researchConsent.withdrawnAt, withdrawalTime.toISOString());
assert(state.auditLog.some((event) =>
  event.action === "account.consent_withdrawal.requested" &&
  event.metadata.consentKey === "productResearch"));

updateConsentPreferences(state, { productResearch: true }, new Date("2026-07-18T08:15:00.000Z"), config);
researchConsent = state.userConsents.find((item) => item.consentKey === "productResearch");
assert.equal(researchConsent.status, "granted");
assert.equal(researchConsent.withdrawnAt, null);

const multiChangeTime = new Date("2026-07-18T08:17:00.000Z");
updateConsentPreferences(state, {
  aiPersonalization: false,
  externalProgressSharing: true,
  productResearch: true,
}, multiChangeTime, config);
const personalizationConsent = state.userConsents.find((item) => item.consentKey === "aiPersonalization");
const sharingConsent = state.userConsents.find((item) => item.consentKey === "externalProgressSharing");
assert.equal(personalizationConsent.status, "withdrawal_requested");
assert.equal(personalizationConsent.withdrawnAt, multiChangeTime.toISOString());
assert.equal(sharingConsent.status, "granted");
const auditCountAfterMultiChange = state.auditLog.length;
updateConsentPreferences(state, {
  aiPersonalization: false,
  externalProgressSharing: true,
  productResearch: true,
}, new Date("2026-07-18T08:18:00.000Z"), config);
assert.equal(state.auditLog.length, auditCountAfterMultiChange, "Retrying the same multi-preference save must be idempotent");

const acceptance = recordLegalAcceptance(state, {
  accepted: true,
  acceptanceSource: "required_product_flow",
}, config, new Date("2026-07-18T08:20:00.000Z"));
assert.equal(acceptance.acceptanceSource, "required_product_flow");
const snapshot = getAccountSnapshot({ session, state, saasConfig, lifecycleConfig: config });
assert.equal(snapshot.lifecycle.legal.accepted, true);
assert.equal(state.legalAcceptances.length, 1);

const invitation = createRoleInvitationGroundwork(state, {
  role: "guardian_future",
  explicitStudentConsent: false,
}, config, new Date("2026-07-18T08:25:00.000Z"));
assert.equal(invitation.enabled, false);
assert.equal(invitation.studentConsentRequired, true);

console.log("PASS | StudentOS Pass 36.3 account and UI simplification tests passed");
