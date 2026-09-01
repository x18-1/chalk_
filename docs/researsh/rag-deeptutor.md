# DeepTutor RAG 调研与 Chalk Python 集成建议

> 文档状态：Draft
> 调研时间：2026-08-31
> 范围：本地 `.reference/DeepTutor` 快照（源码与 `pyproject.toml`），并对照 Chalk 当前架构约束。

本文是实现前的技术调研。DeepTutor 是 Python/FastAPI 应用；下文提取其 RAG 的可复用边界和失败处理，并给出把 Python 作为隔离 worker/sidecar 接入 Chalk 的方案。Chalk 已通过 [ADR 0003](../adr/0003-python-lightrag-retrieval-sidecar.md) 接受独立的 Python LightRAG 在线 retrieval sidecar；这不改变 Chalk 业务后端、认证、授权和数据访问仍使用 TypeScript 的约束。

### 本次范围调整（2026-08-31）

Chalk 首期只引入 **LightRAG**，不引入 LlamaIndex、GraphRAG、PageIndex 或其他检索 provider。下文的 LlamaIndex 内容保留为 DeepTutor 的架构对照；LightRAG 质量评估记录为后续阶段，不属于本次实现范围。

## 1. DeepTutor 的总体 RAG 结构

DeepTutor 把一个知识库（KB）绑定到一个检索 provider。`services/rag/factory.py` 的模块说明列出默认 LlamaIndex（本地向量 + BM25 混合）、PageIndex、GraphRAG、LightRAG、远程 LightRAG Server 与 IMA 等 provider，并明确“创建时绑定，后续 add/search 始终走同一 pipeline”（`[factory.py:1-23](../../.reference/DeepTutor/deeptutor/services/rag/factory.py#L1-L23)`）。工厂按 provider 懒加载并缓存 pipeline（`factory.py:123-182`）。

统一协议是异步 `initialize`、`add_documents`、`search`、`delete`；`RAGPipeline` Protocol 要求 search 至少返回 `query`、`content/answer`、`sources`、`provider`（`[pipelines/base.py:1-38](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/base.py#L1-L38)`）。`RAGService` 按 KB binding 解析 provider、转发生命周期调用，并在搜索结果中覆盖最终 provider 字段（`[service.py:23-82](../../.reference/DeepTutor/deeptutor/services/rag/service.py#L23-L82)`、`[service.py:84-184](../../.reference/DeepTutor/deeptutor/services/rag/service.py#L84-L184)`）。工具层 `rag_search` 要求非空 query 和显式 `kb_name`，多用户场景先通过 `resolve_for_rag` 做访问解析，随后才调用 service（`[tools/rag_tool.py:15-51](../../.reference/DeepTutor/deeptutor/tools/rag_tool.py#L15-L51)`）。

知识库生命周期由 `KnowledgeBaseInitializer` 和 `DocumentAdder` 管理：创建时只建立 `raw/` 并写 metadata/config，随后调用 RAGService.initialize；增量添加先按 SHA-256 去重、保留相对目录和同名文件，再调用 `add_documents`（`[initializer.py:109-127](../../.reference/DeepTutor/deeptutor/knowledge/initializer.py#L109-L127)`、`[initializer.py:144-236](../../.reference/DeepTutor/deeptutor/knowledge/initializer.py#L144-L236)`、`[add_documents.py:238-299](../../.reference/DeepTutor/deeptutor/knowledge/add_documents.py#L238-L299)`）。

## 2. DeepTutor 的 LlamaIndex pipeline（架构对照，非 Chalk 首期范围）

### 摄取和切分

`build_ingestion_pipeline` 使用 LlamaIndex `IngestionPipeline`，转换顺序是 `SentenceSplitter(chunk_size=Settings.chunk_size, chunk_overlap=Settings.chunk_overlap)`，再调用配置好的 `Settings.embed_model`（`[llamaindex/ingestion.py:21-37](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/ingestion.py#L21-L37)`）。默认配置为 `chunk_size=512`、`chunk_overlap=50`，可通过持久化设置调整（`[llamaindex/config.py:99-109](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/config.py#L99-L109)`）。

