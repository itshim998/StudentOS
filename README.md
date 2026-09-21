# StudentOS

## Your semester, made clearer

StudentOS is an AI-native academic workspace built around the semester a student is actually living through.

It brings courses, syllabus, assignments, examinations, timetable, availability, study materials, assessments, and daily planning into one focused system. The goal is simple: help students spend less time deciding how to manage their academic life and more time doing the work that matters.

**Live application:** https://studentos.sentiqlabs.com/

## What StudentOS does

### Today

Today is the main starting point. It turns the student's current academic context into a focused plan containing the next useful study actions, approaching deadlines, classes, fixed commitments, and unfinished work.

### Courses and Academic Context

Students can organise:

- courses and syllabus topics
- examination dates
- assignments
- study materials and uploaded PDFs
- weekly classes and available study time
- selected Google Classroom courses, coursework, and materials

Academic Context keeps these records connected so that planning and study support can use the real structure of the semester instead of treating every task as an isolated item.

### Study and Evaluate

StudentOS supports a topic-by-topic learning cycle:

1. Open a planned study item.
2. Prepare or review focused learning material.
3. Take a timed assessment.
4. Receive question-level marks, corrections, strengths, and weak-topic evidence.
5. Use the result to guide what deserves attention next.

Weak topics are derived from mapped assessment evidence. They are not manually invented by the planner or the AI provider.

### Studio

Studio helps students prepare for assignments without completing or submitting the work on their behalf. It can inspect the topics behind an assignment, check preparation coverage, and turn missing knowledge into a practical learning path.

### Ask StudentOS

Ask StudentOS is available across the workspace for questions about course topics, study materials, assignments, revision, and planning. It can answer generally or use the academic context the student has selected.

### Google Classroom

Google Classroom support is read-only. StudentOS can import selected course, coursework, and material metadata, but it does not:

- submit or turn in assignments
- edit Classroom content
- change grades
- post comments
- delete anything from the user's Classroom account

Students who do not use Google Classroom can build the same workspace manually.

## Adaptive Recovery Engine

The Adaptive Recovery Engine is the main backend subsystem added during OpenAI Build Week 2026.

A normal planner creates a plan once. Recovery is designed for what happens when that plan stops being realistic because of:

- below-threshold assessment or reassessment evidence
- missed or unfinished work
- changed examination or assignment deadlines
- reduced study availability
- newly imported academic work
- meaningful changes in academic context

The engine uses semantic events, immutable academic-state snapshots, evidence grounding, deterministic priority policy, constrained planning, reviewable diffs, stale-preview protection, idempotency, and transactional application.

The AI provider can recommend a bounded recovery direction, but it cannot invent syllabus topics, fabricate evidence, choose unrestricted final priorities, or place work outside valid study windows. Exact scheduling remains under application-side constraints and the existing availability allocator.

Adaptive Recovery is additive and remains **disabled by default** until its production migration, API, worker, and post-deployment checks are completed. It does not add Classroom writeback, a second planning system, new billing behaviour, or a separate frontend planner.

Detailed architecture and rollout notes are available in [`docs/adaptive-recovery-engine.md`](docs/adaptive-recovery-engine.md).


## Architecture

### Frontend

- HTML, CSS, and JavaScript
- deployed through Cloudflare Pages
- public runtime configuration contains only the public API origin

### Backend

- Node.js HTTP API
- dedicated background-worker process using the same application image
- Azure Container Apps deployment target
- authenticated API boundaries and durable background jobs

### Data, authentication, and storage

- Supabase Auth
- PostgreSQL-backed Supabase persistence
- sharded StudentOS data projects
- private source-material and export storage buckets
- row-level security and service-role-only backend operations where required

### AI and retrieval

- backend-only provider adapters
- Groq, Gemini, and Pollinations routing
- private source upload and extraction
- chunking, retrieval, and grounded academic context
- strict runtime schemas for sensitive structured AI output
- deterministic or mock paths for local development and tests

### Google Classroom

- backend OAuth flow
- encrypted token handling
- selected-course import
- read-only course, coursework, and material synchronisation

## Local development

### Requirements

