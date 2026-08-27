# Chalkboard V2 工程迁移计划

> 文档状态：Historical
> 目标分支：`feat/chalkboard-v2`
> 目标 worktree：`.worktree/chalkboard-v2`
> 创建基线：`feat/chalkboard-v1` 合并后的集成分支；准确提交在 V2 handoff 创建时记录
> 产品规格：继续实现 Chalkboard V1，不定义新的产品版本
> 最后核验：2026-08-27

## 1. 定位

“V2”只表示 OpenMAIC 迁移的第二个工程阶段。Chalkboard 的产品范围、Provider、生成和
课堂播放行为继续以 `docs/spec/chalkboard-v1-*.md` 为权威来源，不复制一套 V2 产品规格。
课堂实时讨论、Discussion Transcript、课堂 Chat 后端与 AI 老师对话已延后到 V3
候选范围，不属于本计划。

本阶段从已经验证的浏览器课堂运行时出发，交付用户课堂持久化、对象存储、课堂导入、AI
内容生成和真实学习状态闭环。前端不等后端全部完成后再统一接入；每个后端垂直切片同时
交付对应的加载、成功、空状态、冲突、失败和恢复体验。

## 2. 已确认的模型与工程约束

- Chalkboard 与 Chat 一样对所有已认证账号开放；`admin` 和 `user` 使用相同的创建、导入和
  学习能力；
- 用户创建、导入或生成的 `Classroom` 是按账号归属、跨内容修订保持稳定的课堂身份；
- 校验完成的 `Classroom Artifact` 不可变，内容变化必须产生新版本；
- `Learning Session` 必须绑定确定的 Classroom Artifact；产生新版本后不静默迁移旧进度；
- `Playback Cursor` 是 Learning Session 的一部分，不再以浏览器 `localStorage` 为权威来源；
- AI 分段保存生成中间结果，校验完成后产生 Classroom Artifact；
- 一次可追踪的生成尝试称为 `Generation Run`，分段持久化并具有明确终态；
- 两门现有课堂作为迁移样本跑通正式持久化、导入和运行链路；
- 全栈 TypeScript；Agent 运行时继续使用锁定版本的
  `@earendil-works/pi-agent-core`，不复制第二套 Agent Runtime；
- 所有用户数据在 DAL 强制执行 owner 校验；认证异常 fail closed；
- 每个切片遵循一个失败行为测试 -> 最小实现 -> 通过 -> 下一行为。

## 3. AI 迁移边界

### 3.1 复用 Chalk

- 认证、用户身份、Fastify、Postgres、Drizzle 和对象存储；
- Agent Runtime、Agent Run、Trace、Span、工具审批、取消与可观察性；
- Provider registry/adapter、错误归一化和已有 Chat 运行能力；
- API 的 Route -> Service -> DAL 分层和 Web HTTP client 约定。

### 3.2 迁移 OpenMAIC 行为

- requirements/context -> outline -> content -> actions -> media 的课堂生成语义；
- Scene/Action 编排、Artifact 中预编排的教师/参与角色和 prompt provenance；
- 图片、视频媒体任务的幂等、轮询、取消和恢复；V2 课堂朗读使用浏览器原生 TTS；
- Chalk 原生 `.chalk.zip` 与兼容 `.maic.zip` 的 manifest、媒体导入语义；
- authored `discussion` Action 的生成与播放暂停语义；
- 导入 Artifact 中 authored `wb_*` 教师白板的只读播放与游标重建；
- 中间结果持久化、失败恢复、校验与 Artifact 生成。

迁移的是经过固定 OpenMAIC 提交验证的行为和协议，不照搬其后端目录、运行语言、默认身份
或与 Chalk 分层冲突的实现。Prompt 按 [Prompt 管理规范](../architecture/prompts.md) 集中并维护
英文/中文配对版本；AI 只读取英文版。固定来源的英文 Prompt 先保真迁移，只有 Chalk 的真实
接口、安全约束或已支持能力要求时才做可单独审查的最小修改。

## 4. 垂直切片

### 4.1 Classroom 持久化与对象存储

目标：每个已认证账号都能通过同一产品路径创建、查看并学习自己的课堂，课堂内容和媒体不再
依赖 Web fixture 或浏览器存储。

- 建立 Classroom、Classroom Artifact 和必要媒体引用的 schema/DAL；
- 建立 Postgres 元数据与对象存储媒体之间的稳定引用；
- 通过正式持久化 seam 迁入“等式的性质与移项变号”和“傅里叶变换入门”作为验证数据；
- 提供认证的用户课堂列表与指定 Artifact 读取接口，`admin` 和 `user` 使用相同接口；
- owner 条件只在 DAL 实现，Service 和 Route 不复制过滤逻辑；
- 正式导入接口接管课堂输入后移除临时 fixture/zip Web route；
- Web 接入用户课堂列表，覆盖 loading、empty、forbidden、not found 和 retry。

