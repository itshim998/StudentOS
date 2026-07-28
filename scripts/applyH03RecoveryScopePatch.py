from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


scope_path = ROOT / "backend/repository/stateScopes.js"
scope = scope_path.read_text(encoding="utf-8")
pattern = r'''const RECOVERY_COLLECTIONS = Object\.freeze\(\[(.*?)\n\]\);'''
match = re.search(pattern, scope, flags=re.S)
if not match:
    raise RuntimeError("recovery scope block not found")
block = match.group(0)
for anchor, addition, label in [
    ('  "topics",\n', '  "topics",\n  "exams",\n', "recovery exams"),
    ('  "testResults",\n', '  "testResults",\n  "creditLedger",\n', "recovery credit ledger"),
    ('  "backgroundJobs",\n', '  "backgroundJobs",\n  "billingSubscriptions",\n', "recovery billing state"),
]:
    if block.count(anchor) != 1:
        raise RuntimeError(f"{label}: expected one scope anchor, found {block.count(anchor)}")
    block = block.replace(anchor, addition, 1)
scope = scope[:match.start()] + block + scope[match.end():]
scope_path.write_text(scope, encoding="utf-8")

migration_path = ROOT / "supabase/migrations/202607280001_h02_narrow_state_repositories.sql"
migration = migration_path.read_text(encoding="utf-8")
old_recovery = "when 'recovery' then scope_keys := array['courses','topics','assignments','timetable','notes','sourceMaterials','testSessions','testResults','roadmap','revisionEvents','tutorLessons','backgroundJobs','auditLog','recoveryUserStates','academicEvents','academicStateSnapshots','topicRecoveryStates','topicRecoveryStateHistory','recoveryRuns','recoveryPreviews','planVersions'];"
new_recovery = "when 'recovery' then scope_keys := array['courses','topics','exams','assignments','timetable','notes','sourceMaterials','testSessions','testResults','creditLedger','roadmap','revisionEvents','tutorLessons','backgroundJobs','billingSubscriptions','auditLog','recoveryUserStates','academicEvents','academicStateSnapshots','topicRecoveryStates','topicRecoveryStateHistory','recoveryRuns','recoveryPreviews','planVersions'];"
migration = replace_once(migration, old_recovery, new_recovery, "recovery SQL scope")
migration_path.write_text(migration, encoding="utf-8")

test_path = ROOT / "backend/testH03BackgroundEmbeddings.js"
test = test_path.read_text(encoding="utf-8")
test = replace_once(
    test,
    'import { processBackgroundJob, queueEmbeddingReindexJob, queueSourceIngestionJob } from "./jobs/jobService.js";\n',
    'import { processBackgroundJob, queueEmbeddingReindexJob, queueSourceIngestionJob } from "./jobs/jobService.js";\nimport { STATE_SCOPE_COLLECTIONS } from "./repository/stateScopes.js";\n',
    "H-03 scope test import",
)
test = replace_once(
    test,
    '''assert.equal(JSON.stringify(state), before, "status reads must not mutate state");
''',
    '''assert.equal(JSON.stringify(state), before, "status reads must not mutate state");
assert(STATE_SCOPE_COLLECTIONS.recovery.includes("exams"));
assert(STATE_SCOPE_COLLECTIONS.recovery.includes("creditLedger"));
assert(STATE_SCOPE_COLLECTIONS.recovery.includes("billingSubscriptions"));
''',
    "H-03 recovery scope assertions",
)
test = replace_once(
    test,
    '''assert.match(dto, /"embeddingProcessing"/);
''',
    r'''assert.match(dto, /"embeddingProcessing"/);
const h02Migration = await readFile(new URL("../supabase/migrations/202607280001_h02_narrow_state_repositories.sql", import.meta.url), "utf8");
assert.match(h02Migration, /when 'recovery' then scope_keys := array\[[^\n]*'exams'[^\n]*'creditLedger'[^\n]*'billingSubscriptions'/);
''',
    "H-03 recovery SQL scope assertion",
)
test_path.write_text(test, encoding="utf-8")

print("Applied H-03 controlled recovery worker scope patch")
