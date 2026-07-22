import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { getSupabaseEnvironment, loadDotEnv } from "../backend/config/supabaseEnv.js";
import { createSupabaseClients } from "../backend/supabase/clients.js";

const CLAIM_COUNT = 48;

function firstRow(value) {
  return Array.isArray(value) ? value[0] || {} : value || {};
}

function isoAt(baseMs, offsetMs) {
  return new Date(baseMs + offsetMs).toISOString();
}

export async function runAiRouterV2DatabaseConcurrencyTest({ env = process.env, clientFactory = createSupabaseClients } = {}) {
  if (String(env.STUDENTOS_AI_ROUTER_V2_LIVE_TEST || "").toLowerCase() !== "true") {
    return { status: "NOT RUN", ok: true, reason: "STUDENTOS_AI_ROUTER_V2_LIVE_TEST_not_enabled", secretsPrinted: false };
  }
  const config = getSupabaseEnvironment(env);
  if (config.requestedMode !== "supabase" || !config.auth.url || !config.auth.serviceRoleKey) {
    throw new Error("router_v2_live_test_project_1_service_role_configuration_missing");
  }

  const firstClients = clientFactory(config);
  const secondClients = clientFactory(config);
  const clientA = firstClients?.routerClient;
  const clientB = secondClients?.routerClient;
  if (!clientA?.isConfigured?.() || !clientB?.isConfigured?.() || clientA === clientB) {
    throw new Error("router_v2_live_test_requires_two_service_role_clients");
  }

  const suffix = `${Date.now()}-${randomUUID().slice(0, 12)}`;
  const runId = `studentos-router-v2-live-${suffix}`;
  const operationIds = new Set();
  try {
    const claimRequests = Array.from({ length: CLAIM_COUNT }, (_, index) => {
      const operationId = `studentos-router-v2-live-${suffix}-claim-${index + 1}`;
      operationIds.add(operationId);
      const client = index % 2 === 0 ? clientA : clientB;
      return client.rpc("claim_ai_router_v2_test_primary", { p_run_id: runId, p_operation_id: operationId });
    });
    const claims = (await Promise.all(claimRequests)).map(firstRow);
    const ordinals = claims.map((claim) => Number(claim.primary_ordinal));
    assert.equal(new Set(ordinals).size, CLAIM_COUNT, "database primary ordinals must be unique");
    assert.deepEqual([...ordinals].sort((left, right) => left - right), Array.from({ length: CLAIM_COUNT }, (_, index) => index + 1), "database primary ordinals must be contiguous");
    const slotByOrdinal = new Map();
    for (const claim of claims) {
      const ordinal = Number(claim.primary_ordinal);
      const slot = Number(claim.primary_slot_ordinal);
      assert.equal(slot, ((ordinal - 1) % 11) + 1, "slot assignment must match the claimed ordinal");
      assert.equal(slotByOrdinal.has(ordinal), false, "one ordinal must never receive duplicate slot assignments");
      slotByOrdinal.set(ordinal, slot);
    }

    const casOperationIds = ["stale-failure-a", "success-b", "stale-success-a", "cooldown-b"].map((label) => `studentos-router-v2-live-${suffix}-${label}`);
    for (let index = 0; index < casOperationIds.length; index += 1) {
      operationIds.add(casOperationIds[index]);
      await (index % 2 === 0 ? clientA : clientB).rpc("claim_ai_router_v2_test_primary", { p_run_id: runId, p_operation_id: casOperationIds[index] });
    }

    const baseMs = Date.now();
    await clientA.rpc("prepare_ai_router_v2_test_slot", {
      p_run_id: runId, p_provider_code: "groq", p_slot_number: 1,
      p_health_state: "cooling", p_cooldown_until: isoAt(baseMs, -1_000),
    });
    const staleFailureA = firstRow(await clientA.rpc("claim_ai_router_v2_test_slot", {
      p_run_id: runId, p_operation_id: casOperationIds[0], p_provider_code: "groq", p_slot_number: 1,
      p_lease_ms: 1_000, p_observed_at: isoAt(baseMs, 0),
    }));
    const successB = firstRow(await clientB.rpc("claim_ai_router_v2_test_slot", {
      p_run_id: runId, p_operation_id: casOperationIds[1], p_provider_code: "groq", p_slot_number: 1,
      p_lease_ms: 1_000, p_observed_at: isoAt(baseMs, 2_000),
    }));
    assert.equal(staleFailureA.eligible, true);
    assert.equal(successB.eligible, true);
    const appliedSuccess = firstRow(await clientB.rpc("record_ai_router_v2_test_result", {
      p_run_id: runId, p_operation_id: casOperationIds[1], p_provider_code: "groq", p_slot_number: 1,
      p_claim_token: successB.claim_token, p_succeeded: true, p_cooldown_ms: 0, p_observed_at: isoAt(baseMs, 2_500),
    }));
    const ignoredFailure = firstRow(await clientA.rpc("record_ai_router_v2_test_result", {
      p_run_id: runId, p_operation_id: casOperationIds[0], p_provider_code: "groq", p_slot_number: 1,
      p_claim_token: staleFailureA.claim_token, p_succeeded: false, p_cooldown_ms: 60_000, p_observed_at: isoAt(baseMs, 2_600),
    }));
    assert.equal(appliedSuccess.applied, true);
    assert.equal(ignoredFailure.applied, false);
    assert.equal(ignoredFailure.health_state, "healthy", "stale failure must not overwrite a newer success");

    await clientA.rpc("prepare_ai_router_v2_test_slot", {
      p_run_id: runId, p_provider_code: "groq", p_slot_number: 2,
      p_health_state: "healthy", p_cooldown_until: null,
    });
    const staleSuccessA = firstRow(await clientA.rpc("claim_ai_router_v2_test_slot", {
      p_run_id: runId, p_operation_id: casOperationIds[2], p_provider_code: "groq", p_slot_number: 2,
      p_lease_ms: 1_000, p_observed_at: isoAt(baseMs, 0),
    }));
    const cooldownB = firstRow(await clientB.rpc("claim_ai_router_v2_test_slot", {
      p_run_id: runId, p_operation_id: casOperationIds[3], p_provider_code: "groq", p_slot_number: 2,
      p_lease_ms: 1_000, p_observed_at: isoAt(baseMs, 2_000),
    }));
    const appliedCooldown = firstRow(await clientB.rpc("record_ai_router_v2_test_result", {
      p_run_id: runId, p_operation_id: casOperationIds[3], p_provider_code: "groq", p_slot_number: 2,
      p_claim_token: cooldownB.claim_token, p_succeeded: false, p_cooldown_ms: 60_000, p_observed_at: isoAt(baseMs, 2_500),
    }));
    const ignoredSuccess = firstRow(await clientA.rpc("record_ai_router_v2_test_result", {
      p_run_id: runId, p_operation_id: casOperationIds[2], p_provider_code: "groq", p_slot_number: 2,
      p_claim_token: staleSuccessA.claim_token, p_succeeded: true, p_cooldown_ms: 0, p_observed_at: isoAt(baseMs, 2_600),
    }));
    assert.equal(appliedCooldown.applied, true);
    assert.equal(ignoredSuccess.applied, false);
    assert.equal(ignoredSuccess.health_state, "cooling", "stale success must not clear a newer cooldown");

    return {
      status: "PASS",
      ok: true,
      clients: 2,
      concurrentClaims: CLAIM_COUNT,
      uniqueOrdinals: CLAIM_COUNT,
      contiguousOrdinals: true,
      staleFailureIgnored: true,
      staleSuccessIgnored: true,
      isolatedTestState: true,
      secretsPrinted: false,
    };
  } finally {
    const completionResults = await Promise.allSettled([...operationIds].map((operationId, index) => (
      (index % 2 === 0 ? clientA : clientB).rpc("complete_ai_router_v2_test_operation", { p_run_id: runId, p_operation_id: operationId })
    )));
    await clientA.rpc("cleanup_ai_router_v2_test_run", { p_run_id: runId });
    if (completionResults.some((result) => result.status === "rejected")) throw new Error("router_v2_live_test_operation_completion_failed");
  }
}

async function main() {
  loadDotEnv({ cwd: process.cwd() });
  try {
    const result = await runAiRouterV2DatabaseConcurrencyTest();
    console.log(JSON.stringify(result, null, 2));
  } catch {
    console.error(JSON.stringify({ status: "FAIL", ok: false, error: "router_v2_database_concurrency_test_failed", secretsPrinted: false }, null, 2));
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
