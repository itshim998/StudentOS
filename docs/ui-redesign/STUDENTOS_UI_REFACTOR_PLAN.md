# StudentOS UI Refactor Plan

Pass: 34.0  
Status: planning only  
Scope: StudentOS frontend planning documentation. No UI code, CSS, JS behavior, backend logic, deployment configuration, or secrets are changed by this pass.

## 1. Executive Summary

- StudentOS should feel like an AI-native academic operating layer, not a generic admin dashboard, productivity tracker, or chatbot wrapper.
- The redesigned product should lower cognitive overhead by presenting one clear academic next step at a time.
- Today becomes the command center: classes, due items, risk, next best action, and study queue.
- Courses become living academic workspaces where syllabus, topics, assignments, notes, sources, and revision state converge.
- Memory becomes the global source and knowledge layer for uploaded materials, semantic search, citations, and provenance.
- Studio becomes the focused workbench for assignment flow, testing, review, extension decisions, and later generated study artifacts.
- Account becomes quiet settings for profile, plan, quota, consent, privacy, export, deletion, and future guardian groundwork.
- AI verbs stay central, but Ask, Plan, Make, and Review should appear contextually instead of occupying permanent visual space.
- The permanent right AI sidebar should be replaced by a contextual AI command layer: floating/collapsible on desktop, drawer on tablet, bottom sheet on mobile.
- Status indicators should move from always-visible metric clutter into subtle header/status affordances.
- The first implementation pass should establish design tokens and app shell hierarchy before moving workflows.

The current UI feels busy because it exposes too many operational surfaces at once. A fixed left rail includes navigation, session/auth, and backend mode. The header includes profile, plan, credits, rhythm, eligibility, and student identity. The main content can show dense cards, forms, actions, and result panels. A permanent right AI panel also shows verb tabs, a textarea, output, and assignment contract actions. The result is a three-column cockpit where everything competes for attention.

The redesigned StudentOS should feel calm, spatial, focused, and source-grounded. The interface should quietly answer: what matters today, what course context does this belong to, what source supports it, what focused workflow is available, and what AI help is relevant now.

## 2. Current UI Audit

The current frontend is a pure HTML/CSS/JS app with three key files:

- `frontend/index.html`: one dense app shell containing rail navigation, session/auth, Today, Setup, Courses, Memory, Studio, Account, and the right AI panel.
- `frontend/scripts/app.js`: one large controller that owns rendering, navigation, auth, bootstrap, Classroom, account, billing previews, source uploads, AI verbs, and all form/event wiring.
- `frontend/styles/main.css`: one large stylesheet defining shell grid, panels, cards, buttons, inputs, responsive behavior, account layouts, and repeated later overrides.

Current clutter sources:

- The app shell uses a fixed three-column desktop grid: `244px` left rail, central workspace, and `360px` AI panel.
- The left rail combines brand, primary nav, session/auth form, reset link, logout, and backend mode status.
- The top bar exposes plan, credits, rhythm, eligibility, and student identity simultaneously.
- The Today surface shows dashboard summary, study queue, agenda, Classroom controls, Classroom status, and assignments together.
- Setup is a large first-level form with profile, subjects, weak topics, completed topics, and timetable inputs.
- Memory combines source library, queue health, uploaded source cards, retry/delete actions, and upload form in one view.
- Studio exposes assignment flow, MCQ scoring, extension drafting, tutor lesson output, and contract-related flows.
- Account exposes profile, quota, recovery, verification, legal acceptance, consent, pricing, export/deletion, and guardian groundwork as visible panels.
- The permanent AI sidebar exposes verbs, input, result output, and assignment contract action even when the current surface does not need AI.

Repeated controls and hierarchy issues:

- Multiple panels repeat `section-heading`, tags, result boxes, and action rows with similar visual weight.
- Primary and secondary actions appear across the screen without a clear "main next action" hierarchy.
- Account and safety surfaces use the same card prominence as daily academic work, making settings feel like work.
- Status tags are helpful but overused; they become visual noise when every item has many badges.
- Classroom controls appear both as Today controls and as rendered Classroom status/course cards.
- Billing and quota preview actions sit inside Account with high visual presence despite being inactive/scaffolded.

Unnecessary first-level visibility:

