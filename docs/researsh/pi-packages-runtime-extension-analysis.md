# Pi 包生态与运行时扩展分析

> 调研日期：2026-08-11
> 目标：为 Chalk 的 `agent-runtime`、Tools、MCP、Subagent、Skills、会话和观测设计提供一手资料。
> 资料优先级：锁定依赖的源码/类型 > 官方仓库文档 > 包作者自己的 npm 源码与 README > `pi.dev/packages` 目录元数据。

## 先给结论

1. `pi.dev/packages` 是 **Pi coding-agent 的第三方扩展目录**，不是 `pi-agent-core` 的通用插件注册表。目录中多数扩展依赖 `@earendil-works/pi-coding-agent` 的 `ExtensionAPI`，不能直接装进 Chalk 的 Web 服务或裸 `pi-agent-core`。
2. Chalk 应继续把 Pi 依赖收口在 `packages/agent-runtime`：对外提供自己的运行时接口，把 Pi 的 Agent、TypeBox Tool、pi-ai Models、JSONL Session 和 telemetry 适配成稳定边界。
3. 最值得迁移的是模式而不是整包：MCP 的惰性连接/单代理工具/HIL，Subagent 的子会话/预算/取消/恢复，Skills 的渐进披露，Telemetry 的显式父子 Span。
4. `pi-ai` 的模型目录确实已经超过 30 个供应商。当前锁定的 `0.84.1` 本地构建可见 40 个 Provider（其中 `radius` 是动态 Provider）和约 1,220 个模型；不需要手写供应商列表。
5. 用户凭据、Provider 配置、MCP 配置、Skill 注册、Tool 权限和学习业务数据都不应写入 JSONL。JSONL 只作为一个会话的追加日志；Postgres 保存索引、owner、配置和业务状态。
6. `0.84.1` 中稳定可用的是 `Agent`、Tool loop、pi-ai 和低层 Session repo/storage；高层 `AgentHarness` 仍是未完成骨架，`prompt/resume/watch/lane` 等大量方法会抛 `HarnessNotImplemented`。Chalk 不能把 harness 的类型声明误当成已实现能力。

本次没有读取、写入或记录任何 API key，也没有用真实凭据调用模型。

## 1. 版本与包边界

### Chalk 当前锁定依赖

仓库 `pnpm-lock.yaml` 和 `packages/agent-runtime/package.json` 锁定：

| 包 | 版本 | 许可证 | 当前角色 |
|---|---:|---|---|
| `@earendil-works/pi-agent-core` | `0.84.1` | MIT | Agent loop、工具执行、事件流、Session harness |
| `@earendil-works/pi-ai` | `0.84.1` | MIT | Provider、模型目录、认证解析、LLM stream |
| `@earendil-works/pi-telemetry` | `0.84.1`（传递依赖） | MIT | 厂商无关的 Span/Telemetry contract |

三个包要求 Node `>=22.19.0`。`pi-agent-core` 的 `package.json` 依赖 `typebox@1.3.7`；它的 Tool 边界不是 Zod。

一手资料：

- [pi-agent-core `0.84.1` package.json](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/agent/package.json)
- [pi-ai `0.84.1` package.json](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/ai/package.json)
- [pi-telemetry `0.84.1` package.json](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/telemetry/package.json)
- 本地类型：`node_modules/.pnpm/@earendil-works+pi-agent-core@0.84.1_*/node_modules/@earendil-works/pi-agent-core/dist/`、`.../pi-ai/dist/`。

### `pi-coding-agent` 的位置

`@earendil-works/pi-coding-agent@0.84.1` 是一个 MIT 的 CLI/Extension host，提供 `ExtensionAPI`、TUI/RPC UI、命令、事件和资源自动发现。它依赖 `pi-agent-core`、`pi-ai`、`pi-client`、`pi-protocol` 和 `pi-tui`，但 Chalk 当前没有安装它。

这解释了一个容易误判的点：`pi.dev/packages` 上的扩展通常写成：

```json
{
  "pi": {
    "extensions": ["./index.ts"],
    "skills": ["./skills"],
    "prompts": ["./prompts"]
  }
}
```

这套 manifest 是 coding-agent 的资源发现约定，不是 `Agent` 构造函数的插件 API。Chalk 应实现自己的 `ToolRegistry`、`SkillRegistry` 和 `McpRegistry`，必要时才复用底层 Pi 类型。

一手资料：[coding-agent package.json（v0.84.1）](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/coding-agent/package.json)、[Pi Packages 文档](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/coding-agent/docs/packages.md)。

## 2. Pi 核心运行时可直接复用的能力

