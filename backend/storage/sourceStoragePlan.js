export function getSourceStoragePlan(config) {
  return {
    bucket: config.storage.bucket,
    publicBucket: false,
    uploadMode: "metadata_ready",
    ownership: "source_materials.user_id",
    deletion: "soft_delete_metadata_then_delete_object_later",
    shardStorageRule: "Store private file metadata on the routed data shard; keep object paths user-scoped.",
    pathTemplate: "{user_id}/{course_id}/{source_material_id}/{filename}",
  };
}
