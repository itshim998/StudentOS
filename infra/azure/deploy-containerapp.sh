#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-studentos-dev}"
CONTAINER_APP_NAME="${AZURE_CONTAINER_APP_NAME:-studentos-api-dev}"
ENVIRONMENT_NAME="${AZURE_CONTAINER_APP_ENVIRONMENT:-cae-studentos-dev}"
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
require_value "AZURE_CONTAINER_APP_ENVIRONMENT" "$ENVIRONMENT_NAME"
require_value "AZURE_LOCATION" "$LOCATION"
require_value "STUDENTOS_IMAGE" "$IMAGE"

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

echo "Creating/updating resource group $RESOURCE_GROUP in $LOCATION"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

echo "Deploying StudentOS Container App $CONTAINER_APP_NAME with min=0 max=1"
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file infra/azure/containerapp.bicep \
  --parameters location="$LOCATION" \
    containerAppName="$CONTAINER_APP_NAME" \
    managedEnvironmentName="$ENVIRONMENT_NAME" \
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

echo "Runtime Supabase/provider secrets must be configured as Container Apps secrets before production use."
