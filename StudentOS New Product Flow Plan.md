# StudentOS New Product Flow Plan

## 1. Product Identity

StudentOS is a paid, AI-native academic operating layer for students. It is not a free chatbot, not a generic notes app, and not a raw storage product.

StudentOS helps a student turn their real academic context — college/school details, timetable, exam structure, syllabus, Google Classroom materials, assignments, uploaded files, and natural-language academic information — into a calm daily study system.

The core promise is:

“StudentOS knows what I am studying, what is due, what matters next, and how to help me prepare.”

StudentOS should feel like a clean academic command center, not a technical dashboard.

---

## 2. Pricing Direction

StudentOS has no free tier.

Public pricing tiers:

* Starter — ₹99/month
* Essential — ₹159/month
* Plus — ₹259/month
* Pro — ₹549/month

Every tier may offer an optional 7-day Trial Mode.

Trial Mode is not equal to the selected paid plan. Trial Mode has its own restricted access level regardless of whether the user selected Starter, Essential, Plus, or Pro.

The pricing page should clearly ask:

“Would you like to start with Trial Mode first?”

Example copy:

“You selected Plus. Trial Mode gives you limited access for 7 days before your Plus subscription starts. Trial features are not the same as Plus. Continue with Trial Mode, or start Plus directly?”

Options:

* Start with Trial Mode
* Start Plus now

Payment method verification is required before either option proceeds.

If the user starts Trial Mode, the selected paid plan begins automatically after 7 days unless cancelled before trial expiry.

If the user starts directly with the paid plan, the subscription begins immediately.

---

## 3. Pricing Page Philosophy

The pricing page must not display technical limits.

Do not show:

* storage MB/GB
* processed material limits
* AI action counts
* model names
* provider names
* token limits
* backend infrastructure limits
* database/storage details

The pricing page should sell outcomes, not raw materials.

Use consumer-facing language such as:

* Build your academic workspace
* Import Google Classroom coursework
* Prepare from your syllabus
* Turn materials into a study plan
* Generate revision and tests
* Track weak topics
* Know what to do today
* More capacity for heavier semesters
* Priority workspace preparation
* Best for regular students / heavier semesters / serious exam preparation

Use internal hidden quotas for infrastructure safety, but do not expose them publicly.

When the user reaches their internal limit, the app should say:

“Your academic context is full. Upgrade to Plus to add more.”

Or:

“Your academic context is almost full. Remove older material or choose fewer items.”

The UI should say “academic context,” not “storage.”

---

## 4. Legal and Consent Page

StudentOS must include a mandatory legal agreement page before dashboard access.

This page should include separate checkboxes, not one vague checkbox.

Required checkboxes:

* I agree to the Terms of Service.
* I agree to the Privacy Policy.
* I understand the 7-day Trial Mode and automatic subscription billing.
* I understand Trial Mode has limited access and is not the same as my selected paid plan.
* I authorize StudentOS/payment partner to verify my payment method and create a recurring payment mandate.
* I understand I can cancel before the trial ends.
* I understand StudentOS uses my academic files, timetable, Classroom data, and notes to build my workspace.
* I understand StudentOS is a study assistant and does not guarantee marks, rankings, admissions, or exam results.
* I agree to use StudentOS responsibly and not for academic misconduct.
* I understand AI-generated outputs may contain mistakes and should be checked before use.

Age gate:

* I am 18 or older.
* I am under 18 and have parent/guardian consent.

For under-18 users, StudentOS should eventually require parent/guardian approval before payment and data processing.

The legal page should be visually clean and not scary. It should feel like a professional trust checkpoint.

---

## 5. High-Level User Journey

The final intended journey:

1. User opens StudentOS.
2. User sees the public auth/sign-up page.
3. User signs up.
4. User chooses a pricing tier.
5. User chooses Trial Mode or direct paid plan.
6. User verifies payment method.
7. User accepts legal, privacy, billing, and academic integrity agreements.
8. StudentOS begins workspace setup.
9. User answers onboarding questions.
10. User connects Google Classroom or chooses manual upload path.
11. User selects individual Classroom assignments/materials or uploads manual files.
12. StudentOS shows a setup summary.
13. User confirms that StudentOS can prepare the workspace.
14. StudentOS analyzes available data.
15. StudentOS shows a simple summary of what it understood.
16. User confirms or revises the summary.
17. StudentOS generates the first roadmap.
18. User is offered a skippable tutorial.
19. User lands on the Today dashboard.

The dashboard must remain hidden until payment/trial access, legal consent, and initial setup are complete.

---

## 6. Backend Cost Rule

Before payment method verification, StudentOS should perform only minimal backend work.

Allowed before payment method verification:

* Supabase account creation/auth
* lightweight account state
* possibly lightweight onboarding progress metadata if necessary

Not allowed before payment method verification:

* AI model calls
* file upload to Supabase Storage
* source ingestion
* embeddings
* OCR/image understanding
* Google Classroom material import
* large backend processing
* roadmap generation
* background jobs

After payment method verification, backend tasks may begin according to the selected access mode and internal limits.

The earlier local IndexedDB staging concept is removed from the core plan. Since payment method happens before file/material upload, selected files/materials can go directly to Supabase after the access gate.

---

## 7. Onboarding Design

Onboarding can have up to 10 pages, but should feel light, beautiful, minimalistic, and professional.

Target: 6–9 pages.

