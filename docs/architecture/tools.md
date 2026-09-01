# Agent Tools 规范

> 文档状态：Draft
> 实施状态：Documented
> 适用范围：`packages/agent-runtime` 的通用 Tool 执行模块、`apps/api` 的工具装配与配置
> 最后核验：2026-08-24

本文定义 Chalk Agent Tool 的长期契约。它不是某一个具体工具的使用说明，而是所有内置工具、Chalk 业务工具、Subagent 工具和 MCP 工具进入 Agent 前必须满足的共同规范。

## 1. 目标

Tool 是一个受控的 Agent 能力单元。一个合格的 Tool 契约必须同时回答：

- 模型什么时候可以看到它；
- 它可能产生什么副作用；
- 它需要什么审批；
- 它最多运行多久；
- 它最多向模型返回多少内容；
- 取消、超时、拒绝和执行失败如何区分；
- 谁能配置、调用和审计它。

Tool 的执行复杂度集中在 `packages/agent-runtime` 的 Tool 模块中。业务工具只实现窄的执行接口，不在每个工具里重复实现审批、超时、结果限制和 telemetry。

## 2. 适用边界

### Runtime package 负责

- Tool interface 和注册校验；
- 工具可见性筛选；
- 平台安全策略与用户设置的合并；
- 审批门；
- 取消、超时和结果预算；
- 统一错误分类和运行事件；
- Pi `AgentTool` adapter；
- 不包含业务数据的 tool telemetry。

### API 组合根负责

- 当前用户和 conversation/session 上下文；
- 工具实现及其业务 adapter；
- 用户可配置的启停和审批偏好；
- owner 校验、配额、审计持久化和产品角色策略；
- 工具清单的公开投影。

### Tool 实现负责

- 解析后的业务参数对应的实际动作；
- 明确声明副作用、审批底线和资源限制；
- 尊重 `AbortSignal`；
- 返回有限、面向模型的结果和结构化 details。

## 3. Tool 契约

当前 `RuntimeTool` 的公共字段是基础契约。第一阶段应扩展为以下语义模型：

| 字段 | 要求 |
|---|---|
| `name` | 稳定、唯一、机器可读；不能把可变显示名称作为身份的一部分 |
| `label` | 面向 UI 的短名称，不作为权限或持久化身份 |
| `description` | 说明用途、输入前提和重要限制；不能包含未经验证的能力承诺 |
| `parameters` | TypeBox schema；注册时必须存在且可用于 Pi 参数校验 |
| `source` | `builtin`、`chalk`、`mcp` 或 `subagent`；用于策略和观测 |
| `effects` | 只读、修改数据、网络访问、进程执行、产生费用等副作用声明 |
| `approvalPolicy` | 工具声明的平台最低审批要求，调用方不能降低它 |
| `limits` | 默认/最大超时、文本结果预算和必要的调用限制 |
| `executionMode` | `sequential` 或 `parallel`；有共享状态或副作用的工具必须串行 |
| `execute` | 只接收已校验参数、运行上下文、取消信号和增量更新回调 |

实现还要求显式声明 `defaultEnabled`。它决定没有用户覆盖时工具是否进入下一次 runtime；它不是审批策略，也不代表工具已经连接成功。`ToolSummary` 会同时返回解析后的 `limits` 和 `executionMode`，设置页和实际 runtime 必须消费同一份摘要。

其中 `effects` 和 `approvalPolicy` 是安全事实，不是 UI 偏好。用户设置只能在平台允许的范围内增加审批或关闭工具，不能关闭平台强制审批。

## 4. 执行生命周期

所有工具通过同一执行包装器进入 Agent：

```text
register
  -> validate definition
  -> resolve visibility and policy
  -> validate arguments (Pi)
  -> check abort
  -> request approval when required
  -> execute with timeout and AbortSignal
  -> normalize result and enforce output budget
  -> emit telemetry and runtime event
```

