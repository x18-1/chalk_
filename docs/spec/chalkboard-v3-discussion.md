# Chalkboard V3 课堂讨论

> 文档状态：Accepted
> 适用范围：Chalkboard V3 第二个纵向切片；不追溯改变 V1/V2
> 参考实现：OpenMAIC `1466a55eef9e31e229a0e2e60a0811020d7b06e2`
> 最后核验：2026-08-28

## 1. 产品边界

课堂实时讨论是主播放时间线旁边的一条可恢复 Discussion Session。它可以由 authored
`discussion` Action 发起，也可以由学生从课堂 Chat 主动发起；两个入口进入当前 Scene 的同一条
Discussion Session。Chalk 通用 Chat 是跨课堂的通用 Agent 会话，与课堂讨论分开。

Discussion Action 仍是 Classroom Artifact 中不可变的编排内容，只描述发起点、主题、引导语和可选
首位 Agent；Discussion Transcript 是运行时产生的学生与课堂 Agent 发言。不得把运行时发言回写到
Artifact，也不得把 Discussion Action 本身伪装成已经发生的 Transcript。

第一版提供文本输入、流式文本回复、多 Agent Director 路由、浏览器原生语音输入、已有浏览器 TTS，
以及 Agent 驱动的 Live Chalkboard。学生自由手写黑板、面向用户的 Chalkboard Snapshot/History 和 PBL
不属于本规格。

## 2. 生命周期与归属

一条 Discussion Session 必须绑定以下二者之一，并由数据库约束保证互斥：

- 正式课堂：精确的 owner-scoped Learning Session，因此也间接绑定不可变 Classroom Artifact；
- Draft Classroom：精确的 owner-scoped Scene Generation Run。

Session 同时绑定一个真实存在于该运行上下文的 Scene，并保存进入讨论前的 Playback Cursor。正式课堂
以服务端 Learning Session cursor 为准；Draft Classroom 的进入位置由浏览器提交，但必须属于该 Draft
已经完成的 Scene。一个运行上下文的每个 Scene 只恢复最近一条未结束 Session。

发布 Draft 不会把 Draft Discussion Session 或 Transcript 迁移到新 Artifact 的 Learning Session。
草稿讨论保留在原 Generation Run 下；正式课堂从新的 Learning Session 开始。这避免把预览阶段、不同
内容版本或测试发言静默写进正式学习记录。

Discussion Session 状态为 `active | completed | aborted | failed`。Discussion Round 由一次学生发言或
authored Discussion Action 触发，包含一个或多个顺序 Agent 发言，直到 Director 决定等待学生或结束。
每次 Round 有独立 `running | completed | aborted | failed` 终态；同一 Session 同时只能运行一个 Round。

## 3. 参与者与编排

参与 Agent 从当前课堂文档的 `agentProfiles` 读取。V3 生成链路在大纲确认后、Scene 1 生成前创建并
持久化 3–5 个画像，且必须恰好包含一位 teacher；画像同时进入 Scene Action Prompt、Draft Classroom
和最终 Artifact。只有旧 Artifact、兼容导入或画像模型失败时才使用 Chalk 内建的受控 fallback，不能在
每轮讨论时临时生成另一套角色。客户端不能提交任意 persona、role 或系统 Prompt 覆盖服务端参与者。
真实学习者始终是 human participant，Transcript 中使用 `sender=student`；画像里的
`role=student` 表示明确标注的 AI “课堂同伴”，必须以 Agent 名称发言，不得冒充真实学习者或代其作答。

课堂讨论按 [ADR 0001](../adr/0001-langgraph-for-classroom-discussion.md) 使用 TypeScript LangGraph：

```text
START -> Director -> Participant Agent -> Director
                    ^                 |
                    |---- next -------|
Director -> awaiting student | completed
```

Director 只选择已验证的参与者 ID、`USER` 或 `END`。未被课堂文档授权的 ID、不可解析输出和超过轮次
上限都 fail closed；学生最新问题尚未被回答时必须优先路由 teacher。学生直接发言后先由 Director
判断：纯确认且没有新问题（例如“我懂了”）可以直接结束本轮，不能强制教师表扬后再让同伴虚构追问；
问题、困惑、挫败或含糊请求仍必须由 teacher 首先处理。每个 Round 最多三个 Agent 发言，
防止无人值守的循环和不可控成本。模型调用继续复用 Chalk 的 `@earendil-works/pi-ai` 用户 Provider、
凭据、默认模型和 thinking 配置；不新增 LangChain 模型 Provider。

