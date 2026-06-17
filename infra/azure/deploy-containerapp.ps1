param(
  [string]$ResourceGroup = "rg-studentos-dev",
  [string]$ContainerAppName = "studentos-api-dev",
  [string]$EnvironmentName = "cae-sentiqgpt-prod",
  [string]$ExistingEnvironmentName = "cae-sentiqgpt-prod",
  [string]$ExistingEnvironmentResourceGroup = "rg-sentiqgpt-prod",
  [bool]$UseExistingEnvironment = $true,
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

function Assert-NotBlank([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "$Name is required."
  }
}

Assert-NotBlank "ResourceGroup" $ResourceGroup
Assert-NotBlank "ContainerAppName" $ContainerAppName
Assert-NotBlank "EnvironmentName" $EnvironmentName
Assert-NotBlank "Location" $Location
Assert-NotBlank "Image" $Image

if ($UseExistingEnvironment) {
  Assert-NotBlank "ExistingEnvironmentName" $ExistingEnvironmentName
  Assert-NotBlank "ExistingEnvironmentResourceGroup" $ExistingEnvironmentResourceGroup
}

if ($MinReplicas -ne 0) { throw "Cost-saving first deploy requires MinReplicas=0." }
if ($MaxReplicas -ne 1) { throw "Cost-saving first deploy requires MaxReplicas=1." }
if ($TargetPort -ne 3101) { throw "StudentOS first deploy expects TargetPort=3101." }

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw "Azure CLI is required. Install az CLI and run az login before using this script."
}

$UseExistingEnvironmentValue = $UseExistingEnvironment.ToString().ToLowerInvariant()
$registryPassword = ""
if ($RegistryUsername) {
  $registryPassword = [Environment]::GetEnvironmentVariable($RegistryPasswordEnvName)
  if (-not $registryPassword) {
    throw "Registry username was provided, but `$env:$RegistryPasswordEnvName is missing. Do not paste token values into the command line."
  }
}

Write-Host "Creating/updating StudentOS resource group $ResourceGroup in $Location"
az group create --name $ResourceGroup --location $Location --output none

if ($UseExistingEnvironment) {
  Write-Host "Reusing existing ACA environment $ExistingEnvironmentName from resource group $ExistingEnvironmentResourceGroup"
} else {
  Write-Host "Creating/updating ACA environment $EnvironmentName in StudentOS resource group $ResourceGroup"
}

Write-Host "Deploying StudentOS Container App $ContainerAppName with min=0 max=1"
az deployment group create `
  --resource-group $ResourceGroup `
  --template-file infra/azure/containerapp.bicep `
  --parameters location=$Location `
    containerAppName=$ContainerAppName `
    managedEnvironmentName=$EnvironmentName `
    useExistingEnvironment=$UseExistingEnvironmentValue `
    existingEnvironmentName=$ExistingEnvironmentName `
    existingEnvironmentResourceGroup=$ExistingEnvironmentResourceGroup `
    image=$Image `
    targetPort=$TargetPort `
    minReplicas=$MinReplicas `
    maxReplicas=$MaxReplicas `
    registryServer=$RegistryServer `
    registryUsername=$RegistryUsername `
    registryPassword=$registryPassword `
  --output none

Write-Host "Safe deployment summary:"
az containerapp show `
  --resource-group $ResourceGroup `
  --name $ContainerAppName `
  --query "{name:name,fqdn:properties.configuration.ingress.fqdn,min:properties.template.scale.minReplicas,max:properties.template.scale.maxReplicas,latestRevision:properties.latestRevisionName}" `
  --output table

Write-Host "Runtime Supabase/provider secrets must be configured as Container Apps secrets before production use."
