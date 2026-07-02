# Azure Container Apps Deployment Readiness

StudentOS backend is prepared for Azure Container Apps Consumption. This pass does not deploy automatically.

## Target Architecture

- Backend: Azure Container Apps Consumption, API-only image
- Image registry: GHCR, to avoid Azure Container Registry cost
- Database/Auth/Storage: existing Supabase projects and private buckets
- Frontend: Cloudflare Pages, deployed separately from this backend image
- Min replicas: 0
- Max replicas: 1
- Ingress: external HTTP ingress
- Workers: not always-on in the web container
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
- StudentOS Container App name: `studentos-api-dev`
- Region: `centralindia`

This does not merge app secrets, runtime state, images, revisions, scaling, or traffic. StudentOS remains a separate Container App with its own runtime environment variables and secrets. Do not modify the SentIQ Chat / SentIQGPT app or its secrets when deploying StudentOS.

## GitHub Actions Workflow

Workflow name: `Azure Container Apps - StudentOS API`

The workflow is manual-only:

```yaml
on:
  workflow_dispatch:
```

It builds a Docker image, pushes it to GHCR, and deploys/updates the Container App with min replicas 0 and max replicas 1.

## Required GitHub Secrets

Do not commit values. Configure these in GitHub repository secrets or environment secrets:

- `AZURE_CREDENTIALS`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`
- `AZURE_CONTAINER_APP_NAME`
- `AZURE_CONTAINER_APP_ENVIRONMENT`
- `AZURE_CONTAINER_APP_ENVIRONMENT_RESOURCE_GROUP`
- `AZURE_LOCATION`
- `GHCR_PULL_TOKEN`

`GHCR_PULL_TOKEN` should be a low-scope token with package read access so Azure Container Apps can pull the private GHCR image after the workflow finishes. The workflow uses `GITHUB_TOKEN` only to push the image during the workflow run.

OIDC/federated identity can replace `AZURE_CREDENTIALS` later. If using OIDC, update the workflow to pass `client-id`, `tenant-id`, and `subscription-id` to `azure/login` instead of `creds`.

## Azure Runtime Environment Variables

Configure these on the Container App as env vars or secret refs. Do not bake them into the image and do not pass them as Docker build args.

Non-secret runtime values:

- `NODE_ENV=production`
- `PORT=3101`
- `STUDENTOS_PORT=3101`
- `STUDENTOS_ENV=production`
- `STUDENTOS_DEPLOYMENT=azure-container-apps`
- `STUDENTOS_SERVE_FRONTEND=false`
- `STUDENTOS_MODE=supabase`
- `STUDENTOS_BACKGROUND_WORKERS_ENABLED=false`
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
- `STUDENTOS_STORAGE_BUCKET`
- `STUDENTOS_EXPORT_STORAGE_BUCKET`
- `STUDENTOS_GOOGLE_CLASSROOM_OAUTH_STATE_SECRET` if Classroom OAuth is later enabled
- `STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET` if Classroom OAuth is later enabled
- `GOOGLE_CLIENT_ID` if Classroom OAuth is later enabled
- `GOOGLE_CLIENT_SECRET` if Classroom OAuth is later enabled
- `GOOGLE_REDIRECT_URI` if Classroom OAuth is later enabled
- `GROQ_API_KEY` is required for the production Ask StudentOS route
- `GROQ_API_KEY_2` through `GROQ_API_KEY_5` are optional rotation keys
- `POLLINATIONS_API_KEY` if Pollinations paid/authenticated mode is enabled
- `STUDENTOS_EMBEDDING_API_KEY` if real embeddings are enabled
- billing provider secrets only after a billing launch review
- operator/internal/deletion secrets only after an internal-ops launch review

The `Azure Container Apps - StudentOS API` GitHub Actions workflow validates and maps the required Supabase values and primary `GROQ_API_KEY` into Azure Container Apps as backend-only secret refs after the Bicep deployment. Optional Groq rotation keys and Pollinations are mapped only when present. Missing required secret names cause the workflow to fail before deployment output is shown. Provider and service-role keys stay in GitHub Actions and Azure Container Apps only; do not add them to Cloudflare Pages or any frontend runtime config.

For PASS 36.0 production auth gating, these `azure-dev` GitHub environment secrets must exist before rerunning the workflow:

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
GROQ_API_KEY
```

The workflow sets `STUDENTOS_AI_MODE=auto`, `STUDENTOS_STORAGE_BUCKET`, `STUDENTOS_EXPORT_STORAGE_BUCKET`, and `STUDENTOS_AUTH_REDIRECT_URL` as non-secret Container App env vars.

## Manual Local Deployment Command

PowerShell example after building/pushing an image:

```powershell
$env:GHCR_PULL_TOKEN="<set in local shell only>"
.\infra\azure\deploy-containerapp.ps1 `
  -ResourceGroup rg-studentos-dev `
  -ContainerAppName studentos-api-dev `
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

Do not run background workers in the web Container App for the first Azure deployment. The backend boots without a worker.

Future option: Azure Container Apps Jobs for manual or scheduled jobs. Keep jobs disabled by default until reviewed.

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

Run before enabling the manual workflow:

```powershell
npm.cmd run smoke:core
npm.cmd run test:e2e
npm.cmd run test:e2e:supabase
npm.cmd run preflight:production
npm.cmd run preflight:azure
node --check backend/server.js
node --check frontend/scripts/app.js
```

## First Deploy Checklist

Use `docs/AZURE_FIRST_DEPLOY_CHECKLIST.md` before the first manual deployment. It covers subscription selection, GHCR pull credentials, runtime secret setup, post-deploy verification, rollback, scale-to-zero, and emergency credit preservation.

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
npm run cloudflare:config
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
