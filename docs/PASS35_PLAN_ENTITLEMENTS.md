# PASS 35.4 Plan Entitlements

## Authority

`backend/domain/planEntitlementService.js` is the launch source of truth for StudentOS plan keys, public plan summaries, feature availability, hidden usage policy, Classroom cadence, assistant depth, academic-context policy, and disabled write actions.

`backend/saas/plans.js` is now a compatibility adapter for older quota and billing callers. New product code must consume the domain entitlement service directly instead of creating plan constants in frontend code or feature modules.

## Launch Plans

StudentOS has four paid plans and one fixed restricted trial policy:

- Starter — ₹99/month
- Essential — ₹159/month and the recommended plan
- Plus — ₹259/month
- Pro — ₹549/month
- Trial Mode — optional seven-day restricted access; it does not inherit the selected paid plan's entitlements

There is no authenticated Free plan. Unknown, missing, retired, or malformed plan values normalize to an unselected state with no feature access. Product lifecycle gates still decide dashboard access; an environment default never completes lifecycle setup for a user.

## Public Summaries And Internal Policy

Public plan summaries contain only the plan name, consumer price, positioning, five or six outcome-oriented bullets, a best-for line, and the Essential recommendation badge. They contain no infrastructure terminology or exact usage limits.

Internal policy remains capped for cost and abuse safety. It includes revision and roadmap allowances, assistant and heavy-action budgets, academic-context capacity, job limits, and other enforcement values. These values are deliberately separate from public summaries and are not returned by normal config, bootstrap, account, or billing responses.

Public UI should describe capacity as academic context and should describe plan differences as stronger planning, deeper help, more frequent coursework checks, and broader study support. Exact limits can change without rewriting pricing copy.

## Classroom Policy

All Classroom behavior remains read-only and metadata-first:

- Trial Mode: one automatic metadata check during the trial
- Starter: manual checks only
- Essential: automatic metadata checks every 7 days
- Plus: automatic metadata checks every 5 days
- Pro: automatic metadata checks every 3 days

Automatic checks do not import or process every item. User-selected material remains user-managed.

Writeback, assignment submission, automatic submission, hidden submission, grade modification, turn-in, and delete actions are hard-disabled for every plan, including Pro. A future write feature requires a separate explicit security, OAuth-scope, legal, user-review, environment-gate, and entitlement pass.

## Learning Language

Use Learning Level for adaptive difficulty and roadmap behavior. Do not expose IQ language.

Use Consistency Points for the Pro study-habit feature. Do not use punitive discipline-point language.

Learning Level and adaptive difficulty are enabled by policy for Plus and Pro. Consistency Points are enabled by policy for Pro only. Feature flags may precede full feature implementation and do not imply that unfinished generators are available.

## Consumption Rules

Future backend passes should use:

- `getPlanEntitlements(planKey)` for the complete internal policy
- `getPublicPlanSummary(planKey)` for pricing copy
- `canUseFeature(planKey, featureKey)` for boolean gates
- `getFeatureLimit(planKey, featureKey)` for feature-specific limits
- `getClassroomSyncPolicy(planKey)` for read-only metadata cadence
- `getAssistantPolicy(planKey)` for assistant depth and hidden budgets
- `getAcademicContextPolicy(planKey)` for capacity behavior
- `normalizePlanKey(value)` before persisting or trusting external plan input

Frontend pricing work should consume `/api/config` plan summaries. Authenticated product surfaces should consume the safe `planAccess` summary from bootstrap/account responses. They must not copy internal limits into browser constants.

## Launch Safety

PASS 35.4 does not activate a payment provider, recurring mandate, real checkout, Classroom write scopes, assignment writeback, BGE embeddings, retrieval migrations, reranking, flashcard generation, visual-note generation, or automatic assignment submission.

No new production environment variables are required by this pass.

Apply `supabase/migrations/202606290001_studentos_pass35_4_plan_entitlements.sql` to all three data shards before persisting launch-plan billing records. It retires the old Free, Group, and Institution billing identifiers in favor of the fail-closed unselected state and the current Trial, Starter, Essential, Plus, and Pro catalog. It does not activate payments.
