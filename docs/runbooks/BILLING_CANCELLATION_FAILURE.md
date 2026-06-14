# Billing Cancellation Failure Runbook

1. Leave account deletion blocked.
2. Record provider, target user id, request id, and the safe cancellation status.
3. Confirm whether the policy is `immediate` or `cycle_end`.
4. Check the provider dashboard manually without copying secrets into StudentOS logs.
5. Use a manual waiver only when the feature flag is explicitly enabled, the operator has permission, MFA is satisfied when required, and evidence is recorded.
6. Reconcile subscription status through the provider webhook path after recovery.
