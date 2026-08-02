# Azure Container Apps Deployment Readiness

StudentOS backend is prepared for Azure Container Apps Consumption. This pass does not deploy automatically.

Remediation status on 2026-07-19: the Azure workflow had not been run when remediation began, migration 001 had already been applied and verified on all three data shards, migration 002 remained pending, and Adaptive Recovery remained disabled. Do not treat the local Bicep/workflow definitions as evidence that the worker exists in Azure; the workflow's actual-resource checks must pass after deployment.

## Target Architecture

- Backend: Azure Container Apps Consumption, one backend image shared by separate API and worker apps
- Image registry: GHCR, to avoid Azure Container Registry cost
- Database/Auth/Storage: existing Supabase projects and private buckets
- Frontend: Cloudflare Pages, deployed separately from this backend image
- API scale: minimum 0, maximum 1; external HTTP ingress on port 3101
- Worker scale: minimum 1, maximum 1; no ingress; `npm run jobs:dev`; `0.25` CPU and `0.5Gi` memory
- Background execution is isolated from the web container, and queued work does not depend on API traffic
- Warmup pinger: disabled
- Azure SQL: not used
- Azure Storage duplication: not used

## Files

- `Dockerfile`
- `.dockerignore`
- `infra/azure/containerapp.bicep`
- `infra/azure/deploy-containerapp.ps1`
- `infra/azure/deploy-containerapp.sh`
- `.github/workflows/azure-container-apps-studentos.yml`
- `.github/workflows/adaptive-recovery-rollout.yml`


## Backend Image Boundary

Azure Container Apps is the StudentOS backend target only. The backend Docker image must not copy or depend on `frontend/` because the frontend deploys separately to Cloudflare Pages.

Required safeguards:

- `.dockerignore` excludes `frontend/` from the Docker build context.
- `Dockerfile` does not `COPY frontend` into the image.
- Azure runtime sets `STUDENTOS_DEPLOYMENT=azure-container-apps` and `STUDENTOS_SERVE_FRONTEND=false`.
- Local development may still serve `frontend/` from the Node backend when `STUDENTOS_DEPLOYMENT` is not `azure-container-apps` and `STUDENTOS_SERVE_FRONTEND` is not `false`.

Cloudflare Pages should own all browser assets. Azure should expose only API, health, config, OAuth callback, and other backend routes.


## Existing Container Apps Environment

StudentOS reuses the existing Azure Container Apps Environment because the Azure for Students subscription permits only one Container Apps Environment in `centralindia`.

Current environment boundary:

- Existing ACA environment: `cae-sentiqgpt-prod`
- Existing environment resource group: `rg-sentiqgpt-prod`
- StudentOS Container App resource group: `rg-studentos-dev`
- StudentOS API Container App name: `studentos-api-dev`
- StudentOS worker Container App name: `studentos-worker-dev` by default, supplied to the workflow as `AZURE_WORKER_CONTAINER_APP_NAME`
- Region: `centralindia`

This does not merge app secrets, runtime state, images, revisions, scaling, or traffic with SentIQ Chat / SentIQGPT. The StudentOS API and worker are separate resources, use the same image and backend secret set, and retain independent revisions/scaling. Do not modify the SentIQ Chat / SentIQGPT app or its secrets when deploying StudentOS.

## GitHub Actions Workflow

Workflow name: `Azure Container Apps - StudentOS API and Worker`

The workflow is manual-only:

```yaml
on:
  workflow_dispatch:
```

It builds one Docker image, pushes it to GHCR, and deploys/updates both the API (0–1) and worker (1–1). Every ordinary deployment is dark: it writes `STUDENTOS_ADAPTIVE_RECOVERY_ENABLED=false`, `STUDENTOS_RECOVERY_UI_ENABLED=false`, and `STUDENTOS_RECOVERY_ROLLOUT_MODE=off` to both apps and validates the actual worker resource and ready revision. It has no Recovery enable input. An ordinary future deployment also returns Recovery to this dark state.

