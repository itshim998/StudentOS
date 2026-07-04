# Placeholder-only helper for configuring Azure Container Apps runtime secrets.
# Copy commands from this file and replace placeholder values in your local shell only.
# Do not commit real values. Do not paste real values into logs or chats.

param(
  [string]$ResourceGroup = "rg-studentos-dev",
  [string]$ContainerAppName = "studentos-api-dev"
)

$ErrorActionPreference = "Stop"

# Non-secret runtime flags. These keep the first deployment low-risk and low-cost.
az containerapp update --resource-group $ResourceGroup --name $ContainerAppName --set-env-vars `
  NODE_ENV=production `
  PORT=3101 `
  STUDENTOS_PORT=3101 `
  STUDENTOS_ENV=production `
  STUDENTOS_DEPLOYMENT=azure-container-apps `
  STUDENTOS_SERVE_FRONTEND=false `
  STUDENTOS_MODE=supabase `
  STUDENTOS_BACKGROUND_WORKERS_ENABLED=false `
  STUDENTOS_DEMO_SEED_ENABLED=false `
  STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED=false `
  STUDENTOS_AUTH_ADMIN_DELETE_ENABLED=false `
  STUDENTOS_INTERNAL_OPS_ENABLED=false `
  STUDENTOS_GOOGLE_CLASSROOM_MODE=disabled `
  STUDENTOS_BILLING_PROVIDER=none `
  STUDENTOS_BILLING_LIVE_CHARGES_ENABLED=false `
  STUDENTOS_BILLING_CHECKOUT_REDIRECT_ENABLED=false `
  STUDENTOS_QUOTA_ENFORCEMENT=false `
  STUDENTOS_RATE_LIMIT_ENABLED=true `
  CORS_ORIGINS="https://studentos.sentiqlabs.com,https://studentos-39s.pages.dev,http://localhost:3101,http://localhost:3102,http://127.0.0.1:3101,http://127.0.0.1:3102"

# Secret placeholders. Replace values locally or use Azure Portal secret UI.
az containerapp secret set --resource-group $ResourceGroup --name $ContainerAppName --secrets `
  studentos-supabase-url-1="<auth-project-url>" `
  studentos-supabase-anon-key-1="<auth-anon-key>" `
  studentos-supabase-service-role-key-1="<auth-service-role-key>" `
  studentos-supabase-url-2="<data-shard-1-url>" `
  studentos-supabase-service-role-key-2="<data-shard-1-service-role-key>" `
  studentos-supabase-url-3="<data-shard-2-url>" `
  studentos-supabase-service-role-key-3="<data-shard-2-service-role-key>" `
  studentos-supabase-url-4="<data-shard-3-url>" `
  studentos-supabase-service-role-key-4="<data-shard-3-service-role-key>" `
  studentos-supabase-jwt-secret="<supabase-jwt-secret>" `
  studentos-storage-bucket="studentos-source-materials" `
  studentos-export-storage-bucket="studentos-data-exports" `
  groq-api-key="<backward-compatible-groq-key>" `
  groq-api-key-1="<recommended-groq-key-1>" `
  groq-api-key-2="<optional-groq-key-2>" `
  groq-api-key-3="<optional-groq-key-3>" `
  groq-api-key-4="<optional-groq-key-4>" `
  groq-api-key-5="<optional-groq-key-5>" `
  pollinations-api-key="<optional-pollinations-key>" `
  google-client-id="<later-google-client-id>" `
  google-client-secret="<later-google-client-secret>" `
  google-redirect-uri="https://<azure-app-url>/api/classroom/oauth/callback" `
  studentos-google-classroom-token-encryption-secret="<later-classroom-token-secret>"

# Map secrets to environment variables. Keep only the Groq lines whose secrets were configured; one key is enough.
# Keep Google/Classroom disabled for first deploy unless redirect URI is configured.
az containerapp update --resource-group $ResourceGroup --name $ContainerAppName --set-env-vars `
  STUDENTOS_SUPABASE_URL_1=secretref:studentos-supabase-url-1 `
  STUDENTOS_SUPABASE_ANON_KEY_1=secretref:studentos-supabase-anon-key-1 `
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_1=secretref:studentos-supabase-service-role-key-1 `
  STUDENTOS_SUPABASE_URL_2=secretref:studentos-supabase-url-2 `
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_2=secretref:studentos-supabase-service-role-key-2 `
  STUDENTOS_SUPABASE_URL_3=secretref:studentos-supabase-url-3 `
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_3=secretref:studentos-supabase-service-role-key-3 `
  STUDENTOS_SUPABASE_URL_4=secretref:studentos-supabase-url-4 `
  STUDENTOS_SUPABASE_SERVICE_ROLE_KEY_4=secretref:studentos-supabase-service-role-key-4 `
  STUDENTOS_SUPABASE_JWT_SECRET=secretref:studentos-supabase-jwt-secret `
  STUDENTOS_STORAGE_BUCKET=secretref:studentos-storage-bucket `
  STUDENTOS_EXPORT_STORAGE_BUCKET=secretref:studentos-export-storage-bucket `
  GROQ_API_KEY=secretref:groq-api-key `
  GROQ_API_KEY_1=secretref:groq-api-key-1 `
  GROQ_API_KEY_2=secretref:groq-api-key-2 `
  GROQ_API_KEY_3=secretref:groq-api-key-3 `
  GROQ_API_KEY_4=secretref:groq-api-key-4 `
  GROQ_API_KEY_5=secretref:groq-api-key-5 `
  POLLINATIONS_API_KEY=secretref:pollinations-api-key
