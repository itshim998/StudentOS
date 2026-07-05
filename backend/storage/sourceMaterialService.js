import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import { PDFParse } from "pdf-parse";

export const MAX_SOURCE_UPLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_EXTRACTED_TEXT_CHARS = 120_000;
export const MIN_PDF_TEXT_CHARS_BEFORE_OCR = 24;

const ALLOWED_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const EXTENSION_MIME = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

function normalizeFilename(filename) {
  const clean = basename(String(filename || "source-material").replace(/[/\\]+/g, "-"))
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .replace(/\.\.+/g, ".")
    .replace(/^[.-]+/, "")
    .replace(/\s+/g, "-")
    .slice(0, 120);
  return clean || "source-material";
}

export function inferMimeType(filename, mimeType = "") {
  const explicit = String(mimeType || "").split(";")[0].trim().toLowerCase();
  if (explicit && explicit !== "application/octet-stream") return explicit;
  return EXTENSION_MIME[extname(String(filename || "")).toLowerCase()] || "application/octet-stream";
}

export function validateSourceUpload({ filename, mimeType, sizeBytes }) {
  const safeFilename = normalizeFilename(filename);
  const resolvedMimeType = inferMimeType(safeFilename, mimeType);
  const size = Number(sizeBytes);
  const errors = [];
  if (!safeFilename) errors.push("filename_required");
  if (!Number.isFinite(size) || size <= 0) errors.push("file_empty");
  if (size > MAX_SOURCE_UPLOAD_BYTES) errors.push("file_too_large");
  if (!ALLOWED_MIME_TYPES.has(resolvedMimeType)) errors.push("unsupported_file_type");
  return {
    ok: errors.length === 0,
    errors,
    filename: safeFilename,
    mimeType: resolvedMimeType,
    sizeBytes: size,
    maxBytes: MAX_SOURCE_UPLOAD_BYTES,
  };
}

export function validateAcademicContextPdfUpload({ filename, mimeType, sizeBytes, bytes }) {
  const validation = validateSourceUpload({ filename, mimeType, sizeBytes });
  const headerOffset = Buffer.from(bytes || []).subarray(0, 1024).indexOf("%PDF-");
  const pdfOnly = extname(String(filename || "")).toLowerCase() === ".pdf" &&
    validation.mimeType === "application/pdf" &&
    headerOffset >= 0;
  const errors = validation.errors.filter((error) => error !== "unsupported_file_type");
  if (!pdfOnly) errors.push("pdf_required");
  return {
    ...validation,
    ok: errors.length === 0,
    errors: [...new Set(errors)],
  };
}

export function createSafeStoragePath({ userId, courseId, sourceId, filename }) {
  const safeFilename = normalizeFilename(filename);
  const safeCourseId = String(courseId || "uncategorized").replace(/[^a-zA-Z0-9_-]+/g, "-");
  const safeSourceId = String(sourceId || randomUUID()).replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `${encodeURIComponent(userId)}/${safeCourseId}/${safeSourceId}/${safeFilename}`;
}

