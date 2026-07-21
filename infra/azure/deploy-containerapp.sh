#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-studentos-dev}"
CONTAINER_APP_NAME="${AZURE_CONTAINER_APP_NAME:-studentos-api-dev}"
WORKER_CONTAINER_APP_NAME="${AZURE_WORKER_CONTAINER_APP_NAME:-studentos-worker-dev}"
ENVIRONMENT_NAME="${AZURE_CONTAINER_APP_ENVIRONMENT:-cae-sentiqgpt-prod}"
USE_EXISTING_ENVIRONMENT="${AZURE_USE_EXISTING_CONTAINER_APP_ENVIRONMENT:-true}"
EXISTING_ENVIRONMENT_NAME="${AZURE_CONTAINER_APP_ENVIRONMENT:-cae-sentiqgpt-prod}"
EXISTING_ENVIRONMENT_RESOURCE_GROUP="${AZURE_CONTAINER_APP_ENVIRONMENT_RESOURCE_GROUP:-rg-sentiqgpt-prod}"
LOCATION="${AZURE_LOCATION:-centralindia}"
IMAGE="${STUDENTOS_IMAGE:-}"
TARGET_PORT="${STUDENTOS_TARGET_PORT:-3101}"
MIN_REPLICAS="${STUDENTOS_MIN_REPLICAS:-0}"
MAX_REPLICAS="${STUDENTOS_MAX_REPLICAS:-1}"
REGISTRY_SERVER="${REGISTRY_SERVER:-ghcr.io}"
REGISTRY_USERNAME="${REGISTRY_USERNAME:-}"
REGISTRY_PASSWORD="${GHCR_PULL_TOKEN:-}"

require_value() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "$name is required." >&2
    exit 1
  fi
}

require_value "AZURE_RESOURCE_GROUP" "$RESOURCE_GROUP"
require_value "AZURE_CONTAINER_APP_NAME" "$CONTAINER_APP_NAME"
require_value "AZURE_WORKER_CONTAINER_APP_NAME" "$WORKER_CONTAINER_APP_NAME"
require_value "AZURE_CONTAINER_APP_ENVIRONMENT" "$ENVIRONMENT_NAME"
require_value "AZURE_LOCATION" "$LOCATION"
require_value "STUDENTOS_IMAGE" "$IMAGE"

if [[ "$USE_EXISTING_ENVIRONMENT" == "true" ]]; then
  require_value "AZURE_CONTAINER_APP_ENVIRONMENT" "$EXISTING_ENVIRONMENT_NAME"
  require_value "AZURE_CONTAINER_APP_ENVIRONMENT_RESOURCE_GROUP" "$EXISTING_ENVIRONMENT_RESOURCE_GROUP"
fi

if [[ "$MIN_REPLICAS" != "0" ]]; then
  echo "Cost-saving first deploy requires STUDENTOS_MIN_REPLICAS=0." >&2
  exit 1
fi
if [[ "$MAX_REPLICAS" != "1" ]]; then
  echo "Cost-saving first deploy requires STUDENTOS_MAX_REPLICAS=1." >&2
  exit 1
fi
if [[ "$TARGET_PORT" != "3101" ]]; then
  echo "StudentOS first deploy expects STUDENTOS_TARGET_PORT=3101." >&2
  exit 1
fi

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI is required. Install az CLI and authenticate before running this script." >&2
  exit 1
fi

if [[ -n "$REGISTRY_USERNAME" && -z "$REGISTRY_PASSWORD" ]]; then
  echo "REGISTRY_USERNAME is set but GHCR_PULL_TOKEN is missing. Do not pass token values directly on the command line." >&2
  exit 1
fi

echo "Creating/updating StudentOS resource group $RESOURCE_GROUP in $LOCATION"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

if [[ "$USE_EXISTING_ENVIRONMENT" == "true" ]]; then
  echo "Reusing existing ACA environment $EXISTING_ENVIRONMENT_NAME from resource group $EXISTING_ENVIRONMENT_RESOURCE_GROUP"
else
  echo "Creating/updating ACA environment $ENVIRONMENT_NAME in StudentOS resource group $RESOURCE_GROUP"
fi

echo "Deploying StudentOS API $CONTAINER_APP_NAME (min=0 max=1) and worker $WORKER_CONTAINER_APP_NAME (min=1 max=1)"
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file infra/azure/containerapp.bicep \
  --parameters location="$LOCATION" \
    containerAppName="$CONTAINER_APP_NAME" \
    workerContainerAppName="$WORKER_CONTAINER_APP_NAME" \
    managedEnvironmentName="$ENVIRONMENT_NAME" \
    useExistingEnvironment="$USE_EXISTING_ENVIRONMENT" \
    existingEnvironmentName="$EXISTING_ENVIRONMENT_NAME" \
    existingEnvironmentResourceGroup="$EXISTING_ENVIRONMENT_RESOURCE_GROUP" \
    image="$IMAGE" \
    targetPort="$TARGET_PORT" \
    minReplicas="$MIN_REPLICAS" \
    maxReplicas="$MAX_REPLICAS" \
    registryServer="$REGISTRY_SERVER" \
    registryUsername="$REGISTRY_USERNAME" \
    registryPassword="$REGISTRY_PASSWORD" \
  --output none

echo "Safe deployment summary:"
az containerapp show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$CONTAINER_APP_NAME" \
  --query "{name:name,fqdn:properties.configuration.ingress.fqdn,min:properties.template.scale.minReplicas,max:properties.template.scale.maxReplicas,latestRevision:properties.latestRevisionName}" \
  --output table

az containerapp show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$WORKER_CONTAINER_APP_NAME" \
  --query "{name:name,ingress:properties.configuration.ingress,min:properties.template.scale.minReplicas,max:properties.template.scale.maxReplicas,image:properties.template.containers[0].image,command:properties.template.containers[0].command,args:properties.template.containers[0].args,latestRevision:properties.latestRevisionName,runningStatus:properties.runningStatus}" \
  --output table

echo "Map the same Supabase/provider secrets to both apps. Use 'az containerapp logs show --follow --name $WORKER_CONTAINER_APP_NAME --resource-group $RESOURCE_GROUP' for worker logs; restart by creating a new revision after checking stale job locks."