工具实现不得绕过包装器直接注入 Pi `AgentTool`。这样才能保证新工具自动继承平台的执行保护。

## 5. 执行限制

第一阶段采用以下默认值，具体常数可通过实现后的成本和延迟观测调整，但必须保留硬上限：

| 限制 | 默认值 | 硬上限 | 说明 |
|---|---:|---:|---|
| 单次工具超时 | 30 秒 | 120 秒 | 超时必须中止执行并返回 `timed_out` |
| 模型可见文本结果 | 12,000 字符 | 32,000 字符 | 只限制模型上下文，不改变业务侧真实结果的存储策略 |
| 增量更新文本 | 4,000 字符/次 | 8,000 字符/次 | 防止进度事件本身膨胀上下文或 SSE |

工具可以声明更严格的限制，不能超过硬上限。忽略 `AbortSignal` 的工具不得被标记为可取消可靠；实现评审必须补充说明其资源释放方式。

结果截断必须可观测，并向模型返回明确的 `details.resultTruncated` 标记，不能静默丢失内容。当前第一阶段只提供截断事实，不伪造“继续读取”能力；需要分页或继续读取的工具必须在自己的 TypeBox 参数和 details 中定义稳定 cursor/token，并在下一阶段接入通用 continuation 契约。二进制、图片和未来的 artifact 需要独立的大小契约，不得借用文本字符数假装已完成限制。

## 6. 审批策略

审批分为三层：

1. **平台底线**：由 Tool 的副作用和产品策略决定，不能被用户关闭。
2. **应用策略**：由 API 根据角色、配额、conversation 状态和工具来源决定。
3. **用户偏好**：只能在允许范围内增加询问、停用工具或选择默认行为。

建议的最低规则：

- 纯只读、无网络和无外部副作用的工具可默认免审批；
- 修改会话、学习记录、画像、证据或外部资源的工具必须审批；
- 网络访问、进程执行、付费调用和不可逆动作默认必须审批；
- 缺少审批 port 时 fail closed；
- 用户设置为“不询问”不能覆盖平台强制审批。

## 7. 错误契约

Tool wrapper 必须把失败归入稳定类别，而不是依赖错误文案：

| 类别 | 含义 |
|---|---|
| `invalid_definition` | Tool 注册定义非法 |
| `approval_required` | 需要审批但没有可用审批 port |
| `approval_rejected` | 用户或策略拒绝 |
| `approval_timed_out` | 审批等待超时 |
| `cancelled` | Agent run 或调用方主动取消 |
| `timed_out` | 工具执行超过预算 |
| `invalid_arguments` | 参数未通过 schema 或业务边界校验 |
| `execution_failed` | 工具自身或外部依赖失败 |

Read 工具还可以返回资源专属稳定码：`read_cursor_invalid`、`read_cursor_expired`、`read_snapshot_changed`、`read_access_denied`、`read_unsupported_media_type`、`read_unsupported_resource` 和 `read_line_too_large`。这些码仍通过同一 `ToolExecutionError`/`ToolErrorChannel` 传播。

结果成功但超出文本预算时不抛出错误，而是在 `details.resultTruncated` 中记录 `originalCharacters` 和 `maxCharacters`；工具未启用时不会进入 Agent 工具列表，因此没有一次执行错误。

错误详情可以进入 telemetry 和受控审计，但面向学生的文本必须经过产品层投影，不直接暴露内部堆栈、命令行或凭据。

## 8. 注册与清单

注册时必须拒绝：

- 空名称、超长名称或不符合机器名格式的名称；
- 重复名称；
- 空 label/description；
- 缺少 TypeBox schema；
- 不支持的 source/effects/execution mode；
- 超过平台硬上限的 timeout/result budget。

工具清单必须来自同一个 registry：设置页展示的工具、策略配置校验的工具和实际注入 Agent 的工具不能由三套不同装配逻辑产生。当前 `run_subagent` 已装配进主 runtime，但尚未进入公开设置清单；在它公开前，平台将其视为内部能力并保持 `defaultEnabled: false`。

