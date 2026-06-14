# StudentOS

StudentOS is an AI-native student operating system powered by SentIQ. It is designed as a focused academic home screen for students: onboarding, courses, source materials, grounded AI assistance, assignment learning flows, study roadmaps, credits, account lifecycle scaffolds, and production SaaS safety boundaries.

StudentOS is a separate product codebase. SentIQGPT/SentIQ Chat remain read-only upstream ecosystem references and are not part of this repository.

## Architecture

- Frontend: pure HTML/CSS/JS, planned for Cloudflare Pages later.
- Backend: Node.js HTTP server, planned for Azure Container Apps later.
- Database/Auth/Storage: Supabase remains the external source of truth.
- Data model: one Supabase Auth project plus three backend-only data shards.
- AI/RAG: backend-only provider boundary, private source upload, extraction, chunking, retrieval, strict citations, and mock fallback.
- Classroom: read-only Google Classroom connector; no submission or writeback actions.

## Deployment Status

This repository is not deployed yet.

Future deployment direction:

- Backend target: Azure Container Apps.
- Frontend target: Cloudflare Pages.
- Supabase remains external and must be configured per environment.
- Runtime secrets must be added later as Azure Container Apps secrets/environment variables, not committed to GitHub.
- Cloudflare Pages can later connect to this GitHub repository for frontend deployment.

## Local Development

Install dependencies:

```powershell
npm.cmd install
```

Start the local backend/frontend server:

```powershell
npm.cmd run dev
```

Open:

```text
http://localhost:3101
```

## Environment Setup

Copy one of the safe templates and fill values locally:

```powershell
Copy-Item .env.example .env
```

Never commit `.env` or any real secret file. `.env.example` and `.env.template` must contain placeholders only.

## Test Commands

Core smoke flow:

```powershell
npm.cmd run smoke:core
```

Deterministic browser E2E:

```powershell
npm.cmd run test:e2e
```

Optional live Supabase E2E, safely skipped unless explicitly enabled:

```powershell
npm.cmd run test:e2e:supabase
```

To run the live Supabase E2E intentionally:

```powershell
$env:STUDENTOS_E2E_SUPABASE_LIVE="true"
npm.cmd run test:e2e:supabase
Remove-Item Env:STUDENTOS_E2E_SUPABASE_LIVE
```

Optional live Supabase E2E report:

```powershell
npm.cmd run test:e2e:supabase:report
```

Production preflight:

```powershell
npm.cmd run preflight:production
```

## Safety Notes

- Do not commit `.env`, service-role keys, OAuth client secrets, AI provider keys, JWT secrets, encryption secrets, Azure credentials, GitHub tokens, private keys, local uploads, or generated test artifacts.
- Keep Supabase shard service-role keys backend-only.
- Keep Google Classroom read-only unless a later reviewed pass explicitly approves additional scopes.
- Assignment automation is review-first. StudentOS must not silently submit or modify student work.
