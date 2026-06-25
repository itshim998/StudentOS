# StudentOS Production Deployment

StudentOS is a SentIQGPT product with one Auth Supabase project and three backend-only data shard projects per environment.

See [SAAS_FOUNDATION.md](SAAS_FOUNDATION.md) for the role, plan, quota, and tenant model.

## Environments

- `development`: local/mock by default, demo seed allowed.
- `staging`: production-like Supabase topology, no real student data.
- `production`: real StudentOS Auth project plus three real data shards.

Each environment needs separate Supabase projects:

- Project 1: Auth/session/JWT only.
- Projects 2, 3, 4: academic data, private source metadata, chunks, memory, jobs, embeddings metadata.

Do not reuse SentIQGPT keys or Supabase projects.

## Required Production Variables

- `STUDENTOS_ENV=production`
- `STUDENTOS_MODE=supabase`
- `CORS_ORIGINS=https://your-studentos-domain`
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
- `STUDENTOS_EXPORT_STORAGE_BUCKET`
- `STUDENTOS_EXPORT_DOWNLOAD_EXPIRY_SECONDS=900`
- `STUDENTOS_EXPORT_RETENTION_HOURS=48`
- `STUDENTOS_RATE_LIMIT_ENABLED=true`
- `STUDENTOS_QUOTA_ENFORCEMENT=true`
- `STUDENTOS_DEMO_SEED_ENABLED=false`
- `STUDENTOS_BILLING_PROVIDER=none`
- `STUDENTOS_BILLING_LIVE_CHARGES_ENABLED=false`
- `STUDENTOS_BILLING_CHECKOUT_REDIRECT_ENABLED=false`
- `STUDENTOS_PRIVACY_VERSION`
- `STUDENTOS_TERMS_VERSION`
- `STUDENTOS_CONSENT_SCHEMA_VERSION`
- `STUDENTOS_ACCOUNT_DELETION_GRACE_DAYS`
- `STUDENTOS_INTERNAL_OPS_ENABLED=false`
- `STUDENTOS_INTERNAL_OPS_TOKEN=`
- `STUDENTOS_OPERATOR_SESSION_SECRET=`
- `STUDENTOS_OPERATOR_SESSION_VERSION=v1`
- `STUDENTOS_OPERATOR_SESSION_TTL_SECONDS=300`
- `STUDENTOS_OPERATOR_ROSTER_JSON=[]`
- `STUDENTOS_OPERATOR_MFA_REQUIRED=false`
- `STUDENTOS_OPERATOR_MFA_REQUIRED_PERMISSIONS=deletion:execute,billing:waive,exports:cleanup`
- `STUDENTOS_OPERATOR_MFA_METHODS=totp,phone`
- `STUDENTOS_OPERATOR_MFA_MOCK_ENABLED=false`
- `STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED=false`
- `STUDENTOS_AUTH_ADMIN_DELETE_ENABLED=false`
- `STUDENTOS_DELETION_DUAL_CONTROL_REQUIRED=true`
- `STUDENTOS_DELETION_EVIDENCE_ENABLED=true`
- `STUDENTOS_DELETION_REQUIRED_APPROVALS=2`
- `STUDENTOS_DELETION_DIFF_MAX_ROW_CHANGE=25`
- `STUDENTOS_DELETION_ALLOW_BILLING_MARK_ONLY=false`
- `STUDENTOS_BILLING_CANCELLATION_PROVIDER_CALLS_ENABLED=false`
- `STUDENTOS_BILLING_CANCELLATION_MANUAL_WAIVER_ENABLED=false`
- `STUDENTOS_BILLING_CANCELLATION_POLICY=immediate`
- `STUDENTOS_MONITORING_ALERTS_ENABLED=true`
- `STUDENTOS_MONITORING_ALERT_PROVIDER=log`
- `STUDENTOS_GOOGLE_CLASSROOM_MODE=disabled`
- `STUDENTOS_GOOGLE_CLASSROOM_OAUTH_STATE_SECRET=`
- `STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET=`
- `STUDENTOS_GOOGLE_CLASSROOM_TOKEN_KEY_ID=studentos-google-classroom-token-v1`
- `STUDENTOS_GOOGLE_CLASSROOM_DRIVE_METADATA_ENABLED=false`
- `STUDENTOS_GOOGLE_CLASSROOM_MAX_IMPORTED_ASSIGNMENTS=200`
- `STUDENTOS_GOOGLE_CLASSROOM_MAX_IMPORTED_MATERIALS=400`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI=https://<studentos-host>/api/classroom/oauth/callback`
- `STUDENTOS_AUTH_REDIRECT_URL=https://<studentos-host>/auth/complete`

AI and embedding keys are backend-only.

## Preflight

Run:

```bash
npm run preflight:production
```

The script prints only masked/safe status. It must not print env values.

## Processes

- Web/API: `npm start`
- Worker one-shot: `npm run jobs:work`
- Worker daemon/dev: `npm run jobs:dev`
- Export worker one-shot: `npm run exports:work`
- Export worker daemon/dev: `npm run exports:dev`
- Expired export cleanup: `npm run exports:cleanup`
- Live private export verification: `npm run verify:export-live`
- Live worker verification: `npm run verify:worker`

Production should run the worker as a separate service/process with restart policy and logs.

## Migrations

Apply all shard migrations through `202605250019_studentos_pass22_mfa_billing_alerts.sql` to Projects 2, 3, and 4. Apply Auth migrations only to Project 1. Never run destructive migrations automatically from app startup.

## Supabase Dashboard Settings

- RLS enabled on user-owned tables.
- Storage bucket private by default.
- Create `STUDENTOS_EXPORT_STORAGE_BUCKET` as a second private bucket. If omitted, StudentOS safely falls back to the private source-material bucket.
- Service role keys stored only in backend runtime env.
- Browser receives only Auth project URL and anon key.
- Data shard URLs and service keys never go to frontend.
- Add `https://<studentos-host>/auth/complete` to the Auth project redirect URL allowlist.
- Add `https://<studentos-host>/api/classroom/oauth/callback` to the Google OAuth redirect URI allowlist before enabling Classroom OAuth mode.
- Run `supabase/migrations/202605250020_studentos_pass24_classroom_tokens_sync_history.sql` on data shards 2, 3, and 4 before enabling OAuth token persistence outside local development.
- Store `GOOGLE_CLIENT_SECRET` and `STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET` in backend-only runtime secret storage.

## Deployment Notes

- Use HTTPS only.
- Configure CORS to exact production origins.
- Use short retention for operational logs that may contain student metadata.
- Keep demo seed disabled in production.
- Keep source citations strict; no model-generated citations are trusted.
- Keep Classroom production mode `disabled` until live read-only OAuth has a dedicated backend secret set and a non-localhost redirect URI.
