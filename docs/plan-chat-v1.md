# Chat v1 实现计划（全量 Agent Harness）

> 状态：定稿，使用 JSONL session 存储方案；Web/API 已按前后端分离落地
> 范围：完整 Chat 功能 + 成熟 Agent Harness：session、memory、tools、MCP、skills、全 LLM 供应商、human-in-loop、鉴权、可观测性。  
> Session 存储：JSONL 文件（单实例部署 + 持久化磁盘；暂不考虑多实例和 NFS）
> 不含：几何渲染、Chalkboard 主线、题型识别、worker 任务队列。

---

## 1. 仓库结构

```
chalk_/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
├── docker-compose.yml           # Postgres + MinIO + optional OTEL collector
├── packages/
│   ├── agent-runtime/           # pi-agent-core 封装：providers/tools/skills/MCP/telemetry
│   └── chalkboard/              # OpenMAIC 迁移后的课堂能力（本版只建 seam，不实现主线）
├── apps/
│   ├── web/                     # Next.js 15 App Router（纯前端）
│   └── api/                     # Fastify（独立后端 API）
│       ├── src/db/              # Drizzle schema、DAL、迁移
│       ├── src/agent/           # API 侧 runtime composition / adapters
│       └── src/modules/         # auth、chat、settings、MCP、uploads、telemetry 路由
├── tests/                       # 跨应用 e2e；各 app/package 的 unit/integration tests 独立存放
└── data/
    └── sessions/                # JSONL session 文件存储目录（.gitignore）
```

本版不实现 Chalkboard 主线；几何 Agent、课程图、证据和评测代码在需要时先作为 `apps/api` 的内部模块或仓库根目录 `eval/` 加入，不为它们分别创建 workspace package。

---

## 2. apps/api/src/db

### 2.1 Schema（9 张表）

**auth_* 表**（由 `@auth/drizzle-adapter` 自动管理）

```
auth_users         id(uuid) email password_hash name image created_at
auth_accounts      provider_account_id user_id provider type
auth_sessions      session_token user_id expires
auth_verification_tokens  identifier token expires
```

**业务表**

```
conversations
  id            uuid PK
  user_id       uuid NOT NULL → auth_users.id
  title         text
  session_id    text NOT NULL              -- pi-agent-core session id
  session_file_path text NOT NULL          -- JSONL 文件路径（例如 data/sessions/2024-08-abc123.jsonl）
  session_backend text DEFAULT 'jsonl'     -- 'jsonl' | 'postgres'（为未来迁移预留）
  created_at    timestamptz DEFAULT now()
  updated_at    timestamptz DEFAULT now()

mcp_servers
  id            uuid PK
  user_id       uuid NOT NULL → auth_users.id
  name          text NOT NULL
  transport     text NOT NULL          -- "stdio" | "sse" | "http"
  command       text                   -- stdio: 命令
  args          jsonb                  -- stdio: 参数数组
  url           text                   -- sse/http: URL
  env           jsonb                  -- 环境变量
  enabled       boolean DEFAULT true
  created_at    timestamptz DEFAULT now()

custom_providers
  id            uuid PK
  user_id       uuid NOT NULL → auth_users.id
  name          text NOT NULL
  base_url      text NOT NULL
  api_key_enc   text                   -- AES-256-GCM 加密存储
  api           text NOT NULL DEFAULT 'openai-completions'
  model_ids     jsonb                  -- 该 provider 下的 model id 列表
  enabled       boolean DEFAULT true
  created_at    timestamptz DEFAULT now()

provider_credentials
  id            uuid PK
  user_id       uuid NOT NULL → auth_users.id
  provider_id   text NOT NULL          -- pi-ai 的 provider id，如 "anthropic"
  api_key_enc   text                   -- AES-256-GCM 加密存储
  created_at    timestamptz DEFAULT now()
  updated_at    timestamptz DEFAULT now()
  UNIQUE(user_id, provider_id)

tool_approvals                         -- HIL 工具审批，跨进程持久化
  id            uuid PK
  conversation_id uuid NOT NULL → conversations.id
  tool_call_id  text NOT NULL
  tool_name     text NOT NULL
  args          jsonb NOT NULL
  status        text NOT NULL DEFAULT 'pending'  -- pending | approved | rejected
  decided_at    timestamptz
  created_at    timestamptz DEFAULT now()
```