文档先经统一 `FileTypeRouter` 分类：PDF/Office/EPUB 走 parser，文本直接读，图片单独处理，不支持类型记录 warning（`[file_routing.py:42-49](../../.reference/DeepTutor/deeptutor/services/rag/file_routing.py#L42-L49)`、`[file_routing.py:181-203](../../.reference/DeepTutor/deeptutor/services/rag/file_routing.py#L181-L203)`）。`LlamaIndexDocumentLoader` 通过共享 parsing service 把解析引擎（Text-only、MinerU、Docling、markitdown、PyMuPDF4LLM 等）隔离在文档加载 seam；解析失败跳过单文件而不终止批次（`[llamaindex/document_loader.py:1-9](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/document_loader.py#L1-L9)`、`[document_loader.py:139-164](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/document_loader.py#L139-L164)`）。图片在 embedding 和多模态 LLM 均可用时生成描述并建 `ImageNode`，否则明确记录跳过原因（`[document_loader.py:198-230](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/document_loader.py#L198-L230)`）。

### Embedding adapter 和索引构建

DeepTutor 没有把 provider SDK 暴露给 LlamaIndex，而是将统一 embedding client 包装为 LlamaIndex `CustomEmbedding`；查询使用 `input_type="search_query"`，文档使用 `search_document`，批量调用执行维度/数量校验（`[llamaindex/embedding_adapter.py:90-134](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/embedding_adapter.py#L90-L134)`）。每次初始化先做一次 embedding connectivity smoke test（`[embedding_adapter.py:170-190](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/embedding_adapter.py#L170-L190)`）。

索引写入在 executor 线程运行，并有 600 秒无进度 stall guard，防止网络请求黑洞拖住事件循环（`[llamaindex/pipeline.py:49-112](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/pipeline.py#L49-L112)`）。创建流程为：解析 → `VectorStoreIndex` → persist → 写版本 metadata；失败清理空版本目录（`[llamaindex/pipeline.py:152-199](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/pipeline.py#L152-L199)`）。

向量存储有可选 FAISS seam：新索引在所有向量维度一致且依赖可用时使用 `IndexFlatIP`，并对向量做 L2 归一化使内积等价 cosine；否则回退到 SimpleVectorStore，旧索引仍可读取（`[llamaindex/vector_store.py:14-24](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/vector_store.py#L14-L24)`、`[vector_store.py:167-212](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/vector_store.py#L167-L212)`）。

### 检索和引用

检索配置支持 `vector` 与默认 `hybrid` profile。hybrid 构建向量 retriever 与 BM25 retriever，用 `QueryFusionRetriever` 的 reciprocal-rank fusion 合并候选；BM25 包缺失时透明回退向量检索（`[llamaindex/retrievers.py:119-151](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/retrievers.py#L119-L151)`、`[llamaindex/config.py:50-62](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/config.py#L50-L62)`）。查询加载并缓存已校验的 index，然后按 `top_k`（默认 5）运行 retriever（`[llamaindex/storage.py:238-287](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/storage.py#L238-L287)`）。

返回结果不是裸文本：每个 node 生成 `title/content/source/page/chunk_id/score`，同时返回拼接后的 `answer` 和 `content`（`[llamaindex/pipeline.py:277-301](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/pipeline.py#L277-L301)`）。这套 source 结构适合 Chalk 的“证据引用”，但应由 TS 业务层决定哪些字段可展示、如何进入证据账本。

### Embedding 版本和原子重建

每个索引版本以 embedding signature（binding、model、dimension、base URL、API version、role semantics）计算 16 位 SHA-256 摘要（`[index_versioning.py:46-64](../../.reference/DeepTutor/deeptutor/services/rag/index_versioning.py#L46-L64)`）。新写入使用平面 `version-N` 目录，旧的嵌套布局保持可读；查找只接受 ready 且 signature 匹配的版本（`[index_versioning.py:1-23](../../.reference/DeepTutor/deeptutor/services/rag/index_versioning.py#L1-L23)`、`[index_versioning.py:266-281](../../.reference/DeepTutor/deeptutor/services/rag/index_versioning.py#L266-L281)`）。若当前 embedding 没有对应版本，search 返回 `needs_reindex=true`，而不是拿错误维度继续检索（`[llamaindex/pipeline.py:211-230](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/pipeline.py#L211-L230)`）。

