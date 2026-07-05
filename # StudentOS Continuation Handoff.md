# StudentOS Continuation Handoff

## 0. Product context

**StudentOS** is being built as a **production-grade SaaS**, not a hackathon-only demo. It is positioned as an AI-native academic operating system for students, powered by the SentIQ/SentIQGPT/SentIQ Chat ecosystem.

StudentOS is separate from SentIQ Chat. SentIQ Chat/SentIQGPT must stay read-only unless explicitly instructed otherwise.

Current positioning:

```text
StudentOS = AI-native student operating system
SentIQ Chat / SentIQGPT = parent AI brain/ecosystem
Supabase = auth + sharded data + storage
Cloudflare Pages = frontend hosting
Azure Container Apps = backend API hosting
```

The user’s local StudentOS path is:

```text
C:\Users\Sounak\Desktop\Flagship AI projects\StudentOS
```

The GitHub repository is:

```text
https://github.com/itshim998/StudentOS
```

Repo visibility: **private**
Main branch: **main**

---

## 1. Current architecture decisions

### Final chosen deployment architecture

```text
Cloudflare Pages
  → StudentOS frontend only

Azure Container Apps
  → StudentOS backend API only
  → scale-to-zero
  → no frontend inside Docker image
  → no always-on worker for first deployment

Supabase
  → Auth project
  → 3 data shards
  → private source/export buckets
  → storage, RAG source files, user data

GitHub Actions
  → builds backend Docker image
  → pushes to GHCR
  → deploys Azure Container App manually via workflow_dispatch
```

### Major architecture choices

1. **Frontend and backend are split**

   * Frontend goes to **Cloudflare Pages**.
   * Backend goes to **Azure Container Apps**.
   * The frontend should not be copied into the Azure Docker image.

2. **Azure must be cost-protected**

   * Use Azure Container Apps Consumption.
   * `minReplicas = 0`
   * `maxReplicas = 1`
   * no warmup pinger
   * no always-on worker
   * no Azure SQL
   * no Azure Storage duplication
   * no Azure Container Registry if GHCR works

3. **Supabase remains source of truth**

   * No migration to Azure SQL/Postgres.
   * No Azure storage for StudentOS app data.
   * Supabase Auth + sharded data + buckets remain.

4. **Azure Container App should share existing ACA environment**

   * Azure for Students subscription allows only **one Container Apps Environment in Central India**.
   * Existing SentIQ Chat ACA environment already exists:

     ```text
     cae-sentiqgpt-prod
     ```
   * Existing environment resource group:

     ```text
     rg-sentiqgpt-prod
     ```
   * StudentOS should be a separate Container App:

     ```text
     studentos-api-dev
     ```
   * StudentOS resource group:

     ```text
     rg-studentos-dev
     ```
   * Region:

     ```text
     centralindia
     ```

Azure Container Apps supports scaling with min/max replicas, and secrets can be stored as Container App secrets and referenced from environment variables. ([Microsoft Learn][1]) GitHub Actions workflows with `workflow_dispatch` can be run manually from the Actions tab. ([GitHub Docs][2])

---

## 2. Supabase/auth/data-shard setup

### Supabase project architecture

The user created **4 Supabase projects**:

```text
1. Auth Project
   - Authentication only
   - Users, sessions, identities, login/signup/password reset

2. Data Shard 1
   - StudentOS user/application data

3. Data Shard 2
   - StudentOS user/application data

4. Data Shard 3
   - StudentOS user/application data
```

The design separates authentication from data storage and routes users to one of three data shards using stable user-id hashing.

### Confirmed Supabase mode

StudentOS has already successfully run in:

```text
STUDENTOS_MODE=supabase
```

Earlier live local tests confirmed that a test user routed to:

```text
data-shard-2 / Project 3
```

### Data shard tables verified earlier

The three data shards had matching schema with tables including:

```text
student_profiles
courses
topics
syllabi
exams
assignments
timetable_events
notes
source_materials
test_sessions
test_results
credit_ledger
roadmap_items
revision_events
tutor_lessons
assignment_automation_contracts
audit_logs
ai_conversations
ai_messages
memory_items
embeddings_metadata
source_chunks
background_jobs
job_events
classroom connector/token/sync tables
export/deletion/account lifecycle tables
billing tables
operator/security tables
```

### Supabase storage buckets

Created on all 3 data shards:

```text
studentos-source-materials
studentos-data-exports
```

Both are private.

`studentos-source-materials`:

* private
* used for uploaded study materials
* supports PDF/TXT/MD/DOC/DOCX/PPT/PPTX depending on current ingestion support

`studentos-data-exports`:

* private
* used for account export packages

---

## 3. Completed passes and what each added

### Pass 0 — Discovery/safety map

* Read-only discovery of SentIQGPT and StudentOS direction.
* Established that StudentOS is separate from SentIQGPT.
* SentIQGPT must remain untouched.

### Pass 1 — Standalone StudentOS foundation

* Built basic pure HTML/CSS/JS app.
* Local backend on `localhost:3101`.
* Mock backend initially.
* Added:

  * Today
  * Setup
  * Courses
  * Memory
  * Studio
  * Account
  * AI verbs layout
  * assignment contract policy
  * credit/domain policy
  * mock Classroom connector

### Pass 2 — Learning loop

* Added Ask/Plan/Make/Review logic.
* Added assignment coverage detection:

  * covered
  * partial
  * uncovered
* Added assignment-to-learning routing:

  * covered → practice/test
  * partial → quick revision + test
  * uncovered → mastery roadmap
* Added MCQ scoring and credit system.
* Added correction sheets, weak topics, tutor lessons.

### Pass 3 — Supabase scaffolding

* Added Supabase clients/router/repository boundary.
* Added env templates.
* Added migration drafts for auth metadata and data shard schema.

### Pass 4 — Real Supabase mode

* Enabled real Supabase persistence mode.
* Verified data shards and routing.
* Verified endpoints:

  * `/api/config`
  * `/api/bootstrap`
  * `/api/tests/score`
  * `/api/assignment-contract`
  * `/api/ai/verb`

### Pass 5 — Private source upload

* Added source upload foundation.
* Added private storage upload/delete.
* Added source metadata.
* Added initial retrieval over uploaded sources.
* Endpoint:

  ```text
  POST /api/sources/upload
  DELETE /api/sources/:id
  ```

### Pass 6 — Source chunks

* Added extraction status flow.
* Added chunking.
* Added `source_chunks`.
* Added citation/snippet display.
* Migration:

  ```text
  pass6_source_chunks.sql
  ```

### Pass 7 — Real PDF extraction + AI provider layer

* Added `pdf-parse` extraction.
* TXT/MD supported.
* DOC/DOCX/PPT/PPTX placeholders/scaffolds.
* AI provider layer:

  * Groq primary
  * Pollinations fallback
  * mock fallback
* Frontend shows provider/model/retrieval metadata.

### Pass 8 — Embeddings + hybrid retrieval

* Deterministic mock embeddings by default.
* Optional real embedding provider scaffold.
* Hybrid retrieval:

  * keyword
  * semantic
  * course/topic
  * recency
  * source confidence
* Added pgvector-ready migration.

### Pass 9 — RPC retrieval

* Added shard RPC:

  ```text
  match_source_chunks(...)
  ```
* Retrieval modes:

  ```text
  rpc-vector
  rpc-json
  local-json
  keyword-fallback
  ```
* Added citation validation to remove invented citations.
* Endpoint:

  ```text
  POST /api/embeddings/reindex
  ```

### Pass 10 — Background jobs

* Added `background_jobs`.
* Added job lifecycle:

  * queued
  * processing
  * completed
  * failed
  * cancelled
* Jobs:

  * source ingestion
  * source reindex
  * embedding reindex
* Worker command:

  ```text
  npm run jobs:work
  ```

### Pass 11 — Job claiming + private download

* Added `claim_next_background_job(...)` RPC.
* Added SKIP LOCKED claiming.
* Added stale lock recovery.
* Worker re-downloads private bytes and reprocesses idempotently.
* Added queue health endpoint:

  ```text
  GET /api/jobs/health
  ```

### Pass 12 — Worker daemon + hard delete + OCR scaffold

* Added dev worker daemon:

  ```text
  npm run jobs:dev
  ```
