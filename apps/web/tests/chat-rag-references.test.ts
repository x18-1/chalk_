import assert from "node:assert/strict";
import { extractRagReferences } from "../src/app/chat/rag-references";

const references = extractRagReferences({
  type: "knowledge_base_search",
  references: [{
    citationId: "cite-1",
    documentId: "doc-1",
    documentName: "函数题.pdf",
    chunkId: "doc-1-chunk-1",
    snippet: "一次函数的图像是一条直线。",
    page: 3,
  }],
});

assert.deepEqual(references, [{
  citationId: "cite-1",
  documentId: "doc-1",
  documentName: "函数题.pdf",
  chunkId: "doc-1-chunk-1",
  snippet: "一次函数的图像是一条直线。",
  page: 3,
}]);

assert.deepEqual(extractRagReferences({ type: "knowledge_base_search", references: [{ citationId: "bad" }] }), []);
console.log("chat-rag-references: ok");
