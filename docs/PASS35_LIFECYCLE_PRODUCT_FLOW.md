# Pass 35.0 lifecycle product flow

StudentOS now renders an authenticated student from persisted lifecycle state instead of opening Today by default.

The lifecycle record is stored in `student_profiles.payload.productLifecycle`. This reuses the existing profile persistence contract in mock and Supabase modes, so Pass 35.0 does not require a parallel table or migration. Missing lifecycle data is normalized defensively. Existing profiles with real workspace data retain dashboard access; newly created authenticated profiles start empty at `signed_up`.

The required flow is:

1. select Starter, Essential, Plus, or Pro;
2. choose optional Trial Mode or the selected plan directly;
3. pass the development-only payment-method check;
4. accept every required legal item and complete the age gate;
5. complete or skip the guided onboarding pages (name is required);
6. choose Google Classroom or manual setup;
7. select initial academic materials;
8. confirm the setup summary;
9. prepare the workspace;
10. view or skip the tutorial;
11. enter Today.

`STUDENTOS_PAYMENT_PLACEHOLDER_ENABLED` and `STUDENTOS_WORKSPACE_PREPARATION_SIMULATION_ENABLED` are development controls. Both are ignored in production by design. The payment-method check cannot create a charge or recurring mandate, and it never reports payment completion.

`STUDENTOS_PUBLIC_FRONTEND_URL` is the browser return origin after Classroom connection. Production may omit it only when the first exact HTTPS CORS origin is the intended Cloudflare frontend.

Academic AI calls, source uploads, Classroom sync, assignment workflows, tests, tutoring, and related background work require `dashboard_active`. Classroom connection is allowed during the required setup step only after payment-method verification and legal consent. The connector remains read-only.

No real payment gateway is enabled by this pass. Production remains locked at the payment-method step until a later billing pass implements and reviews a real verification flow.