- Session/auth should be compact and expandable, not a permanent form in the rail.
- Plan, credits, rhythm, eligibility, backend mode, and account identity should collapse into a status cluster.
- Account legal/privacy/export/delete/billing sections should be grouped behind settings panels or progressive disclosure.
- AI contract action should live in relevant assignment/workflow contexts, not beside every screen.
- Source retry/delete controls should appear on item focus or item menu, not compete with library scanning.

Progressive disclosure recommendations:

- Use drawers for contextual AI, source detail, Classroom sync details, and account settings details.
- Use modals for focused destructive or guarded actions such as export/deletion previews.
- Use command palette for global actions: ask AI, jump to course, upload source, start review, sync Classroom.
- Use progressive panels for onboarding/setup and account/privacy sections.
- Use inline reveal for per-source retry/delete and assignment contract details.

Why the permanent right AI sidebar increases cognitive load:

- It is visually present on every surface, even when the student's immediate task is reading schedule, setting up courses, or managing account settings.
- Its verb tabs and textarea imply constant prompting instead of ambient academic support.
- It competes with Today as the command center and makes the app feel split between dashboard and chatbot.
- It duplicates workflow territory with Studio and assignment contract actions.
- On smaller screens it becomes another stacked panel rather than a context-aware helper.

## 3. New Information Architecture

### Today

Role: daily command center.

Today should answer what the student should do now. It should show classes, due items, at-risk work, next best action, and a short study queue. It should not show every metric, every connector status, or every possible action. AI should appear as contextual help for the next item, such as "Plan this block", "Review weak topic", or "Ask about this source".

### Courses

Role: living course workspaces.

Courses should organize syllabus, topics, assignments, notes, source materials, revision state, and Classroom-imported work by subject. A course view should feel like a workspace, not a card grid only. It should show current risk, upcoming work, source coverage, and relevant memory snippets.

### Memory

Role: global source library and knowledge layer.

Memory should support uploaded materials, source health, semantic search, citations/provenance, and the "where did I read this?" use case. Upload should be obvious but not dominate the library. Source status, reindex, retry, delete, OCR, and private-storage details should be available on item focus.

### Studio

Role: focused academic workflows.

Studio should hold assignment flow, MCQ scoring, review/testing, extension draft/decision support, and later generated notes, flashcards, and quizzes. It should feel like entering a work mode. Each workflow should have one clear input path, a focused output area, and a safe return to Today/Courses.

### Account

Role: quiet settings and rights controls.

Account should include profile, plan/quota, consent, privacy, export/deletion, password recovery, verification, guardian groundwork, and billing previews. These are important but should not look like academic productivity surfaces. Group them as settings categories with calm hierarchy.

### AI

Role: contextual academic copilot.

Ask, Plan, Make, and Review remain important, but AI should move from permanent sidebar to contextual command layer.

Recommended model:

- Desktop: floating AI launcher plus collapsible right drawer when active.
- Tablet: slide-over drawer anchored from the right or bottom depending viewport.
- Mobile: bottom-sheet composer with verb selector.
- Global shortcut/command palette: search/jump/start AI/action flows.
- Inline prompts: small contextual AI actions on Today tasks, course topics, sources, and Studio workflows.

This keeps AI available everywhere without making the screen feel like a chat product.

## 4. Proposed Layout Architecture

### Desktop

- Keep a left navigation rail, but make it quieter and narrower.
- Remove the permanent auth form from the default rail state; replace it with a compact account/session button and expandable popover/drawer.
- Keep the central workspace as the primary focus area.
- Move AI into a floating launcher and contextual drawer; do not reserve a permanent third column.
- Use a calm header with page title, one primary status summary, and a compact status/account menu.
- Show one primary action per surface and move secondary actions into menus/drawers.

### Tablet

- Use compact rail or top-left nav button with an overlay navigation drawer.
- Keep the current surface single-column or limited two-column.
- Open AI as a drawer, not a permanent side panel.
- Collapse status indicators into a compact row or menu.
- Preserve form usability with larger hit targets and fewer side-by-side controls.

### Mobile

- Use bottom nav or compact top navigation for Today, Courses, Memory, Studio, Account.
- Do not use permanent sidebars.
- Use AI as a bottom sheet with verb selector and contextual source/task context.
- Use single-column cards with clear section breaks.
- Move account, billing, legal, export, deletion, and guardian sections behind settings categories.

### Navigation Model

- Primary nav: Today, Courses, Memory, Studio, Account.
- Setup becomes an onboarding state accessible from Today/Account when profile is incomplete or through a profile setup action.
- Command palette exposes jump-to-surface, upload source, sync Classroom, start review, ask AI, and open settings.

