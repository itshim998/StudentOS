# Task 3.4 — Course Management and AI Reliability

## Bug summary

Academic Context correctly blocked uploads when no course existed, but its Setup recovery target only exposed the older Subjects textarea. Students could not add one explicit course and immediately return to an upload. The model-backed Ask path also built Groq requests with `reasoning_effort` for every configured model. A request-level compatibility rejection was then treated like a failed API key, so the same incompatible request could rotate through every key before falling back to the generic unavailable answer. The failure detail was not retained as a safe internal diagnostic.

## Manual course management

Setup now has a prominent Courses section above the academic-profile form. A student can:

- add a required course name;
- optionally add a course code, department or stream, and term, semester, or year;
- see all active saved courses, including manual, onboarding, and Classroom courses;
- edit manually added course details;
- archive a manual course when it has no linked assignments or materials.

The department or stream defaults from the saved student profile when the field is left blank. Duplicate active course names or codes are rejected with student-facing copy. Manual and Classroom courses are preserved when the older roadmap-generation form rebuilds onboarding-derived courses.

The course-management API uses the existing `courses` collection and its payload field. No schema change is required.

## Academic Context recovery

When no course exists, Academic Context shows:

- `No courses found yet.`
- a course-only Classroom refresh when Classroom is connected;
- Connect or Reconnect Classroom when that is the available recovery action;
- `Add course manually` in every no-course state.

`Add course manually` opens Setup, scrolls to the Courses section, and focuses Course name. A successful save returns the updated public state, rerenders the Academic Context course selector without a page reload, enables the upload controls, and removes the no-course recovery card.

## Classroom policy preservation

Starter course refresh still calls the course-only route and does not fetch or import assignments, materials, or submissions. Starter does not expose the coursework review queue and does not run automatic checks. Essential, Plus, and Pro retain the existing review-only discovery flow: discovered coursework remains outside academic context until the student explicitly adds it.

Classroom scopes remain read-only. No turn-in, grading, writeback, auto-submit, or Classroom delete action was added.

## AI failure root cause and provider request fix

The Task 3.3 Groq request builder unconditionally included `reasoning_effort`. That field is model-dependent. A model or deployment that rejects it returned a request-level error, but the provider loop marked the current key unhealthy and repeated the same incompatible payload with other keys. Error normalization reduced the result to the generic unavailable response, leaving no redacted server-side reason code.

The provider boundary now:

- sends `reasoning_effort: medium` only to known compatible GPT-OSS models;
- uses `max_completion_tokens: 3000` for Groq and the provider-equivalent `max_tokens` field for Pollinations;
- retries a compatible GPT-OSS request once without `reasoning_effort` when the deployment rejects the request shape;
- avoids rotating through other Groq keys for a request-level compatibility error;
- retains only redacted provider/status categories for server diagnostics;
- keeps provider, model, and failure details out of the public AI response.

The configured local GPT-OSS model and the Pollinations fallback were each verified with a redacted live request. The end-to-end StudentOS adapter returned a real answer for `What is AI` with no courses or selected materials.

## General and no-context Ask behavior

Harmless general questions now use the actual model-backed path when provider configuration is present. Empty courses, missing source arrays, and missing `sourceMaterialIds` are accepted. General answers do not claim to use course materials and include the calm reminder that materials can be added for more personalized help. Requests for a missing specific file keep the explicit Academic Context guidance.

The generic `I could not complete that answer right now. Please try again.` copy remains only for a true provider failure. Raw JavaScript and provider errors are never placed in the normal response.

## Weekly allowance preservation

The Task 3.3 reserve, settle, and refund sequence is unchanged:

- deterministic greetings and setup help remain zero-cost;
- model-backed general requests reserve and settle their classified internal cost;
- successful generation settles as charged;
- provider failure settles as refunded;
- an exhausted or unknown-plan allowance blocks before generation.

Regression coverage verifies successful `What is AI` accounting, failure refund behavior, and fail-closed unknown-plan behavior.

## Migration note

Manual course fields still use the existing course payload and need no schema change.

