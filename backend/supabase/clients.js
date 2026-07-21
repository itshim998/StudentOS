import { SupabaseAuthClient, SupabaseRestClient } from "./restClient.js";

export function createSupabaseClients(config) {
  const authClient = new SupabaseAuthClient({
    url: config.auth.url,
    anonKey: config.auth.anonKey,
    serviceRoleKey: config.auth.serviceRoleKey,
  });

  const shardClients = config.shards.map((shard) => ({
    ...shard,
    client: new SupabaseRestClient({
      url: shard.url,
      key: shard.serviceRoleKey,
      label: shard.label,
      role: "service_role",
    }),
  }));

  const routerClient = new SupabaseRestClient({
    url: config.auth.url,
    key: config.auth.serviceRoleKey,
    label: "auth-project-1-ai-router",
    role: "service_role",
  });

  return {
    authClient,
    shardClients,
    routerClient,
  };
}