function normalizeExtractedText(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeExtractionError(error) {
  const raw = String(error?.message || error || "extraction_failed").toLowerCase();
  if (raw.includes("password")) return "pdf_password_protected";
  if (raw.includes("invalid") || raw.includes("format")) return "invalid_pdf";
  if (raw.includes("encrypted")) return "pdf_encrypted";
  if (raw.includes("abort")) return "pdf_extraction_timeout";
  return "pdf_extraction_failed";
}

export function needsOcrForPdfText(text) {
  return normalizeExtractedText(text).length < MIN_PDF_TEXT_CHARS_BEFORE_OCR;
}

async function extractPdfText({ bytes, filename }) {
  let parser = null;
  try {
    parser = new PDFParse({ data: Buffer.from(bytes) });
    const result = await parser.getText();
    const text = normalizeExtractedText(result.text).slice(0, MAX_EXTRACTED_TEXT_CHARS);
    if (needsOcrForPdfText(text)) {
      return {
        status: "needs_ocr",
        extractedText: "",
        extractionSummary: "This PDF appears scanned or image-heavy. OCR is needed before StudentOS can cite it.",
        extractionError: "ocr_needed",
        extractionPages: result.total || 0,
        extractionProvider: "pdf-parse",
        ocrRequired: true,
      };
    }
    return {
      status: "indexed",
      extractedText: text,
      extractionSummary: `Extracted ${text.length} character(s) from ${result.total || "unknown"} PDF page(s).`,
      extractionError: null,
      extractionPages: result.total || null,
      extractionProvider: "pdf-parse",
    };
  } catch (error) {
    return {
      status: "failed",
      extractedText: "",
      extractionSummary: `PDF extraction failed for ${normalizeFilename(filename)}.`,
      extractionError: sanitizeExtractionError(error),
      extractionPages: null,
      extractionProvider: "pdf-parse",
    };
  } finally {
    if (parser) {
      await parser.destroy().catch(() => {});
    }
  }
}

export async function extractSourceText({ bytes, mimeType, filename }) {
  const resolvedMimeType = inferMimeType(filename, mimeType);
  if (resolvedMimeType === "text/plain" || resolvedMimeType === "text/markdown") {
    const text = normalizeExtractedText(Buffer.from(bytes).toString("utf8"));
    const clipped = text.slice(0, MAX_EXTRACTED_TEXT_CHARS);
    if (!clipped) {
      return {
        status: "failed",
        extractedText: "",
        extractionSummary: "No usable text was extracted from the uploaded file.",
        extractionError: "empty_text_after_trim",
        extractionPages: null,
        extractionProvider: "text-decoder",
      };
    }
    return {
      status: "indexed",
      extractedText: clipped,
      extractionSummary: `Extracted ${clipped.length} character(s) from uploaded text material.`,
      extractionError: null,
      extractionPages: null,
      extractionProvider: resolvedMimeType === "text/markdown" ? "markdown-text-decoder" : "text-decoder",
    };
  }
  if (resolvedMimeType === "application/pdf") {
    return extractPdfText({ bytes, filename });
  }
  return {
    status: "failed",
    extractedText: "",
    extractionSummary: "Document extraction is not enabled for this file type yet. The private file metadata is registered, but it will not be used for citations until extraction is added.",
    extractionError: "document_extraction_pending",
    extractionPages: null,
    extractionProvider: "placeholder",
  };
}

export function chunkExtractedText(text, { maxChars = 900, overlapChars = 120 } = {}) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const chunks = [];
  let index = 0;
  let cursor = 0;
  while (cursor < normalized.length) {
    const hardEnd = Math.min(cursor + maxChars, normalized.length);
    let end = hardEnd;
    if (hardEnd < normalized.length) {
      const sentenceBreak = normalized.lastIndexOf(". ", hardEnd);
      const softBreak = normalized.lastIndexOf(" ", hardEnd);
      end = sentenceBreak > cursor + maxChars * 0.55 ? sentenceBreak + 1 : softBreak > cursor ? softBreak : hardEnd;
    }
    const chunkText = normalized.slice(cursor, end).trim();
    if (chunkText) {
      chunks.push({
        chunkIndex: index,
        text: chunkText,
        charCount: chunkText.length,
        tokenEstimate: Math.ceil(chunkText.length / 4),
      });
      index += 1;
    }
    if (end >= normalized.length) break;
    cursor = Math.max(end - overlapChars, cursor + 1);
  }
  return chunks;
}

