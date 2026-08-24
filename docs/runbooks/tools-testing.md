# Agent Tools 测试手册

> 文档状态：Accepted
> 实施状态：Partial
> 适用范围：`packages/agent-runtime`、`apps/api/src/agent/tools`
> 最后核验：2026-08-24

## 1. 测试层次

Tools 测试分为三层：

- 单元测试：验证 runtime 契约、`read_resource` facade、cursor 和 adapter 边界，不访问数据库或对象存储。
- API 集成测试：使用独立 `TEST_DATABASE_URL`，验证 API 装配、审批、MCP 和聊天边界。
- MinIO 集成测试：使用 `.env` 中的 S3 配置写入唯一对象前缀 `read-test/<uuid>.txt`，通过真实 Range 请求验证 Read 分页和 snapshot 变化；测试结束删除对象和测试数据库用户。

测试不得使用并行开发 worktree 的开发数据库或固定对象 key。

## 2. 常用命令

在 Tools worktree 根目录执行：

```bash
pnpm --filter @chalk/api test:unit
pnpm --filter @chalk/agent-runtime typecheck
pnpm --filter @chalk/api typecheck
pnpm --filter @chalk/api build
```

API 集成测试 runner 会自动读取 worktree 根目录的 `.env`，创建并迁移符合命名规则的测试库，然后运行全部集成测试：

```bash
pnpm --filter @chalk/api test:integration
```

只运行真实 MinIO Read 测试时，需要先将 `.env` 导出到当前 shell：

```bash
set -a
source .env
set +a
pnpm --filter @chalk/api exec drizzle-kit migrate
pnpm --filter @chalk/api exec vitest run tests/integration/read-resource-storage.test.ts
```

## 3. MinIO 测试前提

必须配置以下变量，但文档和日志不得输出它们的值：

- `S3_ENDPOINT`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET_UPLOADS`
- `CREDENTIAL_ENCRYPTION_KEY`
- `TEST_DATABASE_URL`

如果未配置 S3 变量，MinIO 集成测试会跳过；如果变量已配置但对象存储不可访问，测试应失败并修复环境，而不是改成 mock。

## 4. Read 测试重点

- Agent 只调用 `read_resource`，资源类型通过 `{ kind, id }` 路由到 adapter。
- 第一页返回 opaque cursor，下一页只能原样交回 cursor。
- cursor 绑定 owner、conversation、resource、snapshot、字节位置和过期时间。
- Range 不能造成原地踏步 cursor，也不能在 EOF 后发起无效读取。
- 对象 size/etag/mtime 变化时必须返回 `read_snapshot_changed`。
- owner、conversation、未登录和非文本文件必须 fail closed。

新增资源 adapter 时，先补 adapter 单测，再补 facade 路由测试；如果 adapter 使用外部 Provider，再补对应的真实集成测试。不要为每种资源新增一个 Agent 可见的 `read_xxx` 工具。
