# Agent Harness Handoff

用中文。Default mode。不要把本文件加进 git。

## Workspace

- Branch: `feat/agent-harness-hardening`
- Worktree: `/home/xcodd/code/chalk_/.worktree/agent-harness-hardening`
- HEAD: `c1db9ca` `feat(auth): add admin and user roles`
- 远程: `origin` = `https://github.com/x18-1/chalk_.git`
- Upstream: 已设置。提交或推送前先检查本地分支与 upstream 的实际差异。
- 当前工作区有认证、Agent Runtime 和可观测性相关的未提交改动。不要覆盖、回退或混入其他文件；后续按认证和可观测性拆成可审查的提交。
- `.env` 有真实 `DEEPSEEK_API_KEY`。额度有限、不用轮换。不要写入代码/文档/提交/handoff，不要说教。

本地服务：

- API: `127.0.0.1:3001`
- Web: `*:3002`
- **不要动 3000**。Baize / 其他 worktree 可能在用。

## 当前状态

第一里程碑（可靠 harness）已收口；恢复验收清单和真实 API 重启恢复测试已完成。当前优先进入 Tool / MCP / Skill 的真实运行路径验证；Langfuse 深度接入和 Chat 分支编辑暂缓。

关键提交（推送状态以本地分支与 upstream 实际差异为准）：

| Commit | 内容 |
|---|---|
| `3d42a59` | runtime owner scope + MCP/tool 契约硬化 |
| `9e358b5` | 审批持久化，重启后 fail closed |
| `ce82b96` | 工具历史恢复 + 可恢复失败态 |
| `911c242` | stdio MCP 经 chat 组合，测试 fail closed |
| `127637f` | 浏览器工具审批/拒绝 E2E |
| `2a11516` | 浏览器 abort E2E |
| `9582eba` | 浏览器 steer E2E |
| `e5a2c46` | 浏览器 skill/tool enablement E2E |
| `f2083ab` | 浏览器模型切换 E2E |
| `43daae6` | compaction 保留原始 transcript |
| `25c494b` | 浏览器 compaction E2E |
| `33ed816` | thinking / tool result 写入 transcript 的契约测试 |
| `73fe661` | 刷新后恢复 thinking 和 tool 历史；真实 reload E2E |
| `073cbb3` | 真实 API 进程重启后的历史恢复 E2E |
| `0780f21` | 更新 Chat 恢复验收清单 |
| `96edd7a` | 硬化重启测试 fixture 的进程处理 |
| `c1db9ca` | 增加 admin / user 角色认证 |

已完成能力：

- 审批恢复：进程重启 / runtime 重建后，过期 `pending` 自动 reject，不静默通过
- stdio MCP：发现、调用、失败/超时/abort/凭据 URL 拒绝、清理
- abort / steer / approve-reject / skill enablement / tool enablement / model switching / compaction 都有浏览器 E2E
- Thinking / tool 历史：runtime 契约测试 + 真实 reload E2E + UI 打磨
- UI 展示完整原始历史；compaction 只压缩给模型的上下文，summary 不进气泡
- Chat 恢复清单已更新：进程重启后的历史、上下文和 pending 审批 fail closed 均已有覆盖
- 初始角色仅为 `admin` 与 `user`；creator 角色尚未定义，不要提前实现
- 已有管理员后台外壳，`Agent Trace` 是其中的可观测性模块，不属于学生端 UI

## 已确认的下一阶段

### 可观测性（暂缓扩展）

可观测性仍是管理员后台的一级模块，而不是独立学生页面。现有实现已经提供会话标题索引和持久化的根 Agent Run 摘要；这部分暂时保持，不开展 Langfuse 接入或深度观测扩展。

后续恢复时，再参考 Langfuse 的 Trace / Session / Generation 信息架构，但不要照搬其产品形态。原始输入输出、工具参数和工具结果仍不得默认持久化或展示。

