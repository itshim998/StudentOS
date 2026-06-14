# StudentOS Production Security Checklist

## Secrets

- Service role keys are backend-only.
- Groq, Pollinations, embedding, and Google keys are backend-only.
- `.env` is gitignored.
- Preflight/logging redacts keys, bearer tokens, and service-role-like values.

## Auth And Isolation

- Project 1 handles Auth only.
- Data shards are selected by authenticated user id.
- Browser never talks directly to data shards.
- All user-owned rows include `user_id`.
- RLS is enabled and tested on shard tables.

## Storage

- Source material bucket is private.
- Backend controls upload, download, delete.
- No public URLs for source files.
- Hard delete uses Storage API plus row cleanup.

## API Boundary

- JWT/session verification happens on backend.
- Request IDs are returned on API responses.
- Structured logs must be secret-redacted.
- Rate limit scaffold enabled in production.
- Quota enforcement enabled in production.

## Billing

- Billing provider secrets are backend-only.
- Real charges and checkout redirects remain disabled until launch review.
- Webhook routes verify provider-specific signatures.
- Webhook event ids are persisted for idempotency.
- Subscription rows store provider references, never provider secrets.

## Account Lifecycle

- Supabase Auth redirect URL points to `/auth/complete`.
- Recovery fragments are removed after completion handling.
- Consent preferences are versioned against privacy and terms versions.
- Data export output excludes secrets, provider references, storage paths, extracted source text, and internal logs.
- Account deletion is review-first with a grace period.
- Final deletion remains disabled until a dedicated launch review.
- Final deletion requires two distinct operator approvals, a fresh dry run, diff review, and immutable append-only evidence.
- Auth admin deletion is a backend-only boundary and remains disabled separately from the final deletion flag.
- Internal account operations stay disabled unless the backend-only bootstrap token, session signing secret, and named operator roster are configured.
- Operator bootstrap tokens mint short-lived signed sessions and are not reused on routine internal API requests.
- Operator sessions carry a version claim so rotating `STUDENTOS_OPERATOR_SESSION_VERSION` invalidates old sessions.
- Sensitive operator actions can require MFA; production final deletion must not be enabled unless operator MFA is required.
- Operator audit and billing cancellation evidence are service-role-only and append-only.
- Paid-account deletion remains blocked until billing cancellation policy is satisfied or a separately enabled, permissioned waiver records evidence.
- Billing cancellation reconciliation normalizes Razorpay, Stripe, and Paddle states before deletion execution is considered.
- Monitoring alert events are service-role-only and append-only; external alert delivery remains scaffolded.
- Guardian, teacher, and institution invitations remain disabled until explicit student-consent flows ship.
- Export packages stay in a private bucket with user-scoped paths.
- Export downloads stream through authenticated backend authorization with a short expiry.
- Deletion dry runs enumerate safe counts without deleting rows or objects.
- Dashboard bootstrap responses redact storage paths, bucket references, embedding vectors, worker payloads, audit logs, and billing provider references.

## Files

- File size limits are enforced before extraction.
- Unsupported file types are rejected.
- PDF OCR is scaffolded as `needs_ocr`; OCR provider is not enabled yet.
- Extraction errors are sanitized.

## Academic Integrity

- Assignment automation remains review-first.
- No real Classroom posting.
- No email auto-send.
- No silent submission.
- Convenience workflows are credit-gated; essential learning is not.

## CORS

- Development may allow localhost.
- Production must use exact StudentOS origins.
- Do not use wildcard production CORS.

## Required Before Launch

- Run `npm run preflight:production`.
- Run all local tests.
- Verify live Supabase status and worker verification.
- Review storage bucket RLS policies.
- Review logs for secret redaction.
- Apply shard migrations through Pass 22 identically on all three data shards.
