# Pass 24 Google Classroom Token Persistence + Sync History

StudentOS keeps Google Classroom read-only in this pass. It can import courses, coursework, due dates, materials metadata, and own submission status where the read-only API allows it. It cannot submit, grade, turn in, modify attachments, post comments, or write to Classroom.

## Required shard migration

Run this migration identically on data shards 2, 3, and 4:

```text
supabase/migrations/202605250020_studentos_pass24_classroom_tokens_sync_history.sql
```

The migration creates:

- `classroom_tokens`: backend/service-role only; stores encrypted OAuth token payloads and redacted account metadata.
- `classroom_sync_runs`: backend/service-role only; stores read-only sync summaries and sanitized errors.

Browser roles are revoked on both tables.

## Environment

```text
STUDENTOS_GOOGLE_CLASSROOM_MODE=mock|oauth|disabled
STUDENTOS_GOOGLE_CLASSROOM_OAUTH_STATE_SECRET=
STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET=
STUDENTOS_GOOGLE_CLASSROOM_TOKEN_KEY_ID=studentos-google-classroom-token-v1
STUDENTOS_GOOGLE_CLASSROOM_DRIVE_METADATA_ENABLED=false
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://<studentos-host>/api/classroom/oauth/callback
```

Use a dedicated `STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET` in staging and production. If it is missing, OAuth can fall back to process memory for local development, but that is not production token persistence.

## OAuth scopes

The allowed scopes remain:

- `openid`
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/classroom.courses.readonly`
- `https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly`
- `https://www.googleapis.com/auth/classroom.course-work.readonly`
- `https://www.googleapis.com/auth/classroom.student-submissions.me.readonly`

No Classroom write scope is allowed. Broader coursework, roster, courses-write, and Drive scopes remain disabled by default.

## Token security

- Access and refresh tokens are encrypted by the backend before shard persistence.
- Token values are never returned by `/api/classroom/status`, `/api/classroom/sync-history`, `/api/bootstrap`, export packages, frontend config, or logs.
- Disconnect removes the backend token row and clears safe connector metadata.
- Expired access tokens are refreshed with the refresh token. If refresh fails, connector state becomes `expired` and the UI asks the student to reconnect.

## Sync history

Manual sync writes a `classroom_sync_runs` record with counts for imported/updated/skipped items and sanitized error summaries. Repeated sync remains idempotent by provider IDs.
