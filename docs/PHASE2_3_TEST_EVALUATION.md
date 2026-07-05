# Phase 2.3 — Test Submission, AI Evaluation, and Study Progress Update

## Typed submission behavior

Typed answers continue to autosave during the strict Phase 2.2 attempt. Finishing the attempt locks those saved answers and changes the session to `submitted_pending_evaluation`. The evaluation action reads the locked answers from the durable test session and sends them with the generated paper, course/topic context, related study material, marking instructions, and total marks.

An evaluated attempt cannot return to the normal editing state. Reopening the Study and Evaluate task shows the saved result.

## Handwritten upload behavior

Finishing a handwritten attempt locks the question paper and reveals the answer-sheet uploader. The uploader accepts one PDF or DOCX answer sheet. Both filename/type and file signature are checked on the server; changing an unsupported file's extension is not enough to pass validation.

Accepted files:

- PDF (`.pdf`, `application/pdf`)
- DOCX (`.docx`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`)

All other files show: **Upload your handwritten answer sheet as PDF or DOCX.**

The maximum answer-sheet size uses the existing 12 MB source-upload limit. StudentOS extracts readable text before reserving weekly AI help. A PDF must contain a readable text layer; image-only/scanned handwriting that needs OCR receives calm replacement guidance and is not sent for evaluation. DOCX body text is read directly from the document package.

After a readable answer sheet is accepted, its extracted draft and safe metadata are retained with the private test session until evaluation succeeds. A failed evaluation can therefore be retried without selecting the file again. The browser receives only safe filename/type/size metadata, not the retained extracted draft.

The generated question paper remains in-app only. Phase 2.3 adds no paper download, print, or export action.

## Evaluation structure

Evaluation uses the existing AI execution path. StudentOS asks for an internal structured result and normalizes all question numbers and marks against the stored test paper. The stored result contains:

- `total_marks`
- `scored_marks`
- `percentage`
- `question_results`, with question number, marks awarded, maximum marks, feedback, and correction
- `strengths`
- `weak_topics`
- `next_steps`
- `short_revision_plan`

Totals and percentages are recomputed from the per-question awards. Marks are clamped to each question's maximum. Missing question results become zero-mark correction entries rather than disappearing.

## Result UI

The evaluated state shows **Your result**, the score and percentage, what went well, what to revise, question-by-question feedback, corrections, next steps, and a short revision plan. It also offers:

- Review corrections
- Back to Today
- Continue Study and Evaluate

Normal student-facing copy does not expose implementation or service details.

## Timer and retry behavior

Phase 2.2's durable deadline remains authoritative. Once time expires, typed drafts stay locked and can be evaluated as saved; a handwritten attempt can add its answer sheet. Final submission and evaluated attempts do not allow answer editing.

Only one evaluation request for a student/test pair runs at a time in the application process. A completed evaluation is reused instead of charged or submitted again. If evaluation is unavailable, the attempt remains in its pre-evaluation state, typed answers and a successfully read answer-sheet draft remain intact, and the student can retry.

## Progress update behavior

After successful evaluation StudentOS:

- marks the test session `evaluated` and stores the structured result;
- records one linked test result;
- marks the related Study and Evaluate item workflow `completed` and records its evaluation time and latest percentage;
- stores the returned weak topics on the task;
- adds or updates weak-topic records using `revision_required` signals;
- marks an existing studied-topic record covered when the score is at least 70% and that topic was not returned as weak.

The existing Today planning context already reads weak and completed topic records, so future generated plans can respond to the evaluation without a second progress model.

No migration is required. Test sessions, test results, daily plan items, and topic records already persist their full payloads in existing collections.

## Weekly AI allowance behavior

Each new evaluation reserves the existing tutoring-help cost from the weekly AI allowance. An exhausted allowance blocks before the AI execution path. A successful evaluation is charged. An unavailable or unusable evaluation is refunded, and the saved attempt remains retryable. Reopening an already evaluated result does not reserve or charge again.

## Deferred work

Later adaptive phases can add handwriting OCR for image-only PDFs, richer cross-test mastery trends, Learning Level, Consistency Points, adaptive retest scheduling, and more detailed revision-roadmap generation. Phase 2.3 does not add Classroom writeback, assignment submission, auto-submit, grading writeback, payments, or test-paper export.
