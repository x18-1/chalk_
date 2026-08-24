# Tools 基础阶段 → MCP 阶段交接

> 交接状态：Ready for next phase
> 来源 worktree：`.worktree/tools-foundation`
> 分支：`feat/tools-foundation`
> 最后核验：2026-08-24

## 1. 交接结论

Tools 第一阶段的基础执行保护和统一 Read facade 已完成。下一阶段可以进入 MCP 设计与实现，但应继续使用现有 `ToolRegistry` 作为唯一执行入口，不要在 MCP 代码里重复实现审批、超时、取消、结果限制或 telemetry。

当前 worktree 尚未创建 commit，也未推送远程。工作区包含本阶段所有改动以及用户此前允许保留的 Tools 相关改动；接手时先阅读 `git status`，不要 reset、stash 或覆盖未归档变更。

并行开发服务位于另一个 worktree：

```text
/home/xcodd/code/chalk_/.worktree/chalkboard-v1
```

不要在 MCP 阶段重启、停止或修改该服务的进程和文件。

## 2. 当前目录结构

```text
apps/api/src/agent/tools/read/
├── read-resource.ts          # Agent 可见的统一 read_resource facade
├── read-uploaded-file.ts     # 旧 attachmentId 形状的兼容 wrapper
└── uploaded-file-reader.ts   # MinIO/S3 上传文本 adapter
```

Agent 只应看到一个公共 Read 工具：`read_resource`。当前注册的资源类型是：

```ts
{ resource: { kind: 'upload', id: '<attachment-id>' } }
```

未来知识库、Web 和 MCP Resource 应增加 `ResourceReadAdapter`，不要增加 `read_knowledge_document`、`read_web_page` 或 `read_mcp_resource` 等新的 Agent 可见工具。

## 3. Read 当前契约

统一 facade 定义在：

```text
apps/api/src/agent/tools/read/read-resource.ts
```

核心接口：

- `ResourceReference`：`{ kind, id }`
- `ResourceReadAdapter`：声明唯一 `kind`，实现 `read(request)`
- `ResourceReader`：根据资源 kind 路由到 adapter
- `createResourceReader(adapters)`：拒绝重复 kind
- `createReadResourceTool(reader, cursorSecret)`：创建 `read_resource`

Read 支持：

- 按完整行返回文本；单次 `maxBytes` 为 1,024–32,768 字节。
- MinIO/S3 Range 分段读取，不整对象加载。
- 签名 opaque cursor，绑定 owner、conversation、resource、snapshot、下一字节/行号和过期时间。
- 文件 size/etag/mtime 变化时返回 `read_snapshot_changed`。
- owner、conversation、未登录和非文本文件 fail closed。
- 如果本次 Range 不能消费任何完整行，不生成原地踏步 cursor，而是返回 `read_line_too_large`。

稳定错误码包括：

```text
read_cursor_invalid
read_cursor_expired
read_snapshot_changed
read_access_denied
read_unsupported_media_type
read_unsupported_resource
read_line_too_large
```

## 4. Runtime/MCP 不能绕过的能力

`packages/agent-runtime/src/tools/tool-registry.ts` 当前集中负责：

- Tool 定义校验
- 默认/最大超时
- 文本结果和增量更新大小限制
- AbortSignal 取消传播
- 结构化错误和 `ToolErrorChannel`
- 强制审批和无 ApprovalPort 时 fail closed
- `sequential` / `parallel` 受控执行以及 sequential barrier

MCP 工具通过 `packages/agent-runtime/src/mcp/mcp-manager.ts` 转成 `RuntimeTool`，再进入相同 registry。MCP 实现不要直接把 Pi tool 注入 runtime。

当前 MCP baseline 已有：

- stdio、SSE、Streamable HTTP 三种 transport
- connect/call timeout
- 远端工具发现和 proxy tool
- read-only MCP tool：`read + network`、免审批、可并行
- 非只读 MCP tool：`write + network`、强制审批、串行
- remote tool 名称前缀：`mcp__<server>__<tool>`
- URL 只允许 HTTP/HTTPS，禁止 URL 内嵌用户名密码

