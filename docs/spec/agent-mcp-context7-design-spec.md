# Agent MCP 设计规格

> 文档状态：Accepted（v1 范围已确认）
> 实施状态：Implemented（provider-specific smoke 仍按需运行）
> 适用分支：`feat/chat-inline-blackboard`
> 最后核验：2026-08-31

## 1. 定位

MCP 是 Chalk 中低频、可选、默认收紧的外部工具接入层，不是通用编排平台。MCP 不改变 Chalk
已有的 Tool、审批、owner 和事件契约；远程 server 的名称、描述、schema、结果一律是不可信
数据，不能授予权限、降低审批要求或覆盖 system/developer policy。

v1 只解决一个问题：让 owner 显式启用的少量 HTTPS MCP server，可以通过一个按需连接的代理
Tool 被发现和调用，并且每次远程调用都由用户批准。

## 2. v1 能力边界

| 能力 | v1 决定 |
|---|---|
| 产品 Transport | 只开放 Streamable HTTP over HTTPS |
| 底层 stdio / SSE | 仅保留给管理员兼容、本地 fixture 和测试；不出现在普通产品设置面 |
| 认证 | `none` 或 owner-scoped Bearer Token；Token 加密保存，不回传明文 |
| OAuth | 不接受配置，不预留数据库/runtime 字段；授权与刷新整体 Deferred |
| Agent Tool | 每个已启用 server 一个 `search/describe/call` proxy |
| Direct Tool | 不注入生产 Agent；`McpManager.tools()` 仅供内部和测试使用 |
| MCP Resources | 不进入 v1 Agent 能力面；底层 adapter/fixture 显式开关后仍可测试 |
| 动态加载 | 不做 per-turn Tool 注入、热撤销或 `list_changed` 刷新 |
| 权限 | server enabled + 每次 `call` 审批；不做 per-tool/per-resource grant |
| 生命周期 | conversation runtime 内 lazy connect 与复用，runtime close 时断开 |
| 重试 | 远程 Tool call 绝不自动重试；失败后由用户决定是否重新调用 |

不为 v1 设计 marketplace、远程 Skill 安装、owner 级连接池、idle TTL、退避调度、capability
lease、activation ledger 或独立 Job 系统。

## 3. 模块与调用链

```text
HTTP /mcp
  -> authenticated owner
  -> McpServerService
  -> owner-scoped DAL
  -> PostgreSQL mcp_servers

conversation runtime
  -> load enabled owner servers
  -> new McpManager()
  -> register(config)              # 不连接
  -> proxyTools()                  # 每个 server 一个 Tool
  -> Chalk ToolRegistry
  -> Pi Agent

proxy search / describe
  -> lazy connect
  -> bounded tools/list discovery
  -> bounded metadata result

proxy call
  -> local requiresApproval=true   # 此阶段不得联网
  -> ApprovalBroker
  -> approved
  -> lazy connect if needed
  -> one remote tools/call request
  -> bounded Tool result
```

主要实现：

- `packages/agent-runtime/src/mcp/mcp-manager.ts`：transport adapter、lazy connect、bounded
  discovery、proxy 和单次远程调用；
- `packages/agent-runtime/src/mcp/mcp-network-policy.ts`：HTTPS、DNS/private network 和
  same-origin redirect 策略；
- `apps/api/src/modules/mcp/`：owner-scoped CRUD、Bearer 加密和连接测试；
- `apps/api/src/agent/runtime-manager.ts`：为每个 conversation runtime 装配 enabled server，并在
  runtime 关闭时释放连接；
- `apps/api/src/agent/tools/mcp-tool/`：产品 MCP Tool 组合；v1 默认只组合 proxy。

`McpManager` 只管理传入实例中的 `serverId`，不是跨 owner 的全局 Registry。owner 隔离由 API
的 owner-scoped DAL 和每个 conversation runtime 的独立 Manager 共同保证。

## 4. 审批与执行语义

proxy 有三种 action：

| action | 行为 | 是否单独审批 |
|---|---|---|
| `search` | 连接并发现远端 Tool，在本地按 query 过滤 metadata | 否；启用 server 即授予 discovery |
| `describe` | 返回某个已发现 Tool 的有界 metadata/schema | 否 |
| `call` | 把 tool name 与 arguments 发送给远端 | 是，始终审批 |

`requiresApproval` 必须是本地、同步语义上的纯判断，不能执行 connect、discovery 或其他网络操作。
审批被拒绝时，`call` 不得因审批判断而建立连接。

远端 `readOnlyHint` 只能展示为参考 metadata，不能决定 Chalk 的权限、免审批、并发或重试。每次
批准的 `call` 最多向远端发送一次：如果请求已经发出但结果未知，返回失败，不自动重放。这样
避免错误或恶意的 `readOnlyHint` 导致邮件、订单、扣费或其他副作用重复执行。

search/describe/call 都使用串行 execution mode。配置修改、禁用或删除 server 后，API 关闭该
owner 的旧 runtime；下一次请求按数据库最新配置重建，不做运行中的热更新。

## 5. 网络与凭据安全

产品可配置的 MCP URL 必须满足：

1. 只允许 `https:`；公网明文 HTTP 不进入 v1。
2. URL 不得包含 username/password。
3. URL 校验时，hostname 或任一 DNS 解析结果不得是 localhost、私网、link-local、保留或文档地址。
4. redirect 每一跳重新执行相同 URL 检查，最多三跳。
5. redirect 只能保持 same origin（scheme、hostname、port 均相同）；禁止把 Authorization 转发到
   其他 origin。
