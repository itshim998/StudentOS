# StudentOS Live Classroom Manual E2E

This is an optional manual-assisted verification path. Do not automate Google credentials, school accounts, passwords, MFA, or consent-screen actions.

## Preconditions

- `STUDENTOS_GOOGLE_CLASSROOM_MODE=oauth`
- `GOOGLE_CLIENT_ID` is the Web OAuth client ID only.
- `GOOGLE_CLIENT_SECRET` is configured only in `.env` and never pasted into logs.
- `GOOGLE_REDIRECT_URI` matches the local server callback, for example `http://localhost:<port>/api/classroom/oauth/callback`.
- `STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET` is configured.
- Google OAuth scopes remain read-only:
  - `openid`
  - `https://www.googleapis.com/auth/userinfo.profile`
  - `https://www.googleapis.com/auth/userinfo.email`
  - `https://www.googleapis.com/auth/classroom.courses.readonly`
  - `https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly`
  - `https://www.googleapis.com/auth/classroom.course-work.readonly`
  - `https://www.googleapis.com/auth/classroom.student-submissions.me.readonly`

Run first:

```powershell
npm.cmd run verify:classroom-config
npm.cmd run preflight:production
```

## Manual-Assisted Browser Flow

1. Start StudentOS locally with the same port used in `GOOGLE_REDIRECT_URI`.
2. Open the app in a normal browser window.
3. Sign in to StudentOS if Supabase auth mode is enabled.
4. In **Today > Assignments**, click **Connect Classroom**.
5. Complete Google login and consent manually in the browser.
6. Return to StudentOS after the callback redirects back.
7. Click **Sync Classroom**.
8. Verify the Classroom panel shows:
   - connected state
   - provider account email only
   - read-only/no-write badges
   - no token values
   - last sync time
   - imported/updated/skipped counts
9. Verify imported Classroom courses and assignments appear with Google Classroom and read-only badges.
10. Click **Analyze assignment** and confirm it routes into StudentOS learning flow:
    - covered -> practice test
    - partially covered -> quick revision then test
    - uncovered -> mastery roadmap before test
11. Disconnect Classroom and confirm status returns to disconnected without leaking token details.

## Do Not Automate

- Google password entry
- MFA prompts
- school account selection
- OAuth consent clicks
- real Classroom submission/writeback
- Drive file content download

## Failure Cases To Manually Check

- Empty Classroom account shows empty-state copy.
- Expired or revoked token shows reconnect copy.
- Insufficient scope shows read-only scope/reconnect copy.
- Quota/rate limit shows retry-later copy.
- No UI surface offers turn-in, grade, post, modify, or submit actions.

## Evidence Rules

Screenshots and traces can accidentally include names, school emails, class titles, or assignment details. Keep Playwright traces/screenshots off by default. Redact any classroom-identifying details before sharing evidence.