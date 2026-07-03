# Phase 1: Starter Academic Context to Daily TO-DO

## Starter target loop

Starter now follows one explicit operating loop:

1. Finish onboarding.
2. Add real Academic Context manually: courses, syllabus, exam dates, assignments, and study materials.
3. Choose **Prepare Academic Context**.
4. Wait while StudentOS checks and organizes the saved context.
5. Choose **Generate todayâ€™s TO-DO list**.
6. Use the generated plan for the rest of the current day.

Today does not generate work on page load and does not show legacy/default study tasks for Starter.

## Today state machine

Starter Today renders one of five primary states:

- `context_empty`: guidance to open Academic Context. Legacy roadmap, due-work, and schedule panels stay hidden.
- `context_needs_preparation`: preparation and review actions are available.
- `context_preparing`: a light, centered waiting view explains that StudentOS is setting up the academic context.
- `context_ready`: the only primary action is **Generate todayâ€™s TO-DO list**.
- generated today plan: a structured list shows title, time hint, reason, related course/context, and priority. Regeneration is explicit.

`context_failed` is also supported as a recovery state. It directs the student to review Academic Context and try preparation again.

Essential, Plus, and Pro retain their existing Today behavior in this phase.

## Academic Context additions

The existing PDF upload path now supports:

- Assignment: PDF, course, and deadline required.
- Study material: PDF and course required; no deadline.
- Syllabus: PDF and course required; no deadline. A linked syllabus record is saved and included in preparation.
- Exam schedule: PDF required; course optional so a schedule can cover one course or the semester.

The existing private upload, extraction, indexing, and cleanup paths remain in use. Ask StudentOS can continue using prepared uploaded text through the established retrieval path.

## Exam schedule design

Academic Context includes manual exam entry with:

- course, exam name, and exam date required;
- exam time, marks/weightage, and notes optional;
- edit and delete support for manual entries.

Exam dates are persisted in the existing `exams` collection. Optional exam schedule PDFs do not block manual exam entry.

## Context readiness and preparation

Preparation state is stored inside the existing student profile JSON payload:

- `context_empty`
- `context_needs_preparation`
- `context_preparing`
- `context_ready`
- `context_failed`

Course, exam, syllabus, assignment, and material changes invalidate the prepared fingerprint and the previous daily plan. Preparation is always user-triggered. It checks selected PDF readiness and builds a compact capsule containing courses, syllabi, exams, assignments, material metadata, and bounded available summaries.

If a selected PDF is still in progress, the UI says that some material is still being prepared. If a selected PDF cannot be prepared, the recovery message stays student-facing and directs the student back to Academic Context.

## Waiting page behavior

The preparing state uses the logged-in light visual system with a centered dark spinner and calm copy. Dashboard panels are hidden. The frontend polls the preparation status until the context becomes ready or needs review.

## Generate todayâ€™s TO-DO behavior

Generation requires:

- ready Academic Context;
- meaningful prepared context beyond a course name alone;
- remaining weekly AI allowance.

The browser sends its current local date, local time, and IANA timezone. The server combines those values with the active plan, profile preferences, prepared courses, exams, syllabus/material summaries, assignments, timetable blocks, weak/completed topics, and any existing plan for the same day.

Production generation uses the existing fail-closed AI provider route and requires structured JSON. Explicit local mock mode uses a deterministic structured generator for development and tests. Provider failure does not produce a synthetic production answer.

## Weekly AI allowance

Daily TO-DO generation uses the existing `planning` allowance cost. The server checks readiness before reserving allowance, reserves before the AI call, charges only a valid generated plan, and refunds a failed generation. Exhausted allowance blocks before the provider call and returns the existing calm weekly-help message.

## Persistence and migration instructions

No migration was added. Preparation metadata, the compact capsule, and the latest daily plan reuse the existing `student_profiles.payload` JSON persistence. Existing `syllabi`, `exams`, `assignments`, and `source_materials` collections are reused.

If this design later moves preparation or daily plans into dedicated tables, that migration must be applied to all three StudentOS data shards, not the Auth project unless an Auth change is explicitly required.

## Intentionally deferred

- automatic daily generation;
- Classroom writeback, turn-in, grading, deletion, or submission;
- assignment auto-submit;
- task execution beyond safe regeneration;
- flashcards, visual notes, Learning Level, Consistency Points, and PDF thumbnails;
- new paid workflows or real payment activation;
- plan-specific redesigns for Essential, Plus, or Pro.
