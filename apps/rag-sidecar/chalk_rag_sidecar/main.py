from __future__ import annotations

import os
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from .engine import LightRagEngine, validate_identifier

app = FastAPI(title="Chalk LightRAG sidecar", version="0.1.0")
engine = LightRagEngine(os.environ.get("RAG_WORKING_DIR", "./data/rag"))


def _load_service_token() -> str:
    token = os.environ.get("RAG_SIDECAR_TOKEN", "").strip()
    if os.environ.get("NODE_ENV", "development") != "test" and not token:
        raise RuntimeError("RAG_SIDECAR_TOKEN must be configured outside test environments")
    return token


SERVICE_TOKEN = _load_service_token()


def require_service_token(authorization: str | None = Header(default=None)) -> None:
    if not SERVICE_TOKEN or authorization != f"Bearer {SERVICE_TOKEN}":
        raise HTTPException(status_code=401, detail="Invalid sidecar credentials")


class IndexRequest(BaseModel):
    knowledgeBaseId: str = Field(min_length=1)
    documentId: str = Field(min_length=1)
    filename: str = Field(min_length=1, max_length=240)
    contentType: Literal[
        "text/plain",
        "text/markdown",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]
    contentBase64: str = Field(min_length=1)

    _strip_text = field_validator("filename", "contentType", "contentBase64", mode="before")(
        lambda value: value.strip() if isinstance(value, str) else value
    )

    _validate_ids = field_validator("knowledgeBaseId", "documentId")(
        lambda value, info: validate_identifier(value, info.field_name)
    )


class QueryRequest(BaseModel):
    knowledgeBaseId: str = Field(min_length=1)
    query: str = Field(min_length=1, max_length=4000)
    mode: Literal["hybrid", "naive", "local", "global", "mix"] = "hybrid"
    topK: int = Field(default=5, ge=1, le=20)
    enableRerank: bool = True

    _strip_query = field_validator("query", mode="before")(
        lambda value: value.strip() if isinstance(value, str) else value
    )

    _validate_kb_id = field_validator("knowledgeBaseId")(
        lambda value, info: validate_identifier(value, info.field_name)
    )


class ChunksRequest(BaseModel):
    knowledgeBaseId: str = Field(min_length=1)
    documentId: str = Field(min_length=1)

    _validate_ids = field_validator("knowledgeBaseId", "documentId")(
        lambda value, info: validate_identifier(value, info.field_name)
    )


class DeleteRequest(BaseModel):
    knowledgeBaseId: str = Field(min_length=1)
    documentId: str = Field(min_length=1)

    _validate_ids = field_validator("knowledgeBaseId", "documentId")(
        lambda value, info: validate_identifier(value, info.field_name)
    )


class ConfigRequest(BaseModel):
    embedding: dict[str, Any] | None = None
    rerank: dict[str, Any] | None = None
    pdf: dict[str, Any] | None = None


class IndexResponse(BaseModel):
    documentId: str
    status: Literal["ready"]
    chunkCount: int = Field(ge=0)
    pageCount: int = Field(ge=0)

    _validate_document_id = field_validator("documentId")(
        lambda value: validate_identifier(value, "documentId")
    )


class RagReference(BaseModel):
    citationId: str = Field(min_length=1)
    documentId: str = Field(min_length=1)
    documentName: str = Field(min_length=1)
    chunkId: str = Field(min_length=1)
    snippet: str
    score: float | None = None
    page: int | None = Field(default=None, ge=1)
    paragraph: int | None = Field(default=None, ge=1)


class QueryMetadata(BaseModel):
    provider: str
    mode: Literal["hybrid", "naive", "local", "global", "mix"]
    reranked: bool
    latencyMs: float = Field(ge=0)


class QueryResponse(BaseModel):
    answer: str
    references: list[RagReference]
    metadata: QueryMetadata


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/config", dependencies=[Depends(require_service_token)])
async def configure(request: ConfigRequest) -> dict[str, str]:
    engine.configure(request.model_dump(exclude_none=True))
    return {"status": "configured"}


@app.post("/v1/index", dependencies=[Depends(require_service_token)], response_model=IndexResponse)
async def index(request: IndexRequest) -> dict[str, Any]:
    import base64

    try:
        content = base64.b64decode(request.contentBase64, validate=True)
        return await engine.index(request.knowledgeBaseId, request.documentId, request.filename, request.contentType, content)
    except Exception:
        raise HTTPException(status_code=422, detail="RAG_INDEX_FAILED")


@app.post(
    "/v1/query",
    dependencies=[Depends(require_service_token)],
    response_model=QueryResponse,
    response_model_exclude_none=True,
)
async def query(request: QueryRequest) -> dict[str, Any]:
    try:
        return await engine.query(request.knowledgeBaseId, request.query, request.mode, request.topK, request.enableRerank)
    except Exception:
        raise HTTPException(status_code=503, detail="RAG_QUERY_FAILED")


@app.post("/v1/chunks", dependencies=[Depends(require_service_token)])
async def chunks(request: ChunksRequest) -> dict[str, Any]:
    try:
        return {"chunks": await engine.chunks(request.knowledgeBaseId, request.documentId)}
    except Exception:
        raise HTTPException(status_code=404, detail="RAG_CHUNKS_NOT_FOUND")


@app.post("/v1/delete", dependencies=[Depends(require_service_token)])
async def delete(request: DeleteRequest) -> dict[str, str]:
    try:
        await engine.delete(request.knowledgeBaseId, request.documentId)
        return {"status": "deleted"}
    except Exception:
        raise HTTPException(status_code=404, detail="RAG_DELETE_FAILED")


def run() -> None:
    import uvicorn

    uvicorn.run("chalk_rag_sidecar.main:app", host=os.environ.get("RAG_HOST", "127.0.0.1"), port=int(os.environ.get("RAG_PORT", "8010")))