### Header And Status Model

- Header should show title, short surface subtitle, and one primary action.
- Plan, credits, rhythm, eligibility, backend mode, and user identity should become a compact status/account menu.
- Backend mode should remain available for debugging and trust, but not sit as a constant rail footer headline.

### AI Exposure

- Remove the permanent right sidebar in a future implementation pass.
- Add a floating AI launcher that opens Ask/Plan/Make/Review.
- Pre-fill contextual prompts from selected task, course, source, or Studio workflow.
- Preserve `ai-form`, `ai-message`, `ai-response`, verb state, and `/api/ai/verb` behavior until a later explicit migration.

## 5. Visual Design System

### Typography Scale

- Use a restrained scale: small metadata, normal body, compact section headings, page title, and occasional command-center emphasis.
- Avoid hero-scale text inside panels, cards, forms, and settings.
- Keep letter spacing at `0`; use weight and spacing, not tight tracking, for hierarchy.

### Spacing Scale

- Use a predictable scale: 4, 8, 12, 16, 24, 32, 48.
- Increase whitespace around primary surface groups.
- Reduce nested card padding and avoid cards inside cards.
- Keep repeated controls aligned to stable grid tracks.

### Color Direction

- Keep a refined dark theme first.
- Move away from dense blue/slate dominance by adding restrained academic accents: soft green for progress, amber for risk, sky for source/context, violet only as a limited AI accent.
- Avoid large gradients, decorative blobs, and heavy glow effects.

### Dark Theme Refinement

- Use lower-contrast panel fills and stronger text hierarchy.
- Keep true alerts visually distinct but rare.
- Use subtle borders and background bands rather than many raised cards.

### Card Density

- Use cards for repeated items and focused tools only.
- Avoid floating-card page sections.
- Make Today less card-dense by grouping schedule, risk, and next action into a command-center composition.
- Make Account categories less prominent than academic work.

### Button Hierarchy

- Primary button: one main action per focused surface.
- Secondary button: safe alternate actions.
- Text button: low-priority or reveal actions.
- Icon button: refresh, menus, close, collapse, expand, upload, search.
- Destructive button: guarded, visually distinct, and never visually equal to routine actions.

### Input Styles

- Keep forms calm with clear labels, consistent spacing, and fewer side-by-side fields on small screens.
- Use progressive disclosure for long setup/profile forms.
- File upload should be a focused drop zone or compact upload action with status feedback.

### Icon Style

- Use simple line icons if an icon library is introduced later.
- Keep icons functional, not decorative.
- Use icons for navigation, refresh, upload, search, AI launcher, menu, close, settings, and status.

### Navigation States

- Active nav state should be calm but unmistakable.
- Hover/focus states must be visible.
- Avoid heavy pill stacks and high-contrast active states that compete with content.

### Badges

- Badges should be capped per item.
- Show only high-signal states by default: risk, due soon, private source, needs review, synced, blocked.
- Move technical badges such as provider, retrieval mode, storage mode, and queue internals into detail views.

### Empty States

- Empty states should be action-oriented and academic:
  - Today: set up profile or sync Classroom.
  - Courses: add course or import Classroom.
  - Memory: upload first source.
  - Studio: choose assignment or topic.
  - Account: sign in or review settings.

### Loading States

- Use small skeletons or inline loading rows.
- Keep AI loading contextual, e.g. "Reviewing source context..." rather than generic spinners.
- Do not shift layout dimensions during loading.

### Error, Success, And Toast Patterns

- Use safe, non-technical copy.
- Keep detailed backend/provider error strings out of user-facing surfaces.
- Use inline errors for forms and toasts for global confirmation.
- For API base misconfiguration, preserve the clear message introduced earlier.

### Accessibility Requirements

- Preserve labels, ARIA live regions, focus order, keyboard access, and form semantics.
- Any drawer, modal, or bottom sheet must trap focus while open and restore focus on close.
- Ensure touch targets are at least 44px on mobile.
- Maintain contrast for text, focus outlines, alerts, badges, and disabled states.

### Light Theme

- Defer light theme until the dark theme hierarchy is stable.
- Do not add theme switching in Pass 34.1.

## 6. Screen-By-Screen Redesign Plan

### Today