## 3. LightRAG pipeline（图 + 向量，复杂度更高）

LightRAG 是可选依赖，`pyproject.toml` 将其锁定为 `lightrag-hku==1.5.7rc2`（`[pyproject.toml:238-242](../../.reference/DeepTutor/pyproject.toml#L238-L242)`）。适配器在运行时强制精确版本，构造 LightRAG 时注入统一 LLM、embedding、可选 vision 函数，并关闭 SDK 自动 storage state 管理（`[lightrag/engine.py:26-49](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/lightrag/engine.py#L26-L49)`、`[lightrag/engine.py:185-211](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/lightrag/engine.py#L185-L211)`）。

支持 `naive/local/global/hybrid/mix` 查询模式，默认 `hybrid`；QueryParam 强制 `include_references=True`，并要求 SDK 返回结构化 `llm_response`、`data`、`metadata`，再把 chunks/entities/relationships/references 转成 sources（`[lightrag/config.py:33-36](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/lightrag/config.py#L33-L36)`、`[lightrag/engine.py:406-439](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/lightrag/engine.py#L406-L439)`）。

LightRAG 的同步/异步存储可能阻塞 API，因此索引和查询均在独立线程私有 event loop 运行，通过 `OwnerLoopBridge` 将网络 I/O、回调和取消请求转回 owner loop（`[lightrag/worker.py:1-10](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/lightrag/worker.py#L1-L10)`、`[worker.py:152-227](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/lightrag/worker.py#L152-L227)`）。索引过程以 track_id 轮询每个文件状态，只有全部 terminal 且成功时才写 native published metadata；半成品或 legacy index 会 fail closed 要求重建（`[lightrag/pipeline.py:140-261](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/lightrag/pipeline.py#L140-L261)`、`[lightrag/pipeline.py:345-397](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/lightrag/pipeline.py#L345-L397)`）。

## 4. 运行和依赖事实

- DeepTutor 要求 Python 3.11–3.13；README 的安装流程是 `pip install -U deeptutor`、`deeptutor init`、`deeptutor start`，初始化向导可选 embedding（`[README.md:230-245](../../.reference/DeepTutor/README.md#L230-L245)`）。
- 默认依赖包含 `llama-index>=0.14.12`、`llama-index-retrievers-bm25>=0.7.1,<0.8.0`、FAISS 集成与 `faiss-cpu`，以及 PDF/Office 解析库（`[pyproject.toml:45-70](../../.reference/DeepTutor/pyproject.toml#L45-L70)`）。
- LightRAG 和 GraphRAG 作为可选 extra；LightRAG 安装命令为 `pip install -e "[rag-lightrag]"`（`[README.md:284-296](../../.reference/DeepTutor/README.md#L284-L296)`）。
- CLI 生命周期覆盖 `kb list/info/create/add/search/set-default/delete`；示例 `deeptutor kb create my-kb --doc textbook.pdf`、`deeptutor run deep_solve ... --tool rag --kb my-kb`（`[README.md:419-427](../../.reference/DeepTutor/README.md#L419-L427)`、`[README.md:760-769](../../.reference/DeepTutor/README.md#L760-L769)`）。
- Docker/Compose 将整个 `data` 树持久化，其中包括 knowledge bases、配置和日志；可选 extra 应在镜像/部署层安装，而不是容器启动后临时 `pip install`（`[compose.yaml:147-157](../../.reference/DeepTutor/compose.yaml#L147-L157)`、`[README.md:614-614](../../.reference/DeepTutor/README.md#L614-L614)`）。

## 5. 与 Chalk 约束的冲突和可行边界

Chalk 当前权威约束是“业务后端全 TypeScript”，并通过 ADR 0003 明确允许一个**独立 Python 在线 retrieval sidecar**。sidecar 可以执行 LightRAG 原生索引和查询，但不能把 DeepTutor 的 FastAPI、Python RAGService 直接嵌进 `apps/api`，也不能承载 Chalk 认证、owner 授权、业务状态机或证据账本。跨语言协议由 Zod → JSON Schema → Pydantic 生成，证据账本与 DSL 校验永远留在 TS（`[docs/architecture/tech-stack.md:8-12](../architecture/tech-stack.md#L8-L12)`、`[tech-stack.md:282-302](../architecture/tech-stack.md#L282-L302)`）。