Participant 每次发言必须收到当前课堂名称、Scene 类型与标题、播放 Action cursor、当前 Scene 的完整
内容，以及 cursor 已到达的教学 Action。不能只传 Scene 标题，否则 Agent 无法引用学生正在看的课件，
也容易产出与课堂无关的泛化鼓励。上下文是服务端从 owner-scoped Artifact/Draft 构造的只读投影，客户端
不能提交任意课堂上下文覆盖它；超长 JSON 必须在确定边界截断。

Participant 可以输出与自然语言交错的结构化 Live Chalkboard Action。兼容 OpenMAIC 的底层协议名保持为
`wb_open`、`wb_draw_*`、`wb_edit_code`、`wb_delete`、`wb_clear` 和 `wb_close`；产品领域与界面称为
Live Chalkboard / 实时黑板。服务端必须先严格校验坐标、参数、元素 ID 冲突和编辑目标，再更新当前
Chalkboard state；无效 Action 丢弃且不能进入 SSE 或持久化记录。Action 静默执行，Agent 不能在口头讲解
中播报工具名；每次绘制仍须包含一段自然讲解。

同一 Participant 的 Action 和文本必须保持模型输出顺序。下一位 Agent 和 Director 必须看到此前已接受的
Chalkboard state，避免重复绘制或编辑不存在的元素。单次 Agent 发言的 Action 数量有界，防止异常输出
无限占用画布与数据库。

## 4. 持久化与恢复

PostgreSQL 是 Discussion Session、Round 与 Transcript 的唯一权威状态。浏览器和 LangGraph state 都是
可丢失的投影。每条 Transcript Message 至少记录：严格递增 sequence、发送者类型、可选 Agent ID/名称/
角色、文本、已接受的 Chalkboard Action ledger、状态与时间；不得把完整 Prompt、凭据或学生画像写入普通日志。

流式 Agent Message 先以 `streaming` 状态写入，再按有界 checkpoint 保存已经对学生可见的文本，最终转为
`completed`。请求取消、连接断开或服务进程恢复时，未完成 Message 转为 `interrupted`，Round 转为
`aborted` 或 `failed`；已持久化文本仍可恢复，但不会假装是完整答复。学生可以在同一 Session 提交
新 Round 继续讨论。每个 token 都同步写数据库不是契约要求；正常完成和中断边界必须强制落盘，长回复
中间以批量 checkpoint 限制进程故障时的最大丢失范围，SSE 不应被逐 token 数据库往返串行阻塞。
Chalkboard Action 必须在向浏览器发送对应 SSE 事件之前写入当前 Message；刷新、断线和进程恢复时按已持久化
ledger 重建画布，不能依赖浏览器内存。后续 Agent 的初始画布由当前 Scene 已执行的 authored `wb_*`
Action 与 Discussion Transcript ledger 顺序折叠得到。

所有 Session、Round、Message 的读取和写入必须在 DAL SQL 中包含 owner 条件，并使用 owner 复合外键
串起父子资源。认证缺失 fail closed；跨 owner 访问返回资源不存在。服务启动时清理超过恢复宽限期的
遗留 `running` 状态；不得把另一 API 实例刚启动的 Round 误判为进程中断，也不得仅依赖单进程内存
判断数据库中的 Round 是否仍在运行。

## 5. HTTP/SSE 契约

公开边界为 Fastify HTTP/SSE：

- `POST /classroom-discussions`：对当前运行上下文和 Scene 创建或恢复 active Session；
- `GET /classroom-discussions/current`：按运行上下文和 Scene 恢复 active Session 与 Transcript；
- `GET /classroom-discussions/:id`：恢复指定 owned Session 与 Transcript；
- `POST /classroom-discussions/:id/rounds/stream`：提交学生消息或启动 authored topic，串流一个 Round；
- `POST /classroom-discussions/:id/abort`：取消当前 Round；
- `POST /classroom-discussions/:id/complete`：显式结束 Session 并返回进入前 cursor。

SSE 事件使用稳定类型：`round_started`、`agent_started`、`action`、`text_delta`、`message_completed`、
`awaiting_student`、`round_completed` 和 `error`。事件中的 sequence/message ID 来自服务端持久化记录。
断线后客户端用 GET 恢复 Transcript，而不是重放请求体或信任本地 Director state。
`action` 事件包含当前持久化 message ID、sequence、agent ID 和通过校验的 Action；它与 `text_delta`
严格按服务器接收顺序发送。

