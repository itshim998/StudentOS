# StudentOS Pass 20 Final Deletion Safety Architecture

## Default State

Final account deletion remains disabled:

```text
STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED=false
STUDENTOS_AUTH_ADMIN_DELETE_ENABLED=false
```

The operator console can record reviews and run a guarded execution check, but
the backend refuses irreversible work while either flag is false.

## Shard Migration

Apply `supabase/migrations/202605250017_studentos_pass20_final_deletion_safety.sql`
identically on Projects 2, 3, and 4.

The migration:

- Adds execution status references to deletion requests.
- Adds service-role-only append-only `deletion_execution_evidence`.
- Rejects updates and deletes against immutable evidence.
- Requires distinct operator approvals at the database index layer.
- Repairs qualified column references in the Pass 18 and Pass 19 export claim RPCs.
- Does not add a SQL account deletion executor.

After applying the migration, run:

```powershell
npm.cmd run verify:pass20-schema
```

The verifier performs masked reads and probes the repaired targeted RPC using a
nonexistent synthetic job id. It does not enable or execute deletion.

## Required Safeguards

Production activation is intentionally manual and review-heavy:

```text
STUDENTOS_INTERNAL_OPS_ENABLED=false
STUDENTOS_INTERNAL_OPS_TOKEN=
STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED=false
STUDENTOS_AUTH_ADMIN_DELETE_ENABLED=false
STUDENTOS_DELETION_DUAL_CONTROL_REQUIRED=true
STUDENTOS_DELETION_EVIDENCE_ENABLED=true
STUDENTOS_DELETION_REQUIRED_APPROVALS=2
STUDENTOS_DELETION_DIFF_MAX_ROW_CHANGE=25
STUDENTOS_DELETION_ALLOW_BILLING_MARK_ONLY=false
```

Before any activation, run `npm.cmd run preflight:production`. Preflight reports
errors if final deletion is enabled without internal ops, Auth admin deletion,
dual control, or immutable evidence.

## Execution Shape

The internal execution path:

1. Generates a fresh deletion dry run.
2. Compares it with the prior dry run.
3. Requires two distinct operator approvals and an executor identity.
4. Blocks self-approval and target-user execution.
5. Requires explicit acknowledgement for unexpectedly large diffs.
6. Blocks paid-account deletion until billing provider cancellation policy is reviewed.
7. Writes append-only evidence before destructive work.
8. Deletes source files and exports through private Storage API calls.
9. Deletes user-owned shard rows while preserving immutable evidence.
10. Calls the server-only Auth admin deletion boundary.
11. Writes completion or partial-failure evidence.

## Known Launch Blockers

- Keep both destructive flags false until an operator runbook and recovery drill exist.
- Add provider-specific billing cancellation execution.
- Add retry-safe recovery for partial failure after shard cleanup.
- Configure and review the Pass 21 named operator roster and short-lived session authorization before launch.
- Review legal retention requirements for immutable evidence.