推荐边界：

```text
apps/api (Fastify/TS, owner auth + DAL + job API)
    ├─ Postgres/Drizzle: kb、document、index_job、index_version、retrieval_audit
    ├─ Object storage: 原始文件/解析中间产物（MinIO/S3）
    └─ pg-boss/Graphile Worker job
          ↓ 明确版本化 JSON/内部 HTTP
Python LightRAG sidecar
    ├─ parse → chunk/entity extraction → embed → graph/vector index
    └─ upload immutable artifact + manifest/checksums + status
```

在线 query 路径由 TS Service 负责 owner 校验、配额、审计和响应投影；经授权后，Fastify 通过内部只读 HTTP 调用 sidecar，使用 `index_version_id` 和受控的索引句柄。sidecar 不接受客户端 `userId` 作为授权依据，也不自行决定授权。索引构建可以由队列触发，但仍由同一 sidecar 执行 LightRAG 原生索引并发布不可变版本。

跨语言协议建议使用两个窄契约（由 Chalk Zod 生成 JSON Schema，并在 worker CI 生成 Pydantic）：

1. `IndexJobRequest`：`jobId`, `knowledgeBaseId`, `indexVersionId`, `documents[]`（对象存储 key、sha256、mime、relativePath）、`embedding`（provider/model/dimension/role semantics）、`chunk`（size/overlap）、`parser`、`callback`。
2. `IndexJobResult`：`jobId`, `state`（`running|succeeded|failed|cancelled`）、`processed[]`, `failed[]`（稳定 error code + message）、`artifact`（URI、manifest checksum、schema/version）、`embeddingSignature`。

Python worker 不接收或保存 API key；embedding/LLM 凭据由 TS 侧短期注入或由受控 Provider 代理提供。日志、结果和 telemetry 禁止 token/Cookie。worker 必须幂等（以 `jobId`/`indexVersionId` 为幂等键）、可取消、有限重试，并在完成后由 TS 事务把 index version 从 `building` 原子切换为 `ready`。

## 6. Chalk 首期 MVP 建议

1. **仅 LightRAG**：锁定 DeepTutor 已验证的 `lightrag-hku==1.5.7rc2`（或在单独兼容性评审后升级），采用 `hybrid` 查询和结构化 references；不引入其他 RAG provider。
2. **离线索引任务**：上传确认后由 Fastify 写 `index_job` 并投递 pg-boss；Python worker 拉取对象存储文件，构建 LightRAG 临时 workspace，成功后上传不可变 artifact。旧 ready 版本保留，失败不影响在线检索。
3. **在线检索**：ADR 0003 已接受受限 Python retrieval sidecar。Fastify 先完成 owner 校验、配额和审计，再以 `index_version_id` 调用内部接口；sidecar 不接受客户端 `userId` 作为授权依据，也不自行决定授权。sidecar 不可用、超时或返回非法 envelope 时，API 必须显式失败或返回可解释的“暂不可用”。
4. **权限和数据访问集中在 TS DAL**：所有 KB、文档、chunk、job 查询第一个参数为 `userId`，owner 条件进入 SQL；Python 只看到已授权、已签名的对象 key。
5. **契约与测试先行**：Vitest 验证 Zod schema、状态机和 owner fail-closed；Python 用生成的 Pydantic 模型和 fixture 测试；增加索引重试、embedding 维度变化、重复上传、部分失败、取消、旧版本回退测试。
6. **可观测性与契约测试**：每次 index/query 记录 `traceId`, `jobId`, `kbId`, `indexVersionId`, embedding signature、top_k、latency、result chunk IDs；内容可按敏感级别脱敏。首期只验证索引生命周期、查询 envelope、引用结构、失败分类、owner 隔离和恢复行为；检索质量 golden-set 评估后置。检索结果进入教学 Agent 前，TS 生成带稳定 citation ID 的 context，避免把 Python 自然语言答案直接写入证据账本。

