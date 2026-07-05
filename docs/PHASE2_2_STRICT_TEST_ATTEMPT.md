# Phase 2.2 — Strict Test Generation and In-App Test Attempt

## Generate test flow

**Generate test** is available only after the selected item in Study and Evaluate has been marked done. Generation uses the selected TO-DO item, its related course and context, linked or generated study material, and relevant syllabus, assignment, or exam context when available.

Generation uses the existing weekly AI-help reservation flow. A successful new test is charged at the tutoring-help cost. Reopening an existing test does not charge again. If the weekly allowance is exhausted, generation does not run. If generation is unavailable or returns unusable data, the reservation is refunded and the student sees retry copy without internal error details.

## Test structure

The generated paper is stored as structured data with:

- title, course, and topic;
- total marks and estimated minutes;
- instructions;
- numbered questions;
- question type, prompt, and marks;
- choices for objective questions.

Question numbers and total marks are normalized by StudentOS before persistence. Allowed question types are objective, short answer, long answer, numerical, and mixed. No answer key or score is generated in this phase.

## Warning behavior

A generated test begins in `ready_to_start`. Before it can start, StudentOS shows:

> This test cannot be paused. Start only when you can complete it in one sitting.

The warning includes the estimated time, marks, question count, topic, and course. The student must choose either typed answers or a handwritten answer sheet before **Start test** is accepted.

## Strict timer behavior

Starting a test stores the answer mode, server start time, duration, and absolute deadline in the existing durable test-session collection. Remaining time is always calculated from that deadline; a browser refresh or closure does not reset it.

The server checks the stored deadline whenever the attempt is read, saved, or finished. Once the deadline has passed, the attempt becomes `time_expired`, receives a lock timestamp, and rejects further answer changes. The browser countdown is only a display of the durable deadline and refreshes the server state when it reaches zero.

No migration is required. The existing `test_sessions.payload` retains the Phase 2.2 fields while the existing compatibility columns continue to use their established values.

## Answer modes

Typed mode renders a text area for every question. Draft answers are saved after a short typing delay and are saved again before voluntary submission. Submission changes the state to `submitted_pending_evaluation`; it does not score the work.

Handwritten mode keeps all questions visible and shows: “After you finish on paper, you will upload your answer sheet for evaluation.” Finishing changes the state to `ready_for_evaluation`. Answer-sheet upload is deferred.

## Durable states

The flow supports:

- no generated session;
- generating in the client while a request is active;
- `ready_to_start`;
- `in_progress`;
- `time_expired`;
- `submitted_pending_evaluation`;
- `ready_for_evaluation`.

Generated papers, deadlines, modes, drafts, submission timestamps, and lock timestamps survive refresh through existing user-state persistence.

## No-download policy

The question paper is rendered directly in Study and Evaluate. The test flow has no PDF, download, print, or export action and does not use an embedded PDF.

## Deferred to Phase 2.3

Phase 2.3 will add evaluation and scoring, typed-answer feedback, handwritten answer-sheet upload and interpretation, and any resulting learning-state updates. Phase 2.2 does not grade, award marks, produce final feedback, submit to Classroom, or write back to Classroom.