完成门禁：集成测试证明 `admin`、`user` 均可使用课堂接口且两个账号的数据相互隔离；
Playwright 证明新浏览器无需预置 `localStorage` 即可发现并切换当前账号的两门验证课堂。

### 4.2 通用课堂导入

目标：固定路径映射退场，`.chalk.zip` 成为 Chalk 原生课堂归档，`.maic.zip` 作为受控的
OpenMAIC 兼容输入。

- 上传、大小/类型限制和安全解包；
- manifest normalize 与 Chalkboard DSL 校验；
- 媒体写入对象存储并生成内部引用；
- 导入全过程绑定当前用户并使用稳定幂等键；
- 校验或持久化失败不产生可运行的半成品 Artifact；
- 校验完成后产生不可变 Classroom Artifact。

### 4.3 Prompt foundation

目标：在迁移课堂 AI 前落地全仓 Prompt seam，使 `main` 现有 AI 和新增 Chalkboard AI 使用
同一种集中、双语、可追溯的 Prompt 管理方式。

- 建立 `apps/api/src/prompts/`、typed registry、loader、templates 和 snippets；
- loader 只向运行时提供英文版，中文版仅用于人类审阅；
- 首先迁移主 Agent、子 Agent 和会话标题 Prompt，保持既有语义并补齐英文执行版与中文镜像；
- Tool/参数 description、Skill 和运行时数据块继续在所属模块就近维护；
- build 包含 Prompt 资产且不依赖启动 `cwd`；
- 建立双语结构一致、无残留占位符、revision 和 provenance 测试。

完成门禁：现有 Chat 集成行为通过，代码扫描不再发现这三类产品 Prompt 内联；API build
从非仓库工作目录启动后仍能加载英文模板，测试证明中文版不会进入模型请求。

当前状态：已完成。OpenMAIC outline 英文 Prompt 固定到提交
`1466a55eef9e31e229a0e2e60a0811020d7b06e2` 并通过字节级 hash 门禁，中文版只作为审阅镜像；
主 Agent、子 Agent、会话标题与大纲生成统一通过 `buildPrompt(promptId, variables)` 装配。

### 4.4 Generation Run

按以下阶段逐步接入 AI：

```text
requirements/context
  -> outline
  -> scene content
  -> scene actions
  -> media tasks
  -> validate
  -> Classroom Artifact
```

- 每个阶段独立持久化输入、输出、状态和错误，并绑定发起用户；
- 重试不重复创建已完成媒体或覆盖既有 Artifact；
- 支持取消、超时、失败恢复和明确终态；
- Prompt provenance 单独校验，不在响应或日志泄露密钥与用户隐私；
- 前端展示教学语言下的阶段进度、可重试失败和完成结果，不直接暴露内部 worker 状态。

完成状态：大纲、Scene content、Scene actions、media tasks 与 Artifact 发布纵向切片已完成。
`requirements/context -> outline -> ordered slide/quiz/interactive content -> ordered scene actions -> ordered media tasks -> validate -> Artifact` 的每个阶段
都通过认证异步 API 创建独立、持久化的 Generation Run；worker 以 lease/heartbeat 支持进程恢复、
取消和明确终态。content 与 actions 均按 Scene 逐条写 PostgreSQL，失败重试只处理未完成项并保留
Prompt/模型审计。image/video task 的状态、Provider/模型、内容 hash 和稳定媒体引用写 PostgreSQL，
二进制写对象存储；失败重试只处理未完成 task。教师 `speech` Action 在 Web 使用浏览器
`SpeechSynthesis`，不创建后端音频 task。后端可选 TTS task 接口仅保留兼容性，不属于 V2 Web 路径或
完成门禁。显式 publish 对最终 Stage/Scene/Action 和媒体引用执行
normalize/DSL 校验，将 Draft 媒体提升到稳定 Artifact namespace，并以 reservation/lease、稳定目标 ID、
数据库事务和失败删除实现幂等与硬中断恢复。发布成功后 Web 通过正式 Classroom API 打开不可变 Artifact。
interactive 已迁移 OpenMAIC 的 simulation、diagram、code、game 和 visualization3d content Prompt
以及统一 interactive actions Prompt；生成 HTML 与 Action selector 都在入库前 fail closed 校验，
旧版 `interactiveConfig` 会确定性归一化。PBL content/actions 仍未迁移，不会静默降级为 slide。

### 4.5 Learning Session 与 Playback Cursor

目标：刷新浏览器、重启 API 或换设备后可以恢复同一个 Artifact 上的学习进度。

状态：已完成（2026-08-26）。

- 创建或恢复 Learning Session；
- 保存 scene/action cursor、播放模式、完成状态和乐观并发版本；
- 过期写入返回稳定冲突错误；
- Artifact 版本不匹配时拒绝套用旧 cursor；
- Web 采用服务端快照，`localStorage` 只允许作为有期限的迁移读取或非权威缓存；
- 明确保存中、已保存、冲突、离线和恢复失败反馈。

