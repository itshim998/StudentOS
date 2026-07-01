# Task 3.1: Academic Context foundation

## Memory to Academic Context

The normal navigation label, page heading, subtitle, summary, upload form, and item groups now use **Academic Context**. Internal `memory` route and persistence names remain unchanged where renaming them would risk compatibility.

The page groups included work into **Assignments** and **Materials**. A separate **Classroom work to review** section is shown only when the active plan allows coursework review and unselected work exists.

## Manual PDF upload contract

`POST /api/sources/upload` now accepts Academic Context uploads with:

- `artifactKind`: `assignment` or `material`;
- `title`;
- `courseId`;
- `deadline` for assignments only;
- one PDF in the `file` field.

The backend requires a `.pdf` filename, the PDF content type, and a PDF file signature. A missing or non-PDF file returns `Please upload a PDF for Academic Context.` The frontend uses the same product-facing validation.

The upload form is disabled when no available course exists and shows `Add a course in Setup before uploading academic context.` The course dropdown is populated from the current user's onboarding, manual Setup, and eligible Classroom course records.

## Assignment and material behavior

Assignment uploads require a course and deadline. They create a manual assignment linked to the uploaded PDF, default to not handed in, and become visible to normal Today and Due Work selection through the existing assignment collection. The linked PDF is selected academic context and can support Ask StudentOS when ready.

Material uploads require a course but no deadline. They create a selected manual material record and use the existing private PDF preparation path.

Both groups show title, course, origin, a lightweight document preview placeholder, relevant deadline or readiness copy, Ask StudentOS when supported, and deletion.

## Classroom plan policy

Starter uses Google Classroom only to populate or refresh the course list during onboarding. Its sync path requests courses only, does not request coursework, materials, or submissions, does not create review items, does not show coursework selection checkboxes, and does not run automatic checks. Starter students add assignments and materials with manual PDFs after Setup.

Trial keeps its existing active entitlement behavior. Essential, Plus, and Pro retain Task 2 discovery truth: read-only checks create review-only metadata, and an explicit Add action is required before work enters Academic Context. Ignore removes an item from the current review queue. Automatic checks remain plan-cadenced and discovery-only.

## Permanent deletion

Academic Context deletion uses a caution dialog before any request. Confirmation permanently removes the local PDF, its prepared academic-context records, related jobs, and a linked manual assignment. The deleted manual assignment therefore leaves Today and Due Work.

For selected Classroom work, deletion removes the local StudentOS inclusion and marks the review item ignored. It never changes or deletes anything in Google Classroom. Related roadmap entries are archived only when directly linked; unrelated study history is preserved. An audit record of the local deletion remains.

## PDF preview placeholder

Task 3.1 uses a lightweight PDF or document placeholder on each card. It does not create backend thumbnails.

## Deferred to Task 3.2

- real first-page PDF thumbnails;
- final card, spacing, motion, and responsive visual polish;
- richer inline PDF viewing where a safe private-file viewer is available;
- broader Academic Context filtering and browsing refinements.

Task 3.1 does not add flashcards, visual notes, Learning Level, Consistency Points, Classroom writeback, assignment submission, automatic submission, or real payments.

## Data changes

No migration was added. The assignment and material metadata uses existing JSON payload persistence in the current StudentOS tables.

## Validation results

- `npm.cmd run preflight`: passed (`preflight:azure` and `preflight:production`).
- `npm.cmd run smoke`: passed, including material PDF upload, assignment PDF upload with a deadline, and permanent deletion.
- `npm.cmd run test`: passed, including Task 1, Task 2, Task 3.1, entitlement, lifecycle, and Playwright coverage.
- `npm.cmd run test:e2e`: passed with 11 tests; the opt-in live Supabase test was skipped.
- `node --check backend/server.js`: passed.
- `node --check frontend/scripts/app.js`: passed.
- `git diff --check`: passed; only existing line-ending conversion warnings were reported.

The optional live Supabase E2E was not enabled. No migration is required for Task 3.1.
