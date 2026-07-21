const PRIMARY_RING_SIZE = 11;
const NVIDIA_RING_SIZE = 3;

function nowIso(nowMs = Date.now()) {
  return new Date(nowMs).toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function timestampMs(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createMockRouterV2Store() {
  return {
    primaryCursor: 0,
    nvidiaCursor: 0,
    operations: new Map(),
    slots: new Map(),
    pollinations: {
      activeUntil: null,
      nextProbeAt: null,
      probeOperationId: null,
      probeLeaseExpiresAt: null,
    },
  };
}

function slotId(providerCode, slotNumber) {
  return `${providerCode}:${slotNumber}`;
}

function slotRecord(store, providerCode, slotNumber) {
  const id = slotId(providerCode, slotNumber);
  if (!store.slots.has(id)) {
    store.slots.set(id, {
      providerCode,
      slotNumber,
      healthState: "healthy",
      cooldownUntil: null,
      failureCount: 0,
      credentialFingerprint: null,
      halfOpenOperationId: null,
      halfOpenLeaseExpiresAt: null,
      lastStatusClass: null,
    });
  }
  return store.slots.get(id);
}

function mappedSlot(row = {}) {
  return {
    eligible: row.eligible === true,
    providerCode: row.provider_code || null,
    slotNumber: Number(row.slot_number || 0),
    healthState: row.health_state || "disabled",
    cooldownUntil: row.cooldown_until || null,
    failureCount: Number(row.failure_count || 0),
    skipReason: row.skip_reason || null,
  };
}

export class AiRouterV2Coordinator {
  constructor({ centralClient = null, mode = "mock", store = createMockRouterV2Store() } = {}) {
    this.centralClient = centralClient;
    this.mode = mode;
    this.store = store;
  }

  usesCentralState() {
    return this.mode === "supabase";
  }

  assertCentralReady() {
    if (this.usesCentralState() && !this.centralClient?.isConfigured?.()) {
      const error = new Error("ai_router_v2_central_state_not_configured");
      error.status = 503;
      throw error;
    }
  }

  async claimPrimary({ operationId, leaseMs, nowMs = Date.now() } = {}) {
    this.assertCentralReady();
    if (this.usesCentralState()) {
      const rows = await this.centralClient.rpc("claim_ai_router_primary", {
        p_operation_id: operationId,
        p_lease_ms: leaseMs,
      });
      const row = rows?.[0] || {};
      return {
        ordinal: Number(row.primary_ordinal || 0),
        slotOrdinal: Number(row.primary_slot_ordinal || 0),
        replay: row.replay === true,
        leaseExpiresAt: row.lease_expires_at || null,
      };
    }
    const existing = this.store.operations.get(operationId);
    if (existing) {
      existing.leaseExpiresAt = nowIso(nowMs + Math.max(1_000, Number(leaseMs || 180_000)));
      existing.completed = false;
      return clone({ ...existing, replay: true });
    }
    this.store.primaryCursor += 1;
    const claim = {
      ordinal: this.store.primaryCursor,
      slotOrdinal: ((this.store.primaryCursor - 1) % PRIMARY_RING_SIZE) + 1,
      leaseExpiresAt: nowIso(nowMs + Math.max(1_000, Number(leaseMs || 180_000))),
      completed: false,
    };
    this.store.operations.set(operationId, claim);
    return clone({ ...claim, replay: false });
  }

  async claimNvidia({ operationId } = {}) {
    this.assertCentralReady();
    if (this.usesCentralState()) {
      const rows = await this.centralClient.rpc("claim_ai_router_nvidia", { p_operation_id: operationId });
      const row = rows?.[0] || {};
      return { ordinal: Number(row.nvidia_ordinal || 0), slotNumber: Number(row.nvidia_slot_number || 0), replay: row.replay === true };
    }
    const operation = this.store.operations.get(operationId);
    if (!operation) throw new Error("ai_router_v2_operation_not_claimed");
    if (operation.nvidiaOrdinal) {
      return { ordinal: operation.nvidiaOrdinal, slotNumber: operation.nvidiaSlotNumber, replay: true };
    }
    this.store.nvidiaCursor += 1;
    operation.nvidiaOrdinal = this.store.nvidiaCursor;
    operation.nvidiaSlotNumber = ((this.store.nvidiaCursor - 1) % NVIDIA_RING_SIZE) + 1;
    return { ordinal: operation.nvidiaOrdinal, slotNumber: operation.nvidiaSlotNumber, replay: false };
  }

  async claimSlot({ operationId, providerCode, slotNumber, credentialFingerprint, leaseMs = 30_000, nowMs = Date.now() } = {}) {
    this.assertCentralReady();
    if (this.usesCentralState()) {
      const rows = await this.centralClient.rpc("claim_ai_router_slot", {
        p_operation_id: operationId,
        p_provider_code: providerCode,
        p_slot_number: slotNumber,
        p_credential_fingerprint: credentialFingerprint,
        p_half_open_lease_ms: leaseMs,
      });
      return mappedSlot(rows?.[0] || {});
    }
    const slot = slotRecord(this.store, providerCode, slotNumber);
    if (slot.credentialFingerprint !== credentialFingerprint) {
      Object.assign(slot, {
        healthState: "healthy",
        cooldownUntil: null,
        failureCount: 0,
        credentialFingerprint,
        halfOpenOperationId: null,
        halfOpenLeaseExpiresAt: null,
        lastStatusClass: null,
      });
    }
    if (slot.healthState === "disabled") return { ...clone(slot), eligible: false, skipReason: "disabled" };
    if (slot.healthState === "cooling") {
      if (timestampMs(slot.cooldownUntil) > nowMs) return { ...clone(slot), eligible: false, skipReason: "cooling" };
      slot.healthState = "half_open";
    }
    if (slot.healthState === "half_open") {
      const held = timestampMs(slot.halfOpenLeaseExpiresAt) > nowMs && slot.halfOpenOperationId !== operationId;
      if (held) return { ...clone(slot), eligible: false, skipReason: "half_open_lease_held" };
      slot.halfOpenOperationId = operationId;
      slot.halfOpenLeaseExpiresAt = nowIso(nowMs + Math.max(1_000, Number(leaseMs || 30_000)));
    }
    return { ...clone(slot), eligible: true, skipReason: null };
  }

  async recordSuccess({ operationId, providerCode, slotNumber, nowMs = Date.now() } = {}) {
    this.assertCentralReady();
    if (this.usesCentralState()) {
      await this.centralClient.rpc("record_ai_router_success", {
        p_operation_id: operationId,
        p_provider_code: providerCode,
        p_slot_number: slotNumber,
      });
      return;
    }
    const slot = slotRecord(this.store, providerCode, slotNumber);
    Object.assign(slot, {
      healthState: "healthy",
      cooldownUntil: null,
      failureCount: 0,
      halfOpenOperationId: null,
      halfOpenLeaseExpiresAt: null,
      lastStatusClass: "success",
      lastSuccessAt: nowIso(nowMs),
    });
  }

  async recordFailure({ operationId, providerCode, slotNumber, statusClass, cooldownMs = 0, disable = false, nowMs = Date.now() } = {}) {
    this.assertCentralReady();
    if (this.usesCentralState()) {
      await this.centralClient.rpc("record_ai_router_failure", {
        p_operation_id: operationId,
        p_provider_code: providerCode,
        p_slot_number: slotNumber,
        p_status_class: statusClass,
        p_cooldown_ms: Math.max(0, Math.floor(cooldownMs)),
        p_disable: disable === true,
      });
      return;
    }
    const slot = slotRecord(this.store, providerCode, slotNumber);
    slot.failureCount += 1;
    slot.healthState = disable ? "disabled" : "cooling";
    slot.cooldownUntil = disable ? null : nowIso(nowMs + Math.max(1, Number(cooldownMs || 1)));
    slot.halfOpenOperationId = null;
    slot.halfOpenLeaseExpiresAt = null;
    slot.lastStatusClass = statusClass;
    slot.lastFailureAt = nowIso(nowMs);
  }

  async getPollinationsDecision({ operationId, probeIntervalMs, nowMs = Date.now() } = {}) {
    this.assertCentralReady();
    if (this.usesCentralState()) {
      const rows = await this.centralClient.rpc("claim_ai_router_pollinations_probe", {
        p_operation_id: operationId,
        p_probe_interval_ms: probeIntervalMs,
      });
      const row = rows?.[0] || {};
      return {
        active: row.fallback_active === true,
        probe: row.probe_claimed === true,
        activeUntil: row.fallback_active_until || null,
        nextProbeAt: row.next_probe_at || null,
      };
    }
    const state = this.store.pollinations;
    if (!state.activeUntil || timestampMs(state.activeUntil) <= nowMs) {
      Object.assign(state, { activeUntil: null, nextProbeAt: null, probeOperationId: null, probeLeaseExpiresAt: null });
      return { active: false, probe: true, activeUntil: null, nextProbeAt: null };
    }
    if (timestampMs(state.nextProbeAt) > nowMs) {
      return { active: true, probe: false, activeUntil: state.activeUntil, nextProbeAt: state.nextProbeAt };
    }
    const held = timestampMs(state.probeLeaseExpiresAt) > nowMs && state.probeOperationId !== operationId;
    if (held) return { active: true, probe: false, activeUntil: state.activeUntil, nextProbeAt: state.nextProbeAt };
    state.probeOperationId = operationId;
    state.probeLeaseExpiresAt = nowIso(nowMs + Math.min(60_000, Math.max(5_000, Number(probeIntervalMs || 300_000) / 2)));
    state.nextProbeAt = nowIso(nowMs + Math.max(1_000, Number(probeIntervalMs || 300_000)));
    return { active: true, probe: true, activeUntil: state.activeUntil, nextProbeAt: state.nextProbeAt };
  }

  async enterPollinations({ operationId, fallbackMaxMs, probeIntervalMs, nowMs = Date.now() } = {}) {
    this.assertCentralReady();
    if (this.usesCentralState()) {
      await this.centralClient.rpc("enter_ai_router_pollinations_mode", {
        p_operation_id: operationId,
        p_fallback_max_ms: fallbackMaxMs,
        p_probe_interval_ms: probeIntervalMs,
      });
      return;
    }
    const state = this.store.pollinations;
    if (!state.activeUntil || timestampMs(state.activeUntil) <= nowMs) {
      state.activeUntil = nowIso(nowMs + Math.max(1_000, Number(fallbackMaxMs || 3_600_000)));
      state.nextProbeAt = nowIso(nowMs + Math.max(1_000, Number(probeIntervalMs || 300_000)));
    }
    state.probeOperationId = null;
    state.probeLeaseExpiresAt = null;
  }

  async leavePollinations({ operationId } = {}) {
    this.assertCentralReady();
    if (this.usesCentralState()) {
      await this.centralClient.rpc("leave_ai_router_pollinations_mode", { p_operation_id: operationId });
      return;
    }
    Object.assign(this.store.pollinations, { activeUntil: null, nextProbeAt: null, probeOperationId: null, probeLeaseExpiresAt: null });
  }

  async completeOperation({ operationId } = {}) {
    this.assertCentralReady();
    if (this.usesCentralState()) {
      await this.centralClient.rpc("complete_ai_router_operation", { p_operation_id: operationId });
      return;
    }
    const operation = this.store.operations.get(operationId);
    if (operation) operation.completed = true;
    for (const slot of this.store.slots.values()) {
      if (slot.halfOpenOperationId !== operationId) continue;
      slot.halfOpenOperationId = null;
      slot.halfOpenLeaseExpiresAt = null;
      if (slot.healthState === "half_open") slot.healthState = "cooling";
    }
    if (this.store.pollinations.probeOperationId === operationId) {
      this.store.pollinations.probeOperationId = null;
      this.store.pollinations.probeLeaseExpiresAt = null;
    }
  }

  safeSnapshot() {
    return {
      sharedPersistence: this.usesCentralState() ? "central_auth_project" : "mock_store",
      primaryCursor: this.usesCentralState() ? null : this.store.primaryCursor,
      nvidiaCursor: this.usesCentralState() ? null : this.store.nvidiaCursor,
      slots: this.usesCentralState() ? [] : [...this.store.slots.values()].map((slot) => ({
        providerCode: slot.providerCode,
        slotNumber: slot.slotNumber,
        healthState: slot.healthState,
        cooldownUntil: slot.cooldownUntil,
        failureCount: slot.failureCount,
      })),
      pollinationsFallbackActive: this.usesCentralState() ? null : timestampMs(this.store.pollinations.activeUntil) > Date.now(),
      secretsExposed: false,
    };
  }

  async readSafeSnapshot() {
    if (!this.usesCentralState()) return this.safeSnapshot();
    try {
      this.assertCentralReady();
      const [stateRows, slotRows] = await Promise.all([
        this.centralClient.select("ai_router_global_state", {
          columns: "primary_cursor,nvidia_cursor,pollinations_active_until,pollinations_next_probe_at,version,updated_at",
          limit: 1,
        }),
        this.centralClient.select("ai_router_slots", {
          columns: "provider_code,slot_number,health_state,cooldown_until,failure_count,last_status_class,last_success_at,last_failure_at,updated_at",
          order: "provider_code.asc,slot_number.asc",
        }),
      ]);
      const state = stateRows?.[0] || {};
      return {
        sharedPersistence: "central_auth_project",
        primaryCursor: Number(state.primary_cursor || 0),
        nvidiaCursor: Number(state.nvidia_cursor || 0),
        version: Number(state.version || 0),
        updatedAt: state.updated_at || null,
        slots: (slotRows || []).map((slot) => ({
          providerCode: slot.provider_code,
          slotNumber: Number(slot.slot_number || 0),
          healthState: slot.health_state,
          cooldownUntil: slot.cooldown_until || null,
          failureCount: Number(slot.failure_count || 0),
          lastStatusClass: slot.last_status_class || null,
          lastSuccessAt: slot.last_success_at || null,
          lastFailureAt: slot.last_failure_at || null,
        })),
        pollinationsFallbackActive: Date.parse(state.pollinations_active_until || "") > Date.now(),
        pollinationsActiveUntil: state.pollinations_active_until || null,
        pollinationsNextProbeAt: state.pollinations_next_probe_at || null,
        secretsExposed: false,
      };
    } catch {
      return { ...this.safeSnapshot(), unavailable: true, secretsExposed: false };
    }
  }
}
