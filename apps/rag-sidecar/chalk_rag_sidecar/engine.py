from __future__ import annotations

import os
import re
import time
import json
import asyncio
from pathlib import Path
from typing import Any
from uuid import UUID

from .parser import ParsedDocument, parse_document


def validate_identifier(value: str, label: str) -> str:
    """Validate IDs before they are used as workspace/path components."""
    try:
        parsed = UUID(value)
    except (ValueError, AttributeError, TypeError) as exc:
        raise ValueError(f"{label} must be a UUID") from exc
    canonical = str(parsed)
    if value != canonical:
        raise ValueError(f"{label} must use canonical UUID form")
    return canonical


def validate_filename(value: str) -> str:
    """Accept only a display basename; never let a path enter the index."""
    if not value or Path(value).name != value or "\\" in value or value in {".", ".."}:
        raise ValueError("filename must be a canonical basename")
    return value


def normalise_rerank_payload(payload: Any) -> list[Any]:
    """Accept LightRAG-compatible reranker response envelopes.

    Providers commonly return either a bare result list or an object with a
    ``results`` property.  Never call ``dict.get`` on a list (the previous
    implementation crashed for the bare-list form).
    """
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        results = payload.get("results", [])
        return results if isinstance(results, list) else []
    return []


def rerank_succeeded(items: Any, *, enabled: bool, configured: bool) -> bool:
    """Return true only when LightRAG exposes scores from a successful rerank."""
    if not (enabled and configured) or not isinstance(items, list):
        return False
    return any(isinstance(item, dict) and item.get("rerank_score") is not None for item in items)


