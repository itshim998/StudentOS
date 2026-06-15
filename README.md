# StudentOS

StudentOS is an AI-native student operating system powered by SentIQ. It is designed as a focused academic home screen for students: onboarding, courses, source materials, grounded AI assistance, assignment learning flows, study roadmaps, credits, account lifecycle scaffolds, and production SaaS safety boundaries.

StudentOS is a separate product codebase. SentIQ Chat remain read-only upstream ecosystem references and is not part of this repository.

## Architecture

- Frontend: pure HTML/CSS/JS, planned for Cloudflare Pages later.
- Backend: Node.js HTTP server, planned for Azure Container Apps later.
- Database/Auth/Storage: Supabase remains the external source of truth.
- Data model: Supabase
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


