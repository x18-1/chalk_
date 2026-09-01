# Agent Tools 设计规格

> 文档状态：Accepted（设计已确认）
> 实施状态：Partial
> 适用分支：`feat/chat-inline-blackboard`
> 最后核验：2026-08-31

## 1. 目标

建立可扩展、可审计、可测试的 Tool 体系。业务 Tool 按 feature-folder 独立维护，Registry
作为唯一组合根；Pi Agent 只接收经过可见性、权限、超时和结果上限包装后的 `AgentTool[]`。

第一阶段只建设进程内执行保护，不实现动态 Tool 加载、复杂批次调度、独立 output schema、
跨进程 exactly-once、可恢复 Tool 调用或通用持久化 Job。Runtime 创建时使用一份 Tool 快照；
配置变化通过重建 Runtime 生效。

## 2. 目录组织

```text
apps/api/src/agent/tools/<tool-name>/
  tool.ts          # RuntimeTool、TypeBox schema、execute
  prompts.ts       # 用途、何时使用/禁止使用、参数组合、结果解释
  schema.ts        # schema 复杂时才拆
  policy.ts        # 特殊 owner/审批策略才拆
  result.ts        # 复杂 details/result 才拆

# Domain tool families also stay under tools/:
apps/api/src/agent/tools/skill-tool/   # read_skill composition
apps/api/src/agent/tools/mcp-tool/     # MCP proxy and read_mcp_resource
apps/api/src/agent/tools/read/         # Chalk upload/resource reading only

apps/api/tests/unit/tools/
  <tool-name>.test.ts       # API/业务 Tool 的单元测试
packages/agent-runtime/tests/unit/tools/
  tool-registry.test.ts     # Registry、Pi adapter、通用执行包装器测试
```

实现按 feature-folder 组织，测试集中放在 package 的 `tests/unit` 下，避免把测试文件混入
运行时模块目录。测试文件名与 Tool 名称对应；跨 Tool 的 Registry、Pi adapter 和 API 集成
测试分别放在 `packages/agent-runtime/tests/` 或 `apps/api/tests/`。测试目录不是运行时自动
发现入口，Tool 必须显式在组合根注册。

最小 Tool 只有 `tool.ts` 和 `prompts.ts`。`prompts.ts` 不是安全边界，不得声明或暗示免审批、
绕过 owner 校验或超出实际实现的能力。`effects`、`approvalPolicy`、`limits`、`executionMode`
和 `source` 必须在结构化 Tool 定义中声明，并由 Registry 校验。

## 3. RuntimeTool 最小契约

```ts
type RuntimeTool = {
  name: string; label: string; description: string;
  parameters: TSchema;
  source: "builtin" | "chalk" | "mcp" | "subagent";
  effects: ("read" | "write" | "network" | "process" | "paid")[];
  approvalPolicy: "none" | "required" | "conditional";
  defaultEnabled: boolean;
  executionMode?: "parallel" | "sequential";
  limits?: { timeoutMs?: number; maxResultCharacters?: number; maxUpdateCharacters?: number };
  execute(args, context, signal, onUpdate): Promise<AgentToolResult>;
};
```

平台默认 fail-closed：未显式声明 `executionMode` 时按 `sequential` 执行；只有明确安全、相互独立
的只读工具可以显式声明 `parallel`。Registry 不根据 `effects` 自动推断并发，也不在第一阶段提供
优先级、依赖图、资源池或持久化队列。未显式声明的工具不能获得免审批或无限结果能力。`ToolRegistry`
拒绝重名、非法名称、缺少 schema、非法 effect、超出 120 秒/32K 字符硬上限的定义。

## 3.1 Registry 放在哪里

Chalk 采用两层 Registry，而不是把所有实现放进一个全局文件：

1. **通用 Registry 实现**：`packages/agent-runtime/src/tools/tool-registry.ts` 的
   `ToolRegistry`，负责定义校验、策略包装、超时/取消、结果限制、telemetry 和生成 Pi
   `AgentTool[]`。它不导入 `apps/api`，也不拥有 Chalk 业务数据。