- Make Today the command center with one primary next action at the top.
- Show daily schedule, due work, at-risk work, and study queue in a clear priority order.
- Collapse dashboard summary into a calmer "Today brief".
- Keep Classroom status visible only when actionable or recently synced.
- Move secondary details into expandable rows or drawer.

### Setup

- Treat Setup as onboarding/profile configuration rather than a permanent work surface.
- Split the long form into progressive sections: identity, subjects, weak topics, completed topics, timetable.
- Keep `onboarding-form`, `demo-seed-btn`, and `onboarding-result` stable until explicitly migrated.
- Surface setup prompts from Today when profile data is incomplete.

### Courses

- Move from card-only overview toward course workspaces.
- Show each course with current assignments, weak topics, source coverage, revision state, and next action.
- Allow course detail expansion or future route-like state without changing backend APIs.
- Keep imported Classroom work clearly labeled read-only.

### Memory

- Make upload and search the two primary affordances.
- Convert queue health and technical extraction state into a compact library health indicator.
- Make source cards easier to scan: title, course, source status, citation/source health, and one menu.
- Move retry index/delete into item actions.
- Preserve upload flow and `source-form`, `source-file`, `source-result`, `source-list` hooks.

### Studio

- Make Studio a focused workflow selector rather than several visible tools at once.
- Group assignment flow, MCQ scoring, extension draft, and tutor lesson as modes.
- Keep one workflow active at a time with focused input and result.
- Keep assignment contract available from relevant assignment context and Studio, not global sidebar.

### Account

- Reframe Account as settings, not a dashboard.
- Group sections into Profile, Session, Plan and quota, Privacy and consent, Data rights, Recovery, Future roles.
- Keep export/deletion guarded and quieter until explicitly invoked.
- Preserve billing preview, export request, deletion request, consent, legal, recovery, and verification flows.

### Auth And Session Area

- Replace permanent rail auth form with compact session button and expandable sign-in panel.
- Keep auth form IDs and auth behavior stable in implementation phases unless explicitly migrated.
- Keep password reset and verification actions discoverable from Account and session panel.

### AI Command Layer

- Replace permanent right panel with contextual launcher/drawer in a later implementation pass.
- Preserve Ask, Plan, Make, Review verbs.
- Preserve `/api/ai/verb`, `ai-form`, `ai-message`, `ai-response`, and verb tab behavior until migration.
- Allow contextual prompts from Today tasks, course topics, source items, and Studio workflows.

### Billing, Export, Deletion, And Privacy

- Move billing preview and plan/quota into Account settings.
- Keep live payments visibly inactive unless backend config says otherwise.
- Make export/deletion guarded flows explicit and calm.
- Keep consent and legal acceptance clear, but not visually equal to daily academic work.

### Classroom Connector States

- Keep read-only and no-write-scope guarantees visible.
- Show connection/sync only where relevant: Today, Courses, and Account connector settings.
- Move detailed token persistence/sync history into a details drawer or expanded state.

### Source Upload Flow

- Use a clear upload affordance with drag/drop-ready styling in a future pass.
- Show privacy, file limits, status, and indexing feedback inline.
- Preserve accepted file types and upload API behavior.
- Keep reindex and delete as item-level actions with confirmation for delete.

### Assignment Contract And Credit Engine

- Move assignment contract from permanent AI sidebar into assignment detail and Studio workflow.
- Make credit earning understandable but not gamified or visually dominant.
- Keep MCQ scoring focused and explicitly learning-first.
- Preserve credit and contract APIs.

## 7. Implementation Phasing

Each phase must be visually reviewable, preserve existing API calls and backend behavior, avoid risky full rewrites, preserve important DOM IDs/JS hooks unless explicitly migrated, and keep Playwright/E2E stability where possible.

### PASS 34.1 — Design tokens and app shell

- Introduce design tokens and shell hierarchy refinements.
- Keep DOM and JS behavior stable.
- Quiet the rail, header, panel density, button hierarchy, spacing, and typography.
- Do not remove the AI sidebar yet; reduce visual pressure only if CSS-only.
- Validate with `npm.cmd run preflight:production`, `node --check frontend/scripts/app.js`, and visual screenshots.

### PASS 34.2 — Navigation and contextual AI layer

- Add the AI launcher/drawer model while preserving existing AI form behavior.
- Keep Ask/Plan/Make/Review and `/api/ai/verb` unchanged.
- Begin reducing dependence on permanent right sidebar.
- Preserve keyboard access, focus handling, and mobile drawer behavior.

