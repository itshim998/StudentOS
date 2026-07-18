# PASS 36.3 — Account and UI simplification

## Summary

PASS 36.3 makes the authenticated workspace calmer and more editorial without changing Today or Study and Evaluate. Account settings now use flat sections and simple status rows, the sidebar is navigation-only, and the top-right profile menu is the authoritative place for identity and session actions.

## Root causes

The authenticated UI had accumulated several independent surface systems over successive passes. Generic card styling, later theme overrides, and page-specific polish all added backgrounds, radii, and shadows. Passive account facts were rendered as individual pills inside larger panels, Account repeated legal and future-sharing infrastructure intended for other lifecycle stages, and the profile popover repeated the same pill pattern. Setup, Courses, Academic Context, and Studio also retained presentation-only containers after their content hierarchy had become strong enough to stand on headings, spacing, and dividers.

## Account changes

The normal authenticated Account page no longer renders:

- terms and privacy status, versions, acceptance controls, or acceptance history;
- the separate consent-withdrawal action;
- the future family or mentor preference;
- access-sharing headings, explanations, previews, badges, controls, or status summaries;
- a family-access card in data rights.

Account retains profile and subscription details, password recovery and verification controls, current plan and pricing behavior, three consent preferences, secure export requests, deletion requests, grace-period status, and the deletion safety preview.

Passive identity and plan details are flat definition lists. Recovery forms retain bounded fields. Pricing choices remain bounded because they are interactive choices. Export and deletion status use two simple rows with dividers, while deletion remains visually destructive.

## Legal acceptance remains onboarding-only

No legal schema, service, endpoint, lifecycle field, or acceptance history was removed. Required onboarding still gates workspace readiness on the complete legal-consent step, and the onboarding completion path still records the accepted legal version with `required_product_flow` as its source. Existing acceptance records remain in lifecycle snapshots and exports. Account simply no longer presents a second acceptance form or acceptance history after onboarding.

## Consent save and revocation behavior

The three normal preferences are:

1. StudentOS activity for tutoring personalization.
2. De-identified quality review.
3. Student-approved progress sharing outside the account.

The save service now compares submitted values with the stored values before writing:

- false to true records a versioned grant;
- true to false reuses the existing withdrawal path, sets `granted` false, preserves `withdrawnAt`, records the consent scope/version, and appends the withdrawal audit event;
- unchanged values do not update timestamps or append duplicate events;
- repeated identical saves are idempotent;
- multiple changes in one save record each relevant grant or withdrawal transition.

The UI reports successful saves with the compact status text “Preferences saved.”

## Checkbox alignment and accessibility

Each preference is one semantic `label` using a two-column grid: a fixed native-checkbox column and a wrapping text column. The checkbox minimum height is reset from the shared text-input rule, which was the direct cause of the detached squares in the previous layout. The whole row is clickable, native checkbox behavior is retained, and keyboard focus uses a visible outline.

Playwright checks label isolation, first-line alignment, a shared checkbox column, non-overlapping rows, mobile text wrapping, and keyboard-visible focus.

## Sidebar and profile menu

The sidebar session heading, signed-in email, workspace-open message, and Sign out button were removed. Account navigation and cloud/workspace status remain.

The profile menu now contains one bounded overlay surface with:

- name and email;
- plan, credits, rhythm, and eligibility as flat label/value rows;
- Account settings;
- Sign out for authenticated sessions.

There are no nested identity pills or metric pills. The menu opens from a named button, updates `aria-expanded`, moves focus to its first action, supports Tab plus Arrow/Home/End action navigation, closes on outside click or Escape, restores trigger focus on Escape, and closes after Account navigation or sign-out. Mobile positioning switches anchoring and opens upward when needed so the menu remains within the viewport. Sign out calls the existing `logout()` session-cleanup path.

## Page de-boxing

- **Setup:** removed the empty decorative backdrop; groups now use headings, form controls, whitespace, and dividers.
- **Courses:** course workspaces now read as one restrained vertical list; passive signal cells and details no longer create nested cards.
- **Academic Context:** hero, summary, support sections, material rows, and metadata are flatter. Pending Classroom work keeps one bounded actionable surface because it requires a clear interaction boundary.
- **Studio:** workflows use flat sections and desktop/mobile dividers while preserving all forms and results.
- **Account:** passive nested panels and status cards were replaced by definition lists, flat sections, and data-rights rows.
- **Authenticated shell:** the sidebar is navigation-focused and the profile overlay is a single surface.

Text inputs, selects, textareas, file inputs, dialogs, interactive pricing choices, actionable rows, focus states, validation, and destructive actions retain clear boundaries.

## Protected pages and CSS isolation

Today and Study and Evaluate markup were not changed. PASS 36.3 de-boxing uses `#view-setup`, `#view-courses`, `#view-memory`, `#view-studio`, and `#view-account` selectors. The new de-boxing block contains no Today or Study/Evaluate selector. Shared-shell changes are limited to the sidebar session removal and the required profile menu.

The PASS 36, PASS 36.1, responsive, and full desktop suites protect evidence-based planning, Today task presentation, Study and Evaluate layout and behavior, and their responsive characteristics.

## Tests added or updated

- `backend/testPass363AccountUiSimplification.js` covers Account removals, profile-menu structure, protected-selector isolation, grant/withdrawal transitions, unchanged saves, multi-preference saves, retry idempotency, preserved legal acceptance records, and preserved disabled access-sharing infrastructure.
- Pass 17 now asserts that the withdrawal record explicitly sets `granted` false and preserves `withdrawnAt`.
- Desktop Playwright coverage asserts Account removals, three preferences, save feedback, checkbox geometry, label association, focus visibility, profile content and flatness, open/outside/Escape behavior, Account navigation, authenticated sign-out cleanup, destructive/export controls, and horizontal overflow.
- Responsive coverage uses 1680×945, 1440×900, 1366×768, 1024×768, 900×900, 430×932, 390×844, and 360×800.

## Preserved infrastructure and limitations

Access-sharing schemas, invitation groundwork, feature flags, consent safeguards, and audit behavior remain available to future gated work but are not exposed in the normal UI. Legal acceptance and consent history remain stored. Export security, authenticated delivery, deletion grace periods, dry-run safety, manual review, and disabled final deletion are unchanged.

Pricing choices, form fields, file rows, pending Classroom selection, dialogs, and the profile overlay remain bounded intentionally. No payment, Classroom writeback, assignment submission, AI request, provider behavior, pricing, entitlement, credit, rhythm, eligibility, weak-topic, or planning behavior was added or enabled.
