# Provider Router V2

Provider Router V2 is a feature-flagged text-generation router. It does not change image generation, prompts, output schemas, weekly allowances, product plans, or billing. The legacy provider router remains available and is the default.

## Routing contract

Every new logical AI operation atomically claims one ordinal from the shared Project 1 AUTH scheduler. The primary ring is:

1. `GROQ_API_KEY_1`
2. `GROQ_API_KEY_2`
3. `GROQ_API_KEY_3`
4. `GROQ_API_KEY_4`
5. `GROQ_API_KEY_5`
6. `GEMINI_API_KEY_1`
7. `GEMINI_API_KEY_2`
8. `GEMINI_API_KEY_3`
9. `GEMINI_API_KEY_4`
10. `GEMINI_API_KEY_5`
11. `GEMINI_API_KEY_6`
12. repeat at Groq slot 1

The cursor is global across users, API replicas, and the background worker. A request starts at its claimed slot, continues once through the remaining eligible primary slots, and never attempts the same numbered slot twice within the logical operation.

Only after all eligible primary slots have been exhausted does routing claim the independent NVIDIA fallback ring: `NVIDIA_API_KEY_1`, `NVIDIA_API_KEY_2`, then `NVIDIA_API_KEY_3`. NVIDIA never receives scheduled primary traffic. Pollinations is attempted only after the primary and eligible NVIDIA rings are unavailable; it never receives scheduled traffic.

One logical operation retains one allowance reservation and one final settlement even when several provider accounts are attempted. Idempotent replays do not claim a new global ordinal or contact a provider again.

## Per-account health

Each Groq, Gemini, and NVIDIA slot persists its own `healthy`, `cooling`, `half_open`, or `disabled` state. The database stores only a SHA-256 credential fingerprint so a changed key resets that slot safely; raw credentials are never persisted. Every eligible attempt also receives an opaque claim token and health version. Success or failure is applied only while that operation still owns the matching, unexpired claim. A stale result is ignored and recorded with a one-way operation correlation hash, so it cannot clear a newer cooldown, reinstate a failed slot, or disable a newly reconfigured credential.

- `429`: valid provider `Retry-After`, reset headers, and Gemini `RetryInfo.retryDelay` take precedence and are bounded to one hour. Without reset metadata, the provider's `*_429_COOLDOWN_MS` is the minimum/base delay, repeated failures double that base, bounded jitter is applied without dropping below the configured base, and the final delay is capped at one hour.
- `401`/`403`: only that slot is disabled until its credential fingerprint changes or an operator invokes the service-role-only `reset_ai_router_slot` RPC.
- timeout, `408`, `500`, `502`, `503`, `504`: only that slot receives a short jittered cooldown.
- `400`/`422` capability or payload incompatibility: the combination is skipped without cooling the credential.
- policy/safety rejection: routing stops; StudentOS does not cycle providers to evade the rejection.

An expired cooldown becomes `half_open`. Only one operation can hold its half-open probe lease. Operation deadlines remain bounded by `STUDENTOS_AI_LOGICAL_OPERATION_TIMEOUT_MS`, and operation/half-open leases are released on normal completion and cancellation.

## Shared persistence and migrations

Apply migrations in this exact scope:

- Project 1 AUTH/shared only: apply `supabase/migrations/202607210001_studentos_ai_router_v2_central.sql`, then `supabase/migrations/202607220001_studentos_ai_router_v2_remediation_central.sql`. The remediation adds claim-token CAS, stale-result telemetry, transition ownership, a schema-capability RPC, and isolated live-test rows. Do not apply either migration to data shards.
- Projects 2, 3, and 4 only: apply `supabase/migrations/202607210002_studentos_ai_router_v2_shards.sql`, then `supabase/migrations/202607220002_studentos_ai_router_v2_remediation_shards.sql` to every shard. The remediation adds a service-role-only capability RPC that verifies routed settlement and explicit `nvidia` support. Do not apply either shard migration to Project 1.