* Added job events/logs.
* Added source hard delete script/endpoint.
* Added scanned PDF `needs_ocr` marker.

### Pass 13 — Onboarding + academic profile

* Added setup wizard.
* Captures:

  * stream/class
  * subjects
  * exams
  * timetable
  * weak topics
  * academic goals
* Added personalized roadmap.
* Added demo seed endpoint.

### Pass 14 — Production SaaS foundation

* Added environment strategies:

  * dev
  * staging
  * prod
* Added production preflight.
* Added CORS/rate-limit/quota scaffolds.
* Added redacted logs/request IDs.
* Added role/plan/quota scaffold.
* Added production docs and security checklist.

### Pass 15 — SentIQ ecosystem UI + account management

* Added dark premium SentIQ-style UI.
* Account view.
* Password reset scaffold.
* Consent preferences.
* Data export/deletion request scaffolds.
* Plan/quota display.

### Pass 16 — Billing/entitlement foundation

* Added billing adapters:

  * none
  * mock
  * Razorpay
  * Stripe
  * Paddle
* Added billing tables and routes.
* Real charges disabled.

### Pass 17 — Identity/consent/export/deletion lifecycle

* Added `/auth/complete`.
* Added legal/consent tables.
* Added data export requests/jobs.
* Added account deletion request flow.
* Added role invitations.

### Pass 18 — Export worker + secure download + deletion dry-run

* Added export worker.
* Added export download endpoint:

  ```text
  GET /api/account/exports/:requestId/download
  ```
* Added deletion dry-run.

### Pass 19 — Export verification + operator review + cleanup

* Added live export verifier.
* Added operator review console scaffold.
* Operator disabled/404 by default.
* Added export cleanup.

### Pass 20 — Final deletion safety

* Final deletion disabled by default:

  ```text
  STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED=false
  STUDENTOS_AUTH_ADMIN_DELETE_ENABLED=false
  ```
* Added two-operator approval design.
* Added billing cancellation blocker.
* Added immutable evidence.

### Pass 21 — Operator RBAC + monitoring + billing cancellation safety

* Added operator roles:

  * owner
  * support_admin
  * privacy_reviewer
  * billing_operator
  * read_only_auditor
* Added operator session TTL.
* Added monitoring endpoint.
* Added billing cancellation events.

### Pass 22 — Operator MFA scaffold + billing reconciliation

* Added TOTP/phone-ready MFA scaffold.
* Added sensitive permission gates.
* Added session version rotation.
* Added billing reconciliation mapping.

### Pass 23 — Google Classroom read-only connector

* Added Google Classroom connector:

  * mock
  * OAuth scaffold
  * API client/mapper/sync/token metadata
* Routes:

  * status
  * connect
  * callback
  * disconnect
  * sync
* No write scopes/actions.

### Pass 24 — Persistent Google Classroom tokens + sync history

* Added encrypted token persistence.
* Added token refresh/reconnect handling.
* Added sync history.
* Env added:

  ```text
  STUDENTOS_GOOGLE_CLASSROOM_TOKEN_ENCRYPTION_SECRET
  STUDENTOS_GOOGLE_CLASSROOM_TOKEN_KEY_ID
  STUDENTOS_GOOGLE_CLASSROOM_DRIVE_METADATA_ENABLED=false
  ```

### Pass 24.5 — Live OAuth scope alignment

* Aligned Classroom scopes to Google Cloud configured set.
* Added verifier:

  ```text
  npm.cmd run verify:classroom-live
  ```
* OAuth browser test eventually passed.

### Pass 25 — Classroom sync reliability

* Hardened Classroom sync.
* Imported Classroom assignments now connect to learning flows.
* Added error handling for:

  * expired/revoked token
  * insufficient scope
  * quota/rate limits
* Added tests.

### Pass 25.1 — Assignment-flow runtime crash fix

* Fixed crash:

  ```text
  Cannot read properties of undefined (reading 'push')
  ```
* Cause: Supabase/Classroom-persisted states could omit runtime arrays.
* Added normalization.
* Frontend no longer stuck on “Checking coverage...”.

### Pass 26 — Classroom import UX polish

* Improved Classroom import status.
* Added badges and safe error UI.
* Added QA doc.
* Confirmed no write scopes/actions.

### Pass 27 — Production QA bug bash

* Added smoke test:

  ```text
  npm.cmd run smoke:core
  ```
* Added QA checklist.
* Hardened source upload response.
* Fixed `/api/config` pass label.

### Pass 28 — Browser E2E harness

* Added Playwright.
* Commands:

  ```text
  npm.cmd run test:e2e
  npm.cmd run test:e2e:headed
  ```
* Covered:

  * navigation
  * onboarding
  * upload
  * AI verbs
  * assignment-flow
  * Classroom mock
  * account/export
  * billing UI

### Pass 29 — Live Supabase-backed E2E

* Added optional live Supabase E2E:

  ```text
  npm.cmd run test:e2e:supabase
  ```
* Only runs with:

  ```text
  STUDENTOS_E2E_SUPABASE_LIVE=true
  ```
* Disposable Supabase user.
* Verifies data lands on exactly one shard.
* Auth user deletion disabled by default.

### Pass 29.1 — Live E2E upload stuck fix

* Fixed live Supabase source upload stuck on:

  ```text
  Uploading to private source library...
  ```
* Added timeouts/fail-fast for:

  * multipart parsing
  * extraction
  * storage upload
  * chunk/embed
  * persistence
* Fixed AI/export stuck states too.
* Live Supabase E2E passed.

### Pass 30 — GitHub repo creation and safe initial push

* Created private repo:

  ```text
  https://github.com/itshim998/StudentOS
  ```
* Branch:

  ```text
  main
  ```
* Commit:

  ```text
  fea991079b9e2e30addca226c2279ae38769c18c
  ```
* Added hardened `.gitignore`, `.dockerignore`, README.
* Confirmed `.env` not committed.
* Safe env templates only:

  ```text
  .env.example
  .env.template
  ```

### Pass 31 — Azure Container Apps deployment readiness

* Commit:

  ```text
  a996c6cbfc8ee13886ae1c4a7b801deff770c258
  ```
* Added:

  * Dockerfile
  * `.dockerignore`
  * Azure workflow
  * Bicep infra
  * deployment scripts
  * Azure docs
  * cost saver runbook
  * `preflight:azure`
* Architecture:

  * Azure Container Apps
  * min 0 / max 1
  * GHCR image
  * no ACR
  * no worker
  * no frontend intended

### Pass 32 — Azure first deployment verification

* Commit:

  ```text
  8f6f124fd865823437d085ef1b2dd8f5741574c2
  ```
* Added:

  * `docs/AZURE_FIRST_DEPLOY_CHECKLIST.md`
  * `infra/azure/containerapp-secrets.example.ps1`
  * `scripts/verifyAzureDeployment.js`
  * `npm.cmd run verify:azure-deployment`
* Added GitHub Actions deployment workflow manual-only.
* Added deployment target reporting:

  ```text
  STUDENTOS_DEPLOYMENT=azure-container-apps
  ```

### Pass 31.1 — Exclude frontend from Azure backend image

This pass was **implemented locally but not committed/pushed by Codex** due to Codex usage/approval limit.

User then manually committed/pushed it.

Changes included:

* `.dockerignore`: added:

  ```text
  frontend/
  ```
* Dockerfile: removed:

  ```text
  COPY frontend ./frontend
  ```
* `backend/server.js`: added:

  ```text
  STUDENTOS_SERVE_FRONTEND=false
  ```

  for Azure backend-only mode.
* `infra/azure/containerapp.bicep`: adds:

  ```text
  STUDENTOS_SERVE_FRONTEND=false
  ```
* preflight now fails if Dockerfile copies frontend or `.dockerignore` does not exclude frontend.

Purpose:

```text
Azure = backend only
Cloudflare = frontend only
Supabase = DB/Auth/Storage
```

---

## 4. Current Azure/GitHub deployment issue and latest state

### Current deployment state

Cloudflare Pages frontend preview has been deployed:

```text
https://studentos-39s.pages.dev
```

Azure backend deployment is **not yet successful**.

GitHub repo secrets are already added:

