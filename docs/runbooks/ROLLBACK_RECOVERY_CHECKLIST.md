# Rollback And Recovery Checklist

- Disable final deletion and internal ops first.
- Stop API and worker rollout if schema or authorization behavior regresses.
- Preserve append-only audit and deletion evidence.
- Restore application code before attempting data repair.
- Re-run shard schema verifiers and production preflight.
- Validate private Storage access, export delivery, queue health, and Auth boundaries before reopening traffic.
