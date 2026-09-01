# Chalk 主分支交接（2026-08-28）

> 文档状态：Accepted
> 文档类型：Main baseline handoff snapshot
> 适用分支：`main`
> 主工作区：`/home/xcodd/code/chalk_`
> 基线提交：`aee6e5611c4fa93c06eeae9e94a98b2b64844e89`
> 远端基线：`origin/main@aee6e5611c4fa93c06eeae9e94a98b2b64844e89`
> 最后核验：2026-08-28

本文记录 Chalkboard V3 合并并完成主分支调研文档维护后的仓库现场。它是继续开发时的入口，
不是新的产品规格或架构规范；稳定约束仍以[文档索引](../README.md)列出的权威文档为准。

## 1. 交接结论

当前 `main` 已经处于 V3 完成后的新基线：Tools/MCP/Skills 基础、Chalkboard V1 前端运行时、V2
持久化生成与正式学习状态、V3 渐进生成/多 Agent 讨论/AI Live Chalkboard 均已合并。V3 的功能
分支已经结束，后续工作不得继续堆在 `feat/chalkboard-v3` 上。

开始 V4 前仍需在新的主分支功能分支上完成三项平台先决工作：

1. 学生与 Agent 长期记忆；
2. 将 Chalkboard 能力封装为 owner-scoped Agent Tools；
3. 让 Chat 可以基于当前对话生成并持久化一个 Chalkboard Scene。

Tools 执行内核、MCP 与 Skills 基础已经存在，但“平台先决工作完成”不能据此直接画勾；仍需按当前
产品目标核验 Tool 安装/发现/授权链路，并实现 Chalkboard 专用 Tool。版本顺序继续遵循
[Chalkboard V3–V6 路线](../plan/chalkboard-roadmap.md)：平台先决工作 → V4 → V5 → V6。

## 2. Git 与分支现场

写本文前已实际核验：

```text
main        aee6e5611c4fa93c06eeae9e94a98b2b64844e89
origin/main aee6e5611c4fa93c06eeae9e94a98b2b64844e89
```

主线最近的关键合并是：

| 阶段 | 合并/提交 | 结果 |
|---|---|---|
| Tools/MCP/Skills 基础 | PR #4，`c1cee17` | 已进入 `main` |
| Chalkboard V1 | PR #5，`b8804df` | 已进入 `main` |
| Chalkboard V2 | PR #6，`82832ee` | 已进入 `main` |
| Chalkboard V3 | PR #7，`c38907b` | 已进入 `main` |
| V3 异步集成测试稳定性 | PR #8，`1d63be4` | 已进入 `main` |
| Memory/OpenMAIC 调研 | `aee6e56` | 已推送到 `main` |

当前已有 worktree：

```text
/home/xcodd/code/chalk_                                      main
/home/xcodd/code/chalk_/.worktree/tools-foundation          feat/tools-foundation
/home/xcodd/code/chalk_/.worktree/chalkboard-v1             feat/chalkboard-v1
/home/xcodd/code/chalk_/.worktree/chalkboard-v2             feat/chalkboard-v2
/home/xcodd/code/chalk_/.worktree/chalkboard-v3             feat/chalkboard-v3
/home/xcodd/code/chalk_/.worktree/chalkboard-openmaic-migration
```

已核验 Tools、V1、V2、V3 worktree 均与各自远端分支一致且工作树干净。这些分支保留用于追溯，
不是下一阶段的开发基线。新功能必须从届时最新的 `origin/main` 创建新分支和独立 worktree。

主工作区中的 `temp/` 是未跟踪的本地临时目录，不属于仓库状态；不要在没有明确确认范围时提交、
清理或依赖其中内容。

## 3. 当前已完成的产品基线

### 3.1 Agent 与 Tools 基础

- 全栈继续使用 TypeScript；通用 Agent runtime 使用锁定版本的
  `@earendil-works/pi-agent-core`；
- `ToolRegistry` 统一处理 Tool schema、审批、超时、取消、结果预算、并行/串行执行与错误通道；
- MCP stdio、SSE、Streamable HTTP transport、远端工具发现与 proxy tool 已进入主线；
- 只读/非只读 MCP Tool 继续使用统一权限与执行策略，不能绕过 `ToolRegistry`；
- Skills 基础和统一 `read_resource` facade 已存在；上传文本可通过 owner-scoped、带签名 cursor 的
  Range Read 读取；知识库、Web、PDF/图片和完整 MCP Resource adapter 仍不是已完成基线；