```text
AZURE_CONTAINER_APP_ENVIRONMENT
AZURE_CONTAINER_APP_NAME
AZURE_CREDENTIALS
AZURE_LOCATION
AZURE_RESOURCE_GROUP
AZURE_SUBSCRIPTION_ID
GHCR_PULL_TOKEN
```

GitHub Actions workflow exists:

```text
Azure Container Apps - StudentOS API
.github/workflows/azure-container-apps-studentos.yml
```

The workflow is manual-only via `workflow_dispatch`.

### First Azure issue: region disallowed

Initial deployments to `eastus` or mismatched region failed with:

```text
RequestDisallowedByAzure
This policy maintains a set of best available regions...
```

The user deleted and recreated:

```text
rg-studentos-dev
```

in:

```text
centralindia
```

Then refreshed Azure credentials/service principal role scope.

### Second Azure issue: max one ACA environment in Central India

Current latest error from GitHub Actions:

```text
InvalidTemplateDeployment
ValidationForResourceFailed
MaxNumberOfRegionalEnvironmentsInSubExceeded
The subscription cannot have more than 1 Container App Environments in Central India.
```

Meaning:

* The Azure for Students subscription already has one Container Apps Environment in Central India:

  ```text
  cae-sentiqgpt-prod
  ```
* Existing environment resource group:

  ```text
  rg-sentiqgpt-prod
  ```
* Current workflow is trying to create another environment:

  ```text
  cae-studentos-dev
  ```
* That is disallowed.

### Correct next architectural fix

Do **not** delete SentIQ Chat resources.

Update StudentOS deployment to reuse the existing Container Apps Environment:

```text
Existing ACA environment: cae-sentiqgpt-prod
Existing ACA environment resource group: rg-sentiqgpt-prod
StudentOS resource group: rg-studentos-dev
StudentOS Container App: studentos-api-dev
Location: centralindia
```

StudentOS should still be a separate Container App, but it should point to the existing environment.

### Required next Codex prompt

Use this next:

```text
PASS 32.2 — Reuse Existing Azure Container Apps Environment for StudentOS

Continue inside StudentOS only. Keep SentIQ Chat / SentIQGPT read-only. Do not expose secrets.

Problem:
GitHub Actions deployment fails with:
MaxNumberOfRegionalEnvironmentsInSubExceeded
“The subscription cannot have more than 1 Container App Environments in Central India.”

Existing Azure resources:
- Existing SentIQ Chat Container Apps Environment: cae-sentiqgpt-prod
- Existing environment resource group: rg-sentiqgpt-prod
- StudentOS resource group: rg-studentos-dev
- StudentOS Container App name: studentos-api-dev
- Region: centralindia

Goal:
Update Azure deployment so StudentOS reuses the existing Container Apps Environment instead of creating a new one.

Required:
1. Update infra/azure/containerapp.bicep:
   - Do not create a new Microsoft.App/managedEnvironments resource when an existing environment is supplied.
   - Add parameter:
     existingEnvironmentName
     existingEnvironmentResourceGroup
     useExistingEnvironment=true
   - Reference existing environment by resource ID.
   - Create/update only the StudentOS Container App.
   - Keep minReplicas=0 and maxReplicas=1.
   - Keep target port 3101.
   - Keep STUDENTOS_SERVE_FRONTEND=false.
   - Do not modify SentIQ Chat app or its secrets.

2. Update GitHub Actions workflow:
   - Support AZURE_CONTAINER_APP_ENVIRONMENT_RESOURCE_GROUP.
   - Use existing environment if provided.
   - Do not attempt to create cae-studentos-dev.
   - Keep manual workflow_dispatch only.

3. Update deploy scripts:
   - PowerShell and Bash should support existing environment name/resource group.
   - Refuse unsafe missing values.
   - Print safe summary only.

4. Update docs:
   - StudentOS uses Azure backend only.
   - Frontend remains Cloudflare.
   - Supabase remains DB/Auth/Storage.
   - StudentOS reuses existing ACA environment due Azure for Students quota.
   - This does not merge app secrets or runtime state.
   - Document required GitHub secret:
     AZURE_CONTAINER_APP_ENVIRONMENT_RESOURCE_GROUP=rg-sentiqgpt-prod

5. Update preflight:azure:
   - Pass when using existing ACA environment.
   - Fail if workflow still tries to create a second environment in Central India.

6. Run:
   npm.cmd run preflight:azure
   npm.cmd run preflight:production
   node --check backend/server.js
   node --check frontend/scripts/app.js

7. Commit and push:
   chore: reuse existing Azure Container Apps environment

End with:
- files changed
- commit hash
- exact GitHub secrets to update
- confirmation no new ACA environment will be created
- confirmation StudentOS remains separate Container App
- confirmation no secrets exposed
- confirmation SentIQ Chat/SentIQGPT unchanged
```

Recommended Codex settings:

```text
Intelligence: High
Goal Mode: OFF
Plan Mode: OFF
```

---

## 5. Important commands, secrets, names, and values

### Local path

```powershell
C:\Users\Sounak\Desktop\Flagship AI projects\StudentOS
```

### GitHub repo

```text
https://github.com/itshim998/StudentOS
```

### Cloudflare frontend

Preview URL:

```text
https://studentos-39s.pages.dev
```

Frontend future custom domain:

```text
studentos.sentiqlabs.com
```

Do not attach custom domain yet until Azure backend + CORS + API URL wiring are finalized.

### Azure resources

Existing SentIQ Chat resource group:

```text
rg-sentiqgpt-prod
```

Existing SentIQ Chat Container Apps Environment:

```text
cae-sentiqgpt-prod
```

Existing SentIQ Chat Container App:

```text
sentiqgpt-backend
```

StudentOS resource group:

```text
rg-studentos-dev
```

StudentOS Container App name:

```text
studentos-api-dev
```

StudentOS should reuse:

```text
cae-sentiqgpt-prod
```

Location:

```text
centralindia
```

### GitHub Actions secrets already added

```text
AZURE_CONTAINER_APP_ENVIRONMENT
AZURE_CONTAINER_APP_NAME
AZURE_CREDENTIALS
AZURE_LOCATION
AZURE_RESOURCE_GROUP
AZURE_SUBSCRIPTION_ID
GHCR_PULL_TOKEN
```

Need to add after Pass 32.2:

```text
AZURE_CONTAINER_APP_ENVIRONMENT_RESOURCE_GROUP=rg-sentiqgpt-prod
```

Need to update:

```text
AZURE_CONTAINER_APP_ENVIRONMENT=cae-sentiqgpt-prod
AZURE_LOCATION=centralindia
AZURE_RESOURCE_GROUP=rg-studentos-dev
AZURE_CONTAINER_APP_NAME=studentos-api-dev
```

### Azure service principal refresh

If resource group was deleted/recreated, refresh Azure credentials:

```bash
az account show --query "{subscriptionId:id, name:name}" -o table
```

Then:

```bash
az ad sp create-for-rbac \
  --name studentos-github-deploy \
  --role contributor \
  --scopes /subscriptions/<SUBSCRIPTION_ID>/resourceGroups/rg-studentos-dev \
  --json-auth
```

Update GitHub secret:

```text
AZURE_CREDENTIALS
```

If using existing SentIQ ACA environment, the service principal may also need Reader access to the existing environment resource group:

```bash
az role assignment create \
  --assignee <clientId-from-AZURE_CREDENTIALS-json> \
  --role Reader \
  --scope /subscriptions/<SUBSCRIPTION_ID>/resourceGroups/rg-sentiqgpt-prod
```

If deployment needs to join/use the existing environment and Reader is insufficient, grant Contributor on only the existing environment resource or `rg-sentiqgpt-prod`, but do that cautiously.

### Core validation commands

```powershell
npm.cmd run preflight:azure
npm.cmd run preflight:production
npm.cmd run smoke:core
npm.cmd run test:e2e
npm.cmd run test:e2e:supabase
node --check backend\server.js
node --check frontend\scripts\app.js
```

Live Supabase E2E only runs if:

```powershell
$env:STUDENTOS_E2E_SUPABASE_LIVE="true"
npm.cmd run test:e2e:supabase
```

### Azure deployment verification command

After Azure backend URL exists:

```powershell
$env:STUDENTOS_AZURE_API_URL="https://<container-app-fqdn>"
npm.cmd run verify:azure-deployment
Remove-Item Env:STUDENTOS_AZURE_API_URL
```