这些行为已有 runtime/MCP 单测，继续扩展 MCP 时不要静默改变审批和执行模式。

## 5. 已完成验证

在 `tools-foundation` worktree 使用复制的 `.env` 完成：

- Agent runtime 单测：34/34
- API 单测：28/28
- API 集成测试：32/32
- 真实 MinIO Read 集成测试：2/2
- 全量 TypeScript typecheck：通过
- API build：通过
- ESLint：通过
- `git diff --check`：通过

测试命令和对象存储隔离规则见：

[docs/runbooks/tools-testing.md](../runbooks/tools-testing.md)

全部 API 集成测试 runner 会使用独立 `TEST_DATABASE_URL`。MinIO Read 测试使用 `read-test/<uuid>.txt` 唯一 key，结束时删除对象和测试用户。

## 6. MCP 阶段建议顺序

### A. 先确认 MCP 资源与工具的边界

MCP tool 和 MCP resource 不是同一个概念：

- MCP tool：远端可调用动作，继续作为 `source: 'mcp'` 的 RuntimeTool。
- MCP resource：远端可读取内容，应通过 `ResourceReadAdapter(kind: 'mcp_resource')` 接入统一 `read_resource`，而不是创建单独的 Read tool。

### B. 先补 MCP 安全契约

重点确认：

- server 配置 owner 校验和 fail closed
- stdio command/args 的允许范围与环境变量传递
- SSE/HTTP URL、重定向、DNS/IP 访问策略
- MCP server 返回的 tool name、description、input schema 是否需要长度和 schema 校验
- server 返回的文本、图片、resource 内容如何套用平台结果限制
- MCP server 断连、重连、连接竞态和关闭时资源释放
- 远端工具的审批、并行模式和网络 effect 不能由模型或用户设置降低

### C. 再做 MCP Resource adapter

建议 adapter 至少定义：

```ts
kind: 'mcp_resource'
resource: { kind: 'mcp_resource', id: '<server-id>/<resource-uri>' }
```

cursor snapshot 必须能检测远端资源版本或 ETag；如果 Provider 没有稳定版本，必须明确采用短 TTL 或每次重新读取，不能伪造 snapshot 稳定性。

### D. 最后补真实 MCP 集成测试

至少覆盖：

- stdio server 启动、发现、调用、关闭
- 慢 server 的 connect/call timeout
- server 返回超长文本的结果预算
- 非只读 tool 强制审批
- 多 server 同名工具的稳定命名和冲突处理
- MCP resource 通过统一 `read_resource` 分页续读
- server 断连后的状态和错误分类

## 7. 已知边界与不要误判的事项

- Read 当前只支持会话上传文本；PDF、图片、知识库和 Web 正文尚未接入。
- 通用 continuation 类型还没有移动到 `packages/agent-runtime`；当前 cursor 逻辑位于 API Read facade，后续跨资源扩展时再评估抽到共享 package。
- `read_uploaded_file` 只作为兼容 wrapper 保留，不应重新加入公开 `/tools`。
- `run_subagent` 当前是内部能力，默认关闭且不进入公开设置清单。
- 结果截断和 continuation 是两种不同机制：截断不自动提供继续读取能力。
- 不要把 MCP 返回的 resource 内容直接当作可信文本；仍需做来源、权限、大小、媒体类型和错误处理。

## 8. 推荐接手检查

```bash
cd /home/xcodd/code/chalk_/.worktree/tools-foundation
git status --short
pnpm test:unit
pnpm typecheck
pnpm --filter @chalk/api test:integration
```

如果需要验证 MinIO Read：

```bash
set -a
source .env
set +a
pnpm --filter @chalk/api exec vitest run tests/integration/read-resource-storage.test.ts
```

不要把 `.env` 内容复制到交接文档、提交、日志或 telemetry 中。
