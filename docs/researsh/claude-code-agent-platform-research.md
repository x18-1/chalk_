# Claude Code Agent 平台调研

> 研究对象：`/home/xcodd/code/chalk_/.reference/claude-code-analysis`（源码及 analysis 文档）
> 重点：Tools、Skills、MCP、Prompt、Subagent/Multi-agent、Session/Resume。

## 结论摘要

Claude Code 把 Agent 实现成一条可恢复的运行时管线，而不是“模型 + 函数”胶水：Tool 有统一协议和保守默认值；调用经过 schema、语义校验、hooks、权限、并发调度后才执行；结果作为 `tool_result` 回流 transcript。Skill 是文件/Markdown + frontmatter 的可发现命令；MCP 工具与内建工具统一进入工具池，但经过命名、描述截断、连接并发和认证/白名单控制。Prompt 由 section 化的静态和动态片段装配，并区分覆盖、追加、上下文和专项任务 prompt。Subagent 复用同一个 `runAgent/query` 内核，team 模式再增加 team file、task list、mailbox 与 leader 权限桥接。Session 以 append-only JSONL 事件流持久化，resume 负责重建和修复消息图。

## 1. Tool 设计与单文件组织

### 1.1 统一 Tool 协议

`src/Tool.ts` 定义 `Tool`/`buildTool()`。除 `call()` 外，协议还要求或支持：

- `name`、`description()`、`prompt()`、`searchHint`；
- `inputSchema`、`outputSchema`、结果映射；
- `validateInput()` 语义校验；
- `isConcurrencySafe()`、`isReadOnly()`、`isDestructive()`；
- `checkPermissions()`、权限 matcher；
- 进度、UI 渲染、中断行为、可观测输入等。

`TOOL_DEFAULTS` 默认并发不安全、非只读、非 destructive 声明、权限交由通用系统处理（`src/Tool.ts:757` 附近）。这是 fail-closed：新工具必须显式声明安全属性才会获得并发/自动分类能力。

### 1.2 调用管线

`src/services/tools/toolOrchestration.ts` 与 `toolExecution.ts` 将一次模型 `tool_use` 拆为：

```text
tool_use -> Zod schema -> validateInput -> backfill/派生依赖
         -> PreToolUse hooks -> permission allow/ask/deny
         -> Tool.call -> progress/result/error -> tool_result 回流 query
```

`partitionToolCalls()` 只把连续的 concurrency-safe 工具并发执行；其它调用逐个串行。并发批次产生的 `contextModifier` 延迟到批次结束后按序应用，避免竞态污染。并发上限默认 10，可由 `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 调整。

### 1.3 一个 Tool 一个目录是否更好？

源码的实际组织支持这一判断：例如 `src/tools/GrepTool/` 包含 `GrepTool.ts`、`prompt.ts`、`UI.tsx`；`WebSearchTool/` 包含实现、prompt、UI。实现文件从 `./prompt.js` 导入 `NAME` 和 `getDescription()`（见 `src/tools/GrepTool/GrepTool.ts`、`src/tools/GrepTool/prompt.ts`）。

这种拆分的优点：

1. Tool 的运行逻辑、模型使用说明、UI 呈现互不挤压，单元测试和 code review 边界清楚。
2. `prompt.ts` 可只读审查工具使用规则，并可在不改执行逻辑时调整描述。
3. 目录成为 Tool 的 ownership 边界，可附加 `constants.ts`、`UI.tsx`、测试和 schema。
4. 仍通过 `buildTool()` 和集中 `getAllBaseTools()/assembleToolPool()` 注册，避免散落自动发现造成不可控注入。

建议 Chalk 采用同样的 feature-folder：`<ToolName>/<ToolName>.ts` + `prompt.ts`（需要时再加 `schema.ts`、`ui.ts`、`index.ts`）。但不要把 prompt 当作安全策略唯一来源：权限、effects、超时、结果预算必须是结构化 manifest/代码契约；prompt 仅负责教模型何时、如何使用。

## 2. Skills

`src/skills/loadSkillsDir.ts` 的 `getSkillDirCommands()` 并行扫描 managed、用户、项目、`--add-dir` 及旧 commands 目录，以 `memoize` 缓存，并用 `realpath` 去重。Skill 由 Markdown `SKILL.md` + YAML frontmatter 解析为统一 `Command`。

常见字段包括 `name`、`description`、`when_to_use`、`allowed_tools`、`model`、`effort`、`user_invocable`、`paths`、`version`、`context`（inline/fork）、`agent`、`shell`。`paths` 使 Skill 成为按文件 glob 触发的条件能力；`disableModelInvocation`/隐藏属性可区分用户命令与模型自主调用。

`createSkillCommand().getPromptForCommand()` 负责参数和 `${CLAUDE_SKILL_DIR}`/`${CLAUDE_SESSION_ID}` 展开，并可执行 Markdown 内嵌 `!\`command\`` Shell。Shell 执行复用 Bash Tool 权限流程；`loadedFrom !== 'mcp'` 才允许执行，防止远程 MCP Skill 注入 RCE。Skill 也可 `context: fork`，在有界 token 的独立 agent 中执行。

