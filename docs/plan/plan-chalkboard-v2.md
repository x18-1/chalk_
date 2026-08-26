# Chalkboard V2 工程迁移计划

> 文档状态：Accepted
> 目标分支：`feat/chalkboard-v2`
> 目标 worktree：`.worktree/chalkboard-v2`
> 创建基线：`feat/chalkboard-v1` 合并后的集成分支；准确提交在 V2 handoff 创建时记录
> 产品规格：继续实现 Chalkboard V1，不定义新的产品版本
> 最后核验：2026-08-26

## 1. 定位

“V2”只表示 OpenMAIC 迁移的第二个工程阶段。Chalkboard 的产品范围、Provider、运行时、
生成和讨论行为继续以 `docs/spec/chalkboard-v1-*.md` 为权威来源，不复制一套 V2 产品规格。

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
- Scene/Action 编排、参与 Agent 角色和 prompt provenance；
- 图片、视频、TTS、ASR 等媒体任务的幂等、轮询、取消和恢复；
- `.maic.zip` manifest 与媒体导入语义；
- scripted discussion、Roundtable/Director 行为和 live whiteboard Action；
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

目标：固定路径映射退场，`.maic.zip` 成为受控的用户课堂输入。

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

### 4.5 Learning Session 与 Playback Cursor

目标：刷新浏览器、重启 API 或换设备后可以恢复同一个 Artifact 上的学习进度。

- 创建或恢复 Learning Session；
- 保存 scene/action cursor、播放模式、完成状态和乐观并发版本；
- 过期写入返回稳定冲突错误；
- Artifact 版本不匹配时拒绝套用旧 cursor；
- Web 采用服务端快照，`localStorage` 只允许作为有期限的迁移读取或非权威缓存；
- 明确保存中、已保存、冲突、离线和恢复失败反馈。

完成门禁：API integration 覆盖 owner 隔离、冲突和进程重启恢复；E2E 覆盖刷新和新浏览器
上下文恢复。

### 4.6 学习交互状态

按以下顺序逐个完成，不横向一次建完所有表：

1. Quiz Attempt；
2. Discussion Transcript；
3. 课堂 Chat；
4. Whiteboard Artifact/History；
5. 课堂完成状态和必要的 Teaching Semantic Event。

每个对象都绑定 Learning Session 和 Artifact 版本，具备 owner 校验、幂等写入、恢复和
前端保存反馈。

### 4.7 课堂讨论 Agent

先建立 deterministic scripted adapter，再接真实 Agent Runtime：

- 认证 SSE/HTTP 的事件顺序、sequence、cursor、abort 和断线恢复；
- discussion transcript 与进入讨论前的 Playback Cursor 持久化；
- Pi Director/参与 Agent、ASR、讨论 TTS 和 live whiteboard Action；
- 完成、取消、失败后恢复主课堂；
- 等待学生、收到回答和提示层级使用 Teaching Semantic Event，不与 Trace/Span 混用。

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
9. Discussion stream：事件顺序、断线、abort、sequence 和恢复；
10. 浏览器用户 seam：课堂发现、学习恢复、保存反馈、生成进度和课堂讨论。

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
