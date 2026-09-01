# Chalk 技术栈

> 文档状态：Draft
> 最后核验：2026-08-31
> 说明：技术方向仍可迭代；`AGENTS.md` 已确认约束和 [Accepted 架构文档](../README.md) 优先。
> 配套：[功能定义](../spec/functional-spec.md)

## 1. 总原则

1. **Chalk 业务后端全 TypeScript。** 认证、业务编排、Agent、DSL 校验、几何、证据账本和数据访问全部在 TS 一侧。LightRAG 是明确的基础设施例外，不改变业务后端的语言边界。
2. **LightRAG 使用独立 Python 在线 retrieval sidecar。** Python 只实现 LightRAG 的索引与原生查询，不承载 Chalk 业务、认证或 owner 授权；TypeScript API 先完成授权、配额和审计，再通过受控内部接口调用。见第 10 节和 [ADR 0003](../adr/0003-python-lightrag-retrieval-sidecar.md)。
3. **确定性引擎决定「能不能过」，LLM 决定「怎么表达」。** 掌握判定、几何校验、结构 lint 全部是确定性代码，LLM 不持有否决权。
4. **eval 与功能同期建设。** 系统产出质量（讲解、判题、几何构造）不靠人工抽查。

## 2. 已定选型

| 层 | 选择 | 说明 |
|---|---|---|
| 语言 | **TypeScript + Python LightRAG sidecar** | Chalk 业务和 DSL 仍为 TypeScript；Python 仅承载 LightRAG 原生索引/查询实现 |
| Agent 运行时 | **pi-agent-core**；课堂多 Agent 讨论使用 **LangGraph.js** | 见第 3 节与 [ADR 0001](../adr/0001-langgraph-for-classroom-discussion.md) |
| 前端 | Next.js（App Router）+ React | 只负责页面、浏览器状态和 HTTP/SSE 客户端，不承载业务 API |
| 后端 API | Fastify + TypeScript | 独立进程和部署单元；认证、业务 API、Agent 装配、SSE、上传和数据库访问集中在此 |
| 客户端状态 | Zustand | |
| 课堂播放运行时 | `@chalk/chalkboard` TypeScript runtime | V3 已使用 `Scene -> Action` 游标、播放/暂停与 Discussion bridge；目前不引入 XState |
| 数据库 | Postgres + Drizzle | 证据表 append-only；课件 JSONB；课程图关系表 |
| 任务队列 | pg-boss（或 Graphile Worker） | 课件编译是分钟级任务。用 Postgres 省掉 Redis |
| 数学插件的几何渲染 / 交互 | **GeoGebra Classic** | Geometry Agent 默认输出受控命令脚本；TypeScript 宿主逐条执行并报告命令级错误，GeoGebra 原生维护 Slider 与依赖更新 |
| 数学插件的几何约束层 | **GeoGebra 原生 + 自建校验** | 脚本 schema、保留名称、依赖和安全校验在 TS；不绑定渲染器对象模型 |
| 数学排版 | KaTeX | 题目 Markdown/数学文本在展示层渲染 |
| 校验 | **Zod + TypeBox** | Chalk 业务结构、DSL、API 使用 Zod；pi 的 `AgentTool.parameters` 使用 TypeBox。业务 schema 是主来源，工具边界通过明确 adapter 对接。LightRAG sidecar 的跨语言协议由 Zod 生成 JSON Schema，Python 侧使用对应的 Pydantic 模型 |
| 测试 | Vitest + Playwright + LLM eval | 见第 6 节 |
| 观测 | pi-telemetry + OpenTelemetry | 见第 5 节 |

### Schema 边界

项目使用两种校验工具，但职责不重叠：

- **Zod** 是 Chalk 业务结构的主 schema：课程课件 DSL、几何 DSL、学习证据、API 输入输出和持久化业务对象都用 Zod 定义。
- **TypeBox** 只用于 pi AgentTool 边界：`AgentTool.parameters` 直接使用 TypeBox schema，避免在 Agent runtime 内增加转换层。
- 当一个工具要调用 Chalk 业务逻辑时，边界按以下顺序处理：

```text
LLM tool arguments
    ↓ TypeBox 校验
工具参数 → Chalk command
    ↓ Zod 校验
业务逻辑 / 数据库写入
```

同一个业务结构不在两边手写两份。TypeBox schema 只描述 LLM 可调用的工具参数；业务对象仍以 Zod schema 为准。

### 明确不选