**不需要 pi-agent-core session 表** — session 完整状态存储在 JSONL 文件中，由 `JsonlSessionRepo` 管理。

**JSONL Session 文件结构示例：**

```jsonl
{"kind":"header","version":4,"id":"abc123","createdAt":1691234567890,"cwd":"/workspace"}
{"kind":"entry","lane":"main","entry":{"id":"msg_001","type":"message","message":{"role":"user","content":[{"type":"text","text":"你好"}]},"timestamp":1691234568000}}
{"kind":"entry","lane":"main","entry":{"id":"msg_002","type":"message","message":{"role":"assistant","content":[{"type":"text","text":"你好！有什么可以帮你的吗？"}]},"timestamp":1691234569000}}
{"kind":"record","record":{"type":"operation_started","seq":1,"lane":"main","intent":{"kind":"run","originalPrompt":[...],"initialMessages":[...]},"timestamp":1691234568000}}
{"kind":"record","record":{"type":"operation_finished","seq":2,"lane":"main","runId":"run_001","outcome":"completed","timestamp":1691234570000}}
{"kind":"lane","seq":3,"lane":"main","leafId":"msg_002"}
```

文件存储在 `data/sessions/` 目录。文件名和 cwd 子目录由 `JsonlSessionRepo` 管理，应用只保存 repo 返回的 metadata/path，不自行拼接路径。

### 2.2 数据访问层原则

- 所有业务查询函数接受 `userId: string` 第一参数，在 SQL 层联表或条件校验 owner
- 找不到 + userId 有值 → throw `OwnershipError`
- userId 缺失 → throw `AuthRequiredError`
- 无任何"猜 owner"或 guest 回退

---

## 3. packages/agent-runtime

### 3.1 目录结构

```
src/
  providers/
    registry.ts        createModels() + 应用注入 CredentialStore
    custom-openai.ts   自定义 OpenAI 兼容：createProvider() + baseUrl
  tools/
    registry.ts        AgentTool[] 注册表（领域工具由应用 adapter 注入）
  skills/
    loader.ts          loadSkills / loadSourcedSkills 封装
    registry.ts        Skill[] 注册表（运行时热重载）
  mcp/
    client.ts          @modelcontextprotocol/sdk StdioClient / SSEClient
    adapter.ts         McpTool → AgentTool 转换
    manager.ts         应用注入的 MCP 配置 → 连接池
  session/
    manager.ts         接收注入的 SessionRepo，负责 create / open / recover
    recovery.ts        进程重启后的 session 恢复逻辑
    types.ts           Session 相关类型定义
  harness/
    factory.ts         AgentHarness.create() 工厂
    human-in-loop.ts   steer / followUp / abort；通过审批 port 挂起
    hooks.ts           beforeToolCall（调用审批 port）/ afterToolCall
    compaction.ts      shouldCompact / compact 策略
  telemetry/
    schema.ts          Chalk 教学语义事件 defineTelemetrySchema
    bridge.ts          pi-telemetry span → OpenTelemetry exporter
    context.ts         InMemoryTelemetryContext，per-request
  stream/
    fn.ts              StreamFn（Models.streamSimple + per-request apiKey）
    sse.ts             AgentEvent → SSE encoder
  index.ts             公开 API
```

DrizzleCredentialStore、AES-256-GCM 凭据加密和 DB-backed 审批 adapter 属于 `apps/api/src/agent` 与 `apps/api/src/db`，不进入通用 Agent runtime。Agent runtime 通过注入的 CredentialStore、审批 port 和资源配置工作。

### 3.2 LLM 供应商接入

pi-ai 内置了 **30+ 供应商**的完整 model catalog（`MODELS` 常量），不需要手动列举。接入方式：

```
createModels({ credentials: appCredentialStore })
  ↓  自动发现所有内置 Provider（Anthropic、OpenAI、Azure、Bedrock、Google、
     Gemini Vertex、Mistral、DeepSeek、Groq、Cerebras、OpenRouter、
     xAI、NVIDIA、Fireworks、Together、Qwen、Moonshot…）
  ↓  models.refresh() 拉取 dynamic provider 的模型列表
  ↓  models.getAvailable() 返回已配置了 API key 的供应商下的模型
```

