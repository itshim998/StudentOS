# StudentOS Auth Redirects

StudentOS uses separate routes for email verification and password recovery:

- `/auth/callback` receives verified sign-up sessions, stores the session, removes tokens from the URL, and resumes lifecycle setup.
- `/auth/complete` is the styled password-recovery completion page.

Sign-up requests derive the callback URL from the frontend's current origin. The expected URLs are:

```text
http://localhost:3101/auth/callback
https://studentos.sentiqlabs.com/auth/callback
https://studentos-39s.pages.dev/auth/callback
```

Do not configure `localhost:3000` for StudentOS. The local frontend uses port `3101`.

## Supabase Dashboard Settings

In the Auth URL configuration for the StudentOS Auth project:

1. Set the production Site URL to `https://studentos.sentiqlabs.com`.
2. Add `https://studentos.sentiqlabs.com/auth/callback` to Redirect URLs.
3. Add `http://localhost:3101/auth/callback` for local verification.
4. Add `https://studentos-39s.pages.dev/auth/callback` only when Pages preview verification is required.
5. Keep the corresponding `/auth/complete` URLs allowed for password recovery.

The backend variable `STUDENTOS_AUTH_REDIRECT_URL` remains the password-recovery destination and should end in `/auth/complete`. Sign-up verification does not use that backend variable.

## User Cleanup

Deleting a user from the Supabase Auth project does not delete that user's StudentOS shard rows, source files, chunks, memory, jobs, or billing/lifecycle records. Recreating the same email in Auth is therefore not proof of a clean new-user state. Use the StudentOS reviewed deletion workflow or the dedicated live-E2E cleanup path when a complete test-user cleanup is required.
