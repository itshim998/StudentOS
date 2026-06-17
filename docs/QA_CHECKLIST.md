# StudentOS QA Checklist

Use this checklist before adding major features or preparing a production demo. Do not paste secrets, tokens, service-role keys, OAuth tokens, or full provider error payloads into issues, logs, screenshots, or demo notes.

## Automated Checks

Run from the StudentOS folder:

```powershell
npm.cmd run smoke:core
npm.cmd run test:e2e
npm.cmd run test:domain
npm.cmd run test:persistence
npm.cmd run test:sources
npm.cmd run test:rag
npm.cmd run test:pass7
npm.cmd run test:embeddings
npm.cmd run test:pass9
npm.cmd run test:jobs
npm.cmd run test:pass11
npm.cmd run test:pass12
npm.cmd run test:pass13
npm.cmd run test:pass14
npm.cmd run test:pass15
npm.cmd run test:pass16
npm.cmd run test:pass17
npm.cmd run test:pass18
npm.cmd run test:pass19
npm.cmd run test:pass20
npm.cmd run test:pass21
npm.cmd run test:pass22
npm.cmd run test:pass23
npm.cmd run test:pass24
npm.cmd run test:pass245
npm.cmd run test:pass25
npm.cmd run test:pass251
npm.cmd run test:pass26
node --check backend/server.js
node --check backend/domain/studentosDomain.js
node --check frontend/scripts/app.js
```

Safety scans:

```powershell
rg -n "GOOGLE_CLIENT_SECRET|STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET|refresh_token|encryptedRefreshToken|SERVICE_ROLE|GROQ_API_KEY|POLLINATIONS|SUPABASE_SERVICE_ROLE" frontend -S
rg -n "turnIn|modifyAttachments|reclaimSubmission|classroom\.announcements|/turnIn|/modifyAttachments|/reclaim" backend\connectors\googleClassroom frontend\scripts scripts -S
rg -n "<event-only-or-prelaunch-copy-pattern>" frontend -S
```

Expected: no frontend secret hits, no Classroom write-action hits, and no production UI copy that positions StudentOS as event-only or prelaunch-only.

## Startup QA

1. Start local server with `npm.cmd run dev`.
2. Open `http://localhost:3101/api/health` and verify `ok: true`.
3. Open `http://localhost:3101/api/config` and verify the pass label is current, service keys are absent, `realSubmissionEnabled` is false, and Classroom write scopes are disabled.
4. If the server fails to start, verify the selected port is free or set `STUDENTOS_PORT` to another local port.
5. Confirm `.env` is not shared in terminal output or screenshots.

## Core Product QA

1. Open the app in a desktop browser.
2. Verify auth state:
   - Supabase mode: sign in, refresh, and confirm session is restored.
   - Mock mode: local demo copy appears and account scaffolds remain safe.
3. Run onboarding with at least two subjects, one exam, one timetable block, one weak topic, and one completed topic.
4. Confirm Today shows current goal, next action, upcoming exams, weak topics, credits, source status, and roadmap progress.
5. Upload a small `.txt` or `.md` source.
6. Confirm source status becomes indexed, chunk count appears, and private/not-public copy remains visible.
7. Ask all four AI verbs to use the uploaded source:
   - Ask
   - Plan
   - Make
   - Review
8. Confirm citations/snippets are only shown for retrieved uploaded chunks.
9. Score an MCQ test and verify credits, correction sheet, weak topics, tutor lesson, and roadmap update.
10. Analyze an assignment and verify loading clears on success or failure.

## Classroom QA

1. Verify Google Classroom mode is `mock`, `oauth`, or `disabled` as expected.
2. For OAuth mode, run `npm.cmd run verify:classroom-config` before browser testing.
3. For manual-assisted live OAuth verification, follow `docs/E2E_CLASSROOM_LIVE_MANUAL.md`. Do not automate Google login credentials.
4. Connect Classroom from the Assignments panel.
5. Sync Classroom manually.
6. Confirm imported courses and assignments show Google Classroom badges, read-only badges, sync summary, and provider account metadata only.
7. Confirm empty Classroom accounts show the empty-state copy instead of errors.
8. Click **Analyze assignment** for an imported assignment.
9. Confirm coverage result and route:
   - covered -> practice test
   - partially covered -> quick revision then test
   - uncovered -> mastery roadmap before test
