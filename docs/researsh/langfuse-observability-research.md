# Langfuse 可观测性调研

> 调研日期：2026-08-21
> 资料范围：Langfuse 官方文档及官方 API 文档索引（`llms.txt`、`llms-docs.txt`）；未使用二手文章。
> 目标：为 Chalk 管理员后台的 Agent 运行观测设计提供事实依据，不表示 Chalk 要直接采用 Langfuse 的产品或存储。

## 一句话结论

Langfuse 把一次可追踪工作组织成 `trace`，把其中的每个步骤组织成可嵌套的 `observation`；多轮对话或跨请求流程再用 `session` 聚合。它把模型调用单独建模为 `generation`，因此 token、模型、成本等字段可以稳定地查询和聚合；工具、Agent、检索等步骤则用对应 observation type 表示。官方产品的关键能力来自这套稳定的层级、可传播属性和面向聚合的查询模型，而不是只记录文本日志。

## 1. 数据模型与层级

### Trace、Observation、Session

- `observation` 是应用的单个步骤，例如 LLM 调用、工具调用、检索或自定义逻辑；observation 可以嵌套。
- `trace` 是一次自包含的请求/操作，代表共享同一 `trace_id` 的 observations 的逻辑分组。官方示例包括一次 chatbot turn、一次 Agent run、一次 pipeline execution。
- `session` 可选地把多个 traces 聚合成一段用户交互，例如一个多轮聊天线程。官方建议“一轮一个 trace、整段会话一个 session”，这样单条 trace 保持小而容易调试。
- trace 属性 `user_id`、`session_id`、`tags`、`metadata` 会由 SDK 传播到该 trace 的 observations；官方概念说明称，查询模型上每个 observation 行会带有这些 trace 属性的副本，以便快速筛选和聚合。