Every page should have:

* a clear title
* a warm short paragraph
* one primary task
* optional skip button where allowed
* progress indicator
* calm visual style
* no technical language
* no AI/provider/model copy

Only the name field is mandatory.

All other personalization questions can be skipped and completed later.

Example tone:

“You are progressing fast. Now let’s understand your academic timetable and exam timeline so StudentOS can prepare your roadmap properly. Upload your timetable, type it naturally, or skip this for now.”

Input types should support:

* file upload
* image upload
* typed text
* natural-language explanation
* manual form entry
* skip for now

Images should be compressed before upload or AI processing.

---

## 8. Onboarding Pages

Recommended page structure:

### Page 1 — About You

Collect:

* name
* school/college/university name
* academic level: school, college, exam-prep, self-study
* stream/course/degree
* year/semester/class

Only name is mandatory.

### Page 2 — Education System

Ask lightly:

* country/education system
* Indian school/college/exam system if applicable
* school board/university if known
* whether the student has multiple tracks, such as college + GATE prep

India-specific systems should be first-class from launch.

### Page 3 — Daily Schedule

Collect:

* college/school timetable
* home study timetable
* commute time
* sleep/wake pattern
* fixed commitments
* preferred study-break rhythm

Input options:

* upload file
* upload image
* type manually
* describe naturally
* skip for now

### Page 4 — Exam and Assessment Pattern

Ask in detail about exam types.

Support:

* class tests
* internals
* semester exams
* practicals
* viva
* assignments
* lab work
* projects
* monthly tests
* marks distribution
* exam frequency
* natural-language descriptions

Example:

“I have four 20-mark exams every month, then a 60-mark theory semester exam in the fifth month.”

### Page 5 — Syllabus and Academic Context

Collect:

* syllabus files
* course outlines
* exam routines
* assignment rules
* teacher instructions
* extra academic notes
* natural-language academic context

Input options:

* PDF
* DOC/DOCX
* PPT/PPTX
* XLS/XLSX
* images
* text
* natural language
* skip for now

### Page 6 — Classroom or Manual Setup

This page is mandatory, but it has two valid paths:

1. Connect Google Classroom
2. My institution does not use Google Classroom

If the student chooses Google Classroom:

* ask for read-only Classroom access
* fetch course/material/assignment metadata
* show individual materials/assignments
* allow user to select items
* newest items should appear first
* reassure the user that selection can be changed later

If the student chooses manual setup:

* allow manual file upload
* allow natural-language academic setup
* allow timetable/syllabus/material upload
* allow setup without Classroom

### Page 7 — Select Academic Materials

If Classroom is connected:

* show individual assignments/materials directly
* group by course for readability
* sort newest first
* display course, title, date, due date, and type
* allow checkbox selection
* grey out remaining items when internal academic context capacity is full
* use message: “Your academic context is full. Upgrade to {next_tier} to add more.”

The UI should reassure:

“You can add or remove materials later from Academic Context settings.”

If manual setup:

* show selected uploaded files
* allow adding/removing files
* show academic context fullness, not technical storage

### Page 8 — Setup Summary

Before roadmap generation, show a simple summary:

StudentOS understood:

* your level
* your institution
* your stream/course
* your subjects/courses
* your exam pattern
* your timetable if provided
* selected Classroom/manual materials
* missing information

Then ask:

“Does this look right?”

Options:

* Yes, prepare my workspace
* Edit summary
* Add more details
* Continue with what I have

No full roadmap should be generated before this confirmation.

### Page 9 — Preparing Workspace

After confirmation, StudentOS analyzes available data.

Show calm progress:

* reading your academic context
* organizing your courses
* preparing your first study plan
* checking upcoming work
* building your Today view

Avoid technical copy like:

* chunking
* embeddings
* vector search
* provider fallback
* source-grounded
* model name

### Page 10 — Tutorial Offer

The tutorial is optional and skippable immediately.

Copy:

“Your workspace is ready. Would you like a quick tour before entering Today?”

Options:

* Show tutorial
* Skip for now

Tutorial should be fixed, not personalized.

Tutorial should focus only on what to do next, not a full feature dump.

Tutorial can always be opened later from a dedicated Tutorial/Help panel.

No credits are awarded for tutorial completion.

---

## 9. Google Classroom Design

Google Classroom import is a main feature of StudentOS and should be included in every paid tier.

If the institution does not use Classroom, the user can choose the manual file upload path.

Google Classroom setup rules:

* read-only access only
* no submit
* no grade
* no turn-in
* no modification of Classroom work
* no delete from Google Classroom
* no write scopes
* no writeback actions

Classroom import should work like this:

1. User connects Classroom after payment method verification.
2. StudentOS fetches course/material/assignment metadata.
3. StudentOS shows individual assignments/materials.
4. User selects the items they want.
5. Newest items appear first.
6. If internal context capacity is reached, remaining checkboxes are greyed out.
7. User can add/remove materials later.
8. Selected materials are imported into Supabase and processed according to plan limits.

Starter plan:

* manual Classroom sync only

Plus plan:

* automatic Classroom check every 5 days

Future plan suggestion:

* Essential: manual sync, possibly limited reminders
* Plus: auto-check every 5 days
* Pro: auto-check more frequently, if infrastructure allows

The UI must never expose technical quota values. It should only say:

“Your academic context is full.”

Or:

“Upgrade to add more material.”

---

