# PASS 35.0 Antigravity Candidate Audit

## Executive summary

The Antigravity/Gemini candidate is **not safe to merge as-is**.

Recommended next step: **C. merge selected CSS/HTML but reject app.js**. In practice, the candidate HTML is unchanged, so the next implementation pass should be **PASS 35.1 - selective Antigravity CSS extraction**: port only the useful visual polish into the real `frontend/styles/main.css` after rewriting it to remove external fonts, broad `!important` overrides, heavy blur/glassmorphism, hover movement, and encoding issues.

The production frontend in `frontend/` was not modified during this audit. The candidate folder `frontend StudentOS Antigravity/` remains review-only.

## Files compared

Compared production frontend files against the Antigravity candidate:

- `frontend/index.html`
- `frontend/styles/main.css`
- `frontend/scripts/app.js`
- `frontend/auth-complete.html`
- `frontend/operator.html`
- `frontend/runtime-config.js`
- `frontend/scripts/config.js`
- `frontend/scripts/auth-complete.js`
- `frontend/scripts/operator.js`

Observed candidate differences:

- `scripts/app.js`: candidate adds a large local mock API router before the real `api()` fetch path.
- `styles/main.css`: candidate adds an appended premium polish layer and imports Google Fonts.
- HTML entrypoints, runtime config, auth-complete script, operator script, and config script are effectively unchanged.

## Safe changes to accept

Safe to consider in a later selective rewrite:

- Softer card borders, spacing, and panel depth where they do not disrupt existing layout density.
- More refined segmented styling for AI verb tabs.
- Better button polish when implemented with existing tokens and without `transition: all`.
- Subtle focus and input states, provided they preserve contrast and keyboard visibility.
- Selective pricing card polish if rewritten without broad overrides.
- Some navigation and launcher treatment if rewritten with existing motion and reduced-motion rules.

These should be manually ported into `frontend/styles/main.css` rather than copied wholesale.

## Risky changes to reject or rewrite

Reject or rewrite before any production merge:

- Candidate `scripts/app.js` as a whole.
- The Google Fonts import from `fonts.googleapis.com`.
- Broad `!important` overrides across cards, inputs, buttons, navigation, AI drawer, and pricing.
- Heavy `backdrop-filter` blur/glassmorphism on the AI drawer and scrim.
- Hover movement such as `translateY`, `scale`, and nav padding shifts that can feel jumpy and create layout instability.
- Negative letter spacing in compact app surfaces.
- `transition: all`, which can animate unintended properties and make regressions harder to trace.
- Mojibake content `âœ“` in the pricing feature checkmark.

## app.js/mock router risk assessment

The candidate mock router is directionally gated away from the known production frontend hosts:

- It only activates when `window.location.hostname` is `localhost`, `127.0.0.1`, an empty hostname, or when `window.location.protocol` is `file:`.
- It preserves the existing public-host guard for `studentos.sentiqlabs.com` and `studentos-39s.pages.dev`.
- It does not appear intended to intercept production `studentos.sentiqlabs.com` or the Cloudflare Pages default domain.

However, the candidate `app.js` should still be rejected for production merge because it inserts a large localStorage-backed mock layer ahead of every real API call. It handles many production-critical paths, including:

- `/api/config`
- `/api/bootstrap`
- `/api/account`
- the former `/api/demo/seed` path (removed by the runtime demo-data purge)
- `/api/onboarding`
- `/api/sources/upload`
- source delete and reindex routes
- `/api/tests/score`
- `/api/extension/draft`
- `/api/assignment-flow`
- `/api/assignment-contract`
- `/api/ai/verb`
- account consent, export, deletion, guardian preview routes
- billing preview routes
- Classroom status, OAuth start, sync, and disconnect routes
- auth password reset and verification resend routes
- failed source job retry route

That amount of local mock behavior can mask backend/API regressions during local or static preview testing. It also adds a second behavioral model for account lifecycle, billing preview, Classroom, source upload, and AI responses. Even if the current production host gate is correct, this layer is too broad to merge into the production app without a separate, explicit demo-mode architecture and tests.

If a local preview mode is desired later, it should be isolated behind a dedicated development-only file or build-time flag, with tests proving it cannot run on Cloudflare production or override a valid Azure backend response.

## CSS/style quality assessment

The candidate CSS contains useful visual direction but should not be copied directly.

Positive qualities:

- Reduces some boxiness with softer cards and button treatment.
- Adds stronger visual hierarchy to cards, forms, AI tabs, pricing, and the launcher.
- Moves the UI closer to a polished SaaS surface.

Concerns:

- External font import creates a new runtime dependency and should be avoided for this static production frontend.
- The appended polish layer relies heavily on `!important`, making future maintenance and regression isolation harder.
- Heavy blur/glass effects can hurt performance on lower-power devices and mobile browsers.
- Hover transforms and nav padding shifts may introduce motion and layout instability.
- The CSS adds aesthetic changes broadly rather than through scoped design tokens.
- One generated checkmark is encoded incorrectly as `âœ“`.

Recommended CSS strategy: extract only the intent, then rewrite it into the existing dark theme/token system with restrained motion, no external assets, no broad overrides, no glass-heavy drawer, and no mojibake.

## DOM hook preservation assessment

The candidate preserves the key production DOM hooks because the candidate HTML is unchanged and candidate `app.js` still references the expected elements.

