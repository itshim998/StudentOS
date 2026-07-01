# Task 3.3: Course recovery and weekly AI allowance

## Course-only Classroom recovery

StudentOS now exposes **Refresh course list** from the Academic Context no-course state and the Classroom course workspace. The action calls `POST /api/classroom/courses/refresh` and always runs the Classroom connector with `courseOnly: true`.

The recovery path requests course names only. It does not request coursework, coursework materials, submissions, or attachments; create Classroom review items; create source materials; add Academic Context; trigger AI processing; or change Today and Due Work. Its timestamp is stored separately from normal coursework checks, so it does not delay or count as an automatic coursework check.

If Classroom is disconnected or its connection needs attention, the no-course state offers **Connect Classroom** or **Reconnect Classroom**. Recovery OAuth carries a signed course-recovery purpose, and the callback performs only the course refresh. The UI explains that only course names are refreshed and that assignments and materials are not imported.

## Plan behavior

Starter remains course-list-only. It can connect or refresh Classroom courses, but it cannot discover assignments or materials, show a coursework review queue, or run automatic Classroom checks. Starter students add academic work with manual PDFs linked to a course.

Essential, Plus, and Pro keep their existing read-only, metadata-only coursework checks. Discovered work remains review-only and enters Academic Context only after an explicit student choice. Course refresh is an additional independent action and never imports coursework.

Classroom remains read-only for every plan. No write scopes, turn-in, grading, deletion, submission, writeback, or automatic submission behavior was added.

## Weekly AI allowance

The backend defaults are:

| Plan | Weekly allowance |
| --- | ---: |
| Trial Mode | 15 |
| Starter | 35 |
| Essential | 90 |
| Plus | 220 |
| Pro | 500 |

These are operational safeguards, not pricing promises, so they remain absent from pricing pages. They can be adjusted with backend-only `STUDENTOS_AI_WEEKLY_ALLOWANCE_<PLAN>` environment values without requiring an environment change for normal startup.

Each period starts Monday at 00:00 UTC and refreshes seven days later. Unknown or missing plans receive no model-call allowance and fail closed without crashing.

## Internal AI cost model

| Action | Cost |
| --- | ---: |
| Deterministic greeting, setup guidance, or UI help | 0 |
| General Ask StudentOS response | 1 |
| Answer using relevant academic context | 2 |
| Tutoring or explanation | 3 |
| Planning or roadmap request | 5 |
| Assignment analysis or checking | 8 |

These values are internal and are not shown as pricing copy. Public language uses **weekly AI help**, **weekly AI allowance**, and **AI help remaining this week**.

Before a model call, StudentOS classifies the request and atomically reserves the required amount. Successful generation charges the reservation. A provider or internal generation failure refunds it. Exhausted requests do not call a provider and return a calm weekly-help message while leaving course and Academic Context actions available.

## Persistence and migration

Migration `supabase/migrations/202607010002_studentos_task33_ai_weekly_allowance.sql` adds `ai_usage_ledger` plus atomic reserve and settlement functions. The ledger records plan, week, action, cost, request, and reserved, charged, refunded, or blocked status. An advisory transaction lock prevents concurrent requests from overspending the same weekly allowance.

Apply this migration identically to all three StudentOS data shards: Projects 2, 3, and 4. Do not apply it to the Auth project. Mock/local mode uses the same reservation and settlement behavior in memory.

## Ask StudentOS reliability

Ask StudentOS now normalizes missing arrays and supports an empty workspace without assuming that a topic, course, selected material, or `sourceMaterialIds` exists.

- Greetings and basic product guidance are answered deterministically without a model call.
- General academic questions can be answered without selected material and include guidance that adding material enables more personalized help.
- Requests that depend on a missing file say what is missing and direct the student to Academic Context.
- Relevant selected material is still used when available.
- Requests for live facts receive a clear limitation when no current source is available.
- Provider failure returns `I could not complete that answer right now. Please try again.` and does not expose raw errors.
- Every permitted query returns a valid StudentOS response object or the calm weekly-help limit message.

## Provider generation defaults

Current StudentOS generation requests use backend defaults:

- `STUDENTOS_AI_REASONING_EFFORT=medium`
- `STUDENTOS_AI_MAX_COMPLETION_TOKENS=3000`

Groq receives `reasoning_effort` and `max_completion_tokens`. The Pollinations fallback receives the equivalent supported completion limit without an unsupported reasoning field. The system instruction remains brief and tells StudentOS to answer general questions safely, use selected academic context only when relevant, avoid claiming unavailable material, hide implementation details, support responsible learning, and never submit work or impersonate the student.

## Validation results

- `npm.cmd run test:task3-3`: passed.
- `npm.cmd run preflight`: passed (`preflight:azure` and `preflight:production`).
- `npm.cmd run smoke`: passed.
- `npm.cmd run test`: passed, including PASS 35/36, Tasks 1/2/3.1/3.2/3.3, and browser coverage.
- `npm.cmd run test:e2e`: passed with 12 tests; the opt-in live Supabase case was skipped.
- `node --check backend/server.js`: passed.
- `node --check frontend/scripts/app.js`: passed.
- `git diff --check`: passed with only existing line-ending conversion warnings.

The optional live Supabase E2E was not enabled. Apply the Task 3.3 migration to all three data shards before enabling it.

Real payments remain disabled. No Free plan was added. SentIQ Chat and SentIQGPT were not modified.
