# RAG MVP 运行手册

> 状态：Accepted
> 实施状态：Partial（单机 MVP 已实现；完整 MinIO 集成需按 worktree 端口配置）

## 启动 sidecar

在 `apps/rag-sidecar` 创建 Python 3.11–3.13 虚拟环境并安装依赖：

```bash
cd apps/rag-sidecar
python -m venv .venv
. .venv/bin/activate
pip install -e .
```

配置 LLM、embedding 和 rerank 的凭据。三者可以使用不同的 OpenAI-compatible
服务；例如 DeepSeek 只负责 LLM，阿里百炼负责 embedding 和 rerank：

```dotenv
RAG_LLM_API_KEY=...
RAG_LLM_BASE_URL=https://api.deepseek.com
RAG_LLM_MODEL=deepseek-chat
RAG_EMBEDDING_API_KEY=...
RAG_EMBEDDING_BASE_URL=https://<workspace>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
RAG_EMBEDDING_MODEL=qwen3.7-text-embedding
RAG_RERANK_API_KEY=...
RAG_RERANK_MODEL=qwen3.7-text-rerank
RAG_RERANK_URL=https://<workspace>.cn-beijing.maas.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank
```

### 文档解析引擎

索引前可通过 `RAG_PARSER_ENGINE` 选择解析器：

```dotenv
RAG_PARSER_ENGINE=text_only   # text_only | markitdown | mineru
```

`text_only` 不需要额外安装，适合作为默认 fallback。`markitdown` 需要安装
可选依赖：`pip install -e '.[markitdown]'`。`mineru` 不随 sidecar 安装，支持
本地 `mineru`/`magic-pdf` CLI 或 MinerU v4 云端 API：

```dotenv
RAG_PARSER_ENGINE=mineru
RAG_MINERU_MODE=cloud          # local | cloud；cloud 使用精准解析 API
RAG_MINERU_API_TOKEN=...
RAG_MINERU_API_BASE_URL=https://mineru.net
RAG_MINERU_MODEL_VERSION=vlm   # 精准 API 推荐；也可使用 pipeline
RAG_MINERU_OCR=true             # 扫描 PDF 开启
RAG_MINERU_ENABLE_FORMULA=true
RAG_MINERU_ENABLE_TABLE=true
```

默认不继承系统代理（`RAG_MINERU_TRUST_ENV=false`），避免签名上传或结果 CDN
下载被开发环境代理中断；只有部署明确需要代理时才设置为 `true`。

切换解析引擎后，已索引文档不会自动重建；需要重新上传或执行重试索引，避免
复用旧解析结果。MinerU 本地模式首次运行需要预先安装模型，sidecar 不会静默下载
数 GB 权重。

不要把真实 key 写入 `.env.example`、代码、日志或提交记录。

```bash
# Replace this placeholder with a unique random secret before starting.
export RAG_SIDECAR_TOKEN='replace-with-a-random-secret'
chalk-rag-sidecar
```

本地命令启动的 sidecar 默认监听 `127.0.0.1:8010`。Docker 镜像监听容器内的
`0.0.0.0:8010` 以便 API 容器访问；部署时必须使用私有网络，不要把 8010 发布到公网。
API 通过 `RAG_SIDECAR_URL`、`RAG_SIDECAR_TOKEN` 和 `RAG_TIMEOUT_MS` 调用它。

Chat 中可以在消息编辑器选择一个知识库。TypeScript API 会在完成当前用户的 owner
校验后，把这个知识库绑定到本次 Agent runtime，并按需动态挂载
`search_knowledge_base` tool；模型不能自行传入其他知识库 ID。工具返回的文档名、页码/
段落和 chunk 引用会显示在 Chat 右侧的“答案来自这些资料”区域。未选择知识库时不会注册
该 tool，也不会把浏览器请求直接发送到 Python sidecar。

协议变更后，在仓库根目录运行
`pnpm --filter @chalk/api rag:protocol:generate`，并运行 Python sidecar 测试，确保
`apps/rag-sidecar/protocol/schema.json` 与两侧模型保持一致。

## API / Web

从 RAG worktree 根目录按 [worktree 开发手册](worktree-development.md) 配置 `.env`、Postgres 和 MinIO，然后启动 API 和 Web。首次使用需要登录，在“知识库”页面创建知识库、上传 PDF/Markdown/纯文本/DOCX，等待文档状态变为“已就绪”后提问。

当前生效的 RAG 配置可在“设置 → API → RAG”查看和修改，分为 Embedding、Rerank 和 PDF
三个子页签。页面只展示密钥的配置状态；保存后 API 会将配置同步到当前运行的 sidecar，
新的上传或重新索引任务立即使用新配置。重新部署后仍应在 `.env` 中提供默认配置。

上传确认接口采用轻量级单机异步索引：API 返回 `202` 和 `pending` 文档状态，进程内 worker 按顺序调用 sidecar，页面轮询知识库列表直到状态变为 `ready` 或 `failed`。已就绪文档在资料列表中提供“重新索引”按钮；它会删除旧 LightRAG 文档后重新排队，使用当前解析引擎（例如 MinerU 精准 API）重建。它不引入 Redis/Kafka 等分布式队列；当前 worker 生命周期绑定 API 进程，重启后仍为 `pending` 的文档需要在页面点击“重试”。

## 当前限制

- 需要配置可用的 LLM 和 embedding API；两者可以是不同 provider；
- 当前索引是 API 进程内的单 worker 异步任务，适合 MVP；若未来需要跨进程恢复，再单独设计持久化 worker；
- `RAG_RERANK_URL` 为空时 LightRAG 使用候选排序，不调用外部 reranker；阿里
  阿里 native rerank 模型（如 `qwen3.7-text-rerank`、`qwen3-vl-rerank`）使用
  `/api/v1/services/rerank/text-rerank/text-rerank` endpoint，而不是 embedding
  的 `/compatible-mode/v1` endpoint；
- 系统性 Recall/MRR、citation correctness、faithfulness 评估后置；
- 集成测试需要独立 `TEST_DATABASE_URL`，不能使用开发库。
- 多 worktree 并行运行时，使用本 worktree 的 MinIO 映射端口设置 `S3_ENDPOINT`（例如
  `S3_ENDPOINT=http://127.0.0.1:59000`），不要依赖根目录 `.env` 中的默认端口。