10. Confirm StudentOS never offers turn-in, grade, modify, post, or submission writeback actions.
10. Simulate insufficient scope, expired token, or quota/rate errors and verify safe reconnect/retry copy with no tokens.

## Account, Billing, Export, and Deletion QA

1. Open Account and verify plan, quota, storage/source counts, and upgrade placeholders.
2. Request password reset and email verification resend; verify safe copy.
3. Request data export and verify queued status.
4. Run export worker only in a controlled environment before testing download.
5. Request deletion dry run and verify no destructive action occurs.
6. Confirm final deletion remains disabled unless explicitly enabled with operator safeguards.
7. Confirm billing status uses scaffold/provider-safe mode and does not redirect unless enabled.

## UI Loading and Error QA

For each action below, test both success and a simulated failure when practical. The panel must clear its loading copy and show a safe result or safe error:

- Classroom connect/sync/disconnect
- Assignment Analyze flow
- Source upload/delete/reindex
- AI Ask/Plan/Make/Review
- MCQ score recording
- Onboarding roadmap generation
- Data export request/download
- Deletion dry-run
- Billing preview/manage billing

## Launch-Risk Review

Before launch, explicitly review:

- Production Supabase Auth + three data shards configured and distinct.
- RLS and private Storage bucket policies applied on all shards.
- Google OAuth app verified for intended audience.
- Classroom scopes are read-only and match Google Cloud console.
- Rate limits and quota enforcement enabled for production.
- Worker process supervision and retention cleanup scheduled.
- Export/download retention policy confirmed.
- Operator RBAC/MFA and deletion safeguards reviewed.
- Billing provider remains scaffolded or has completed provider-specific launch review.
### Optional Live Supabase Browser E2E

Use this only from a trusted local machine with real StudentOS `.env` values. It creates a disposable Supabase Auth user and verifies browser flows against the real auth project plus routed data shard.

```powershell
$env:STUDENTOS_E2E_SUPABASE_LIVE="true"
npm.cmd run test:e2e:supabase
Remove-Item Env:STUDENTOS_E2E_SUPABASE_LIVE
```

Auth user deletion is disabled by default. Set `STUDENTOS_E2E_SUPABASE_DELETE_AUTH_USER=true` only when you want the test helper to delete the disposable Auth user after the run. See `docs/E2E_SUPABASE_LIVE.md`.


### Optional Live Supabase E2E Report

Use this from a trusted local machine when you need an inspectable live run artifact without exposing secrets:

```powershell
npm.cmd run test:e2e:supabase:report
```

Review:

- `test-results/supabase-live/latest.json`
- `test-results/supabase-live/latest.md`

The report should show a routed shard label, masked disposable email, masked user id, row counts, cleanup counts, and skipped cleanup reasons only. For stale disposable users, first list with `npm.cmd run cleanup:e2e:supabase-users`; delete only with `STUDENTOS_E2E_DELETE_STALE_USERS=true`.


## Cloudflare / Azure Wiring QA

1. Set Cloudflare Pages `STUDENTOS_PUBLIC_API_BASE_URL` to `https://<azure-backend-fqdn>` and use `npm run cloudflare:config` as the frontend build command.
2. Set Azure Container App `CORS_ORIGINS` to `https://studentos.sentiqlabs.com,https://studentos-39s.pages.dev,http://localhost:3101,http://localhost:3102,http://127.0.0.1:3101,http://127.0.0.1:3102`.
3. Open `https://studentos.sentiqlabs.com` and verify API-backed UI sections load without same-origin fallback errors.
4. Open `https://<azure-backend-fqdn>/api/health` and verify `ok: true`.
5. Open `https://<azure-backend-fqdn>/api/config` and verify `deploymentTarget: azure-container-apps`, `frontendServedByBackend: false`, and no secrets appear.
6. Optionally run `npm.cmd run verify:cloudflare-azure` with `STUDENTOS_AZURE_API_URL` set locally.
