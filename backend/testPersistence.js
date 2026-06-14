import assert from "node:assert/strict";
import { applyTestScore, createAssignmentAutomationContractForState, getCreditBalance } from "./domain/studentosDomain.js";
import { getPublicAuthConfig, getSafeSupabaseStatus, getSupabaseEnvironment } from "./config/supabaseEnv.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import { routeUserToShard } from "./supabase/shardRouter.js";

const fakeEnv = {
  STUDENTOS_MODE: "auto",
  STUDENTOS_SUPABASE_URL_1: "https://auth-project.supabase.co",
  STUDENTOS_SUPABASE_ANON_KEY_1: "public-anon-key",
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_1: "auth-service-secret",
  STUDENTOS_SUPABASE_URL_2: "https://data-2.supabase.co",
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_2: "data-2-service-secret",
  STUDENTOS_SUPABASE_URL_3: "https://data-3.supabase.co",
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_3: "data-3-service-secret",
  STUDENTOS_SUPABASE_URL_4: "https://data-4.supabase.co",
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_4: "data-4-service-secret",
  STUDENTOS_SUPABASE_JWT_SECRET: "jwt-secret",
  STUDENTOS_STORAGE_BUCKET: "studentos-private",
};

const config = getSupabaseEnvironment(fakeEnv);
assert.equal(config.mode, "supabase");

const safeStatus = JSON.stringify(getSafeSupabaseStatus(config));
assert.equal(safeStatus.includes("service-secret"), false);
assert.equal(safeStatus.includes("jwt-secret"), false);
assert.equal(safeStatus.includes("public-anon-key"), false);

const publicAuth = JSON.stringify(getPublicAuthConfig(config));
assert.equal(publicAuth.includes("public-anon-key"), true);
assert.equal(publicAuth.includes("service-secret"), false);

const fakeShards = config.shards.map((shard) => ({
  ...shard,
  client: {
    isConfigured: () => true,
  },
}));
const firstRoute = routeUserToShard("00000000-0000-4000-8000-000000000001", fakeShards);
const secondRoute = routeUserToShard("00000000-0000-4000-8000-000000000001", fakeShards);
assert.equal(firstRoute.label, secondRoute.label);
assert.equal(firstRoute.expansion.algorithm, "sha256_modulo");

const mockConfig = getSupabaseEnvironment({ STUDENTOS_MODE: "mock" });
const repository = new StudentOsRepository({ config: mockConfig, shardClients: [] });
const session = {
  mode: "local_demo",
  authenticated: false,
  user: {
    id: "student_demo_001",
    email: "demo@studentos.local",
  },
};

const state = await repository.loadState(session);
const beforeCredits = getCreditBalance(state);
const score = applyTestScore(state, {
  courseId: "course_alg2",
  topicId: "topic_quadratics",
  type: "mcq",
  answers: ["A", "B", "C", "D"],
  answerKey: ["A", "B", "C", "X"],
});
assert.equal(score.result.scorePercent, 75);
assert.equal(score.result.creditsAwarded, 1);
await repository.saveTestResultBundle(session, state);

const persisted = await repository.loadState(session);
assert.equal(getCreditBalance(persisted), beforeCredits + 1);
assert(persisted.testResults.some((result) => result.id === score.result.id));

const assignment = persisted.assignments.find((item) => item.id === "assign_quad_ws");
const course = persisted.courses.find((item) => item.id === assignment.courseId);
const topics = persisted.topics.filter((topic) => assignment.topicIds.includes(topic.id));
const contract = createAssignmentAutomationContractForState({
  state: persisted,
  assignment,
  course,
  topics,
  creditBalance: getCreditBalance(persisted),
});
persisted.assignmentAutomationContracts.push(contract);
await repository.saveAssignmentContract(session, persisted);
const afterContract = await repository.loadState(session);
assert(afterContract.assignmentAutomationContracts.some((item) => item.id === contract.id));
assert.equal(contract.realSubmissionAllowed, false);
assert.equal(contract.studentReviewRequired, true);
assert(contract.blockedActions.includes("silent_submission"));

console.log("PASS | StudentOS Pass 3 persistence boundary tests passed");
