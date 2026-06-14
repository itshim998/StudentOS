# StudentOS Pass 22 Operator MFA And Billing Reconciliation

## Default State

Operator MFA and final deletion remain disabled unless explicitly configured:

```text
STUDENTOS_INTERNAL_OPS_ENABLED=false
STUDENTOS_OPERATOR_MFA_REQUIRED=false
STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED=false
STUDENTOS_AUTH_ADMIN_DELETE_ENABLED=false
```

## Shard Migration

Apply `supabase/migrations/202605250019_studentos_pass22_mfa_billing_alerts.sql`
identically on Projects 2, 3, and 4. Then run:

```powershell
npm.cmd run verify:pass22-schema
```

The migration expands billing cancellation evidence statuses and adds
service-role-only, append-only `monitoring_alert_events`.

## Operator MFA Scaffold

Relevant variables:

```text
STUDENTOS_OPERATOR_SESSION_VERSION=v1
STUDENTOS_OPERATOR_MFA_REQUIRED=false
STUDENTOS_OPERATOR_MFA_REQUIRED_PERMISSIONS=deletion:execute,billing:waive,exports:cleanup
STUDENTOS_OPERATOR_MFA_METHODS=totp,phone
STUDENTOS_OPERATOR_MFA_CHALLENGE_TTL_SECONDS=300
STUDENTOS_OPERATOR_MFA_VERIFICATION_TTL_SECONDS=300
STUDENTOS_OPERATOR_MFA_MOCK_ENABLED=false
```

Sensitive routes still require a valid short-lived operator session first. When
MFA is required, the operator console creates an MFA challenge and refreshes the
session after verification. Real TOTP/phone delivery is scaffolded; mock
verification is for controlled non-production testing only and is forbidden by
production preflight.

## Billing Reconciliation

`STUDENTOS_BILLING_CANCELLATION_POLICY` supports:

- `immediate`: cycle-end cancellation is not enough for final deletion.
- `cycle_end`: provider-confirmed cancel-at-period-end can satisfy policy.

Provider state is normalized for Razorpay, Stripe, and Paddle. Active or unclear
states continue to block deletion. Live provider cancellation APIs are not called
in this pass.

## Monitoring Alerts

The alert scaffold records:

- high-risk operator actions
- billing cancellation failures
- deletion approval events
- export download anomaly logs

The current provider is `log`; external alert providers are not enabled.