---

## 6. Warnings and unresolved problems

### Critical warnings

1. **Do not delete SentIQ Chat Azure resources**

   * StudentOS must reuse the existing ACA environment, not destroy it.
   * SentIQ Chat runs in:

     ```text
     rg-sentiqgpt-prod
     cae-sentiqgpt-prod
     sentiqgpt-backend
     ```

2. **Do not create a second ACA environment in Central India**

   * Azure for Students quota rejects it.
   * Use the existing environment instead.

3. **Do not deploy frontend to Azure backend image**

   * Frontend is already on Cloudflare Pages.
   * Azure Docker image should be backend-only.
   * `.dockerignore` must include:

     ```text
     frontend/
     ```

4. **Do not add Supabase service keys to frontend or Cloudflare**

   * Cloudflare frontend should only receive public-safe config later.
   * Runtime secrets belong in Azure Container Apps secrets/env vars.

5. **Do not wire custom domain yet**

   * Wait until Azure backend works.
   * Then configure CORS.
   * Then configure frontend API base URL.
   * Then add:

     ```text
     studentos.sentiqlabs.com
     ```

6. **Google Classroom production callback not ready yet**

   * Local OAuth worked.
   * For production, `GOOGLE_REDIRECT_URI` must be updated to the Azure/backend domain callback later.
   * Classroom disabled by default for first Azure deploy.

7. **Workers are disabled for first Azure deployment**

   * No always-on worker, to save Azure credits.
   * Future worker should be Azure Container Apps Job or manual/scheduled job.

### Unresolved current problem

GitHub Actions deployment fails because the workflow/Bicep attempts to create a second Container Apps Environment.

Latest error:

```text
MaxNumberOfRegionalEnvironmentsInSubExceeded
The subscription cannot have more than 1 Container App Environments in Central India.
```

Required fix:

```text
Reuse existing ACA environment cae-sentiqgpt-prod in rg-sentiqgpt-prod
```

---

## 7. Recommended next actions

### Immediate next action

Run Codex with **Pass 32.2** to modify Bicep/workflow/scripts/docs so StudentOS reuses the existing ACA environment.

After Codex finishes:

1. Add GitHub secret:

   ```text
   AZURE_CONTAINER_APP_ENVIRONMENT_RESOURCE_GROUP=rg-sentiqgpt-prod
   ```

2. Update GitHub secrets:

   ```text
   AZURE_CONTAINER_APP_ENVIRONMENT=cae-sentiqgpt-prod
   AZURE_LOCATION=centralindia
   AZURE_RESOURCE_GROUP=rg-studentos-dev
   AZURE_CONTAINER_APP_NAME=studentos-api-dev
   ```

3. Confirm service principal access:

   * Contributor on:

     ```text
     rg-studentos-dev
     ```
   * Reader or appropriate access on:

     ```text
     rg-sentiqgpt-prod
     ```

     for the environment reference.

4. Re-run GitHub workflow:

   ```text
   GitHub → itshim998/StudentOS → Actions → Azure Container Apps - StudentOS API → Run workflow
   Branch: main
   image tag: empty
   Azure region: centralindia
   ```

### After Azure deploy succeeds

1. Open Azure Portal:

   ```text
   Resource groups → rg-studentos-dev → studentos-api-dev
   ```

2. Copy the Container App FQDN.

3. Test:

   ```text
   https://<fqdn>/api/health
   https://<fqdn>/api/config
   ```

4. Run:

   ```powershell
   $env:STUDENTOS_AZURE_API_URL="https://<fqdn>"
   npm.cmd run verify:azure-deployment
   ```

5. Configure Azure runtime secrets for Supabase.

6. Wire Cloudflare frontend to Azure API base URL.

7. Add CORS allowlist:

   ```text
   https://studentos-39s.pages.dev
   http://localhost:3101
   http://localhost:3102
   future: https://studentos.sentiqlabs.com
   ```

8. Only then add production custom domain.

---

## 8. Compact resume-from-here section

Use this in a new ChatGPT thread:

```text
We are continuing StudentOS development/deployment.

StudentOS is a production-grade SaaS, not a hackathon demo. It is separate from SentIQ Chat/SentIQGPT. SentIQ Chat must remain read-only.

Architecture:
- Frontend: Cloudflare Pages, already deployed preview at https://studentos-39s.pages.dev
- Backend: Azure Container Apps
- DB/Auth/Storage: Supabase, with 1 Auth project + 3 data shards
- GitHub repo: https://github.com/itshim998/StudentOS, private, branch main
- Azure resource group for StudentOS: rg-studentos-dev
- StudentOS Container App name: studentos-api-dev
- Existing SentIQ Chat Azure resource group: rg-sentiqgpt-prod
- Existing ACA environment: cae-sentiqgpt-prod
- Region: centralindia

Key completed work:
- StudentOS app passes 1–32 completed.
- Supabase auth/sharding/live E2E works.
- Google Classroom OAuth/sync/import/analyze works locally.
- Playwright E2E and live Supabase E2E exist.
- GitHub repo created and pushed.
- Azure deployment readiness files exist.
- Cloudflare frontend preview deployed.
- Frontend was excluded from Azure Docker image; Azure must be backend-only.

Current blocking issue:
Azure GitHub Actions deployment fails with:
MaxNumberOfRegionalEnvironmentsInSubExceeded
“The subscription cannot have more than 1 Container App Environments in Central India.”

Meaning:
The workflow tries to create a new ACA environment (cae-studentos-dev), but Azure for Students already has one ACA environment in Central India: cae-sentiqgpt-prod.

Next required action:
Prompt Codex with Pass 32.2 to update Bicep/workflow/scripts/docs so StudentOS reuses existing ACA environment:
- existingEnvironmentName=cae-sentiqgpt-prod
- existingEnvironmentResourceGroup=rg-sentiqgpt-prod
- useExistingEnvironment=true
- create/update only StudentOS container app studentos-api-dev in rg-studentos-dev
- minReplicas=0, maxReplicas=1
- STUDENTOS_SERVE_FRONTEND=false
- no SentIQ Chat modification

After Codex:
Add GitHub secret:
AZURE_CONTAINER_APP_ENVIRONMENT_RESOURCE_GROUP=rg-sentiqgpt-prod

Update GitHub secrets:
AZURE_CONTAINER_APP_ENVIRONMENT=cae-sentiqgpt-prod
AZURE_LOCATION=centralindia
AZURE_RESOURCE_GROUP=rg-studentos-dev
AZURE_CONTAINER_APP_NAME=studentos-api-dev

May need Azure role:
Service principal from AZURE_CREDENTIALS has Contributor on rg-studentos-dev and Reader on rg-sentiqgpt-prod.

Then rerun:
GitHub → itshim998/StudentOS → Actions → Azure Container Apps - StudentOS API → Run workflow
Branch main, image tag empty, region centralindia.
```

This is the exact state to resume from.

[1]: https://learn.microsoft.com/en-us/azure/container-apps/scale-app?utm_source=chatgpt.com "Set scaling rules in Azure Container Apps"
[2]: https://docs.github.com/actions/managing-workflow-runs/manually-running-a-workflow?utm_source=chatgpt.com "Manually running a workflow"

PASS 32.2 was completed and pushed by Codex with commit `9c2ac7344bed9e14b0f833227e62865ec471a163` using message `chore: reuse existing Azure Container Apps environment`. The Azure workflow, Bicep, deploy scripts, docs, and Azure preflight now support reusing the existing ACA environment `cae-sentiqgpt-prod` in `rg-sentiqgpt-prod` instead of creating a second Central India environment. StudentOS remains a separate backend-only Container App `studentos-api-dev` in `rg-studentos-dev`, with Cloudflare as frontend host and Supabase as DB/Auth/Storage. Required next action is to add/update GitHub secrets including `AZURE_CONTAINER_APP_ENVIRONMENT_RESOURCE_GROUP=rg-sentiqgpt-prod`, confirm service principal access, and rerun the manual GitHub Actions deployment on branch `main`.

Azure IAM fix is in progress for the PASS 32.2 deployment. The user is assigning Container Apps Contributor on the existing ACA environment cae-sentiqgpt-prod inside rg-sentiqgpt-prod to the GitHub deploy service principal from AZURE_CREDENTIALS, so the deployment identity gets the required managed environment join permission. After assignment and a short RBAC propagation wait, the next action is to rerun the manual GitHub Actions deployment on branch main.

