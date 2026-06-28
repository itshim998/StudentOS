# Pass 35.2 lifecycle product flow

StudentOS now renders an authenticated student from persisted lifecycle state instead of opening Today by default.

The lifecycle record is stored in `student_profiles.payload.productLifecycle`. This reuses the existing profile persistence contract in mock and Supabase modes, so Pass 35.0 does not require a parallel table or migration. Missing lifecycle data is normalized defensively. Existing profiles with real workspace data retain dashboard access; newly created authenticated profiles start empty at `signed_up`.

The required flow is:

1. enter a name, which is the only required profile field;
2. optionally add institution, level, stream or course, and year or semester;
3. select Starter, Essential, Plus, or Pro;
4. choose optional Trial Mode or the selected plan directly;
5. pass the development-only payment-method check;
6. accept every required legal item and complete the age gate;
7. complete or skip the remaining guided setup pages;
8. choose Google Classroom or manual setup;
9. select initial academic materials;
10. confirm the setup summary;
11. prepare the workspace;
12. view or skip the tutorial;
13. enter Today.

From the academic identity page onward, Previous returns to the immediately preceding setup page and preserves entered values. Plan and trial pages remain revisitable until payment-method verification; after verification, navigation cannot cross back into those choices. The onboarding shell uses its own high-contrast light surfaces so global dashboard theme values do not wash out form labels, placeholders, controls, or messages.

Onboarding answers now update the visible flow immediately and persist through one ordered background queue. Later gates flush pending answers before continuing, and workspace preparation refuses to start if the latest setup changes cannot be saved. The syllabus page accepts natural-language context plus staged academic files after the access and agreement gates. Classroom setup uses the same read-only metadata refresh as the dashboard, then displays assignments and coursework materials newest-first. Setup summary has one prepare action and one edit action, followed by a single unified preparation page.

`STUDENTOS_PAYMENT_PLACEHOLDER_ENABLED` and `STUDENTOS_WORKSPACE_PREPARATION_SIMULATION_ENABLED` are development controls. Both are ignored in production by design. The payment-method check cannot create a charge or recurring mandate, and it never reports payment completion.

`STUDENTOS_PUBLIC_FRONTEND_URL` is the browser return origin after Classroom connection. Production may omit it only when the first exact HTTPS CORS origin is the intended Cloudflare frontend.

Academic AI calls, source uploads, Classroom sync, assignment workflows, tests, tutoring, and related background work require `dashboard_active`. Classroom connection is allowed during the required setup step only after payment-method verification and legal consent. The connector remains read-only.

No real payment gateway is enabled by this pass. Production remains locked at the payment-method step until a later billing pass implements and reviews a real verification flow.