**API key 来源（双轨）**：
1. 环境变量（`.env`）：pi-ai 内置 provider 默认读取对应 env（`ANTHROPIC_API_KEY` 等），`AuthContext.env()` 从 `process.env` 读取
2. Web UI 配置：用户在 Chat 侧栏的设置弹窗填写 API key → Web 调用 `apps/api` → API 加密存入 `provider_credentials` 表 → 注入 `CredentialStore` → `models.getAuth()` 优先走 credential store，再 fallback 到 env

**自定义 OpenAI 兼容供应商**（中转站 / 本地模型）：
- 存入 `custom_providers` 表（`base_url` + 加密 `api_key_enc` + `model_ids` + `api` 字段）
- 每次对话开始时 `models.setProvider(createProvider({ baseUrl, auth, models, api: openAICompletionsStreams }))`
- 动态注册，不需要重启

### 3.3 Tools 架构

每个工具实现 `AgentTool<TSchema, TDetails>`：
- `label` + TypeBox `parameters` schema → 自动生成 tool card
- `execute(toolCallId, params, signal, onUpdate, ctx)` — ctx 含 userId + sessionId
- `executionMode: "sequential" | "parallel"`

Tool 参数 schema 使用 TypeBox，因为这是 `pi-agent-core` / `pi-ai` 的原生边界。Chalkboard、learning/evidence 和 API contract 使用 Zod；工具执行时先通过 TypeBox 校验 LLM 参数，再转换为 Chalk command 并通过 Zod 校验后进入领域逻辑。不要为同一个领域对象在两种库中各维护一份 schema。

`beforeToolCall` hook：
- 检查工具白名单（per-user 配置）
- Human-in-loop 模式下暂停，等前端 `/chat/:id/approve` 接口确认
- 审计结果通过应用注入的 audit port 持久化

`afterToolCall` hook：
- 敏感工具结果脱敏再写入上下文
- 写 pi-telemetry span

### 3.4 Skills

- `loadSkills(env, [skillsDir, userSkillsDir])` 在 harness 初始化时调用
- Skill 列表通过 `/skills` 接口暴露给前端
- Chat 侧栏的设置弹窗展示所有已加载 skill + 来源路径 + `disableModelInvocation` 状态
- 运行时可 `setResources({ skills })` 热更新（不需要重建 harness）

### 3.5 MCP 接入

```
用户在 Chat 侧栏的设置弹窗配置 MCP 服务器（Web 调用 API）
         ↓
对话开始时，API 读取该用户的 enabled mcp_servers 并注入 runtime
         ↓
按 transport 创建 StdioClient / SSEClient
         ↓
listTools() → 每个 MCP tool 转为 AgentTool（adapter.ts）
         ↓
注入 AgentHarness.setResources({ tools: [...builtinTools, ...mcpTools] })
```

连接池：同一 user + 同一 server config，复用 client 实例，对话结束时 close。

### 3.6 Human-in-Loop

三种模式，通过 harness 钩子实现：

| 模式 | 机制 | 触发 |
|---|---|---|
| **工具审批** | `beforeToolCall` 查 `tool_approvals` 表，pending 则挂起；SSE 推 `tool_pending` | 高危工具 or 用户开启审批模式 |
| **实时引导** | `agent.steer(message)` 注入正在运行的会话 | 前端 POST `/steer` |
| **中止重来** | `agent.abort()` + 重建 prompt | 前端 POST `/abort` |

审批流程：
1. `beforeToolCall` → 调用应用的 approval port，写入 `tool_approvals(status=pending)` → 返回 Promise 挂起（不 block）
2. SSE 推 `tool_pending` 事件到前端
3. 前端展示 `PendingApprovalBar`，用户点 Approve/Reject
4. `/chat/:id/approve` → API DAL 更新 `tool_approvals.status` + 唤醒挂起的 Promise
5. 进程重启时，`beforeToolCall` 检查 DB 状态；pending 超时自动 reject（fail closed）

### 3.7 可观测性

**pi-telemetry 层**（`packages/agent-runtime/telemetry/`）：
- 每个 Agent run 开启 `startHarnessSpan` + `startAiSpan`
- Chalk 自定义语义事件 schema：`chat_start` / `tool_invoked` / `tool_approved` / `hint_ladder_level` / `mcp_call` / `stream_token_count`
- `InMemoryTelemetryContext` per-request，run 结束后 flush 到 OTEL exporter

