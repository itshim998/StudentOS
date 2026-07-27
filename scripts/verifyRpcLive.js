import { randomUUID } from "node:crypto";
import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";
import {
  contentHash,
  createDeterministicEmbedding,
  deterministicEmbeddingIdentity,
} from "../backend/embeddings/embeddingService.js";

function safeError(error) {
  return String(error?.message || error || "rpc_verification_failed")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/apikey[A-Za-z0-9._:= -]*/gi, "apikey=[redacted]")
    .replace(/api[_-]?key[:=]\s*[A-Za-z0-9._-]+/gi, "api_key=[redacted]")
    .slice(0, 220);
}

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyShard(shard) {
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const sourceId = `src_rpc_verify_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const chunkId = `chunk_${sourceId}_0`;
  const text = "StudentOS live RPC verification chunk about quadratic roots and vertex form.";
  const embedding = createDeterministicEmbedding(text);
  const identity = deterministicEmbeddingIdentity(embedding.length);
  const now = new Date().toISOString();
  const sourcePayload = {
    id: sourceId,
    userId,
    courseId: "course_rpc_verify",
    title: "RPC verification source",
    sourceType: "uploaded_file",
    status: "indexed",
    citationLabel: "RPC verification source",
    createdAt: now,
  };
  const chunkPayload = {
    id: chunkId,
    userId,
    sourceMaterialId: sourceId,
    courseId: "course_rpc_verify",
    topicId: null,
    chunkIndex: 0,
    text,
    charCount: text.length,
    tokenEstimate: Math.ceil(text.length / 4),
    citationLabel: "RPC verification source #1",
    status: "indexed",
    embeddingStatus: "embedded",
    embeddingProvider: "mock_deterministic",
    embeddingFamily: identity.family,
    embeddingModel: identity.model,
    embeddingVersion: identity.version,
    embeddingHash: contentHash(text),
    embeddingDimensions: embedding.length,
    embeddingVector: embedding,
    createdAt: now,
  };

  await shard.client.upsert("source_materials", {
    id: sourceId,
    user_id: userId,
    course_id: "course_rpc_verify",
    title: sourcePayload.title,
    kind: "uploaded_file",
    source_type: "uploaded_file",
    status: "indexed",
    citation_label: sourcePayload.citationLabel,
    payload: sourcePayload,
    updated_at: now,
  }, { onConflict: "id", returning: "minimal" });

  await shard.client.upsert("source_chunks", {
    id: chunkId,
    user_id: userId,
    source_material_id: sourceId,
    course_id: "course_rpc_verify",
    topic_id: null,
    chunk_index: 0,
    chunk_text: text,
    char_count: text.length,
    token_estimate: Math.ceil(text.length / 4),
    citation_label: chunkPayload.citationLabel,
    status: "indexed",
    embedding_status: "embedded",
    embedding_provider: identity.provider,
    embedding_family: identity.family,
    embedding_model: identity.model,
    embedding_version: identity.version,
    embedding_hash: chunkPayload.embeddingHash,
    embedding_dimensions: embedding.length,
    embedding_values: embedding,
    payload: chunkPayload,
    updated_at: now,
  }, { onConflict: "id", returning: "minimal" });

  let backgroundJobsVerified = true;
  let backgroundJobsNote = null;
  try {
    await shard.client.select("background_jobs", { columns: "id", limit: 1 });
  } catch (error) {
    backgroundJobsVerified = false;
    backgroundJobsNote = safeError(error);
  }

  const rows = await shard.client.rpc("match_source_chunks_v2", {
    p_user_id: userId,
    p_query_text: text,
    p_query_embedding: embedding,
    p_embedding_provider: identity.provider,
    p_embedding_family: identity.family,
    p_embedding_model: identity.model,
    p_embedding_version: identity.version,
    p_embedding_dimensions: identity.dimensions,
    p_course_id: "course_rpc_verify",
    p_topic_id: null,
    p_match_count: 3,
    p_min_similarity: 0,
  });
  assertOk(Array.isArray(rows), `${shard.label}: RPC did not return an array`);
  assertOk(rows.some((row) => row.chunk_id === chunkId), `${shard.label}: RPC did not return the verification chunk`);

  const isolatedRows = await shard.client.rpc("match_source_chunks_v2", {
    p_user_id: otherUserId,
    p_query_text: text,
    p_query_embedding: embedding,
    p_embedding_provider: identity.provider,
    p_embedding_family: identity.family,
    p_embedding_model: identity.model,
    p_embedding_version: identity.version,
    p_embedding_dimensions: identity.dimensions,
    p_course_id: "course_rpc_verify",
    p_topic_id: null,
    p_match_count: 3,
    p_min_similarity: 0,
  });
  assertOk(!isolatedRows.some((row) => row.chunk_id === chunkId), `${shard.label}: RPC leaked another user's chunk`);

  return {
    shard: shard.label,
    projectNumber: shard.projectNumber,
    rpcVerified: true,
    backgroundJobsVerified,
    backgroundJobsNote,
    retrievalMode: rows[0]?.retrieval_mode || "rpc-fts-rrf",
    returnedRows: rows.length,
    userIsolationVerified: true,
  };
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  const config = getSupabaseEnvironment();
  assertOk(config.mode === "supabase", "STUDENTOS_MODE must resolve to supabase for live RPC verification");
  const clients = createSupabaseClients(config);
  const shards = clients.shardClients.filter((shard) => shard.client.isConfigured());
  assertOk(shards.length === 3, "All three data shard clients must be configured");
  const verified = [];
  for (const shard of shards) {
    verified.push(await verifyShard(shard));
  }
  console.log(JSON.stringify({
    ok: true,
    shardsVerified: verified,
    secretsPrinted: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: safeError(error),
    secretsPrinted: false,
  }, null, 2));
  process.exit(1);
});