## 9. 观测要求

每次工具调用至少记录：工具稳定名称、source、状态、持续时间、是否审批、是否截断、错误类别和父 Agent run/session 标识。Pi 会把 execute 异常转换为普通错误结果，因此 runtime 通过受控 `ToolErrorChannel` 把 `ToolExecutionError.code` 传到 `tool_finished.errorCode` 和 telemetry；默认不记录原始参数和完整结果。

Telemetry 不得通过匹配错误字符串来判断状态。参数脱敏、审批摘要和原文审计属于后续阶段，在没有明确数据分类前不能默认写入完整参数。

## 10. 后续扩展

以下能力不属于第一阶段，但接口设计不能阻塞它们：

- 稳定工具 ID、版本和迁移；
- 参数字段级脱敏和审批摘要；
- 每用户/每会话配额和成本预算；
- 幂等键与重复调用检测；
- 工具安装、来源签名和供应链信任；
- 多实例执行队列和可恢复调用。

## 11. Read 工具与继续读取

`read_resource` 是 Agent 可见的统一 Read 工具。它接收 `{ resource: { kind, id } }`，内部通过 `ResourceReadAdapter` 路由到具体资源类型。当前注册 `upload` 和 `mcp_resource` 两类 adapter：上传文本通过 MinIO/S3 Range 请求按字节读取；MCP Resource 通过 `<server-id>/<resource-uri>` 引用，并由 MCP client 读取远端文本后复用同一套分页和 snapshot 校验。MCP 连接初始化会发现 `resources/list` 并处理分页，proxy `search` 返回 Resource 的 `id`，因此模型不需要猜测 URI。

Skill 使用独立的 `read_skill` 工具，不接受文件路径，只接受已加载 Skill 的名称。工具仅允许读取当前用户已启用且允许模型调用的 Skill，并把 `SKILL.md` 正文作为受限文本结果返回；停用、未加载或 `disable-model-invocation: true` 的 Skill 均 fail closed。Skill 摘要仍通过 system prompt 渐进披露，避免启动时把所有正文塞入上下文。API 只把应用内置 `skills` 目录及其真实路径下的子目录标记为 trusted；其他 `SKILLS_DIRS` 来源不会进入 Agent。

`maxBytes` 是单次对象 Range 和模型可见页面的硬上限（1,024–32,768 字节）。如果换行符超出本次 Range，工具不会返回原地踏步的 cursor；当页面无法消费任何完整行时返回 `read_line_too_large`，调用方应在允许范围内提高 `maxBytes`。底层 adapter 还会在对象 EOF 前截断异常超长的 provider 响应，并避免对 EOF 之后发起 Range 请求。

Read 结果的 `details` 至少包含：资源 ID、文件名、起止行、起止字节、`hasMore`，以及在还有内容时的 opaque continuation cursor。cursor 由服务端签名，并绑定 owner、conversation、资源 ID、资源 snapshot、下一字节位置和过期时间。下一次调用只能把 cursor 原样交回工具，不能由模型修改。

当前 Read 只支持 `upload` 和 `mcp_resource` 的文本内容；MCP 协议的 `resources/read` 没有 byte-range 参数，因此远端单个文本资源先限制为 2 MiB，并以内容 hash 作为 snapshot。知识库检索不复用 `read_resource`：Chat 挂载知识库后，API 为该 runtime 闭包注入唯一的 `search_knowledge_base` 工具，工具内部执行 owner 校验并调用 LightRAG sidecar，返回带文档名、页码/段落和 chunk 的结构化引用。PDF、图片、blob 和知识库 chunk/Web 正文的读取仍需要各自的解码或 Provider adapter，不能把二进制字节直接伪装成文本。后续新增资源类型只增加 adapter，不增加新的 Agent 可见 `read_xxx` 工具。继续读取时如果对象或远端资源 snapshot 发生变化，工具返回 `read_snapshot_changed`，要求重新开始读取。