The API and worker must both receive Project 1's `STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_1`; the central scheduler is unavailable when that backend-only authority is missing. Global scheduler tables are not duplicated on data shards.

Verify migration sources locally with `npm run verify:ai-router-migrations`. After applying migrations, set `STUDENTOS_MODE=supabase` and load Project 1 plus all three shard service-role variables before running `node scripts/verifyAiRouterV2Migrations.js --live`. The live command fails closed unless the central version/capabilities and all three shard version/provider capabilities are conclusively returned; it never substitutes source checks for a requested live check.

## Configuration

Feature and timing variables:

```text
STUDENTOS_AI_ROUTER_V2_ENABLED=false
STUDENTOS_AI_ROUTER_V2_ROLLOUT_PERCENT=0
STUDENTOS_AI_LOGICAL_OPERATION_TIMEOUT_MS=120000
STUDENTOS_AI_OPERATION_LEASE_MS=180000
```

Provider switches and credentials:

```text
STUDENTOS_AI_GROQ_ENABLED=true
GROQ_API_KEY_1= through GROQ_API_KEY_5=
STUDENTOS_AI_GEMINI_ENABLED=true
GEMINI_API_KEY_1= through GEMINI_API_KEY_6=
STUDENTOS_AI_NVIDIA_ENABLED=false
NVIDIA_API_KEY_1= through NVIDIA_API_KEY_3=
STUDENTOS_AI_POLLINATIONS_ENABLED=true
POLLINATIONS_API_KEY=
```

NVIDIA settings:

```text
NVIDIA_OPENAI_ENDPOINT=https://integrate.api.nvidia.com/v1/chat/completions
NVIDIA_TEXT_MODEL=moonshotai/kimi-k2.6
NVIDIA_STRUCTURED_MODEL=
NVIDIA_TIMEOUT_MS=45000
NVIDIA_KEY_COOLDOWN_MS=60000
NVIDIA_429_COOLDOWN_MS=180000
```

Pollinations settings:

```text
POLLINATIONS_TEXT_MODEL=gpt-oss
POLLINATIONS_FALLBACK_MAX_MS=3600000
POLLINATIONS_UPSTREAM_PROBE_INTERVAL_MS=300000
```

Numbered values must be distinct. Duplicates are omitted from the usable pool and production V2 validation fails with `duplicate_provider_key_value`. Legacy unnumbered Groq, Gemini, and NVIDIA variables remain single-slot compatibility aliases only.

## Capability-aware routing and registry limits

NVIDIA's live `/v1/models` registry currently lists both `moonshotai/kimi-k2.6` and `openai/gpt-oss-120b`, and NVIDIA documents an OpenAI-compatible chat-completions transport. However, the public registry response does not publish per-model structured-output capability. Therefore Kimi K2.6 is never used for strict JSON and `NVIDIA_STRUCTURED_MODEL` defaults to empty. An empty value produces an observable capability skip without cooling an NVIDIA key. Do not set `openai/gpt-oss-120b` merely from its remembered name; verify the exact registry entry and structured-output support for the hosted endpoint first.

Pollinations' public `/v1/models` registry currently lists exact model ID `gpt-oss` for `/v1/chat/completions`. StudentOS does not substitute an alias. The Azure enable preflight performs a live registry check and fails if `gpt-oss` is absent.

Official references:

- NVIDIA NIM LLM API: <https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html>
- NVIDIA live registry: <https://integrate.api.nvidia.com/v1/models>
- Pollinations API and model catalogue: <https://github.com/pollinations/pollinations/blob/main/APIDOCS.md>
- Pollinations live registry: <https://gen.pollinations.ai/v1/models>

## Pollinations final-resort mode

