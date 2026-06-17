@description('Azure region for the Container App. Existing environment deployments must use the existing environment region.')
param location string = resourceGroup().location

@description('StudentOS Azure Container App name.')
param containerAppName string = 'studentos-api-dev'

@description('Azure Container Apps managed environment name used only when creating a new environment.')
param managedEnvironmentName string = 'cae-studentos-dev'

@description('Reuse an existing Azure Container Apps managed environment instead of creating a new one.')
param useExistingEnvironment bool = true

@description('Existing Azure Container Apps managed environment name. For the current subscription quota, reuse cae-sentiqgpt-prod.')
param existingEnvironmentName string = 'cae-sentiqgpt-prod'

@description('Resource group containing the existing Azure Container Apps managed environment.')
param existingEnvironmentResourceGroup string = 'rg-sentiqgpt-prod'

@description('Container image to deploy, for example ghcr.io/itshim998/studentos-api:<sha>.')
param image string

@description('Container target port. StudentOS reads PORT/STUDENTOS_PORT and defaults to 3101.')
param targetPort int = 3101

@description('Minimum replicas. Keep 0 for scale-to-zero cost savings.')
@minValue(0)
@maxValue(1)
param minReplicas int = 0

@description('Maximum replicas. Keep 1 for the first cost-saving deployment.')
@minValue(1)
@maxValue(1)
param maxReplicas int = 1

@description('Container CPU cores as a string because Container Apps supports fractional CPU.')
param cpuCoreValue string = '0.25'

@description('Container memory allocation.')
param memorySize string = '0.5Gi'

@description('StudentOS persistence mode. Use supabase for real deployments after runtime secrets are configured.')
param studentosMode string = 'supabase'

@description('CORS origins. Add Cloudflare frontend origin before public launch.')
param corsOrigins string = 'http://localhost:3101,http://127.0.0.1:3101'

@description('Container registry server. GHCR is preferred to avoid Azure Container Registry cost.')
param registryServer string = 'ghcr.io'

@description('Registry username for private GHCR pulls. Leave empty if the image is public.')
param registryUsername string = ''

@secure()
@description('Registry pull token for private GHCR images. Do not commit this value.')
param registryPassword string = ''

var registrySecretName = 'ghcr-pull-token'
var hasRegistryCredential = !empty(registryUsername) && !empty(registryPassword)
var existingManagedEnvironmentId = resourceId(existingEnvironmentResourceGroup, 'Microsoft.App/managedEnvironments', existingEnvironmentName)
var managedEnvironmentId = useExistingEnvironment ? existingManagedEnvironmentId : managedEnvironment.id

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = if (!useExistingEnvironment) {
  name: managedEnvironmentName
  location: location
  properties: {}
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
      }
      secrets: hasRegistryCredential ? [
        {
          name: registrySecretName
          value: registryPassword
        }
      ] : []
      registries: hasRegistryCredential ? [
        {
          server: registryServer
          username: registryUsername
          passwordSecretRef: registrySecretName
        }
      ] : []
    }
    template: {
      containers: [
        {
          name: 'studentos-api'
          image: image
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: string(targetPort)
            }
            {
              name: 'STUDENTOS_PORT'
              value: string(targetPort)
            }
            {
              name: 'STUDENTOS_ENV'
              value: 'production'
            }
            {
              name: 'STUDENTOS_DEPLOYMENT'
              value: 'azure-container-apps'
            }
            {
              name: 'STUDENTOS_SERVE_FRONTEND'
              value: 'false'
            }
            {
              name: 'STUDENTOS_MODE'
              value: studentosMode
            }
            {
              name: 'STUDENTOS_BACKGROUND_WORKERS_ENABLED'
              value: 'false'
            }
            {
              name: 'STUDENTOS_DEMO_SEED_ENABLED'
              value: 'false'
            }
            {
              name: 'STUDENTOS_GOOGLE_CLASSROOM_MODE'
              value: 'disabled'
            }
            {
              name: 'STUDENTOS_BILLING_PROVIDER'
              value: 'none'
            }
            {
              name: 'STUDENTOS_BILLING_LIVE_CHARGES_ENABLED'
              value: 'false'
            }
            {
              name: 'STUDENTOS_FINAL_ACCOUNT_DELETION_ENABLED'
              value: 'false'
            }
            {
              name: 'STUDENTOS_AUTH_ADMIN_DELETE_ENABLED'
              value: 'false'
            }
            {
              name: 'STUDENTOS_INTERNAL_OPS_ENABLED'
              value: 'false'
            }
            {
              name: 'CORS_ORIGINS'
              value: corsOrigins
            }
          ]
          resources: {
            cpu: json(cpuCoreValue)
            memory: memorySize
          }
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: []
      }
    }
  }
}

output containerAppName string = containerApp.name
output containerAppFqdn string = containerApp.properties.configuration.ingress.fqdn
output managedEnvironmentMode string = useExistingEnvironment ? 'existing' : 'created'
output containerAppEnvironmentName string = useExistingEnvironment ? existingEnvironmentName : managedEnvironmentName
output managedEnvironmentResourceGroup string = useExistingEnvironment ? existingEnvironmentResourceGroup : resourceGroup().name
output scaleSummary object = {
  minReplicas: minReplicas
  maxReplicas: maxReplicas
}