### PASS 34.3 — Today command center redesign

- Recompose Today around next best action, schedule, due work, risk, and study queue.
- Reduce dashboard-card density.
- Keep Classroom actions and assignment flow accessible.
- Preserve `view-today`, `dashboard-summary`, `roadmap-list`, `timetable-list`, `assignment-list`, and refresh behavior.

### PASS 34.4 — Setup and courses redesign

- Convert Setup into calmer progressive onboarding.
- Redesign Courses into academic workspaces.
- Preserve onboarding form behavior, demo seed, course rendering, and Classroom-import labels.
- Avoid backend schema or API changes.

### PASS 34.5 — Memory and source upload redesign

- Reframe Memory as global source library plus upload/search.
- Reduce queue and extraction technical noise.
- Preserve source upload, delete, reindex, retry failed jobs, private source language, and result handling.

### PASS 34.6 — Studio workflows redesign

- Make Studio a focused workflow surface with one active mode.
- Redesign assignment flow, MCQ scoring, extension draft, and tutor lesson output.
- Move contract interaction into relevant workflow context if JS migration is explicitly included.
- Preserve existing API endpoints.

### PASS 34.7 — Account, settings, and privacy redesign

- Calm Account into grouped settings.
- Preserve auth recovery, verification, consent, legal acceptance, billing preview, export, deletion, dry run, and guardian groundwork.
- Keep destructive actions guarded and clear.

### PASS 34.8 — Responsive and mobile polish

- Replace sidebar assumptions with bottom navigation/drawers/bottom sheets.
- Validate no text overflow, overlapping controls, or layout jumps.
- Test narrow mobile, tablet, laptop, and wide desktop.
- Final Codex functional QA pass before Antigravity/Gemini aesthetic polish: verify responsive overflow, public auth shell gating, contextual AI drawer bounds, and consumer-facing copy without changing backend/API/deployment behavior.

### PASS 34.9 — Accessibility, visual QA, and regression cleanup

- Audit focus states, keyboard paths, ARIA live regions, contrast, drawer/modal focus management, and reduced-motion handling.
- Compare before/after screenshots for required states.
- Clean residual duplicated styles only after behavior is stable.

## 8. Regression Safety Checklist

DOM IDs/hooks to preserve unless explicitly migrated:

- Navigation and shell: `view-title`, `connector-status`, `.nav-item`, `.view`, `data-view`.
- Auth/session: `auth-form`, `signup-btn`, `password-reset-btn`, `logout-btn`, `auth-email`, `auth-password`, `auth-session`, `auth-help`.
- Today/Classroom: `dashboard-summary`, `refresh-btn`, `roadmap-list`, `timetable-list`, `assignment-list`, `classroom-panel`, `classroom-connect-btn`, `classroom-sync-btn`, `classroom-disconnect-btn`.
- Setup: `onboarding-form`, `onboarding-result`, `demo-seed-btn`.
- Courses: `courses-grid`.
- Memory/source: `source-list`, `source-course-select`, `source-file`, `source-result`, `source-form`, `data-delete-source-id`, `data-reindex-source-id`, `data-retry-failed-jobs`.
- Studio: `assignment-flow-form`, `flow-assignment-select`, `flow-result`, `score-form`, `score-topic-select`, `score-result`, `extension-form`, `extension-assignment-select`, `extension-result`, `lesson-result`, `contract-btn`, `contract-result`.
- AI: `ai-form`, `ai-message`, `ai-response`, `.verb-tab`, `data-verb`.
- Account: `account-summary`, `quota-panel`, `account-reset-form`, `account-reset-email`, `verification-resend-form`, `verification-email`, `legal-status`, `legal-accept-check`, `legal-accept-btn`, `consent-form`, `consent-withdraw-btn`, `export-request-btn`, `deletion-request-btn`, `account-action-result`, `account-lifecycle-status`, `guardian-preview-btn`, `upgrade-btn`, `manage-billing-btn`, `pricing-panel`, `data-download-export-id`, `data-deletion-dry-run-id`, `data-plan-preview`.

Forms to preserve:

- Auth sign-in/sign-up/password reset.
- Onboarding/profile setup.
- Source upload.
- Assignment flow.
- MCQ scoring.
- Extension draft.
- Account reset and verification resend.
- Legal acceptance and consent preferences.
- Billing preview/manage preview.
- Export and deletion request flows.

