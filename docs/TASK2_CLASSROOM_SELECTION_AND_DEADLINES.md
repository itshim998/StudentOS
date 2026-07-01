# Task 2: Classroom selection truth and deadline ordering

## Previous bug

The old Classroom mapper treated a read-only check as an academic import. Every discovered course, assignment, generated topic, and attachment was written directly into the normal academic collections. Attachments were marked ready even when the student had not selected them. The frontend then read those collections as trusted academic context.

That caused five visible failures:

- unselected work appeared in Academic Context and source counts;
- old assignments appeared in Today and Due Work;
- assignment cards exposed raw Classroom state and misleading readiness labels;
- Classroom work was ordered by its most recent posted or updated timestamp instead of its deadline;
- returned or handed-in work could remain eligible for Do Now.

## Data-flow audit

| Surface | Previous leak | Task 2 behavior |
| --- | --- | --- |
| `backend/connectors/googleClassroom/mapper.js` | Sync wrote every discovered item into `courses`, `topics`, `assignments`, and `sourceMaterials`. | Sync writes lightweight rows only to `classroomItems`. Academic records are created only after explicit selection. |
| `backend/connectors/googleClassroom/syncService.js` | Check summaries and student copy described discovery as an import. | Summaries report work found or refreshed. Automatic checks remain plan-gated and discovery-only. |
| `backend/repository/studentOsRepository.js` | Academic collections were loaded without a Classroom selection boundary. | A dedicated `classroom_items` collection is loaded. Legacy ambiguous rows are converted and archived from academic use on load. |
| `backend/domain/productFeatureAccessService.js` | Capacity depended on old academic rows and lifecycle IDs, allowing discovery rows to affect source truth. | Only uploaded material and explicitly imported Classroom items consume academic-context capacity. |
| `backend/domain/studentosDomain.js` and `backend/ai/groundedPromptBuilder.js` | Assignment planning, source retrieval, and prompts could read unselected rows. | Archived or non-included Classroom records are excluded from grounding, insights, assignment flows, plans, and Today study actions. |
| `backend/domain/onboardingService.js` | Roadmap generation trusted every assignment already placed in the academic arrays. | Roadmaps use academic-context records only and exclude completed Classroom work. |
| `backend/server.js` | Bootstrap exposed all stored assignments and sources; source status also returned their chunks. | Bootstrap returns selected academic records plus a separate safe review list. Source chunks are limited to visible selected sources. |
| `frontend/scripts/app.js` | Onboarding selected from already-imported rows. Today preferred Classroom freshness. Materials and source counts included every discovered row. | Onboarding selects from `classroomItems`. Today uses active work and deadlines. Academic Context shows selected sources separately from work available to review. |
| browser caches | No current product code caches academic state, but older keys could retain old Classroom arrays. | The repeatable browser migration removes ambiguous legacy Classroom caches while preserving explicit selected/imported entries and auth session state. |

The audit also checked Today command center, Study List, Due Work, course cards, assignment selectors, assignment analysis, source status, roadmap generation, AI grounding, local storage, session storage, and IndexedDB usage. StudentOS has no active academic IndexedDB cache. Runtime browser storage is limited to auth plus the repeatable legacy cleanup.

## Discovered, selected, and imported

`classroom_items` is the discovery boundary.

- `discovered`: StudentOS knows the lightweight title, course, dates, type, read-only link, and submission state. It is not academic context.
- `selected`: the student has explicitly confirmed the item. This is a short transition during the selection operation.
- `imported`: the selected item has a corresponding academic record and may participate in academic context.
- `ignored`: the student left out or removed a previously selected item. It remains reviewable but cannot affect Today or grounding.
- `archived`: retention-only history. It cannot affect normal product views.

Every item also records `selected_at`, `imported_at`, `academic_context_included`, `last_seen_at`, due/posted/update dates, normalized submission state, and `handed_in`.

Checking Classroom never imports or analyzes work. Onboarding `save_materials` performs the explicit selection and import transition. The later Academic Context review surface uses the same transition through `POST /api/classroom/selection`.

## Submission-state mapping

StudentOS normalizes the state names supplied by the read-only Classroom response.

