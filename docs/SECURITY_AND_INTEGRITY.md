# Security And Academic Integrity

## Product Separation

SentIQGPT must remain read-only while StudentOS is built. StudentOS must use new Supabase projects and new secrets. Do not copy `.env` values from SentIQGPT.

## Secrets

- Service-role keys are backend-only.
- Google client secrets are backend-only.
- SentIQGPT brain bridge tokens are backend-only.
- Frontend config may contain only public API base URLs and future anon keys.

## Academic Integrity

Assignment automation is governed by an Assignment Automation Contract.

Default allowed actions:

- Fetch context.
- Understand requirements.
- Draft support when eligible.
- Create a learning plan.
- Prepare a student review checklist.

Blocked in Pass 1:

- Silent submission.
- Google Classroom posting.
- Email sending.
- Impersonating the student.
- Bypassing student review.

Essential learning features are never credit-gated: explanations, notes, tests, practice, topic mastery, revision roadmaps, and tutoring.

## Privacy

- Progress is student-only by default.
- Parent, teacher, institution, or mentor visibility requires a future roles and consent model.
- Learning adaptivity score is internal in Pass 1 and must not be labeled as IQ.
- Source materials require user ownership, RLS, deletion support, and private storage in production.

## Google Workspace Risks

Pass 1 has only a mock read-only connector. Future real OAuth must use minimal scopes, explicit consent, revocation, and backend token storage. Classroom write/post scopes should not be enabled until assignment workflows have strong review controls.
