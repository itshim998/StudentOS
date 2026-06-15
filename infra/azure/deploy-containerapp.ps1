param(
  [string]$ResourceGroup = "rg-studentos-dev",
  [string]$ContainerAppName = "studentos-api-dev",
  [string]$EnvironmentName = "cae-studentos-dev",
  [string]$Location = "centralindia",
  [Parameter(Mandatory = $true)]
  [string]$Image,
  [int]$TargetPort = 3101,
  [int]$MinReplicas = 0,
  [int]$MaxReplicas = 1,
  [string]$RegistryServer = "ghcr.io",
  [string]$RegistryUsername = "",
  [string]$RegistryPasswordEnvName = "GHCR_PULL_TOKEN"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw "Azure CLI is required. Install az CLI and run az login before using this script."
}

$registryPassword = ""
if ($RegistryUsername) {
  $registryPassword = [Environment]::GetEnvironmentVariable($RegistryPasswordEnvName)
  if (-not $registryPassword) {
    throw "Registry username was provided, but `$env:$RegistryPasswordEnvName is missing. Do not paste token values into the command line."
  }
}

Write-Host "Creating/updating resource group $ResourceGroup in $Location"
az group create --name $ResourceGroup --location $Location --output none

Write-Host "Deploying StudentOS Container App $ContainerAppName with min=0 max=1"
az deployment group create `
  --resource-group $ResourceGroup `
  --template-file infra/azure/containerapp.bicep `
  --parameters location=$Location `
    containerAppName=$ContainerAppName `
    managedEnvironmentName=$EnvironmentName `
    image=$Image `
    targetPort=$TargetPort `
    minReplicas=$MinReplicas `
    maxReplicas=$MaxReplicas `
    registryServer=$RegistryServer `
    registryUsername=$RegistryUsername `
    registryPassword=$registryPassword

Write-Host "Deployment command finished. Configure runtime secrets in Azure Container Apps before production use."
