import assert from "node:assert/strict";
import { getTodayNextActions, answerFromStudentMaterials } from "./domain/studentosDomain.js";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import {
  applyStudentOnboarding,
  generateAcademicRoadmap,
  normalizeOnboardingPayload,
} from "./domain/onboardingService.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import { getSupabaseEnvironment } from "./config/supabaseEnv.js";

const now = new Date("2026-05-27T10:00:00+05:30");
const payload = {
  displayName: "Mira",
  stream: "Science",
  classLevel: "Grade 10",
  schoolSystem: "CBSE-style",
  academicGoal: "concept_mastery",
  dailyStudyAvailabilityMinutes: 120,
  studyBreakPattern: "50/10",
  completedTopicsText: "Mathematics: Quadratic equations",
  subjectsText: [
    "Mathematics|2026-06-02|Quadratic equations, Trigonometry basics",
    "Biology|2026-06-15|Cell cycle and mitosis",
  ].join("\n"),
  weakTopicsText: "Mathematics: Trigonometry basics",
  timetableText: "Mon|18:30|Math revision|Mathematics",
};

const normalized = normalizeOnboardingPayload(payload, now);
assert.equal(normalized.breakPattern.focusMinutes, 50);
assert.equal(normalized.breakPattern.breakMinutes, 10);
assert.equal(normalized.courses.length, 2);
assert.equal(normalized.weakTopics.length, 1);

const state = createSeedState(now);
const onboarding = applyStudentOnboarding(state, payload, { now });
assert.equal(state.studentProfile.displayName, "Mira");
assert.equal(state.studentProfile.preferences.academicGoal, "concept_mastery");
assert.equal(state.studentProfile.preferences.studyBreakPattern, "50/10");
assert.equal(state.courses.length, 2);
assert.equal(state.exams.length, 2);
assert.equal(state.timetable.length, 1);
assert(state.auditLog.some((event) => event.action === "student_onboarding.completed"));
assert(onboarding.weakTopics.some((topic) => topic.title === "Trigonometry basics"));
assert(state.revisionEvents.some((event) => event.reason.includes("Revision within 24 hours")));
assert(state.roadmap.some((item) => item.kind === "revision_24h"));

const roadmap = generateAcademicRoadmap(state, { now });
assert.equal(roadmap[0].priority, "high");
assert(roadmap.some((item) => item.kind === "weak_topic_recovery"));
const todayActions = getTodayNextActions(state);
assert(todayActions.length > 0);
assert(["urgent", "high"].includes(todayActions[0].priority));

const planAnswer = answerFromStudentMaterials({
  verb: "Plan",
  message: "Plan my math exam prep",
  state,
});
assert.equal(planAnswer.academicProfile.goal, "concept_mastery");
assert.equal(planAnswer.studyPlan.studyBreakPattern, "50/10");
assert(planAnswer.studyPlan.timetableBlocks.length > 0);
assert.match(planAnswer.answer, /Goal: concept mastery/);

const repository = new StudentOsRepository({
  config: getSupabaseEnvironment({ STUDENTOS_MODE: "mock" }),
  shardClients: [],
});
const session = {
  authenticated: false,
  mode: "local_demo",
  user: { id: "student_demo_001", email: "demo@studentos.local" },
};
const repoState = await repository.loadState(session);
applyStudentOnboarding(repoState, payload, { now });
await repository.saveState(session, repoState);
const loaded = await repository.loadState(session);
assert.equal(loaded.studentProfile.preferences.academicGoal, "concept_mastery");
assert(loaded.roadmap.length >= 3);

const supabaseFallbackRepository = new StudentOsRepository({
  config: getSupabaseEnvironment({
    STUDENTOS_MODE: "supabase",
    STUDENTOS_SUPABASE_URL_1: "https://auth.example.test",
    STUDENTOS_SUPABASE_ANON_KEY_1: "anon",
    STUDENTOS_SUPABASE_URL_2: "https://shard1.example.test",
    STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_2: "service_2",
    STUDENTOS_SUPABASE_URL_3: "https://shard2.example.test",
    STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_3: "service_3",
    STUDENTOS_SUPABASE_URL_4: "https://shard3.example.test",
    STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_4: "service_4",
  }),
  shardClients: [],
});
assert.equal(supabaseFallbackRepository.useSupabase({ authenticated: false, user: session.user }), false);

console.log("PASS | StudentOS Pass 13 onboarding and roadmap tests passed");
