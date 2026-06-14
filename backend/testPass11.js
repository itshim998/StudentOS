import assert from "node:assert/strict";
import { createSeedState } from "./domain/studentosDomain.js";
import { createBackgroundJob, processBackgroundJob } from "./jobs/jobService.js";
import { StudentOsRepository } from "./repository/studentOsRepository.js";
import { getSupabaseEnvironment } from "./config/supabaseEnv.js";

function mockSession(userId = "student_demo_001") {
  return {
    authenticated: false,
    mode: "local_demo",
    user: { id: userId, email: "demo@studentos.local" },
  };
}

const repository = new StudentOsRepository({
  config: getSupabaseEnvironment({ STUDENTOS_MODE: "mock" }),
  shardClients: [],
});
const session = mockSession();
const state = await repository.loadState(session);
state.backgroundJobs = [];
state.backgroundJobs.push(createBackgroundJob({
  userId: session.user.id,
  sourceId: "src_race",
  jobType: "source_reindex",
}));
await repository.saveBackgroundJobs(session, state);

const firstClaim = await repository.claimNextBackgroundJob({ workerId: "worker-a" });
const secondClaim = await repository.claimNextBackgroundJob({ workerId: "worker-b" });
assert.equal(firstClaim.sourceId, "src_race");
assert.equal(firstClaim.status, "processing");
assert.equal(firstClaim.attempts, 1);
assert.equal(secondClaim, null);

const staleState = await repository.loadState(session);
staleState.backgroundJobs.push({
  ...createBackgroundJob({
    userId: session.user.id,
    sourceId: "src_stale",
    jobType: "source_reindex",
  }),
  status: "processing",
  attempts: 1,
  lockedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
});
await repository.saveBackgroundJobs(session, staleState);
const recovered = await repository.claimNextBackgroundJob({
  workerId: "worker-recovery",
  lockTimeoutSeconds: 60,
});
assert.equal(recovered.sourceId, "src_stale");
assert.equal(recovered.status, "processing");
assert.equal(recovered.attempts, 2);

const ingestionState = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
ingestionState.sourceMaterials = [{
  id: "src_private_download",
  userId: ingestionState.studentProfile.id,
  courseId: "course_alg2",
  title: "Private downloaded notes",
  filename: "private-notes.txt",
  mimeType: "text/plain",
  sourceType: "uploaded_file",
  status: "uploaded",
  storageBucket: "studentos-private-sources",
  storagePath: "student_demo_001/course_alg2/src_private_download/private-notes.txt",
  extractedText: "",
  citationLabel: "Private downloaded notes",
  isPrivate: true,
  publicUrlAllowed: false,
}];
ingestionState.sourceChunks = [];
ingestionState.memoryItems = [];
ingestionState.embeddingsMetadata = [];
ingestionState.backgroundJobs = [];
const ingestionJob = createBackgroundJob({
  userId: ingestionState.studentProfile.id,
  sourceId: "src_private_download",
  jobType: "source_ingestion",
});
ingestionJob.status = "processing";
ingestionJob.attempts = 1;
const ingestionResult = await processBackgroundJob({
  state: ingestionState,
  job: ingestionJob,
  alreadyClaimed: true,
  downloadSourceBytes: async () => ({
    downloaded: true,
    mode: "private_supabase_storage",
    bytes: Buffer.from("Private storage re-extraction covers quadratic vertex form and exam recovery practice."),
  }),
});
assert.equal(ingestionResult.ok, true);
assert.equal(ingestionJob.attempts, 1);
assert.equal(ingestionState.sourceMaterials[0].status, "indexed");
assert.equal(ingestionState.sourceChunks.length, 1);
assert.equal(ingestionState.sourceChunks[0].embeddingStatus, "embedded");
assert.match(ingestionState.memoryItems[0].body, /quadratic vertex form/);
assert.equal(JSON.stringify(ingestionResult).includes("public"), false);

let downloadedPath = "";
const fakeShardClient = {
  isConfigured: () => true,
  downloadObject: async (bucket, path) => {
    downloadedPath = `${bucket}/${path}`;
    return Buffer.from("backend private bytes");
  },
  rpc: async () => [],
  select: async () => [],
  upsert: async () => [],
};
const supabaseRepository = new StudentOsRepository({
  config: getSupabaseEnvironment({
    STUDENTOS_MODE: "supabase",
    STUDENTOS_SUPABASE_URL_1: "https://auth.example.test",
    STUDENTOS_SUPABASE_ANON_KEY_1: "anon_test",
    STUDENTOS_SUPABASE_URL_2: "https://shard1.example.test",
    STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_2: "service_test_2",
    STUDENTOS_SUPABASE_URL_3: "https://shard2.example.test",
    STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_3: "service_test_3",
    STUDENTOS_SUPABASE_URL_4: "https://shard3.example.test",
    STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_4: "service_test_4",
  }),
  shardClients: [{ label: "test-shard", client: fakeShardClient }],
});
const privateDownload = await supabaseRepository.downloadStorageObject({
  authenticated: true,
  user: { id: "student_demo_001", email: "demo@studentos.local" },
}, {
  bucket: "studentos-private-sources",
  path: "student_demo_001/course/source/file.txt",
});
assert.equal(privateDownload.downloaded, true);
assert.equal(privateDownload.mode, "private_supabase_storage");
assert(Buffer.isBuffer(privateDownload.bytes));
assert.equal(downloadedPath, "studentos-private-sources/student_demo_001/course/source/file.txt");
assert.equal(Object.hasOwn(privateDownload, "publicUrl"), false);

console.log("PASS | StudentOS Pass 11 private storage and queue safety tests passed");
