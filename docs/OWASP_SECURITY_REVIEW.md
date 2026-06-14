# StudentOS OWASP-Style Security Review

## Broken Access Control

Risk: cross-user academic data leakage across shards.

Current controls:
- Auth user id drives shard routing.
- Shard repository filters and persists `user_id`.
- RLS-ready schema exists for user-owned rows.
- Browser is not given shard credentials.

Remaining work:
- Add automated live RLS isolation checks to deployment pipeline.

## Cryptographic Failures

Risk: service keys or source files exposed.

Current controls:
- `.env` ignored.
- Secret redaction in preflight and logs.
- Private storage bucket by default.
- Backend-only Storage download/delete.

Remaining work:
- Add managed secret store guidance for each deployment platform.

## Injection

Risk: ad hoc SQL or unsafe user input.

Current controls:
- Supabase REST/RPC wrappers avoid client-side SQL construction for normal API use.
- Search/retrieval is not direct SQL from user text.

Remaining work:
- Review all future RPC functions before launch.

## Insecure Design

Risk: academic automation causing integrity issues.

Current controls:
- Review-first assignment contract.
- No real submission, no Classroom posting, no email sending.
- Essential learning features remain ungated.

Remaining work:
- Add institution policy configuration before school deployment.

## Security Misconfiguration

Risk: production runs in mock/demo or wildcard mode.

Current controls:
- Production preflight checks Supabase mode, JWT, shards, CORS, rate limits, quotas, and demo seed.
- `/api/status` exposes safe readiness only.

Remaining work:
- Add CI gate that fails production build on preflight errors.

## Vulnerable Components

Risk: dependency vulnerability in extraction stack.

Current controls:
- Minimal dependency surface.
- PDF parsing backend-only.

Remaining work:
- Add dependency audit in CI.

## Identification And Authentication Failures

Risk: bad session handling.

Current controls:
- Browser uses Auth project only.
- Backend verifies access token through Supabase Auth.
- Demo/local mode is separated from production preflight.
- Internal operator access uses a named roster, least-privilege roles, and short-lived signed sessions.
- Sensitive operator actions can require MFA and session-version rotation invalidates old sessions.

Remaining work:
- Add password policy and MFA guidance for production Auth project.

## Software And Data Integrity Failures

Risk: trusted AI output invents citations.

Current controls:
- Backend validates citations against retrieved chunk ids.
- Model-generated citations are not trusted.

Remaining work:
- Add eval set for citation refusal behavior.

## Logging And Monitoring Failures

Risk: no operational trail or secret leakage.

Current controls:
- Request IDs.
- Structured redacted logs.
- Job events table.
- Queue health endpoint.
- Operator audit and billing cancellation evidence are service-role-only and append-only.
- Internal monitoring reports readiness and modes without keys, bucket names, paths, or source content.
- Monitoring alert events record high-risk operator, deletion, billing, and export anomalies without external provider delivery.

Remaining work:
- Add centralized log sink and alerting.

## Server-Side Request Forgery

Risk: future URL ingestion fetching internal resources.

Current controls:
- Current uploads are file-based; no arbitrary URL fetch ingestion.

Remaining work:
- If URL ingestion is added, use allowlists and SSRF protections.