### 2.1 Agent loop 与工具生命周期

`pi-agent-core@0.84.1` 的 `AgentTool` 使用 TypeBox `TSchema`，执行签名包含 `AbortSignal` 和增量更新回调：

```ts
execute(
  toolCallId: string,
  params: Static<TParameters>,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback<TDetails>,
): Promise<AgentToolResult<TDetails>>
```

运行时默认并行执行一个 assistant message 中的工具调用；工具可以设置 `executionMode: "sequential"` 强制串行。两个关键钩子是：

- `beforeToolCall`：参数已通过 TypeBox 校验后执行，可返回 `{ block, reason, terminate }`。
- `afterToolCall`：工具完成后、结果写入上下文前执行，可覆盖 `content`、`details`、`isError`、`usage` 和 `terminate`。

阻塞、工具异常和终止提示都会变成标准的 tool result；工具失败应抛异常，由 Agent 统一转成 `isError: true`，不要把错误伪装成成功文本。

`Agent.subscribe()` 的异步 listener 会参与 Agent settlement；底层 `agentLoop()` 的观测流不会等待 listener，因此需要把持久化/审计屏障放在 `Agent` 类或 Chalk 自己的 event sink 上。

### 2.1.1 `AgentHarness` 的版本 caveat

虽然 `0.84.1` 导出了 `AgentHarness`、lane、resume、watch 和 durable operation 等完整类型，但已发布的 `dist/harness/agent-harness.js` 中 `prompt()`、`skill()`、`compact()`、`resume()`、`abort()`、`watch()`、`createLane()`、`lanes()` 等仍统一走 `unavailable()` 并拒绝为 `HarnessNotImplemented`；`create.restore` 也未实现。

因此当前实现应使用已工作的 `Agent` 作为执行核心，并由 Chalk 显式组合 session storage、事件持久化、恢复策略和资源注册。将来升级 Pi 时，再用行为测试判断能否迁移到完成版 harness，不能只看类型是否存在。

一手资料：[agent README](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/agent/README.md)、[agent types](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/agent/src/types.ts)。

### 2.2 Skills：渐进披露而非把全文塞进上下文

Pi 的 Skill 结构包含 `name`、`description`、`content`、`filePath` 和可选的 `disableModelInvocation`。`loadSkills()`：

- 递归寻找 `SKILL.md`，也读取根目录的 `.md`；
- 尊重 `.gitignore`、`.ignore` 和 `.fdignore`；
- 对无效 frontmatter/路径生成 warning diagnostics，而不是让所有 Skill 加载失败；
- 在 system prompt 中只列出 name、description、location；匹配后通过 `formatSkillInvocation()` 注入全文；
- Skill 名称必须是小写字母、数字和连字符，且不超过 64 字符；description 必须存在且不超过 1,024 字符。

对 Chalk 的建议：

- Postgres 保存 Skill 的来源、版本、启用状态、校验诊断和 owner；文件内容由受信目录/包提供。
- system prompt 只放元数据，具体 Skill 由显式的 `read_skill` 或 runtime invocation 加载。
- 项目目录的 Skill 必须经过 owner/项目信任策略；不能因为一个目录存在 `SKILL.md` 就自动执行其中指令。
- API contract/领域 DSL 继续用 Zod；送进 Pi Tool 的边界转换为 TypeBox，保持单一领域 schema 来源。

一手资料：[skills loader 源码](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/agent/src/harness/skills.ts)、[skills types](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/agent/src/harness/types.ts)、[coding-agent skills 文档](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/coding-agent/docs/skills.md)。

### 2.3 会话：JSONL 是日志，不是整个业务数据库

本地 `pi-agent-core@0.84.1` 暴露 `JsonlSessionRepo` 与 `InMemorySessionRepo`。JSONL v4 的 header 包含 session id、cwd、创建时间、父 session id 和可选的应用 metadata；entry 形成树，另有 lane 和 append-only record。

JSONL 中可以有：

- 用户/assistant/toolResult 消息和自定义 entry；
- model/thinking-level 变更、active tools、compaction、branch summary；
- operation started/finished、abort、tool started、queue、usage 等恢复记录；
- session name/label 等会话展示信息。

因此“JSONL 只存 session”应准确理解为：**只存一个 session 的事件日志和恢复所需的上下文，不存应用全局配置和业务事实**。建议 Chalk 的划分如下：

