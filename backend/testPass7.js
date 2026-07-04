import assert from "node:assert/strict";
import { answerFromStudentMaterials, retrieveGroundedSources } from "./domain/studentosDomain.js";
import { createSeedState } from "../tests/fixtures/studentAcademicState.js";
import { getAiProviderConfig } from "./ai/providerConfig.js";
import { resetProviderRuntimeForTests, runProviderFallback } from "./ai/providers.js";
import { runStudentOsVerb } from "./ai/studentBrainAdapter.js";
import {
  chunkExtractedText,
  createEmbeddingMetadataForChunks,
  createMemoryItemForSource,
  createSourceChunks,
  createSourceMaterialRecord,
  extractSourceText,
} from "./storage/sourceMaterialService.js";

function tinyPdfBuffer() {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 74 >>
stream
BT
/F1 24 Tf
100 700 Td
(Quadratic PDF extraction roots vertex factors) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000234 00000 n
0000000358 00000 n
trailer
<< /Root 1 0 R /Size 6 >>
startxref
428
%%EOF`;
  return Buffer.from(pdf, "utf8");
}

const pdfExtraction = await extractSourceText({
  bytes: tinyPdfBuffer(),
  mimeType: "application/pdf",
  filename: "quadratics.pdf",
});
assert.equal(pdfExtraction.status, "indexed");
assert.equal(pdfExtraction.extractionProvider, "pdf-parse");
assert.equal(pdfExtraction.extractionPages, 1);
assert.match(pdfExtraction.extractedText, /Quadratic PDF extraction/);

const badPdfExtraction = await extractSourceText({
  bytes: Buffer.from("%PDF-1.4\nnot a valid pdf", "utf8"),
  mimeType: "application/pdf",
  filename: "broken.pdf",
});
assert.equal(badPdfExtraction.status, "failed");
assert.equal(badPdfExtraction.extractedText, "");
assert.match(badPdfExtraction.extractionError, /pdf|invalid/);

const markdownExtraction = await extractSourceText({
  bytes: Buffer.from("# Roots\nMarkdown notes still extract quadratic roots.", "utf8"),
  mimeType: "text/markdown",
  filename: "roots.md",
});
assert.equal(markdownExtraction.status, "indexed");
assert.match(markdownExtraction.extractedText, /Markdown notes/);

const state = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
state.sourceMaterials = [];
state.sourceChunks = [];
state.memoryItems = [];
state.embeddingsMetadata = [];
const course = state.courses.find((item) => item.id === "course_alg2");
const topic = state.topics.find((item) => item.id === "topic_quadratics");
const session = { user: { id: "student_demo_001" } };
const material = createSourceMaterialRecord({
  session,
  course,
  courseId: course.id,
  title: "PDF roots guide",
  file: {
    filename: "quadratics.pdf",
    mimeType: "application/pdf",
    bytes: tinyPdfBuffer(),
  },
  config: { storage: { bucket: "studentos-source-materials" } },
  extraction: {
    ...pdfExtraction,
    status: "extracting",
  },
});
assert.equal(material.status, "extracting");
material.status = pdfExtraction.status;
material.extractionStatus = pdfExtraction.status;
material.extractedText = pdfExtraction.extractedText;
material.extractionSummary = pdfExtraction.extractionSummary;
material.extractionError = pdfExtraction.extractionError;
material.extractionPages = pdfExtraction.extractionPages;
material.extractionProvider = pdfExtraction.extractionProvider;
material.indexedAt = new Date().toISOString();
material.chunkCount = 0;

const chunks = chunkExtractedText(pdfExtraction.extractedText, { maxChars: 120, overlapChars: 20 });
const sourceChunks = createSourceChunks({ material, chunks });
material.chunkCount = sourceChunks.length;
const memoryItem = createMemoryItemForSource({ material, course, topicId: topic.id });
const embeddingRows = createEmbeddingMetadataForChunks({ material, sourceChunks });
state.sourceMaterials.push(material);
state.sourceChunks.push(...sourceChunks);
state.memoryItems.push(memoryItem);
state.embeddingsMetadata.push(...embeddingRows);

const retrieved = retrieveGroundedSources({
  state,
  message: "Explain quadratic roots from the uploaded PDF",
  topic,
  course,
});
assert.equal(retrieved.hasUploadedMaterial, true);
assert(retrieved.chunks.length > 0);
assert.equal(retrieved.labels[0].type, "uploaded_chunk");
assert.match(retrieved.chunks[0].snippet, /Quadratic PDF extraction/);

const groundedAnswer = answerFromStudentMaterials({
  verb: "Ask",
  message: "Explain quadratic roots from the uploaded PDF",
  state,
});
assert.equal(groundedAnswer.grounding.uploadedMaterialUsed, true);
assert(groundedAnswer.grounding.snippets.length > 0);

const emptyState = createSeedState(new Date("2026-05-25T10:00:00+05:30"));
emptyState.sourceMaterials = [];
emptyState.sourceChunks = [];
emptyState.memoryItems = [];
const noCitationAnswer = await runStudentOsVerb({
  verb: "Ask",
  message: "Cite my uploaded lab manual",
  state: emptyState,
  fetchImpl: async () => {
    throw new Error("fetch_should_not_run_without_keys");
  },
});
assert.equal(noCitationAnswer.provider, "none");
assert.equal(noCitationAnswer.generationSucceeded, false);
assert.equal(noCitationAnswer.internalFailureCode, "no_provider_configured");
assert.equal(noCitationAnswer.answer, "I could not complete that answer right now. Please try again.");
assert.equal(noCitationAnswer.sourceLabels.length, 0);
assert.equal(noCitationAnswer.grounding.snippets.length, 0);
assert.equal(noCitationAnswer.grounding.insufficientContext, false);

resetProviderRuntimeForTests();
const groqConfig = getAiProviderConfig({
  STUDENTOS_AI_MODE: "auto",
  GROQ_API_KEY: "test-key-one",
  GROQ_API_KEY_2: "test-key-two",
  GROQ_CHAT_MODEL: "openai/gpt-oss-120b",
});
const groqCalls = [];
const groqResult = await runProviderFallback({
  config: groqConfig,
  messages: [{ role: "user", content: "Use [S1] only." }],
  fetchImpl: async (url, init) => {
    groqCalls.push({ url, auth: init.headers.Authorization });
    if (groqCalls.length === 1) {
      return new Response(JSON.stringify({ error: "rate limit" }), { status: 429 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "Grounded answer from [S1]." } }] }), { status: 200 });
  },
});
assert.equal(groqResult.provider, "groq_grounded");
assert.equal(groqResult.keyIndexUsed, 2);
assert.equal(groqCalls.length, 2);
assert.equal(JSON.stringify(groqResult).includes("test-key"), false);

const pollinationsConfig = getAiProviderConfig({
  STUDENTOS_AI_MODE: "auto",
  GROQ_API_KEY: "test-key-one",
  POLLINATIONS_API_KEY: "pollinations-key",
  POLLINATIONS_TEXT_MODEL: "mistral-4",
});
const pollinationsResult = await runProviderFallback({
  config: pollinationsConfig,
  messages: [{ role: "user", content: "Use source snippets." }],
  fetchImpl: async (url) => {
    if (String(url).includes("groq")) {
      return new Response(JSON.stringify({ error: "groq down" }), { status: 500 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "Pollinations fallback answer." } }] }), { status: 200 });
  },
});
assert.equal(pollinationsResult.provider, "pollinations_text_fallback");
assert.equal(pollinationsResult.modelUsed, "mistral-4");

console.log("PASS | StudentOS Pass 7 PDF extraction and grounded AI provider tests passed");
