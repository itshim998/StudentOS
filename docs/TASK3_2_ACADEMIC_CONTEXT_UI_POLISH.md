# Task 3.2: Academic Context UI polish

## What changed

Academic Context now presents included academic work as a calm student control center rather than a technical file list. The pass refined page hierarchy, card readability, upload feedback, Classroom review states, deletion confirmation, responsive layout, and accessibility while preserving the Task 3.1 data and API contracts.

No backend model or migration changed in Task 3.2.

## Final page structure

The page is organized as:

1. A compact Academic Context hero with the semester-focused subtitle and an **Add PDF** action.
2. Four summary cards for assignments included, materials included, Classroom, and context room.
3. A main column containing Assignments, Materials, and Classroom work to review when eligible items exist.
4. A support column containing the Add PDF panel, student-facing guidance, Classroom plan guidance, and context-room status.

At narrower widths, the support column moves below the included-work sections. Mobile layouts keep cards and actions readable, reserve space around the floating Ask StudentOS control, and avoid horizontal overflow.

## Assignment cards

Assignment cards use a consistent document-shaped PDF or document placeholder. Each card shows the assignment title, course, easy-to-scan due date, origin, and hand-in or deadline status. Overdue and due-soon states receive a restrained visual accent. Available actions remain Open, Ask StudentOS, and Delete.

Task 2 and Task 3.1 ordering is unchanged.

## Material cards

Material cards use the same preview footprint and show title, course, origin, selected-material context, and one of these readiness states when available:

- Ready for study
- Preparing
- Needs attention

Materials never show deadline fields or due-date metadata. Available actions remain Open, Ask StudentOS, and Delete.

## Add PDF panel

The panel contains Type, Title, Course, PDF file, and the upload action. Selecting Assignment reveals the deadline field and its guidance. Selecting Material removes the deadline field and changes the action label.

Validation is shown beside the relevant field. The form continues to enforce PDF-only files, requires a course for both types, requires a deadline only for assignments, and disables upload with clear Setup guidance when no course exists. Successful uploads use the calm confirmation **Added to Academic Context.** Known failures are translated into student-facing guidance.

## Classroom behavior

Starter remains course-list-only. Its Academic Context guidance says that Classroom helps set up courses and that assignments or materials are added through manual PDF upload. It does not show the assignment/material review queue.

Essential, Plus, and Pro continue to show review-only discovered Classroom work when present. Review cards are visually different from included cards and show title, course, assignment deadline when available, and hand-in status when available. **Add to Academic Context** remains the explicit inclusion action; **Ignore** leaves the item out. Discovered review items do not count as included Academic Context.

Eligible plans with no discovered items show **No new Classroom work to review.** in the guidance panel without rendering an empty review queue.

## Permanent deletion

The confirmation dialog explains that deletion is permanent inside StudentOS, stops use for planning, answers, and revision, and does not delete anything from Google Classroom. **Keep it** receives safe initial focus; Escape and cancellation continue to close the dialog. The completed state says **Removed from Academic Context.**

## Responsive and accessibility refinements

- Labels are explicitly associated with upload inputs.
- Field guidance and validation are connected with `aria-describedby` and `aria-invalid`.
- Document placeholders have accessible descriptions.
- Repeated card actions receive item-specific accessible names.
- Long titles wrap without forcing horizontal overflow.
- The main/support layout stacks at tablet and mobile widths.
- Upload controls and card actions remain reachable by keyboard.
- Mobile spacing reduces overlap risk with the floating Ask StudentOS button.

## Preserved behavior

- PDF-only manual upload.
- Course required for assignments and materials.
- Deadline required only for assignments.
- Existing course dropdown population.
- Selected/imported-only Academic Context truth.
- Starter course-only Classroom behavior.
- Essential/Plus/Pro review-only Classroom discovery.
- Classroom read-only operation.
- Assignment writeback and auto-submit disabled.
- Permanent local deletion behavior.
- Today and Due Work deadline behavior.
- No normal-runtime demo data, no Free plan, and no real payments.

## Future work

Real first-page thumbnails remain future work. A future implementation should use a safe private-file delivery path and avoid exposing private URLs. A richer private PDF viewer, page navigation, and broader filtering/browsing can be considered separately. Task 3.2 intentionally adds no heavy PDF rendering dependency or backend thumbnail pipeline.