- 旧的 [Tools → MCP 交接](tools-foundation-to-mcp.md)记录的是 2026-08-24 的分支现场，其中
  “尚未创建 commit”已经过时；实际代码已通过 PR #4 合并，继续工作应以当前 `main` 和代码为准。

### 3.2 Chalkboard V1–V3

- `Classroom` 具有稳定 owner-scoped 身份；`Classroom Artifact` 是不可变正式版本；生成中的候选内容
  使用 `Classroom Draft` 和可恢复 `Generation Run`；
- 大纲通过 SSE 返回完整解析的 Scene，完成后固定停留供用户审阅和编辑；用户明确确认后才进入
  Scene 生成，不自动倒计时；
- 一个 Classroom 内按 `Scene content -> Scene actions` 顺序渐进生成；最多允许 10 个不同课堂 Run
  并发，同一课堂内部保持有序依赖；
- Scene 1 原子完成后立即进入 Draft Classroom，可播放、切页、答题、讨论和使用 AI Live Chalkboard；
  后续 Scene 继续生成并逐幕加入，pending/running/failed 占位项可点击；
- 播放中的课堂不会因为后续 Scene 完成而替换 runtime 并重播已经朗读的内容；
- 课堂入口从生成要求提交时就出现在左侧列表，离开后可通过稳定 Classroom URL 恢复大纲生成、
  审阅、Scene 生成、Draft Classroom 或失败状态；
- 全部必要 Scene 和媒体通过严格校验后，由用户显式发布不可变 Artifact；未完成 Draft 不伪装为
  正式 Artifact；
- PostgreSQL 保存身份、状态、JSON 与学习记录；MinIO 只保存图片、音频和视频二进制；
- 已支持 slide、quiz、interactive、`.chalk.zip` 原生归档和 `.maic.zip` 兼容导入；PBL 不在 V3 范围；
- 正式 Learning Session、Playback Cursor 和 Quiz Attempt 可恢复；Draft Classroom 不写正式学习状态。

### 3.3 多 Agent 讨论与 AI Live Chalkboard

- 课堂初始化生成 3–5 个 Agent 画像，恰好一位教师；Draft、Artifact 和 Discussion 共用画像；
- Discussion Session 绑定 Generation Run 或 Learning Session 及当前 Scene；Round、Message、状态和
  `wb_*` Action ledger 都持久化在 PostgreSQL；
- TypeScript LangGraph 只负责编排 Director/Participant 循环，模型仍通过现有 `pi-ai` provider adapter；
- authored Discussion Action 和学生自由追问共用右侧讨论面板，支持 SSE 增量文本、FIFO 浏览器 TTS、
  ASR 输入、停止、刷新恢复、显式结束并回到进入前课堂位置；
- AI Live Chalkboard 支持文本、公式、形状、线条、表格、图表和代码块，并随 Transcript ledger 恢复；
- 学生自由手写白板、独立 Whiteboard Snapshot/History 和可收藏白板单元尚未实现。

## 4. 已确认、不要重新讨论的边界

- Chalkboard 是 Teaching Kernel，不是几何产品、视频产品或代码编辑器；
- 几何约束/几何 DSL、沉浸视频和代码运行环境属于 Domain Plugin；
- Agent Tool 与学生操作的 Domain Plugin 是不同边界；
- 当前课堂结构是 `Classroom Artifact -> Scene -> Action`，不引入 Beat；
- Discussion Action 是可跳过的开放讨论邀请，不等同于 Checkpoint，也不自动产生 Learning Evidence；
- Learning Activity 由 Quiz 或未来 Domain Plugin 承载，其结构化结果才能形成 Learning Evidence；
- PBL 不在已确认的 V3–V6 范围；
- 数据访问层强制 owner 条件，认证失败必须 fail closed；不得在 route 分散补 owner 校验；
- 产品 Prompt 集中维护英文运行版和中文审阅版；迁移固定 Prompt 时保留 provenance，非必要不改英文；
- 全栈保持 TypeScript、PostgreSQL + Drizzle；几何渲染候选仍是锁定版本 `manim-web`，但不得把
  渲染器对象模型变成领域约束模型。

