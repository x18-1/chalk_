# Chalk

Chalk 是一个面向小学、初中学生的交互式 AI 学习平台。它的目标不是简单地“回答一道题”，而是帮助学生理解一类题目的思路、掌握一个知识点，并持续沉淀学习过程与学习证据。

项目当前以数学为第一学科，提供两种互补的学习入口：

- **Chat（自学）**：学生可以输入题目、概念或上传题目图片，与 Agent 进行可追问的讲解；
- **Chalkboard（上课）**：系统围绕教学目标组织课堂内容、互动活动和多角色讨论，按 Scene → Action 的顺序播放。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 学习型 Chat | 题目讲解、思路来源、分层提示、题型与知识点识别，以及可选的 Chalkboard 学习建议 |
| Chalkboard 课堂 | 渐进式课堂生成、Scene/Action 播放、课堂草稿、发布后的 Classroom Artifact 和可恢复学习会话 |
| 多 Agent 讨论 | 使用 LangGraph 编排课堂 Director、参与 Agent、等待学生和结束条件 |
| 数学与几何 | Geometry Agent 生成受控 GeoGebra 命令，由 TypeScript 宿主逐条执行并返回结构化诊断 |
| 长期学习记录 | 学习会话、测验作答、学习证据、分层记忆和受限的记忆 consolidation worker |
| Agent 平台 | 统一 Tools、Skills、Subagent 和 MCP 接入，带参数校验、审批、超时、取消和结果预算 |
| 知识库 RAG | 文档上传、异步索引、LightRAG 混合检索、重排序和“答案来自哪些资料”的结构化引用 |
| 模型与媒体 | 可配置的 LLM、图片、视频、TTS/ASR Provider；用户凭据加密保存并按 owner 隔离 |

## 系统架构

```text
┌──────────────────────────────┐
│ Next.js / React Web           │
│ Chat · Chalkboard · 知识库      │
└──────────────┬───────────────┘
               │ HTTP / SSE
┌──────────────▼───────────────┐
│ TypeScript API (Fastify)      │
│ Auth · Owner DAL · Agent      │
│ Tools · Sessions · Uploads    │
└──────┬──────────┬────────────┘
       │          │
       │          ├───────────────┐
       │          │               │
┌──────▼─────┐ ┌──▼────────────┐ ┌▼────────────────────┐
│ Postgres +  │ │ pi-agent-core│ │ Python LightRAG      │
│ Drizzle     │ │ LangGraph    │ │ retrieval sidecar    │
└─────────────┘ └───────────────┘ │ parse · chunk ·      │
                                  │ index · query · cite │
                                  └─────────────────────┘
```

TypeScript API 是业务、认证和授权边界；Python 只负责 LightRAG 原生索引与在线检索，不读取 Chalk 用户数据，也不自行决定 owner 权限。浏览器不会直接调用 sidecar。

## 技术栈

- **Web**：Next.js App Router、React、React Markdown、KaTeX
- **业务 API**：TypeScript、Fastify、Zod、Drizzle ORM
- **Agent**：`@earendil-works/pi-agent-core`、`pi-ai`、TypeBox；课堂讨论使用锁定版本的 LangGraph.js
- **数据与存储**：Postgres、MinIO/S3、JSONL session transcript
- **RAG**：Python 3.11–3.13、FastAPI、LightRAG、MinerU/MarkItDown/text-only parser
- **测试与质量**：Vitest、Playwright、TypeScript、ESLint、GitHub Actions
- **几何**：GeoGebra Classic；几何 DSL 和命令执行由 TypeScript 校验

## 快速开始

### Docker（推荐体验完整链路）

```bash
cp .env.example .env
```

编辑 `.env`，至少配置 `RAG_SIDECAR_TOKEN`、LLM、Embedding、Rerank 凭据和
`CREDENTIAL_ENCRYPTION_KEY`，然后执行：

```bash
docker compose -f docker-compose.deploy.yml up -d --build
```

默认地址：

- Web：<http://localhost:3000>
- API 健康检查：<http://localhost:3001/health>
- MinIO 控制台：<http://localhost:9001>

完整的生产配置、对象存储、更新、停止和备份说明见
[Docker 部署运行手册](docs/runbooks/docker-deployment.md)。

### 本地开发

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d postgres minio minio-init
pnpm db:migrate
pnpm dev
```

如果需要使用知识库，还需按 [RAG MVP 运行手册](docs/runbooks/rag-mvp.md) 启动 Python sidecar，并在 `.env` 中配置对应模型和解析器。首次使用可在设置页配置模型 Provider，或使用开发账号登录：

```text
admin@qq.com / admin123
```

## 常用命令

```bash
pnpm lint                 # ESLint
pnpm typecheck            # TypeScript 类型检查
pnpm test:unit            # 单元测试
pnpm test:integration     # API 集成测试
pnpm test:e2e:chalkboard  # Chalkboard 浏览器测试
pnpm build                # 构建所有 workspace
```

运行测试前请为测试数据库设置独立的 `TEST_DATABASE_URL`，不要使用开发数据库。

## 仓库结构

```text
apps/
├── api/                  # Fastify API、Agent 装配、DAL、Provider、迁移
├── web/                  # Next.js 产品界面
└── rag-sidecar/          # Python LightRAG 在线检索服务
packages/
├── agent-runtime/        # 通用 Agent、Tools、Skills、MCP、Subagent runtime
└── chalkboard/           # Chalkboard Scene/Action schema 与播放运行时
agents/
└── geometry-agent/       # 数学几何 Agent 与 GeoGebra 适配
docs/                     # 架构决策、规格、运行手册和调研资料
evals/                    # Chalkboard 等系统评测脚本与数据集
tests/                    # Playwright 端到端测试
```
