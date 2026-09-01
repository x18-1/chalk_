# 仓库与模块边界

> 文档状态：Accepted
> 实施状态：Partial
> 适用范围：`apps/`、`packages/`、根级测试与运行配置；不含 `agents/`
> 最后核验：2026-08-31

## 1. 目标结构

```text
apps/
├── api/                  # Fastify 后端部署单元和组合根
├── web/                  # Next.js 前端部署单元
└── rag-sidecar/          # Python LightRAG 内部部署单元；不属于 pnpm workspace package

packages/
├── agent-runtime/        # 通用 Agent 执行、MCP、session 与 telemetry 能力
└── chalkboard/           # 可复用课件、播放、渲染和交互模块

tests/e2e/                # 跨 Web/API 的浏览器测试
```

`agents/` 是新 Agent 能力的独立开发和验证目录，不属于主 pnpm workspace，也不纳入本文的根级构建、测试和 package 边界治理。

## 2. 依赖方向

允许的默认依赖方向：

```text
apps/web  ──HTTP/SSE──> apps/api
apps/api  ────────────> packages/agent-runtime
apps/api  ────────────> packages/chalkboard
apps/web  ────────────> packages/chalkboard 的浏览器入口（需要时）
apps/api  ──internal HTTP──> apps/rag-sidecar（LightRAG query/index）

packages/chalkboard ──> packages/agent-runtime 的稳定公共接口（仅有真实需要时）
```

禁止：

```text
packages/* ──X──> apps/*
packages/agent-runtime ──X──> packages/chalkboard
apps/web ──X──> Drizzle / Postgres / Fastify / 服务端凭据
循环 package 依赖
apps/rag-sidecar ──X──> apps/api 源码（只能使用版本化内部协议）
```

`apps/*` 是部署单元和组合根，可以选择具体 adapter。`packages/*` 是可复用模块，只能通过稳定接口接收应用依赖，不能导入应用内部文件。

## 3. 各模块职责

### `apps/api`

负责：

- HTTP/SSE 接口、认证、授权和错误映射；
- 业务用例编排和事务；
- Postgres、Drizzle、DAL 和 migration；
- 用户凭据、owner 校验和产品权限策略；
- `pi-ai` LLM Provider、模型目录、自定义 Provider 和模型选择的应用级装配；
- Agent runtime 的应用级装配与生命周期；
- Chalk 产品 Prompt 的集中资产、双语镜像、装配、revision 和 provenance；
- S3/MinIO、外部 Provider 配置及其他基础设施 adapter。

不负责提供可被其他 workspace 模块导入的通用业务实现。确有两个真实调用方时，再把稳定接口下沉到 package。

### `apps/web`

负责：

- 页面、浏览器状态、表单和交互；
- HTTP/SSE 客户端；
- 加载、错误、空状态和可访问性；
- 浏览器侧 Chalkboard 展示。

不负责：

- 数据库访问和 owner 校验；
- 保存 API key 或业务密钥；
- 复制后端业务规则；
- 从模型自然语言文本猜测本应结构化的系统状态。

### `packages/agent-runtime`

负责通用 Agent 执行能力，包括 Pi Agent runtime、工具接口、MCP 协议适配、session 接口、compaction 和运行 telemetry。它使用调用方注入的 Pi LLM 能力和已装配的 system Prompt，不负责 Chalk 产品 Prompt、模型目录装配、用户模型选择或 Provider 配置。

它不知道 Chalk 的 Fastify route、Drizzle schema、用户表、产品权限或对象存储。应用能力通过接口注入，例如已装配的 Pi LLM 能力、approval port、session repository 和工具集合。

### `packages/chalkboard`

负责可复用的课件模型、解析和校验、播放、渲染、交互及其内部确定性逻辑。它可以被 API、Web 或未来 worker 使用，但不能依赖任何 `apps/*` 路径。

当 Node 和浏览器入口产生真实差异时，优先通过 package subpath exports 隔离，例如：

```text
@chalk/chalkboard/core
@chalk/chalkboard/compiler
@chalk/chalkboard/runtime
@chalk/chalkboard/react
```

在接口稳定和真实调用方出现前，不为目录整齐提前拆分新 package。

## 4. 导入规则

- App 内部可以使用相对路径或该 app 自己约定的 alias，但不能通过源码路径导入另一个 app。
- Package 调用方只从 package 的 `exports` 入口导入，不依赖其 `src/internal`。
- Package 内部实现默认不导出；只有调用方确实需要的接口进入公开入口。
- 数据库表类型不得成为 `packages/*` 的公开接口。
- Fastify、Next.js、Drizzle 和供应商 SDK 类型不得泄露到与其无关的模块接口。
- 产品 Prompt 的文件与 loader 留在 `apps/api/src/prompts/`；package 只接收稳定接口参数，不导入
  Prompt 资产或 API 源码路径。具体双语和例外规则见 [Prompt 管理规范](./prompts.md)。

## 5. 当前状态

当前符合项：

- pnpm workspace 只包含 `apps/*` 和 `packages/*`；
- `packages/*` 未导入 `apps/*`；
- Web 通过 HTTP/SSE 调用独立 API；
- API 组合 `@chalk/agent-runtime`，产品凭据 adapter 位于 API；
- Pi `ModelCatalog`、Provider 创建和模型选择已位于 `apps/api/src/providers/llm/`，runtime 只接收 API 注入的已解析 LLM 能力；
- `agents/` 已处于 workspace 之外。

当前缺口：

- 主分支的 `@chalk/chalkboard` 仍接近空接口，另一 worktree 中存在大规模迁移实现，合并前需要先审查公开接口；
- package 入口目前尚未统一区分 Node 与浏览器子路径；
- 尚无自动化 dependency-boundary 检查，当前主要依靠评审和 TypeScript 构建。