权威定义见 [CONTEXT.md](../../CONTEXT.md)、[功能规格](../spec/functional-spec.md)和
[ADR 0002](../adr/0002-chalkboard-teaching-kernel-and-domain-plugins.md)。

## 5. 平台先决工作的真实状态

| 能力 | 当前状态 | 下一项可交付结果 |
|---|---|---|
| Tools/MCP/Skills 执行基础 | 已合并 | 按当前产品要求核验安装、发现、授权和公开 Tool 清单，不重复建设 runtime |
| 长期记忆 | 只有 Draft 调研 | 先形成 Accepted 架构：Learner Memory、Mastery/Evidence、L0–L3、owner/provenance、删除与注入预算 |
| Chalkboard Agent Tools | 尚未实现 | 通过明确输入/输出和 owner 边界生成或修改一个 Scene，不允许直接写任意 Artifact blob |
| Chat → 单 Scene | 尚未实现 | 在当前 Conversation/Agent Run 中调用 Chalkboard Tool，持久化来源与结果，并返回可进入的 Scene |
| Domain Plugin | 尚未开始 | 等 V4 完成后进入 V5，先定义协议，再实现一个小型数学参考插件 |
| 单课学习闭环 | 尚未开始 | 等 V5 后在 V6 消费 Quiz/Plugin 结果，调整教学并写入可追溯记忆 |

长期记忆的现有材料是
[Agent 长期记忆系统调研](../researsh/agent-memory-systems-research.md)。它比较 OpenClaw、Hermes、
DeepTutor 和 TencentDB-Agent-Memory，但仍是 Draft 调研，不代表 Chalk 已经选择具体存储、向量库、
注入位置或后台提炼机制。

OpenMAIC 后续参考见
[OpenMAIC v1.0.0 与本地快照差异](../researsh/openmaic-v1.0.0-vs-local.md)。OpenMAIC v1.0.0 的
Agent Workbench、Durable Session、Tools/Skills 和材料资产体系可作为证据，但不能替代 Chalk 的
owner、安全、记忆和教学闭环设计。

## 6. 验证基线

V3 分支收尾时实际通过：

- API integration：96/96；
- Chalkboard Chromium E2E：31/31；
- 全仓 lint、typecheck、unit test 和 build；
- migration、MinIO 初始化、seed 和 `git diff --check`；
- release eval dry-run。

V3 合并后对异步 Generation Run 测试做了两项确定性修复：测试租约不再短到被普通 CI 抖动击穿；
HTTP `202 Accepted` 不再错误要求 worker 必须仍停留在 `queued`。真正的“最多运行 10 个、第 11 个
保持 queued”并发断言仍保留。

