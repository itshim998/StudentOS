# Task 1: Runtime demo-data purge

## Policy

StudentOS runtime UI and API responses must never use hardcoded academic examples as user data. Visible academic values must come from the authenticated account, saved onboarding/profile answers, manually entered or uploaded academic context, selected read-only Classroom metadata, or outputs generated from those inputs.

Allowed locations for examples are documentation, explicit tests, test fixtures, and verification scripts. Those fixtures must not be imported by runtime initialization or exposed through a product action.

## Audit and disposition

| Location found | Previous behavior | Disposition |
| --- | --- | --- |
| `backend/domain/studentosDomain.js` | Owned the full seeded student, courses, topics, assignments, timetable, sources, scores, and roadmap used by local runtime. | Removed from runtime. Runtime now exports `createEmptyStudentState`. The academic fixture is isolated in `tests/fixtures/studentAcademicState.js`. |
| `backend/domain/onboardingService.js` | Exported a sample-profile payload and supplied default Mathematics data, exam dates, topics, study minutes, break cycle, timetable blocks, and roadmap items when answers were missing. | Removed. Missing academic fields remain empty. Courses, exams, timetable entries, topics, and roadmap items are created only from submitted values. |
| `backend/repository/studentOsRepository.js` | Initialized the local account from the academic seed and used an email-derived display name. | Replaced with empty per-user initialization. Account profile metadata may provide a real display name; otherwise the name stays empty until onboarding. |
| `backend/server.js` | Exposed profile seeding and placeholder-source creation routes. | Both routes were removed. There is no normal runtime API that loads a sample profile or creates placeholder academic material. |
| `frontend/index.html` | Setup was prefilled with a student name, stream, class, subjects, topics, study settings, and timetable; it also exposed a sample-profile button. | All values were removed. Fields now use generic placeholders and remain empty until saved user data is loaded. The button was removed. |
| `frontend/scripts/app.js` | Called the profile-seeding route and used default goal, study time, break cycle, task, teacher, exam, and schedule copy when values were missing. | Seeding code was removed. Setup is populated from the saved profile. Today and course surfaces now show truthful empty guidance. |
| local browser storage | Older builds could leave academic profile/workspace objects in browser storage. | `frontend/scripts/migrations/legacyAcademicCache.js` removes only known fixture keys or strongly fingerprinted fixture payloads. The authenticated session key and unrelated real user values are preserved. |
| persisted shard rows | Earlier local/development profile seeding could have left known fixture IDs and profile fingerprints in saved state. | `backend/migrations/legacyDemoDataCleanup.js` filters known fixture records while shaping state and clears matching profile fields. Ambiguous generated IDs are removed only when the full fixture fingerprint is present. Legitimate nonmatching records remain. |
| Classroom/provider/billing mock adapters | Technical test and local integration adapters use mock modes. | Retained as infrastructure, not academic fallbacks. Empty runtime state produces no coursework. User-facing copy no longer promises sample assignments. Classroom remains read-only. |
| backend tests, Playwright specs, smoke/verifier scripts | Explicit academic inputs are needed to exercise learning, retrieval, and Classroom flows. | Retained only as test/verification data. E2E academic assignments are created inside the spec and are not available through runtime UI. |
| `STUDENTOS_DEMO_SEED_ENABLED=false` templates and preflight | Historical safety setting. | Retained as an inert one-way production guard. Runtime enabling always resolves false, and no seed route exists. |

No HSMC runtime fixture was found. HSMC references are limited to user-owned planning documents outside tracked runtime source.

## Onboarding as source of truth

The lifecycle is now:

1. Account profile metadata may provide a real display name; otherwise it is empty.
2. Guided onboarding saves name, institution/level, stream/course, year/semester, schedule, exam pattern, subjects, and syllabus notes in the user profile.
3. Saving the academic-context step creates only the courses/topics explicitly entered by the user. It does not invent exams, topics, timetable blocks, or roadmap work.
4. Existing users with saved lifecycle answers but missing rendered academic state are hydrated once from those saved answers.
5. Setup reads the same saved profile and academic collections. Refresh and later sign-in load the backend state instead of a browser fixture.
6. Today, Courses, Account, uploads, and selected read-only Classroom items consume that shaped per-user state.

## Empty runtime behavior

When no academic data exists, Today shows `No study task yet.` and applicable guidance:

- `Add your subjects in Setup so StudentOS can plan today.`
- `Add your timetable so Today can protect your study time.`
- `Add upcoming exams or assignments to build your first plan.`

Setup shows empty controls with generic placeholders. Placeholder text is never submitted as a value. Courses, assignments, sources, timetable entries, exams, and roadmap arrays remain empty until the user enters, uploads, selects, imports, or generates real academic context.

## Regression coverage

`npm.cmd run test:task1` checks empty initialization, onboarding binding, per-user persistence isolation, known persisted-fixture cleanup, safe browser-cache cleanup, static runtime-source bans, the absence of the sample-profile/source endpoints, no `Plan Free` copy, read-only Classroom actions, and disabled real payments.

Playwright covers the fresh workspace, cache cleanup, absence of known fixture values and the sample-profile button, lifecycle completion, onboarding-derived values, refresh-safe state, and explicit test-only Classroom fixtures.

## Scope confirmation

This pass did not add flashcards, visual notes, Learning Level, Consistency Points, assignment submission/writeback, grading, deletion, turn-in, auto-submit, or real payment behavior. SentIQ Chat and SentIQGPT were not modified.
