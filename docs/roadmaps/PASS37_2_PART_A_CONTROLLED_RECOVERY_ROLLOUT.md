# PASS 37.2 Part A — Controlled Adaptive Recovery Rollout Controls

## Status

Part A adds the repository-owned safety controls required before any live Adaptive Recovery exercise. It does not deploy, apply a migration, change Supabase data, enable Recovery, or add a user to a rollout cohort.

Part B remains responsible for local validation, read-only live verification, dark deployment, controlled test-account execution, rollback rehearsal, and the final operational report.

## Purpose

PASS 37.1 added the review-first Recovery product surface but deliberately left both launch switches disabled. Part A separates ordinary StudentOS deployment from Recovery rollout and introduces a fail-closed, account-specific cohort boundary.

The default production state remains:

```text
STUDENTOS_ADAPTIVE_RECOVERY_ENABLED=false
STUDENTOS_RECOVERY_UI_ENABLED=false
STUDENTOS_RECOVERY_ROLLOUT_MODE=off
STUDENTOS_RECOVERY_ROLLOUT_USER_IDS=
```

## Rollout policy

Supported rollout modes are intentionally limited to:

- `off`
- `allowlist`

There is no global, percentage, plan-wide, or automatic rollout mode in this pass.

An allowlist configuration is valid only when:

- the engine flag is true;
- the UI flag is true;
- the rollout mode is `allowlist`;
- at least one valid Supabase Auth UUID is present;
- every identifier is unique;
- the cohort contains no more than 25 accounts.

Malformed configuration never grants public capability or route access. Low-level Recovery services continue to honor the dedicated engine switch for deterministic tests and already-queued work, while every user-facing capability and Recovery route additionally requires a valid allowlist and matching account UUID.

The public capability response does not reveal whether an account is absent from the cohort. Non-cohort accounts receive the same safe disabled state used for a disabled rollout.

## Deployment separation

`.github/workflows/azure-container-apps-studentos.yml` is now dark-deployment-only. It always writes these values to both the API and worker:

```text
STUDENTOS_ADAPTIVE_RECOVERY_ENABLED=false
STUDENTOS_RECOVERY_UI_ENABLED=false
STUDENTOS_RECOVERY_ROLLOUT_MODE=off
```

The ordinary deployment workflow no longer accepts an Adaptive Recovery enable input. Deploying new StudentOS code therefore cannot enable Recovery accidentally. A later ordinary deployment also returns Recovery to the dark state, which is the safe fallback during this controlled phase.

`infra/azure/containerapp.bicep` carries the same dark defaults for both Container Apps.

## Dedicated rollout workflow

`.github/workflows/adaptive-recovery-rollout.yml` is the only checked-in workflow allowed to change Recovery rollout state.

It is manual-only, may run only from `main`, and uses the existing protected `azure-dev` environment. It supports:

- `disable`
- `enable_allowlist`

Exact confirmation phrases are required:

```text
DISABLE-RECOVERY
ENABLE-RECOVERY-ALLOWLIST
```

Before allowlist enablement, the workflow:

1. validates the cohort configuration without printing UUIDs;
2. verifies the hardened Recovery schema live on every data shard;
3. verifies the existing worker has no ingress, fixed 1–1 scale, the expected command, and a ready latest revision;
4. requires API and worker to use the same image;
5. requires that image to be the current `main` commit deployed through the dark deployment workflow;
6. stores the cohort as an Azure Container Apps secret;
7. enables the worker first and waits for readiness;
8. enables the API only after the worker is ready;
9. verifies both revisions and API/worker rollout parity.

The disable action does not depend on the currently deployed image version. It hides the API surface first, then disables worker-side Recovery processing. It sets both feature flags false and the rollout mode to `off` while preserving Recovery history and the stored cohort secret.

A failed enable attempt triggers an emergency disable of both apps. Raw Azure CLI output remains withheld throughout enable, disable, and emergency rollback operations.

## Required GitHub environment secret

Part B must configure this only in the protected GitHub environment used for the controlled rollout:

```text
STUDENTOS_RECOVERY_ROLLOUT_USER_IDS
```

The value is a comma-separated list of approved Supabase Auth user UUIDs. It must not be committed, printed, placed in Cloudflare Pages, or exposed through public status/config responses.

For the first rollout, use one approved Plus or Pro test account only.

## Code boundaries

### `backend/recovery/recoveryConfig.js`

- parses and validates rollout configuration;
- normalizes UUIDs;
- rejects duplicates and malformed values;
- caps cohort size;
- exposes only safe rollout metadata;
- provides the account eligibility predicate.

### `backend/recovery/recoveryAccessService.js`

- keeps plan and lifecycle gates;
- additionally requires account allowlist membership;
- returns a generic disabled capability for non-cohort accounts;
- never exposes cohort membership or identifiers.

### `scripts/verifyRecoveryRolloutConfig.js`

- validates environment configuration;
- prints mode, account count, safe error codes, and `secretsPrinted: false`;
- never prints account identifiers.

## Tests and preflight

`backend/testPass372RecoveryRolloutControls.js` verifies:

- dark defaults;
- invalid combinations;
- malformed and duplicate UUID rejection;
- account eligibility;
- safe public status;
- non-cohort denial;
- deployment/rollout workflow separation;
- main-branch and current-image requirements;
- manual confirmations;
- schema gate presence;
- worker-first enable and API-first disable ordering;
- automatic failed-enable rollback;
- paired enable/disable behavior;
- redacted Azure operations;
- Bicep defaults.

The test is included in `npm run test:recovery` and the full test suite. Azure preflight now verifies both workflows and the dark infrastructure boundary.

## Part B operational responsibilities

Part B must not redesign the rollout architecture. It should:

1. pull this branch locally and review the entire diff;
2. run syntax, Recovery, preflight, Cloudflare, and full test suites;
3. correct only defects discovered by those validations;
4. reconcile older Azure documentation that still describes the removed deployment-time enable input;
5. verify migrations `202607190001` and `202607190002` read-only across data shards;
6. verify the live API/worker topology without printing secret values;
7. merge the Part A PR only after CI and local validation are green;
8. deploy the exact merged `main` commit dark through the normal Azure workflow;
9. verify ordinary StudentOS behavior while Recovery remains absent;
10. confirm no stale or unexpected Recovery jobs are queued before enablement;
11. add one approved Plus or Pro account UUID to the protected GitHub environment secret;
12. run the dedicated rollout workflow with `enable_allowlist`;
13. exercise analyze → preview → reject and analyze → preview → apply;
14. verify stale/expired/superseded handling and idempotent replays;
15. run the dedicated workflow with `disable` and confirm the entry point disappears while Today continues normally;
16. leave Recovery disabled after the rehearsal unless a separate explicit launch decision is made.

## Preserved boundaries

Part A preserves:

- server-owned assessment scoring;
- embedding-space compatibility;
- strict public workspace DTOs;
- narrow state repositories;
- background-only persisted embedding work;
- lifecycle and plan gates;
- review-first apply behavior;
- Classroom read-only operation;
- no automatic assignment submission;
- no migration or schema change;
- no provider credential exposure;
- no cohort identifier exposure.

## Operational state at completion

Part A alone leaves Recovery disabled everywhere. No workflow has been run, no cloud resource has been mutated, no user has been enrolled, and no live Recovery request has been executed.
