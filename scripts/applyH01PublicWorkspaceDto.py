from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "backend/server.js"
PACKAGE = ROOT / "package.json"
DTO = ROOT / "backend/presentation/publicStudentWorkspaceDto.js"
TEST = ROOT / "backend/testH01PublicWorkspaceDto.js"
DOC = ROOT / "docs/H01_PUBLIC_WORKSPACE_DTO.md"

DTO.parent.mkdir(parents=True, exist_ok=True)

DTO.write_text(r'''export const PUBLIC_STUDENT_WORKSPACE_KEYS = Object.freeze([
  "studentProfile",
  "courses",
  "topics",
  "syllabi",
  "exams",
  "assignments",
  "timetable",
  "notes",
  "sourceMaterials",
  "sourceChunks",
  "testSessions",
  "testResults",
  "roadmap",
  "revisionEvents",
  "tutorLessons",
  "assignmentAutomationContracts",
  "assignmentLearningFlows",
  "memoryItems",
  "embeddingsMetadata",
  "backgroundJobs",
  "jobEvents",
  "auditLog",
  "billingSubscriptions",
  "billingWebhookEvents",
  "dataExportRequests",
  "dataExportJobs",
  "accountDeletionRequests",
  "accountDeletionReviews",
  "classroomItems",
  "creditBalance",
  "assignmentInsights",
  "todayNextActions",
  "academicContext",
  "todayPlan",
  "classroomDueWork",
  "todayDoNow",
  "queueHealth",
  "persistence",
  "productLifecycle",
  "planAccess",
  "saas",
  "storagePlan",
  "internalMetricsHidden",
]);

export const FORBIDDEN_PUBLIC_WORKSPACE_KEYS = Object.freeze([
  "aiConversations",
  "aiMessages",
  "creditLedger",
  "consentVersions",
  "userConsents",
  "legalAcceptances",
  "roleInvitations",
  "recoveryUserStates",
  "academicEvents",
  "academicStateSnapshots",
  "topicRecoveryStates",
  "topicRecoveryStateHistory",
  "recoveryRuns",
  "recoveryPreviews",
  "planVersions",
]);

const ALLOWED_KEYS = new Set(PUBLIC_STUDENT_WORKSPACE_KEYS);
const FORBIDDEN_KEYS = new Set(FORBIDDEN_PUBLIC_WORKSPACE_KEYS);

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function publicDtoError(code, keys = []) {
  const suffix = keys.length ? `: ${keys.join(", ")}` : "";
  const error = new Error(`${code}${suffix}`);
  error.code = code;
  error.status = 500;
  error.keys = keys;
  return error;
}

export function assertPublicStudentWorkspaceDTO(value) {
  if (!isPlainRecord(value)) throw publicDtoError("PUBLIC_WORKSPACE_DTO_INVALID");
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !ALLOWED_KEYS.has(key));
  if (unknown.length) throw publicDtoError("PUBLIC_WORKSPACE_DTO_UNKNOWN_KEYS", unknown);
  const forbidden = keys.filter((key) => FORBIDDEN_KEYS.has(key));
  if (forbidden.length) throw publicDtoError("PUBLIC_WORKSPACE_DTO_FORBIDDEN_KEYS", forbidden);
  return value;
}

export function createPublicStudentWorkspaceDTO(fields = {}) {
  assertPublicStudentWorkspaceDTO(fields);
  const dto = {};
  for (const key of PUBLIC_STUDENT_WORKSPACE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) dto[key] = fields[key];
  }
  return Object.freeze(dto);
}
''', encoding="utf-8")

TEST.write_text(r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FORBIDDEN_PUBLIC_WORKSPACE_KEYS,
  PUBLIC_STUDENT_WORKSPACE_KEYS,
  assertPublicStudentWorkspaceDTO,
  createPublicStudentWorkspaceDTO,
} from "./presentation/publicStudentWorkspaceDto.js";

const safe = createPublicStudentWorkspaceDTO({
  studentProfile: { id: "student_public" },
  courses: [],
  topics: [],
  assignments: [],
  creditBalance: 0,
  internalMetricsHidden: true,
});
assert.deepEqual(Object.keys(safe), [
  "studentProfile",
  "courses",
  "topics",
  "assignments",
  "creditBalance",
  "internalMetricsHidden",
]);
assert(Object.isFrozen(safe));
assert(PUBLIC_STUDENT_WORKSPACE_KEYS.includes("sourceMaterials"));

for (const forbiddenKey of FORBIDDEN_PUBLIC_WORKSPACE_KEYS) {
  assert.throws(
    () => createPublicStudentWorkspaceDTO({ [forbiddenKey]: [] }),
    (error) => error?.code === "PUBLIC_WORKSPACE_DTO_UNKNOWN_KEYS" || error?.code === "PUBLIC_WORKSPACE_DTO_FORBIDDEN_KEYS",
    forbiddenKey,
  );
}