**OpenTelemetry 层**：
- `@opentelemetry/sdk-node` 安装在 `apps/api`
- 默认 exporter：OTLP HTTP（可对接 Jaeger / OTEL Collector）
- 同时保留内存快照 → `/telemetry/spans` 给 UI 用

**前端可观测性页** `/observability`：
- 最近 N 条 span（trace-id / duration / token-count / tool-calls）
- 每个会话的 token 成本
- 模型/供应商分布

---

## 4. apps/api 与 apps/web

### 4.1 认证

- `apps/api` 提供 email + bcrypt 登录，并在 `auth_sessions` 保存 hash 后的 opaque token
- session 通过 HttpOnly、SameSite cookie 返回；Web 不接触 token 内容
- Dev 启动时 seed 一个固定账号（`dev@chalk.local` / `chalk-dev-2026`），无开放注册
- API 每个业务 route 都调用 `AuthModule.requireUser()`，认证失败 fail closed
- Web 的 `AuthBoundary` 调用 `/auth/session`，401 跳转 `/login`；这只是 UX 守卫，不能替代 API 鉴权

### 4.2 API 路由清单

以下路径以独立 `apps/api` 的 origin 为准。Web 端保留 `/api/...` 的逻辑前缀，浏览器客户端会将其转换为 `NEXT_PUBLIC_API_URL` 下的对应路径；API 本身不依赖 Next.js 路由。

```
GET    /health                       服务健康检查

POST   /auth/login                    创建 HttpOnly session cookie
GET    /auth/session                  当前用户（无 session 返回 user=null）
POST   /auth/logout                   删除当前 session

GET    /chat                          列出对话（分页）
POST   /chat                          创建对话，返回 {conversation}

GET    /chat/:id                       对话元数据
PATCH  /chat/:id                       重命名对话
DELETE /chat/:id                       删除对话及其 JSONL session

GET    /chat/:id/messages              历史消息列表
POST   /chat/:id/stream                用户消息 → SSE 流（AgentEvent）
POST   /chat/:id/abort                 中止当前 run
POST   /chat/:id/steer                 注入引导消息（需有活跃 run）
POST   /chat/:id/approve               审批/拒绝挂起的工具调用

GET    /providers                      内置/自定义供应商及默认模型
PUT    /providers/:providerId/credential  保存供应商 API key（加密入库）
DELETE /providers/:providerId/credential  删除供应商 API key
GET    /providers/custom               自定义供应商列表
POST   /providers/custom               添加自定义供应商
PATCH  /providers/custom/:id           更新自定义供应商
DELETE /providers/custom/:id            删除自定义供应商
GET    /models                         可用模型列表
POST   /models                         刷新模型目录
GET    /settings                       当前 Agent 设置
PUT    /settings/model                 设置默认模型

GET    /skills                         已加载 Skill 及诊断信息
PATCH  /skills                         启用/停用 Skill
GET    /tools                          工具及审批策略
PATCH  /tools                          更新工具设置

GET    /mcp                            MCP 服务器列表
POST   /mcp                            添加 MCP 服务器
GET    /mcp/:id                        MCP 服务器详情
PATCH  /mcp/:id                        更新 MCP 服务器
DELETE /mcp/:id                        删除 MCP 服务器
POST   /mcp/:id/test                   测试 MCP 连接

GET    /telemetry/spans                最近 span（用于 observability 页）
POST   /uploads/presign                获取对象存储直传 URL
POST   /uploads/confirm                确认对象已上传
```

### 4.3 SSE 流协议

`POST /chat/:id/stream` body: `{ message: string, model?: { providerId: string, modelId: string }, attachmentIds?: string[] }`

返回 `text/event-stream`，事件类型：

```
event: agent_start
event: text_delta       data: { delta: string }
event: thinking_delta   data: { delta: string }
event: tool_start       data: { toolCallId, toolName, args }
event: tool_update      data: { toolCallId, partialResult }
event: tool_end         data: { toolCallId, result, isError }
event: tool_pending     data: { toolCallId, toolName }   # HIL 等待审批
event: queue_update     data: { steer: n, followUp: n }
event: agent_end        data: { usage: { input, output, cost } }
event: error            data: { message: string }
```

