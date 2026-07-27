import {
  RETRIEVAL_EVALUATION_SET_VERSION,
  cosineSimilarity,
  createDeterministicEmbedding,
} from "../embeddings/embeddingService.js";

export const FIXED_RETRIEVAL_EVALUATION_SET = Object.freeze({
  version: RETRIEVAL_EVALUATION_SET_VERSION,
  description: "Small, stable StudentOS retrieval gate covering common academic intents and hard distractors.",
  documents: Object.freeze([
    { id: "quadratic_roots", text: "Quadratic roots are the values of x where ax squared plus bx plus c equals zero. They can be found by factorisation or the quadratic formula." },
    { id: "quadratic_vertex", text: "The vertex of a parabola is its turning point. In vertex form y equals a times x minus h squared plus k, the vertex is h comma k." },
    { id: "photosynthesis", text: "Photosynthesis uses chlorophyll and light energy to convert carbon dioxide and water into glucose and oxygen." },
    { id: "newton_second_law", text: "Newton's second law states that force equals mass multiplied by acceleration, written F equals ma." },
    { id: "binary_search", text: "Binary search repeatedly halves a sorted search interval and therefore runs in logarithmic time." },
    { id: "hr_succession", text: "Succession planning identifies and develops employees who can fill important future leadership roles." },
    { id: "kernel_trick", text: "The kernel trick lets a support vector machine operate as if data were mapped into a higher-dimensional feature space without explicitly computing that mapping." },
    { id: "environment_ecosystem", text: "An ecosystem contains interacting living organisms and the non-living components of their environment." },
  ]),
  cases: Object.freeze([
    { id: "roots", query: "How do I find the zeros or roots of a quadratic equation?", relevantDocumentIds: ["quadratic_roots"] },
    { id: "vertex", query: "What does h comma k represent in the vertex form of a parabola?", relevantDocumentIds: ["quadratic_vertex"] },
    { id: "chlorophyll", query: "How does chlorophyll use sunlight to make glucose?", relevantDocumentIds: ["photosynthesis"] },
    { id: "force", query: "Which law relates force, mass and acceleration?", relevantDocumentIds: ["newton_second_law"] },
    { id: "log_search", query: "Which sorted array search keeps halving the interval?", relevantDocumentIds: ["binary_search"] },
    { id: "future_leaders", query: "Which HR process prepares employees for important future positions?", relevantDocumentIds: ["hr_succession"] },
    { id: "svm_mapping", query: "How can an SVM separate nonlinear data without explicitly creating every higher-dimensional coordinate?", relevantDocumentIds: ["kernel_trick"] },
    { id: "biotic_abiotic", query: "What includes both living organisms and non-living environmental components?", relevantDocumentIds: ["environment_ecosystem"] },
  ]),
});

export function evaluateFixedRetrievalSet({
  evaluationSet = FIXED_RETRIEVAL_EVALUATION_SET,
  embed = (text) => createDeterministicEmbedding(text),
} = {}) {
  const documentVectors = new Map(evaluationSet.documents.map((document) => [document.id, embed(document.text)]));
  const results = evaluationSet.cases.map((item) => {
    const queryVector = embed(item.query);
    const ranking = evaluationSet.documents
      .map((document) => ({
        documentId: document.id,
        score: cosineSimilarity(queryVector, documentVectors.get(document.id)),
      }))
      .sort((left, right) => right.score - left.score);
    const firstRelevantRank = ranking.findIndex((entry) => item.relevantDocumentIds.includes(entry.documentId)) + 1;
    return {
      caseId: item.id,
      topDocumentId: ranking[0]?.documentId || null,
      firstRelevantRank: firstRelevantRank || null,
      reciprocalRank: firstRelevantRank ? 1 / firstRelevantRank : 0,
      passedAtOne: firstRelevantRank === 1,
      ranking,
    };
  });
  const recallAtOne = results.filter((result) => result.passedAtOne).length / Math.max(1, results.length);
  const meanReciprocalRank = results.reduce((sum, result) => sum + result.reciprocalRank, 0) / Math.max(1, results.length);
  return {
    version: evaluationSet.version,
    caseCount: results.length,
    recallAtOne: Number(recallAtOne.toFixed(4)),
    meanReciprocalRank: Number(meanReciprocalRank.toFixed(4)),
    passed: recallAtOne >= 0.75 && meanReciprocalRank >= 0.85,
    results,
  };
}
