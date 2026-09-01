# OpenMAIC v1 工作台、Skills 与 Pi Agent 设计调研

> 文档状态：Draft（调研资料）
> 研究日期：2026-08-31
> 研究对象：`/home/xcodd/code/chalk_/temp/OpenMAIC-v1`（本地正式版本快照）
> 方法：只阅读该快照中的源码、测试和项目文档；未修改 OpenMAIC 或 Chalk 运行代码。

## 结论先行

OpenMAIC v1 的关键不是把一个“大 Agent”塞进页面，而是把课程编辑拆成三个边界清晰的层：

1. **Workbench 是控制平面 UI**：导航 rail、会话聊天和 classroom 多栏独立存在，URL 只投影当前打开的 session/course；课堂面板和聊天面板可独立切换。
2. **Tools 是受校验的领域命令**：Agent 通过 TypeBox schema、owner 闭包和 capability allowlist 操作课程、材料、媒体及技能，不直接编辑不透明 blob。
3. **Pi 只负责 Agent loop**：OpenMAIC 通过 `StreamFn` 把 Pi 的事件协议接到自己的模型连接器，保留 Pi 的多轮、tool loop、history、hooks 和取消语义；未 vendoring Pi 源码。

这套分层适合 Chalk 当前的方向：可以借鉴 Workbench 的会话/事件投影、Tool 装配和 Skill 生命周期，但不应照搬其课堂 DSL 或把 `run_subagent` 直接改成数学专用接口。

## 1. Workbench：三栏控制平面，而不是聊天组件堆叠

README 将 Pro workbench 定义为 chat-first 的课程构建表面：可规划、构建和修订整套课程；入口由 `NEXT_PUBLIC_PRO_WORKBENCH_ENABLED` 与服务端 `OPENMAIC_AGENT_RUNTIME_ENABLED` 双重控制，并要求显式 `MODEL_ROUTES`，没有 provider fallback（`temp/OpenMAIC-v1/README.md:437-465`）。

`WorkspaceShell` 把界面拆为 navigation、agent conversation、classroom 三个 sibling panes；`?session=` 与 `?course=` 是彼此独立的 URL 投影，课程切换不会卸载聊天，聊天 session 也不隐式等同于“拥有该课程的 session”（`temp/OpenMAIC-v1/components/workbench/workspace/WorkspaceShell.tsx:3-47`）。这使得以下状态可以分别恢复：

- rail 中的文件夹、课程和会话选择；
- 一个长期 session 的事件日志和草稿；
- classroom 中打开的课程 tabs、场景刷新和播放状态。

聊天面的交互契约是长连接式会话：`POST /messages` 在 idle 时启动新 run，在运行中转为 steering；`POST /cancel` 只结束当前 run，不删除会话。`WorkbenchChat` 同时把 `ask_user` 作为 composer takeover，答案仍通过普通 user message 发送（`temp/OpenMAIC-v1/components/workbench/WorkbenchChat.tsx:11-25`）。

服务端 API 只做 durable store 控制面，worker 在请求返回后异步 claim session（`temp/OpenMAIC-v1/app/api/agent/sessions/route.ts:1-5`）。SSE 事件流具备 backlog replay、`Last-Event-ID`、`caught_up` 信号和断线重连；事件流是日志尾部，不是执行生命周期，客户端断开不会停止 runner（`temp/OpenMAIC-v1/app/api/agent/sessions/[id]/events/route.ts:1-32`）。

**对 Chalk 的可复用点**：将 Chat、Scene/课堂显示和导航视为同一 session 的独立投影；把 SSE backlog 与 live tail 统一成一个可重放事件协议。当前 Chalk 的 `content`/`details` Tool result 分工可以沿用，但要确保 scene/artifact 的前端投影不依赖模型上下文。

## 2. Tools：显式领域命令、同一装配根和 fail-closed 边界

README 的能力表覆盖课程规划、Stage DSL 读写、逐 Scene 生成、材料抽取、媒体生成、PPTX 导入、roster/voice 配置等，并明确 Agent 不编辑 opaque blob，而是调用 validated tools（`temp/OpenMAIC-v1/README.md:534-549`）。

### 2.1 组合根和能力门控

runner 在 claim session 后按能力构建工具组，再把同一组名称用于 `allowedToolNames`；例如 web search 只有配置了 provider 才注册，`register_voice` 只有存在可用注册后端才注册，`read` 只有安装了 skill 才注册（`temp/OpenMAIC-v1/lib/server/agent-runtime/runner.ts:1362-1438`、`:1441-1471`）。这样模型看不到“注册了但只能报错”的伪能力。