适合 Chalk：Markdown + frontmatter 的低门槛领域扩展、trusted source 分层、metadata-only 注入、按需读取、路径条件触发。需要改造：禁止默认执行任意内嵌 Shell；仅对白名单命令/显式 capability 开放，正文和用户 Skill 视为不可信数据并降权；增加版本、签名/来源、大小和 token 预算。

## 3. MCP

核心源码：`src/services/mcp/client.ts`、`auth.ts`、`mcpStringUtils.ts`。

- 工具名称统一为 `mcp__<server>__<tool>`（`buildMcpToolName`）。
- 支持 stdio、SSE、WebSocket、streamable HTTP；连接按 `name + JSON(config)` memoize/lazy cache。
- 非 GET 请求使用显式 `AbortController + setTimeout` 超时，规避 Bun 中 `AbortSignal.timeout()` 的内存问题。
- MCP 描述限制 `MAX_MCP_DESCRIPTION_LENGTH = 2048`，避免 OpenAPI 服务把上下文撑爆。
- 连接启动使用批量并发：本地默认 3，远程默认 20；通过环境变量可调。
- 认证失败写入 15 分钟本地 cache，后续直接返回 needs-auth，避免认证雪崩。
- 检测 HTTP 404 + JSON-RPC `-32001` 作为 session 过期并清缓存重连。
- IDE MCP 工具采用显式白名单（如 `mcp__ide__getDiagnostics`），其余工具过滤。
- MCP 工具与内建工具进入同一 Tool 池；同名时内建优先。

适合 Chalk：命名空间、lazy connect、描述/结果 guard、连接并发、认证状态缓存、session 过期重连、显式 allowlist。需额外强化：stdio command/cwd/env 隔离、OAuth token 管理、输出大小/结构限制、审计和状态事件、按 owner 的 server/tool allowlist；远程 MCP 返回内容必须视为 prompt injection 不可信输入。

## 4. Prompt 管理

