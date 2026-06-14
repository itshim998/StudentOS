# StudentOS Live Supabase E2E Runbook

Use this only from a trusted local machine with the StudentOS `.env` present. The live E2E creates a disposable Supabase Auth user, routes that user to exactly one data shard, runs browser flows, then attempts test-owned cleanup.

## Commands

Deterministic mock browser E2E:

```powershell
npm.cmd run test:e2e
```

Live Supabase E2E without report artifacts:

```powershell
$env:STUDENTOS_E2E_SUPABASE_LIVE="true"
npm.cmd run test:e2e:supabase
Remove-Item Env:STUDENTOS_E2E_SUPABASE_LIVE
```

Live Supabase E2E with safe report artifacts:

```powershell
npm.cmd run test:e2e:supabase:report
```

The report runner sets `STUDENTOS_E2E_SUPABASE_LIVE=true` and `STUDENTOS_E2E_SUPABASE_REPORT=true` for the child Playwright process.

## Report Output

Reports are written under ignored `test-results/`:

- `test-results/supabase-live/latest.json`
- `test-results/supabase-live/latest.md`

The report includes:

- routed shard label
- masked disposable email
- masked user id
- row counts for required routed-shard tables
- row counts for checked non-routed shards
- storage cleanup counts
- auth cleanup status
- skipped or failed cleanup reasons

The report must not include raw JWTs, service-role keys, provider API keys, OAuth tokens, refresh tokens, or URLs with embedded credentials.

## Cleanup Behavior

The live E2E cleanup only targets the disposable user created by the test. Cleanup is refused unless the email matches:

```text
studentos.e2e.*@example.com
```

Data cleanup filters by the test user's id and deletes only test-owned rows. Source and export files are deleted through the Supabase Storage API when storage paths exist.

Auth user deletion remains opt-in:

```powershell
$env:STUDENTOS_E2E_SUPABASE_DELETE_AUTH_USER="true"
npm.cmd run test:e2e:supabase:report
Remove-Item Env:STUDENTOS_E2E_SUPABASE_DELETE_AUTH_USER
```

Leave auth deletion disabled when you want to inspect the disposable user after a failed run.

## Stale Disposable User Cleanup

List old disposable users without deleting:

```powershell
npm.cmd run cleanup:e2e:supabase-users
```

Delete only matching stale disposable users and their routed-shard test data:

```powershell
$env:STUDENTOS_E2E_DELETE_STALE_USERS="true"
npm.cmd run cleanup:e2e:supabase-users
Remove-Item Env:STUDENTOS_E2E_DELETE_STALE_USERS
```

Optional age threshold:

```powershell
$env:STUDENTOS_E2E_STALE_USER_MIN_AGE_HOURS="1"
```

The cleanup helper is server-side only. It never exposes service-role keys to the browser.

## Troubleshooting

- If the report is missing, check whether the Playwright process reached `afterAll`. Hard process termination can prevent report finalization.
- If upload fails, inspect the masked `/api/sources/upload` attachment in the Playwright output and the report failure section.
- If cleanup is skipped, confirm the test email is a disposable `studentos.e2e.*@example.com` address.
- If row counts appear on more than one shard, stop and inspect shard routing before rerunning cleanup.
- If Auth cleanup is skipped, this is expected unless `STUDENTOS_E2E_SUPABASE_DELETE_AUTH_USER=true` or the stale cleanup delete flag is set.
- Do not paste `.env`, service-role keys, JWTs, OAuth tokens, or report contents containing unexpected sensitive data into issue trackers.