- Node.js 20.16 or newer
- npm

### Install and run

```bash
git clone https://github.com/itshim998/StudentOS.git
cd StudentOS
npm install
cp .env.example .env
npm start
```

On Windows Command Prompt, copy the environment template with:

```bat
copy .env.example .env
```

Open:

```text
http://localhost:3101
```

The checked-in environment template defaults to local mock mode. A basic local run does not require production Supabase, Google Classroom, Azure, or AI-provider credentials.

### Background worker

For local background-job processing, run this in a second terminal:

```bash
npm run jobs:dev
```

### Important environment flags

```text
STUDENTOS_MODE=mock
STUDENTOS_ADAPTIVE_RECOVERY_ENABLED=false
STUDENTOS_BACKGROUND_WORKERS_ENABLED=false
```

Real credentials must be stored only in local environment files, GitHub Actions secrets, or the target deployment platform. Never commit API keys, service-role keys, OAuth secrets, tokens, or private credentials.

## Validation

Useful repository checks include:

```bash
npm run check:syntax
npm run test:recovery
npm run eval:recovery
npm run test:hotfix
npm test
```

Additional live verification commands exist for Supabase, Google Classroom, Azure, Cloudflare-to-Azure wiring, AI providers, workers, billing, lifecycle, exports, and recovery schema state. These require the relevant environment credentials and should not be treated as ordinary offline tests.

The recovery tests use deterministic provider mocks and do not make external provider calls. The recovery evaluation writes its result to:

```text
test-results/recovery-evaluation-summary.json
```

## Production deployment

StudentOS production uses:

- **Cloudflare Pages** for the static frontend
- **Azure Container Apps** for the backend API and worker
- **Supabase** for authentication, data, and storage

Operational documentation:

- [`docs/CLOUDFLARE_AZURE_WIRING.md`](docs/CLOUDFLARE_AZURE_WIRING.md)
- [`docs/AZURE_CONTAINER_APPS_DEPLOYMENT.md`](docs/AZURE_CONTAINER_APPS_DEPLOYMENT.md)
- [`docs/PROVIDER_ROUTER_V2.md`](docs/PROVIDER_ROUTER_V2.md)
- [`docs/AZURE_FIRST_DEPLOY_CHECKLIST.md`](docs/AZURE_FIRST_DEPLOY_CHECKLIST.md)
- [`docs/adaptive-recovery-engine.md`](docs/adaptive-recovery-engine.md)

The frontend and backend must remain separately configured. Backend secrets must never be exposed through Cloudflare Pages runtime configuration.

## Safety and product boundaries

StudentOS is designed to support learning, preparation, and planning rather than replace the student's responsibility.

Current boundaries include:

- Google Classroom remains read-only.
- The system does not promise marks, rankings, admissions, or academic outcomes.
- AI output used for structured planning is schema-validated and checked against known records.
- Recovery previews do not alter the live plan until explicitly applied.
- Completed work is preserved during recovery planning.
- Provider failures must not modify the current plan.
- Private provider responses, secrets, tokens, and complete source documents are not stored in recovery events.
- Account export and deletion flows include the relevant StudentOS persistence domains.

## Repository structure

```text
backend/                  Node.js API, domain services, providers, workers, and tests
frontend/                 StudentOS web interface and Cloudflare Pages assets
supabase/migrations/      Database schema and hardening migrations
docs/                     Architecture, deployment, safety, and operational documentation
scripts/                  Validation, deployment, migration, worker, and maintenance tools
tests/e2e/                Playwright end-to-end coverage
```

## Current limitations

- Adaptive Recovery remains disabled by default pending controlled production enablement.
- Recovery currently revises today's plan rather than building a separate multi-day schedule.
- Recovery previews are never auto-applied.
- Google Classroom remains read-only.
- Long unfinished tasks are preserved as whole tasks rather than split by the recovery engine.
- The repository uses runtime contracts, syntax checks, focused tests, and Playwright coverage; it does not currently include a separate lint or static type-check configuration.

## Product direction

StudentOS is being built as an academic ecosystem around one idea: students should spend less time carrying the structure of their semester in their head and more time doing the work that matters.