Supabase sent inactivity warnings for StudentOS: the Auth project was paused and studentos-data-shard-3 is at risk of being paused. This is now the priority before Pass 33.1 or UI refactor work. The recommended workaround is PASS 32.4: add a scheduled GitHub Actions Supabase keepalive workflow that periodically pings all four StudentOS Supabase projects using only project URLs and anon/publishable keys, backed by a harmless public.studentos_keepalive table with anon SELECT-only access and no private user data. The workflow should run daily or twice weekly, avoid frequent UptimeRobot-style pings, avoid keeping Azure warm, require no service-role keys in GitHub Actions, and include documentation for applying the SQL to the Auth project and all three data shards.

PASS 32.4 was completed and pushed by Codex with commit e363a422e78d62f5c28b58210ddedf3c60b8e1c4, adding .github/workflows/supabase-keepalive-studentos.yml, docs/SUPABASE_KEEPALIVE.md, scripts/verifySupabaseKeepalive.js, and supabase/migrations/pass32_4_studentos_keepalive.sql. The next operational steps are to ensure all 4 Supabase projects are unpaused, apply pass32_4_studentos_keepalive.sql to the Auth project and all three data shards, add the 8 GitHub Actions secrets for project URLs and anon keys, then manually run the Supabase Keepalive - StudentOS workflow on branch main and confirm all four projects succeed. After keepalive is verified, resume PASS 33.1 for Cloudflare frontend to Azure backend wiring before starting UI refactor planning.

Cloudflare Pages build configuration for StudentOS should be updated from echo "Static frontend deployment" to npm run cloudflare:config, while keeping the build output directory as frontend and root directory as repository root. The Cloudflare production variable STUDENTOS_PUBLIC_API_BASE_URL=https://studentos-api-dev.ashygrass-913d190e.centralindia.azurecontainerapps.io must be present before redeploying the latest production deployment. After redeploy, https://studentos.sentiqlabs.com/runtime-config.js should contain the Azure backend URL, resolving the Cloudflare frontend’s API-base misconfiguration.

The recommended next step is PASS 34.0 as a planning-only UI refactor pass, after a quick verification that Cloudflare runtime-config.js points to the Azure backend and verify:cloudflare-azure is acceptable. PASS 34.0 should be run in VS Code Codex with High/Extra High intelligence, Plan Mode ON, and Goal Mode OFF; no dedicated Codex app is required. The prompt was updated to reflect the latest production state, preserve StudentOS’s Cloudflare/Azure/Supabase architecture, keep SentIQ Chat/SentIQGPT read-only, and produce docs/ui-redesign/STUDENTOS_UI_REFACTOR_PLAN.md without implementing UI code yet.

After PASS 34.5, the UI has improved functionally but still contains product-level issues that are not purely cosmetic: always-visible rail login/signup, developer-facing labels such as mock metadata/source-grounded/web fallback/chunks, crowded boxed surfaces, and pricing cards that need consumer-grade restructuring. Decision: do not switch to Gemini/Antigravity yet. Continue Codex in VS Code for additional functional/product UI passes, starting with a new PASS 34.6A focused on public/auth shell separation and consumer-language cleanup, followed by pricing/account cleanup, Studio redesign, account/settings/privacy redesign, responsive/mobile polish, and only then move frontend-only aesthetic polishing to Gemini 3.5 Flash in Antigravity on a cloned frontend folder.

Researched Claude/Opus frontend SKILL.md options for SentIQ Chat and StudentOS Antigravity frontend-only design workflow. The uploaded SKILL.md was identified as the best primary choice because it matches Anthropic’s official frontend-design skill and provides the strongest balance of distinctive visual direction, restraint, typography, layout, motion, copy quality, and self-critique. Recommended using it as the main Antigravity frontend design skill, optionally adding design-review later as an audit-only checklist, while keeping Opus restricted to cloned frontend-only folders with no backend credentials or backend editing access.

For StudentOS auth email branding, the Resend API key should be created inside the existing SentIQ Chat Resend account with name studentos-supabase-auth-prod, permission set to Sending access, and domain restricted to auth.sentiqlabs.com rather than Full access or All domains. The generated key should be copied once and entered only in the StudentOS Supabase Auth project custom SMTP settings, using sender StudentOS by SentIQ AI Labs <studentos@auth.sentiqlabs.com>, SMTP host smtp.resend.com, port 465, username resend, and the Resend API key as password.

Prepared PASS 34.8 as a VS Code Codex Audit and Fix Pass 1 for StudentOS Google Classroom issues seen in production screenshots. The pass instructs Codex to deeply audit frontend/backend Classroom state handling, remove confusing disabled/unavailable/error UI, normalize Classroom status states, fix button visibility, replace developer-facing copy, preserve read-only/no-write-scope safety, add regression tests, run production/e2e validations, and commit/push with fix: stabilize Google Classroom states. Recommended settings: VS Code Codex extension, Intelligence xHigh, Plan Mode OFF, Goal Mode OFF.

After PASS 34.8, remaining StudentOS production issues were identified from screenshots: the AI drawer returns internal/stale/demo-style responses unrelated to the user query, Classroom connect/setup state remains inconsistent, older Classroom assignments/materials appear before newer ones, and the provided env reference is not production-ready due duplicate keys, localhost/development values, demo seed enabled, disabled quota/rate limits, mock embeddings, localhost Classroom redirect, and placeholder values. Prepared PASS 34.9 for VS Code Codex with xHigh intelligence, Plan Mode OFF, Goal Mode OFF to audit/fix AI drawer response handling, deterministic Classroom state rendering, newest-first Classroom import ordering with local FIFO eviction for old imported cache/items only, and production env/template/preflight readiness while preserving secrets, keeping payments disabled, and adding regression tests.

Project Source Update
Analysed the current post-PASS 34.9 StudentOS state and identified that the HSMC AI response is improved but still not production-ready because it gives a dead-end “not enough material” answer, repeats itself, exposes internal source/workflow artifacts, and allows Ask behavior before the user’s academic workspace is properly created. A major product-flow pivot was recommended: StudentOS should become setup-first and payment-gated rather than dashboard-first, with local IndexedDB-based pre-payment onboarding, plan/trial activation before cloud AI/storage work, post-payment source processing, optional read-only Classroom connection, newest-first Classroom material selection with quota controls, guided tutorial, and then a minimal Today home centered on one next action. The next step should be a product-flow specification and decision interview, not another Codex prompt yet.

StudentOS pricing strategy was updated: public tiers are now Starter ₹99/month, Essential ₹159/month, Plus ₹259/month, and Pro ₹549/month, each with the same fixed restricted 7-day card-backed trial and no free tier. Pricing UI should not display raw storage, processed-material quotas, AI model names, provider names, or technical specs; it should sell consumer-facing academic outcomes similar to ChatGPT’s pricing style. Internal hidden launch quotas remain necessary for infrastructure safety: suggested targets are Trial 40 MB raw/15 MB processed/5 Classroom items, Starter 120 MB/40 MB/30 items, Essential 250 MB/90 MB/70 items, Plus 400 MB/160 MB/150 items, and Pro 650 MB/275 MB/300 items, with shard-level emergency brakes. Classroom onboarding should fetch metadata/names first, show newest-first selectable materials, grey out remaining checkboxes when academic context capacity is full, and only upload/process selected materials after payment/trial activation.

The new StudentOS concept was refined further: Trial Mode is now optional from the pricing page, with users choosing either limited 7-day Trial Mode or immediate paid plan access after selecting a tier; payment method verification happens before costly backend work; course/material selection happens after payment method verification and selected materials go directly to Supabase, removing the IndexedDB pre-payment staging plan. Classroom setup remains a mandatory page but supports two valid paths: connect Google Classroom or choose “My institution does not use Classroom” for manual uploads. Onboarding can span up to 10 beautiful, minimal pages with progress bar and warm guidance, only name required, all other personalization skippable, progress saved lightly, and no AI usage before payment method confirmation. The dashboard stays hidden until setup/payment/legal/workspace readiness; Ask/Plan/Make/Review should be replaced by a single floating Ask StudentOS panel that infers task type automatically.

