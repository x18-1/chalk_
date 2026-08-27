# pi-mcp-adapter 与 Chalk MCP 接入对照

> 调研日期：2026-08-24
> 范围：`pi-mcp-adapter` 2.27.0（npm tarball/README/source）、MCP TypeScript SDK v1 文档与源码、Chalk 当前工作树。
> 资料原则：关键行为均回溯到包作者源码、MCP 官方 SDK 文档/源码或本仓库实际代码；未记录任何凭据。

## 结论摘要

`pi-mcp-adapter` 是面向 Pi coding-agent host 的完整 MCP 产品层：它在 MCP client/transport 之上增加配置合并与导入、惰性连接和元数据缓存、单一 proxy 与可选 direct tools、资源/提示词、OAuth/静态 bearer 凭据、审批 broker、输出大小保护、生命周期/重连、状态事件、MCP UI、sampling/elicitation 和脚本化多调用。它不是 `pi-agent-core` 的通用插件 API；入口依赖 Pi coding-agent 的 extension host。

Chalk 已实现一条清晰、较小的 v1 运行时链路：API 按 owner 读取并加密 MCP 配置，`McpManager` 使用官方 SDK 的 stdio/SSE/Streamable HTTP transport，按需连接、`listTools`、单 proxy 搜索/描述/调用，映射文本/图片/文本资源结果，支持超时/取消/关闭和连接失败显式报错。当前最大的差距不是基础协议，而是生产级运行时策略：没有 MCP OAuth/bearer/header 认证、缓存和 idle lifecycle、自动重连/list-changed、资源/提示词 API、输出 guard、状态事件/可观测性、统一审批语义及配置来源管理。

建议按优先级：

1. **P0 安全与边界**：实现远程 MCP 认证（至少 OAuth 2.1 或受控 bearer secret）、请求 header 注入、凭据 URL 绑定/安全存储；将 MCP server 的 command/cwd/env/URL 纳入 allowlist、审计和 SSRF/DNS-rebinding 防护。
2. **P1 稳定性与上下文成本**：加入 metadata cache、idle/lazy lifecycle、连接代际/并发去重、list-changed 刷新、有限退避重连；默认保留 proxy，按白名单提供 direct tools；对文本、结构化结果和二进制资源加大小上限。
3. **P1 产品能力**：补齐 MCP resources/prompts（先只读、显式暴露）；为状态、连接失败、认证待办和 MCP 调用发出结构化 telemetry/审计事件，并把审批策略从 `readOnlyHint` 扩展为 server/tool/用户策略。
4. **P2 选择性能力**：sampling、elicitation、MCP UI 和 `mcpScript` 仅在 Chalk 有明确课堂场景、隔离和审批模型后评估，不应直接移植 coding-agent UI 代码。

## 1. pi-mcp-adapter 做了哪些接入工作

### 1.1 配置发现、合并和运行时注册

- 自动读取 `.mcp.json`、`~/.config/mcp/mcp.json`、`~/.agents/mcp*.json` 及 Pi 自有覆盖文件；定义固定优先级，`/mcp enable|disable` 只写项目覆盖，不改共享源文件、不复制凭据。
- 可显式发现/导入 Cursor、Claude Code、Claude Desktop、Codex、OpenCode、Windsurf、VS Code 配置；默认 host discovery 为 off，避免未经同意执行外部 host 命令。
- 支持 Agent Plugins 的 `plugin.json`、Pi package `pi.mcp`、extension 运行时 `registerMcpServer()`；运行时注册为 session-scoped，重复名称 fail closed。
- SDK `createMcpAdapter({ config })` 接受隔离、不可变配置快照，不读写 ambient 文件；`configPath` 模式才参与文件合并。

