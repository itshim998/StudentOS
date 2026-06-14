# StudentOS Pass 18 Export Delivery And Deletion Dry Runs

## Shard Migration

Apply `supabase/migrations/202605250015_studentos_pass18_export_worker_dry_run.sql`
identically on Projects 2, 3, and 4.

The migration adds export package metadata, deletion dry-run metadata, and the
service-role-only `claim_next_data_export_job` RPC.

## Private Export Bucket

Create `studentos-data-exports` in each data-shard Supabase project:

- Keep the bucket private.
- Do not enable public object access.
- Keep Storage access backend-only through the shard service role.
- Set `STUDENTOS_EXPORT_STORAGE_BUCKET=studentos-data-exports`.
- Set `STUDENTOS_EXPORT_DOWNLOAD_EXPIRY_SECONDS=900` for a 15-minute download window.

StudentOS can fall back to `STUDENTOS_STORAGE_BUCKET`, but a separate private export
bucket is recommended for retention and cleanup policy clarity.

## Export Worker

Run one batch:

```powershell
npm.cmd run exports:work
```

Run the development daemon:

```powershell
npm.cmd run exports:dev
```

The worker claims queued export jobs, builds a redacted JSON package, uploads it to
private shard storage, and marks the request ready. Packages exclude provider
references, secrets, internal logs, storage paths, extracted source text, and source
chunks.

## Secure Download

`GET /api/account/exports/:requestId/download` streams the private package only after
StudentOS session verification and user ownership checks. The browser never receives
the shard URL, service key, bucket name, or object path.

## Deletion Dry Run

`POST /api/account/deletion-requests/:requestId/dry-run` returns a read-only preview
of rows and private objects that would require cleanup. It does not delete anything.

Final deletion remains disabled. A later launch review must cover Auth deletion,
Storage cleanup, shard row deletion, billing cancellation, retention policy, operator
authorization, and recovery procedures.