| | 原因 |
|---|---|
| fork OpenMAIC | 核心对象不同（它以 `Stage` 为中心，我们以学习者与证据为中心）；Chalk 只对固定参考提交的 Scene/Action 、生成链路和讨论能力做有边界迁移。PPTX/MP4 导出、PBL v2、Partners 等都不需要 |
| 直接生成渲染器代码 | 模型难以稳定表达几何约束；Geometry Agent 统一输出 GeoGebra 命令并由宿主逐条执行 |
| Python 做主后端 | 跨语言边界会切入 Chalk 业务主链路；DSL 校验器会被迫写两遍。**不允许 Python 承载 Chalk 业务后端；仅允许 LightRAG 独立 sidecar 例外** |

## 3. Agent 运行时：pi-agent 与课堂讨论 LangGraph

`@earendil-works/pi-agent-core` `0.84.1`（2026-08-07），仓库 `github.com/earendil-works/pi`。同版本号下成套：`pi-ai`（统一 LLM 层，内置 OpenAI/Anthropic/Google/Mistral/Bedrock）、`pi-telemetry`、`pi-coding-agent`、`pi-tui`、`pi-protocol`、`pi-client`、`pi-storage-sqlite-node`、`gondolin`（Alpine 沙箱）。

### 直接可用

| 能力 | 形式 |
|---|---|
| Agent 循环 | `Agent` + 注入 `StreamFn` |
| Tools | `AgentTool` |
| 权限门 | `beforeToolCall` —— 框架强制经过，不靠调用方自觉 |
| 配额 / 审计 | `afterToolCall` |
| **Skills** | 原生 `loadSkills(env, dirs)`：递归加载 `SKILL.md`、frontmatter 解析、ignore 文件、结构化诊断。`loadSourcedSkills` 支持来源标记 |
| 观测 | `pi-telemetry`：`defineTelemetrySchema` 类型化 span、`AI_TELEMETRY_SCHEMA` / `HARNESS_TELEMETRY_SCHEMA` |
| 上下文管理 | 自动 compaction（`shouldCompact` / `findCutPoint` / `estimateContextTokens`）、session 管理与搜索、branch summarization |

模型层可绕开：注入自己的 `StreamFn`，pi 只需要一个 metadata 占位模型对象，多供应商路由仍由我们自己控制。

### 课堂多 Agent 讨论例外

Chalkboard 的在线多角色讨论使用锁定版本的 TypeScript LangGraph，把 Director 选择、参与 Agent
发言、等待学生和结束条件表达成显式状态图。该例外只属于课堂讨论模块：通用 Chat、Tools、Skills、
审批和子 Agent 仍由 `pi-agent-core` 承担。LangGraph 节点不直接装配 OpenAI、Anthropic 等
LangChain Provider；它们通过一个薄的 Chalk adapter 复用 `@earendil-works/pi-ai` 的用户模型目录、
凭据和模型选择。PostgreSQL 中 owner-scoped Discussion Session/Transcript 是恢复权威，LangGraph
state 和浏览器状态都不是。决策背景见 [ADR 0001](../adr/0001-langgraph-for-classroom-discussion.md)。

当前锁定版本为 `@langchain/core` `1.1.31`、`@langchain/langgraph` `1.2.2`，并通过 workspace
override 锁定 LangGraph 的 checkpoint/sdk 传递依赖组合；版本原因和升级验证门禁记录在 ADR 0001。

### 需要自己补

- **MCP**：pi 中 grep `mcp` / `modelcontextprotocol` 零匹配。需自行适配（`@modelcontextprotocol/sdk` 起 client，MCP tool 映射为 `AgentTool`）。**第一版留接口位置，实现后置** —— 第一版所有 tool 都是自己的（几何、判题、出题、查证据），没有外部 MCP server 要接
- **教学语义事件**：见第 5 节
- **配额实现**：钩子在，逻辑要自己写

### Agent 边界：三个，不是一个

| Agent | 延迟 | 特性 |
|---|---|---|
| **课件编译** | 分钟级，离线 | 可重试、幂等；产物必须过校验门才落库 |
| **课堂讨论** | 秒级，在线 | 多角色；工具面收窄；可中断 |
| **判题** | 秒级，在线 | 确定性优先、AI 兜底；隔离级别最高，见下 |

拆分依据是延迟要求、可重试性、权限面、失败处理完全不同。

**判题 agent 的额外约束**：它的输出进 append-only 证据账本，判错会永久污染长期数据，并影响下游复习队列、掌握度、学情报告。因此：

- 确定性检查优先，AI 只兜底
- 每条判定必须记 `scorer` 类型 + 版本 + 置信度
- **禁止「解析失败给默认分」**（OpenMAIC 的做法是判分失败默认给 50%，会污染证据）
- 低置信度判定在重算时可降权或剔除

