# StudentOS SaaS Foundation

StudentOS is a production SaaS product powered by SentIQGPT. SentIQGPT patterns may be reused, but StudentOS owns its accounts, shards, storage, keys, quotas, policies, and deployment environments.

## Environment Topology

Every environment uses the same project shape:

- Project 1: Supabase Auth only.
- Project 2: Data shard 1.
- Project 3: Data shard 2.
- Project 4: Data shard 3.

Use separate Supabase projects and env values for development, staging, and production. Production must run with `STUDENTOS_MODE=supabase`, exact `CORS_ORIGINS`, private storage, rate limits, and quota enforcement.

## Active Tenant Model

The active v1 user role is `student`.

Role-ready future values:

- `parent_guardian_future`
- `teacher_institution_future`
- `admin_internal`

Future roles must use explicit consent, scoped permissions, and separate audit events before they can view student progress. Until then, all academic rows stay student-owned through `user_id` and deterministic shard routing.

## Plan Model

Payments are not integrated in Pass 14. Plans are configuration scaffolds:

- Free: safe default, limited AI, uploads, courses, sources, and worker jobs.
- Pro: higher personal limits and advanced automation eligibility.
- Group: group spaces and higher collaborative quotas later.
- Institution: institution-scale quotas and future parent/teacher views.

Quota enforcement is off by default for local demos and should be enabled in production with `STUDENTOS_QUOTA_ENFORCEMENT=true`.

## Abuse And Cost Controls

The backend includes:

- Request rate-limit scaffold.
- AI call quota checks.
- Upload file-size and source-count checks.
- Reindex and worker retry quota checks.
- Worker max-attempt and stuck-job recovery from earlier passes.

Essential learning features remain available by product policy. Convenience and automation workflows are the first areas to gate by credits and plan features.

## Frontend Boundary

The browser may receive:

- StudentOS Auth project URL.
- StudentOS Auth anon key.
- Safe product/config/status metadata.

The browser must never receive:

- Data shard URLs.
- Supabase service-role keys.
- AI provider keys.
- Embedding provider keys.
- Storage service credentials.