- active: `CREATED`, `NEW`, `ASSIGNED`, `OPEN`, `NOT_SUBMITTED`, `RECLAIMED_BY_STUDENT`;
- handed in or complete: `TURNED_IN`, `RETURNED`, `DONE`, `GRADED`, `SUBMITTED`, `COMPLETE`, `COMPLETED`;
- missing submission plus a due date: treated as `NOT_SUBMITTED`;
- unknown: excluded from top priority unless the selected item has a due date that indicates action may still be needed.

Raw state names are not shown in normal student-facing cards. Completed work can remain selected academic history, but it cannot enter Do Now or Due Work.

## Today and deadline ordering

Today chooses Do Now in this order:

1. selected/imported active unsubmitted work, ordered by `due_at` ascending;
2. for plans with automatic Classroom checks, active discovery-only assignments as **Review and add** actions, ordered by `due_at` ascending;
3. the next real open roadmap item derived from selected/onboarding data;
4. empty guidance when no real item exists.

Overdue active work sorts before future work and is labeled **Overdue**. Work without a due date sorts below dated work within its selection group. Posted and updated dates are browsing information only and never urgency signals.

Study List contains real roadmap work only. Due Work excludes archived, returned, handed-in, graded, submitted, and completed assignments. Academic Context source counts use selected/imported material only.

## Plan behavior

- Trial Mode keeps its existing single automatic check restriction. A completed check prevents another automatic check during the trial.
- Starter permits the existing manual Classroom check and never runs an automatic check.
- Essential checks at the existing seven-day cadence.
- Plus checks at the existing five-day cadence.
- Pro checks at the existing three-day cadence.

Automatic checks are triggered when an eligible signed-in workspace loads and its cadence is due. They remain read-only and discovery-only. New work is shown as **New Classroom work found** or **Review and add**; it is not academic context until selected.

## Existing data cleanup

The migration creates `public.classroom_items` and marks existing Classroom assignment/source payloads as imported only when the profile contains evidence of explicit selection. All other historical rows are marked discovered.

The runtime migration is the fail-safe layer. On load it:

- reconstructs lightweight Classroom review items;
- converts old selected IDs to the new item IDs;
- keeps rows with explicit selection evidence active;
- archives ambiguous assignments, sources, topics, courses, roadmap items, tests, lessons, revisions, source chunks, memory rows, embeddings, and jobs from normal academic use;
- persists the converted state without deleting ambiguous history.

The migration file is:

`supabase/migrations/202607010001_studentos_task2_classroom_selection_truth.sql`

Apply it to all three StudentOS data shards. Do not apply it to the auth project.

## Safety boundaries

- Classroom scopes remain read-only.
- No Classroom write, turn-in, grading, deletion, submission, or auto-submit route was added.
- Assignment writeback remains disabled in every plan.
- Real payments remain disabled.
- StudentOS normal UI uses consumer-facing selection and deadline language.

## Tests

`backend/testTask2ClassroomSelection.js` covers:

- unselected discovery does not create academic assignments or sources;
- selected items become academic context;
- A/B/C selected assignments order by deadline with undated C last;
- newly discovered D orders by due date rather than posted date and remains review-only until selected;
- old 2024 handed-in work cannot enter Do Now;
- completion-state normalization;
- Starter, Trial, Essential, Plus, and Pro check policies;
- legacy persisted-row and browser-cache cleanup;
- selection truth survives repository reload;
- read-only and payment safeguards;
- student-facing Classroom/Today copy checks.

## Validation results

- `npm.cmd run preflight` — passed (`preflight:azure` and `preflight:production`).
- `npm.cmd run smoke` — passed.
- `npm.cmd run test` — passed, including the Task 2 regression suite and Playwright: 11 passed, 1 opt-in live Supabase test skipped.
- `npm.cmd run test:e2e` — passed: 11 passed, 1 opt-in live Supabase test skipped.
- `node --check backend/server.js` — passed.
- `node --check frontend/scripts/app.js` — passed.
- `git diff --check` — passed; only existing line-ending conversion warnings were reported.

The live Supabase E2E was not enabled. The new migration must be applied to all three StudentOS data shards before running that optional live test against the updated schema.
