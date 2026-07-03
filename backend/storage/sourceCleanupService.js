export function buildSourceCleanupPlan(state, sourceId) {
  const material = (state.sourceMaterials || []).find((source) => source.id === sourceId && !source.deletedAt);
  if (!material) return null;
  const memoryItemIds = (state.memoryItems || [])
    .filter((item) => item.sourceMaterialIds?.includes(sourceId))
    .map((item) => item.id);
  const sourceChunkIds = (state.sourceChunks || [])
    .filter((item) => item.sourceMaterialId === sourceId)
    .map((item) => item.id);
  const embeddingIds = (state.embeddingsMetadata || [])
    .filter((item) => item.sourceMaterialId === sourceId)
    .map((item) => item.id);
  const jobIds = (state.backgroundJobs || [])
    .filter((item) => item.sourceId === sourceId)
    .map((item) => item.id);
  const jobEventIds = (state.jobEvents || [])
    .filter((item) => item.sourceId === sourceId)
    .map((item) => item.id);
  const assignmentIds = (state.assignments || [])
    .filter((item) => item.sourceMaterialId === sourceId || (item.sourceMaterialIds || []).includes(sourceId))
    .map((item) => item.id);
  const syllabusIds = (state.syllabi || [])
    .filter((item) => item.sourceMaterialId === sourceId)
    .map((item) => item.id);
  return {
    sourceId,
    material,
    storageBucket: material.storageBucket || null,
    storagePath: material.storagePath || null,
    memoryItemIds,
    sourceChunkIds,
    embeddingIds,
    jobIds,
    jobEventIds,
    assignmentIds,
    syllabusIds,
  };
}

export function softDeleteSourceState(state, sourceId, timestamp = new Date().toISOString()) {
  const material = (state.sourceMaterials || []).find((source) => source.id === sourceId && !source.deletedAt);
  if (!material) return null;
  material.deletedAt = timestamp;
  material.status = "deleted";
  material.extractionStatus = "deleted";
  for (const memory of state.memoryItems || []) {
    if (memory.sourceMaterialIds?.includes(material.id)) {
      memory.deletedAt = timestamp;
      memory.status = "deleted";
    }
  }
  for (const chunk of state.sourceChunks || []) {
    if (chunk.sourceMaterialId === material.id) {
      chunk.deletedAt = timestamp;
      chunk.status = "deleted";
    }
  }
  for (const embedding of state.embeddingsMetadata || []) {
    if (embedding.sourceMaterialId === material.id) {
      embedding.status = "source_deleted";
      embedding.embeddingStatus = "source_deleted";
    }
  }
  for (const job of state.backgroundJobs || []) {
    if (job.sourceId === material.id && ["queued", "processing"].includes(job.status)) {
      job.status = "cancelled";
      job.lockedAt = null;
      job.updatedAt = timestamp;
    }
  }
  for (const syllabus of state.syllabi || []) {
    if (syllabus.sourceMaterialId !== material.id) continue;
    syllabus.archivedAt = timestamp;
    syllabus.academicContextIncluded = false;
    syllabus.updatedAt = timestamp;
  }
  return material;
}

export function hardDeleteSourceState(state, sourceId) {
  const plan = buildSourceCleanupPlan(state, sourceId);
  if (!plan) return null;
  state.sourceMaterials = (state.sourceMaterials || []).filter((item) => item.id !== sourceId);
  state.sourceChunks = (state.sourceChunks || []).filter((item) => item.sourceMaterialId !== sourceId);
  state.memoryItems = (state.memoryItems || []).filter((item) => !item.sourceMaterialIds?.includes(sourceId));
  state.embeddingsMetadata = (state.embeddingsMetadata || []).filter((item) => item.sourceMaterialId !== sourceId);
  state.backgroundJobs = (state.backgroundJobs || []).filter((item) => item.sourceId !== sourceId);
  state.jobEvents = (state.jobEvents || []).filter((item) => item.sourceId !== sourceId);
  state.assignments = (state.assignments || []).filter((item) =>
    item.sourceMaterialId !== sourceId && !(item.sourceMaterialIds || []).includes(sourceId));
  state.syllabi = (state.syllabi || []).filter((item) => item.sourceMaterialId !== sourceId);
  return plan;
}