Finalized StudentOS quota/sync behavior decisions: public pricing should continue using fair-use consumer language, while StudentOS enforces hidden hard internal limits for AI actions, heavy processing, daily bursts, and global infrastructure safety. Large files will not require user confirmation, but StudentOS may automatically compress, queue, partially process, or gracefully block them if academic context is full. Classroom auto-sync should be metadata-only to avoid cost: Trial gets one Day-4 auto-check, Starter weekly, Essential every 5 days, Plus every 3 days, and Pro every 48 hours; full import/processing happens only after user selection or explicit plan-safe rules. FIFO cleanup should run automatically only for temporary cache, derived artifacts, failed processing artifacts, duplicates, and old unselected Classroom metadata; selected academic materials should not be silently deleted and must be managed by the user through Academic Context. Show “academic context almost full” at ~90% and grey out remaining selectable items at full capacity.

Added a new additive section for StudentOS New Product Flow Plan.md covering six finalized infrastructure-safety/product decisions: StudentOS will use hidden hard AI limits with public fair-use language; large files will not require confirmation but will be automatically compressed, queued, partially processed, or blocked gracefully by academic-context capacity; Classroom auto-sync will be metadata-first to avoid unnecessary cost; sync cadence is Trial Day-4 once, Starter weekly, Essential every 5 days, Plus every 3 days, and Pro every 48 hours; FIFO cleanup is automatic only for cache/derived/unselected metadata and never silently deletes selected academic material; and the UI shows an “academic context almost full” warning around 90%, then greys out additional selections at full capacity without exposing storage or technical quotas.

Evaluated both deep research reports on StudentOS/SentIQ Chat context architecture and selected a conservative privacy-first architecture: keep retrieval inside Supabase/Postgres for MVP; use pgvector halfvec(384), HNSW, Postgres full-text search, metadata prefiltering, and RRF hybrid ranking; implement parent-child chunking, rule-based context prefixes, document/course/topic/student memory capsules, and a context packer; use self-hosted/local-worker BAAI/bge-small-en-v1.5 as the launch embedding model with all-MiniLM-L6-v2 as fallback; avoid Gemini free-tier, Voyage free-tier, separate vector DB, high-dimensional embeddings, BGE-M3 default, and reranking at launch; introduce Groq GPT-OSS 120B dynamic token allocation with hidden tier caps and prompt caching-aware prompt order; reuse the same retrieval/context engine in SentIQ Chat with StudentOS-specific academic objects swapped for general workspace/persona memory objects.

StudentOS tier strategy was revised after reviewing the current pricing page. The pricing cards should be differentiated by student outcomes rather than vague perks or technical quotas. Recommended public positioning: Starter ₹99 for daily study structure, adaptive To-Dos, manual uploads, basic tests/revision, and guided Ask StudentOS; Essential ₹159 as the recommended plan with weekly Classroom checks, flashcards, visual notes, expanded tests/revision, and more academic context; Plus ₹259 for heavier semesters with more frequent Classroom checks, stronger planning, deeper explanations, visual notes, and Learning Level adaptation; Pro ₹549 for highest support with Consistency Points, priority assignment preparation, advanced assignment checking, and future controlled automation. Public UI should avoid “IQ points”; use “Learning Level” or “Mastery Profile” instead. Public UI should use “Consistency Points” instead of punitive discipline language. Auto-submission to Google Classroom should not launch now because current StudentOS Classroom policy remains read-only and writeback would require future OAuth/legal review; Pro should first launch with Assignment Coach and student-reviewed workflows. Next recommended Codex pass is PASS 35.4 — Plan Entitlements and Pricing Feature Policy Foundation, focused on backend plan capability definitions, feature gates, usage budgets, and plan-aware policy constants before updating pricing UI in a later pass.

# StudentOS Continuation Handoff — Latest Thread Update

## Current Status

This thread continued the StudentOS rebuild from a dashboard-first prototype into a lifecycle-gated, paid, onboarding-first academic operating layer.

The current product direction is:

StudentOS is a paid AI-native academic operating layer for students. It should not feel like a generic chatbot, raw file-storage app, or technical dashboard. It should guide a student from signup into a clean setup journey, collect their real academic context, optionally connect Google Classroom, prepare a personalized workspace, and then land them on a minimal Today dashboard focused on the next academic action.

The main product spine is now:

signup → name setup → academic identity → pricing → Trial Mode or direct plan → payment-method placeholder → legal consent → onboarding → Classroom/manual setup → material selection → setup summary → workspace preparation → tutorial offer → Today dashboard.

Dashboard access must remain locked until lifecycle readiness is explicit. A newly authenticated user must never land directly on demo dashboard data.

---

## Major Product Decisions Finalized

### Paid-only product

StudentOS has no free tier.

Public plans are:

* Starter — ₹99/month
* Essential — ₹159/month
* Plus — ₹259/month
* Pro — ₹549/month

Every paid plan may start with optional Trial Mode.

Trial Mode is not the same as the selected paid plan. It is a fixed restricted mode regardless of whether the user selected Starter, Essential, Plus, or Pro.

Payment method verification is required before expensive backend work, file processing, AI analysis, and workspace preparation.

Real payment/Razorpay integration is not implemented yet. Current payment flow uses a dev-safe placeholder only.

### Pricing philosophy

StudentOS must not publicly display:

* storage MB/GB
* processed material limits
* AI action counts
* model names
* provider names
* token limits
* backend infrastructure limits
* database/storage details
* Supabase/Groq/Gemini/Pollinations details

Pricing should sell student outcomes, not infrastructure.

Use terms such as:

* academic context
* workspace
* selected material
* study plan
* Today
* roadmap
* revision
* tests
* flashcards
* visual notes
* Learning Level
* Consistency Points
* Classroom coursework
* guided help

Avoid technical/developer terms in normal UI.

### Legal/consent page

A mandatory legal/consent page is required before dashboard access.

It should include separate acknowledgements for:

* Terms of Service
* Privacy Policy
* Trial Mode and automatic subscription billing
* Trial Mode being different from selected paid plan
* payment method verification / recurring mandate
* cancellation before trial ends
* use of academic files/timetable/Classroom data/notes
* no guarantee of marks, ranks, admissions, or exam results
* responsible use / no academic misconduct
* AI outputs may contain mistakes
* age/parental consent

### Onboarding design

Onboarding should be beautiful, minimal, professional, and light. It can have multiple pages, but each page should feel simple.

Only name is mandatory. All other personalization details can be skipped and completed later.

Inputs should support natural language, file upload, image upload, typed text, and manual form entry where relevant.

The first page should ask only:

“What is your name?”

The second page asks academic identity.

The pricing page is the third major step.

### Google Classroom strategy

Google Classroom is a major StudentOS feature, but the setup page must support two valid paths:

1. Connect Google Classroom
2. My institution does not use Classroom

Classroom remains read-only for launch.

No write scopes, no submit, no grade, no turn-in, no deletion, and no writeback are allowed at this stage.

Classroom import should be metadata-first:

connect Classroom → fetch course/material/assignment metadata → show selectable items newest-first → user selects what belongs in their academic context → selected material is imported/processed only under plan-safe rules.

Auto-sync/check cadence by plan:

* Trial Mode: one automatic Classroom check on Day 4 of trial
* Starter: manual only
* Essential: every 7 days
* Plus: every 5 days
* Pro: every 3 days

This refers to metadata checks only, not automatic full import or AI processing.

### Academic context capacity

The UI should not say “storage.” It should say “academic context.”

At roughly 90% internal capacity:

“Your academic context is almost full. Remove older material or upgrade to add more.”

At full capacity:

“Your academic context is full. Upgrade or remove older material to add this.”

No MB/GB should be shown in consumer UI.

StudentOS must not silently delete selected academic materials. Automatic FIFO cleanup is allowed only for cache, derived artifacts, duplicates, failed processing artifacts, stale previews, and unselected metadata.

### AI assistant behavior

Consumer UI should not expose Ask / Plan / Make / Review mode buttons.

Use one floating panel:

Ask StudentOS

The assistant should infer task type internally.

Before workspace readiness, Ask StudentOS should guide setup or say setup must be completed. After dashboard readiness, it can behave normally.

The UI must never expose provider/model/retrieval/debug terms.

### Learning Level and Consistency Points naming