## 10. Academic Context Management

StudentOS should have a future page called:

“Academic Context”

Not:

“Storage”

This page lets students:

* see selected Classroom materials
* see uploaded files
* add material
* remove material
* replace outdated material
* mark material as current year
* archive old semester material
* rebuild plan after changes

The student should be able to manage their academic context anytime after onboarding.

Use friendly capacity states:

* You have room for more material.
* Your academic context is almost full.
* Your academic context is full.
* Remove older material or upgrade to add more.

Do not show MB/GB unless absolutely necessary in internal/admin views.

---

## 11. AI Behavior

StudentOS should not show multiple AI verb buttons.

Remove visible Ask / Plan / Make / Review buttons from the main consumer UI.

Use one floating panel:

“Ask StudentOS”

The AI should infer the user’s intent automatically.

Examples:

* “Explain this topic” → Ask/explanation behavior
* “Make me a test” → Make/test behavior
* “Plan my week” → Plan behavior
* “Check if I am ready” → Review behavior

The user should not have to choose the internal mode.

Ask StudentOS should be available across every page as a floating panel, but it should behave according to workspace readiness.

Before enough context exists:

* it can guide setup
* it can ask for missing information
* it should not pretend to know the student’s material

After setup:

* it should answer from the student’s academic context when available
* if context is missing, it should say so politely
* it may offer general explanation if allowed
* it should never expose internal retrieval/debug/provider/model language

Bad UI copy:

* low material match
* source-grounded
* provider
* model
* web fallback
* chunks
* embeddings
* mock
* demo response

Good UI copy:

* I don’t have enough of your material yet.
* Add your notes or syllabus for a more accurate answer.
* I can explain this generally for now.
* This is based on your selected material.
* I found this in your academic context.

---

## 12. AI Processing Rules

After onboarding, StudentOS can analyze as much available data as permitted by plan/internal limits.

Process:

1. gather available setup data
2. identify missing academic context
3. show simple summary
4. ask user confirmation
5. generate or revise roadmap
6. show Today dashboard

For images:

* compress before upload/processing
* restrict heavy image understanding on Starter
* use image processing only when academically useful

For Starter:

* image-heavy workflows should be limited
* OCR should be restricted
* large material processing should be conservative

---

## 13. Dashboard / Today Screen

The dashboard should remain hidden until onboarding, payment/trial access, legal consent, and workspace preparation are complete.

The main dashboard should be Today.

Today should be minimal and calm.

Main focus:

* immediate TO-DO list for today

Show up to three next actions, but keep the page visually minimal.

Suggested Today layout:

Top:

* greeting
* next exam timeline
* progress indicator

Main block:

* next task
* start focus block button
* why this task matters

Secondary blocks:

* today’s schedule
* upcoming deadline
* exam readiness
* weak topics
* assignment status

Hide advanced sections when there is not enough data or when they are irrelevant.

No clutter. No debug copy. No technical labels.

---

## 14. Tutorial

Tutorial is skippable immediately.

Tutorial is fixed, not interactive and not personalized.

It should explain:

* Today page
* Ask StudentOS
* Academic Context
* Classroom/material management
* roadmap
* tests and revision
* how to update setup later

Tutorial should focus only on what the student should do next.

Tutorial should be accessible anytime from a dedicated Tutorial/Help panel.

No credits for tutorial completion.

---

## 15. School, College, Exam Prep, and Self-Study Support

StudentOS should support:

* school students
* college students
* exam-prep students
* self-study users

Onboarding should ask lightly which type of student the user is.

The question list does not need to fully branch into separate onboarding flows at launch. Instead, all questions can remain broadly useful and skippable, except name.

India-specific academic systems should be first-class from launch:

* class tests
* internals
* semester exams
* practicals
* viva
* assignments
* lab work
* marks distribution
* exam routines
* backlogs
* competitive exam tracks

StudentOS should eventually support multiple academic tracks at once, such as:

* college semester + GATE
* school board + JEE
* university + internship preparation
* coursework + self-study

---

## 16. Workspace Lifecycle

StudentOS should use a clear internal lifecycle.

Suggested states:

* signed_out
* signed_up
* plan_selected
* trial_selected
* paid_plan_selected
* payment_method_verified
* legal_consent_complete
* onboarding_started
* onboarding_progress_saved
* classroom_choice_pending
* classroom_connected
* manual_setup_selected
* materials_selected
* setup_summary_ready
* workspace_preparing
* workspace_ready
* tutorial_offered
* dashboard_active
* payment_failed_locked
* export_window
* deletion_pending

The UI should render based on lifecycle state.

This prevents broken states like:

* dashboard visible too early
* Ask active before setup
* Connect Classroom shown when not available
* demo roadmap shown to real users
* old seeded data appearing as real work

---

## 17. Failed Payment / Trial Expiry Policy

If trial ends and payment succeeds:

* user continues into selected paid plan

If trial ends and payment fails:

* dashboard locks
* user can access billing retry
* user can export data
* user can delete account
* user receives a 7-day export/retry window
* after 7 days, academic workspace data is deleted
* minimal billing/legal/consent records may be retained if required

The UI should clearly say:

“Your trial has ended and payment could not be completed. You can retry payment or export your data. Your workspace will be deleted after 7 days if payment is not completed.”

---

## 18. Public Copy Principles

StudentOS copy should be:

* calm
* warm
* minimal
* professional
* student-friendly
* confident
* non-technical