## 6. 前端行为

authored Discussion Action 到达时主播放暂停，右侧“课堂讨论”面板自动打开并显示主题；学生确认“开始讨论”后，
由 Action 指定且属于当前课堂的首位 Agent 开场，无效 ID fail closed 到教师。学生也可以直接用文本或
浏览器语音作答。右侧面板是同一 Session 的参与者名册、紧凑 Transcript 和自由追问入口，页面底部不再
保留第二套讨论 Dock，也不维护两份输入状态。
Agent 文本按 SSE 增量显示；讨论语音使用独立于课件播放执行器的浏览器 TTS 生命周期，并把流式文本按
完整句子封口后进入队列。多个 Agent 必须显示各自名称与角色，
不能合并成一个没有来源的“AI”气泡。TTS 必须使用 FIFO 队列：只有上一条 utterance 收到 `end/error`
或被用户明确取消后，下一位 Agent 才能开始说话；收到后续 SSE Message 不得调用 `cancel()` 打断前一位。
右侧面板必须显示当前发言者、排队段数和暂停/继续语音操作。Discussion Round 正在生成、停止或完成，
或者讨论语音仍 active 时，课件播放不得静默打断讨论；Scene 与 pending Scene 导航仍可发起，但必须先展示
切换确认。学生取消时保留当前 Round 和语音，确认时停止当前 Round 与语音后再切换，已完成的 Transcript
和 Chalkboard ledger 不得丢失。仅 Discussion Session 仍为 active、但 Round 与语音均已空闲时不得弹出
确认或锁住 Scene：学生可以直接切换，并在返回原 Scene 后恢复同一条 Session、Transcript 和 Chalkboard ledger。

加载、空状态、断线、取消、Provider 失败和 interrupted Message 都必须可辨识并提供恢复动作。流式期间
禁止重复提交；取消只终止当前 Round，不删除已完成 Transcript。结束讨论后恢复进入前 Scene/Action
位置，已消费的 authored Discussion Action 不得再次触发。

收到 `action` 事件时，主课堂画布立即打开 Live Chalkboard，并在口头讲解继续播放的同时顺序应用绘制、
编辑、删除、清空和关闭操作。刷新后从 Message ledger 恢复相同结果；下一条纯文本增量不得重置或重复播放
已经完成的 Chalkboard Action。首版渲染文本、形状、公式、表格、图表、线条与代码块。

## 7. Prompt 与来源

Director 与 Participant Agent Prompt 集中维护英文运行版和中文审阅版。迁移 OpenMAIC 原文时在 registry
记录固定提交、来源路径和 hash。Director 固定来源模板保持原有 whiteboard 占位符以维持逐字节 provenance；
运行时注入与 Participant 适配使用 Live Chalkboard 领域名称。Participant Prompt 恢复结构化 Action 协议，
并在 provenance metadata 或测试中记录适配原因。Prompt revision、
模型 Provider/ID 与 Round 关联，但完整渲染 Prompt 不持久化。

## 8. 验收

自动化测试至少证明：

1. 匿名拒绝、跨 owner 404、正式 Artifact 与 Draft Generation Run 的目标校验；
2. 同 Scene 创建/恢复一致，正式与 Draft Transcript 不串线，发布不迁移草稿 Transcript；
3. Director 只能选择允许参与者，最多三个 Agent 发言，在学生问题后优先 teacher，并允许纯确认直接 END；
4. SSE 增量、正常完成、浏览器取消、连接断开和进程恢复都留下可恢复的确定终态；
5. Prompt 双语结构、英文运行时、来源 hash/必要适配与模型审计字段；
6. Web authored 入口、右侧课堂讨论自由追问、刷新恢复、多 Agent 身份/画像、错误/重试/取消和返回课堂；
7. 两条已完成 Agent Message 连续到达时，浏览器 TTS 严格串行且后一条不能中断前一条；
8. API unit/integration、Web typecheck/lint/build 与 Chalkboard Playwright 通过。
9. 合法 Chalkboard Action 与文本按顺序 SSE 到达、严格校验、跨 Agent 共享状态，并在刷新后从数据库 ledger
   恢复；文本、公式、形状、表格、图表、线条和代码均有实际渲染而非 JSON 占位。
