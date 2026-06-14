# StudentOS Pass 21 Operator RBAC And Monitoring

## Default State

Internal operations and final deletion remain disabled:

```text
STUDENTOS_INTERNAL_OPS_ENABLED=false
STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED=false
STUDENTOS_AUTH_ADMIN_DELETE_ENABLED=false
STUDENTOS_BILLING_CANCELLATION_PROVIDER_CALLS_ENABLED=false
STUDENTOS_BILLING_CANCELLATION_MANUAL_WAIVER_ENABLED=false
```

## Shard Migration

Apply `supabase/migrations/202605250018_studentos_pass21_operator_rbac_monitoring.sql`
identically on Projects 2, 3, and 4. Then run:

```powershell
npm.cmd run verify:pass21-schema
```

The migration adds service-role-only, append-only `operator_audit_events` and
`billing_cancellation_events`. Browser clients receive no table permissions.

## Operator Sessions

When internal ops is explicitly enabled, configure:

```text
STUDENTOS_INTERNAL_OPS_TOKEN=
STUDENTOS_OPERATOR_SESSION_SECRET=
STUDENTOS_OPERATOR_SESSION_TTL_SECONDS=300
STUDENTOS_OPERATOR_ROSTER_JSON=[]
```

The bootstrap token is exchanged once at `/api/internal/operator/session`.
Subsequent internal API requests use a signed, short-lived bearer session.

## Least Privilege Roles

- `owner`: all current internal permissions, including guarded execution checks.
- `support_admin`: lifecycle read, monitoring, export retention cleanup.
- `privacy_reviewer`: lifecycle read, monitoring, deletion review.
- `billing_operator`: lifecycle read, monitoring, billing review.
- `read_only_auditor`: lifecycle read and monitoring only.

## Safe Monitoring

`GET /api/internal/monitoring/status` requires `monitoring:read`. It reports
redacted Auth, shard, private-storage readiness, queue, AI, billing, and RBAC
status. It never returns bucket names, keys, tokens, or source content.

## Billing Cancellation

Razorpay, Stripe, and Paddle expose cancellation preparation hooks only. No live
provider cancellation request is sent in Pass 21. A paid subscription blocks
deletion unless a later provider integration satisfies policy or a separately
enabled, permissioned manual waiver records evidence.
