export function getSourceStoragePlan(config) {
  return {
    bucket: config.storage.bucket,
    publicBucket: false,
    uploadMode: "private_library_ready",
    ownership: "student_workspace",
    deletion: "student_request_review_then_remove",
    shardStorageRule: "Keep uploaded source details private to the signed-in workspace.",
    pathTemplate: "private-student-source",
  };
}
