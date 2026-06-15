# Azure Cost Saver Runbook

This runbook keeps the first StudentOS backend deployment cheap and reversible.

## Cost Controls

- Use Azure Container Apps Consumption.
- Keep `minReplicas=0` for scale-to-zero.
- Keep `maxReplicas=1` for the first deployment.
- Use the smallest safe container size: `0.25` CPU and `0.5Gi` memory.
- Use GHCR instead of Azure Container Registry to avoid ACR cost.
- Do not run always-on background workers.
- Do not add warmup pingers.
- Do not add Azure SQL.
- Do not duplicate Supabase Storage into Azure Storage.
- Keep production log verbosity low.

## Budget Alert Checklist

Create an Azure budget before the first live deployment:

1. Open Azure Cost Management.
2. Create a budget scoped to the subscription or resource group.
3. Set a low dev budget threshold.
4. Add email alerts at 50%, 80%, and 100%.
5. Review Container Apps revision and replica counts after test traffic.

## Check Replica Count and Revision

```powershell
az containerapp show `
  --resource-group rg-studentos-dev `
  --name studentos-api-dev `
  --query "{fqdn:properties.configuration.ingress.fqdn,min:properties.template.scale.minReplicas,max:properties.template.scale.maxReplicas,latestRevision:properties.latestRevisionName,runningStatus:properties.runningStatus}" `
  --output table
```

List revisions:

```powershell
az containerapp revision list `
  --resource-group rg-studentos-dev `
  --name studentos-api-dev `
  --output table
```

## Scale to Zero

```powershell
az containerapp update `
  --resource-group rg-studentos-dev `
  --name studentos-api-dev `
  --min-replicas 0 `
  --max-replicas 1
```

## Emergency Stop

Disable ingress:

```powershell
az containerapp ingress disable `
  --resource-group rg-studentos-dev `
  --name studentos-api-dev
```

Set max replicas to zero is not supported for active Container Apps. Use min replicas 0 plus disabled ingress, or delete the app if the deployment must be stopped immediately.

## Delete Dev App

```powershell
az containerapp delete `
  --resource-group rg-studentos-dev `
  --name studentos-api-dev `
  --yes
```

Delete the dev resource group only if it contains no shared resources:

```powershell
az group delete --name rg-studentos-dev --yes
```

## Worker Cost Policy

Do not run `jobs:dev`, `jobs:work`, `exports:dev`, or `exports:work` continuously in the web app. Use future Azure Container Apps Jobs for manual/scheduled processing after a separate review.