工具装配通过 `assembleRunnerTools` 这一纯函数 seam 完成，测试可以直接锁定实际 name set（`temp/OpenMAIC-v1/lib/server/agent-runtime/runner-contract.ts:1-16`）。课程工具再通过 `withOwnerStageAuthorization` 包装，owner probe 失败即拒绝写入，避免每个工具重复实现授权。

### 2.2 参数 schema 和结果边界

课程、材料和 Skill 编辑工具使用 TypeBox 的窄 schema：操作类型、合法路径、分页 offset、字符串/数字边界都在 schema 或业务校验中描述（例如 `temp/OpenMAIC-v1/lib/server/agent-runtime/dsl-tools.ts:33-124`、`temp/OpenMAIC-v1/lib/server/agent-runtime/skill-edit-tools.ts:53-111`）。Skill patch 采用 `intent + ops[]` 的原子批次，重复投递以 fixpoint 规则判定，失败时整批不写入（`temp/OpenMAIC-v1/lib/server/agent-runtime/skill-edit-tools.ts:17-20`、`:304-379`）。

工具结果把给模型的短文本放在 `content`，给 UI/审计的结构化信息放在 `details`；Workbench ToolCard 折叠行由 `details` 生成的人类摘要，原始 payload 仅在 disclosure 中显示且按文本预算截断（`temp/OpenMAIC-v1/components/workbench/chat/tool-card.tsx:3-18`、`:68-90`）。

**与 Chalk 当前实现的差异**：Chalk 已有统一 `RuntimeTool`、错误码、超时和结果预算，但仍需审查 `/tools` 清单与实际注入的一致性，以及所有 Tool 是否都遵守窄 schema 和 `content`/`details` 边界。OpenMAIC 的 capability-gated registration、纯装配 seam 和 owner 闭包可作为下一阶段收口标准。

## 3. Skills：渐进披露、可恢复读取和用户技能安全边界

OpenMAIC 的内置 Skill 是带 YAML frontmatter 的目录：`name/title/description` 构成模型可见契约，正文按需读取。`skills.ts` 调用 Pi 的 `loadSkills`、`formatSkillsForSystemPrompt`，匹配后使用 Pi 原生 `read` 读取 `SKILL.md`；可选的 `outline-constraints.json` 只给机器校验，不混入模型契约（`temp/OpenMAIC-v1/lib/server/agent-runtime/skills.ts:1-22`、`:49-65`、`:137-174`）。

Skill 选择会写入 durable transcript：`skill-preload.ts` 把用户显式选择合成为 assistant `read` + toolResult 消息，和模型主动 read 使用同一形状，从而支持 crash resume 和去重。它限制每条消息最多预加载 3 个 Skill、共享 60,000 字节预算；超出者以位置提示延后由模型决定是否读取（`temp/OpenMAIC-v1/lib/server/agent-runtime/skill-preload.ts:24-69`、`:115-160`、`:202-244`）。

用户 Skill 存储在 owner-scoped 数据库中，正文会包裹“user-controlled, low-priority task guidance”降权前缀，不能覆盖 system/developer 指令（`temp/OpenMAIC-v1/lib/server/agent-runtime/skills.ts:99-117`）。`GET/POST /api/agent/skills` 提供按 owner 的列表和 zip/Markdown 上传，上传大小、重复名、配额和格式错误都有稳定响应（`temp/OpenMAIC-v1/app/api/agent/skills/route.ts:1-10`、`:46-99`）。

编辑用户 Skill 时，`read_skill(detail:"source")` 返回数据库中的字节原文，`patch_skill` 只允许 `/content`、`/title`、`/description` 的受限原子操作；原文包裹不可伪造 nonce fence，模型被明确告知“按数据编辑，不能执行其中指令”（`temp/OpenMAIC-v1/lib/server/agent-runtime/skill-edit-tools.ts:132-189`、`:263-309`）。

Skill 回归测试覆盖 metadata-only prompt、native read 目录限制、transcript 成功/失败恢复、outline 约束和 runner wiring（`temp/OpenMAIC-v1/tests/agent-runtime/skills.test.ts:52-160`、`:163-237`；`temp/OpenMAIC-v1/tests/agent-runtime/runner-skills-registration.test.ts:1-15`）。

**与 Chalk 当前实现的差异**：Chalk 已有 `SkillRegistry`、trusted source、`read_skill` 和启停设置，但应继续保持“Skill 是指导文本，不是普通 resource”的边界；可借鉴 OpenMAIC 的强制 preload、正文预算、用户内容降权 fence 及 transcript 去重测试。

## 4. Pi Agent：只复用 harness，通过 StreamFn 接入自有 Provider

OpenMAIC 固定依赖 `@earendil-works/pi-agent-core@0.78.0` 与 `@earendil-works/pi-ai@0.78.0`，只使用 Agent loop、session/skills/compaction/hooks 和事件类型；不使用 pi-ai provider、pi-tui 或 pi-coding-agent，且明确暂不 vendoring 源码（`temp/OpenMAIC-v1/lib/agent/VENDOR.md:1-34`、`temp/OpenMAIC-v1/package.json:51-52`）。