| 数据 | JSONL | Postgres |
|---|---:|---:|
| 对话消息、工具结果、compaction、分支 | 是 | 可选索引/摘要 |
| session id、owner、标题、最近活动时间 | header/日志 | 是，作为查询真相 |
| Provider、模型选择、API 凭据 | 否 | 是（凭据加密，返回永不含 secret） |
| Skills/MCP/Tools 注册与权限 | 否 | 是 |
| 学习目标、作答、掌握度、证据 | 否 | 是 |
| telemetry exporter 状态和业务审计 | 否 | 由观测/审计存储决定 |

`JsonlSessionRepo` 的 repo 接口包含 `create/open/list/delete/fork`。需要注意：通用 `SessionRepo.open()` 注释写有 writer claim，但 `0.84.1` 的具体 JSONL 实现没有跨进程文件锁，只用实例内 Promise tail 串行追加。它只在当前“单实例、本地磁盘、不考虑 NFS”的约束下成立；即使同一台机器，也不能让两个进程同时写一个 JSONL。不要把 `JsonValue` metadata 当作业务数据库；最多放不可变、非敏感的 session provenance。

一手资料：[JSONL repo types](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/agent/src/harness/session/jsonl/types.ts)、[session types](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/agent/src/harness/session/types.ts)、[JSONL storage](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/agent/src/harness/session/jsonl/storage.ts)。

### 2.4 pi-ai：Provider/Model/credential 的正确边界

`pi-ai` 把 Provider 作为运行时单元：Provider 自己拥有 id、model catalog、auth 和 stream 实现；`Models` 集合负责注册、查询、刷新、认证解析和请求路由。

`0.84.1` 的公开 API 要点：


- `builtinModels()`：注册所有内置 Provider；按需也可以从 `providers/<name>` 只注册单个 Provider。
- `getAvailable()`：只返回认证完整的模型。
- `refresh()`：动态 Provider 显式刷新，返回 best-effort 的错误集合，不把一个 Provider 的失败变成全局崩溃。
- `createProvider()`：可为 Chalk 的自定义 OpenAI-compatible endpoint 建 Provider，但必须提供自己的 auth、model list 和 API stream。
- `CredentialStore`：`read/list/modify/delete`，其中 `modify` 是唯一写路径并按 Provider 串行化；OAuth refresh 在锁内执行。
- 已存 credential “拥有” Provider：凭据存在时，失败不能静默回退到环境变量。这个 fail-closed 语义应直接保留。

对 Chalk 的建议是实现 Postgres-backed `CredentialStore` 与 `ModelsStore`，把 `builtinModels({ credentials, modelsStore, authContext })` 放在服务端 singleton 中；前端只读 provider/model 非敏感状态。API key 只能写入、掩码展示和删除，不能通过 GET 原样回显。

本地 `0.84.1` 实际枚举结果：`getBuiltinProviders()` 39 个静态 provider；`builtinModels()` 40 个 provider（含无静态目录的 `radius`）和约 1,220 个模型。模型数是构建时 catalog 的快照，动态 Provider 仍要调用 `refresh()`。

一手资料：[pi-ai README](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/ai/README.md)、[Models API](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/ai/src/models.ts)、[credential types](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/ai/src/auth/types.ts)、[provider catalog](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/ai/src/providers/all.ts)。

### 2.5 Telemetry：显式 context，Pi 不替你选 exporter

`pi-telemetry` 只有 vendor-neutral contract：`TelemetryContext.startSpan()`、`TelemetrySpan.addEvent/setAttributes/setStatus()`、`NOOP_TELEMETRY_CONTEXT`、`InMemoryTelemetryContext` 和 typed schema helper。它没有全局 current span、exporter 或后端依赖。

Pi AI 已定义 `pi.ai.request` schema，包含 provider/model/api、终止原因、HTTP 状态、token/cost、首个 stream chunk 等低到中敏感度字段；Agent harness 还定义 run/turn/tool/compaction 等 Span。Chalk 可以把自己的 `chalk.session`、`chalk.tool`、`chalk.lesson` 作为独立 schema，并将 Pi Span 作为 child。

落地规则：

- 默认使用 `NOOP` 或本地 adapter；生产通过 OpenTelemetry/Sentry 等 adapter 导出。
- 不把 prompt、完整 tool args/results、API key、OAuth token、学生答案原文直接放进 attributes。
- 记录 `owner/session/tool/model` 的稳定 ID、耗时、状态、token/cost 和错误类别；高基数字段按数据策略采样或 hash。
- 用官方 testing conformance suite 验证 adapter 的父子关系、错误、settlement 和 non-throwing recording。

一手资料：[pi-telemetry README](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/telemetry/README.md)、[Agent telemetry schema](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/agent/src/harness/telemetry.ts)、[pi-ai request options](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/ai/src/types.ts)。

## 3. `pi.dev/packages` 中可迁移的扩展模式

