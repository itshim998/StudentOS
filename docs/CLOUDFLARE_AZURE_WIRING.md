# StudentOS Cloudflare To Azure Wiring

StudentOS production uses Cloudflare Pages for the static frontend and Azure Container Apps for the backend API. The frontend must not call `/api/*` on the Cloudflare origin.

## Required Cloudflare Pages Config

Set this Cloudflare Pages environment variable:

```text
STUDENTOS_PUBLIC_API_BASE_URL=https://studentos-api-dev.ashygrass-913d190e.centralindia.azurecontainerapps.io
```

Use the Azure Container Apps FQDN above unless a dedicated backend API custom domain is configured later. Do not set this to:

```text
https://studentos.sentiqlabs.com
https://studentos-39s.pages.dev
```

Cloudflare Pages build command:

```bash
npm run cloudflare:config
```

That command writes `frontend/runtime-config.js` with only the public API origin. It must not contain Supabase service-role keys, provider keys, OAuth secrets, Azure credentials, or tokens.

## Required Cloudflare Pages Routes

The checked-in `frontend/_redirects` file rewrites the Supabase Auth completion URL:

```text
/auth/complete /auth-complete 200
/auth/complete/ /auth-complete 200
```

Keep the Supabase Auth redirect URL as `https://studentos.sentiqlabs.com/auth/complete`. Cloudflare Pages should serve the styled `auth-complete` page from that route after a normal Pages redeploy; no dashboard redirect rule or secret change is required.

## Required Azure CORS Config

Set this Azure Container App environment variable:

```text
CORS_ORIGINS=https://studentos.sentiqlabs.com,https://studentos-39s.pages.dev,http://localhost:3101,http://localhost:3102,http://127.0.0.1:3101,http://127.0.0.1:3102
```

This is an environment variable, not a secret. Do not use wildcard CORS in production.

## Required Azure Backend Mode

Production should use:

```text
STUDENTOS_MODE=supabase
STUDENTOS_DEPLOYMENT=azure-container-apps
STUDENTOS_SERVE_FRONTEND=false
```

On public frontend hosts (`studentos.sentiqlabs.com` and `studentos-39s.pages.dev`), the frontend must not fall back to a local demo account when `/api/config` reports auth unavailable. Before the Azure backend secrets are mapped, signed-out users should see a sign-in/configuration-unavailable shell instead of `demo@studentos.local`.

The GitHub Actions environment `azure-dev` must contain these backend-only secret names so the `Azure Container Apps - StudentOS API` workflow can map them into Azure Container Apps secret refs:

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

Keep service-role keys backend-only in GitHub Actions and Azure Container Apps. They are not Cloudflare Pages variables and must never appear in `frontend/runtime-config.js`.

The workflow also sets these non-secret runtime values on the Container App:

```text
STUDENTOS_STORAGE_BUCKET=studentos-source-materials
STUDENTOS_EXPORT_STORAGE_BUCKET=studentos-data-exports
STUDENTOS_AUTH_REDIRECT_URL=https://studentos.sentiqlabs.com/auth/complete
```

As of Pass 36.0 diagnosis, Cloudflare runtime config points to the Azure backend correctly, but live Azure `/api/config` reports `mock` until the Supabase URL/key/JWT variables above are mapped into the running Container App.

## Post-Deploy Verification

Set the backend URL locally:

```powershell
$env:STUDENTOS_AZURE_API_URL="https://studentos-api-dev.ashygrass-913d190e.centralindia.azurecontainerapps.io"
```

Run:

```powershell
npm.cmd run verify:cloudflare-azure
```

The verifier checks:

- `https://studentos.sentiqlabs.com` loads.
- Azure `/api/health` returns JSON.
- Azure `/api/config` returns JSON with `deploymentTarget: azure-container-apps`.
- CORS allows `https://studentos.sentiqlabs.com`.
- `/api/ai/verb` returns JSON, not Cloudflare HTML.
- The backend reports `frontendServedByBackend: false`.

After adding or updating GitHub secrets, manually rerun GitHub Actions workflow `Azure Container Apps - StudentOS API` on `main`, then verify `https://studentos.sentiqlabs.com/` shows the public login/signup shell for signed-out users and does not show `Demo session` or `demo@studentos.local`.

Cleanup:

```powershell
Remove-Item Env:STUDENTOS_AZURE_API_URL
```