2. **应用组合根**：`apps/api/src/agent/builtin-tools.ts` 的
   `createBuiltinToolRegistry()` 创建内置 Tool；`runtime-manager.ts` 再按当前 owner/session
   注入 MCP proxy、Skill Read 和 Subagent，并调用 `registry.createAgentTools()`。

因此“Registry 在哪里”的答案是：规则和执行器在 `packages/agent-runtime`，具体有哪些
业务 Tool 在 `apps/api/src/agent` 组合。设置页的 `listRuntimeTools()` 必须复用同一组合根，
不能另写一套清单。未来可以增加 `apps/api/src/agent/tool-catalog.ts` 作为显式组合模块，
但它仍应调用上述通用 Registry，而不是替换它。

## 4. 注入 Pi Agent 的链路

```text
Tool modules
  -> createBuiltinToolRegistry / McpManager / Subagent factory
  -> ToolRegistry.register()
  -> owner + capability + user settings visibility
  -> ToolRegistry.createAgentTools()
  -> Pi Agent({ initialState: { tools: AgentTool[] } })
```

`packages/agent-runtime` 的统一包装器负责 schema/参数校验、取消、审批、超时、结果截断、
错误码、telemetry 和 Tool 事件。Tool 实现不能直接调用 Pi，也不能直接写任意 Artifact blob；
Chalkboard 继续遵守 `Artifact -> Scene -> Action`。

## 5. 当前实现与增强点

当前已有 `ToolRegistry`、审批 broker、错误码、超时/结果上限、MCP proxy、Read facade、
Render Chalkboard 和 Rename Conversation。下一轮 TDD 重点：

- 将大型 `builtin-tools.ts` 逐步迁移为 feature-folder，保持组合根不变；
- 让 Tool prompt hints 可被 Registry 生成 system prompt/tool summary，而不是散落字符串；
- 统一 `details.resultTruncated`、脱敏审计摘要，并准确记录进程内 `toolCallId` 重入保护的边界；
- 审查 settings `/tools`、Registry 和实际 Pi 注入清单的一致性；
- 增加 capability composition 的纯函数 seam，避免条件注册逻辑散落在 runtime-manager。

### 5.1 与 Claude Code / DeepTutor 的对照审查

基础方向没有明显错误，但还不能称为“完全收口”。已覆盖的共同能力包括：统一 Tool 契约、
schema 校验、显式注册、effects/审批底线、timeout/AbortSignal、结果截断、并发模式、MCP
命名空间和 telemetry。仍有几项值得在 TDD 中补齐：

| 能力 | 参考项目做法 | Chalk 状态 | 优先级 |
|---|---|---|---|
| Tool prompt hints | Claude 的 `prompt.ts`、DeepTutor 的 YAML hints | `prompts.ts` 约定已写，尚未由 Registry 统一渲染 | P0 |
| 语义校验 | Claude `validateInput()`，DeepTutor 参数预检 | 目前只有 schema + 可选 `prepareArguments` | P0 |
| 并发上限/调度 | Claude 默认 10、DeepTutor 每轮 8 并行并去重 | 首期只采用默认 sequential、显式安全只读 parallel；复杂调度延期 | 非目标 |
| output schema | Claude/DeepTutor 可声明输出结构 | 首期使用统一 `AgentToolResult` 信封和有界 `details`，不增加独立 output schema | 非目标 |
| alias/search hint | DeepTutor registry alias，Claude searchHint | 尚未建模；首期可不做，避免多名称权限歧义 | P2 |
| deferred 工具 | DeepTutor `load_tools`，MCP 默认 deferred | MCP 当前以 proxy 暴露，已避免注入远程 schema；首期不做动态加载 | 非目标 |
| 幂等/恢复 | 参考项目记录 tool call/event 并处理重试 | 同一 ToolRegistry 内会合并相同 call id；不跨 Runtime/进程，不承诺 exactly-once 或恢复 | 非目标 |

结论：Tool 的安全底座和显式 Registry 方向可以继续采用，下一轮不需要重写架构。进程内
`toolCallId` 重入保护是防御性能力，不是其他 Tool 扩展的前置门禁；跨进程恢复、复杂调度、
动态加载、output schema 和账户 quota/费用预算均不属于第一阶段 Tool Registry 的职责。

## 5.2 限制策略（不引入独立 quota 系统）