- 必须按用户筛选。筛选、聚合和数据访问均通过 admin-only DAL/API；学生端永远不可见其他用户的任何观测信息。
- 必须支持跨多个会话的聚合：调用次数、输入/输出 token、成本、耗时、失败率及时间范围。用户筛选和时间筛选应作用于同一聚合范围。
- 单条持久化记录的粒度是一次根 `AgentRuntime.run()`，通常对应一个用户回合；其下可有零到多次模型调用、工具调用、审批、steer、abort、compaction 与子 Agent 工作。
- 运行详情应按层级展开：会话 / 根运行 / 子 span / 单次模型或工具调用。先展示结构化元数据、状态、时序、token、成本和错误；待隐私策略确认后才考虑原始 payload。
- 不另起 logger，扩展 `packages/agent-runtime` 中现有 pi telemetry。持久化 trace/span 与 OpenTelemetry exporter 要作为 adapter 边界，不得耦合进 Agent loop。
- 默认不持久化或展示 prompt、completion、tool 参数、tool 结果、凭证、cookie、上传内容或学生标识。若未来要查看原文，必须先确定：加密存储、仅管理员 RBAC、每次查看的审计日志、保留期限和删除策略。

### 用户管理

用户管理也是管理员后台的模块。当前只实现 `admin`、`user` 两个角色。

- 先做安全、可审计的用户列表与筛选，再做必要的管理动作；所有用户数据读写经 admin-only DAL。
- 管理动作的范围需在实现前明确：创建账号、修改角色、启用/停用、重置凭据、删除账号分别是否开放。不得返回、记录或展示密码、session 或其他凭证。
- 角色变更和高风险账号操作需要审计记录；不能让最后一个管理员失去管理员权限或被删除。
- creator 角色和其权限模型仍是待定项，现阶段不要添加占位权限逻辑。

### 通用 Agent 验证

除已有 E2E 外，继续用简单、可控、可直接触发的 fixture 覆盖 Tool、MCP、Skill、Subagent，目标是验证通用 Agent 运行路径可靠，而不是只验证 UI 按钮存在。

- Tool：确定性输入、成功、业务失败、timeout、abort、审批和 owner scope。
- MCP：本地 stdio fixture 的发现、调用、异常、连接清理和 fail closed；不依赖外部服务。
- Skill：启用 / 禁用、可被 Agent 消费、作用范围和失败恢复。
- Subagent：先确认产品层是否已有真实委派能力；没有就先定义运行时契约，不能伪造测试。实现后覆盖创建、完成、失败、取消、父子 trace 关联和 owner scope。
- 测试分层：单元/集成测试优先使用确定性 fixture；如保留真实模型 smoke test，必须显式 opt-in、设 token/成本上限，并清理测试数据。

不要回退这些架构：

- `GET /messages` → `session.getTranscript()`（原始历史）
- Runtime → `getMessages()`（compaction 后的 LLM 上下文）
- 创建 `Agent` 必须传 pi 的 `convertToLlm`；默认会滤掉 `compactionSummary`
- Thinking: `{ type: "thinking", thinking: string }`
- Tool call: `{ type: "toolCall", id, name, ... }`
- Tool result: `{ role: "toolResult", toolCallId, toolName, content, isError }`
- UI：`ThinkingDisclosure` / `ToolActivity` 在 `apps/web/src/app/chat/page.tsx`
- **不要拆 `page.tsx`**，不要做成第二套卡片

## 下一步优先级

1. 用确定性 fixture 和真实本地运行路径重新验证 Tool、MCP、Skill；每个资源都覆盖成功、失败、超时/取消（适用时）和权限边界。
2. 增加一个只读、有界的 Chalk 学习资源搜索 Tool，以及一个明确需要审批并执行单一用户-owned 变更的 Tool。
3. 添加 Context7 远程 MCP 配置（`https://mcp.context7.com/mcp`），验证发现、搜索、描述、调用和连接失败的行为；配置保存在用户自己的 `mcp_servers` 记录中。
4. 安装并审查 `education-learning`、`find-skills`、`firecrawl` 三个 Skill，确认 `SKILLS_DIRS` 加载、用户启用/停用和 system prompt 注入路径。
5. 用户管理一期：管理员用户列表、筛选与经确认的最小安全管理动作。
6. 补全通用 Agent 的确定性 fixture 测试矩阵，尤其是 Subagent 真正实现后的失败、取消、父子 trace 关联和 owner scope。

以下事项明确暂缓：Langfuse 接入、可观测性深度扩展，以及 Chat 的 `Branch：编辑重新生成`。

**不要做第二里程碑工具或教学 eval，除非用户明确说做。**