Controlled enablement uses the separate manual-only workflow `Adaptive Recovery - Controlled Rollout` from `.github/workflows/adaptive-recovery-rollout.yml`. It runs only from `main`, requires the exact current-main image already deployed dark to both apps, verifies the live hardened schema and worker topology, and supports allowlist enablement only. The initial cohort must be exactly one explicitly approved existing Plus/Pro test account. Cohort identifiers belong in the protected `azure-dev` environment secret `STUDENTOS_RECOVERY_ROLLOUT_USER_IDS`; never place them in source, workflow inputs, comments, or logs.

The same dedicated workflow's `disable` action is the operational rollback mechanism. It hides the API first, disables the worker second, and restores all three dark values. No global or plan-wide Recovery launch has occurred.

## Required GitHub Secrets

Do not commit values. Configure these in GitHub repository secrets or environment secrets:

- `AZURE_CREDENTIALS`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`
- `AZURE_CONTAINER_APP_NAME`
- `AZURE_WORKER_CONTAINER_APP_NAME`
- `AZURE_CONTAINER_APP_ENVIRONMENT`
- `AZURE_CONTAINER_APP_ENVIRONMENT_RESOURCE_GROUP`
- `AZURE_LOCATION`
- `GHCR_PULL_TOKEN`
- `STUDENTOS_RECOVERY_ROLLOUT_USER_IDS` in the protected `azure-dev` environment only, before an approved controlled exercise

`GHCR_PULL_TOKEN` should be a low-scope token with package read access so Azure Container Apps can pull the private GHCR image after the workflow finishes. The workflow uses `GITHUB_TOKEN` only to push the image during the workflow run.

OIDC/federated identity can replace `AZURE_CREDENTIALS` later. If using OIDC, update the workflow to pass `client-id`, `tenant-id`, and `subscription-id` to `azure/login` instead of `creds`.

## Azure Runtime Environment Variables

Configure the backend authority and optional provider values identically on the API and worker as env vars or secret refs. Do not bake them into the image and do not pass them as Docker build args.

Non-secret runtime values:

- `NODE_ENV=production`
- `PORT=3101`
- `STUDENTOS_PORT=3101`
- `STUDENTOS_ENV=production`
- `STUDENTOS_DEPLOYMENT=azure-container-apps`
- `STUDENTOS_SERVE_FRONTEND=false`
- `STUDENTOS_MODE=supabase`
- `STUDENTOS_BACKGROUND_WORKERS_ENABLED=true` only in the deployed API-plus-dedicated-worker topology
- `STUDENTOS_ADAPTIVE_RECOVERY_ENABLED=false` in every ordinary deployment
- `STUDENTOS_RECOVERY_UI_ENABLED=false` in every ordinary deployment
- `STUDENTOS_RECOVERY_ROLLOUT_MODE=off` in every ordinary deployment
- `STUDENTOS_RECOVERY_PREVIEW_TTL_HOURS=24`
- `STUDENTOS_DEMO_SEED_ENABLED=false`
- `STUDENTOS_GOOGLE_CLASSROOM_MODE=disabled`
- `STUDENTOS_BILLING_PROVIDER=none`
- `STUDENTOS_BILLING_LIVE_CHARGES_ENABLED=false`
- `STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED=false`
- `STUDENTOS_AUTH_ADMIN_DELETE_ENABLED=false`
- `STUDENTOS_INTERNAL_OPS_ENABLED=false`
- `CORS_ORIGINS=https://studentos.sentiqlabs.com,https://studentos-39s.pages.dev,http://localhost:3101,http://localhost:3102,http://127.0.0.1:3101,http://127.0.0.1:3102`

Backend-only secret values:

- `STUDENTOS_SUPABASE_URL_1`
- `STUDENTOS_SUPABASE_ANON_KEY_1`
- `STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_1`
- `STUDENTOS_SUPABASE_URL_2`
- `STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_2`
- `STUDENTOS_SUPABASE_URL_3`
- `STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_3`
- `STUDENTOS_SUPABASE_URL_4`
- `STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_4`
- `STUDENTOS_SUPABASE_JWT_SECRET`
- `STUDENTOS_RECOVERY_ROLLOUT_USER_IDS` for the dedicated controlled-rollout workflow only; Azure maps it through the `studentos-recovery-rollout-user-ids` secret reference and public status never returns its value
- `STUDENTOS_STORAGE_BUCKET`
- `STUDENTOS_EXPORT_STORAGE_BUCKET`
- `STUDENTOS_GOOGLE_CLASSROOM_OAUTH_STATE_SECRET` if Classroom OAuth is later enabled
- `STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET` if Classroom OAuth is later enabled
- `GOOGLE_CLIENT_ID` if Classroom OAuth is later enabled
- `GOOGLE_CLIENT_SECRET` if Classroom OAuth is later enabled
- `GOOGLE_REDIRECT_URI` if Classroom OAuth is later enabled
- at least one Groq key is required for the production Ask StudentOS route: `GROQ_API_KEY` or any of `GROQ_API_KEY_1` through `GROQ_API_KEY_5`
- `GROQ_API_KEY` is the backward-compatible single-key fallback
- `GROQ_API_KEY_1` through `GROQ_API_KEY_5` are the preferred production key pool
- `GEMINI_API_KEY` or `GEMINI_API_KEY_1` through `GEMINI_API_KEY_6` provide backend-only Gemini fallback; Router V2 requires all six distinct numbered slots
- `NVIDIA_API_KEY_1` through `NVIDIA_API_KEY_3` provide fallback-only NVIDIA capacity when `STUDENTOS_AI_NVIDIA_ENABLED=true`
- `POLLINATIONS_API_KEY` if Pollinations paid/authenticated mode is enabled
- At least two enabled provider families must have credentials in production. `auto` mode attempts every configured provider rather than depending on Groq alone.
- `STUDENTOS_EMBEDDING_API_KEY` if real embeddings are enabled
- billing provider secrets only after a billing launch review
- operator/internal/deletion secrets only after an internal-ops launch review

The `Azure Container Apps - StudentOS API and Worker` GitHub Actions workflow validates and maps the required Supabase values plus every configured provider key into Azure Container Apps as backend-only secret refs after the Bicep deployment. With cyclic routing disabled, validation keeps the existing requirement of at least one Groq key. With cyclic routing enabled, it fails closed unless Groq, all five distinct numbered Gemini slots, and authenticated Pollinations are configured. Missing required secret names cause the workflow to fail before deployment output is shown. Provider and service-role keys stay in GitHub Actions and Azure Container Apps only; do not add them to Cloudflare Pages or any frontend runtime config.

The GitHub environment variables `STUDENTOS_AI_GROQ_ENABLED`, `STUDENTOS_AI_GEMINI_ENABLED`, `STUDENTOS_AI_NVIDIA_ENABLED`, and `STUDENTOS_AI_POLLINATIONS_ENABLED` are independent emergency kill switches. Router V2 deploys disabled with rollout zero; `STUDENTOS_AI_ROUTER_V2_ENABLED=false` is its immediate rollback.

Azure secret names remain lowercase and hyphen-safe while backend runtime env names remain unchanged. Numbered slots map to `groq-api-key-1` through `groq-api-key-5`, `gemini-api-key-1` through `gemini-api-key-6`, and `nvidia-api-key-1` through `nvidia-api-key-3`. Empty optional secrets are skipped while routing is disabled. If Azure CLI mapping fails, the workflow prints only the safe command category and exit code; raw CLI output is withheld because it may contain secret-bearing command arguments. See [Provider Router V2](./PROVIDER_ROUTER_V2.md) for migration order, registry preflight, staged rollout, and rollback.

The backend loads non-empty numbered keys in `_1` through `_5` order, uses the legacy unnumbered key only when slot one is absent, and deduplicates matching values. Comma-separated key pools are not supported.

For PASS 36.0 production auth gating, these Supabase secrets must exist in the `azure-dev` GitHub environment before rerunning the workflow:

```text
STUDENTOS_SUPABASE_URL_1
STUDENTOS_SUPABASE_ANON_KEY_1
STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_1
STUDENTOS_SUPABASE_URL_2
STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_2
STUDENTOS_SUPABASE_URL_3
STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_3
STUDENTOS_SUPABASE_URL_4
STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_4
STUDENTOS_SUPABASE_JWT_SECRET
```

