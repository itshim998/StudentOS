# StudentOS Live Supabase E2E

Pass 29 added an optional browser E2E path against real Supabase projects. Pass 30 adds optional report artifacts and stricter cleanup gates. It is disabled by default and should only run from a trusted local machine with the StudentOS `.env` present.

## Safety Defaults

- The test does not run unless `STUDENTOS_E2E_SUPABASE_LIVE=true` is set.
- The server is started with `STUDENTOS_MODE=supabase` on a free local port.
- Google Classroom is forced to `disabled` for this test. Do not automate Google login.
- AI is forced to `STUDENTOS_AI_MODE=mock` to avoid provider spend and network dependence.
- Playwright traces, screenshots, and videos remain off by default.
- Supabase service-role keys stay in Node test setup only. They are never injected into the browser.

## Command

```powershell
$env:STUDENTOS_E2E_SUPABASE_LIVE="true"
npm.cmd run test:e2e:supabase
Remove-Item Env:STUDENTOS_E2E_SUPABASE_LIVE
```

To allow Auth user cleanup after the run, explicitly add:

```powershell
$env:STUDENTOS_E2E_SUPABASE_DELETE_AUTH_USER="true"
```

Leave that flag unset if you want to inspect the disposable Auth user manually after the run.

## Required Environment

The local `.env` must contain real StudentOS Supabase values:

- `STUDENTOS_SUPABASE_URL_1`
- `STUDENTOS_SUPABASE_ANON_KEY_1`
- `STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_1`
- `STUDENTOS_SUPABASE_URL_2`
- `STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_2`
- `STUDENTOS_SUPABASE_URL_3`
- `STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_3`
- `STUDENTOS_SUPABASE_URL_4`
- `STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_4`
- `STUDENTOS_SUPABASE_JWT_SECRET`
- `STUDENTOS_STORAGE_BUCKET`

Do not paste these values into logs or tickets.

## Covered Flow

The live test creates a disposable Auth user server-side, then drives the browser through:

1. Email/password sign in.
2. Onboarding and roadmap generation.
3. TXT source upload to private Supabase Storage.
4. Extraction/indexing and chunk count UI.
5. Ask/Plan/Make/Review using uploaded-source citations.
6. Assignment-flow analysis without stuck loading.
7. Account export request.
8. Billing plan/quota UI.
9. Logout and login persistence.
10. Direct shard verification for rows on exactly one routed data shard.
11. Other-shard leakage check for key user-owned tables.
12. Frontend secret scan for service keys and provider keys.

## Cleanup Behavior

The test always attempts to clean the routed data shard after the browser flow:

- source rows and source chunks
- uploaded source storage objects when storage paths are available
- AI conversations/messages
- roadmap/profile/course rows
- export request/job rows
- related account, billing, job, and audit rows where user-owned filters exist

Auth-project user deletion is disabled unless `STUDENTOS_E2E_SUPABASE_DELETE_AUTH_USER=true` is set. If that flag is not set, manually remove the disposable user from the Auth project after inspection. The disposable email uses the pattern `studentos.e2e.<timestamp>-<id>@example.com`.

## Manual Classroom E2E

Live Classroom OAuth is intentionally separate. Use `docs/E2E_CLASSROOM_LIVE_MANUAL.md` for the manual-assisted Classroom flow. Do not automate Google credentials, MFA, account selection, or consent clicks.

## Failure Handling

If the command is run without `STUDENTOS_E2E_SUPABASE_LIVE=true`, Playwright skips the live test safely. If the flag is set but required Supabase env is missing, the test fails with missing key names only; it does not print secret values.

## Report Mode

Run the live E2E with masked JSON and Markdown report artifacts:

```powershell
npm.cmd run test:e2e:supabase:report
```

Outputs are ignored by git:

- `test-results/supabase-live/latest.json`
- `test-results/supabase-live/latest.md`

The report includes shard label, masked test email, masked user id, row counts, storage cleanup counts, auth cleanup status, and skipped or failed cleanup reasons. It must not contain raw JWTs, service-role keys, provider API keys, OAuth tokens, refresh tokens, or URLs with embedded credentials.

## Stale Disposable Cleanup Helper

List stale disposable E2E users safely:

```powershell
npm.cmd run cleanup:e2e:supabase-users
```

Delete only matching disposable users and routed-shard test data with an explicit flag:

```powershell
$env:STUDENTOS_E2E_DELETE_STALE_USERS="true"
npm.cmd run cleanup:e2e:supabase-users
Remove-Item Env:STUDENTOS_E2E_DELETE_STALE_USERS
```

The cleanup helper refuses non-test emails and only matches `studentos.e2e.*@example.com`. See `docs/E2E_SUPABASE_LIVE_RUNBOOK.md`.
