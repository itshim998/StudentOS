# StudentOS Account Management

StudentOS account management is backend-mediated. The browser may use the Auth project anon key for login/signup, but data export, deletion, consent, and account status requests go through the StudentOS API.

## Implemented Through Pass 17

- Email verification-ready signup messaging.
- Password reset request endpoint and UI.
- Account settings screen.
- Student-only progress visibility by default.
- Versioned consent preferences, legal acceptance records, and withdrawal request scaffold.
- Data export request plus backend export-job queue scaffold.
- Account deletion review queue with grace period and no immediate destructive deletion.
- Auth completion page for verification and password recovery links.
- Verification resend UI and backend-mediated request route.
- Disabled-by-default guardian, teacher, and institution invitation groundwork.
- Private JSON export worker and authenticated short-window download stream.
- Read-only deletion dry-run report with no destructive action.
- Plan badge, quota usage, source count, storage usage, and upgrade placeholder.

## Safety Boundaries

- No service-role keys are sent to the browser.
- No model provider keys are sent to the browser.
- Account deletion is request-only and manual-review by default.
- Future parent, guardian, teacher, institution, and admin roles require explicit consent and scoped permission design before activation.
- Demo seed remains disabled in production.
- Final deletion remains disabled until a dedicated launch review.
- Internal account operations are feature-flagged and require a backend-only token.

## Future Launch Work

- Reviewed final-deletion implementation across Auth, shards, Storage, and billing.
- Legal policy content, retention windows, and operator runbook review.
- Billing provider integration.