In addition, the minimum Groq configuration is the single `GROQ_API_KEY`. The recommended production pool is:

```text
GROQ_API_KEY       # same value as GROQ_API_KEY_1 for fallback compatibility
GROQ_API_KEY_1
GROQ_API_KEY_2
GROQ_API_KEY_3
GROQ_API_KEY_4
GROQ_API_KEY_5
```

One non-empty key is enough to deploy. Empty numbered secrets are ignored, and duplicate values are deduplicated by the backend. Never add these names or values to Cloudflare Pages, frontend files, or public runtime configuration.

The workflow sets `STUDENTOS_AI_MODE=auto`, `STUDENTOS_STORAGE_BUCKET`, `STUDENTOS_EXPORT_STORAGE_BUCKET`, and `STUDENTOS_AUTH_REDIRECT_URL` as non-secret Container App env vars.

## Manual Local Deployment Command

PowerShell example after building/pushing an image:

```powershell
$env:GHCR_PULL_TOKEN="<set in local shell only>"
.\infra\azure\deploy-containerapp.ps1 `
  -ResourceGroup rg-studentos-dev `
  -ContainerAppName studentos-api-dev `
  -WorkerContainerAppName studentos-worker-dev `
  -EnvironmentName cae-sentiqgpt-prod `
  -ExistingEnvironmentName cae-sentiqgpt-prod `
  -ExistingEnvironmentResourceGroup rg-sentiqgpt-prod `
  -UseExistingEnvironment $true `
  -Location centralindia `
  -Image ghcr.io/itshim998/studentos-api:<tag> `
  -RegistryUsername itshim998
Remove-Item Env:GHCR_PULL_TOKEN
```

Bash example:

```bash
export AZURE_RESOURCE_GROUP=rg-studentos-dev
export AZURE_CONTAINER_APP_NAME=studentos-api-dev
export AZURE_WORKER_CONTAINER_APP_NAME=studentos-worker-dev
export AZURE_CONTAINER_APP_ENVIRONMENT=cae-sentiqgpt-prod
export AZURE_CONTAINER_APP_ENVIRONMENT_RESOURCE_GROUP=rg-sentiqgpt-prod
export AZURE_USE_EXISTING_CONTAINER_APP_ENVIRONMENT=true
export AZURE_LOCATION=centralindia
export STUDENTOS_IMAGE=ghcr.io/itshim998/studentos-api:<tag>
export REGISTRY_USERNAME=itshim998
export GHCR_PULL_TOKEN='<set in shell only>'
bash infra/azure/deploy-containerapp.sh
unset GHCR_PULL_TOKEN
```

## Health and Config

- `/api/health` is intended to be lightweight and must not call Supabase or AI providers.
- `/api/config` exposes safe public configuration only.
- `/api/status` can include richer operational status and may inspect queue state.

## Worker Strategy

The dedicated `studentos-worker` container uses the API image but overrides startup to `npm run jobs:dev`. It has no ingress and stays at exactly one replica. The API remains independently scale-to-zero. The workflow must confirm the worker image, `npm` command plus `run jobs:dev` args, absent ingress, 1–1 scale, required service-role secret refs, `STUDENTOS_BACKGROUND_WORKERS_ENABLED=true`, recovery false, and `latestRevisionName == latestReadyRevisionName` before the topology passes.

View worker logs without printing environment values:

```powershell
az containerapp logs show --resource-group rg-studentos-dev --name studentos-worker-dev --follow
```

For restart, inspect the failed job and logs first, then create a new worker revision or update/restart the app through the ordinary deployment workflow. Database job claims recover stale `processing` locks after the configured lock timeout, so do not manually duplicate a queued recovery run or background job. A retry reuses its durable run/job and allowance request.

Recovery rollback uses `Adaptive Recovery - Controlled Rollout` with `action=disable` and the exact confirmation `DISABLE-RECOVERY`. It restores the engine and UI flags to `false` and rollout mode to `off` on both apps while preserving additive Recovery tables and immutable versions. A normal deployment also returns both apps to dark. Do not delete migration-002 audit/state records during operational rollback.