class LightRagEngine:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._instances: dict[str, Any] = {}
        self._documents: dict[str, dict[str, dict[str, Any]]] = {}
        self._rerank_success: dict[str, bool] = {}
        self._query_locks: dict[str, asyncio.Lock] = {}
        self.rerank_configured = bool(
            os.environ.get("RAG_RERANK_URL")
            and (os.environ.get("RAG_RERANK_API_KEY") or os.environ.get("RAG_LLM_API_KEY"))
            and os.environ.get("RAG_RERANK_MODEL")
        )

    def configure(self, config: dict[str, Any]) -> None:
        """Apply deployment settings and invalidate cached LightRAG instances."""
        mapping = {
            "RAG_EMBEDDING_MODEL": config.get("embedding", {}).get("model"),
            "RAG_EMBEDDING_BASE_URL": config.get("embedding", {}).get("baseUrl"),
            "RAG_EMBEDDING_API_KEY": config.get("embedding", {}).get("apiKey"),
            "RAG_RERANK_MODEL": config.get("rerank", {}).get("model"),
            "RAG_RERANK_URL": config.get("rerank", {}).get("url"),
            "RAG_RERANK_API_KEY": config.get("rerank", {}).get("apiKey"),
            "RAG_PARSER_ENGINE": config.get("pdf", {}).get("engine"),
            "RAG_MINERU_MODE": config.get("pdf", {}).get("mode"),
            "RAG_MINERU_MODEL_VERSION": config.get("pdf", {}).get("modelVersion"),
            "RAG_MINERU_OCR": str(config.get("pdf", {}).get("ocr")).lower(),
            "RAG_MINERU_ENABLE_FORMULA": str(config.get("pdf", {}).get("formula")).lower(),
            "RAG_MINERU_ENABLE_TABLE": str(config.get("pdf", {}).get("table")).lower(),
            "RAG_MINERU_LANGUAGE": config.get("pdf", {}).get("language"),
            "RAG_MINERU_API_TOKEN": config.get("pdf", {}).get("apiToken"),
        }
        for key, value in mapping.items():
            if value is not None and value != "":
                os.environ[key] = str(value)
        self._instances.clear()
        self._rerank_success.clear()
        self.rerank_configured = bool(
            os.environ.get("RAG_RERANK_URL")
            and (os.environ.get("RAG_RERANK_API_KEY") or os.environ.get("RAG_LLM_API_KEY"))
            and os.environ.get("RAG_RERANK_MODEL")
        )

    def _load_documents(self, knowledge_base_id: str) -> dict[str, dict[str, Any]]:
        if knowledge_base_id in self._documents:
            return self._documents[knowledge_base_id]
        path = self.root / knowledge_base_id / "chalk-documents.json"
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            documents = loaded if isinstance(loaded, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError):
            documents = {}
        self._documents[knowledge_base_id] = documents
        return documents

    def _save_documents(self, knowledge_base_id: str) -> None:
        path = self.root / knowledge_base_id / "chalk-documents.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self._documents[knowledge_base_id], ensure_ascii=False), encoding="utf-8")

    async def _instance(self, knowledge_base_id: str):
        knowledge_base_id = validate_identifier(knowledge_base_id, "knowledgeBaseId")
        if knowledge_base_id in self._instances:
            return self._instances[knowledge_base_id]

        from lightrag import LightRAG
        from lightrag.utils import EmbeddingFunc
        from openai import AsyncOpenAI
        import numpy as np

        llm_api_key = os.environ.get("RAG_LLM_API_KEY") or os.environ.get("OPENAI_API_KEY")
        embedding_api_key = os.environ.get("RAG_EMBEDDING_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if not llm_api_key:
            raise RuntimeError("RAG_LLM_API_KEY or OPENAI_API_KEY is not configured")
        if not embedding_api_key:
            raise RuntimeError("RAG_EMBEDDING_API_KEY or OPENAI_API_KEY is not configured")
        llm_base_url = os.environ.get("RAG_LLM_BASE_URL") or os.environ.get("OPENAI_BASE_URL")
        embedding_base_url = os.environ.get("RAG_EMBEDDING_BASE_URL") or os.environ.get("OPENAI_BASE_URL")
        model = os.environ.get("RAG_LLM_MODEL", "gpt-4o-mini")
        embedding_model = os.environ.get("RAG_EMBEDDING_MODEL", "text-embedding-3-small")
        llm_client = AsyncOpenAI(api_key=llm_api_key, base_url=llm_base_url or None)
        embedding_client = AsyncOpenAI(api_key=embedding_api_key, base_url=embedding_base_url or None)

        async def llm_model_func(prompt: str, system_prompt: str | None = None, **kwargs: Any):
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})
            response = await llm_client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.1,
                stream=bool(kwargs.get("stream", False)),
            )
            if kwargs.get("stream", False):
                async def chunks():
                    async for chunk in response:
                        delta = chunk.choices[0].delta.content if chunk.choices else None
                        if delta:
                            yield delta
                return chunks()
            return response.choices[0].message.content or ""

        async def embed_func(texts: list[str], **_: Any):
            response = await embedding_client.embeddings.create(model=embedding_model, input=texts)
            return np.asarray([item.embedding for item in response.data], dtype=np.float32)

        probe = await embedding_client.embeddings.create(model=embedding_model, input=["chalk probe"])
        dimension = len(probe.data[0].embedding)
        rerank_model_func = None
        if self.rerank_configured:
            import httpx

            async def rerank_model_func(query: str, documents: list[str], top_n: int | None = None, **_: Any):
                rerank_model = os.environ.get("RAG_RERANK_MODEL", "qwen3-rerank")
                api_key = os.environ.get("RAG_RERANK_API_KEY") or llm_api_key
                if rerank_model != "qwen3-rerank":
                    # Alibaba native rerankers (including qwen3-vl-rerank,
                    # qwen3.7-text-rerank and gte-rerank-v2) use a nested
                    # ``input`` payload, even when the workspace exposes an
                    # OpenAI-compatible base URL.
                    query_input: Any = {"text": query} if rerank_model == "qwen3-vl-rerank" else query
                    payload: dict[str, Any] = {
                        "model": rerank_model,
                        "input": {
                            "query": query_input,
                            "documents": documents,
                        },
                        "parameters": {"return_documents": False},
                    }
                    if top_n is not None:
                        payload["parameters"]["top_n"] = top_n
                else:
                    payload = {
                        "model": rerank_model,
                        "query": query,
                        "documents": documents,
                    }
                    if top_n is not None:
                        payload["top_n"] = top_n
                async with httpx.AsyncClient(timeout=float(os.environ.get("RAG_RERANK_TIMEOUT", "10"))) as http:
                    response = await http.post(
                        os.environ["RAG_RERANK_URL"],
                        headers={"Authorization": f"Bearer {api_key}"},
                        json=payload,
                    )
                    response.raise_for_status()
                payload = response.json()
                if rerank_model != "qwen3-rerank":
                    payload = payload.get("output", {}) if isinstance(payload, dict) else {}
                results = normalise_rerank_payload(payload)
                if any(
                    isinstance(item, dict) and item.get("relevance_score") is not None
                    for item in results
                ):
                    self._rerank_success[knowledge_base_id] = True
                return results

        rag = LightRAG(
            working_dir=str(self.root / knowledge_base_id),
            workspace=knowledge_base_id,
            llm_model_func=llm_model_func,
            embedding_func=EmbeddingFunc(embedding_dim=dimension, max_token_size=8192, func=embed_func),
            chunk_token_size=int(os.environ.get("RAG_CHUNK_SIZE", "1200")),
            chunk_overlap_token_size=int(os.environ.get("RAG_CHUNK_OVERLAP", "100")),
            rerank_model_func=rerank_model_func,
            auto_manage_storages_states=False,
        )
        await rag.initialize_storages()
        self._instances[knowledge_base_id] = rag
        self._load_documents(knowledge_base_id)
        return rag

    async def index(self, knowledge_base_id: str, document_id: str, filename: str, content_type: str, content: bytes):
        knowledge_base_id = validate_identifier(knowledge_base_id, "knowledgeBaseId")
        document_id = validate_identifier(document_id, "documentId")
        filename = validate_filename(filename)
        # MinerU's local CLI and cloud polling are blocking operations. Keep
        # them off FastAPI's event loop so health/query requests remain
        # responsive while an upload is being parsed.
        parsed: ParsedDocument = await asyncio.to_thread(
            parse_document, filename, content_type, content
        )
        text = parsed.as_index_text()
        if not text.strip():
            raise ValueError("Document contains no extractable text")
        rag = await self._instance(knowledge_base_id)
        # LightRAG canonicalizes ``file_paths`` to a basename and uses that
        # value for filename deduplication.  A directory prefix therefore does
        # not disambiguate same-named uploads (the second upload is silently
        # recorded as a duplicate).  Keep the UUID in the basename instead;
        # ``_reference`` maps it back to the user-facing filename below.
        source_key = f"{document_id}__{filename}"
        await rag.ainsert(text, ids=document_id, file_paths=source_key)
        status_store = getattr(rag, "doc_status", None)
        get_by_id = getattr(status_store, "get_by_id", None)
        if get_by_id is not None and await get_by_id(document_id) is None:
            # LightRAG creates a separate duplicate-attempt record when the
            # canonical source basename already exists.  Do not report such
            # an upload as ready when no status exists for its requested ID.
            raise RuntimeError("LightRAG did not ingest document")
        chunk_count = await self._chunk_count(rag, document_id, text)
        self._documents[knowledge_base_id][document_id] = {
            "filename": filename,
            "sourceKey": source_key,
            "pageCount": parsed.page_count,
            "parserEngine": parsed.engine,
        }
        self._save_documents(knowledge_base_id)
        return {"documentId": document_id, "status": "ready", "chunkCount": chunk_count, "pageCount": parsed.page_count}

    async def delete(self, knowledge_base_id: str, document_id: str) -> None:
        """Remove a document from LightRAG before a fresh parse/index run."""
        knowledge_base_id = validate_identifier(knowledge_base_id, "knowledgeBaseId")
        document_id = validate_identifier(document_id, "documentId")
        rag = await self._instance(knowledge_base_id)
        delete_by_doc_id = getattr(rag, "adelete_by_doc_id", None)
        if delete_by_doc_id is None:
            raise RuntimeError("LightRAG does not support document deletion")
        await delete_by_doc_id(document_id, delete_llm_cache=True)

    async def _chunk_count(self, rag: Any, document_id: str, text: str) -> int:
        """Read LightRAG's persisted count, with a conservative fallback.

        ``ainsert`` returns a tracking id rather than the created chunks. The
        document-status record is the SDK's durable source of truth once the
        pipeline has completed; the fallback keeps this adapter compatible with
        older/fake LightRAG implementations used in tests.
        """
        status_store = getattr(rag, "doc_status", None)
        get_by_id = getattr(status_store, "get_by_id", None)
        if get_by_id is not None:
            status = await get_by_id(document_id)
            count = status.get("chunks_count") if isinstance(status, dict) else getattr(status, "chunks_count", None)
            if isinstance(count, int) and count >= 0:
                return count
            chunks = status.get("chunks_list") if isinstance(status, dict) else getattr(status, "chunks_list", None)
            if isinstance(chunks, list):
                return len(chunks)
        configured_size = max(1, int(os.environ.get("RAG_CHUNK_SIZE", "1200")))
        return max(1, (len(text) + configured_size - 1) // configured_size)

    async def query(self, knowledge_base_id: str, query: str, mode: str, top_k: int, enable_rerank: bool):
        knowledge_base_id = validate_identifier(knowledge_base_id, "knowledgeBaseId")
        started = time.perf_counter()
        rag = await self._instance(knowledge_base_id)
        from lightrag import QueryParam

        query_lock = self._query_locks.setdefault(knowledge_base_id, asyncio.Lock())
        await query_lock.acquire()
        self._rerank_success[knowledge_base_id] = False
        try:
            result = await rag.aquery_llm(query, QueryParam(
                mode=mode,
                top_k=top_k,
                chunk_top_k=top_k,
                enable_rerank=bool(enable_rerank and self.rerank_configured),
                include_references=True,
            ))
            reranked = bool(enable_rerank and self.rerank_configured and self._rerank_success.get(knowledge_base_id, False))
        finally:
            query_lock.release()
        if not isinstance(result, dict) or result.get("status") == "failure":
            raise RuntimeError((result or {}).get("message", "LightRAG query failed"))
        llm_response = result.get("llm_response") or {}
        answer = str(llm_response.get("content") or "")
        data = result.get("data") or {}
        raw_refs = data.get("chunks") or data.get("references") or []
        if isinstance(raw_refs, dict):
            raw_refs = list(raw_refs.values())
        references = [self._reference(knowledge_base_id, item, index) for index, item in enumerate(raw_refs)]
        return {
            "answer": answer,
            "references": references,
            "metadata": {
                "provider": "lightrag-hku@1.5.7rc2",
                "mode": mode,
                "reranked": reranked,
                "latencyMs": round((time.perf_counter() - started) * 1000, 2),
            },
        }

    async def chunks(self, knowledge_base_id: str, document_id: str) -> list[dict[str, Any]]:
        """Return the persisted LightRAG chunks for one indexed document."""
        knowledge_base_id = validate_identifier(knowledge_base_id, "knowledgeBaseId")
        document_id = validate_identifier(document_id, "documentId")
        rag = await self._instance(knowledge_base_id)
        status_store = getattr(rag, "doc_status", None)
        get_by_id = getattr(status_store, "get_by_id", None)
        status = await get_by_id(document_id) if get_by_id is not None else None
        if not isinstance(status, dict) or status.get("status") != "processed":
            raise ValueError("Document is not indexed")
        chunk_ids = status.get("chunks_list")
        if not isinstance(chunk_ids, list):
            return []
        path = self.root / knowledge_base_id / knowledge_base_id / "kv_store_text_chunks.json"
        try:
            stored = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return []
        chunks: list[dict[str, Any]] = []
        for index, chunk_id in enumerate(chunk_ids):
            item = stored.get(chunk_id) if isinstance(stored, dict) else None
            if not isinstance(item, dict):
                continue
            content = str(item.get("content") or "")
            page_match = re.search(r"\[CHALK_PAGE:(\d+)\]", content)
            paragraph_match = re.search(r"\[CHALK_PARAGRAPH:(\d+)\]", content)
            clean = re.sub(r"\[CHALK_(?:PAGE|PARAGRAPH):\d+\]\s*", "", content).strip()
            chunks.append({
                "chunkId": str(chunk_id),
                "index": index + 1,
                "content": clean,
                "tokenCount": int(item.get("tokens") or 0),
                **({"page": int(page_match.group(1))} if page_match else {}),
                **({"paragraph": int(paragraph_match.group(1))} if paragraph_match else {}),
            })
        return chunks

    def _reference(self, knowledge_base_id: str, item: dict[str, Any], index: int) -> dict[str, Any]:
        if not isinstance(item, dict):
            item = {"file_path": str(item)}
        source = str(item.get("file_path") or item.get("source_id") or "unknown")
        source_name = Path(source).name or source
        chunk_id = str(item.get("chunk_id") or item.get("id") or f"chunk-{index + 1}")
        source_id = source.split("/", 1)[0] if "/" in source else ""
        docs = self._documents.get(knowledge_base_id, {})
        if source_id in docs:
            document_id = source_id
        else:
            matches = [doc_id for doc_id, doc in docs.items() if doc.get("sourceKey") == source]
            if len(matches) == 1:
                document_id = matches[0]
            else:
                # LightRAG stores the UUID-prefixed basename introduced by
                # ``index``.  Resolve it even when metadata was written by an
                # older process with the slash-separated source key.
                prefix, separator, display_name = source.partition("__")
                if separator and prefix in docs and docs[prefix].get("filename") == display_name:
                    document_id = prefix
                else:
                    # Backward-compatible fallback for metadata written before
                    # sourceKey was introduced, but never guess among duplicates.
                    filename_matches = [doc_id for doc_id, doc in docs.items() if doc.get("filename") == source_name]
                    document_id = filename_matches[0] if len(filename_matches) == 1 else source
        if document_id in docs:
            source_name = str(docs[document_id].get("filename") or source_name)
        snippet = str(item.get("content") or item.get("text") or item.get("chunk_content") or "")[:600]
        page_match = re.search(r"\[CHALK_PAGE:(\d+)\]", snippet)
        paragraph_match = re.search(r"\[CHALK_PARAGRAPH:(\d+)\]", snippet)
        page = int(page_match.group(1)) if page_match else None
        clean = re.sub(r"\[CHALK_(?:PAGE|PARAGRAPH):\d+\]\s*", "", snippet).strip()
        reference = {
            "citationId": str(item.get("reference_id") or f"cite-{index + 1}"),
            "documentId": document_id,
            "documentName": source_name,
            "chunkId": chunk_id,
            "snippet": clean,
        }
        if item.get("score") is not None:
            reference["score"] = float(item["score"])
        if page is not None:
            reference["page"] = page
        if paragraph_match:
            reference["paragraph"] = int(paragraph_match.group(1))
        return reference
