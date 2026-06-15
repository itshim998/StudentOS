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

if [[ -z "$IMAGE" ]]; then
  echo "Set STUDENTOS_IMAGE to the image tag to deploy, for example ghcr.io/itshim998/studentos-api:<sha>." >&2
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
    registryPassword="$REGISTRY_PASSWORD"

echo "Deployment command finished. Configure runtime secrets in Azure Container Apps before production use."
