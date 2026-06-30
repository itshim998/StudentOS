# PASS 36.0 - Entitlement integration

PASS 35.4 established `backend/domain/planEntitlementService.js` as the plan-policy source of truth. PASS 35.5 made pricing consume its public plan summaries. PASS 36.0 applies those policies to the existing product flows.

## Product enforcement

- Unknown, missing, stale, and invalid plans fail closed. The consumer fallback is `Plan setup pending`; there is no Free fallback.
- Workspace features require both an active entitlement and lifecycle-ready dashboard state.
- Ask StudentOS uses the active plan's response-depth policy internally. Retrieval limits and usage budgets remain server-only.
- Notes, flashcards, visual notes, Learning Level, Consistency Points, and assignment support use central feature flags. This pass gates existing behavior; it does not add large new feature engines.
- Assignment Coach is limited to eligible plans and remains student-reviewed. Assignment writeback and automatic submission are disabled for every plan.

## Academic context

Material upload and selection use the active plan's hidden academic-context capacity. Public responses expose only `available`, `almost_full`, `full`, or `unavailable`, a boolean add state, and consumer copy. They do not expose item ceilings, file-size ceilings, storage sizes, processing details, or other hidden budgets.

At the warning threshold the UI says:

> Your academic context is almost full. Remove older material or upgrade to add more.

At full capacity additional material is blocked and the UI says:

> Your academic context is full. Upgrade or remove older material to add this.

Selected academic material is never silently deleted. Classroom retention may remove only old unselected metadata and its derived artifacts.

## Classroom

Classroom remains read-only and metadata-only:

- Trial Mode: one policy check during Trial Mode.
- Starter: manual student-triggered checks only.
- Essential: weekly coursework-check policy.
- Plus: coursework-check policy every five days.
- Pro: coursework-check policy every three days.

These policies do not create a scheduler, automatic full import, AI processing, submission, grading, deletion, or write action. Students still choose which coursework belongs in their academic context.

## Safety boundaries

- Hidden budgets stay backend-only.
- Real payment remains disabled.
- Classroom write scopes and actions remain disabled.
- Assignment writeback and auto-submit remain disabled.
- Cloudflare remains the frontend host, Azure Container Apps remains backend-only, and Supabase remains the data/auth/file foundation.
- SentIQ Chat and SentIQGPT are unchanged.

## Regression coverage

`npm.cmd run test:pass36` covers fail-closed normalization, Trial Mode, safe Classroom cadence, disabled write actions, plan feature availability, lifecycle readiness, academic-context copy and enforcement, selected-material retention, hidden-budget filtering, and visible consumer-copy restrictions.