当前 `main@aee6e56` 的 GitHub Actions
[Quality #33177045601](https://github.com/x18-1/chalk_/actions/runs/33177045601)已实际完成：

```text
static-and-unit     success
api-integration     success
chalkboard-browser  success
```

真实付费 LLM、图片、视频 Provider 的端到端 smoke 尚未执行。自动化 mock 和浏览器原生 TTS 通过，
不能替代真实 Provider 的模型遵循度、媒体质量、限流、成本和长耗时验证。

## 7. 本机运行环境

2026-08-28 核验时，正在运行的是 V3 worktree 环境，不是主工作区默认端口：

| 服务 | 地址/端口 | 状态 |
|---|---|---|
| V3 API | `http://127.0.0.1:3101` | listening |
| V3 Web | `http://127.0.0.1:3102` | listening |
| V3 PostgreSQL | `127.0.0.1:5543` | container healthy |
| V3 MinIO API | `http://127.0.0.1:9100` | container running |
| V3 MinIO Console | `http://127.0.0.1:9101` | container running |

主工作区默认的 Web/API 端口 `3000/3001` 未发现监听。V3 PostgreSQL/MinIO 容器已经持续运行约一天；
不要因为切换到主分支就误认为它们属于主工作区，也不要在未确认使用者时停止或删除 volume。

环境变量和第三方凭据只存在于各 worktree 的本地 `.env`；不得把值写入 handoff、日志或提交。
新 worktree 按[开发手册](../runbooks/worktree-development.md)选择独立端口、数据库、Compose project 和
volume，不复用 V3 的状态目录。

## 8. 已知缺口与风险

- Interactive 继续使用严格 HTML/Action 契约；尚未采用 OpenMAIC 的自适应模型重试，也不应把无效
  输出直接注入下一次 Prompt，重试设计仍需独立确认；
- 私有媒体目前依赖有时效的签名 URL；稳定 owner-scoped HTTP Range 媒体端点仍未实现；
- 真实 Provider eval、媒体 smoke、成本/限流/长耗时验证仍是人工发布门禁；
- Firefox/WebKit 矩阵按产品决定推迟，当前只保证 Chromium；
- formatter、自动 package 依赖方向检查、跨 worktree 端口/路径占用检测仍未形成门禁；
- 学生自由手写白板、独立白板历史、PBL、Domain Plugin 和单节课学习闭环均未实现；
- Memory 调研中的方案不能直接当实现规格；尤其不能把自由文本画像当 Mastery，也不能让模型提供
  任意 `studentId` 读取别人的记忆；
- 历史 handoff 可能包含当时真实但现在过期的分支状态。涉及当前实现时，先看代码、`git status`、
  当前权威文档和本文件，再使用历史 handoff 追溯原因。

## 9. 推荐的下一阶段顺序

### A. 先建立平台先决工作的独立规格和 worktree

从最新 `origin/main` 创建新分支，不复用 V3 worktree。先确定是以 Memory 为第一个纵向切片，还是以
Chalkboard Tool + Chat → Scene 为第一个纵向切片；不要在没有接口决定时同时铺开三条链路。

### B. Memory 先确定领域边界，再选实现

至少先确认：

1. Learner Memory 与 Mastery/Learning Evidence 的边界；
2. 原始事件、原子事实、近期学习场景和长期画像的来源与版本；
3. owner/tenant/session 身份、来源追踪、纠正、删除和派生数据回收；
4. system 稳定快照、user sidecar、按需只读工具的注入预算；
5. capture/recall/embedding 失败时不阻塞学生主链路的降级策略；
6. 哪些数据绝不能进入日志、Telemetry、Prompt 或跨学生召回。

### C. Chalkboard Tool 先做单 Scene 纵向切片

Tool 应通过服务端契约创建或修改 owner-scoped Scene，复用现有 Prompt、Provider、Draft、媒体和严格
校验能力。它不是把浏览器页面包装成 Tool，也不能允许模型绕过 DAL 直接覆盖任意 Classroom Artifact。
首个切片应贯通 Chat 调用、Agent Run/Tool Call 关联、Scene 持久化、失败恢复和可进入结果。

### D. 平台能力合并后再开 V4

V4 只做可观测性、安全和非功能加固；V5 再接数学 Domain Plugin；V6 再形成单课学习闭环。不要
提前把几何 DSL 写进 Teaching Kernel，也不要为了 V6 预先引入 Beat/Checkpoint 抽象。

## 10. 接手检查清单

开始修改前执行：

```bash
cd /home/xcodd/code/chalk_
git status --short --branch
git fetch origin main
git rev-parse HEAD origin/main
git worktree list
```

然后阅读：

1. [文档索引与权威顺序](../README.md)
2. [产品与运行术语](../../CONTEXT.md)
3. [功能规格](../spec/functional-spec.md)
4. [Teaching Kernel 与 Domain Plugin ADR](../adr/0002-chalkboard-teaching-kernel-and-domain-plugins.md)
5. [Chalkboard 路线图](../plan/chalkboard-roadmap.md)
6. [V3 历史交接](chalkboard-v3.md)
7. [Prompt 管理](../architecture/prompts.md)
8. [API 后端分层](../architecture/backend-layers.md)
9. [worktree 开发手册](../runbooks/worktree-development.md)
10. [数据库开发手册](../runbooks/database-development.md)

若开始新阶段，应在新 worktree 同步创建对应 spec、plan 和 handoff；本文在新的权威现场建立后改为
`Historical`，不要长期追加成跨版本日志。