export function createSourceMaterialRecord({ session, course, courseId, title, file, config, extraction, artifactKind = "material", contextKind = null }) {
  const sourceId = `src_upload_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const validation = validateSourceUpload({
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.bytes.length,
  });
  if (!validation.ok) {
    const error = new Error(`Invalid source upload: ${validation.errors.join(", ")}`);
    error.status = 400;
    error.validation = validation;
    throw error;
  }
  const storagePath = createSafeStoragePath({
    userId: session.user.id,
    courseId,
    sourceId,
    filename: validation.filename,
  });
  const citationLabel = `${title || validation.filename} (${course?.title || "Student upload"})`;
  return {
    id: sourceId,
    userId: session.user.id,
    courseId,
    title: title || validation.filename,
    kind: "uploaded_file",
    sourceType: "uploaded_file",
    artifactKind,
    contextKind: contextKind || (artifactKind === "material" ? "study_material" : artifactKind),
    filename: validation.filename,
    mimeType: validation.mimeType,
    sizeBytes: validation.sizeBytes,
    storageMode: "private_supabase_storage",
    storageBucket: config.storage.bucket,
    storagePath,
    status: extraction.status,
    extractionStatus: extraction.status,
    extractedText: extraction.extractedText,
    extractionSummary: extraction.extractionSummary,
    extractionError: extraction.extractionError || null,
    extractionPages: extraction.extractionPages ?? null,
    extractionProvider: extraction.extractionProvider || null,
    indexedAt: extraction.status === "indexed" ? new Date().toISOString() : null,
    failedAt: extraction.status === "failed" ? new Date().toISOString() : null,
    citationLabel,
    webFallbackAllowed: true,
    isPrivate: true,
    publicUrlAllowed: false,
    createdAt: new Date().toISOString(),
  };
}

export function createMemoryItemForSource({ material, course, topicId = null }) {
  return {
    id: `mem_${material.id}`,
    userId: material.userId,
    courseId: material.courseId,
    topicId,
    kind: "source_extraction",
    title: `Extraction: ${material.title}`,
    body: material.extractedText || material.extractionSummary || "",
    sourceMaterialIds: [material.id],
    sourceLabels: [material.citationLabel],
    visibility: "student_private",
    courseTitle: course?.title || "Course",
    createdAt: new Date().toISOString(),
  };
}

export function createSourceChunks({ material, chunks }) {
  return chunks.map((chunk) => ({
    id: `chunk_${material.id}_${chunk.chunkIndex}`,
    userId: material.userId,
    sourceMaterialId: chunk.sourceMaterialId || material.id,
    courseId: material.courseId,
    topicId: null,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    charCount: chunk.charCount,
    tokenEstimate: chunk.tokenEstimate,
    citationLabel: `${material.citationLabel} #${chunk.chunkIndex + 1}`,
    status: "indexed",
    embeddingStatus: "pending_embedding",
    embeddingProvider: "pending",
    embeddingModel: "pending",
    embeddingHash: null,
    embeddingDimensions: null,
    embeddingVector: null,
    embeddingUpdatedAt: null,
    embeddingError: null,
    createdAt: new Date().toISOString(),
  }));
}

export function createEmbeddingMetadataForChunks({ material, sourceChunks }) {
  return sourceChunks.map((chunk) => ({
    id: `emb_${chunk.id}`,
    userId: material.userId,
    sourceMaterialId: chunk.sourceMaterialId || material.id,
    sourceChunkId: chunk.id,
    memoryItemId: null,
    vectorTable: "source_chunks",
    vectorRef: chunk.id,
    chunkIndex: chunk.chunkIndex,
    dimensions: chunk.embeddingDimensions ?? null,
    embeddingHash: chunk.embeddingHash || null,
    embeddingValues: chunk.embeddingVector || null,
    embeddingStatus: chunk.embeddingStatus || "pending_embedding",
    provider: chunk.embeddingProvider || "pending",
    model: chunk.embeddingModel || "pending",
    status: chunk.embeddingStatus || "pending_embedding",
    error: chunk.embeddingError || null,
    createdAt: new Date().toISOString(),
  }));
}