## 4. 候选数学 Domain Plugin：几何能力

本节记录已确认的几何技术约束，不把几何定义为 Chalkboard 产品本体。插件协议与首个数学插件在 V5 开始前另行定义；首个插件不预先锁定为几何。

### GeoGebra（Geometry Agent 默认）

Geometry Agent 的 Stage 2 使用旧 Geo2Geo v2 的命令式风格：`MODE: 2D/3D`、一行一条命令、依赖顺序定义对象，并通过 `submit_geogebra_script` 工具提交。宿主在浏览器中创建 Classic applet，逐条调用 GeoGebra API；每条命令都记录序号、原文和成功/失败状态，失败时向页面和后续修复流程返回命令级诊断。API key 只存在于运行时环境，不写入 artifact 或日志。

GeoGebra 原生对象模型用于 Slider、路径动点、函数/圆锥曲线、Segment/Line/Ray、交点和派生对象，因此拖动 Slider 或路径点时依赖对象会自动更新。Prompt 明确禁止把普通连接画成 Ray、用无关固定坐标替代曲线上的点，以及用多交点列表赋给单点；视口命令保证大圆、椭圆和抛物线完整可见。

### manim-web（迁移期遗留）

`0.3.24`（2026-07-13 更新，2026-02 首发），MIT，TypeScript，Vite + Vitest + Playwright 工具链，452 stars / 613 commits。提供 browser / React / Vue 入口。

已有能力：几何图元（Circle / Polygon / Arrow / Arc / Brace）、Text / MathTex / Tex、Axes / NumberPlane / FunctionGraph / ParametricFunction / VectorField、3D（Sphere / Cube / Surface3D / ThreeDAxes + orbit controls）、动画（FadeIn / Create / Transform / Write / AnimationGroup / LaggedStart）、GIF 与视频导出、Matrix / Table / 网络图、`tools/py2ts.cjs`（Manim Python → TS）。

两个直接命中需求的特性：

- **`Draggable` / `Hoverable` / `Clickable`** —— 功能文档 6.5 要求学生操作回传给 AI，这是抓手
- **结构化 logger + `onLog` 订阅**，README 明确面向 "AI agents that write and debug scenes"，转发时脱敏 token / key / email —— 可作为 LLM 修复闭环的结构化错误通道

### 几何 Agent 与约束层

manim-web 仍锁定在现有 package 中，作为迁移期兼容和未来教学动画适配器保留；它是动画引擎，**不管理几何约束**。`Draggable` 让点能拖，但拖动 A 之后派生对象不会自动重算，因此不再作为 Geometry Agent 默认渲染目标。

若 V5 选择几何作为参考插件，几何 Agent 负责生成受限几何 DSL，约束计算与渲染适配归该 Domain Plugin 所有，Teaching Kernel 只负责挂载活动与消费结果。下列仅是候选内部结构：

```
packages/<math-domain-plugin>/src/internal/geometry/
  ├─ agent/                  prompt + tools + scripts
  ├─ 约束与依赖图          纯逻辑，不依赖渲染，可脱离浏览器单测
  ├─ 派生对象求值器        中点 / 交点 / 垂线 / 平行线 / 角平分线 / 圆上点
  ├─ 退化检测              三点共线时「交点」不存在等
  ├─ 后置条件校验          CI 中可断言 "DE == AD"
  └─ → GeoGebra / manim-web 适配层    薄，渲染器可替换
```

设计约束：

- 约束与校验层**不绑渲染器对象模型**。GeoGebra 是当前默认渲染器，manim-web 仅是兼容适配器
- manim-web 版本号仍**锁死**，不用 `^`；只有重新启用动画适配器时才维护其覆盖度验证
- 几何正确性必须能进 CI

### LLM 接口：生成受限 DSL，不生成渲染代码

```
模型产出结构化几何 DSL
      ↓  Zod schema 校验
      ↓  对象类型与依赖检查
      ↓  隐藏画布预渲染
      ↓  结构化错误 JSON 回传模型修复
      ↓  正式播放
```

结构化错误类型：`OBJECT_NOT_FOUND` / `TYPE_MISMATCH` / `DUPLICATE_ID` / `CYCLIC_DEPENDENCY` / `DEGENERATE_CONSTRUCTION` / `POSTCONDITION_FAILED` / `RENDER_FAILED`。

底层代码质量由经过测试的编译器和运行时保证，不由模型保证。

## 5. 观测

两层不重叠，都要：