Do not publicly use “IQ points.” It sounds judgmental and risky.

Use:

Learning Level

Internally this can be `learning_level` or `learning_adaptation_score`.

Do not publicly use “Discipline points.”

Use:

Consistency Points

Consistency Points should measure timely completion, follow-through, and task discipline in a motivating way.

### Assignment automation decision

Do not launch automatic Classroom submission now.

Pro should not publicly promise auto-submit.

Safe launch wording:

* Advanced assignment checking
* Assignment Coach
* Priority assignment preparation
* Student-reviewed assignment workflow

Future writeback/submit automation can only be considered after:

* Google OAuth verification
* legal/consent update
* explicit per-assignment confirmation
* feature flags
* write-scope separation
* audit logs
* student remains in control

Assignment writeback and auto-submit must remain disabled for every plan at launch.

---

## Pricing Tier Strategy

### Starter — ₹99/month

Positioning:

For students who need daily structure.

Public perks:

* Daily study plan from your syllabus
* Adaptive To-Do list
* Manual material upload
* Basic tests and revision
* Ask StudentOS for guided help

Best for:

One focused semester.

Internal policy direction:

* conservative usage
* manual upload enabled
* manual Classroom import may be allowed if safely available
* no Classroom auto-check
* basic roadmap
* basic assessment/mock tests
* limited assistant depth
* no visual notes initially
* no Learning Level adaptation
* no Consistency Points
* no assignment writeback

### Essential — ₹159/month

Positioning:

Recommended for regular school or college use.

Public perks:

* Everything in Starter
* Weekly Classroom coursework checks
* Flashcards for active subjects
* Visual notes with simple diagrams
* More tests, revision, and study material
* More room for your academic context

Best for:

Regular school or college use.

Internal policy direction:

* Essential is the recommended plan
* Classroom metadata auto-check every 7 days
* flashcards feature flag enabled
* visual notes feature flag enabled
* expanded assessments/mock tests
* expanded assistant policy
* more update allowance than Starter
* no Consistency Points
* no assignment writeback

### Plus — ₹259/month

Positioning:

For heavier semesters and deeper preparation.

Public perks:

* Everything in Essential
* More frequent Classroom checks
* Roadmaps adapt to your Learning Level
* Deeper explanations and stronger planning
* More visual notes and flowcharts
* Higher support for mock tests and assignments

Best for:

Engineering, exam-heavy months, and deeper preparation.

Internal policy direction:

* Classroom metadata auto-check every 5 days
* adaptive roadmap enabled
* Learning Level enabled
* adaptive difficulty enabled
* stronger assistant policy
* stronger mock test/assessment policy
* assignment coach enabled
* no assignment writeback

### Pro — ₹549/month

Positioning:

Highest support for serious exam seasons.

Public perks:

* Everything in Plus
* Consistency Points for study discipline
* Priority roadmap and assignment preparation
* Advanced assignment checking
* Strongest tests, revision, and study material support
* Built for intense semesters

Best for:

High-intensity students and serious exam prep.

Internal policy direction:

* Classroom metadata auto-check every 3 days
* Learning Level enabled
* Consistency Points enabled
* assignment coach enabled
* assignment review enabled
* strongest assistant/assessment/roadmap/notes policy
* assignment writeback disabled at launch

---

## Context Architecture Decision

Deep research results were evaluated and the final architecture decision was:

StudentOS and SentIQ Chat should use a shared context/retrieval architecture:

Supabase/Postgres retrieval store + pgvector halfvec(384) + Postgres full-text search + hybrid RRF ranking + parent-child chunking + academic/workspace memory capsules + Groq dynamic token allocator.

No separate vector database for MVP.

Launch embedding strategy:

* primary: self-host/local-worker `BAAI/bge-small-en-v1.5`
* dimensions: 384
* storage: `halfvec(384)`
* fallback if too heavy: `all-MiniLM-L6-v2`

Avoid for launch:

* Gemini free-tier embeddings for student files
* Voyage free-tier embeddings for student files without verified privacy protection
* separate vector DB
* high-dimensional embeddings by default
* BGE-M3 as default MVP model
* reranking at launch

Later after revenue:

* paid hosted embedding fallback
* reranking for Plus/Pro
* richer contextual retrieval
* paid Groq tier if needed

Groq GPT-OSS 120B remains the primary generation model for launch, but hidden token budgets and a dynamic token allocator are required because free-tier pressure is real.

Hidden internal token budget direction:

* Trial: max completion around 3000
* Starter: around 4000
* Essential: around 4500
* Plus: around 5000
* Pro: around 5500

StudentOS should not always use maximums. It should dynamically shrink context/output based on rate pressure, task type, and plan.

The UI must never show model/provider/token details.

---

## Google Classroom Fixes Completed Earlier

A Google Classroom error/audit pass was performed.

Earlier root causes:

* backend treated disabled/unconfigured Classroom as import failure
* frontend showed Connect, Sync, and Disconnect together
* UI exposed developer-facing copy such as scopes/writeback/token details
* browser-facing Classroom JSON carried internal connector metadata

Codex fixed this in a pushed pass:

Commit:

`d97994325ce39a466ee8f033e64cd3e2bf54130d`

Outcome:

* no Google Classroom error/unavailable UI remained in tested paths
* no write scopes/writeback added
* no secrets exposed
* SentIQ Chat/SentIQGPT not modified

A later Pass 34.9 stabilized AI/Classroom imports and env readiness.

Commit:

`b44f4113175f9aff4368b97b762482d3ccf31b62`

Highlights:

* AI fallback copy no longer leaked retrieval/demo wording
* Classroom buttons use `/api/classroom/status`
* Classroom assignments/materials sort newest-first
* FIFO retention added for local imported rows/cache artifacts
* production preflight strengthened for env issues
* `.env` was not changed/printed/staged/committed

---

## PASS 35 Series Summary

### PASS 35.0 — Lifecycle-Gated Product Flow Foundation

Status:

Completed, committed, pushed.

Commit:

`59f20510ff22650e523d1647fa186d2ee98582e9`

Purpose:

Turn StudentOS from dashboard-first into lifecycle-gated product flow.

Implemented:

* pricing
* optional Trial Mode
* development-only payment-method placeholder
* mandatory legal consent
* onboarding shell
* Classroom/manual setup
* material selection shell
* setup summary
* workspace preparation shell
* tutorial offer
* dashboard gating
* single lifecycle-aware Ask StudentOS entry

Real payment not enabled. Classroom remained read-only.

### PASS 35.1 — Onboarding Readability, Flow Order, and Navigation Fix

Status:

Completed, committed, pushed. Commit hash was not captured in this thread.

Purpose:

Fix unreadable low-contrast onboarding UI, pricing appearing too early, missing Previous navigation, and random black rectangle.

Implemented:

* readable contrast
* first page name-only
* academic identity as page 2
* pricing moved to page 3
* Previous navigation
* black rectangle removed
* overall onboarding became much better visually

### PASS 35.2 — Onboarding Flow Responsiveness and Material Setup Fix

Status:

Completed, committed, pushed.

Commit:

`6d67cdeab2b8ba3bf8c73102fab86d18749b1c3d`

Root causes fixed:

* onboarding skipped dashboard Classroom sync path
* uploads required dashboard readiness and existing course
* every onboarding save blocked navigation
* preparation and summary actions were duplicated

Implemented:

* clearer Exam Pattern copy
* Syllabus page supports natural language and multi-file uploads
* onboarding uses shared read-only Classroom sync path
* standalone coursework materials included
* metadata sorted newest-first
* optimistic/frontend-first onboarding navigation
* ordered background saves with retries
* final flush before workspace preparation
* one preparation page
* setup summary actions simplified

Validation passed:

* preflight
* smoke
* tests
* Classroom tests
* syntax/diff checks

Standalone `test:sources` still had a pre-existing citation-label assertion failure unrelated to this pass.

### PASS 35.3 — Auth Redirect and New User Lifecycle Fail-Closed Fix

Status:

Completed, committed, pushed.

Commit:

`c226eba9305065dfa6dafddacade604ce40874c2`

Root causes fixed:

* signup omitted `redirect_to`, allowing stale Supabase defaults to send users to port 3000
* existing workspace rows incorrectly implied lifecycle completion
* dashboard timestamp alone could activate Today
* frontend could expose app before authenticated bootstrap completed
* account quota data could overwrite selected paid plan with “Free”

