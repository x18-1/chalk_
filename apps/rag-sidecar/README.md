# Chalk LightRAG sidecar

独立 Python 部署单元，只接受来自 `apps/api` 的内部请求。它负责文件解析、LightRAG chunk/index/query 和 references；用户认证、owner 校验、业务状态和引用投影仍由 TypeScript API 负责。

sidecar 协议的权威定义位于 API 的 Zod schema。修改协议后，在仓库根目录运行
`pnpm --filter @chalk/api rag:protocol:generate`，更新
`apps/rag-sidecar/protocol/schema.json`，再同步检查 Python 的 Pydantic 模型。

```bash
cd apps/rag-sidecar
python -m venv .venv
. .venv/bin/activate
pip install -e .
# LLM and embedding/rerank providers may be configured independently.
export RAG_LLM_API_KEY=...
export RAG_LLM_BASE_URL=https://api.deepseek.com
export RAG_LLM_MODEL=deepseek-chat
export RAG_EMBEDDING_API_KEY=...
export RAG_EMBEDDING_BASE_URL=https://<workspace>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
export RAG_EMBEDDING_MODEL=qwen3.7-text-embedding
export RAG_RERANK_API_KEY=...
export RAG_RERANK_MODEL=qwen3.7-text-rerank
export RAG_RERANK_URL=https://<workspace>.cn-beijing.maas.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank
# Parser before LightRAG ingestion: text_only (default), markitdown, or mineru.
# Install markitdown separately with: pip install -e '.[markitdown]'.
export RAG_PARSER_ENGINE=text_only
# MinerU is an external CLI or hosted API (not installed with this sidecar).
export RAG_MINERU_MODE=local
export RAG_MINERU_CLI_PATH=
export RAG_MINERU_API_TOKEN=
export RAG_MINERU_API_BASE_URL=https://mineru.net
export RAG_MINERU_OCR=false
export RAG_MINERU_ENABLE_FORMULA=true
export RAG_MINERU_ENABLE_TABLE=true
export RAG_MINERU_MODEL_VERSION=vlm
export RAG_MINERU_LANGUAGE=
# Optional: use a separate OpenAI-compatible LLM provider (for example DeepSeek).
# RAG_EMBEDDING_API_KEY / RAG_EMBEDDING_BASE_URL can point to an embedding provider.
# Replace this placeholder with a unique random secret before starting.
export RAG_SIDECAR_TOKEN='replace-with-a-random-secret'
chalk-rag-sidecar
```