### 4.4 前端页面结构

```
/login                     登录页
/(app)
  /                        → redirect /chat
  /chat                    当前对话页（没有 id 时创建/选择对话）
  /chats                   全部对话列表
  /chalkboard              Chalkboard 工作区
    ChatLayout
    ├── Sidebar
    │   ├── ConversationList（历史，按日期分组）
    │   └── BottomNav（Settings / Observability 入口）
    └── ChatWindow
        ├── ModelSelector（供应商 + 模型下拉）
        ├── MessageList
        │   └── Message（user | assistant）
        │       ├── MarkdownContent（KaTeX 行内/块级渲染）
        │       ├── ThinkingBlock（折叠的 thinking）
        │       └── ToolCallCard（tool_start→end 状态机）
        ├── PendingApprovalBar（HIL 等待中时展示）
        ├── StreamingIndicator
        └── InputBar
            ├── Textarea（Shift+Enter 换行，Enter 发送）
            ├── AbortButton（流式中显示）
            └── SteerButton（流式中：注入引导）

  Chat 侧栏用户菜单 → 设置弹窗
    API / Skills / MCP / Tools 配置面板

  /observability（后续）   Span 列表 + token 成本图表
```

### 4.5 Zustand Store

```typescript
interface ChatStore {
  conversations: ConversationMeta[]
  activeId: string | null
  messages: Record<string, Message[]>
  // 流式状态
  streaming: {
    conversationId: string
    textDelta: string
    thinkingDelta: string
    activeTools: ToolCallState[]
    pendingApprovals: PendingTool[]
  } | null
}
```

---

## 5. 环境变量（.env.example）

```
# Database（业务数据：用户、对话元数据、工具审批等）
DATABASE_URL=postgresql://chalk:chalk@localhost:5432/chalk

# 独立 API 服务与 Web 来源
API_HOST=127.0.0.1
API_PORT=3001
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3001

# Session 存储（单实例 + 持久化磁盘；只存 Pi 对话 JSONL）
SESSIONS_ROOT=./data/sessions  # 相对于 apps/api 工作目录

# Auth（生产环境必须启用 HTTPS cookie）
SESSION_COOKIE_SECURE=false

# LLM Providers — 可在 .env 配置，也可在设置弹窗填写
# Web UI 配置优先；env 作为 fallback
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
MISTRAL_API_KEY=
# Azure / Bedrock / Vertex 等按 pi-ai 规范配置对应 env

# Encryption key for API key storage in DB (AES-256-GCM, hex 32 bytes)
# 生成：node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CREDENTIAL_ENCRYPTION_KEY=

# OpenTelemetry（可选，不填则只用内存 span 快照）
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Dev seed account（仅在 NODE_ENV=development 时自动创建）
DEV_USER_EMAIL=dev@chalk.local
DEV_USER_PASSWORD=chalk-dev-2026

# Skills directories (colon-separated paths)
SKILLS_DIRS=./skills

# S3 / OSS（对象存储）
# 开发：MinIO 本地（http://localhost:9000）
# 生产：阿里云 OSS（设置 endpoint 为阿里云地域，例如 oss-cn-hangzhou.aliyuncs.com）
S3_ENDPOINT=http://localhost:9000  # 开发用 MinIO；生产用阿里云 OSS endpoint
S3_REGION=us-east-1                # 开发用；生产改为 oss-cn-hangzhou
S3_ACCESS_KEY_ID=chalk             # 生产用阿里云 AccessKey ID
S3_SECRET_ACCESS_KEY=chalk-minio-secret  # 生产用阿里云 AccessKey Secret
S3_BUCKET_UPLOADS=chalk-uploads    # 用户上传文件（开发 MinIO bucket；生产 OSS bucket）
S3_BUCKET_BACKUPS=chalk-backups    # 备份文件
S3_PUBLIC_URL=                     # 可选：仅在明确配置私有 CDN/访问策略时填写
```

---