本阶段不实现用户级/Owner 级 token quota、费用 quota、MCP 请求计费额度、单 Run 费用预算
或独立 credit/quota service。模型 token 限制（由 Pi/provider 的输出上限执行）是成本控制的
主要代理；telemetry 记录 usage 用于观测和后续容量规划，但不做额度扣减或因账单而终止。

Tool 仍必须有单次调用的执行保护：

| 限制 | 默认值 | 硬上限/行为 |
|---|---:|---|
| Tool timeout | 30 秒 | 120 秒，超时返回 `timed_out` |
| Tool result | 12,000 字符 | 32,000 字符，截断带 `details.resultTruncated` |
| Tool update | 4,000 字符 | 8,000 字符，增量同样可观测截断 |
| Subagent timeout | 60 秒 | 与 Tool deadline 一致，超时取消 child |
| Subagent concurrency | 父 Runtime 内串行 | 不声称实现跨 conversation 的 owner 全局限制 |
| MCP call timeout | 30 秒 | 遵守 Tool timeout 包装 |

OpenMAIC 的证据也要准确理解：它有很多局部限制（单 Tool timeout、媒体数量/字节、材料
数量与大小、runner 并发、最大尝试次数、child provider transport/output 预算），但
`lib/agent/runtime/quota.ts` 明确标注“v0 stub”，`build-agent.ts` 使用
`Number.MAX_SAFE_INTEGER` 作为 remaining。因此不能把 OpenMAIC 描述成已经有完整账户计费
配额。DeepTutor 则有工具参数上限、并行调用上限和 deferred/结果 guard，但没有 Chalk 需要
的 owner 级账单 quota 作为可直接复用的实现。DeepTutor 的 token/iteration 上限属于单次任务
的保护，不等同于账户计费额度。

因此 UI 和 API 应称为“执行限制/输出上限”，不要声称提供账户额度控制。若未来确实需要
账单或组织配额，应另立 ADR 和持久化服务，不在本规格隐式扩展。

## 6. TDD 顺序

先写失败测试，再实现：

1. `apps/api/tests/unit/tools/<tool-name>.test.ts`：合法最小定义可注册；空名称、重名、缺 schema、非法 effect 被拒绝。
2. `packages/agent-runtime/tests/unit/tools/tool-registry.test.ts`：设置页清单与 `createAgentTools()` 名称集合相等；disabled Tool 不注入。
3. Policy 测试：`write/process/paid` 不能被用户 `approval=never` 降级；缺 approval port fail closed。
4. Execution 测试：schema/语义校验、AbortSignal、超时、结果/增量截断和稳定错误码。
5. 进程内重入测试：同一 ToolRegistry 内相同 `toolCallId` 并发进入时复用原 Promise；同一 id 不同参数 fail closed。该测试不得描述为跨进程 exactly-once 或崩溃恢复。
6. Pi adapter 测试：模型 tool call → ToolRegistry wrapper → tool_result → 下一轮消息完整回流。
7. 每个领域 Tool 的 owner、details 和错误行为测试；只有真实副作用需要时才增加领域级去重测试。

## 7. 验收标准

- 新 Tool 只需增加 feature-folder 和一处 Registry 装配；
- 设置、Prompt、Pi schema 和审计使用同一 manifest；
- 任何副作用 Tool 在无审批 port、错误 owner 或取消状态下都不执行；
- 运行结果和进度都有硬上限，截断事实可观测；token usage 只做 telemetry；
- 单元测试集中在各 package 的 `tests/unit/tools/`，不依赖真实模型，必要时使用 Pi faux provider；
- 真实 Provider/E2E 只验证组合链路，不承担基础契约测试。

## 8. 已确认决策

1. 现有内置 Tool 全部迁移到上述 feature-folder 目录结构。
2. `prompts.ts` 只维护英文运行版；中文审阅说明放在设计/调研文档，不进入运行时 Tool prompt。
3. 第一批纵向切片锁定 `render_chalkboard` 与 `read_resource`。
4. `executionMode` 未声明时默认 `sequential`；安全、独立的只读 Tool 才显式声明 `parallel`。
5. 动态加载、复杂调度、独立 output schema、跨进程 exactly-once 和通用持久化 Job 延后，且不阻塞新增 Tool。