来源：[README 配置与导入](https://raw.githubusercontent.com/nicobailon/pi-mcp-adapter/v2.27.0/README.md#config)、[README 运行时注册](https://raw.githubusercontent.com/nicobailon/pi-mcp-adapter/v2.27.0/README.md#runtime-registration-from-other-extensions)、[types.ts `McpAdapterOptions`/`ServerEntry`](https://github.com/nicobailon/pi-mcp-adapter/blob/v2.27.0/types.ts#L360-L573)。

### 1.2 Transport、惰性连接和生命周期

- 支持 stdio、Streamable HTTP、旧 SSE，以及显式 `rmcp-mux` Unix socket；HTTP 默认 Streamable HTTP，收到明确 404/405/406/415 才回退 SSE。
- server 默认 `lazy`：首次工具调用才连接；缓存的 tools/resources/prompts 元数据可在无连接时搜索/描述。另有 `eager`、`keep-alive`、`lazy-keep-alive`；idle timeout 默认 10 分钟。
- 单 server 连接/重连去重，连接代际 guard 防止 close 与 connect 竞态；keep-alive 定期 ping/tools-list，session 过期时有限退避重连。MCP `list_changed` 会刷新工具面，且可 `freezeDirectTools` 保持 prompt 前缀稳定。
- 连接关闭时释放 transport、临时资源目录和监听器；stdio 错误只捕获有限 stderr 尾部。

来源：[README Server Options/Lifecycle](https://raw.githubusercontent.com/nicobailon/pi-mcp-adapter/v2.27.0/README.md#server-options)、[README Lifecycle Modes](https://raw.githubusercontent.com/nicobailon/pi-mcp-adapter/v2.27.0/README.md#lifecycle-modes)、[server-manager.ts](https://github.com/nicobailon/pi-mcp-adapter/blob/v2.27.0/server-manager.ts)、[types.ts transport/lifecycle](https://github.com/nicobailon/pi-mcp-adapter/blob/v2.27.0/types.ts#L370-L448)。

### 1.3 Context 控制：proxy、direct、缓存和搜索

- 默认只注册一个约 200-token 的 `mcp` proxy，执行 `search → describe → call`；避免把数十个 MCP schema 一次塞入上下文。
- `directTools: true|string[]` 可将全部或白名单工具注册为独立 tool；`includeTools`/`excludeTools` 过滤工具和资源；`toolPrefix` 防止跨 server 冲突。75+ direct tools 给出提示，`freezeDirectTools` 可冻结面以保持 prompt cache。
- metadata cache（默认 Pi agent dir 的 `mcp-cache.json`）使启动时无需连接即可注册 direct tools；连接后根据权威 `tools/list` 删除陈旧工具。
- 搜索支持额外 `searchKeywords`，而且只影响 ranking，不进入 tool schema。

来源：[README Quick Start/Direct Tools](https://raw.githubusercontent.com/nicobailon/pi-mcp-adapter/v2.27.0/README.md#quick-start)、[README Direct Tools](https://raw.githubusercontent.com/nicobailon/pi-mcp-adapter/v2.27.0/README.md#direct-tools)、[direct-tools.ts](https://github.com/nicobailon/pi-mcp-adapter/blob/v2.27.0/direct-tools.ts)、[proxy-modes.ts](https://github.com/nicobailon/pi-mcp-adapter/blob/v2.27.0/proxy-modes.ts)。

### 1.4 认证、审批和安全护栏

- HTTP 支持 OAuth（authorization-code、client-credentials、动态注册/预注册 client、PKCE、issuer/resource 校验）和 bearer token；token 放 OS credential store，按 server name + resolved URL 绑定，secure store 不可用时 fail closed，不退回明文。
- 支持静态 headers、环境变量插值、每次请求执行的 `requestHeadersCommand`（签名场景）；敏感值可由受限命令在连接时取得。OAuth 状态/PKCE verifier 按 flow 隔离。
- `approveTools` 支持全局、server、glob；proxy/direct/resource/UI 都走审批；UI 不可用/headless 时匹配调用返回 `approval_required`，不执行。扩展可通过同步 event broker claim 决策。
- 输出 guard 默认限制文本 50 KiB/2000 行、details JSON 16 KiB；超限截断并以 0600 临时文件引用。二进制资源单文件 10 MiB、session 100 MiB/10000 文件，session teardown 清理。metadata-only trace 明确不保存 payload、参数、结果、URL 或授权资料。

来源：[README OAuth/Remote-headless OAuth](https://raw.githubusercontent.com/nicobailon/pi-mcp-adapter/v2.27.0/README.md#remoteheadless-oauth)、[README Tool Approval](https://raw.githubusercontent.com/nicobailon/pi-mcp-adapter/v2.27.0/README.md#tool-approval)、[README Output Guard](https://raw.githubusercontent.com/nicobailon/pi-mcp-adapter/v2.27.0/README.md#output-guard)、[mcp-auth.ts](https://github.com/nicobailon/pi-mcp-adapter/blob/v2.27.0/mcp-auth.ts)、[consent-manager.ts](https://github.com/nicobailon/pi-mcp-adapter/blob/v2.27.0/consent-manager.ts)、[tool-registrar.ts](https://github.com/nicobailon/pi-mcp-adapter/blob/v2.27.0/tool-registrar.ts)。

### 1.5 MCP 完整能力面

- 发现并暴露 resources（可生成 `read_*` 工具）和 prompts（Pi slash commands）；支持 list-changed 刷新。
- 处理 text/image/audio/resource/resource_link；空 content 时回退 structuredContent；大文本/二进制有 guard 和 materialization。
- 可选 server→Pi sampling（模型调用）和 elicitation（表单/URL，要求用户同意）；MCP UI iframe/native viewer 与双向消息；`mcpScript` 在 worker 中执行多次 MCP 调用，默认 30s 且受审批/abort/output guard 约束。
- 公开 versioned status event：每 server 有 connected/cached/failed/needs-auth/not-connected/disabled、tool/resource counts；快照不会触发连接或暴露 client/transport/credentials。

来源：[README MCP Prompts/Elicitation/UI/Scripting](https://raw.githubusercontent.com/nicobailon/pi-mcp-adapter/v2.27.0/README.md#mcp-prompts)、[types.ts status/content](https://github.com/nicobailon/pi-mcp-adapter/blob/v2.27.0/types.ts#L1-L70)、[index.ts](https://github.com/nicobailon/pi-mcp-adapter/blob/v2.27.0/index.ts)。

## 2. 与 Chalk 当前实现逐项对照

| 维度 | Chalk 当前事实 | pi-mcp-adapter 对应能力 | 差距/判断 |
|---|---|---|---|
| SDK/transport | `@modelcontextprotocol/sdk@1.30.0`；stdio、SSE、Streamable HTTP；URL 仅 http/https，拒绝 URL 内 credentials（`packages/agent-runtime/src/mcp/mcp-manager.ts:64-92`） | 同样复用官方 client，另有 Unix socket、HTTP→SSE 条件回退、版本协商（legacy/auto/2026） | 基础覆盖；缺 socket、版本协商和认证 transport。官方 SDK v1 将 SSE 标为 deprecated、Streamable HTTP 推荐。[SDK client docs](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/docs/client.md#transports-and-backwards-compatibility) |
| 配置/owner | API `/mcp` CRUD；DAL 查询/更新/删除均带 `userId`；env 加密；enabled server 注入 runtime（`apps/api/src/modules/mcp/*`, `apps/api/src/db/dal/mcp-servers.ts`） | 多来源合并、显式导入、Pi overrides、session runtime registration | Chalk 的 owner 约束更贴合产品；缺来源/冲突可见性、配置版本和命令/cwd allowlist。不要照搬文件配置到多租户 API。 |
| 连接时机 | runtime 创建时仅 `register`；`proxyTools()` 暴露 proxy；首次 proxy action 才 `connect→listTools`；连接 promise 去重（`mcp-manager.ts:173-242, 300-393`） | lazy/eager/keep-alive 四模式，metadata cache，无连接搜索/描述 | Chalk 已有 lazy/proxy 的核心取舍；缺 cache、idle disconnect、重连和 list_changed。 |
| 工具暴露 | 每 enabled server 一个 `mcp__<safe name>__<id>` proxy；另有 `connect()` 后 `manager.tools()` 供测试/内部使用；未接 direct 白名单（`mcp-manager.ts:229-242, 315-371`） | 默认 proxy；可按 server/global directTools、include/exclude、prefix、冻结/热刷新 | Chalk 默认上下文小；建议 P1 增加受控 direct 白名单，不能默认全量。 |
| 参数校验 | 远端 `inputSchema` 直接转 TypeBox `TSchema`；官方 SDK/agent 边界校验；README 当前不另做 schema 校验 | adapter 显式说明 server 负责参数校验，同时 direct/proxy 做 JSON Schema 归一/错误摘要 | 需确认 TypeBox 对任意 JSON Schema 的兼容性；P1 为远端 schema/调用错误加安全归一，避免异常直接泄露。 |
| 结果映射 | text/image/resource.text 转 Pi；resource blob、audio、resource_link 等统一“omitted”文本；保留 `structuredContent` details（`mcp-manager.ts:92-125`） | text/image/audio/resource/resource_link；structuredContent 空 content 回退；二进制资源写 0600 临时文件并限额 | Chalk 功能可用但会丢 audio/blob/resource_link；P1 必须加大小 guard，避免模型上下文/JSONL 爆炸。 |
| 超时/取消 | connect 10s、call 30s；AbortSignal 透传；失败状态保留；close 释放 client（`mcp-manager.ts:182-311`；单测覆盖 timeout/abort/close） | 每 server/global timeout；abort 与 runtime owner 合并；有限 backoff/reconnect；stderr/输出 guard | Chalk 已有良好最小基线；缺重连、连接代际 race guard 和输出限制。 |
| 审批 | `requiresApproval = readOnlyHint !== true`；Chalk runtime 另有 `ApprovalBroker`，但 MCP adapter 本身只标记，未提供 per-server/tool glob/headless fail-closed 语义 | 全局/server/glob approveTools，proxy/direct/resource/UI 统一 broker；headless 返回 approval_required | P0/P1：把“非只读”与 Chalk 产品审批策略结合，不能只信远端 annotation；审批拒绝必须 fail closed、可审计。 |
| 认证/凭据 | API 仅加密 env；HTTP URL 禁 credentials；`SSEClientTransport`/`StreamableHTTPClientTransport` 未传 auth provider 或 headers（`mcp-manager.ts:64-91`） | OAuth 2.1、bearer、OS credential store、URL binding、request headers command、issuer 校验 | **最大安全缺口**。P0 先定义多租户 secret store/owner/rotation，再接官方 SDK OAuth provider；禁止把 token 放 MCP JSONL/日志。 |
| resources/prompts | 只处理 tool result 内嵌 resource.text；没有 `listResources/readResource/listPrompts/getPrompt` API | resources→工具、prompts→slash commands，缓存和变更刷新 | P1 先做只读 resources/prompts，明确权限/上下文预算；不直接移植 Pi slash/TUI。 |
| 生命周期/状态 | `statuses()` 仅 disconnected/connecting/connected/error、toolCount、error、connectedAt；API test 返回状态；runtime close 时清理（`mcp-manager.ts:22-31,243-258`） | 丰富状态快照 + versioned event，缓存/needs-auth/disabled，读取状态不连接 | Chalk 状态 DTO 可复用概念；P1 增加 machine-readable event 和失败时间/认证待办，接 telemetry。 |
| 配置变更 | API create/update/delete 调 `closeUserRuntimes(userId)`，下轮 runtime 重新装配；无热刷新 | 当前 session 可 reload/direct tool sync，配置源不改写 | Chalk 的 close/recreate 更易验证；P1 做并发安全热刷新前先保留 close-and-rebuild。 |
| 观测/审计 | runtime events/toolResult 持久化；`details` 有 server/tool/action；没有专门 MCP trace guard | metadata-only protocol trace、approval/status 事件、输出摘要 | P1 增加 mcp_call（server/tool/duration/outcome/bytes）和 approval audit，严禁参数/密钥。 |
| MCP 高级特性 | 无 sampling、elicitation、UI、script | 全部有实现，且 UI/headless/worker 有限制 | P2；这些能力会扩展信任边界，不应因“接入 adapter”直接引入。 |

## 3. 风险与具体建议

### P0：多租户安全和认证

1. **远程 server 目前不能安全承载 OAuth/bearer。** 仅拒绝 URL credentials 不等于认证；env 加密只覆盖 stdio 环境变量。按 MCP 官方 SDK 的 `OAuthClientProvider` 契约实现 Chalk 自有 provider，把 token、client registration、PKCE verifier 放 owner-scoped 加密存储；绑定 server id + canonical URL，失效时清除并要求重新授权。SDK 官方明确说明 token/code verifier 不应跨 session。[OAuth provider 契约](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/client/auth.ts#L45-L150)
2. **stdio 是服务器端执行任意 command 的能力。** 当前 API 允许用户写 command/args/env，且 runtime 以 API 进程权限 spawn；应增加可执行文件/工作目录 allowlist、资源/网络隔离、环境变量最小投影、命令审计，并限制 child lifetime。MCP SDK 文档确认 stdio transport 会 spawn child process。[SDK stdio docs](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/docs/client.md#stdio-transport)
3. **HTTP SSRF/DNS rebinding。** 当前只检查 scheme 和 credentials，没有 host allowlist、私网策略、DNS rebind 或 redirect policy。MCP 官方 server 文档将 localhost DNS rebinding 列为风险并提供 Host 校验 middleware；Chalk 作为 client 仍需 outbound URL policy。[官方 DNS rebinding 文档](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/docs/server.md#dns-rebinding-protection)

### P1：稳定性、上下文和数据泄露

- 增加 metadata cache（DB 或受控文件，带 owner/server URL/schema hash/版本）；缓存只能用于 search/describe/direct registration，真实 call 前仍连接并刷新。
- 引入每 server idle timeout、有限退避 reconnect、list_changed 订阅和连接 generation guard；保留当前 close-and-rebuild 作为配置更新的安全 fallback。
- 结果在进入 agent message、session JSONL、telemetry 前做 text/line/bytes guard；blob/audio 设上限并以受控临时文件或显式“已省略”表示。pi-mcp-adapter 的 50 KiB/2000 行、16 KiB details 只是可调起点，Chalk 应按课堂上下文预算压小并记录 bytes/outcome。
- 只把远端 `readOnlyHint` 作为提示，不作为授权事实；默认 MCP tool 仍需 Chalk policy 决定。工具调用异常应分类为 mcp/approval/network，避免把远端错误当成功文本。

### P1：资源、提示词、状态和审计

- 先支持只读 `resources/list/read` 和 `prompts/list/get`，设置每次读取大小与 MIME 白名单；不要把 prompt 结果当系统指令，需标记来源并经过 Chalk prompt 注入策略。
- 扩展 `McpServerStatus` 为 `cached/needs-auth/failed/disabled` 等状态，发出版本化只读事件；状态读取不能触发连接。事件 payload 仅 server id、tool/resource counts、时间、错误类别和脱敏 message。
- 记录 `mcp_call`、`mcp_connect`、`mcp_approval` 审计：owner、conversation/session、server/tool、duration、outcome、bytes、connection generation；不记录 args、原始结果、Authorization、URL query 或 env。

### P2：高级协议能力

Sampling 允许 MCP server 反向请求模型，elicitation/UI 会引入用户交互和浏览器信任边界，`mcpScript` 则是 agent-authored code execution。除非 Chalk 明确设计模型预算、用户同意、沙箱和审计，否则保持禁用；需要时从官方 SDK capability negotiation 开始，而不是复制 adapter 的 Pi TUI/extension host 实现。[MCP 官方 SDK 概览](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/README.md#overview)

## 4. 版本与集成边界

- `pi-mcp-adapter@2.27.0` 的 `package.json` 是 TypeScript source-loader 入口，peer/运行假设面向 Pi coding-agent；README 明确 standalone Node 需 TS loader，raw Node ESM 不会直接执行 `.ts`。因此 Chalk 不应把它作为 runtime dependency 或直接 import `index.ts`。
- Chalk 当前锁定 `@earendil-works/pi-agent-core@0.84.1` 与 `@modelcontextprotocol/sdk@1.30.0`；官方 SDK v1 文档称 SSE deprecated、Streamable HTTP recommended。升级 MCP SDK 或采用 2026 协议前必须做兼容性测试，特别是 HTTP session、auth、list-changed 和错误码。
- MCP 官方 TypeScript SDK 主线 README 已标明 v2 是与 2026-07-28 规范同步的稳定线，包名拆为 `@modelcontextprotocol/client` / `@modelcontextprotocol/server`；v1.x（Chalk 当前使用的 `@modelcontextprotocol/sdk`）至少继续获得一段时间的 bug/security fixes。v2 的 `registerTool` 会在输入/输出 schema 层验证并将普通 handler 异常包装成 `isError` tool result；其 HTTP handler 仍不替代 Host/Origin 或 token middleware。因此不能把 pi-mcp-adapter 的“支持 modern protocol”理解为 Chalk 当前 v1 依赖已具备 v2 API，迁移需单独验证包名、schema、session 和 auth 语义。
- 可借鉴的是 adapter 的**模式**（proxy/direct、lazy lifecycle、metadata cache、URL-bound auth、output guard、状态快照），而不是其 coding-agent extension/UI 代码。公共接口继续位于 `packages/agent-runtime`，owner/secret/审批/审计继续由 `apps/api` 强制。

## 一手来源索引

- pi-mcp-adapter README（v2.27.0）：<https://raw.githubusercontent.com/nicobailon/pi-mcp-adapter/v2.27.0/README.md>
- pi-mcp-adapter 源码（v2.27.0）：<https://github.com/nicobailon/pi-mcp-adapter/tree/v2.27.0>
- MCP TypeScript SDK v1 README：<https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/README.md>
- MCP SDK v1 client docs：<https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/docs/client.md>
- MCP SDK v1 server docs：<https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/docs/server.md>
- MCP SDK v1 `Client`：<https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/client/index.ts>
- MCP SDK v1 Streamable HTTP：<https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/client/streamableHttp.ts>
- MCP SDK v1 SSE：<https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/client/sse.ts>
- MCP SDK v1 stdio：<https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/client/stdio.ts>
- MCP SDK v1 OAuth provider：<https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/client/auth.ts>
- MCP SDK v2 README（官方主线，2026-07-28 规范）：<https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md>
- MCP SDK v2 `registerTool`/handler schema validation：<https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/mcp.ts#L953-L1010>
- MCP SDK v2 HTTP handler/auth boundary：<https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/createMcpHandler.ts#L1-L128>
- Chalk MCP manager：`packages/agent-runtime/src/mcp/mcp-manager.ts`
- Chalk MCP tests：`packages/agent-runtime/tests/unit/mcp-manager.test.ts`
- Chalk API MCP schema/service/DAL：`apps/api/src/modules/mcp/schemas.ts`、`apps/api/src/modules/mcp/services/mcp-server.service.ts`、`apps/api/src/db/dal/mcp-servers.ts`
- Chalk architecture boundary：`docs/architecture/third-party-integrations.md` §7 MCP 特别规则