6. Bearer Token 按 owner/server 加密保存，公共响应只返回 `configuredBearer` 布尔值。
7. 日志、错误和 telemetry 不记录 Bearer、Authorization、完整 URL query 或远程正文。

底层 stdio adapter 继续用于确定性测试。普通用户不能通过 API 或 UI 配置 stdio/SSE；管理员
兼容入口仍不等于安全沙箱，不能把机构管理员等同于可执行任意宿主命令的运维身份。正式开放
stdio 前必须另行设计 worker/sandbox 与静态命令 allowlist。

v1 不保存或传递 OAuth metadata。因为该能力从未进入共享 schema，不为 Deferred 功能预留数据库
列或 runtime 配置；未来实现 OAuth 时必须重新定义 owner-scoped token 生命周期和独立 migration。

当前应用层先解析并检查 DNS，再由平台 `fetch` 建立 HTTPS 连接；它没有把已检查 IP 固定到该连接，
因此不宣称抵御恶意权威 DNS 在检查与连接之间切换地址。HTTPS 证书校验、同源 redirect 和部署环境
出口 ACL 仍是必要的纵深防御。若将来要求在应用层完整防御 DNS rebinding，必须使用能把已验证地址
绑定到 socket、同时保留原 hostname 的 TLS SNI/证书校验的专用 connector；不在 v1 中拼装半套实现。

## 6. Discovery 与输出边界

一次连接的 discovery 使用固定硬上限，而不是账户 quota：

- 最多 10 页 `tools/list`；
- 最多 200 个 Tool；
- 单个 Tool name 最多 200 字符；
- 单个 description/title 展示最多 2,000 字符；
- 单个序列化 input schema 最多 32,000 字符；
- 重复 cursor、持续新 cursor、超量 Tool 或超大 schema 均 fail closed。

当显式测试底层 Resources 时，相同页数规则适用，最多发现 200 个 Resource，单个 URI 最多
2,048 字符。生产 v1 不执行 `resources/list`，也不注册 `read_mcp_resource`。

远端 Tool result 只进入以下有界表面：

- 所有 text/embedded text 合计最多 32,000 字符，超过后带截断标记；
- structured content 序列化后最多 32,000 字符，超限只返回 omission metadata；
- 图片、音频、二进制和未知 content type 在 v1 省略，不直接塞入模型上下文；
- 外层 ToolRegistry 继续执行统一的 timeout、取消、result/update 字符上限和错误事件处理。

这些限制保护单次调用的内存和上下文，不建立 MCP 计费或账户额度系统。

## 7. 生命周期

v1 保持简单生命周期：

```text
runtime create
  -> register enabled configs (no network)
first proxy use
  -> connect promise de-duplication
  -> connection-local discovery
later use in same runtime
  -> reuse connection
runtime close / config change
  -> close client / stdio fixture process
next request
  -> create a fresh manager from current DB config
```

连接失败只影响当前 server 和本次调用。下一次用户主动操作可以重新连接；不实现后台重试、
failure backoff、idle eviction、session-expired 自动恢复或跨 conversation 连接池。Resource fixture
可以对明确的只读 resource read 做一次连接恢复，但该规则永远不适用于 Tool call。

## 8. 测试与验收

必须覆盖：

1. URL policy 拒绝 HTTP、URL credentials、校验时解析为 localhost/private 的 DNS 目标和 cross-origin redirect。
2. 普通用户不能配置 stdio/SSE；设置 UI 只提供 HTTPS Streamable HTTP。
3. Bearer 加密保存且公共响应不回传明文；OAuth 输入被拒绝，schema/runtime 不含 OAuth 预留字段。
4. `requiresApproval` 判断 `call` 时不连接；search/describe 不审批，call 始终审批。
5. 一个远端 Tool call 在结果未知时只发送一次，即使远端声明 `readOnlyHint`。
6. discovery 页数、数量、cursor 与 schema 超限 fail closed，description/title 有界截断。
7. text、embedded text 和 structured content 有界；非文本结果被省略。
8. 生产 Tool 组合默认只有 proxy，不包含 `read_mcp_resource` 或 concrete direct tools。
9. timeout、取消、runtime close 和 owner-scoped CRUD 行为可回归。
10. 本地 stdio fixture 验证真实 MCP 协议和 Pi Tool loop；外部 provider smoke 仅在显式测试配置下运行。

验收结果：未配置、已禁用或连接失败的 MCP server 不阻塞普通聊天；远程内容不能改变 Chalk
权限；无审批 port、审批拒绝、认证异常、网络策略失败或输出超限时 fail closed；配置变化后新
runtime 与数据库状态一致。

## 9. Deferred

只有出现明确产品需求时再评估：

- MCP Resources 正式开放；
- OAuth/PKCE/token refresh/revoke；
- 将已验证 DNS 地址绑定到实际 HTTPS socket 的 rebinding hardening；
- 受控 Catalog（固定 server URL，用户只配置 Token）；
- direct Tool allowlist；
- SSE 产品兼容；
- stdio sandbox/worker；
- metadata cache、`list_changed`、连接池与状态事件。

这些 Deferred 项不是 v1 待办，也不应阻塞 MCP proxy 的低频使用。
