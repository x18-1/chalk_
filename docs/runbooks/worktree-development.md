# Worktree 开发手册

> 文档状态：Accepted
> 实施状态：Partial
> 适用范围：主 workspace；不含 `agents/`
> 最后核验：2026-08-24

## 1. 先记住这几条

- 一个正在运行的 worktree 使用自己的一份 `.env`。
- 不同 worktree 不共用端口、开发数据库、测试数据库或 `SESSIONS_ROOT`。
- 只改文档、样式或纯函数时，不需要启动 Docker。
- 运行数据库、对象存储或集成测试时，先确认当前终端位于正确的 worktree。

## 2. 创建和配置 worktree

```bash
git fetch origin
git worktree add .worktree/<name> -b feat/<name> origin/main
cd .worktree/<name>
cp .env.example .env
```

每个 worktree 的 `.env` 至少要修改这些值：

```text
COMPOSE_PROJECT_NAME=chalk-<unique-name>
POSTGRES_HOST_PORT=<unique-port>
MINIO_HOST_PORT=<unique-port>
MINIO_CONSOLE_HOST_PORT=<unique-port>
API_PORT=<unique-port>
WEB_PORT=<unique-port>
DATABASE_URL=postgresql://chalk:chalk@127.0.0.1:<postgres-port>/chalk
TEST_DATABASE_URL=postgresql://chalk:chalk@127.0.0.1:<postgres-port>/chalk_<name>_test
WEB_ORIGIN=http://127.0.0.1:<web-port>
NEXT_PUBLIC_API_URL=http://127.0.0.1:<api-port>
SESSIONS_ROOT=<unique-path>
```

不要复制另一个 worktree 的 `.env`。`.env` 不提交到 Git，也不要把密钥写入代码、文档或日志。

## 3. 启动服务

在当前 worktree 根目录执行：

```bash
pnpm env:check
pnpm infra:up
pnpm db:migrate
pnpm dev
```

`pnpm infra:up` 只启动 PostgreSQL 和 MinIO 等基础设施；API 和 Web 由 `pnpm dev` 作为本机进程运行。

每个 Compose project 会有自己的容器、网络和 volume。测试数据库通常只是 PostgreSQL 容器里的另一个 database，不需要再创建一个 Docker 容器。

## 4. 测试

- 单元测试不需要数据库。
- 集成测试使用 `TEST_DATABASE_URL`，不能使用 `DATABASE_URL`。
- `pnpm test:integration` 会在测试数据库不存在时创建它并执行 migration。
- 当前 runner 不会自动删除测试数据库，测试数据由测试自己清理。
- E2E 连接地址使用 `E2E_WEB_URL` 和 `E2E_API_URL`；E2E 专用数据库流程尚未统一实现。

## 5. 停止和删除

停止当前 worktree 的基础设施：

```bash
pnpm infra:down
```

不要随便执行 `docker compose down -v`，它会删除数据库和 MinIO volume。不要停止来源不明的容器，也不要使用 `git clean -fd` 清理数据。

删除 worktree 前：

```bash
(cd .worktree/<name> && pnpm infra:down)
git -C .worktree/<name> status --short --branch
git worktree remove .worktree/<name>
```

## 6. AI 修改边界

- 不修改或覆盖其他 worktree 的文件、`.env`、数据库和 session。
- 不在没有确认 `DATABASE_URL` 的情况下运行 migration。
- 不修改已经在共享数据库应用过的 migration；修正问题时生成新的 migration。
- 不删除数据库、Docker volume、session 或对象存储数据，除非用户明确要求。
