# Worktree 开发手册

> 文档状态：Accepted
> 实施状态：Partial
> 适用范围：主 workspace；不含 `agents/`
> 最后核验：2026-08-22

## 1. 核心规则

一个 Git worktree 是一个独立的代码和运行环境。只要会修改数据库、session、对象存储或运行集成测试，就必须隔离：

- Compose project；
- Postgres 实例或数据库；
- Postgres 宿主端口；
- MinIO volume、API 端口和 Console 端口；
- API 和 Web 端口；
- `SESSIONS_ROOT`；
- E2E 数据库和测试产物。

只修改文档、纯前端样式或不访问基础设施的纯 TypeScript 逻辑时，可以不启动完整服务。

## 2. 当前能力与限制

`docker-compose.yml` 已支持通过以下变量隔离 Compose 栈：

- `COMPOSE_PROJECT_NAME`：容器、网络和 volume；
- `POSTGRES_HOST_PORT`：Postgres 宿主端口；
- `MINIO_HOST_PORT` 和 `MINIO_CONSOLE_HOST_PORT`：MinIO 宿主端口；
- `POSTGRES_USER`、`POSTGRES_PASSWORD` 和 `POSTGRES_DB`：可选的 Postgres 初始化配置；
- `S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` 和 bucket 变量：MinIO 初始化配置。

API 已读取 `API_PORT`，Web 的开发和启动命令已读取 `WEB_PORT`。因此多个 worktree 可以并行运行，但每个活动 worktree 必须自行选择唯一端口、project name 和存储路径，并先通过 `pnpm env:check`。该检查验证单个 worktree 配置内部的一致性，不负责证明端口或路径没有被其他进程占用。

默认端口仍是 Postgres `5432`、MinIO `9000/9001`、API `3001` 和 Web `3000`。只运行一个栈时可以使用默认值；并行运行必须显式配置，并且不要通过停止来源不明的容器抢占端口。

## 3. 创建 worktree

从最新主分支创建一个语义清晰的分支和 worktree：

```bash
git fetch origin
git worktree add .worktree/<short-name> -b feat/<short-name> origin/main
git worktree list
```

如果分支已经存在：

```bash
git worktree add .worktree/<short-name> feat/<short-name>
```

不要在两个 worktree 中检出同一个分支。不要把 `.worktree/` 中的依赖、构建产物或 `.env` 提交到 Git。

## 4. 环境标识

每个需要运行服务的 worktree 选择唯一、稳定的短标识，例如：

```text
main
agent-hardening
chalkboard-v1
```

需要运行服务的环境变量契约：

```text
COMPOSE_PROJECT_NAME=chalk-<id>
POSTGRES_HOST_PORT=<unique>
MINIO_HOST_PORT=<unique>
MINIO_CONSOLE_HOST_PORT=<unique>
API_PORT=<unique>
WEB_PORT=<unique>
DATABASE_URL=postgresql://chalk:chalk@127.0.0.1:<postgres-port>/chalk
WEB_ORIGIN=http://127.0.0.1:<web-port>
NEXT_PUBLIC_API_URL=http://127.0.0.1:<api-port>
SESSIONS_ROOT=<worktree-local-absolute-or-stable-relative-path>
TEST_DATABASE_URL=postgresql://chalk:chalk@127.0.0.1:<postgres-port>/chalk_<id>_test
E2E_DATABASE_URL=postgresql://chalk:chalk@127.0.0.1:<postgres-port>/chalk_<id>_e2e
```

以 `.env.example` 为模板创建每个 worktree 自己的 `.env`，不要复制另一个活动 worktree 的端口、数据库名或 session 路径。`.env` 不提交到 Git。

## 5. 是否需要独立基础设施

| 变更类型 | 独立 Postgres | 独立 MinIO | 独立 session | 独立 API/Web |
|---|---:|---:|---:|---:|
| 文档 | 否 | 否 | 否 | 否 |
| 纯 UI/CSS | 否 | 否 | 否 | 按需 |
| 纯函数/类型 | 否 | 否 | 否 | 否 |
| API route/service | 是 | 视功能 | 是 | 是 |
| DAL/schema/migration | 是 | 否 | 视功能 | 按需 |
| 上传/对象存储 | 是 | 是 | 否 | 是 |
| Agent session/runtime | 是 | 视工具 | 是 | 是 |
| Integration/E2E | 是 | 视测试 | 是 | 是 |

“独立 Postgres”优先表示独立 Compose project 和 volume。仅创建同一实例中的另一个数据库不能隔离 Postgres 版本、扩展和实例级配置，但可以作为较轻量的测试方案。

## 6. 启动前检查

启动服务前执行：

```bash
git status --short --branch
git worktree list
docker compose ps -a
pnpm env:check
pnpm infra:config
```

确认：

- 当前工作目录是目标 worktree；
- `.env` 属于当前 worktree，未被 Git 跟踪；
- `DATABASE_URL` 不指向生产或其他开发者数据库；
- `SESSIONS_ROOT` 不与另一个正在运行的 worktree 共用；
- 配置的端口没有被另一个 Chalk worktree 或进程使用；
- migration history 与当前分支匹配。

## 7. 数据库规则

- 修改 schema 或运行 migration 的 worktree 必须使用独立数据库。
- 不同 migration history 的分支禁止共享数据库。
- 从另一个分支复制数据库 dump 后，先核对该 dump 的 migration ledger，再启动应用。
- feature 分支合并前基于最新主分支重新验证 migration，不通过修改已应用 migration 解决冲突。
- E2E 数据库名称必须明确包含 `_e2e`，集成测试数据库包含 `_test`。

详细流程见 [database-development.md](database-development.md)。

## 8. Session 与对象存储

JSONL session 只允许一个进程写入。两个 API 进程不得共用同一个 `SESSIONS_ROOT`，即使它们连接不同数据库。

MinIO volume 默认由 Compose project 隔离。并行 worktree 不共用可变测试 bucket；确需共享只读 fixture 时，应使用显式只读导入过程，而不是共享 volume。

## 9. 停止和删除

停止当前 worktree 的服务：

```bash
docker compose -p <verified-project-name> down
```

不要默认加 `-v`。删除 volume 会永久删除该 worktree 的数据库和 MinIO 数据，只有明确确认无需恢复时才能执行：

```bash
docker compose -p <verified-project-name> down -v
```

删除 worktree 前先确认工作区和未跟踪文件：

```bash
git -C .worktree/<short-name> status --short --branch
git worktree remove .worktree/<short-name>
```

不得使用 `git clean -fd` 或其他命令清理用途不明确的数据。

## 10. 当前自动化与剩余缺口

当前已提供：

```text
pnpm env:check      # 校验 project name、端口、URL 和必要存储变量
pnpm infra:config   # 校验环境并验证 Compose 配置
pnpm infra:up       # 校验环境并启动当前 worktree 的 Compose 栈
pnpm infra:down     # 校验环境并停止当前 worktree 的 Compose 栈
pnpm db:migrate     # 对 DATABASE_URL 指向的数据库运行 migration
pnpm dev            # 启动应用开发进程
```

尚未自动化的部分包括：跨 worktree 的端口/路径占用检测、为新 worktree 自动分配配置、完整应用栈生命周期和 E2E 环境编排。因此 `pnpm dev` 前仍需人工确认当前 `.env` 属于当前 worktree；不要把 `env:check` 当成跨进程锁。
