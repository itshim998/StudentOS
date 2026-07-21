# StudentOS

StudentOS is an AI-native student operating system powered by SentIQ. It is designed as a focused academic home screen for students: onboarding, courses, source materials, grounded AI assistance, assignment learning flows, study roadmaps, credits, account lifecycle scaffolds, and production SaaS safety boundaries.

StudentOS is a separate product codebase. SentIQ Chat remain read-only upstream ecosystem references and is not part of this repository.

## Architecture

- Frontend: pure HTML/CSS/JS, planned for Cloudflare Pages later.
- Backend: Node.js HTTP server plus a dedicated background-worker process, prepared for separate Azure Container Apps using the same image.
- Database/Auth/Storage: Supabase remains the external source of truth.
- Data model: Supabase
- AI/RAG: backend-only provider boundary, private source upload, extraction, chunking, retrieval, strict citations, and mock fallback.
- Classroom: read-only Google Classroom connector; no submission or writeback actions.
- Adaptive recovery: default-off asynchronous backend analysis that proposes reviewable changes to today's existing plan; see [docs/adaptive-recovery-engine.md](docs/adaptive-recovery-engine.md).

## Adaptive Recovery Engine

The recovery engine is additive and disabled by default with `STUDENTOS_ADAPTIVE_RECOVERY_ENABLED=false`. It reuses mapped assessment evidence, the current Today plan, roadmap records, the existing availability allocator, the AI planning allowance, authentication, and the background worker. It does not add a frontend planning system, Classroom writeback, new AI providers, pricing, or billing behavior.

Migration 001 (`202607190001_studentos_adaptive_recovery_engine.sql`) has already been applied and verified on data Projects 2, 3, and 4. Production-readiness migration 002 (`202607190002_studentos_adaptive_recovery_hardening.sql`) is additive, data-shard-only, and pending deployment. Before enabling recovery, apply migration 002 to all three data shards, run the hardened `npm run verify:recovery-schema`, deploy both the API and dedicated no-ingress worker with recovery false, inspect the live worker topology, and run `npm run test:recovery` plus `npm run eval:recovery`. Rollback begins by disabling the flag and recovery job processing; immutable plan and audit records remain.

The original recovery baseline is `aac00ac5f2b811eab2666bc5595bc70e80bdc7d0`; the implementation commit remediated here is `e46da0ecbbb88eec418f49a62aca9b340bd1e17f`. The remediation remains uncommitted, the Azure workflow was not run at remediation start, and recovery remains disabled pending migration-002, API, worker, and post-deployment validation.

## Deployment Status

This repository is not deployed yet.

Future deployment direction:

- Backend target: Azure Container Apps with an API at 0–1 replicas and a dedicated no-ingress worker at one fixed replica.
- Frontend target: Cloudflare Pages.
- Supabase remains external and must be configured per environment.
- Runtime secrets must be added later as Azure Container Apps secrets/environment variables, not committed to GitHub.
- Cloudflare Pages can later connect to this GitHub repository for frontend deployment.
