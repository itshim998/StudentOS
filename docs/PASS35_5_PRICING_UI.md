# PASS 35.5 Pricing UI Integration

## Pricing Source

The onboarding pricing selector and Account pricing panel now share one frontend card renderer. It consumes the safe public entitlement summaries returned by `/api/config`:

- canonical plan key
- display name
- monthly price display
- one-line positioning
- five or six consumer-facing benefits
- best-for guidance
- recommended flag

Plan descriptions remain owned by `backend/domain/planEntitlementService.js`. The frontend does not maintain a second Starter, Essential, Plus, or Pro copy matrix. A missing public summary fails closed and does not invent a Free or Starter entitlement.

## Presentation

Essential is the only Recommended plan. Its card receives a distinct but restrained border, surface, and badge in both onboarding and Account pricing.

The cards prioritize plan name, price, positioning, benefits, best-for guidance, and the CTA in that order. Onboarding uses a two-column laptop layout and a one-column mobile layout. The Account panel uses four, two, or one column according to available width.

Public pricing does not show infrastructure limits or implementation details. Capacity is described as academic context, and plan differences are described through study outcomes.

## Selection And Trial Mode

Plan buttons submit the normalized canonical key received in the public summary. Display names are never persisted as plan identifiers. Missing or unknown values are rejected before the lifecycle request, and the backend remains the final validation boundary.

Trial Mode remains separate from the selected paid plan. Choosing Trial Mode keeps the paid plan as the intended post-trial plan and records Trial Mode only as the current access mode. The UI does not claim that a payment, charge, or recurring mandate has completed.

Visible unknown, unselected, cancelled, or retired plan states use `Plan setup pending`. Authenticated product UI does not present Free as a normal plan.

## Naming And Safety

Use Learning Level, never IQ points. Use Consistency Points, never Discipline Points.

Google Classroom remains read-only. Writeback, assignment submission, automatic submission, hidden submission, grading, turn-in, and deletion remain disabled for Trial, Starter, Essential, Plus, and Pro.

PASS 35.5 does not add a payment provider, live checkout, recurring mandate, feature generators, scoring engines, retrieval infrastructure, or new production environment variables.