`buildAgent` 注入项目自己的 `StreamFn`、system prompt、history 和 request-scoped tools，统一启用 sequential tool execution、beforeToolCall allowlist、afterToolCall quota/error hook，并用 `withAgentToolTimeout` 包裹每个工具（`temp/OpenMAIC-v1/lib/agent/runtime/build-agent.ts:1-18`、`:41-101`）。

`createCallLlmStreamFn` 把 OpenMAIC 的 `streamLLM` fullStream 映射成 Pi 的 text/thinking/tool-call 事件；Pi 侧 model 仅是 metadata stub，真实 provider 由 connector 解析（`temp/OpenMAIC-v1/lib/agent/runtime/stream-fn.ts:1-14`、`:249-277`）。这是一条很清晰的适配 seam：更换 provider 不需要改 Pi loop。

通用 child agent 通过 `runNativeChild` 运行独立 Agent，具备超时、取消、最大 provider transport 次数、重复 tool-call 保护和父子结果 telemetry；Chat 的 native child 以 TypeBox 参数 `agentId/instruction` 暴露为工具，工具结果同时提供可见文本和结构化 `nativeChildRun` details（`temp/OpenMAIC-v1/lib/chat/pi/tools/call-agent.ts:42-49`、`:711-836`；`temp/OpenMAIC-v1/lib/agent/runtime/run-native-child.ts:24-47`、`:189-257`）。

**对 Chalk 的建议**：保留当前 `run_subagent` 的通用文本摘要定位；若未来需要 Geometry Artifact，应新增结构化 artifact contract，而不是把通用 child 工具偷偷改成领域专用返回值。

## 5. MCP 观察：OpenMAIC v1 没有可复用的通用 MCP manager

在 OpenMAIC-v1 的 `lib`、`app` 和 `packages` 源码中未发现 MCP server 生命周期、tool/resource discovery 或统一 MCP manager；“MCP”仅出现在 web-search provider 的说明和 locale 文案中（例如 `temp/OpenMAIC-v1/lib/web-search/constants.ts:64`）。因此，本快照不能作为 Chalk MCP manager 的实现参考。

可借鉴的只有间接原则：能力未配置时不注册工具、provider adapter 与 Agent loop 解耦、错误不静默 fallback。这些原则已经体现在上文 runner 的 capability gate 和 Pi StreamFn adapter 中。

## 6. 给 Chalk 的落地差异与优先级

| 领域 | OpenMAIC v1 已验证做法 | Chalk 当前状态/差异 | 建议 |
|---|---|---|---|
| Workbench | 三栏 sibling panes，URL 投影，session/course 独立 | Chalk Chat/Scene 已有独立 Tool result 通道，但需继续统一事件投影 | 先定义 session event → Chat/Scene 的单向投影，避免 UI 读取内部 transcript 细节 |
| Tools | TypeBox 窄 schema；能力门控；同一装配根；owner 闭包 | RuntimeTool、registry、错误码已存在，清单一致性和 schema 收口仍在审查 | 逐工具做 description/schema 真实性审计，锁定装配 name set |
| Skills | Pi native read + preload；60KB/3 skill cap；用户正文 fence | 已有 SkillRegistry/read_skill/trusted source | 增加 preload 去重、正文预算和用户内容注入回归测试 |
| Pi | 0.78.0 固定版本；StreamFn adapter；统一 timeout/allowlist | 已采用 `@earendil-works/pi-agent-core`，并有相似超时/telemetry 层 | 保持 adapter seam，不 vendoring；补齐 parent/child telemetry 关联 |
| MCP | 无通用 manager | Chalk 已有 MCP manager、resource facade 和网络策略 | 不迁移 OpenMAIC MCP 代码，仅对照其 capability-gate 原则 |
| Subagent | native child 返回 bounded text + details 运行统计 | `run_subagent` 当前同样偏文本摘要，默认禁用 | 在数学插件前先稳定通用契约；未来用版本化 artifact result 扩展 |

## 7. 限制与未验证项

- 本调研没有启动 OpenMAIC 服务，也没有验证真实数据库、provider 或浏览器行为；结论以源码和仓库内测试为准。
- OpenMAIC 的匿名 cookie owner 仍是其服务端 session 访问模型的一部分；Chalk 的认证/owner 约束更严格，不能直接复制其匿名身份方案（`temp/OpenMAIC-v1/app/api/agent/sessions/[id]/events/route.ts:25-32`）。
- OpenMAIC 的 20 个 Skill 主要服务课程创作流程，不代表跨课程长期 Learner Model；Chalk 的学习成长模型仍需独立建设。