完成门禁：API integration 覆盖 owner 隔离、冲突和进程重启恢复；E2E 覆盖刷新和新浏览器
上下文恢复。

### 4.6 学习交互与完成状态

状态：已完成（2026-08-26）。

当前 V2 范围只包含：

1. Quiz Attempt（已完成）；
2. Learning Session 中的课堂完成状态（已随 Playback Cursor 完成）。

两者都绑定 Learning Session 和 Artifact 版本，具备 owner 校验、revision、恢复和前端保存反馈。
V2 不建立学生手写白板、Whiteboard Snapshot/History、Discussion Transcript、课堂 Chat 后端或
对话会话管理。

### 4.7 延后到 V3 的课堂实时讨论

以下能力已移出 V2，不是本计划的完成门禁：

- Discussion Transcript 与课堂 Chat 后端；
- 学生主动插话与 AI 老师多轮对话；
- Conversation/Thread/Run 会话管理；
- SSE 事件顺序、sequence、abort 和断线恢复；
- Director/参与 Agent、讨论 ASR/TTS 和 live whiteboard Action；
- 讨论结束后恢复主课堂。

学生自由手写白板也已从 V2 移除，不会自动并入 V3 课堂讨论；如果未来需要，必须另行产品评审。

待前端交互和会话管理完成产品设计后，再通过
[Chalkboard V3 课堂讨论候选规格](../spec/chalkboard-v3-discussion.md)单独评审和实施。

### 4.8 延后到 V3 的渐进式课堂生成

V2 已完成可恢复的 outline、content、actions、media 和 publish 纵向链路，并保留逐 Scene
持久化与失败恢复。以下 OpenMAIC 式生成体验不再继续加入本分支，也不是 V2 完成门禁：

- 大纲生成时通过 SSE 逐步显示已经解析的 Scene 标题；
- 大纲完成后在 content 生成前编辑、添加、删除、配置或重排序 Scene；
- 按单个 Scene 执行 `content -> actions`，第一幕完整后先进入生成中课堂，后续 Scene 逐幕出现；
- 为上述体验建立断线续传事件和生成中课堂预览语义。

这些能力通过 [Chalkboard V3 渐进式课堂生成规格](../spec/chalkboard-v3-generation.md)单独设计和实施。
在 V3 明确 Draft Preview、Artifact revision 与 Learning Session 的关系前，不修改 V2 的不可变
Artifact 发布契约。

## 5. 公开测试 seams

沿用 V1 已确认的 seams：

1. Provider adapter：能力输入、第三方 HTTP、归一化结果和错误映射；
2. Media service：owner、幂等、asset/task 生命周期和 worker lease；
3. Chalkboard core：Stage validation、navigation、Action execution 和 snapshot；
4. Classroom persistence：save/load、版本冲突、恢复和 owner 隔离；
5. Classroom import：安全解包、校验、对象存储引用、幂等和失败回滚；
6. Prompt module：双语配对、英文加载、插值、revision、provenance 和无残留占位符；
7. Generation Run：阶段状态、Provider 调用、恢复、取消和 Artifact 生成；
8. Web adapter：HTTP response 到 runtime 的转换、缓存与失败降级；
9. 浏览器用户 seam：课堂发现、学习恢复、保存反馈和生成进度。

测试只通过这些公开接口观察行为，不查询私有实现来证明成功。每轮只推进一个 seam 的一个
行为，禁止先批量创建所有 schema、mock 和测试再补实现。

## 6. 前端质量门禁

每个垂直切片都必须同时覆盖：

- desktop、tablet 和 phone；
- 键盘、焦点、触控目标和 screen-reader name；
- loading、empty、partial、forbidden、not found、conflict、offline 和 retry；
- 学生可理解的文案，不把 DAL、worker、provider 或 HTTP 术语泄露到界面；
- 不用静态假数据掩盖尚未完成的后端状态；
- 不回退 V1 已验证的播放、sandbox、内容净化和无横向溢出门禁。

## 7. 分支和文档生命周期

1. 更新并关闭 `feat/chalkboard-v1` 文档；
2. 将 `feat/chalkboard-v1` 合并到确认的集成分支；
3. 从合并结果创建 `feat/chalkboard-v2` 和 `.worktree/chalkboard-v2`；
4. 按 worktree runbook 分配独立端口、数据库和对象存储命名；
5. 创建 `docs/handoff/chalkboard-v2.md`，记录准确基线和环境；
6. 每个切片同步对应 spec、architecture 或 runbook，不把长期规则只留在本计划；
7. 所有切片完成或阶段停止后，将本计划标记为 `Historical`。

分支创建前不预写 V2 handoff 中的实际端口、数据库名、服务状态或已通过命令；这些只能在
新 worktree 中验证后记录。

本计划于 2026-08-27 完成实现与发布门禁后归档。分支仍等待产品方最后人工验收；验收与提交状态记录在
[V2 handoff](../handoff/chalkboard-v2.md)，不重新打开本工程计划。
