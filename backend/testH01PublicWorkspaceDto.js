import assert from "node:assert/strict";
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