The production 403 exposed a missing permission step in the Task 3.3 allowance migration. Migration `supabase/migrations/202607020001_studentos_task34_ai_allowance_permissions.sql` grants the backend `service_role` access to `ai_usage_ledger` and execute permission on the reserve and settlement RPCs. It explicitly removes direct access from `public`, `anon`, and `authenticated`, leaving weekly allowance accounting backend-only.

Apply this migration to all three StudentOS data shards. Do not apply it to the Auth project.

A read-only live schema check confirmed that the Task 3.3 ledger and functions exist on all three data shards, but object presence did not validate role privileges. Azure subsequently returned 403 from reservation, which identified the missing `service_role` grants fixed by the Task 3.4 permissions migration.

## Production provider and grounding follow-up

The next production test exposed a separate deployment defect after allowance reservation was repaired. The Azure workflow mapped Supabase secrets but not the AI provider secrets. With `STUDENTOS_AI_MODE=auto` and no configured provider, the provider boundary incorrectly returned the local policy response as a successful generation. That produced only the general-materials reminder and charged the reserved allowance.

The production workflow now requires at least one of `GROQ_API_KEY` or `GROQ_API_KEY_1` through `GROQ_API_KEY_5`, maps every configured key through Azure Container Apps secret references, and conditionally maps Pollinations. The backend prefers the numbered pool, ignores empty values, deduplicates matching keys, and keeps `GROQ_API_KEY` as a backward-compatible fallback. Providerless automatic mode is a retryable generation failure, so the existing settlement path refunds the reservation and returns only the calm unavailable copy. Explicit mock mode remains available for controlled local tests.

A subsequent workflow run showed that the ACA secret names were already lowercase and hyphen-safe. The mapping step exited before Azure CLI because its optional-secret helper called `printenv` for an unset Pollinations key under fail-fast shell behavior. The helper now treats missing optional values as empty, preserves the safe Groq env-to-secretRef mapping, and reports only redacted Azure CLI command categories and exit codes.

Retrieval now applies the existing `0.42` grounding threshold before snippets enter the model prompt. Real-provider responses expose only snippets referenced by validated `[S#]` or chunk citations, and source badges are deduplicated by material. Provider failures, uncited answers, and low-confidence retrieval return no public source labels or `Selected material` blocks.

The browser console `400` from `/api/courses` is a separate course-form request and is not part of this AI fix.

## Validation

- `npm.cmd run preflight` — passed.
- `npm.cmd run smoke` — passed.
- `npm.cmd run test` — passed, including Task 3.3 and Task 3.4 backend regressions and the browser suite.
- `npm.cmd run test:e2e` — 13 passed, 1 optional live Supabase case skipped because live E2E was not enabled.
- `node --check backend/server.js` — passed.
- `node --check frontend/scripts/app.js` — passed.
- `git diff --check` — passed with only existing line-ending normalization warnings.
- `npm.cmd run verify:ai` — passed against the configured Groq GPT-OSS model with secrets excluded from output.
- Read-only weekly-allowance schema check — passed on all three StudentOS data shards.
- Task 3.4 migration regression assertions — passed for backend-only table and RPC privileges.
- A redacted live Pollinations fallback request passed.
- A redacted live `What is AI` StudentOS adapter request with empty academic context passed.
- Providerless `auto` regression passed with a sanitized failure, cleared grounding, and refunded allowance settlement.
- Citation-grounding regressions passed for low-confidence exclusion, validated citation selection, source deduplication, and uncited-source suppression.
- Browser grounding regression passed; unused snippets and labels do not render as `Selected material`.
- Azure workflow preflight passed with legacy single-key and numbered-pool validation, conditional secret mapping, missing-key failure, and configured-AI deployment verification.

Live Azure verification for this follow-up remains a post-deploy step. Configure `GROQ_API_KEY` or at least one numbered key in the `azure-dev` GitHub environment, run the manual workflow, and require `npm.cmd run verify:azure-deployment` to report `aiConfigured: true` before testing an authenticated general and grounded question.