Implemented:

* signup uses current origin + `/auth/callback`
* root/callback hash/query tokens establish session
* URL scrub after session capture
* missing/invalid/partial/stale/unloaded lifecycle fails closed at Name setup
* dashboard readiness now requires every lifecycle gate
* known demo-seed rows filtered from real-user state
* account/Classroom dashboard loading waits until lifecycle completion
* “Plan Free” no longer overrides selected paid plan
* Cloudflare/static callback routing
* redirect diagnostics
* `docs/AUTH_REDIRECTS.md`
* Supabase cleanup guidance

Manual Supabase settings to verify:

Site URL:

`https://studentos.sentiqlabs.com`

Redirect URLs:

`http://localhost:3101/auth/callback`

`https://studentos.sentiqlabs.com/auth/callback`

`https://studentos-39s.pages.dev/auth/callback` if previews need verification

Also add corresponding `/auth/complete` URLs for password recovery if used.

Important QA note:

Deleting only the Supabase Auth user is not enough to clean a test user because StudentOS also stores shard-side profile/workspace data. Use fresh emails for clean QA until a dev-only full cleanup tool exists.

### PASS 35.4 — Plan Entitlements and Pricing Feature Policy Foundation

Status:

Completed, committed, pushed.

Commit:

`7f3082b99d7b9a6ca4cab2553286e88daca30646`

Root issue:

Replaced scattered/legacy plan policy with central backend plan entitlement service.

Main file:

`backend/domain/planEntitlementService.js`

Functions added:

* `getPlanEntitlements`
* `getPublicPlanSummary`
* `canUseFeature`
* `getFeatureLimit`
* Classroom/assistant/context policy getters
* normalization helpers
* plan-type helpers

Plans defined:

* Trial
* Starter ₹99
* Essential ₹159
* Plus ₹259
* Pro ₹549

Essential is recommended.

Public summaries contain consumer-facing benefits only.

Hidden budgets remain backend-only.

Classroom cadence:

* Trial Day 4 once
* Starter manual
* Essential 7 days
* Plus 5 days
* Pro 3 days

Learning Level:

* Plus/Pro

Consistency Points:

* Pro only

Classroom writeback/submission/grading/turn-in/deletion/auto-submit:

disabled for every plan.

Added safe config/bootstrap/account/billing summaries and fail-closed unknown-plan handling.

Migration added:

`supabase/migrations/202606290001_studentos_pass35_4_plan_entitlements.sql`

This migration must be applied to all 3 StudentOS data shards, not the auth project unless explicitly required.

Docs updated:

* `docs/PASS35_PLAN_ENTITLEMENTS.md`
* billing docs
* SaaS docs
* deployment/migration-plan docs

Validation passed:

* preflight
* smoke
* tests
* E2E
* Pass 14/15/16/23/35/35.4 tests
* backend/frontend syntax checks
* git diff check

Production env changes:

none required. Review `STUDENTOS_DEFAULT_PLAN` only if explicitly configured.

### PASS 35.5 — Pricing UI Entitlement Integration

Prompt was generated but Codex result has not been reported in this thread yet.

Purpose:

Connect onboarding pricing UI to safe public summaries from PASS 35.4 entitlement system.

PASS 35.5 should:

* replace vague hardcoded pricing bullets
* consume safe public plan summaries
* show Starter ₹99, Essential ₹159, Plus ₹259, Pro ₹549
* mark Essential as Recommended
* improve plan differentiation
* clarify Trial Mode differs from selected paid plan
* persist selected plan as normalized plan key
* prevent “Plan Free” from normal authenticated UI
* keep real payment disabled
* keep Classroom read-only
* keep assignment writeback/auto-submit disabled
* avoid storage/model/provider/token/backend details in UI

After PASS 35.5 completes, manually test only pricing/onboarding plan selection first.

---

## Manual Actions Still Needed

### Apply PASS 35.4 migration

Apply this migration to all three Supabase data shards:

`supabase/migrations/202606290001_studentos_pass35_4_plan_entitlements.sql`

Do not apply to auth project unless file explicitly requires it.

Manual path:

Supabase Dashboard → data shard project → SQL Editor → paste migration → Run → repeat for all 3 shards.

### Verify Supabase Auth redirect settings

In `studentos-auth` Supabase project:

Authentication → URL Configuration

Verify:

Site URL:

`https://studentos.sentiqlabs.com`

Redirect URLs:

`http://localhost:3101/auth/callback`

`https://studentos.sentiqlabs.com/auth/callback`

`https://studentos-39s.pages.dev/auth/callback`

Also add password recovery completion URLs if recovery uses `/auth/complete`.

Ensure email templates are not hardcoded to `localhost:3000`.

### Fresh-user QA

Use fresh email accounts for testing.

Expected fresh user flow:

signup → email verification → callback returns to StudentOS → name setup page → academic identity → pricing → Trial/direct plan → payment placeholder → legal → onboarding → Classroom/manual → materials → summary → preparation → tutorial → dashboard.

Expected checks:

* no `localhost:3000`
* no direct dashboard for new users
* no demo data for new authenticated users
* no Plan Free
* onboarding starts with name-only page
* lifecycle persists across refresh/signout/signin

### Production deployment check

If production still shows old demo dashboard, verify Cloudflare Pages and Azure backend are deployed to latest commits.

Check:

Cloudflare Pages → StudentOS project → deployments → latest commit.

Also check:

`https://studentos.sentiqlabs.com/runtime-config.js`

It should point to the correct StudentOS Azure backend.

---

## Recommended Next Steps

If PASS 35.5 has not been run yet:

1. Apply PASS 35.4 migration to all 3 Supabase data shards.
2. Run PASS 35.5 in VS Code Codex using the already prepared prompt.
3. Pull latest after Codex completes.
4. Test pricing page only:

   * plan cards use new summaries
   * Essential recommended
   * Trial copy is clear
   * no technical copy
   * plan selection persists normalized key
   * no Plan Free

If PASS 35.5 has already been run:

1. Paste Codex’s PASS 35.5 response into the new thread.
2. Evaluate whether pricing UI now reflects entitlement summaries correctly.
3. Then decide between:

   * PASS 36.0 — Wire Plan Entitlements Into Existing Product Features
   * or a short PASS 35.6 pricing/onboarding polish pass if UI still feels weak.

Do not jump directly to flashcards, Learning Level engine, Consistency Points engine, or assignment automation until the pricing/entitlement foundation is visibly correct.

Likely implementation order from here:

1. PASS 35.5 — Pricing UI Entitlement Integration
2. PASS 36.0 — Wire Entitlements Into Existing Features
3. PASS 36.1 — Flashcards and Visual Notes foundation
4. PASS 36.2 — Learning Level / Mastery Profile adaptation
5. PASS 36.3 — Consistency Points
6. Future Pro Assignment Coach
7. Much later: controlled Classroom submission/writeback only after legal/OAuth readiness

---

## Codex Workflow Reminder

Default workflow:

Use Codex inside VS Code unless explicitly told otherwise.

For StudentOS implementation prompts, usually use:

* Intelligence: xHigh
* Plan Mode: OFF
* Goal Mode: OFF

Avoid unnecessary “explain what you understand” prompt phases. Use direct implementation prompts with tests, validation, commit, and push.

For frontend-only aesthetic polishing later, use Antigravity/Opus or frontend clone workflow, but always include the caution:

Backend folders/files are read-only. Reference backend only as source of truth/constraints. Do not edit backend files or secrets.

---

## Safety Rules to Preserve

Never expose in normal product UI:

* Supabase
* Groq
* Gemini
* Pollinations
* provider
* model
* token
* vector
* embedding
* chunks
* backend
* database
* storage specs
* OAuth internals
* writeback
* no write scopes
* mock/demo labels
* source-grounded
* web fallback

Do not enable real payment until Razorpay/PAN/legal setup is ready.

Do not enable Classroom writeback/submission.

Do not silently delete selected academic material.

Do not let new authenticated users bypass onboarding.

Do not show demo dashboard data to real authenticated users.

Do not call Trial Mode equal to selected paid plan.

Do not use “IQ points” publicly. Use “Learning Level.”

Do not use “Discipline points” publicly. Use “Consistency Points.”

---




