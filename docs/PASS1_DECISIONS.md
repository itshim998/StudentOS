# StudentOS Pass 1 Decisions

## Product Direction

StudentOS is a production-grade SaaS foundation that can be demonstrated safely without weakening production boundaries. SentIQGPT is not upgraded in this pass; it remains the read-only AI brain/source system whose patterns inform StudentOS.

## Locked Decisions

- Target user: high school students first.
- UI tone: calm study planner plus futuristic OS, focused and premium.
- Device priority: desktop-first responsive web.
- Frontend: pure HTML/CSS/JS unless a future pass creates a clear reason to add a framework.
- Backend: StudentOS-owned API and schema. Pass 1 runs in mock mode without credentials.
- Storage: mock/local metadata now, StudentOS Supabase Storage later.
- Sharding: preserve SentIQGPT-style control DB plus data shards.
- Auth: StudentOS account via email or Gmail; Google Workspace connection is separate and later.
- Google Classroom: Pass 1 uses connector interface plus mock read-only assignment import. No real OAuth.
- Source grounding: prefer student materials, allow web fallback only when clearly labeled.
- Tests: MCQ scoring first. Data model supports short answers for later evaluation.
- Learning adaptivity score: internal only in Pass 1. Never label it as IQ in UI.
- Progress visibility: student-only by default. External sharing requires future consent and roles.
- Extension requests: draft/explanation only. No auto-send, no Classroom posting.

## Credit Rules

Credits unlock convenience workflows only. They do not gate essential learning.

- Score >= 90: 3 credits.
- Score >= 80: 2 credits.
- Score >= 70: 1 credit.
- Score < 70: 0 credits and topic enters immediate revision/mastery roadmap.

## Mandatory V1 Objects

StudentProfile, Course, Subject/Topic, Syllabus, Exam, Assignment, Timetable/ClassSchedule, Note, SourceMaterial/File, TestSession, TestResult, CreditLedgerEntry, RoadmapItem, RevisionEvent, TutorLesson, AssignmentAutomationContract, AuditLog.
