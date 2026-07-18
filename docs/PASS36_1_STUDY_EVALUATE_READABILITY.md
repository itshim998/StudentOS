# PASS 36.1 — Study and Evaluate Readability

## Root cause

The desktop queue could shrink to a 280px track and then lose another 34px to pane padding. Each task card used a two-column grid whose second `auto` track contained the full, non-wrapping duration and availability sentence. That track consumed most of the card width, leaving the title and description in a very narrow `minmax(0, 1fr)` track. A broad `overflow-wrap: anywhere` rule then split ordinary words into short fragments. The priority tag shared the same grid column and could appear as a tall capsule when the remaining width collapsed.

## Layout correction

Queue cards now use a simple vertical information hierarchy:

- a wrapping title and compact priority badge in a flex header;
- course and task description in normal block flow;
- duration, suggested study window, status, and selected state in a wrapping metadata row.

The desktop page uses a 360–410px queue track and gives the remaining width to the selected-task workspace. The page stacks at 1240px and below so the permanent navigation rail cannot squeeze both panes. Mobile keeps queue-first DOM order and a single-column flow.

Priority badges are content-sized, non-stretching, and include accessible priority text. Status is a consistent metadata label. The active card has `aria-pressed`, a visible inset marker, and a visible “Selected” label; hover and keyboard focus remain distinct.

## Generated material presentation

Internal generated-source identifiers remain available in state and DOM data attributes for retrieval, persistence, exports, and API behavior. Consumer-facing titles and related-context labels are derived at render time from the task, topic, course, and saved material metadata. Values such as `source_generated_*` are removed from visible Study and Evaluate and Academic Context labels, with neutral course/material fallbacks when no useful title exists.

Generated markdown is normalized only for display. A redundant first heading is removed when it matches the surrounding title, is a generic generated-material heading, or contains an internal identifier. Persisted content is not changed. Markdown separators render as horizontal rules. Tables, formula blocks, inline formulas, and preformatted blocks contain their own horizontal overflow instead of widening the page.

## Regression coverage

- `backend/testPass361StudyEvaluateReadability.js` checks the resilient DOM/CSS structure, accessible badges and statuses, responsive breakpoint, raw-ID suppression, duplicate-heading normalization, and generated-content overflow guards.
- `tests/e2e/studentos-desktop.spec.js` checks card geometry, badge size, metadata separation, status containment, pane stacking, page overflow, visible raw-ID suppression, duplicate-title removal, generated-content rendering, and actionability at 1680×945, 1536×864, 1440×900, 1366×768, 1024×768, 900×900, 430×932, 390×844, and 360×800.
- `backend/testPass36EvidenceBasedPlanning.js` remains the behavior guard for assessment-derived weak topics and schedule-aware planning.

## Known limitations

- Generated source IDs remain present in internal state and action attributes by design; this pass removes them from visible consumer presentation rather than changing persistence contracts.
- Very wide tables, formulas, and code blocks scroll inside their content container. Their academic content is not rewritten or truncated.
- The existing expandable queue-stack interaction is preserved; this pass changes card readability and responsive layout, not queue behavior or planning semantics.