Avoid:

* developer terms
* backend details
* AI provider names
* model names
* storage specs
* token limits
* database language
* debug labels
* “mock”
* “fallback”
* “source-grounded”

Use:

* workspace
* academic context
* selected material
* study plan
* Today
* roadmap
* revision
* test
* readiness
* focus block
* Classroom coursework
* current academic year

---

## 19. Current Final Product Direction

StudentOS is now:

* paid-only
* trial-optional
* payment-method-gated
* setup-first
* Classroom-aware
* manual-upload-friendly
* legal-consent-gated
* dashboard-after-readiness
* one-assistant UI
* consumer-facing
* infrastructure-protected
* Indian academic system aware
* school + college + exam-prep compatible

The near-term implementation should focus on turning StudentOS from a dashboard-first app into a lifecycle-driven onboarding and academic workspace product.

## 20. Quota, AI Usage, Classroom Sync, and Academic Context Safety

This section defines StudentOS’s internal usage-control strategy. These controls exist to keep StudentOS reliable, affordable, and infrastructure-safe while preserving a clean consumer-facing product experience.

The public UI should not expose technical limits, provider limits, storage numbers, AI model names, database constraints, or backend infrastructure details. StudentOS should communicate capacity in student-friendly language such as “academic context,” “workspace capacity,” “more room for your semester,” and “fair-use limits apply.”

### 20.1 AI Limits: Hidden Hard Limits, Public Fair-Use Language

StudentOS should use hidden hard limits internally for AI usage.

The pricing page and normal product UI must not show exact AI usage counts, model names, token limits, provider names, or technical quota details.

Public-facing language should remain consumer-friendly:

* More planning support
* More revision support
* Higher academic context capacity
* Priority workspace preparation
* Fair-use limits apply
* Upgrade for heavier academic workloads

Internally, StudentOS should enforce plan-based limits for:

* normal AI actions
* heavy AI actions
* large material analysis
* image/OCR-heavy processing
* roadmap regeneration
* assignment analysis
* daily burst usage
* monthly usage
* global infrastructure safety

Normal AI actions include lightweight explanation, planning, revision, and study guidance.

Heavy AI actions include large file analysis, image-based understanding, OCR-heavy work, full roadmap regeneration, large assignment analysis, and repeated deep processing of course materials.

StudentOS should never promise “unlimited AI” in public copy. The product should feel generous, but it must remain protected by internal usage controls.

If a user approaches their internal AI limit, the UI should say something like:

“StudentOS is saving your remaining advanced actions for the most important study work. Upgrade for heavier academic use.”

If the user reaches the limit:

“You have reached your current plan’s fair-use limit for advanced study actions. You can continue with lighter actions or upgrade for more capacity.”

No technical details should be shown.

### 20.2 Large Files: No Confirmation Modal, Automatic Safety Handling

StudentOS should not interrupt users with a “large file confirmation” modal, regardless of file size.

The user experience should remain smooth and confident. If the user uploads a large PDF, image, timetable, syllabus, or academic file, StudentOS should automatically decide the safest handling path based on plan capacity and infrastructure limits.

StudentOS may automatically:

* compress images before processing
* queue large files
* partially process a file
* process only the most relevant sections
* defer heavy processing
* save the file but delay deep analysis
* block additional material if academic context is full

If a file cannot be fully prepared under the user’s current plan, the UI should explain this in academic language:

“This material has been added, but only part of it can be prepared on your current plan.”

Or:

“Your academic context is full. Remove older material or upgrade to add this.”

The UI must not say:

* file too large for Supabase
* database limit reached
* chunk limit exceeded
* embedding quota exceeded
* provider limit reached
* storage exceeded

StudentOS should preserve the product illusion of a calm academic workspace, not expose backend mechanics.

### 20.3 Classroom Auto-Sync Cost Strategy

Google Classroom auto-sync should be treated as a metadata-first feature.

StudentOS should not automatically download, import, process, summarize, chunk, embed, or analyze every new Classroom item during auto-sync.

Auto-sync should first check only lightweight metadata such as:

* course name
* assignment/material title
* type
* due date
* posted date
* updated date
* basic attachment metadata where available

The purpose of auto-sync is to detect new academic work and notify the student, not to silently consume backend resources.

When StudentOS finds new Classroom work, the UI should say:

“StudentOS found new Classroom work. Choose what to add to your academic context.”

Full import and processing should happen only when:

* the user selects the item, or
* the item matches an explicit future plan-safe rule, or
* the user has enabled a future trusted automation feature within their plan limits

This keeps Classroom sync affordable while preserving StudentOS’s autonomous feel.

### 20.4 Classroom Auto-Sync Cadence by Plan

Classroom auto-sync should be plan-based.

The sync cadence refers to metadata checks only, not full import or AI processing.

Recommended launch cadence:

* Trial Mode: one automatic Classroom check on Day 4 of the 7-day trial
* Starter: automatic Classroom check once every 7 days
* Essential: automatic Classroom check once every 5 days
* Plus: automatic Classroom check once every 3 days
* Pro: automatic Classroom check once every 48 hours

Manual sync may still be available depending on plan and system capacity.

Starter should remain conservative. Plus and Pro can feel more autonomous without creating uncontrolled processing cost, because their auto-sync is still metadata-first.

The UI should not show raw sync-frequency mechanics too technically. Use consumer copy such as:

* Keeps an eye on your Classroom work
* Checks for new coursework periodically
* More frequent Classroom awareness on higher plans
* StudentOS found new work for you to review

### 20.5 FIFO Cleanup and Eviction Policy

StudentOS should not silently delete academic material that the student intentionally selected or uploaded.

Selected academic material becomes part of the student’s academic memory and should be treated with care.

Automatic FIFO cleanup is allowed only for safe, non-user-critical data such as:

* temporary cache
* duplicate imports
* failed processing artifacts
* derived chunks that can be regenerated
* stale previews
* old unselected Classroom metadata
* temporary sync records
* old non-selected attachment metadata
* redundant background-job artifacts

Automatic cleanup should not delete:

* selected Classroom materials
* uploaded syllabus files
* uploaded timetables
* uploaded notes
* user-selected assignments
* generated roadmap history that the user still depends on
* correction sheets
* test history
* important academic records

If the user’s academic context is full, StudentOS should not silently delete older selected material to make room for new material.

Instead, StudentOS should:

1. prevent additional selection/import,
2. grey out remaining checkboxes,
3. show a friendly full-context message,
4. offer upgrade,
5. offer Academic Context management,
6. allow the user to remove or archive older material manually.

Suggested copy:

“Your academic context is full. Remove older material or upgrade to add this.”

Or:

“You can manage your academic context anytime by removing older material or upgrading for a heavier semester.”

This protects trust. StudentOS should never make the student feel that their academic memory disappeared without permission.

### 20.6 Academic Context Warning at Around 90%

StudentOS should warn the user when their internal academic context usage reaches approximately 90%.

The warning should be simple and non-technical.

At around 90%:

“Your academic context is almost full. Remove older material or upgrade to add more.”

At full capacity:

“Your academic context is full. Upgrade or remove older material to add this.”

Selection behavior:

* Below warning threshold: allow normal selection/import
* Around warning threshold: show “almost full” message
* At full capacity: grey out remaining unselected items
* After full capacity: allow the user to manage Academic Context or upgrade

The UI should never show exact MB/GB values in the normal consumer experience.

Do not say:

* storage almost full
* database full
* source limit reached
* processing quota exceeded
* shard capacity exceeded

Use:

* academic context
* workspace capacity
* room for your semester
* add more material
* manage older material

### 20.7 Final Policy Summary

StudentOS should feel generous and premium while remaining internally protected.

Public experience:

* no technical quotas
* no storage specs
* no provider/model names
* no backend terminology
* fair-use language only
* academic-context wording
* upgrade and manage options when full

Internal system:

* hidden hard AI limits
* hidden heavy-action limits
* hidden academic-context capacity
* metadata-first Classroom sync
* plan-based sync cadence
* automatic cleanup only for cache/derived/unselected data
* no silent deletion of selected academic material
* 90% warning state
* full-capacity grey-out behavior

This policy keeps StudentOS aligned with its product identity: a calm academic operating layer that reduces student friction while protecting the founder from uncontrolled infrastructure cost.

## 21. Context Architecture, Retrieval, Embeddings, and Model Budgeting

This section defines the final context architecture for StudentOS and SentIQ Chat.

The goal is to create a strong, privacy-safe, low-cost academic context system that works within the current launch architecture:

* Cloudflare Pages frontend
* Azure Container Apps backend
* Supabase Auth
* 3 Supabase data shards
* Supabase Storage for private academic materials
* Groq GPT-OSS 120B as the primary generation model
* Google/Gemini/Pollinations only as fallback or future optional layers

StudentOS should not migrate away from this architecture for MVP. The system must squeeze maximum quality from Supabase and Groq before introducing new paid infrastructure.

The same retrieval/context engine should also be reused inside SentIQ Chat wherever useful. StudentOS will use academic entities such as courses, assignments, exams, topics, timetables, and academic context. SentIQ Chat will use the same technical retrieval engine but with more general entities such as conversations, uploaded files, workspace memories, user preferences, and project context.

---

### 21.1 Final Architecture Decision

StudentOS and SentIQ Chat should use a shared hybrid retrieval architecture.

The launch architecture is:

1. Supabase Storage keeps raw uploaded/imported files.
2. Supabase Postgres keeps structured academic/workspace objects.
3. Extracted text is split into parent-child chunks.
4. Child chunks are embedded for retrieval.
5. Parent chunks are used for final answer context.
6. Postgres full-text search handles exact terms.
7. pgvector dense search handles semantic similarity.
8. Reciprocal Rank Fusion combines keyword and vector results.
9. Course/topic/profile memory capsules reduce repeated raw-context retrieval.
10. A context packer builds compact prompts.
11. Groq GPT-OSS 120B performs final reasoning/generation.
12. A dynamic token allocator protects Groq limits.

No separate vector database should be used for MVP.

No raw technical details should appear in the user interface. The UI should say “academic context,” “selected material,” “workspace memory,” and “study context,” not vectors, embeddings, chunks, providers, models, tokens, or storage.

---

### 21.2 Supabase Retrieval Store

Supabase/Postgres remains the retrieval store for launch.

Use:

* pgvector for semantic embeddings
* `halfvec(384)` for launch embeddings
* HNSW index for vector search
* `tsvector` + GIN index for keyword search
* metadata filters for student/course/material isolation
* RRF for hybrid ranking

