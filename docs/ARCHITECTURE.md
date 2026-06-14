# StudentOS Architecture

## Pass 1 Shape

StudentOS is a separate product with its own frontend, backend, schema, environment, and future Supabase projects. It reuses SentIQGPT ideas conceptually: orchestration, source-grounded context, memory, file handling, auth boundaries, and sharded persistence.

## Runtime Layers

- Frontend: pure HTML/CSS/JS in `frontend/`, desktop-first responsive.
- Backend: Node mock API in `backend/server.js`, designed as a contract layer for later Express/TypeScript or copied SentIQGPT services.
- Domain: academic policy and objects in `backend/domain/studentosDomain.js`.
- Connectors: Google Classroom interface begins with `backend/connectors/googleClassroomMock.js`.
- AI bridge: `backend/ai/studentBrainAdapter.js` keeps SentIQGPT-style brain access server-only.
- Persistence: Supabase migrations in `supabase/migrations/` preserve control DB plus data shard split.

## Data Flow

1. Browser loads `/api/bootstrap` for the student academic home state.
2. Today/Courses/Memory/Studio render from StudentOS-owned academic objects.
3. AI panel sends Ask, Plan, Make, Review to `/api/ai/verb`.
4. Test scoring writes a TestResult, optional CreditLedgerEntry, and a RoadmapItem.
5. Assignment automation creates a contract before any drafting workflow.
6. Extension support creates a draft only; no outgoing message is sent.

## Sharding Direction

- Database 1: control map from user to assigned shard.
- Databases 2-4: academic objects, source metadata, tests, credits, roadmap, audit logs.
- Service-role keys stay backend-only.
- Frontend should use Supabase Auth tokens only, never service-role keys.

## Current Mock Boundaries

- No real OAuth.
- No real Classroom posting.
- No real file bytes stored.
- No external AI provider call unless a later pass configures a StudentOS-owned server bridge.