## plan 恢复清单对照

来源：`docs/plan-chat-v1.md`

| 项 | 实际状态 |
|---|---|
| 进程重启后打开历史，消息完整 | 已实现，已更新清单；真实 API 重启 E2E 已覆盖 |
| 进程重启后继续聊，agent 有上下文 | 已实现，已更新清单；真实 API 重启 E2E 已覆盖 |
| Branch：编辑重新生成 | 暂缓，不纳入当前工作流；UI/API/runtime 都没有 edit/branch |
| Compaction：100 轮总结前 80 轮 | 能力有，数字过时。现按 token 压。E2E 已绿 |
| Thinking 持久化：刷新后 thinking 可展开 | 已实现，已勾 |
| 工具审批：重启 pending 超时 reject | 已做完，已更新清单 |

## 关键约束

- 全栈 TypeScript。Agent 运行时锁定 `@earendil-works/pi-agent-core`，不用 `^`。
- 数据访问层强制 owner 校验，认证异常 fail closed。
- 前端用 impeccable；后端用 Matt Pocock 风格工程 skill 集。
- 保持改动聚焦。不顺带重构、不升级依赖、不修无关 bug。
- 集成测试 dotenv 路径有空格 bug：`../../.env `，**不要顺手修**。
- `pnpm --filter ...` 会因 ignored builds 失败。包内测试直接跑 vitest。
- API 走 `@chalk/agent-runtime` 的 `dist/`。改 runtime 后必须：

```bash
cd packages/agent-runtime && npm run build
```

然后再重启 3001。

- 拉服务用 `setsid -f`，不要动 3000。
- 一个提交一个意图。不要 `git add .`。
- 不要提交 `pnpm-workspace.yaml`、`.env`。
- 不要把本 handoff 加进仓库。
- 提交信息用 Conventional Commits。
- 用户没要求时不要 push、不要开 PR。本次已经 push 过了。

## Playwright / 共享 DEV 用户

```bash
E2E_WEB_URL=http://localhost:3002 E2E_API_URL=http://localhost:3001 ./node_modules/.bin/playwright test tests/e2e/<spec> --workers=1
```

规则：

- `fullyParallel: false`，单 worker
- 共享 DEV 用户
- 结束必须 restore `defaultModel` / 删 fixture provider / 删自己的对话 / 恢复工具 approval
- 侧栏可能有别人的对话（`浏览器拒绝审批`、`新的数学问题` 等），只清自己 prefix 的残留
- 不要跑全量测试，除非用户要求

## 模块边界

- 可复用 Agent 能力放 `packages/agent-runtime`
- App adapter / composition root 放 `apps/api/src/agent`、`apps/api/src/modules`
- 浏览器只通过 HTTP/SSE 说话
- 不要为了这个分支再开一个 workspace package
- 不要预判最终 Agent / Chalkboard 依赖结构

## 第二里程碑（先不要做）

第一里程碑绿了之后才加：

- Web Search（引用 + 结果体积上限）
- 文件 / PDF 文本提取（MIME / size / page 限制）
- 确定性计算或验算
- Chalk 适配器：题目解析、提示规划

每个工具需要 TypeBox 参数、abort/timeout、审批分类、结果限长、密钥/PII 脱敏、单测 + 至少一条真实 Agent 路径测试。

## Observability / Eval

可观测性已经获准开展，详见“已确认的下一阶段”。扩展现有 telemetry，不要另起一套 logger；默认不记录 prompt、工具参数、凭证、cookie、上传内容、学生标识。

Eval 仍暂缓。开始时先做确定性门禁，再做模型打分；软件正确性测试和教学质量 eval 分开。

## 完成标准（第一里程碑已基本满足）

```text
login -> configure/select model -> create conversation -> multi-turn stream
      -> use Skill -> call built-in tool -> call MCP tool
      -> require and resolve approval -> steer -> abort
      -> reload page/process -> recover durable history and fail closed
```

页面刷新与真实 API 进程重启恢复均已有 E2E。

## 明天开场建议

先读取本 handoff、检查未提交改动与现有 Tool/MCP/Skill 实现，再从确定性 fixture 和真实 API 路径开始验证。Langfuse、原始输入输出持久化和 Chat 分支编辑均不在当前工作范围内。