下表是包作者自己发布的实现，不等于 Chalk 的依赖建议。

| 包（版本） | 许可证/宿主 | 观察到的模式 | Chalk 应取什么 |
|---|---|---|---|
| [`pi-mcp-adapter` 2.22.0](https://pi.dev/packages/pi-mcp-adapter) | MIT；Node `>=20`；peer `pi-ai ^0.84.1`、TypeBox、Zod | MCP stdio/HTTP/socket 惰性连接；一个约 200-token 的 `mcp` proxy，再按 `directTools` 选择性暴露；metadata cache；连接超时、idle disconnect、reconnect；OAuth secure store + URL binding；tool consent `never/once-per-server/always`，headless 无法审批时拒绝 | 采用 lazy lifecycle、proxy/direct 分层、server status snapshot、审批 broker、URL-bound OAuth。不要把它的 `.ts` coding-agent extension 直接嵌入 Chalk；先定义 Chalk `McpServerAdapter` 和前端状态 DTO |
| [`pi-subagents` 0.46.0](https://pi.dev/packages/pi-subagents) | MIT；peer `pi-agent-core *`、`pi-ai >=0.80`、coding-agent | Parent Pi 启动 focused child session；前台/后台、并发、保存 workflow、模型路由、skills 链、tool permissions、timeout/budget、abort/steer、JSONL child session、status/artifacts、resume | 采用“每个 child 都有自己的 session、预算、取消和结果摘要”；先做单 child foreground executor，再做后台/并发；把 child owner、parent session、tool scope 和 budget 写入 Postgres/审计，而不是混入主对话 |
| [`@tintinweb/pi-subagents` 0.15.0](https://pi.dev/packages/@tintinweb/pi-subagents) | MIT；另一套 autonomous subagent 实现 | 与 `pi-subagents` 不是同一个 API 或实现，peer floor 同为约 `0.80` | 仅作对比资料，不能混装或假设两套 frontmatter/状态兼容 |
| [`@juicesharp/rpiv-ask-user-question` 2.4.0](https://pi.dev/packages/@juicesharp/rpiv-ask-user-question) | MIT；coding-agent/TUI extension | 把结构化选择题做成一个 `ask_user_question` Tool；没有 UI 时从 model tool list 移除，而不是不断失败 | Chalk HIL 统一成 `ApprovalPort`/`QuestionPort`；Web 有 UI 才暴露需要交互的 Tool，无 UI 时 fail closed |
| [`@gotgenes/pi-permission-system` 25.0.0](https://pi.dev/packages/@gotgenes/pi-permission-system) | MIT；coding-agent/TUI extension | extension 级 tool permission policy，Zod + parser，显式 allow/ask/deny | 权限应是运行时 capability policy 的一部分，且在 owner/session/tool scope 下评估；不要把一次 UI 同意误当成永久授权 |
| [`@braintrust/pi-extension` 0.10.0](https://pi.dev/packages/@braintrust/pi-extension) | MIT；vendor exporter，coding-agent peer | session/turn/model/tool/compaction 分 Span；默认关闭；allowlist metadata；不记录完整 provider payload 或 thinking signature；不可用时继续运行 | 参考 span 分层和隐私 allowlist，但保持 Pi telemetry vendor-neutral；exporter 作为可插拔 adapter，不放进 agent loop 核心 |
| [`@raindrop-ai/pi-agent` 0.1.3](https://www.npmjs.com/package/@raindrop-ai/pi-agent) | MIT；programmatic subscriber 或 coding-agent extension | 对裸 `pi-agent-core` 提供 subscriber 入口，同时支持 coding-agent extension | 证明“runtime subscriber”比绑定 TUI 更适合 Chalk；对外只暴露 Chalk 的 event stream 和 telemetry adapter |

### MCP 的特别注意事项

`pi-mcp-adapter` 的 README 明确指出：MCP server 自己负责参数校验；adapter 负责连接、发现、授权、结果 schema 和生命周期。它默认使用 proxy tool 来避免把几十个 MCP schema 一次塞进上下文，75+ 工具时建议不要全部 direct register。这个取舍很适合 Chalk，但我们的几何/数学工具仍应优先做成可审计的本地 Tool，而不是为了“插件化”全部变成 MCP。

包版本也不能忽略：`pi-mcp-adapter@2.22.0` 的 npm peer 允许 `pi-ai ^0.84.1`，但其扩展入口依赖 coding-agent host；它的 package `engines` 写 `Node >=20`，而 Chalk 锁定 Pi core 要求 Node `>=22.19.0`，实际运行仍按 Chalk 的 Node 版本执行。

一手资料：[pi-mcp-adapter npm metadata](https://registry.npmjs.org/pi-mcp-adapter/2.22.0)、[README](https://raw.githubusercontent.com/nicobailon/pi-mcp-adapter/v2.22.0/README.md)、[source tarball](https://registry.npmjs.org/pi-mcp-adapter/-/pi-mcp-adapter-2.22.0.tgz)。

### Subagent 的特别注意事项

`pi-subagents` 的子 Agent 不是简单的“再调用一次模型”：它需要 child session、模型解析、工具/Skill scope、超时、AbortSignal、结果 intercom、持久化状态和恢复路径。其 package peer 允许 `pi-agent-core`，但大部分 orchestration 面向 coding-agent 的 process/session/UI 能力。

Chalk 的第一版应只实现：

```text
parent run
  -> admission (owner + model + tool scope + budget)
  -> child Agent / child session
  -> streamed child events
  -> bounded result summary
  -> parent toolResult + Postgres audit
```

后台并行、worktree、定时任务、跨进程 steer 等功能应在首个数学闭环稳定后再增加。

一手资料：[pi-subagents npm metadata](https://registry.npmjs.org/pi-subagents/0.46.0)、[README](https://raw.githubusercontent.com/nicobailon/pi-subagents/v0.46.0/README.md)、[source tarball](https://registry.npmjs.org/pi-subagents/-/pi-subagents-0.46.0.tgz)。

## 4. 对 Chalk 的推荐落地结构

保持当前“两 package”决策：`packages/agent-runtime` 与 `packages/chalkboard`。MCP、Skills、Subagent、Telemetry 不是新的顶层 package，先作为 `agent-runtime` 内的模块；Postgres DAL/API 位于独立的 `apps/api`，不得让 package 直接依赖任何 app 路径。

建议的 runtime 内部边界：

```text
agent-runtime
├── model-gateway        pi-ai Models + Postgres CredentialStore/ModelsStore
├── session-gateway      JsonlSessionRepo + session metadata callbacks
├── tool-registry        TypeBox AgentTool + Zod contract adapter
├── approval             HIL / owner / capability policy
├── skills               loadSourcedSkills + trusted source registry
├── mcp                   Chalk McpServerAdapter (lazy/proxy/direct)
├── subagent             child Agent/session executor (foreground first)
├── events               stable Chalk event envelope for SSE/Web UI
└── telemetry            explicit TelemetryContext + redacting adapter
```

实现顺序：

1. **合同和安全**：事件 envelope、错误码、owner 校验、Abort/timeout、Tool capability policy。
2. **Model gateway**：Postgres `CredentialStore`、`ModelsStore`、Provider 状态 API，先接一个真实凭据写入/掩码读取流程。
3. **Session gateway**：单实例本地 JSONL，Postgres session index；完成断线恢复和删除语义。
4. **Tool registry + HIL**：TypeBox 参数验证、Zod 业务转换、before/after hook、Web approval。
5. **Skills**：来源/版本/启用状态/diagnostics，system prompt 渐进披露。
6. **MCP**：先做 lazy stdio/HTTP、proxy search/describe/call、状态快照和 fail-closed approval；direct tools 只允许显式 allowlist。
7. **Subagent**：先 foreground 单 child，拥有独立 session、scope、budget、AbortSignal；再考虑后台和并发。
8. **Telemetry 与前端配置页**：将真实 Provider/Skill/MCP/Tool 状态逐项接入设置界面。

这样能继续保持：`agent-runtime` 不依赖 `chalkboard`，`chalkboard` 不依赖 Web `lib`，而首个数学闭环可以在 Tools 基础稳定后接入。

## 5. 许可证与供应链提醒

- Pi 主仓库和上述核心包均为 MIT；社区扩展的当前发布元数据也均声明 MIT，但每次引入仍应锁定版本并检查 tarball 中的 `LICENSE`。
- Pi Packages 文档明确警告：扩展拥有完整系统权限，Skill 可以指示模型执行任意操作。Chalk 不应允许学生可控输入直接安装/启用 npm/git 扩展。
- 生产环境把第三方 MCP server、Skill 和 Subagent 当作不受信代码：来源 allowlist、版本锁、安装审核、运行 capability 限制、超时和资源上限必须在服务端执行。
- `pi.dev/packages` 目录是动态目录，版本和下载量会变化；本文记录的版本是调研当天的可复核基线，不是“永远最新”声明。

一手资料：[Pi Packages 安全说明](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/coding-agent/docs/packages.md)、[pi.dev package catalog](https://pi.dev/packages)、各包在上表中的 npm/repository 链接。