`src/constants/prompts.ts:getSystemPrompt()` 返回 string 数组而非单字符串；静态主干和动态 section 之间插入 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`，以支持缓存和逐段 token 统计。`src/utils/systemPrompt.ts:buildEffectiveSystemPrompt()` 定义覆盖优先级：

```text
override > coordinator > agent > custom > default；append 始终追加到末尾
```

`src/context.ts` 单独注入 `userContext`（CLAUDE.md、日期）和 `systemContext`（git 状态等），不把所有动态数据硬编码进主模板。compact、session-memory、memory-extraction 各自有专项 prompt，明确工具白名单、输出格式和轮次，不能复用主会话自由度。

Prompt 可观测：`dump-prompts` 将实际请求写入 JSONL；`/context` 按 section 统计 token。Fork child 直接复用父会话已渲染的 system prompt 字节，保证行为一致并提高 prompt cache 命中。

适合 Chalk：section 化 prompt builder、静态/动态缓存边界、override/append 明确语义、专项任务 prompt、实际 prompt dump 和 token 诊断。不要复制复杂覆盖矩阵；建议 Chalk 限定少量优先级并为每个 section 标注 trust、cacheability、token budget。

## 5. Subagent / Multi-agent

`AgentTool`（`src/tools/AgentTool/AgentTool.tsx`）统一入口，输入含 `description`、`prompt`、`subagent_type`、`model`、`run_in_background`，多 agent 模式另有 `name`、`team_name`、`mode`。普通调用走 `runAgent()`，最终复用 `query()`；子 agent 有独立 ToolUseContext、MCP、hooks、sidechain transcript、metadata、超时/取消和有界结果。

Claude Code 分三层：

1. 普通 subagent：主会话侧链，可同步/后台/fork；fork 继承完整上下文和父 prompt 字节。
2. coordinator mode：主线程身份改为调度器，worker 结果以 task-notification 回流。
3. swarm teammate：显式 team file、roster、task list、mailbox；支持 in-process（AsyncLocalStorage 隔离）或 tmux/iTerm2 后端。

拓扑有硬约束：teammate 不能再 spawn teammate；in-process teammate 不能启动 background agent。Mailbox 位于 `.claude/teams/{team}/inboxes/{agent}.json`，写入使用锁；leader permission bridge 负责代 teammate 走统一确认 UI，失败时通过 mailbox 同步权限结果。

适合 Chalk：先实现普通、独立、可取消、可审计的 subagent contract，复用主 query runtime；限制深度/并发/预算；结果采用结构化 artifact 引用。Team/swarm、跨进程 pane、复杂 mailbox 可后置，避免一次引入多套状态平面。

## 6. Session / Resume

`src/utils/sessionStorage.ts` 将每个 session 写为 append-only JSONL（目录 `0700`、文件 `0600`），主 transcript 与 `subagents/agent-<id>.jsonl` sidechain 分离。`progress` 等 UI 高频事件不属于 transcript；summary、title、tag、mode、worktree 等 metadata 也作为事件写入并可在尾部重挂。写入先入队批量 flush，主链按 UUID 去重，sidechain 允许继承消息重复。

远端 ingress 以 append 链同步且按 session 串行化；大文件支持 lite reader。`loadTranscriptFile()`/`conversationRecovery.ts` 不只 parse 数组，还要修复 progress parent、snip 删除后的 parentUuid、并行 tool_result 孤儿、compact/context collapse、中断 turn 和 invoked skill 状态，随后恢复 sessionId、agent、cost、worktree、metadata 并重新接管 REPL。

适合 Chalk：事件追加、主/子 agent transcript 分离、tool call/approval/subagent/MCP 统一事件、幂等 UUID、可恢复 run 状态。初期可用 Postgres 事件表而非本地 JSONL，但必须保留 append-only 语义、版本化事件和 resume 一致性检查。

## 7. 对 Chalk 的设计建议

### 推荐目录

```text
packages/agent-runtime/src/
  tools/<ToolName>/<ToolName>.ts
  tools/<ToolName>/prompt.ts
  tools/<ToolName>/schema.ts       # 可选
  skills/<skill-id>/SKILL.md       # 文件扩展
  prompts/sections/*.ts             # section builder
  subagent/                         # 通用 parent/child contract
  events/                            # append-only run/tool/mcp/subagent events
```

### 最小契约

每个 Tool manifest 至少声明：`name/version/source`、input/output schema、`effects`、`concurrency`、`timeoutMs`、`maxResultChars`、`requiresApproval`、owner scope。执行器统一做 schema/semantic validation、hooks、权限、AbortSignal、结果截断、telemetry 和 transcript 事件。

Skill 仅注入 metadata，正文按需读取；MCP/用户内容标记不可信；Subagent 限制 parent、depth、concurrency、budget 并记录 child run；Prompt section 明确 `cacheable` 与 token budget；所有运行事件含 `runId/conversationId/ownerId/toolCallId`，支持幂等和恢复。

### 采用顺序

1. Tool feature-folder + manifest/registry 一致性；
2. Prompt section builder 与 dump/token 诊断；
3. Skill 生命周期和安全边界；
4. 普通 Subagent contract；
5. MCP auth/output/status hardening；
6. 最后再考虑 coordinator/swarm。

## 源码证据索引

- Tool 协议/默认值：`src/Tool.ts`（约 362、757 行）
- Tool 装配：`src/tools.ts`（`getAllBaseTools`、`assembleToolPool`）
- 调度/执行：`src/services/tools/toolOrchestration.ts`、`toolExecution.ts`、`toolHooks.ts`
- 示例单目录 Tool：`src/tools/GrepTool/`、`WebSearchTool/`、`SkillTool/`
- Skill：`src/skills/loadSkillsDir.ts`、`src/utils/promptShellExecution.ts`
- MCP：`src/services/mcp/client.ts`、`auth.ts`、`mcpStringUtils.ts`
- Prompt：`src/constants/prompts.ts`、`src/utils/systemPrompt.ts`、`src/context.ts`
- Multi-agent：`src/tools/AgentTool/`、`src/tools/shared/spawnMultiAgent.ts`、`src/utils/swarm/`、`src/utils/teammateMailbox.ts`
- Session：`src/utils/sessionStorage.ts`、`src/utils/conversationRecovery.ts`、`src/screens/ResumeConversation.tsx`
