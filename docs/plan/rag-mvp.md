# RAG MVP 实施计划

> 状态：Historical
> 实施范围：`feat/rag-lightrag-mvp` worktree

## 目标

完成一条可演示的数学资料问答链路：知识库界面 → 文档上传 → Python LightRAG sidecar 建立索引 → TypeScript API 鉴权并查询 → 返回可定位引用。

## 当前切片

- `apps/rag-sidecar/`：独立 Python 运行时，负责 PDF/Markdown/纯文本/DOCX 解析、LightRAG chunk/index/query 和可选 rerank adapter。
- `apps/api`：Knowledge Base/Document DAL、owner 校验、预签名上传、sidecar 协议校验、错误映射和安全投影。
- `apps/web`：知识库列表、创建、上传、索引状态、提问和引用展示。
- 首期测试：Zod/sidecar envelope、sidecar 超时和不可用、owner 条件由 DAL 强制；不包含系统性 Recall/MRR 评估。
- 索引确认采用单机进程内异步 worker：接口返回 `202`，文档经过 `pending` → `indexing` → `ready`/`failed`，失败可重试。

## 明确后置

- 索引版本回退和多副本协调；
- 更多解析器和 OCR；
- 多个 RAG provider；
- golden set、Recall/MRR、citation correctness、faithfulness 等检索质量评估。