## CORS and Domains

Azure production must use an exact CORS allowlist. Do not use wildcard CORS in production.

Required Azure Container App env var:

```text
CORS_ORIGINS=https://studentos.sentiqlabs.com,https://studentos-39s.pages.dev,http://localhost:3101,http://localhost:3102,http://127.0.0.1:3101,http://127.0.0.1:3102
```

Current frontend origins:

- `https://studentos.sentiqlabs.com`
- `https://studentos-39s.pages.dev`

Local development origins remain allowed for direct local testing on ports `3101` and `3102`.

Future API domain options:

- `https://studentos-api.sentiqlabs.com`
- `https://studentos.sentiqlabs.com/api`

Update Google OAuth redirect URIs only after choosing the public API domain.

## Validation

Run before any approved allowlist enablement:

```powershell
npm.cmd run smoke:core
npm.cmd run test:e2e
npm.cmd run test:recovery
npm.cmd run eval:recovery
npm.cmd run migration:plan
npm.cmd run preflight:production
npm.cmd run preflight:azure
npm.cmd run check:syntax
git diff --check
```

The push/pull-request validation workflow runs these static/local gates plus the full test suite on Node 22 and installs Playwright Chromium. It does not deploy and does not run live Supabase verification. Before enablement, run the read-only hardened verifier with `npm.cmd run verify:recovery-schema` and require migrations 001 and 002 to be present on every data shard. Do not reapply a migration merely because verification cannot confirm it.

## First Deploy Checklist

Use `docs/AZURE_FIRST_DEPLOY_CHECKLIST.md` before the first manual deployment. It covers subscription selection, GHCR pull credentials, runtime secret setup, API scale-to-zero, the always-on worker cost, worker inspection/logs/restart, post-deploy verification, rollback, and emergency credit preservation.

## Post-Deploy Verification

After the Container App URL is known, run:

```powershell
$env:STUDENTOS_AZURE_API_URL="https://<container-app-fqdn>"
npm.cmd run verify:azure-deployment
Remove-Item Env:STUDENTOS_AZURE_API_URL
```

The verifier checks `/api/health`, `/api/config`, cold-start timing, safe `deploymentTarget`, configured production AI, and dangerous toggles. A deployment fails verification when `/api/config.aiProviders.configured` is not `true`.

## Cloudflare Frontend Wiring

Cloudflare Pages serves the static frontend. The only public runtime value it needs is the Azure backend API base URL.

Set this Cloudflare Pages environment variable:

```text
STUDENTOS_PUBLIC_API_BASE_URL=https://<azure-backend-fqdn>
```

Current Azure backend FQDN:

```text
STUDENTOS_PUBLIC_API_BASE_URL=https://studentos-api-dev.ashygrass-913d190e.centralindia.azurecontainerapps.io
```

For a dedicated backend API custom domain, use that API origin instead, for example `https://studentos-api.sentiqlabs.com`. Do not set this value to the Cloudflare frontend origin.

Use this Cloudflare Pages build command so `frontend/runtime-config.js` is generated during the frontend deployment:

```bash
npm run cloudflare:build
```

The generated runtime config contains only a public API URL. It must not contain Supabase service-role keys, Google client secrets, model keys, OAuth tokens, or Azure credentials.

Post-deploy browser/API checks:

- `https://studentos.sentiqlabs.com`
- `https://<azure-backend-fqdn>/api/health`
- `https://<azure-backend-fqdn>/api/config`
- `POST https://<azure-backend-fqdn>/api/ai/verb` returns JSON, not HTML.

Optional CORS verification:

```powershell
$env:STUDENTOS_PUBLIC_FRONTEND_URL="https://studentos.sentiqlabs.com"
$env:STUDENTOS_AZURE_API_URL="https://<azure-backend-fqdn>"
npm.cmd run verify:cloudflare-azure
Remove-Item Env:STUDENTOS_PUBLIC_FRONTEND_URL
Remove-Item Env:STUDENTOS_AZURE_API_URL
```