| 层 | 内容 | 手段 |
|---|---|---|
| **可观测性** | trace、token 成本、tool 调用、延迟 | pi-telemetry + OpenTelemetry，不自己写 |
| **教学语义事件** | 正在构图 / 等你回答 / 正在判题 / 进入讨论室 / 提示层级升高 | 自己定义，但定义为 pi 的 telemetry schema，不另建一套 bus |

教学语义事件的作用是让前端把状态表现成教学状态，而不是从模型文本里猜。一份 schema 同时喂 UI、日志、证据账本。

必须能算出：**每个学生每节课的 token 成本**。

## 6. Eval（与功能同期建设）

没有 eval 无法判断改一个 prompt 是变好还是变坏。评测代码放在仓库根目录 `eval/` 或相应模块的测试旁边，不作为运行时 package；它仍需与 telemetry 关联（pi 的 span schema 可把 trace 和 eval 结果连起来）。

### 分两类，不要混

| 类别 | 对象 | 判据 |
|---|---|---|
| **assessment** | 学生 | 掌握判定 |
| **eval** | 系统 | 产出质量是否达标 |

### 第一批 eval 项

**确定性检查（CI 门禁，不过则构建失败）**

- 几何后置条件：构造出的图形是否满足题设（`DE == AD`、垂直、共线…）
- 教学结构 lint：**任何非平凡步骤前，对应 Scene/Action 序列必须先解释「为什么」**（功能文档 4.2）
- DSL schema 校验：类型、依赖、重复 id、依赖环
- 判题一致性：同一份作答重复判定结果是否稳定

**LLM / 视觉模型评分（回归跟踪，不做门禁）**

- 讲解质量：思路来源是否讲清、是否只给了正确步骤
- 图形与旁白一致性
- 用词适龄性
- 图形可读性、遮挡、布局（参考 OpenMAIC `eval/whiteboard-layout/`：真实跑 agent、截图、视觉模型按可读性/遮挡/渲染正确性/布局逻辑打分）
- **答案泄露率**：提示阶梯是否被绕过

**待建（有真实学生数据后）**

- 前测/后测学习增益
- 独立完成率与提示层级分布
- 7 / 30 天保留率
- 题型识别准确率

### 原则

- 确定性能判的，绝不交给 LLM 判
- eval 结果与 telemetry trace 关联，可回溯到具体 prompt 版本
- 记录 prompt 版本、模型版本、scorer 版本

Prompt 的集中目录、英文运行版本、中文审阅版本、revision 和迁移 provenance 统一遵循
[Prompt 管理规范](./prompts.md)，不在各 Agent 或生成模块中另定一套组织方式。

## 7. 仓库结构

```
packages/
  agent-runtime/    pi-agent-core 执行封装 + tools / compaction / 观测钩子
  chalkboard/       从 OpenMAIC 迁移并深化的课件模型、播放、渲染、互动与内部 Agent
apps/
  web/                 Next.js 前端；只含页面、组件和 API client
  api/                 Fastify 后端；认证、DB、DAL、第三方 Provider、Agent 装配和业务路由
  worker/           课件编译 + 复习调度 + 后台任务
tests/
  e2e/                跨 Web/API 的 Playwright 测试
eval/               确定性门禁 + LLM / 视觉评分 harness
```

**后端职责全部在 TS：** 认证与会话、用户与家长账号、租户隔离、课程图与题库 CRUD、画像读写、错题本、学情报告、文件上传、支付（如有）都放在 `apps/api`。`apps/web` 不能导入 Drizzle、Postgres、Pi runtime、认证实现或对象存储 SDK。

`@chalk/chalkboard` 是一个深模块：内部拥有 Zod 课件 schema、Scene / Action 运行模型、结构 lint、播放状态、渲染和互动；外部只暴露解析、运行和渲染所需的少量稳定接口。它是 Teaching Kernel，不拥有几何、代码或视频等 Domain Plugin 的内部对象模型。

LLM Provider 统一使用 `@earendil-works/pi-ai`。`apps/api/src/providers/llm/` 负责 Pi 模型目录、用户凭据、自定义 Provider 和模型选择的应用级装配，普通业务 Service 与 `@chalk/agent-runtime` 共用这套能力；`agent-runtime` 不另建一套 LLM Provider。

默认依赖方向为：`apps/web` 通过 `NEXT_PUBLIC_API_URL` 调用 `apps/api` 的 HTTP/SSE 接口；`apps/api` 作为组合根使用 `@chalk/agent-runtime` 与 `@chalk/chalkboard`。workspace package 不应依赖任何 app 路径；数据库、认证和产品集成由 API 的 adapter / composition root 注入。

