# StudentOS Billing And Entitlements

StudentOS Pass 16 adds a billing-ready architecture without activating real payments.

## Supported Providers

- `none`: production-safe default. No payment operations.
- `mock`: local lifecycle testing with signed webhook fixtures.
- `razorpay`: backend-only adapter boundary and webhook signature verification scaffold.
- `stripe`: backend-only adapter boundary and webhook signature verification scaffold.
- `paddle`: backend-only adapter boundary and webhook signature verification scaffold.

No adapter creates a real charge or redirects to a checkout page in Pass 16. Provider-specific live checkout integration requires a later launch review.

## Environment Variables

```text
STUDENTOS_BILLING_PROVIDER=none
STUDENTOS_BILLING_LIVE_CHARGES_ENABLED=false
STUDENTOS_BILLING_CHECKOUT_REDIRECT_ENABLED=false
```

Provider secrets stay backend-only:

```text
STUDENTOS_BILLING_MOCK_WEBHOOK_SECRET
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
PADDLE_API_KEY
PADDLE_WEBHOOK_SECRET
```

## Persisted Records

Apply `202605250013_studentos_pass16_billing_entitlements.sql` identically to data shard Projects 2, 3, and 4.

Then apply `202606290001_studentos_pass35_4_plan_entitlements.sql` to the same three shards to align persisted plan and status constraints with the current launch catalog.

- `billing_subscriptions`: current plan, lifecycle status, renewal date, and provider references.
- `billing_webhook_events`: idempotency records for processed provider events.

Rows are user-owned, RLS-ready, and contain provider references only. They never store provider secret keys.

## Entitlement Resolution

PASS 35.4 moves launch plan policy to `backend/domain/planEntitlementService.js`. The billing service resolves the active access policy before applying hidden internal limits:

- AI calls
- Upload file size
- Source count
- Course count
- Reindex jobs
- Worker retries
- Advanced automation feature eligibility

StudentOS has no authenticated Free plan. Missing, unknown, retired, or cancelled plan access fails closed to an unselected state. Trial Mode resolves to its own fixed restricted policy rather than inheriting the selected paid plan. `past_due` remains entitlement-visible for future grace-period policy work.

Normal API responses return safe plan summaries and consumer-facing capability labels. Hidden numeric limits remain backend-only.

## API Scaffold

- `GET /api/billing/plans`
- `GET /api/billing/status`
- `POST /api/billing/checkout-preview`
- `POST /api/billing/manage-preview`
- `POST /api/billing/webhooks/:provider`

Checkout and management endpoints return previews only. Webhooks require provider-specific signatures and are idempotent.
