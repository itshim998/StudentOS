# Pass 26 Classroom Import QA

StudentOS imports Google Classroom in read-only mode. It must never submit, grade, post, turn in, or modify Classroom work.

## Preconditions

- `STUDENTOS_GOOGLE_CLASSROOM_MODE=oauth`
- `GOOGLE_CLIENT_ID` is the Web OAuth client ID only, with no `https://` prefix or trailing slash.
- `GOOGLE_REDIRECT_URI=http://localhost:3101/api/classroom/oauth/callback`
- `STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET` is configured.
- The Google OAuth client includes only the approved read-only Classroom scopes.

Run:

```powershell
npm.cmd run verify:classroom-config
npm.cmd run preflight:production
```

## Browser QA

1. Start StudentOS with `npm.cmd run dev`.
2. Sign in to a StudentOS account.
3. Open **Today**.
4. In **Assignments**, click **Connect Classroom**.
5. Complete Google consent.
6. Return to StudentOS and click **Sync Classroom**.
7. Verify the Classroom panel shows:
   - connected Google account
   - read-only/no-write badges
   - last sync time
   - sync summary or empty-Classroom copy
8. Verify **Today > Assignments** shows imported assignments with:
   - Google Classroom badge
   - read-only badge
   - coverage status: covered, partially covered, or uncovered
   - **Analyze assignment** action
9. Click **Analyze assignment** on an imported assignment.
10. Verify the result routes into the existing StudentOS learning flow:
    - covered -> practice test
    - partially covered -> quick revision then test
    - uncovered -> mastery roadmap before test
11. Open **Courses**.
12. Verify the Classroom import card shows connector state, course count, assignment count, last sync, and no-writeback.
13. Verify imported courses show provider/read-only badges and assignment count.
14. Temporarily simulate a failed assignment-flow request or disconnect the server, then click **Analyze assignment**. Verify the panel changes from loading to **Assignment flow unavailable** with safe-error/no-submission badges.

## Error QA

- Empty Classroom account: sync should succeed with zero imports and empty-account copy.
- Insufficient scope: sync should fail with safe scope/reconnect copy, no tokens.
- Expired or revoked token: connector state should become expired and show reconnect copy.
- Quota/rate limit: sync should show safe retry-later copy.

## Safety Checks

Run:

```powershell
npm.cmd run test:pass26
rg -n "turnIn|modifyAttachments|reclaimSubmission|/turnIn|/modifyAttachments|/reclaim" backend\connectors\googleClassroom frontend scripts -S
```

Expected: no Classroom write actions in connector/frontend scripts.