Entering final-resort mode records an expiry no later than one hour and a probe due after five minutes. Entry occurs only after every upstream slot eligible for that request failed for availability/capacity reasons. Invalid output, schema failure, request/model incompatibility, unsupported capability, or a safety decision can never activate the global mode. Operations may continue directly to Pollinations between probes, but the due probe tries the earliest eligible upstream primary slot and then NVIDIA where the operation capability allows it. Only the operation holding the matching recovery-probe token can clear final-resort mode after upstream success; expiry is the other clearing path. Versioned transitions prevent unrelated concurrent operations from entering or leaving the mode with stale state.

## Validation

Local checks do not call live providers unless explicitly enabled:

```text
npm run check:syntax
npm run test:router-v2
npm run test:router-v2-db
npm test
npm run test:recovery
npm run eval:recovery
npm run verify:ai-router-config
npm run verify:ai-router-migrations
npm run preflight:azure
npm run preflight:production
```

Registry verification is read-only: `npm run verify:ai-router-registries`.

Live credential verification is disabled by default. Set `STUDENTOS_AI_LIVE_VERIFY=true` only in a backend shell, then run `npm run verify:ai`. The verifier uses an eight-token prompt, tests each configured numbered credential separately, never prints credentials, and classifies invalid-key, quota/rate-limit, model/payload, policy, and transport failures.

The real Project 1 concurrency test is also disabled by default. With Router V2 production traffic still disabled, set `STUDENTOS_MODE=supabase` and `STUDENTOS_AI_ROUTER_V2_LIVE_TEST=true`, then run `npm run test:router-v2-db`. It creates two independent service-role clients, issues 48 simultaneous claims against isolated database test rows, verifies contiguous unique ordinals and both stale-writer directions, completes all test operations, and deletes the isolated run. Without the explicit flag it reports `NOT RUN`; with the flag but without Project 1 service-role configuration it fails.

## Azure deployment and rollout

Configure these GitHub environment secrets and let the workflow map them to lowercase Azure secret names on both the API and worker:

- existing Supabase URL/anon/service-role secrets, especially `STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_1`;
- `GROQ_API_KEY_1` through `_5`;
- `GEMINI_API_KEY_1` through `_6`;
- `NVIDIA_API_KEY_1` through `_3` when NVIDIA fallback is enabled;
- `POLLINATIONS_API_KEY`.

Use GitHub environment variables for `STUDENTOS_AI_ROUTER_V2_ENABLED`, `STUDENTOS_AI_ROUTER_V2_ROLLOUT_PERCENT`, provider kill switches, and optional `NVIDIA_STRUCTURED_MODEL`.

Roll out in stages:

1. Apply all four baseline/remediation migrations to their documented targets. Deploy with V2 `false` and rollout `0`; verify the legacy path and migration checks.
2. In development, keep production V2 traffic disabled while running deterministic, registry, fail-closed live migration, and opt-in database concurrency checks. Then set V2 `true`, rollout `100`, and enable NVIDIA only after all three keys are mapped.
3. In production, set V2 `true` and rollout `10`. The assignment is a stable SHA-256 bucket of user ID. Monitor status classes, per-slot cooldowns, fallback level, final provider, and allowance settlements without logging content or raw responses.
4. Raise rollout to `100` only after the canary has healthy cursor progression, no elevated invalid-output rate, and correct one-operation-one-charge settlement.

Immediate rollback is `STUDENTOS_AI_ROUTER_V2_ENABLED=false` (or rollout `0`) on both API and worker. This returns traffic to the untouched legacy router; legacy provider-cycle flags continue to apply. Migrations are additive and can remain in place. Provider-specific containment is available through the Groq, Gemini, NVIDIA, and Pollinations kill switches.

## Observability and privacy

Safe telemetry is limited to the hashed logical operation ID, provider/model, numbered slot, attempt number, fallback level, latency, status class, cooldown duration, final provider, and capability skip reason. Router state never persists student content or raw provider responses. Existing privacy boundaries for source documents, Classroom data, assessment answers, and recovery evidence remain unchanged.
