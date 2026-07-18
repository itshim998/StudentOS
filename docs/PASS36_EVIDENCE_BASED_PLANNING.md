# PASS 36.0 — Evidence-Based Weak Topics and Schedule-Aware To-Do Planning

## Root causes

- Setup treated `weakTopicsText` as authoritative, created `weakSignals`, and generated recovery roadmap items from manually entered text.
- Strict test evaluation stored question marks, but weak-topic state came from the evaluator's free-form `weak_topics` list instead of mapped marks.
- Setup's natural-language schedule was persisted, but `buildDailyTodoInput(...)` omitted it. The deterministic planner used only a generic daily-minute budget and did not avoid fixed events.
- The Setup submit path was presented as a manual roadmap-generation operation even though the roadmap is deterministic planning state.

## Weak-topic source of truth

Only persisted StudentOS assessment evidence with `mapping_source: studentos_strict_test_scope` can update topic performance. Test generation locks every question to the exact course and parent syllabus topic being assessed. Evaluation stores marks awarded and marks available for each mapped question. Questions without that mapping remain in the overall test result but do not create topic performance.

Legacy `weakTopicsText` is retained as `legacyWeakTopicsText` and excluded from planning. Legacy `weakSignals` are retained as non-authoritative history and cleared from active classification. Setup no longer accepts a weak-topic field.

## Aggregation and recovery policy

- An assessment's topic percentage is total mapped marks earned divided by total mapped marks available.
- Below 70% is `needs_recovery`; 70% or above is not newly weak.
- History is marks-weighted and recency-weighted. Each older assessment receives 70% of the weight of the next newer assessment, so recent evidence matters without allowing a tiny question to erase substantial history.
- A later passing result becomes `recovering` while the weighted history remains below 70%, then `secure` when both current and weighted evidence support it.
- Test results and their topic evidence remain immutable history. Topic summaries and active roadmap recovery items update as new evidence arrives.
- Recovery roadmap IDs are stable by topic. Repeated evaluation cannot create duplicate active recovery work. Resolved recovery items are completed rather than deleted.

## Setup and planning invalidation

Setup now saves changes through `/api/onboarding`; it does not call an AI operation. The deterministic roadmap refresh is automatic. Changes to academic context, schedules, Classroom-selected context, exams, or assessment evidence mark planning stale and clear the prior Today plan. The next supported Today preparation uses the newest state. Model requests are never triggered by keystrokes.

## Availability flow

`Weekly classes and study blocks` follows this path:

1. `frontend/index.html` collects the original text.
2. `/api/onboarding` validates and saves it in profile preferences.
3. `normalizeWeeklyAvailability(...)` stores conservative structured constraints alongside the original text.
4. `buildStudyAvailabilityContext(...)` combines those constraints with recurring or dated timetable events.
5. `buildDailyTodoInput(...)` sends the original text, normalized availability, fixed commitments, and computed capacity to both AI-backed and deterministic planners.
6. Plan normalization enforces the capacity, allocates non-overlapping exact slots only when exact boundaries are supported, and preserves broad window labels when the input is vague.

For `Weekdays after 6 PM, and weekends all day.`:

- Monday through Friday work starts no earlier than 18:00.
- Fixed events can move the next slot later; for example, an 18:00–19:00 class moves study to 19:00 or later.
- Saturday and Sunday receive daytime capacity, but no exact weekend start or end is invented.
- Daily study minutes cap workload. Narrower availability, such as `Only Saturday afternoon.`, produces zero Monday capacity and changes the planner result.

## Persistence and migration

No migration is required. Test results, topic summaries, planning state, and normalized availability use existing JSON payload columns in `test_results`, `topics`, and `student_profiles`. The change therefore applies through the existing repository path on all three StudentOS data shards without applying anything to the Auth project.

## Tests

`backend/testPass36EvidenceBasedPlanning.js` covers:

- below/above-threshold mapped evidence;
- marks-weighted calculation and missing-mapping safety;
- persistence through repository reload;
- recovery, history retention, and duplicate prevention;
- planner consumption of weak-topic priorities;
- weekday, weekend, fixed-event, capacity, and changed-availability behavior;
- legacy manual weak-topic exclusion;
- Setup UI removal and bounded save-route behavior.

Existing Study and Evaluate, Today, entitlement, lifecycle, and Classroom read-only suites remain part of final regression validation.

## Remaining limitations

- Natural-language normalization is intentionally conservative. Unrecognized wording is preserved in the planner context instead of being converted into invented exact times.
- Vague periods such as `Saturday afternoon` constrain day and day-part selection but do not generate unsupported clock boundaries.
