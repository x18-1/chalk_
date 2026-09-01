# ADR 0003：Python LightRAG 在线检索 sidecar

> 状态：Accepted
> 决策日期：2026-08-31

## 决策

Chalk 首期 RAG 使用独立 Python LightRAG sidecar。它负责文件解析、chunk、embedding、图/向量索引、hybrid 查询和结构化 references；TypeScript API 负责认证、owner 校验、配额、审计、错误映射和业务数据。

sidecar 只通过内部认证 HTTP/JSON 接口访问，不对浏览器或公网开放，也不接受客户端 `userId` 作为授权依据。协议由 TypeScript Zod 生成 JSON Schema，Python 侧使用 Pydantic 模型。

协议产物为 `apps/rag-sidecar/protocol/schema.json`，由
`pnpm --filter @chalk/api rag:protocol:generate` 生成；修改接口时必须同步运行
sidecar 的协议测试。

## MVP 范围

- 知识库列表、创建和文档上传；
- PDF、Markdown、纯文本和 DOCX 解析；解析引擎可选 `text_only`、`markitdown` 或 `mineru`，统一在 Python sidecar 中执行；
- LightRAG `hybrid` 查询，配置 chunk size、overlap、top-k；
- answer 与文档名、页码、段落、chunk 标识；
- owner 隔离、协议校验和 sidecar 故障处理。

系统性 Recall/MRR、citation correctness 和 faithfulness 评估后置，不阻塞 MVP。