The reason for using `halfvec(384)` is cost and capacity protection. A 384-dimensional vector stored as `halfvec` uses much less storage and memory than 768D, 1024D, 1536D, or 3072D embeddings. This is important because StudentOS currently depends on Supabase free/low-cost shards.

Every retrieval row must include tenant and academic filters:

* `student_id`
* `course_id`
* `source_material_id`
* `material_type`
* `term`
* `source_type`
* `created_at`
* `updated_at`
* `recency`
* `visibility_scope`

The retrieval engine should always filter by `student_id` first. If the query is course-specific, it should also filter by `course_id`. This protects privacy and improves retrieval quality.

---

### 21.3 Hybrid Retrieval

StudentOS should never rely only on vector search.

Academic queries often contain exact identifiers:

* course codes
* subject names
* assignment titles
* unit numbers
* formulas
* dates
* teacher-specific terms
* exam names
* acronyms such as HSMC

Vector search is good for semantic similarity, but it can miss exact terms. Full-text search is good for exact terms, but it can miss paraphrases. StudentOS needs both.

Default retrieval flow:

1. classify query intent lightly
2. apply metadata filters
3. run full-text search
4. run vector search
5. merge results using Reciprocal Rank Fusion
6. deduplicate by parent chunk/source
7. prefer newer/current-year material when relevance is similar
8. select evidence for the context packer

The user should never see “hybrid search,” “RRF,” or “vector retrieval.” They should only see answers that feel grounded in their academic context.

---

### 21.4 Parent-Child Chunking

StudentOS should use parent-child chunking from launch.

Parent chunks are larger, logically complete academic sections.

Examples:

* one syllabus section
* one assignment question tree
* one lecture-note section
* one slide group
* one exam-timetable block
* one Classroom post with related attachment summary

Child chunks are smaller retrieval units created from each parent.

Recommended launch targets:

* child chunks: about 300–450 tokens
* overlap: about 40–80 tokens
* parent chunks: about 900–1800 tokens, depending on material type

The vector database searches child chunks. When a child chunk is selected, StudentOS retrieves the parent chunk for final answer context. This gives precise retrieval without starving the model of surrounding explanation.

---

### 21.5 Material-Specific Chunking Rules

Different academic materials should be chunked differently.

Text-heavy PDFs and notes:

* split by headings first
* then paragraphs
* then smaller semantic sections if required
* avoid cutting sentences mid-thought

Syllabi:

* preserve units, grading rules, exam rules, deadlines, and course outcomes
* one logical section per chunk where possible

Slides:

* chunk by slide or 1–3 slide groups
* keep title, bullets, captions, and speaker notes together

Assignments:

* preserve each question with its subquestions, rubric, marks, and instructions
* never split a question away from its instructions

Classroom posts:

* preserve course name, title, timestamp, due date, and attachment names
* treat each post or attachment as a retrievable academic object

Images/OCR scans:

* compress image before processing
* extract OCR where available
* group by page/region
* keep page number and visual reference metadata

Exam timetables:

* store structured fields for subject, date, time, marks, room, and exam type
* also create a natural-language text projection for retrieval

Natural-language onboarding notes:

* keep short semantic chunks
* summarize important durable facts into student profile memory

---

### 21.6 Lightweight Contextual Retrieval

StudentOS should use lightweight contextual retrieval from launch.

Each child chunk should have a `context_prefix`.

The `context_prefix` should be generated without expensive AI where possible.

Example context prefix:

“RCCIIT CSE AIML, Semester 1, HSMC-191, English and Technical Communication, Assignment B1, Self Introduction.”

The embedded text should be:

`context_prefix + chunk_text`

The displayed/cited text should remain the clean original chunk or parent section.

This improves retrieval because isolated sentences become searchable with their academic identity attached.

Full AI-generated contextual retrieval can be added later for higher tiers, but the MVP should start with cheap rule-based prefixes.

---

### 21.7 Memory Hierarchy

StudentOS should not repeatedly send raw documents to Groq.

It should build reusable memory capsules.

Required memory layers:

1. student profile memory
2. course memory
3. topic memory
4. source/document summaries
5. rolling conversation memory
6. assignment memory
7. exam/timetable memory
8. weak-topic memory
9. roadmap memory

Memory capsules are not the source of truth. They are compressed reusable context.

Raw files and source chunks remain the source of truth. Memory capsules help StudentOS answer faster and cheaper.

Example:

Instead of sending ten raw chunks about “communication skills” every time, StudentOS can first retrieve the HSMC course capsule and only fetch raw source chunks if the query needs citations or detail.

---

### 21.8 Embedding Strategy

Launch embedding model:

`BAAI/bge-small-en-v1.5`

Launch embedding dimensions:

`384`

Launch storage format:

`halfvec(384)`

Reason:

* near-zero variable cost
* privacy-safe if self-hosted or run inside StudentOS infrastructure
* small enough for low-cost CPU/background-worker use
* good storage fit for Supabase
* better retrieval quality than the current mock embedding system

Fallback embedding model:

`all-MiniLM-L6-v2`

Use this only if BGE-small is too heavy for the current deployment environment.

Avoid for launch:

* Gemini free-tier embeddings for student files
* Voyage free-tier embeddings for student files unless a privacy-safe contract/opt-out is verified
* Cohere trial embeddings for private academic material
* very high-dimensional embeddings such as 1024D, 1536D, or 3072D by default
* BGE-M3 as the default launch model
* a separate vector database