来源：[Core Concepts](https://langfuse.com/docs/observability/data-model.md)、[What does a good trace look like?](https://langfuse.com/docs/observability/best-practices.md)、[Sessions](https://langfuse.com/docs/observability/features/sessions.md)

### Observation 类型

官方当前列出的类型包括：

| 类型 | 官方含义/用途 |
| --- | --- |
| `event` | 追踪 trace 中的离散事件 |
| `span` | 有持续时间的工作单元 |
| `generation` | AI 模型生成，支持 prompt、token usage、cost、model |
| `agent` | 决定应用流程，可在 LLM 指导下使用工具 |
| `tool` | 单次函数/API 等动作 |
| `chain` | 应用步骤之间的连接，例如把检索上下文交给 LLM |
| `retriever` | 只读取数据的检索步骤 |
| `evaluator` | 评估输出相关性、正确性或帮助性的函数 |
| `embedding` | 生成 embedding 的模型调用，也可记录 token 和 cost |
| `guardrail` | 防护恶意内容或 jailbreak 的组件 |

框架集成可自动设置类型；手动埋点可通过 SDK 的 `as_type`/`asType` 设置。官方最佳实践要求 LLM 调用使用 `generation`、工具调用使用 `tool`，这样才能按类型过滤和进行评估/看板配置。

来源：[Observation Types](https://langfuse.com/docs/observability/features/observation-types.md)、[What does a good trace look like?](https://langfuse.com/docs/observability/best-practices.md)

### 父子关系、时间线与 Agent Graph

- observation 的嵌套应表达真实编排：工具调用通常嵌套在负责它的 `agent` 或 `span` 下，并与发起工具调用的 `generation` 成为同级步骤。
- trace UI 展示 trace tree；Agent Graph 可从 observation 的嵌套和时间推断 Agent 工作流。官方说明中，除 `span`、`event`、`generation` 外的 observation 类型可触发 agentic graph 解释。
- 观测字段包含 start/end 时间；官方 v2 Observations API 还区分物理父级 `parentObservationId` 与逻辑根 `isRootObservation`。逻辑根可以在有物理 parent 时仍为 true（例如外部父 span 未导出）。
- 默认 trace ID 是随机 32 位十六进制、observation ID 是随机 16 位十六进制；SDK 支持自定义/确定性 trace ID，用于把外部请求 ID 与 trace 关联。

来源：[What does a good trace look like?](https://langfuse.com/docs/observability/best-practices.md)、[Agent Graphs](https://langfuse.com/docs/observability/features/agent-graphs.md)、[Trace IDs & Distributed Tracing](https://langfuse.com/docs/observability/features/trace-ids-and-distributed-tracing.md)、[Observations API](https://langfuse.com/docs/api-and-data-platform/features/observations-api.md)

## 2. 属性、身份和可筛选维度

### User、Session、Metadata、Tags

- `userId` 是可选的、由应用传播的唯一标识（可为用户名、邮箱或其他 ID）。Langfuse 的 Users view 可按用户查看 trace、token usage、cost 和反馈；Metrics API 可做用户级聚合。
- `sessionId` 是应用定义的 US-ASCII 字符串，少于 200 个字符；相同 `sessionId` 的 observations 及其 traces 会被聚合，超长 ID 会被丢弃。
- `metadata` 是自定义键值上下文，可在 UI/API 按键筛选；通过传播 API 继承时，官方约束为 key 仅字母数字，value 最多 200 字符，超长 value 会被丢弃。
- `tags` 是每条 observation 可有多个的字符串标签，每个最长 200 字符；一个 trace 的 observation tags 会聚合到 trace。标签适合 feature、endpoint、workflow 等业务维度，不要混用 user、session 或 environment。官方文档说明 observation 数据模型不可变，因此 tags 创建后不能在 UI 修改。
- 另有 environment、release/version、prompt 等属性用于拆分部署上下文、版本和提示词变更。

来源：[User Tracking](https://langfuse.com/docs/observability/features/users.md)、[Sessions](https://langfuse.com/docs/observability/features/sessions.md)、[Metadata](https://langfuse.com/docs/observability/features/metadata.md)、[Tags](https://langfuse.com/docs/observability/features/tags.md)、[Core Concepts](https://langfuse.com/docs/observability/data-model.md)

### 状态与日志等级

observation 可记录 `level`（`DEBUG`、`DEFAULT`、`WARNING`、`ERROR`）及 `statusMessage`。这提供错误/警告筛选和诊断上下文；官方集成可根据模型/API 响应自动设置等级。

来源：[Log Levels](https://langfuse.com/docs/observability/features/log-levels.md)

## 3. Generation 的 token、成本和延迟

- 对每个 `generation`（以及 `embedding`），Langfuse 记录按 usage type 拆分的 usage details 和 cost details。常见桶为 input/output，也可有 provider 特有的 cached/audio/reasoning token 等。
- usage/cost 可以由应用从模型响应直接写入，也可以依据 generation 的 model 与模型价格定义推断。官方提供常见模型价格，并支持自定义模型定义和显式成本覆盖。
- usage bucket 必须互斥；例如 `input` 不应再次包含 `input_cached_tokens`。重叠会造成成本和 token 双计。推理模型如果没有已摄入 token，通常无法自动推断成本。
- 官方最佳实践建议 generation 至少有稳定的 observation name、model name、usage details；cost details 可用于自定义合同价格。不要把 observation name 写成模型名，因为换模型会破坏已有筛选/评估/看板。
- 观测和图表支持 latency；UI 图表可对 latency 做 average、median/p50、p95、p99、max、min，对 cost/tokens 做 sum、average、p95、max。Pulse 以 count、cost、latency（默认 p95）展示时间异常段。

来源：[Token & Cost Tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking.md)、[What does a good trace look like?](https://langfuse.com/docs/observability/best-practices.md)、[Chart any table](https://langfuse.com/docs/observability/features/events-table-charts.md)、[Pulse](https://langfuse.com/docs/observability/features/pulse.md)

## 4. 查询、过滤和聚合

### 行级 observation 查询

官方 v2 Observations API 为高性能、游标分页和选择性字段读取设计：默认返回 `core,basic`，可按需请求 `io`、`metadata`、`model`、`usage`、`metrics`、`trace_context` 等字段组；最大 limit 为 1,000，结果按 startTime 倒序。API 可按时间范围、traceId、name、type、userId、level、parentObservationId、isRootObservation、environment、version 和 JSON `filter` 查询。v2 返回 observation rows；需要完整 trace 时按 `traceId` 分组并按 parent ID 重建树。

来源：[Observations API](https://langfuse.com/docs/api-and-data-platform/features/observations-api.md)、[Query via SDKs](https://langfuse.com/docs/api-and-data-platform/features/query-via-sdk.md)

### Filter bar 与全文本

UI filter search bar 使用 `field:value` 语法并隐式 AND，支持比较运算、通配符、否定、OR/AND 数组值、metadata dot path、score dot path、存在性检查和 input/output 全文搜索。例如 `user:alice type:TOOL latency:>2`、`metadata.region:eu`、`tags:(billing AND urgent)`。查询会序列化到 URL，便于分享精确视图。

来源：[Filter search bar](https://langfuse.com/docs/observability/features/filter-search-bar.md)、[Full-Text Search](https://langfuse.com/docs/observability/features/full-text-search.md)

### Metrics API 聚合

官方 v2 Metrics API 接收 dimensions、metrics、filters 和时间范围/粒度，支持聚合 cost、token usage、volume、latency、score，并可按 model 或 trace attributes 分组，服务于报表、看板、计费与监控。v2 使用 `observations` view（不再提供 `traces` view），且 `id`、`traceId`、`userId`、`sessionId` 等高基数字段不能作为分组维度，但仍可过滤；API 有默认 100 行、最大 1,000 行限制。

来源：[Metrics API](https://langfuse.com/docs/metrics/features/metrics-api.md)、[Query via SDKs](https://langfuse.com/docs/api-and-data-platform/features/query-via-sdk.md)

## 5. 采样、异步发送和数据完整性

- Langfuse sampling 在客户端完成；`sample_rate`/`sampleRate` 或 `LANGFUSE_SAMPLE_RATE` 取 0 到 1，默认 1。采样按 trace 决定：一个 trace 被采样后，其 observations 和 scores 一并发送；未采样则整条 trace 都不发送。
- SDK/integration 默认在后台排队并批量发送，避免同步阻塞应用。短生命周期进程必须显式 `flush()`/`shutdown()`（JS/OTEL 为 `forceFlush()`），否则进程退出可能丢失队列中的事件。
- Langfuse 基于 OpenTelemetry，可将同一 telemetry 发往多个后端；因此 exporter/adapter 是合理的隔离边界。

来源：[Sampling](https://langfuse.com/docs/observability/features/sampling.md)、[Event queuing/batching](https://langfuse.com/docs/observability/features/queuing-batching.md)、[Core Concepts](https://langfuse.com/docs/observability/data-model.md)

## 6. 隐私、脱敏、留存和删除

### 脱敏

官方 SDK 提供 masking hook，可在 trace/observation 的 input、output、metadata 发送前脱敏；Python 推荐 `mask_otel_spans`，它在导出阶段修改 OpenTelemetry span attributes。masking 函数应快速、确定性、无阻塞；若 hook 出错，Langfuse 可能丢弃整个导出批次。该 hook 只影响发往 Langfuse 的 exporter，其他 exporter 需要单独配置脱敏。官方也明确说明 masking 不能修改 span name、ID、parent、resource attributes、events 或 links。

来源：[Masking](https://langfuse.com/docs/observability/features/masking.md)

### 留存与删除

- 留存按 project 配置，最小 3 天；未配置时不会自动删除。自托管默认无限期保存，Cloud 的访问窗口按计划而定。系统每晚依据 trace `timestamp`、observation `start_time`、score `timestamp`、media `created_at` 删除过期数据，删除后不可恢复。
- 官方支持按单条 trace、批量 trace、查询过滤结果、project、organization 或 user account 删除；删除 trace 会连带删除其 observations 和 scores。需要长期保留时，官方建议导出到 S3/GCS/Azure Blob。
- 留存对各数据类型独立生效；其他对象引用已删除 trace 时可能留下悬空引用。

来源：[Data Retention](https://langfuse.com/docs/administration/data-retention.md)、[Data Deletion](https://langfuse.com/docs/administration/data-deletion.md)、[Export to blob storage](https://langfuse.com/docs/api-and-data-platform/features/export-to-blob-storage.md)

## 7. 对 Chalk 的适配建议

以下是基于上述官方事实对 Chalk 的设计建议，不是 Langfuse 的产品要求：

1. **稳定层级**：把 Chalk 一次 `AgentRuntime.run()` 建模为 root run/trace；把模型调用、tool/MCP、审批、steer、abort、compaction、子 Agent 等建模为有父子关系的 observation/span。会话继续作为跨多轮 root run 的聚合键。
2. **固定可筛选字段**：root run 与 observation 都应有 `ownerUserId`、`sessionId`、稳定的 `name`、`type`、状态/错误、start/end 时间、environment/release；metadata 用于低基数内部上下文，tags 用于业务维度。不要把模型名塞进 name。
3. **聚合边界**：管理员 API 分成行级详情和聚合查询。聚合至少覆盖按用户与时间范围的 run/observation count、input/output token、cost、latency、failure rate；高基数 user/session 适合过滤，按用户分组需要明确索引和权限。
4. **隐私默认值**：Chalk 面向未成年学生，默认不写入 prompt/completion、tool 参数/结果、凭证、cookie、上传内容或可识别学生文本。若以后开放原文查看，应在写入前做确定性脱敏，并同时落实管理员 RBAC、查看审计、留存期限和删除机制；Langfuse 的 masking 只能作为机制参考，不能替代 Chalk 的访问控制。
5. **可靠采集**：telemetry 持久化与 Agent loop 解耦，采用本地/服务端队列与批量写入；请求结束和进程关闭都要有 flush 屏障，避免只依赖内存事件。采样若启用，应以 root run 为单位，避免出现缺子 span 的半条 trace。
6. **适配器边界**：将现有 pi telemetry 映射到 Chalk 自己的 DAL/schema，再决定是否增加 OpenTelemetry exporter；不要把 Langfuse 的对象模型直接耦合进 Agent loop，也不要把外部 exporter 当成权限边界。
7. **UI 信息架构**：管理员先看时间范围 + 用户筛选的聚合指标，再进入 root run 列表；详情页展示 session → root run → 子 observation 时间线，默认结构化元数据、状态、时序、token/cost/error，原始 payload 作为未来受策略约束的独立能力。

## 官方入口索引

- [Langfuse 官方文档总索引](https://langfuse.com/llms.txt)
- [普通文档索引](https://langfuse.com/llms-docs.txt)
- [Observability 概览](https://langfuse.com/docs/observability/overview.md)
- [OpenTelemetry 相关说明](https://langfuse.com/docs/observability/data-model.md#built-on-opentelemetry)
