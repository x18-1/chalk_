# Worktree 开发手册

> 文档状态：Accepted
> 实施状态：Partial
> 适用范围：主 workspace；不含 `agents/`
> 最后核验：2026-08-30

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
WEB_ORIGIN=http://localhost:<web-port>,http://127.0.0.1:<web-port>
NEXT_PUBLIC_API_URL=http://localhost:<api-port>
SESSIONS_ROOT=<unique-path>
```

不要复制另一个 worktree 的 `.env`。`.env` 不提交到 Git，也不要把密钥写入代码、文档或日志。

## 3. 启动服务

### 3.1 每次启动都按这个顺序执行

以下命令必须从目标 worktree 根目录执行。`<name>`、端口和 Compose project 必须替换成当前
worktree 的值；不要在主 workspace 和另一个 worktree 之间交叉执行。

```bash
cd /home/xcodd/code/chalk_/.worktree/<name>
git status --short --branch

# 第一次创建 worktree 时执行；已有 .env 时不要覆盖
test -f .env || cp .env.example .env

# 首次创建 worktree 或 lockfile 变化时执行
pnpm install --frozen-lockfile
# 首次启动或修改 packages/agent-runtime 后执行
pnpm --filter @chalk/agent-runtime build
pnpm env:check
pnpm infra:config
pnpm infra:up
docker compose ps

# Drizzle CLI 不会自动加载 worktree 根目录的 .env
set -a
source .env
set +a
pnpm db:migrate

# 保持这个终端运行；另开终端执行测试或查看日志
pnpm dev
```

启动成功的最小检查：

```bash
curl -fsS "http://127.0.0.1:<api-port>/health"
```

浏览器使用 `.env` 中 `WEB_ORIGIN` 的地址打开，不要混用 `localhost` 和 `127.0.0.1`。如果需要用
另一种本地回环地址，必须同时把它加入 `WEB_ORIGIN`（逗号分隔），并让前端 API 与页面使用同一
主机名；不要依赖浏览器对回环别名的兼容行为。API CORS 始终以 `WEB_ORIGIN` 为准。

当前 `chat-inline-blackboard` worktree 的已核验配置是：

| 服务 | 地址 |
|---|---|
| Web | `http://localhost:3202` 或 `http://127.0.0.1:3202` |
| API | `http://localhost:3201` 或 `http://127.0.0.1:3201` |
| PostgreSQL | `127.0.0.1:5643` |
| MinIO API | `http://127.0.0.1:9200` |
| MinIO Console | `http://127.0.0.1:9201` |

不要在 `pnpm dev` 运行时执行 `pnpm build`。两者会共用 `apps/web/.next`，并行执行可能导致开发
页面出现 `Cannot find module './<chunk>.js'`；需要构建时先停止 dev，构建结束后再按本节重启。

`pnpm infra:up` 只启动 PostgreSQL 和 MinIO 等基础设施；API 和 Web 由 `pnpm dev` 作为本机进程运行。

全新 worktree 尚未生成 `packages/agent-runtime/dist`，而 API 开发进程会从 workspace package
的 `dist/index.js` 加载运行时，因此首次启动前必须执行一次 Agent Runtime build。修改
`packages/agent-runtime` 后也要重新 build，直到仓库提供统一的 workspace watch 编排。

Drizzle CLI 从 `apps/api` 启动，不会自动读取 worktree 根目录 `.env`。执行 `db:generate`、
`db:migrate` 或 `db:studio` 前，必须在当前 shell 显式导出 `.env`；不能因为 URL 缺失而改用
其他 worktree 的数据库连接。

每个 Compose project 会有自己的容器、网络和 volume。测试数据库通常只是 PostgreSQL 容器里的另一个 database，不需要再创建一个 Docker 容器。

### 3.2 `.env` 与 Provider 凭据

`.env.example` 只包含空的凭据占位符；`.env` 是本地 ignored 文件，不能提交，也不能写入 runbook。
新 worktree 应从 `.env.example` 开始，只迁移自己有权限使用的凭据值，不要整份复制另一个 worktree
的 `.env`，因为其中还包含端口、数据库、session 路径和 Compose project。