After revenue starts, evaluate:

* OpenAI text-embedding-3-small
* Jina embeddings
* Gemini paid-tier embeddings
* BGE-base
* BGE-M3 self-hosting
* paid reranking

Hosted embeddings may be used later only when privacy terms are acceptable and revenue supports them.

---

### 21.9 Reranking Strategy

Do not use reranking at launch.

Reranking adds latency and cost. It should be reserved for higher-value workflows after revenue starts.

Possible future reranking triggers:

* Plus and Pro tier only
* assignment analysis
* exam readiness
* source-grounded explanation requiring high citation precision
* multi-source comparison
* “where did my teacher mention this?” queries
* high-confidence roadmap generation

Trial, Starter, and Essential should not rely on reranking for normal answers.

---

### 21.10 Groq GPT-OSS 120B Usage Strategy

Groq GPT-OSS 120B remains the primary generation model for launch.

The model has a large theoretical context/output capacity, but StudentOS must not use that capacity blindly. The practical bottleneck is free-tier TPM/RPM pressure.

StudentOS must use:

* dynamic token allocation
* request classification
* per-plan hidden token ceilings
* per-task hidden budgets
* context shrinking
* prompt caching-aware prompt order
* key-pool health tracking
* graceful degradation on 429/rate pressure

The UI must never expose model names, token limits, provider names, key-pool details, or routing.

---

### 21.11 Hidden Token Budgets by Plan

The following are internal ceilings, not public-facing plan features.

These are maximums, not defaults. StudentOS should usually answer below these limits.

| Plan           | Max prompt/context tokens | Max completion tokens | Safe total request target |
| -------------- | ------------------------: | --------------------: | ------------------------: |
| Trial Mode     |                     2,500 |                 3,000 |                     5,500 |
| Starter ₹99    |                     3,000 |                 4,000 |                     6,500 |
| Essential ₹159 |                     3,500 |                 4,500 |                     7,200 |
| Plus ₹259      |                     4,500 |                 5,000 |                     7,800 |
| Pro ₹549       |                     5,500 |                 5,500 |                     8,000 |

Important rule:

StudentOS should not always use the maximum. The dynamic allocator may shrink the prompt, context, or output whenever Groq rate-limit pressure is high.

If a request cannot safely fit, StudentOS should:

1. retrieve fewer chunks,
2. use summaries instead of raw chunks,
3. shorten the answer,
4. queue briefly,
5. route to fallback if allowed,
6. or show a calm “try again shortly” message.

Never show a raw provider or rate-limit error to the user.

---

### 21.12 Default Task Budgets

Default budgets should be lower than maximum ceilings.

Quick answer:

* Trial: 600–900 total tokens
* Starter: 800–1200 total tokens
* Essential: 1000–1600 total tokens
* Plus: 1200–2000 total tokens
* Pro: 1500–2600 total tokens

Tutoring or explanation:

* Trial: up to 2,000 total tokens
* Starter: up to 3,000 total tokens
* Essential: up to 4,000 total tokens
* Plus: up to 5,500 total tokens
* Pro: up to 6,500 total tokens

Roadmap generation:

* Trial: short roadmap only, up to 2,500 total tokens
* Starter: compact roadmap, up to 4,000 total tokens
* Essential: normal roadmap, up to 5,500 total tokens
* Plus: deeper roadmap, up to 7,000 total tokens
* Pro: deepest roadmap, up to 8,000 total tokens

Assignment analysis:

* Trial: limited preview, up to 2,000 total tokens
* Starter: basic analysis, up to 3,500 total tokens
* Essential: standard analysis, up to 5,000 total tokens
* Plus: deeper analysis, up to 7,000 total tokens
* Pro: deepest analysis, up to 8,000 total tokens

These budgets are internal. Users should only experience better depth, better planning, and higher academic context capacity.

---

### 21.13 Dynamic Token Allocator

StudentOS should estimate token usage before every Groq request.

Inputs:

* plan tier
* task type
* estimated system prompt tokens
* student profile memory tokens
* course/topic memory tokens
* retrieved evidence tokens
* conversation memory tokens
* desired output tokens
* current Groq key health
* previous rate-limit headers
* daily/monthly user budget

Allocation steps:

1. classify the query
2. choose a default budget
3. estimate prompt size
4. check available Groq capacity
5. reserve a safety buffer
6. shrink context if needed
7. shrink output if needed
8. choose the healthiest key route
9. send request
10. record real token usage and rate-limit headers

If remaining safe output falls below a minimum threshold, StudentOS should not send a poor-quality answer. It should either use a shorter summary path, queue the request, or ask the user to retry shortly.

---

### 21.14 Prompt Caching Strategy

StudentOS should structure Groq prompts to maximize caching.

Stable prompt parts should appear first:

1. stable system prompt
2. stable safety and academic-integrity rules
3. stable citation and answer-style rules
4. stable product behavior instructions
5. stable course capsule if unchanged
6. stable student profile capsule if unchanged

Dynamic prompt parts should appear later:

1. current retrieved chunks
2. latest conversation memory
3. current user query
4. requested output format

This improves cost and throughput because identical prompt prefixes can be reused.

---

### 21.15 Context Packer Algorithm

StudentOS should use a context packer between retrieval and generation.

The context packer decides what Groq actually sees.

Context priority order:

1. user query
2. task classification
3. relevant student profile facts
4. relevant course memory
5. relevant topic memory
6. recent conversation memory
7. retrieved source evidence
8. selected parent chunks
9. timetable/exam constraints
10. output instructions

For most queries, StudentOS should prefer memory capsules first and raw chunks second.

Raw chunks should be used when:

* the user asks for source-based explanation
* citations are required
* assignment analysis depends on exact wording
* the answer must quote or verify course material
* memory capsules are stale or insufficient

Summaries should be used when:

* the user asks broad planning questions
* the request is not source-specific
* token pressure is high
* lower-tier budget is tight
* similar context was already used recently

The context packer should log which context was used so answer quality can be audited later.

---

### 21.16 Suggested Supabase Tables and Fields

StudentOS already has many required tables. The following should guide future migrations.

`source_materials`

* id
* student_id
* course_id
* source_type
* title
* storage_path
* mime_type
* sha256
* language
* page_count
* imported_at
* last_processed_at
* visibility_scope
* metadata

`source_chunks`

* id
* source_material_id
* student_id
* course_id
* parent_chunk_id
* chunk_path
* page_from
* page_to
* position_start
* position_end
* chunk_text
* context_prefix
* chunk_text_for_embedding
* fts
* token_count
* chunk_kind
* importance_score
* created_at

`source_chunk_embeddings`

* chunk_id
* embedding_model_family
* embedding_model_version
* embedding_dims
* embedding
* distance_operator
* normalized
* created_at

Launch embedding column:

`embedding halfvec(384)`

`source_summaries`

* id
* source_material_id
* summary_kind
* summary_text
* summary_tokens
* source_version_hash
* freshness_state
* created_at

`course_memory`

* student_id
* course_id
* capsule_text
* capsule_version
* derived_from_source_hashes
* last_refreshed_at
* expiry_hint
* confidence

`topic_memory`

* student_id
* course_id
* topic_slug
* topic_name
* topic_capsule_text
* supporting_chunk_ids
* last_refreshed_at

`student_profile_memory`

* student_id
* preference_type
* memory_text
* confidence
* last_confirmed_at

`retrieval_logs`

* id
* student_id
* conversation_id
* query_text
* query_class
* prefilter_json
* fts_hits
* vector_hits
* rrf_hits
* reranked_hits
* selected_chunk_ids
* answer_used_citations
* latency_ms
* quality_feedback
* created_at

`context_budget_usage`

* id
* student_id
* conversation_id
* plan_tier
* provider_route
* estimated_input_tokens
* retrieval_tokens
* memory_tokens
* cached_input_tokens
* uncached_input_tokens
* output_tokens
* total_tokens
* allocator_mode
* rate_limit_remaining_tokens
* rate_limit_reset_tokens
* created_at

---

### 21.17 SentIQ Chat Reuse

SentIQ Chat should reuse the same retrieval and context engine.

Shared components:

* embedding worker
* chunking utilities
* source material ingestion
* hybrid retrieval RPC
* RRF ranking
* context packer
* memory capsule generator
* Groq dynamic token allocator
* retrieval logs
* context budget tracking
* provider fallback policy

StudentOS-specific components:

* courses
* topics
* exams
* assignments
* timetables
* Classroom imports
* academic context
* roadmap memory
* weak-topic memory
* test history

SentIQ Chat-specific components:

* general uploaded files
* conversations
* user preferences
* workspace context
* long-term chat memory
* product/workspace/project memories

The technical engine should be shared. The product objects should remain separate.

This prevents duplicated engineering work while keeping StudentOS distinct from SentIQ Chat.

---

### 21.18 Implementation Phases

Implement immediately:

* Supabase-only retrieval
* `halfvec(384)`
* HNSW vector index
* Postgres full-text search
* hybrid RRF retrieval
* metadata prefiltering
* parent-child chunking
* rule-based context prefixes
* bge-small-en-v1.5 embedding worker
* memory capsules
* Groq dynamic token allocator
* prompt caching-aware prompt order
* retrieval and token budget logs

Implement after revenue starts:

* paid hosted embedding fallback
* reranking for Plus/Pro
* advanced contextual retrieval
* better PDF/slide layout parsing
* per-course cached prompt prefixes
* richer multilingual retrieval evaluation
* paid Groq developer tier if needed

Keep as future v2/v3:

* BGE-M3 self-hosting
* browser-side WebGPU embeddings
* vector buckets or separate vector archive tier
* graph-style concept memory
* advanced multimodal retrieval
* campus/institution connectors

Avoid for now:

* separate vector database
* Gemini free-tier embeddings for student files
* Voyage free-tier embeddings for student files without verified privacy protection
* sparse-vector retrieval pipeline at MVP
* BGE-M3 as default MVP embedding model
* high default Groq completion caps
* direct full-document prompting
* exposing storage/token/model/provider details to users

---

### 21.19 Final Context Architecture Policy

StudentOS should feel like it “understands the student,” but technically it should operate through a compact layered context system.

The user sees:

* academic context
* selected material
* study memory
* roadmap
* Today
* Ask StudentOS

The system uses:

* source files
* chunks
* embeddings
* full-text search
* hybrid ranking
* memory capsules
* context packing
* token budgeting
* provider routing

This architecture protects StudentOS from high infrastructure cost, protects student privacy, avoids generic chatbot behavior, and creates a reusable foundation for both StudentOS and SentIQ Chat.
