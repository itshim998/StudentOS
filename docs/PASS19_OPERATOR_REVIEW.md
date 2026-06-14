# StudentOS Pass 19 Export Operations And Deletion Review

## Shard Migration

Apply `supabase/migrations/202605250016_studentos_pass19_operator_review_retention.sql`
identically on Projects 2, 3, and 4.

It adds export retention metadata, service-role-only deletion review history, and
the targeted `claim_data_export_job_by_id` RPC used by the isolated live verifier.
It does not add a final deletion function.

## Live Export Verification

After the migration and private `studentos-data-exports` bucket exist on every
data shard, run:

```powershell
npm.cmd run verify:export-live
```

The verifier creates a synthetic student on one deterministic shard, requests an
export, claims only that synthetic export job, runs packaging, privately downloads
the package, checks field exclusions, deletes the private package, and removes its
synthetic database rows. Output is masked.

## Export Retention Cleanup

Configure:

```text
STUDENTOS_EXPORT_RETENTION_HOURS=48
```

Run one cleanup batch:

```powershell
npm.cmd run exports:cleanup
```

The cleanup deletes expired private export packages only. It clears the package
reference and records `account.data_export.retention_cleaned`. It never deletes
source materials.

An internal, token-protected endpoint is also available when internal operations
are explicitly enabled:

```text
POST /api/internal/exports/retention-cleanup
```

## Operator Review Console

The console is disabled by default. To enable the scaffold in a controlled
internal environment only:

```text
STUDENTOS_INTERNAL_OPS_ENABLED=true
STUDENTOS_INTERNAL_OPS_TOKEN=<backend-only operator token>
```

Then open `/operator`. Direct access returns `404` while the feature flag is off.
Every API call still requires the internal token.

The console can view export/deletion requests, view deletion dry-run totals and
diffs, record a note-required approval scaffold or rejection, and run export-only
retention cleanup.

Final account deletion remains disabled. No console action deletes account data.
