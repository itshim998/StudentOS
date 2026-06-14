# StudentOS Google Classroom Connector Privacy

## Current Scope

Google Classroom integration is read-only. StudentOS imports course and
coursework metadata so assignments can enter the existing Study Queue,
coverage-decision flow, and roadmap logic.

StudentOS does not:

- submit or turn in work
- modify Classroom coursework
- grade work
- post comments
- email teachers
- fetch Drive file contents

## OAuth Scopes

StudentOS requests only the Google Cloud configured read-only scopes:

```text
openid
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/classroom.courses.readonly
https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly
https://www.googleapis.com/auth/classroom.course-work.readonly
https://www.googleapis.com/auth/classroom.student-submissions.me.readonly
```

`classroom.course-work.readonly` is retained to match the current Google Cloud
OAuth setup. StudentOS intentionally does not request broader coursework,
roster, courses-write, or Drive scopes. Attachment handling imports metadata and
links only when Classroom exposes them.

Current Google Classroom method documentation may list
`classroom.coursework.me.readonly` or `classroom.coursework.students.readonly`
for some coursework endpoints. StudentOS does not request those scopes in this
pass because the configured OAuth screen uses `classroom.course-work.readonly`
and broader coursework scopes require explicit approval before being added.

## Token Handling

OAuth client secrets stay backend-only. Browser code receives only connector
status, sync summaries, and OAuth authorization URLs.

Pass 24 stores access and refresh tokens server-side only. When
`STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET` is configured, tokens are
encrypted before being stored in the user's data shard. If that secret is not
configured, OAuth token storage falls back to backend process memory for local
development only.

Data export packages, frontend config, sync history, and logs must not contain
OAuth access tokens, refresh tokens, Google client secrets, or token encryption
secrets.

## Data Imported

- Classroom courses
- coursework/assignments/questions where available
- due dates, timestamps, max points, work type
- attachment metadata/links only
- the signed-in student submission state where permitted

Imported rows preserve Google provider ids for idempotent sync. Repeated syncs
update existing StudentOS courses, assignments, and source-material metadata
instead of duplicating them.
