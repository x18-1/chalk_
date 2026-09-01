import os
import json
from pathlib import Path

import pytest

from chalk_rag_sidecar.engine import (
    LightRagEngine,
    normalise_rerank_payload,
    rerank_succeeded,
    validate_identifier,
    validate_filename,
)
# The sidecar intentionally requires an explicit token outside tests.
os.environ.setdefault("NODE_ENV", "test")
from chalk_rag_sidecar.main import IndexRequest, QueryRequest, QueryResponse  # noqa: E402


def test_rerank_payload_accepts_bare_list_and_results_envelope() -> None:
    rows = [{"index": 0, "relevance_score": 0.9}]

    assert normalise_rerank_payload(rows) == rows
    assert normalise_rerank_payload({"results": rows}) == rows
    assert normalise_rerank_payload({"results": "invalid"}) == []
    assert normalise_rerank_payload(None) == []


def test_reranked_metadata_requires_actual_scores() -> None:
    assert rerank_succeeded([{"rerank_score": 0.8}], enabled=True, configured=True)
    assert not rerank_succeeded([{"score": 0.8}], enabled=True, configured=True)
    assert not rerank_succeeded([], enabled=True, configured=True)
    assert not rerank_succeeded([{"rerank_score": 0.8}], enabled=False, configured=True)


def test_ids_must_be_canonical_uuid_components() -> None:
    value = "123e4567-e89b-12d3-a456-426614174000"
    assert validate_identifier(value, "knowledgeBaseId") == value
    with pytest.raises(ValueError, match="must be a UUID"):
        validate_identifier("../escape", "knowledgeBaseId")
    with pytest.raises(ValueError, match="canonical"):
        validate_identifier(value.upper(), "documentId")


def test_filename_must_not_be_a_path() -> None:
    assert validate_filename("notes.md") == "notes.md"
    with pytest.raises(ValueError, match="basename"):
        validate_filename("../notes.md")


def test_http_models_reject_path_traversal_ids() -> None:
    with pytest.raises(ValueError):
        IndexRequest(
            knowledgeBaseId="../escape",
            documentId="123e4567-e89b-12d3-a456-426614174000",
            filename="notes.md",
            contentType="text/markdown",
            contentBase64="bm90ZXM=",
        )
    with pytest.raises(ValueError):
        QueryRequest(knowledgeBaseId="../escape", query="hello")
    with pytest.raises(ValueError):
        QueryRequest(knowledgeBaseId="123e4567-e89b-12d3-a456-426614174000", query="   ")


def test_pydantic_requests_match_generated_zod_contract() -> None:
    contract_path = Path(__file__).parents[1] / "protocol" / "schema.json"
    contract = json.loads(contract_path.read_text(encoding="utf-8"))["properties"]
    index_schema = IndexRequest.model_json_schema()
    query_schema = QueryRequest.model_json_schema()

    assert index_schema["properties"]["contentType"]["enum"] == contract["indexRequest"]["properties"]["contentType"]["enum"]
    assert query_schema["properties"]["mode"]["enum"] == contract["queryRequest"]["properties"]["mode"]["enum"]
    assert query_schema["properties"]["topK"]["maximum"] == contract["queryRequest"]["properties"]["topK"]["maximum"]


def test_query_response_omits_optional_null_locators() -> None:
    response = QueryResponse(
        answer="answer",
        references=[{
            "citationId": "cite-1",
            "documentId": "doc-1",
            "documentName": "notes.md",
            "chunkId": "chunk-1",
            "snippet": "text",
        }],
        metadata={"provider": "test", "mode": "hybrid", "reranked": False, "latencyMs": 1},
    )

    assert "page" not in response.model_dump(exclude_none=True)["references"][0]


def test_reference_uses_source_key_to_disambiguate_duplicate_filenames(tmp_path) -> None:
    engine = LightRagEngine(tmp_path)
    kb_id = "123e4567-e89b-12d3-a456-426614174000"
    first = "123e4567-e89b-12d3-a456-426614174001"
    second = "123e4567-e89b-12d3-a456-426614174002"
    engine._documents[kb_id] = {
        first: {"filename": "notes.md", "sourceKey": f"{first}/notes.md"},
        second: {"filename": "notes.md", "sourceKey": f"{second}/notes.md"},
    }

    ref = engine._reference(
        kb_id,
        {
            "file_path": f"{second}/notes.md",
            "chunk_id": "chunk-2",
            "content": "[CHALK_PAGE:2][CHALK_PARAGRAPH:3]\ntext",
        },
        0,
    )

    assert ref["documentId"] == second
    assert ref["documentName"] == "notes.md"
    assert ref["page"] == 2
    assert ref["paragraph"] == 3
    assert ref["snippet"] == "text"

    prefixed_ref = engine._reference(
        kb_id,
        {
            "file_path": f"{second}__notes.md",
            "chunk_id": "chunk-3",
            "content": "text from prefixed source",
        },
        1,
    )
    assert prefixed_ref["documentId"] == second
    assert prefixed_ref["documentName"] == "notes.md"
