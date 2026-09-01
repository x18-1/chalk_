# ADR 0003：Python LightRAG 在线检索 sidecar

> 状态：Accepted
> 决策日期：2026-08-31
> 适用范围：Chalk RAG / Knowledge Base

## 背景

Chalk 的业务后端、认证、数据库访问和教学证据仍使用 TypeScript。首期 RAG 只选择 LightRAG。LightRAG 的原生查询同时包含 query embedding、图/向量检索、结果组合和可选的 LLM synthesis；如果只把索引构建放在 Python，在线请求就无法完整使用 LightRAG 的查询语义。

## 决策

增加一个独立的 Python LightRAG retrieval sidecar，负责：

- 文档解析、chunk 和 LightRAG workspace 构建；
- embedding 调用、图/向量检索和 `hybrid` 查询；
- 返回结构化 answer 与 references。

TypeScript API 负责：

- 当前用户认证、owner 校验、知识库和 `indexVersionId` 解析；
- 配额、审计、telemetry、错误映射和响应投影；
- 索引任务的数据库状态、lease、heartbeat、幂等与恢复。

sidecar 只通过内部受控接口访问，不直接对浏览器或公网开放，也不自行决定用户权限。

## 接口不变量

内部查询接口至少携带：

- `indexVersionId`；
- 已规范化的 query；
- `mode`（首期默认 `hybrid`）；
- `topK` 和超时/取消信号。

返回值必须包含：

- `answer`（可为空，但不能伪造无证据答案）；
- `references[]`，每项带稳定的文档/chunk/reference 标识和必要定位信息；
- LightRAG adapter/schema/package 版本信息；
- 可分类的错误码，不返回密钥、Cookie、内部路径或未脱敏 Provider 错误。

接口 schema 由 TypeScript Zod 维护并生成 JSON Schema，Python 侧使用生成的 Pydantic 模型。不得在两端手写同一业务结构。

## 安全与可靠性约束

- sidecar 使用独立服务身份和最小网络权限；TypeScript API 是唯一面向用户的授权入口。
- Python 不读取 Chalk 凭据数据库；LLM/embedding 使用受控模型代理或短期凭据。
- 原始文件和 workspace 按不可变 `indexVersionId` 隔离；旧 ready 版本在新版本失败时继续可用。
- 索引构建必须支持幂等、取消、有限重试和 lease/heartbeat 恢复。
- 查询超时、sidecar 不可用或返回 malformed envelope 时，API 显式失败或返回可解释的“暂不可用”，不能静默降级成无依据回答。

## 未选择的方案

1. **Python 只做离线索引，TypeScript 在线查询**：遵守旧的 Python 离线约束，但不能完整复用 LightRAG 原生 graph/query 语义，首期不采用。
2. **将 LightRAG 代码直接嵌入 TypeScript API**：LightRAG 及其依赖是 Python 实现，会把语言和运行时耦合进业务 API，放弃。
3. **引入多个 RAG provider**：首期不做；保持 LightRAG-only，降低运行、权限和迁移复杂度。

## 后续工作

本 ADR 不承诺首期建设系统性 RAG 质量评估。首期先完成 sidecar 契约、生命周期、owner 隔离和可靠性测试；golden set、Recall/MRR、citation correctness 和 faithfulness 评估后续单独立项。
