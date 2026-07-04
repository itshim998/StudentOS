# Phase 1.2: Multi-tier Academic Context to daily TO-DO

Phase 1.2 extends the state-driven Today flow from Starter to Trial, Essential, Plus, and Pro while preserving the selected-only Classroom boundary.

## Plan behavior

- Starter remains manual-first. Preparing Academic Context never fetches Classroom assignments or materials. The student prepares context first and then explicitly generates the daily TO-DO.
- Essential, Plus, and Pro use one click: **Prepare Academic Context** checks selected Classroom work when needed, prepares the context, and then generates today’s TO-DO through the existing StudentOS AI path.
- Trial uses the same flow when its current entitlement allows Classroom coursework review.
- Today remains state-driven and does not add sample study tasks or restore the old dashboard panels.

## Selected metadata and selected content

Classroom discovery remains review-only. An item becomes Academic Context only after the student selects it.

The context inventory distinguishes:

- selected assignment or material details such as title, due date, and link;
- usable selected content such as assignment instructions or a material-post description;
- selected files that still require a manual upload;
- manual PDFs and manual exam dates;
- the prepared-context fingerprint and whether it is stale.

Unselected review items are excluded from the inventory, prepared capsule, and daily TO-DO input.

## One-time selected-content check

Paid-tier preparation reads only the selected Classroom item endpoints. It does not list or import new work, create review rows, or use any write action. Repeated checks are deduplicated with the selected item’s current Classroom revision and prior result.

When current read-only access provides usable instructions, StudentOS stores that content on the already-selected academic record. When an attachment cannot be read with the current connector, StudentOS keeps the item incomplete and shows:

> Some selected Classroom work needs a manual upload before StudentOS can use it fully.

Other usable context still prepares successfully, with the result marked as less complete. A metadata-only material by itself is not enough to spend weekly AI help.

This check is separate from automatic Classroom discovery. It does not update the automatic check timestamp or summary and therefore does not consume or delay the plan cadence.

## Prepared context reuse and invalidation

The prepared capsule is reused for daily TO-DO generation while its fingerprint matches Academic Context. No Classroom read is performed during ordinary daily generation.

Preparation becomes stale when a course, exam, assignment, syllabus, manual PDF, selected Classroom item, selected content, or deletion changes the fingerprint. Automatic discovery alone remains review-only and does not invalidate prepared context. Selecting a discovered item does invalidate it.

No migration is required. Backfill state and the prepared capsule use the existing JSON payload persistence on StudentOS records and profile data.

## Daily TO-DO input and priority

Generation receives:

- current local date, current local time, and IANA timezone from the browser;
- active plan tier and onboarding/study preferences;
- courses, syllabi, exam timetable, exam notes/topics, assignments, due dates, and handed-in state;
- selected material names and available summaries;
- timetable blocks, weak topics, completed topics, and the prepared context capsule.

The prompt prioritizes the nearest exam or assignment, syllabus coverage, time remaining today, and the student’s study rhythm. Lower-priority subjects continue in parallel when time remains. Grounded output validation replaces a structurally valid but generic provider response with a deterministic plan built from prepared context.

For the 1 August fixture, AI CIA 1 on 2 September is first, Electronics CIA 1 on 4 September is second, and Math, OS, DAA, and EVS follow in parallel. The reasons include upcoming timing and available syllabus topics rather than random study advice.

## Weekly AI help

Generation continues through the existing Groq-capable StudentOS provider fallback and weekly allowance ledger. Readiness is checked before reservation. Exhaustion blocks before a provider call. Successful grounded generation is charged; provider failure or invalid generation is refunded and returns calm retry guidance.

## Safety boundaries

- Classroom remains read-only.
- Assignment writeback, turn-in, grading, deletion, submission, and auto-submit remain disabled.
- Automatic discovery remains review-only.
- Real payments remain disabled.
- Normal product copy stays student-facing and avoids implementation terminology.

## Deferred to Phase 2

Study and Evaluate, flashcards, visual notes, Learning Level, Consistency Points, PDF thumbnails, and test-taking UI are not part of Phase 1.2.

## Validation

Run:

```powershell
npm.cmd run preflight
npm.cmd run smoke
npm.cmd run test
npm.cmd run test:e2e
node --check backend/server.js
node --check frontend/scripts/app.js
git diff --check
```

The live Supabase Playwright case remains opt-in and should be reported as skipped unless its environment flag is enabled.
