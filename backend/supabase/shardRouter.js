import { createHash } from "node:crypto";

export function stableHashToInteger(value) {
  const digest = createHash("sha256").update(String(value || "")).digest();
  return digest.readUInt32BE(0);
}

export function routeUserToShard(userId, shards) {
  const availableShards = Array.isArray(shards) ? shards.filter((shard) => shard?.client?.isConfigured?.()) : [];
  if (!userId) {
    throw new Error("Cannot route an empty user id to a data shard");
  }
  if (availableShards.length === 0) {
    return {
      mode: "mock",
      index: 0,
      projectNumber: null,
      label: "mock-local",
      client: null,
      expansion: {
        algorithm: "sha256_modulo",
        shardCount: 0,
      },
    };
  }
  const hash = stableHashToInteger(userId);
  const selected = availableShards[hash % availableShards.length];
  return {
    mode: "supabase",
    index: selected.index,
    projectNumber: selected.projectNumber,
    label: selected.label,
    client: selected.client,
    expansion: {
      algorithm: "sha256_modulo",
      shardCount: availableShards.length,
    },
  };
}

export function publicShardRoute(route) {
  return {
    mode: route.mode,
    index: route.index,
    projectNumber: route.projectNumber,
    label: route.label,
    expansion: route.expansion,
  };
}
