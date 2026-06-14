# Operator Access Runbook

1. Keep `STUDENTOS_INTERNAL_OPS_ENABLED=false` until an approved maintenance window.
2. Create named roster entries with the smallest role required.
3. Store the bootstrap token and session signing secret in backend secret storage.
4. Open `/operator`, exchange the bootstrap token once, and verify the displayed role and expiry.
5. Complete MFA before any sensitive action when `STUDENTOS_OPERATOR_MFA_REQUIRED=true`.
6. Use short sessions only. Do not paste tokens into tickets, chat, or logs.
7. Rotate `STUDENTOS_OPERATOR_SESSION_VERSION` to invalidate existing operator sessions.
8. Disable the roster entry and rotate secrets after suspected compromise.
9. Review append-only `operator_audit_events` and `monitoring_alert_events` after high-risk actions.