API flows to preserve:

- `/api/config`
- `/api/bootstrap`
- `/api/ai/verb`
- `/api/onboarding`
- Do not restore the removed sample-profile route; empty/setup states are the runtime fallback.
- `/api/classroom/status`, `/api/classroom/oauth/start`, `/api/classroom/sync`, `/api/classroom/disconnect`
- `/api/sources/upload`, source delete/reindex, `/api/jobs/retry-failed`
- `/api/assignment-flow`, `/api/tests/score`, `/api/extension/draft`, `/api/assignment-contract`
- `/api/account`, consent, legal, export, deletion, dry-run, guardian preview
- `/api/billing/checkout-preview`, `/api/billing/manage-preview`

Auth/session flows to preserve:

- Session storage behavior.
- Supabase Auth public config from `/api/config`.
- Password sign-in/sign-up.
- Password reset.
- Verification resend.
- Session expiry handling.

Upload flows to preserve:

- Accepted file types.
- Private source language.
- Upload result and safe error handling.
- Reindex/delete/retry failed jobs.

Classroom flows to preserve:

- Read-only import guarantee.
- No write scopes.
- Connect, sync, disconnect.
- Status, sync summary, sync history, imported course/assignment labels.

Account/export/delete flows to preserve:

- Consent save and withdrawal request.
- Legal acceptance.
- Export request/download.
- Deletion request and dry-run preview.
- Guardian groundwork preview.

Billing UI flows to preserve:

- Plan catalog rendering.
- Upgrade preview.
- Manage billing preview.
- Payment inactive/safe launch copy.

Tests/checks after each implementation pass:

- `npm.cmd run preflight:production`
- `node --check frontend/scripts/app.js`
- `node --check frontend/scripts/auth-complete.js` when auth completion changes.
- `node --check frontend/scripts/operator.js` when operator shell changes.
- `npm.cmd run verify:cloudflare-azure` when frontend/backend wiring changes and a backend URL is available.
- Browser screenshots for desktop, tablet, and mobile states.

## 9. Visual QA Checklist

Capture before and after screenshots for:

- Today: empty/local, demo-loaded, authenticated/supabase, Classroom connected, Classroom error.
- Setup: initial, partially filled, validation/error, demo loaded, generated roadmap.
- Courses: empty, multiple courses, Classroom course, course with assignments, course with weak topics.
- Memory: empty, upload form ready, uploading, uploaded/indexed, needs OCR, failed indexing, source detail/actions.
- Studio: assignment flow success/error, MCQ scoring, extension draft, tutor lesson output, assignment contract.
- Account: signed out, signed in, profile/quota, privacy/consent, legal acceptance, export request, deletion request/dry run, billing preview.
- AI: Ask, Plan, Make, Review success; API misconfigured; source-context limitation; safe error.
- Responsive: 1440px desktop, 1180px tablet/compact desktop, 860px tablet/mobile transition, 390px mobile.
- Accessibility: keyboard focus path, drawer/modal focus handling, visible focus rings, contrast for badges/errors/buttons.

QA acceptance:

- No text overlaps.
- No button text overflows.
- No horizontal scroll on mobile.
- No layout jump when loading or rendering result boxes.
- AI is available but not visually dominant.
- Account settings do not visually compete with Today/Courses.
- Destructive flows remain guarded and explicit.
- Source privacy and Classroom read-only status remain visible where relevant.

## 10. Final Recommendation

Start with `PASS 34.1 — Design tokens and app shell`.

Why:

- It addresses the root visual problem: density, hierarchy, spacing, typography, and shell pressure.
- It can be implemented with low behavioral risk.
- It can preserve existing DOM IDs, JS hooks, API calls, backend behavior, deployment config, and tests.
- It gives later passes a stable design language before moving AI, Today, Courses, Memory, Studio, or Account workflows.
- It lets reviewers compare visual direction without conflating it with JS architecture changes.

First implementation constraints:

- Keep StudentOS in plain HTML/CSS/JS.
- Keep SentIQ Chat and SentIQGPT read-only.
- Keep Azure backend-only and Cloudflare frontend-only deployment boundaries unchanged.
- Do not expose secrets.
- Do not remove existing controls to reduce clutter; progressively disclose or restyle them while preserving flows.
- Do not migrate DOM hooks in Pass 34.1 unless a hook is purely additive and behavior-neutral.
