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

本阶段从已经验证的浏览器课堂运行时出发，交付课堂目录、服务端持久化、AI 内容生成和
真实学习状态闭环。前端不等后端全部完成后再统一接入；每个后端垂直切片同时交付对应的
加载、成功、空状态、冲突、失败和恢复体验。

## 2. 已确认的模型与工程约束

- `Classroom` 是跨内容修订保持稳定的课堂身份；
- 已发布的 `Classroom Artifact` 不可变，内容变化必须产生新版本；
- `Learning Session` 必须绑定确定的 Classroom Artifact；新版本发布后不静默迁移旧进度；
- `Playback Cursor` 是 Learning Session 的一部分，不再以浏览器 `localStorage` 为权威来源；
- AI 先写入 `Classroom Draft`，经过校验和显式发布后才产生 Classroom Artifact；
- 一次可追踪的生成尝试称为 `Generation Run`，分段持久化并具有明确终态；
- 先将两门现有课堂迁为种子数据，跑通正式链路，再开放通用 `.maic.zip` 导入；
- 全栈 TypeScript；Agent 运行时继续使用锁定版本的
  `@earendil-works/pi-agent-core`，不复制第二套 Agent Runtime；
- 所有用户数据在 DAL 强制执行 owner/访问校验；认证异常 fail closed；
- 每个切片遵循一个失败行为测试 -> 最小实现 -> 通过 -> 下一行为。

## 3. 实现前决策门

第一条数据库 migration 之前必须确认 Classroom 授权关系：

1. 教师/创建者拥有 Classroom，学生通过显式访问授权学习；或
2. V2 第一阶段只支持单用户 owner，后续再引入访问授权。

在该决定确认前，可以设计接口和测试场景，但不能用临时默认身份、全局公开课堂或端点内
散落的 owner 条件绕过模型。两门种子课堂如何归属也必须采用同一规则，不能成为特殊权限
后门。

## 4. AI 迁移边界

### 4.1 复用 Chalk

- 认证、用户身份、Fastify、Postgres、Drizzle 和对象存储；
- Agent Runtime、Agent Run、Trace、Span、工具审批、取消与可观察性；
- Provider registry/adapter、错误归一化和已有 Chat 运行能力；
- API 的 Route -> Service -> DAL 分层和 Web HTTP client 约定。

### 4.2 迁移 OpenMAIC 行为

- requirements/context -> outline -> content -> actions -> media 的课堂生成语义；
- Scene/Action 编排、参与 Agent 角色和 prompt provenance；
- 图片、视频、TTS、ASR 等媒体任务的幂等、轮询、取消和恢复；
- `.maic.zip` manifest 与媒体导入语义；
- scripted discussion、Roundtable/Director 行为和 live whiteboard Action；
- 中间结果持久化、失败恢复、校验与发布门禁。

迁移的是经过固定 OpenMAIC 提交验证的行为和协议，不照搬其后端目录、运行语言、默认身份
或与 Chalk 分层冲突的实现。

### 4.3 本阶段不做

- PBL；
- 完整课堂编辑器和 Edit with AI；
- PPTX、MP4 或课堂 ZIP 导出；
- Beat、Checkpoint 和长期学习策略；
- 几何 DSL、约束层和 `manim-web`；
- 未经产品确认的 OpenMAIC 管理功能。

## 5. 垂直切片

### 5.1 Classroom 目录与 Artifact 读取

目标：学生首次进入即可发现有权访问的课堂，两门现有课堂不再依赖最近访问记录才能出现。

- 建立 Classroom、Classroom Artifact 和必要媒体引用的 schema/DAL；
- 迁入“等式的性质与移项变号”和“傅里叶变换入门”作为正式种子数据；
- 提供认证的课堂列表与指定 Artifact 读取接口；
- owner/访问条件只在 DAL 实现，Service 和 Route 不复制过滤逻辑；
- 将固定 fixture/zip Web route 收缩为迁移兼容入口，不继续扩展；
- Web 区分课堂目录与最近课堂，覆盖 loading、empty、forbidden、not found 和 retry。

完成门禁：两个不同身份的集成测试证明可见性隔离；Playwright 证明新浏览器无需预置
`localStorage` 即可发现并切换两门授权课堂。

### 5.2 Learning Session 与 Playback Cursor

目标：刷新浏览器、重启 API 或换设备后可以恢复同一个 Artifact 上的学习进度。