## 6. docker-compose.yml（开发用）

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: chalk
      POSTGRES_PASSWORD: chalk
      POSTGRES_DB: chalk
    ports: ["5432:5432"]
    volumes: [postgres_data:/var/lib/postgresql/data]

  # MinIO（S3 兼容对象存储，开发用）
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: chalk
      MINIO_ROOT_PASSWORD: chalk-minio-secret
    ports:
      - "9000:9000"   # S3 API
      - "9001:9001"   # Web Console
    volumes: [minio_data:/data]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 5

  # MinIO 初始化（创建 buckets）
  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set myminio http://minio:9000 chalk chalk-minio-secret;
      mc mb myminio/chalk-uploads --ignore-existing;
      mc mb myminio/chalk-backups --ignore-existing;
      mc anonymous set download myminio/chalk-uploads;
      exit 0;
      "

  # 可选：OTEL Collector
  # otel-collector:
  #   image: otel/opentelemetry-collector-contrib:latest
  #   ports: ["4318:4318"]
  #   volumes: [./otel-config.yaml:/etc/otel-config.yaml]
  #   command: ["--config=/etc/otel-config.yaml"]

volumes:
  postgres_data:
  minio_data:
```

---

## 7. 里程碑

| # | 内容 | 产出 |
|---|---|---|
| **M1** | Monorepo 骨架：pnpm workspace + tsconfig + ESLint/Prettier + docker-compose | 空但能跑 `pnpm install` |
| **M2** | `apps/api/src/db`：业务 schema（不含 pi session 表）+ 迁移 + DAL；API 实现 `DrizzleCredentialStore` | `pnpm db:migrate` 跑通 |
| **M3** | `apps/api` Auth：Fastify + opaque cookie session + dev seed；Web 登录页调用 API | 能登录、能填 key |
| **M4** | `packages/agent-runtime` session：接收注入的 `SessionRepo` + 进程重启恢复逻辑 + `createModels()` + credential store 联通；Web 组合 `JsonlSessionRepo` | 终端可跑 agent loop + session 落 JSONL |
| **M5** | `agent-runtime` harness + StreamFn 桥 + compaction | harness 可运行 |
| **M6** | `apps/api` 流式 API + `apps/web` Chat UI（输入→流→KaTeX） | 端到端跑通 |
| **M7** | Skills loader + `/settings/skills` 页 + skill 注入 system prompt | Skill 可见、可用 |
| **M8** | MCP manager + adapter + `/settings/mcp` 配置页 | MCP tool 出现在对话中 |
| **M9** | Human-in-loop：`beforeToolCall` 审批 + `/approve` + `steer` + `abort` | 高危工具可拦截 |
| **M10** | 可观测性：pi-telemetry + OTEL bridge + `/observability` 页 | span 可见、token 成本可查 |
| **M11** | 自定义供应商 CRUD + 加密存储 + 运行时动态注册 | 中转站 URL 可用 |
| **M12** | 端到端验收：登录→建对话→多轮→skills→MCP tool→abort→历史回看 | 功能完整可演示 |

---

## 8. 关键技术决策（已定）

### Session 持久化：JSONL 文件方案

**核心决策**：使用 pi-agent-core 内置的 `JsonlSessionRepo`，session 存储为 JSONL 文件。第一版只支持单实例服务和持久化本地磁盘，不考虑多实例共享文件系统或 NFS。

**存储架构**：
- JSONL 文件根目录：`data/sessions/`；具体路径由 `JsonlSessionRepo` 生成
- Postgres 存业务元数据：`conversations` 表存 `session_file_path` 映射
- 每个 JSONL 文件包含完整 session 状态：header + mutations（entries、records、lanes）

**进程重启恢复机制**：
```typescript
// 1. 从 Postgres 查文件路径
const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, convId) });

// 2. 只使用服务端保存的映射定位 metadata，客户端不能提交文件路径
const metadata = (await repo.list({ cwd: SESSION_CWD })).find(
  (item) => item.id === conv.sessionId && item.path === conv.sessionFilePath,
);
if (!metadata) throw new SessionNotFoundError(conv.sessionId);

// 3. JsonlSessionRepo 打开文件并重放 mutation
const session = await repo.open(metadata);