`apps/api` 与 `apps/web` 是两个独立部署单元。API 使用 HttpOnly session cookie、精确 CORS 来源和 unsafe method 的 Origin 检查；Web 只保存内存中的界面状态，不保存 API key 或业务数据。开发环境默认 Web `:3000`、API `:3001`，由 `NEXT_PUBLIC_API_URL` 和 `WEB_ORIGIN` 连接。

`@chalk/agent-runtime` 默认保持通用、独立，不依赖 `@chalk/chalkboard`。如果 Chalkboard 需要 Agent 能力，可以单向依赖 `agent-runtime` 暴露的稳定公共接口，但不能反向依赖或形成循环依赖。只有出现新的稳定 seam 和独立调用方时，才考虑新增 package。

## 8. 安全与合规（面向未成年人，第一版就要有正确形状）

参考项目的反面教训（来自调研）：DeepTutor 的 memory consolidation run 无 `user_id` 隔离、memory API 无 owner 校验、`PathService` 异常时静默回退到 admin path；OpenMAIC 的服务端认证自标「仅开发用途」，公开 bearer token 不提供用户隔离，调用方可自行提交 learner key。

第一版必须正确的：

- 认证与租户隔离，异常时 **fail closed**，不静默回退
- 所有数据访问路径带 owner 校验
- 未成年人数据合规：采集最小化、家长授权、留存与删除策略
- 生成内容的安全过滤（面向儿童，误差不对称：成人会自行纠正错误类比，12 岁学生会学进去）
- 模型生成代码/HTML 的执行隔离

## 9. 待验证

1. **候选几何插件的约束层技术尖刺**：只在 V5 规格选择几何作为参考插件后执行。不接 LLM，手写一道倍长中线（△ABC，D 为 BC 中点，延长 AD 到 E 使 DE=AD，连 BE），验证四件事：
   - 拖动 A 点，派生对象是否正确跟随
   - 能否从外部读到 E 的当前坐标（AI 观察输入的前提）
   - 非法构造（三点共线求交点）是否返回结构化错误
   - 能否写成 CI 断言 `DE == AD`

   不通则后续所有几何教学功能都是空的。

2. **GeoGebra 浏览器 API 的错误结构化能力**：`evalCommand()` 本身返回布尔值，需继续验证 `setErrorHandler`、`exists`、`getObjectType` 在锁定 Classic applet 版本中的兼容性
3. **MCP 适配的具体形态**：接口位置先留出
4. **学生操作事件的回传契约**：`Draggable` 事件 → 证据账本 + AI 观察输入的数据形状
5. **pi-telemetry 与教学语义事件的结合方式**：是否足以承载 UI 状态驱动

## 10. Python 的位置（LightRAG 例外）

Chalk 业务后端仍然全为 TypeScript。经确认，首期 RAG 只使用 LightRAG，并允许一个独立的 Python 在线 retrieval sidecar：它负责 LightRAG 的文档解析、索引、embedding、图/向量检索和查询合成；它不负责 Chalk 认证、owner 授权、业务状态机或证据账本。

### 调用链

```text
Web → TypeScript API
       ├─ 认证、owner 校验、配额、审计
       ├─ 解析 knowledgeBaseId / indexVersionId
       └─ 内部认证调用 Python LightRAG sidecar
                └─ answer + structured references
```

### 必须遵守

1. **仅限内部接口**：sidecar 不暴露给浏览器或公网；API 使用服务身份、网络策略和超时/取消控制调用它。
2. **权限只在 TypeScript 强制**：所有 KB、文档、索引版本和审计查询仍通过带 `userId` 的 DAL；Python 不接受客户端 `userId` 作为授权依据。
3. **窄接口与单一 schema 来源**：TypeScript 用 Zod 定义 `RagQueryRequest` / `RagQueryResponse`，生成 JSON Schema；Python 用生成的 Pydantic 模型，禁止两边手写同一业务结构。
4. **凭据最小暴露**：Python 不读取 Chalk 凭据数据库，不记录 API key/Cookie/token；LightRAG 所需 LLM/embedding 调用使用受控模型代理或短期凭据。
5. **数据与版本隔离**：原始文件和 LightRAG workspace 放在受控对象存储；Postgres 保存 KB、job、index version 和 citation 元数据；sidecar 仅按授权的 `indexVersionId` 读取。
6. **可恢复与可观测**：索引构建仍通过队列、lease、heartbeat、幂等 job 和不可变版本完成；在线查询记录 trace、版本、模式、延迟、错误和引用 ID。
7. **证据账本和 DSL 校验永不跨界**：LightRAG 返回的自然语言 answer 不能直接写入学生掌握度；TypeScript 负责引用投影和教学证据记录。