## 7. DeepTutor 的 RAG 评估现状

结论是：**DeepTutor 做了大量工程测试和少量真实 SDK smoke/integration，但没有发现系统性的 RAG 检索质量评估。**

已有覆盖：

- `tests/services/rag/` 覆盖 provider 路由、解析/摄取、embedding 维度、索引版本、失败分类、引用映射、LightRAG 状态发布和增量实体关系等确定性行为；例如 `test_lightrag_pipeline.py` 检查 query envelope、sources 和 published metadata，`test_lightrag_native_smoke.py` 使用真实锁定的 LightRAG SDK，但 LLM/embedding 使用 fake，验证的是“能处理到 processed”和图关系写入，而不是答案质量（`[test_lightrag_pipeline.py:360-456](../../.reference/DeepTutor/tests/services/rag/test_lightrag_pipeline.py#L360-L456)`、`[test_lightrag_native_smoke.py:1-18](../../.reference/DeepTutor/tests/services/rag/test_lightrag_native_smoke.py#L1-L18)`）。
- `test_pipeline_integration.py` 提供 initialize → search → delete 的端到端检查，并要求 `RAG_INTEGRATION_TESTS=1` 才运行；断言主要是结果字段、流程成功和工具调用成功，不计算 Recall@k、MRR、nDCG、答案 groundedness 或 citation precision（`[test_pipeline_integration.py:1-17](../../.reference/DeepTutor/tests/services/rag/test_pipeline_integration.py#L1-L17)`、`[test_pipeline_integration.py:403-429](../../.reference/DeepTutor/tests/services/rag/test_pipeline_integration.py#L403-L429)`）。
- CI 的 Python job 安装 LightRAG 依赖，但默认只运行 `pytest -q tests deeptutor/learning/tests`；没有看到独立的 RAG golden dataset 或质量门禁，live provider integration 仍是显式 opt-in（`[.github/workflows/tests.yml:164-191](../../.reference/DeepTutor/.github/workflows/tests.yml#L164-L191)`）。

未发现的评估能力：固定问题—证据集、Recall@k/Precision@k/MRR/nDCG、context recall/precision、faithfulness/answer relevance、citation correctness、不同查询模式（naive/local/global/hybrid/mix）的对比基准，以及真实学生学习增益。因此，不能把 DeepTutor 的测试通过等同于“RAG 检索效果已经被证明”。

上述质量评估**明确后置**，不阻塞首期 LightRAG 接入。后续阶段再建立数学教材/题目 golden set，每条包含 query、期望证据 chunk/reference、不可接受证据和答案要点；离线运行 LightRAG `hybrid` 检索，至少计算 Recall@k、MRR、citation hit rate、无证据问题的 abstention rate，并将索引/解析器/embedding/LightRAG 版本写入结果。LLM judge 可评估答案 faithfulness 和适龄表达，但不能替代确定性的证据命中指标，也不能直接写入学生掌握度。

## 8. 一手资料与版本核验

- DeepTutor 本地快照：`.reference/DeepTutor`（上述源码行号，核验时间 2026-08-31）。
- LlamaIndex 官方仓库/文档：[run-llama/llama_index](https://github.com/run-llama/llama_index)；DeepTutor README 也将其列为 RAG pipeline 和 document-indexing backbone（`[README.md:891-899](../../.reference/DeepTutor/README.md#L891-L899)`）。
- LightRAG 官方仓库：[HKUDS/LightRAG](https://github.com/HKUDS/LightRAG)；DeepTutor 固定使用 `lightrag-hku==1.5.7rc2`，升级前必须重新核对 SDK 返回结构和 adapter contract。

### 结论

DeepTutor 最值得迁移的是 LightRAG adapter 的“固定 SDK 版本、解析/embedding/LLM seam、独立 event loop、结构化 citations、published metadata、显式失败状态”和其测试组织方式，而不是 Python/FastAPI 运行时。对 Chalk，首期部署受限 Python LightRAG sidecar，先完成生命周期与契约可靠性；在线授权、检索结果投影和教学语义全部留在 TypeScript。系统性 RAG 质量评估记录为后续阶段，不在本次接入中实现。