至少确认以下变量已配置：

| 变量 | 用途 | 规则 |
|---|---|---|
| `DEEPSEEK_API_KEY` 或其他 LLM key | Chat/Agent 模型 | 未配置时只能使用已保存到数据库的 Provider 凭据 |
| `CREDENTIAL_ENCRYPTION_KEY` | 加密 Settings 中保存的 Provider key | 必须是 64 位十六进制；已有数据库不可随意更换 |
| `ARK_API_KEY`、`TTS_OPENAI_API_KEY`、`ASR_OPENAI_API_KEY` 等 | 图片、视频、TTS、ASR | 按需配置；专用变量优先，缺失时按 `.env.example` 规则回退 |

若 `CREDENTIAL_ENCRYPTION_KEY` 缺失，登录仍可能成功，但在 Settings 保存 API key 时会返回 500：

```text
CREDENTIAL_ENCRYPTION_KEY env var is not set
```

可以生成新的 key：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

只有在该数据库还没有需要解密的历史凭据时才生成新 key；已有凭据必须继续使用原 key。启动后可在
Settings 页面检查 Provider 列表，再发送一条最小 Chat 消息验证实际模型调用。

## 4. 测试

- 单元测试不需要数据库。
- 集成测试使用 `TEST_DATABASE_URL`，不能使用 `DATABASE_URL`。
- `pnpm test:integration` 会在测试数据库不存在时创建它并执行 migration。
- 当前 runner 不会自动删除测试数据库，测试数据由测试自己清理。
- E2E 连接地址使用 `E2E_WEB_URL` 和 `E2E_API_URL`；E2E 专用数据库流程尚未统一实现。

## 5. 停止和删除

停止本机 API/Web：在运行 `pnpm dev` 的终端按 `Ctrl-C`。

停止当前 worktree 的基础设施：

```bash
pnpm infra:down
```

不要随便执行 `docker compose down -v`，它会删除数据库和 MinIO volume。不要停止来源不明的容器，也不要使用 `git clean -fd` 清理数据。

## 6. 登录失败排查

看到“暂时无法连接 Chalk”或登录后又回到登录页时，按顺序执行：

1. 确认浏览器地址是当前 worktree 的 `WEB_ORIGIN`，API 端口与 `NEXT_PUBLIC_API_URL` 一致。
2. 检查 API：

   ```bash
   curl -fsS "http://127.0.0.1:<api-port>/health"
   ```

3. 检查 CORS（把 `<web-origin>` 替换为浏览器地址）：

   ```bash
   curl -i -H "Origin: <web-origin>" "http://127.0.0.1:<api-port>/auth/session"
   ```

   响应必须包含匹配的 `Access-Control-Allow-Origin` 和
   `Access-Control-Allow-Credentials: true`。

4. 如果登录接口返回 200 但随后跳回登录页，优先检查是否混用了 `localhost` 与 `127.0.0.1`，以及
   `WEB_ORIGIN` 是否包含该来源。修正 `.env` 后必须重启 `pnpm dev`。
5. 若出现“邮箱或密码不正确”，确认非 production 环境的 `DEV_USER_EMAIL`/
   `DEV_USER_PASSWORD`，并检查 API 日志是否真的收到 `POST /auth/login`。

不要通过关闭 Cookie、移除 `credentials: include` 或放宽为 `origin: *` 来绕过登录问题；这会破坏
认证边界。

删除 worktree 前：

```bash
(cd .worktree/<name> && pnpm infra:down)
git -C .worktree/<name> status --short --branch
git worktree remove .worktree/<name>
```

## 7. AI 修改边界

- 不修改或覆盖其他 worktree 的文件、`.env`、数据库和 session。
- 不在没有确认 `DATABASE_URL` 的情况下运行 migration。
- 不修改已经在共享数据库应用过的 migration；修正问题时生成新的 migration。
- 不删除数据库、Docker volume、session 或对象存储数据，除非用户明确要求。