// 4. 恢复 entries、lanes、stats、compaction history，创建 harness 后继续对话
```

**优势**：
- ✅ 无需自建 session 持久化格式，直接使用 pi-agent-core 官方实现
- ✅ 全功能支持（branch、compaction、lane、thinking）
- ✅ 直接适配当前的单实例部署
- ✅ 调试友好（`cat session.jsonl` 直接查看）
- ✅ 备份简单（复制 `data/sessions/` 目录）

**部署前提**：服务进程只有一个 session writer，`SESSIONS_ROOT` 位于持久化磁盘；JSONL 文件不提交 Git，也不放在临时容器文件系统中。

**未来迁移路径**：
- 如果将来需要多实例、跨节点写入或 SQL 级全文检索，再实现 Postgres `SessionRepo` adapter；由 `apps/api` 的 composition root 注入，不放进 `agent-runtime`。

**代码隔离设计**：
```typescript
// agent-runtime 只依赖 pi 的 SessionRepo 接口
export function createAgentRuntime(options: { sessionRepo: SessionRepo }) {
  return new AgentRuntime(options);
}

// apps/api 的 composition root 选择当前 adapter
const nodeEnv = new NodeExecutionEnv({ cwd: process.cwd() });
const sessionRepo = new JsonlSessionRepo({
  fs: nodeEnv,
  sessionsRoot: process.env.SESSIONS_ROOT ?? './data/sessions',
});
const runtime = createAgentRuntime({ sessionRepo });

// 测试使用 pi-agent-core 的 InMemorySessionRepo
```

**恢复验证清单**：
- [ ] 进程重启后，打开历史对话，消息完整显示
- [ ] 进程重启后，继续发消息，agent 能看到之前的上下文
- [ ] Branch 功能：点"编辑重新生成"，生成新分支，原分支保留
- [ ] Compaction：对话超过 100 轮，自动总结前 80 轮
- [x] Thinking 持久化：刷新页面后，thinking blocks 仍可展开
- [ ] 工具审批：进程重启时有 pending 审批，启动后自动 reject（超时 1 分钟）

---

### 其他技术决策

- **LLM 供应商**：`createModels()` 加载 pi-ai 内置所有 30+ provider；API adapter 实现 `CredentialStore` 接口，API key 加密存 `provider_credentials` 表，Web UI 和 env 双轨，credential store 优先。
- **Schema 边界**：Chalkboard、learning/evidence 和 API contract 使用 Zod；pi AgentTool 的 `parameters` 使用 TypeBox。工具参数经 TypeBox 校验并转换为领域 command，再经 Zod 校验。
- **自定义 OpenAI 兼容**：`createProvider({ baseUrl, api: openai-completions })` 动态注册；配置存 `custom_providers` 表，加密 `api_key_enc`。
- **HIL 工具审批**：`tool_approvals` 表持久化审批状态；进程重启后 pending 超时 → reject（fail closed）。
- **MCP**：`@modelcontextprotocol/sdk`，工具映射为 `AgentTool`，连接池 per user-session。
- **Thinking**：`AgentState.thinkingLevel` 可前端切换；`ThinkingBlock` 折叠展示。
- **KaTeX**：remark-math + rehype-katex（成熟方案，处理 edge case）。
- **模型切换**：`AgentHarness.setStreamOptions({ model })` 动态切换，不重建 harness。
- **加密方案**：Node.js 内置 `crypto` AES-256-GCM，key 来自 `CREDENTIAL_ENCRYPTION_KEY` env，每条记录随机 IV。

---

### S3/OSS 文件存储策略

**存储分类：**

| 文件类型 | 存储位置 | 原因 |
|---------|---------|------|
| 用户上传（图片、PDF、附件） | OSS `chalk-uploads` bucket | CDN 加速、跨地域访问、永久保存 |
| Agent 生成的 Artifacts（>1MB） | OSS `chalk-uploads` bucket | 避免 Postgres 膨胀 |
| 小型 Artifacts（<100KB） | Postgres JSONB | 减少 OSS 请求，加速渲染 |
| **Session JSONL 文件** | **本地持久化文件系统 `data/sessions/`** | **每轮追加写入，避免 OSS 网络延迟；第一版仅单实例访问** |
| 每日备份 | OSS `chalk-backups` bucket | 长期归档，便宜 |

**开发环境：** MinIO（S3 兼容，本地 Docker）  
**生产环境：** 阿里云 OSS + CDN

**为什么 Session 不放 OSS？**
- 每条消息都需要追加写入 JSONL，OSS 网络延迟会拖慢对话速度
- 本地磁盘写入 ~1ms，OSS 写入 ~20-50ms
- Session 文件不需要跨地域访问（只有后端服务读写）
- 备份时会打包整个 `data/sessions/` 上传到 OSS，不会丢失

**当前部署方案：**
- 单实例服务：本地持久化磁盘 `data/sessions/`
- 多实例、NFS 和共享文件系统：暂不在本版范围内；未来需要时切换到数据库 SessionRepo adapter

**上传流程：**
```typescript
// 1. 前端获取预签名 URL
const { uploadUrl, attachmentId } = await fetch('/api/uploads/presign', {
  method: 'POST',
  body: JSON.stringify({ conversationId, filename: 'problem.png', contentType: 'image/png', size: file.size }),
});

