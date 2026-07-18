# PASS 36.2 - Pending-only Google Classroom coursework sync

## Root cause

The previous connector fetched submissions one assignment at a time and the mapper treated several non-Google fallback states, or even a missing submission plus a due date, as active enough for discovery. That allowed completed or unverifiable coursework to remain in review-oriented state.

## Product rule

StudentOS queues a Classroom assignment only when the authenticated student's own submission state is exactly `NEW`, `CREATED`, or `RECLAIMED_BY_STUDENT`. Missing, malformed, unspecified, completed, returned, and unknown states fail closed. An overdue assignment remains eligible while its state is pending.

CourseWorkMaterial posts remain available to the separate Classroom material-discovery path. They are not shown in the pending-work review queue.

## Ingestion and ordering

The live connector reads active courses and published coursework, then requests the student's submissions once per course through `courseWork/-/studentSubmissions` with `userId=me` and the accepted pending states. Every response page is consumed. Coursework is joined to submissions by course and coursework ID before the snapshot reaches the state mapper.

The shared pending-coursework policy validates the join again before persistence. Google Classroom's coursework list endpoint supports server ordering by `updateTime` or `dueDate`, not `creationTime`, so StudentOS completes pagination and applies the required ordering client-side. Candidates are deduplicated and sorted by coursework creation time newest-first, then update time newest-first, then stable course/work ID. Invalid creation times sort last. The configured candidate limit is applied only after filtering, deduplication, and sorting.

## Reconciliation and safety

A complete successful assignment snapshot upserts currently pending work and removes unselected assignment candidates that are no longer pending or no longer present. Imported assignments are preserved as academic records, including notes, tests, generated material, and roadmap history, but are marked non-pending so they leave Today and review queues. A later `RECLAIMED_BY_STUDENT` snapshot reactivates the imported assignment.

Failed or partial snapshots never prune or deactivate existing work. Authentication failures, submission-list failures, and incomplete pagination therefore cannot trigger destructive cleanup. Course-list-only recovery also never reconciles coursework.

No migration is required because Classroom discovery state is stored in the existing per-student state document. The next complete successful sync performs the safe cleanup. Sync history and audit metadata contain aggregate counts only; rejected submission payloads are not retained.

## Read-only boundary

The connector keeps the existing read-only scopes, including `classroom.student-submissions.me.readonly`. StudentOS does not turn in, return, reclaim, grade, edit, or attach anything in Google Classroom.

## Verification

`backend/testPass362PendingClassroomSync.js` covers the accepted and rejected state matrix, overdue eligibility, deterministic ordering and limits, duplicate handling, CourseWorkMaterial separation, complete versus partial reconciliation, safe cleanup of an old completed candidate, imported-history preservation, reclaimed transitions, complete pagination, pagination failure, privacy, and the read-only boundary. Existing Classroom, Academic Context, planning, smoke, preflight, and browser suites provide the regression coverage listed below.

Run:

```powershell
npm.cmd run test:pass36-2
npm.cmd run test:task2
npm.cmd run test:pass24
npm.cmd run test:pass25
npm.cmd run test:task3-2
npm.cmd run test:pass36-planning
npm.cmd run preflight:production
npm.cmd run smoke:core
npm.cmd run test:e2e
node --check backend/server.js
node --check frontend/scripts/app.js
```