Protected hooks observed as preserved:

- Auth: `auth-form`, `auth-email`, `auth-password`, `signin-btn`, `signup-btn`, `password-reset-btn`, `reset-password-btn`, `auth-result`, `auth-session`, `auth-help`
- AI drawer: `ai-form`, `ai-message`, `ai-response`, `.verb-tab`, `data-verb`, contextual `data-ai-open` behavior
- Sources: `source-form`, `source-course-select`, `source-file`, `source-result`, `source-list`, `data-delete-source-id`, `data-reindex-source-id`, `data-retry-failed-jobs`
- Classroom: `classroom-panel`, `classroom-connect-btn`, `classroom-sync-btn`, `classroom-disconnect-btn`
- Pricing: `#pricing`, `pricing-panel`, `data-plan-preview`, `manage-billing-btn`
- Account lifecycle: `export-request-btn`, `deletion-request-btn`, `data-download-export-id`, `data-deletion-dry-run-id`
- Runtime config: `runtime-config.js`, `window.StudentOSRuntimeConfig`, `window.StudentOSConfig.apiBase`

Even though the hooks are preserved, candidate `app.js` changes behavior by routing many actions through local mock responses in local/static contexts. Hook preservation alone is not enough to make it safe.

## Backend/API compatibility assessment

The real production frontend expects Azure backend JSON responses through `window.StudentOSConfig.apiBase`, populated by `runtime-config.js` and Cloudflare's public `STUDENTOS_PUBLIC_API_BASE_URL` flow.

The candidate preserves the same public API base guard:

- `studentos.sentiqlabs.com`
- `studentos-39s.pages.dev`
- same API-base misconfiguration message

Production backend/API compatibility risk is concentrated in the candidate mock router:

- It can bypass the real backend in local/static previews.
- It can hide missing Azure routes, bad JSON responses, CORS failures, auth/session regressions, source upload issues, Classroom OAuth/sync issues, account lifecycle regressions, and billing preview regressions.
- It implements many simplified response shapes that may drift from backend contracts.

Do not merge candidate `app.js` into `frontend/scripts/app.js`.

## Production safety assessment

Safe:

- Candidate files are isolated under `frontend StudentOS Antigravity/`.
- Known production hosts remain in the public frontend host guard.
- `node --check` passes for the candidate `scripts/app.js`.
- No candidate secrets were found in the inspected frontend files.
- HTML entrypoints and runtime config files are effectively unchanged.

Unsafe for direct merge:

- Candidate `app.js` introduces broad mock interception before real API calls.
- Candidate CSS imports an external font and relies on wide overrides.
- Visual layer includes blur, motion, and one encoding issue that need cleanup.

Production merge verdict: **not safe as-is**.

## Mobile/responsive notes

The candidate CSS keeps the existing responsive structure, but the appended polish layer adds risks:

- Heavy blur on the AI drawer/scrim can be expensive on mobile.
- Hover transforms do not add value on touch devices and can create inconsistency.
- Broad `!important` spacing and padding overrides may affect compact layout balance.
- The existing e2e responsive overflow test passed against the current production frontend, not the candidate merged into production.

Any future mobile polish should be tested with the candidate-inspired CSS rewritten into the real stylesheet and validated in both desktop and mobile Playwright viewports.

## Recommended next step

Choose **C. merge selected CSS/HTML but reject app.js**.

Because the candidate HTML is effectively unchanged, the concrete next pass should be:

**PASS 35.1 - selective Antigravity CSS extraction**

Pass 35.1 should:

- Leave `frontend/scripts/app.js` unchanged unless a separate, explicit demo-mode design is requested.
- Keep `frontend/index.html`, `auth-complete.html`, `operator.html`, `runtime-config.js`, backend, deployment, secrets, and GitHub Actions unchanged.
- Recreate only the safe visual improvements in `frontend/styles/main.css`.
- Remove external font dependency, `!important` spread, heavy blur, hover movement, `transition: all`, negative letter spacing, and mojibake.
- Run `npm.cmd run preflight`, `node --check frontend/scripts/app.js`, `git diff --check`, and `npm.cmd run test:e2e`.

Do not ask Gemini for another clone pass yet. Codex cleanup is the safer next move because the candidate has enough useful visual direction but needs production-boundary discipline before merge.

## Validation results

Read-only audit validation performed before writing this report:

- `node --check "frontend StudentOS Antigravity/scripts/app.js"`: passed.
- `node --check frontend/scripts/app.js`: passed.
- `npm.cmd run preflight`: passed.
- `npm.cmd run test`: failed because `package.json` has no generic `test` script.
- `npm.cmd run test:e2e`: passed, 4 tests passed and 1 live Supabase spec skipped.
- `git diff --check`: passed.
- `git status --short`: only untracked `# StudentOS Continuation Handoff.md` and `frontend StudentOS Antigravity/` before this report was added.

No backend, deployment, secrets, Supabase, Azure, Cloudflare, GitHub Actions, main production frontend files, SentIQ Chat, or SentIQGPT files were changed by this report-only pass.

## PASS 35.1 follow-up

PASS 35.1 followed this audit recommendation by selectively rewriting safe Antigravity-inspired visual ideas into `frontend/styles/main.css`. Candidate `scripts/app.js`, the local mock API router, candidate HTML, external fonts, broad overrides, heavy blur, and deployment/runtime surfaces were not merged.