// 2. 前端直传 OSS（不经过后端，节省带宽）
await fetch(uploadUrl, { method: 'PUT', body: file });

// 3. 前端通知后端文件已上传
await fetch('/api/uploads/confirm', {
  method: 'POST',
  body: JSON.stringify({ attachmentId }),
});
```

**OSS 客户端：** `@aws-sdk/client-s3`（兼容阿里云 OSS）+ `@aws-sdk/s3-request-presigner`

**阿里云 OSS 配置示例（生产环境）：**
```bash
S3_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
S3_REGION=oss-cn-hangzhou
S3_ACCESS_KEY_ID=<你的 AccessKey ID>
S3_SECRET_ACCESS_KEY=<你的 AccessKey Secret>
S3_BUCKET_UPLOADS=chalk-uploads
S3_PUBLIC_URL=https://cdn.chalk.com  # 阿里云 CDN 域名
```

---

### 备份策略

```bash
#!/bin/bash
# backup.sh - 每日定时备份（crontab: 0 2 * * *）

DATE=$(date +%F)

# 1. Postgres dump（业务数据）
pg_dump chalk_db > /tmp/postgres-$DATE.sql

# 2. 打包 sessions 目录（JSONL 文件）
tar -czf /tmp/sessions-$DATE.tar.gz ./data/sessions

# 3. 合并打包
tar -czf /tmp/chalk-backup-$DATE.tar.gz \
  /tmp/postgres-$DATE.sql \
  /tmp/sessions-$DATE.tar.gz

# 4. 上传到阿里云 OSS（使用 ossutil 或 AWS SDK）
# 开发环境：上传到 MinIO
# mc cp /tmp/chalk-backup-$DATE.tar.gz myminio/chalk-backups/

# 生产环境：上传到阿里云 OSS
# ossutil cp /tmp/chalk-backup-$DATE.tar.gz oss://chalk-backups/backups/$DATE/
# 或使用 AWS SDK（兼容 OSS）：
# aws s3 cp /tmp/chalk-backup-$DATE.tar.gz s3://chalk-backups/backups/$DATE/ \
#   --endpoint-url https://oss-cn-hangzhou.aliyuncs.com

# 5. 清理本地临时文件
rm /tmp/postgres-$DATE.sql /tmp/sessions-$DATE.tar.gz /tmp/chalk-backup-$DATE.tar.gz

# 6. 清理 30 天前的远程备份
# ossutil rm oss://chalk-backups/backups/$(date -d '30 days ago' +%F)/ -r

echo "Backup completed: chalk-backup-$DATE.tar.gz"
```

**恢复流程：**
```bash
# 1. 从 OSS 下载备份
# ossutil cp oss://chalk-backups/backups/2024-08-11/chalk-backup-2024-08-11.tar.gz ./

# 2. 解压
tar -xzf chalk-backup-2024-08-11.tar.gz

# 3. 恢复 Postgres
psql chalk_db < postgres-2024-08-11.sql

# 4. 恢复 sessions 目录
tar -xzf sessions-2024-08-11.tar.gz -C ./data/

# 5. 重启服务
# systemctl restart chalk-web
```

**备份频率：**
- 每日备份：2:00 AM（用户活跃度最低）
- 保留策略：本地保留 7 天，OSS 保留 30 天
- 成本估算：每日备份 ~100MB，30 天 = 3GB，阿里云 OSS 标准存储 ~¥0.36/月
