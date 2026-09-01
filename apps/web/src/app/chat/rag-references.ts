import type { RagReference } from "../../api";

/**
 * Extracts the structured references emitted by search_knowledge_base.
 * Tool details arrive over SSE and from persisted transcripts, so this
 * boundary deliberately validates the untrusted JSON before rendering it.
 */
export function extractRagReferences(value: unknown): RagReference[] {
  if (!value || typeof value !== "object") return [];
  const details = value as Record<string, unknown>;
  if (details.type !== "knowledge_base_search" || !Array.isArray(details.references)) return [];

  return details.references.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const reference = candidate as Record<string, unknown>;
    if (
      typeof reference.citationId !== "string" || !reference.citationId.trim()
      || typeof reference.documentId !== "string" || !reference.documentId.trim()
      || typeof reference.documentName !== "string" || !reference.documentName.trim()
      || typeof reference.chunkId !== "string" || !reference.chunkId.trim()
      || typeof reference.snippet !== "string"
    ) return [];

    const normalized: RagReference = {
      citationId: reference.citationId,
      documentId: reference.documentId,
      documentName: reference.documentName,
      chunkId: reference.chunkId,
      snippet: reference.snippet,
    };
    if (typeof reference.score === "number" && Number.isFinite(reference.score)) normalized.score = reference.score;
    if (typeof reference.page === "number" && Number.isInteger(reference.page) && reference.page >= 1) normalized.page = reference.page;
    if (typeof reference.paragraph === "number" && Number.isInteger(reference.paragraph) && reference.paragraph >= 1) normalized.paragraph = reference.paragraph;
    return [normalized];
  });
}

export function mergeRagReferences(current: readonly RagReference[], incoming: readonly RagReference[]) {
  const merged = [...current];
  for (const reference of incoming) {
    if (merged.some((item) => item.documentId === reference.documentId && item.chunkId === reference.chunkId)) continue;
    merged.push(reference);
  }
  return merged;
}
