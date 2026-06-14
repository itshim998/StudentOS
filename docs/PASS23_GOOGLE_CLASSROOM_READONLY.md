# StudentOS Pass 23 Google Classroom Read-Only Import

## Environment

```text
STUDENTOS_GOOGLE_CLASSROOM_MODE=mock
STUDENTOS_GOOGLE_CLASSROOM_OAUTH_STATE_SECRET=
STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET=
STUDENTOS_GOOGLE_CLASSROOM_TOKEN_KEY_ID=studentos-google-classroom-token-v1
STUDENTOS_GOOGLE_CLASSROOM_DRIVE_METADATA_ENABLED=false
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://<studentos-host>/api/classroom/oauth/callback
```

Modes:

- `mock`: imports deterministic mock Classroom data into StudentOS.
- `oauth`: enables backend OAuth start/callback and read-only sync.
- `disabled`: hides functional sync behavior.

## Google Cloud Setup

1. Create or select a Google Cloud OAuth client.
2. Add the redirect URI:
   `https://<studentos-host>/api/classroom/oauth/callback`
3. Configure only the current read-only scopes listed in
   `GOOGLE_CLASSROOM_CONNECTOR_PRIVACY.md`.
4. Store `GOOGLE_CLIENT_SECRET` and `STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET` only in backend runtime secret storage.

## Sync Behavior

Manual sync imports Classroom courses and coursework into existing StudentOS
tables:

- `courses`
- `assignments`
- `source_materials`
- `audit_logs`
- `classroom_tokens`
- `classroom_sync_runs`

No Google Classroom write APIs are implemented.