- 创建或恢复 Learning Session；
- 保存 scene/action cursor、播放模式、完成状态和乐观并发版本；
- 过期写入返回稳定冲突错误；
- Artifact 版本不匹配时拒绝套用旧 cursor；
- Web 采用服务端快照，`localStorage` 只允许作为有期限的迁移读取或非权威缓存；
- 明确保存中、已保存、冲突、离线和恢复失败反馈。

完成门禁：API integration 覆盖 owner 隔离、冲突和进程重启恢复；E2E 覆盖刷新和新浏览器
上下文恢复。

### 5.3 学习交互状态

按以下顺序逐个完成，不横向一次建完所有表：

1. Quiz Attempt；
2. Discussion Transcript；
3. 课堂 Chat；
4. Whiteboard Artifact/History；
5. 课堂完成状态和必要的 Teaching Semantic Event。

每个对象都绑定 Learning Session 和 Artifact 版本，具备 owner/访问校验、幂等写入、恢复和
前端保存反馈。

### 5.4 通用课堂导入

目标：固定路径映射退场，`.maic.zip` 成为受控导入输入。

- 上传、大小/类型限制和安全解包；
- manifest normalize 与 Chalkboard DSL 校验；
- 媒体写入对象存储并生成内部引用；
- 失败不产生半发布 Artifact；
- 重复导入使用稳定幂等键；
- 通过 Draft -> Validate -> Publish 产生 Artifact。

### 5.5 Generation Run

按以下阶段逐步接入 AI：

```text
requirements/context
  -> outline
  -> scene content
  -> scene actions
  -> media tasks
  -> validate Classroom Draft
  -> publish Classroom Artifact
```

- 每个阶段独立持久化输入、输出、状态和错误；
- 重试不重复创建已完成媒体或覆盖已发布 Artifact；
- 支持取消、超时、失败恢复和明确终态；
- Prompt provenance 单独校验，不在响应或日志泄露密钥与学生隐私；
- 前端展示教学语言下的阶段进度、可重试失败和发布结果，不直接暴露内部 worker 状态。

### 5.6 课堂讨论 Agent

先建立 deterministic scripted adapter，再接真实 Agent Runtime：

- 认证 SSE/HTTP 的事件顺序、sequence、cursor、abort 和断线恢复；
- discussion transcript 与进入讨论前的 Playback Cursor 持久化；
- Pi Director/参与 Agent、ASR、讨论 TTS 和 live whiteboard Action；
- 完成、取消、失败后恢复主课堂；
- 等待学生、收到回答和提示层级使用 Teaching Semantic Event，不与 Trace/Span 混用。

## 6. 公开测试 seams

沿用 V1 已确认的 seams：

1. Provider adapter：能力输入、第三方 HTTP、归一化结果和错误映射；
2. Media service：owner、幂等、asset/task 生命周期和 worker lease；
3. Chalkboard core：Stage validation、navigation、Action execution 和 snapshot；
4. Classroom persistence：save/load、版本冲突、恢复和 owner/访问隔离；
5. Web adapter：HTTP response 到 runtime 的转换、缓存与失败降级；
6. Discussion stream：事件顺序、断线、abort、sequence 和恢复；
7. 浏览器用户 seam：目录发现、学习恢复、保存反馈、生成进度和课堂讨论。

测试只通过这些公开接口观察行为，不查询私有实现来证明成功。每轮只推进一个 seam 的一个
行为，禁止先批量创建所有 schema、mock 和测试再补实现。

## 7. 前端质量门禁

每个垂直切片都必须同时覆盖：

- desktop、tablet 和 phone；
- 键盘、焦点、触控目标和 screen-reader name；
- loading、empty、partial、forbidden、not found、conflict、offline 和 retry；
- 学生可理解的文案，不把 DAL、worker、provider 或 HTTP 术语泄露到界面；
- 不用静态假数据掩盖尚未完成的后端状态；
- 不回退 V1 已验证的播放、sandbox、内容净化和无横向溢出门禁。

## 8. 分支和文档生命周期

1. 更新并关闭 `feat/chalkboard-v1` 文档；
2. 将 `feat/chalkboard-v1` 合并到确认的集成分支；
3. 从合并结果创建 `feat/chalkboard-v2` 和 `.worktree/chalkboard-v2`；
4. 按 worktree runbook 分配独立端口、数据库和对象存储命名；
5. 创建 `docs/handoff/chalkboard-v2.md`，记录准确基线和环境；
6. 每个切片同步对应 spec、architecture 或 runbook，不把长期规则只留在本计划；
7. 所有切片完成或阶段停止后，将本计划标记为 `Historical`。

分支创建前不预写 V2 handoff 中的实际端口、数据库名、服务状态或已通过命令；这些只能在
新 worktree 中验证后记录。
