# Azure First Deploy Checklist

This checklist is for the first manual StudentOS backend deployment to Azure Container Apps. Do not paste secrets into terminals, screenshots, commits, GitHub issues, or chat logs.

## 1. Azure Subscription Selection

1. Sign in locally if using CLI deployment:
   ```powershell
   az login
   ```
2. Confirm the intended subscription:
   ```powershell
   az account show --query "{name:name,id:id,tenant:tenantId}" --output table
   ```
3. Select it explicitly if needed:
   ```powershell
   az account set --subscription "<subscription-id>"
   ```

## 2. Resource Group

Default dev resource group:

```text
rg-studentos-dev
```

Create it in `centralindia` when available, otherwise use `eastus`:

```powershell
az group create --name rg-studentos-dev --location centralindia
```

## 3. Container Apps Environment

The Bicep template reuses the existing environment by default:

```text
cae-sentiqgpt-prod
```

Existing environment resource group: `rg-sentiqgpt-prod`. StudentOS still deploys as its own Container App in `rg-studentos-dev`; this does not share or modify SentIQ Chat / SentIQGPT app secrets or runtime state. No Azure SQL, Azure Storage, or Azure Container Registry is required for the first deployment.

## 4. Container App

Default app:

```text
studentos-api-dev
```

Required scale settings:

- `minReplicas=0`
- `maxReplicas=1`
- external HTTP ingress enabled
- target port `3101`
- smallest safe resources: `0.25` CPU and `0.5Gi` memory


Backend-only image check before deployment:

```powershell
Select-String -Path .dockerignore -Pattern "^frontend/"
Select-String -Path Dockerfile -Pattern "COPY frontend"
```

Expected: `.dockerignore` contains `frontend/`; `Dockerfile` has no `COPY frontend` result. Azure Container Apps serves the backend only. Cloudflare Pages serves the frontend only. Supabase remains the data/auth/storage layer.

## 5. GitHub Actions Manual Workflow

Workflow name:

```text
Azure Container Apps - StudentOS API
```

Workflow file:

```text
.github/workflows/azure-container-apps-studentos.yml
```

It must remain manual-only with `workflow_dispatch`. Do not add automatic `push` or `pull_request` deployment triggers until launch controls are reviewed.

## 6. Required GitHub Repository Secrets

Configure these without values in documentation or commits:

- `AZURE_CREDENTIALS`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`
- `AZURE_CONTAINER_APP_NAME`
- `AZURE_CONTAINER_APP_ENVIRONMENT`
- `AZURE_CONTAINER_APP_ENVIRONMENT_RESOURCE_GROUP`
- `AZURE_LOCATION`
- `GHCR_PULL_TOKEN`
- `GROQ_API_KEY`

For the minimum configuration, add `GROQ_API_KEY` to the `azure-dev` GitHub environment. For the recommended pool, set `GROQ_API_KEY` to the same value as `GROQ_API_KEY_1`, then add `GROQ_API_KEY_1` through `GROQ_API_KEY_5`. The workflow accepts any one of these Groq secrets, maps only non-empty values, and does not require all five numbered keys. `POLLINATIONS_API_KEY` remains optional.

Do not comma-separate values in `GROQ_API_KEY`; `GROQ_API_KEYS` is not supported. Groq secrets are backend-only Azure secrets and must never be added to Cloudflare Pages or public frontend configuration.

The workflow keeps runtime env names uppercase but maps them to lowercase ACA secret refs such as `GROQ_API_KEY_1=secretref:groq-api-key-1`. An unset optional provider secret must be skipped; it must not stop the mapping step. Mapping failures report only `containerapp_secret_set` or `containerapp_env_update` plus the Azure CLI exit code.

Safer future option: replace long-lived `AZURE_CREDENTIALS` with Azure OIDC/federated credentials and update `azure/login` to use `client-id`, `tenant-id`, and `subscription-id`.

## 7. GHCR Pull Credentials

The workflow pushes the Docker image to GHCR. If the GHCR package is private, Azure Container Apps needs pull credentials.

Recommended first-pass strategy:

1. Create a minimal GitHub token that can read packages.
2. Store it as `GHCR_PULL_TOKEN` in GitHub Secrets for workflow deployment.
3. For local CLI deployment, set it only in the current shell as `GHCR_PULL_TOKEN`.
4. Let the Bicep template store it as an Azure Container Apps registry secret.

Do not make the repository public for this. Do not bake the token into the Docker image.

## 8. Azure Runtime Secret Setup

Use `infra/azure/containerapp-secrets.example.ps1` as a placeholder-only guide.

Runtime secrets and env vars belong in Azure Container Apps, not in the image and not in GitHub source.

## 9. Post-Deploy Health Checks

After deployment, set the backend URL locally:

```powershell
$env:STUDENTOS_AZURE_API_URL="https://<container-app-fqdn>"
npm.cmd run verify:azure-deployment
Remove-Item Env:STUDENTOS_AZURE_API_URL
```

Expected checks:

- `GET /api/health` returns `ok: true`
- `GET /api/config` returns safe public config
- config reports `deploymentTarget: azure-container-apps`
- config reports `aiProviders.configured: true`
- no dangerous toggles are enabled
- no secrets appear in responses

## 10. Cloudflare Frontend Wiring

Cloudflare Pages is the frontend target. Azure Container Apps remains API-only.

Set the Cloudflare Pages environment variable:

```text
STUDENTOS_PUBLIC_API_BASE_URL=https://<azure-backend-fqdn>
```

Current Azure backend FQDN:

```text
STUDENTOS_PUBLIC_API_BASE_URL=https://studentos-api-dev.ashygrass-913d190e.centralindia.azurecontainerapps.io
```

If a dedicated backend API custom domain is configured, use that API origin instead, for example `https://studentos-api.sentiqlabs.com`. Never point this value at `https://studentos.sentiqlabs.com` or `https://studentos-39s.pages.dev`.

Use this Cloudflare Pages build command to generate the public runtime config:

```bash
npm run cloudflare:config
```

Set the Azure Container App CORS allowlist env var:

```text
CORS_ORIGINS=https://studentos.sentiqlabs.com,https://studentos-39s.pages.dev,http://localhost:3101,http://localhost:3102,http://127.0.0.1:3101,http://127.0.0.1:3102
```

Post-deploy checks:

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

## 11. Rollback and Scale-to-Zero

Scale to zero while keeping the app:

```powershell
az containerapp update --resource-group rg-studentos-dev --name studentos-api-dev --min-replicas 0 --max-replicas 1
```

Disable ingress in an incident:

```powershell
az containerapp ingress disable --resource-group rg-studentos-dev --name studentos-api-dev
```

Delete the dev app:

```powershell
az containerapp delete --resource-group rg-studentos-dev --name studentos-api-dev --yes
```

## 12. Emergency Credit Preservation

If unexpected cost appears:

1. Disable ingress.
2. Confirm min replicas is 0.
3. Delete old revisions if needed.
4. Delete the dev Container App if traffic continues.
5. Delete the dev resource group only if it contains no shared resources.
6. Check Azure Cost Management and budget alerts.