assert.throws(
  () => createPublicStudentWorkspaceDTO({ newlyAddedBackendCollection: [{ secret: true }] }),
  (error) => error?.code === "PUBLIC_WORKSPACE_DTO_UNKNOWN_KEYS" && error.keys.includes("newlyAddedBackendCollection"),
);
assert.throws(() => assertPublicStudentWorkspaceDTO(null), /PUBLIC_WORKSPACE_DTO_INVALID/);

const serverSource = await readFile(new URL("./server.js", import.meta.url), "utf8");
const publicStateStart = serverSource.indexOf("function publicState(state, persistence)");
const publicStateEnd = serverSource.indexOf("async function readRecoveryBody", publicStateStart);
assert(publicStateStart >= 0 && publicStateEnd > publicStateStart);
const publicStateSource = serverSource.slice(publicStateStart, publicStateEnd);
assert.match(publicStateSource, /return createPublicStudentWorkspaceDTO\(\{/);
assert.doesNotMatch(publicStateSource, /\.\.\.state\b/);
for (const forbiddenKey of FORBIDDEN_PUBLIC_WORKSPACE_KEYS) {
  assert.doesNotMatch(publicStateSource, new RegExp(`\\b${forbiddenKey}\\s*:`), forbiddenKey);
}

console.log("PASS | H-01 strict PublicStudentWorkspaceDTO disclosure boundary tests passed");
''', encoding="utf-8")

DOC.write_text(r'''# H-01 PublicStudentWorkspaceDTO

The workspace API is a presentation boundary, not a serialized copy of repository state.

`publicState()` must construct `PublicStudentWorkspaceDTO` from explicitly named fields. The DTO rejects unknown top-level keys, so adding a new repository collection cannot expose it automatically.

Internal collections including AI persistence, consent and legal records, role invitations, credit ledger entries, and recovery-engine state are forbidden. Safe derived summaries may be exposed only after their public shape is intentionally added to the allowlist and covered by tests.

The compatibility placeholders that remain in the DTO are deliberately empty or projected representations. They do not copy their repository collections.
''', encoding="utf-8")

server = SERVER.read_text(encoding="utf-8")
import_anchor = '} from "./domain/studentosDomain.js";\n'
import_line = 'import { createPublicStudentWorkspaceDTO } from "./presentation/publicStudentWorkspaceDto.js";\n'
if import_line not in server:
    if import_anchor not in server:
        raise SystemExit("server import anchor not found")
    server = server.replace(import_anchor, import_anchor + import_line, 1)

start = server.index("function publicState(state, persistence) {")
end = server.index("\nasync function readRecoveryBody", start)
segment = server[start:end]
if "return createPublicStudentWorkspaceDTO({" not in segment:
    old = "  return {\n    ...state,\n"
    new = '''  return createPublicStudentWorkspaceDTO({
    syllabi: (state.syllabi || []).filter(isAcademicContextRecord),
    exams: (state.exams || []).filter(isAcademicContextRecord),
    timetable: (state.timetable || []).filter(isAcademicContextRecord),
    notes: (state.notes || []).filter(isAcademicContextRecord),
'''
    if old not in segment:
        raise SystemExit("publicState spread anchor not found")
    segment = segment.replace(old, new, 1)
    closing = segment.rfind("\n  };")
    if closing < 0:
        raise SystemExit("publicState closing not found")
    segment = segment[:closing] + "\n  });" + segment[closing + len("\n  };"):]
    server = server[:start] + segment + server[end:]

SERVER.write_text(server, encoding="utf-8")

package = PACKAGE.read_text(encoding="utf-8")
if '"test:h01-public-dto"' not in package:
    anchor = '    "test:c01-assessment-integrity": "node backend/testC01AssessmentIntegrity.js"\n'
    replacement = '    "test:c01-assessment-integrity": "node backend/testC01AssessmentIntegrity.js",\n    "test:h01-public-dto": "node backend/testH01PublicWorkspaceDto.js"\n'
    if anchor not in package:
        raise SystemExit("package script anchor not found")
    package = package.replace(anchor, replacement, 1)
if "npm run test:h01-public-dto" not in package:
    package = package.replace(
        "npm run test:c01-assessment-integrity && npm run test:embeddings",
        "npm run test:c01-assessment-integrity && npm run test:h01-public-dto && npm run test:embeddings",
        1,
    )
PACKAGE.write_text(package, encoding="utf-8")

print("Applied H-01 PublicStudentWorkspaceDTO remediation")
