# StudentOS Account Lifecycle

Pass 17 adds production-shaped account lifecycle records while keeping irreversible actions disabled.

## Auth Completion

- Configure the Supabase Auth redirect URL as `https://<studentos-host>/auth/complete`.
- Email verification links complete on the account completion page.
- Password recovery links use the temporary Auth access token in the URL fragment to update the Auth project password.
- The completion page receives only the Auth project URL and anon key. Data shard keys remain backend-only.

## Consent And Legal

- `consent_versions` stores the active privacy, terms, and consent schema versions per student shard.
- `user_consents` records each preference against that version.
- `legal_acceptances` records explicit current-version acceptance.
- Consent withdrawal creates an auditable review scaffold. It does not trigger external messages or sharing changes outside StudentOS.

## Export Pipeline

- `data_export_requests` records a student request.
- `data_export_jobs` queues backend export generation for the dedicated export worker.
- Export preview code intentionally excludes secret fields, internal logs, provider references, storage paths, extracted source text, and source chunks.
- Export packages are JSON objects stored in a private bucket with a user-scoped object path.
- Downloads stream through the authenticated StudentOS backend and expire after a short window.

## Deletion Review

- `account_deletion_requests` records the request and grace-period end.
- Students can generate a read-only dry-run report with row, file, chunk, memory, embedding, and job counts.
- Final deletion remains disabled by default.
- Internal review is scaffolded behind `STUDENTOS_INTERNAL_OPS_ENABLED` and a backend-only token.
- Pass 20 prepares dual-control review, fresh dry-run comparison, Storage API cleanup, shard cleanup, server-only Auth deletion, and append-only evidence.
- Launch still requires billing-provider cancellation execution, partial-failure recovery drills, legal retention review, and production operator identity hardening.

## Future Roles

- `role_invitations` supports guardian, teacher, and institution groundwork.
- Invitations remain disabled by default.
- Student consent is required before any future invitation can become active.
