# Chalkboard V1 内容生成

> 文档状态：Accepted
> 适用范围：Chalkboard V1 产品能力；实现跨 `feat/chalkboard-v1` 与 `feat/chalkboard-v2` 工程阶段

## 生成链路

后端生成采用可恢复的分段流程：

```text
requirements / context
  -> Classroom Draft
  -> scene outlines
  -> scene content
  -> scene actions
  -> image / video assets
  -> validate
  -> Classroom Artifact
```

每一段完成后都可以持久化。单个 Scene 或媒体失败时，已完成部分不能丢失，
必须能重试或明确结束为失败。

Requirements/context、大纲、Scene content、Scene actions、生成状态和最终规范化课堂文档都属于
服务端业务数据，以 PostgreSQL 为权威存储；图片、音频、视频等二进制媒体存入对象存储，JSON
只保留稳定媒体引用。Chalk 原生 `.chalk.zip`、兼容 `.maic.zip` 或独立 JSON 是根据 Artifact
与媒体按需生成的导出/导入交换格式，不作为课堂生成或学习运行时的数据源。

一次可追踪的生成尝试称为 `Generation Run`。Generation Run 只更新自己的
Classroom Draft；重试必须幂等，完成校验前不能产生或覆盖 Classroom Artifact。校验完成后
产生新的、不可变的 Classroom Artifact，既有 Learning Session 继续绑定原 Artifact，
不静默迁移。

## 当前 Generation Run 接口

Chalkboard V2 已接通 outline、scene content、scene actions、media tasks 和 Artifact 发布。认证用户提交
`requirements` 和可选 `context.sourceText` 后，服务端先创建属于该用户的 Classroom Draft 与
outline Generation Run，并立即返回 `202 queued`；后续 content/actions 各自由前一已完成阶段创建
独立 Generation Run；已完成 actions run 可以创建 media tasks run，并按需生成大纲已规划的图片/视频。
数据库 worker claim 后再调用 LLM 或媒体 Provider。大纲、content 和 actions JSON 通过服务端
契约校验后写入 Draft 的 PostgreSQL `jsonb`；不写 MinIO，也不成为 `.chalk.zip`/`.maic.zip` 归档。
失败只持久化稳定错误码，同一 owner 可以在同一个 run/draft 上递增 attempt 重试，其他账号包括
admin 均返回 404。worker 用 lease/heartbeat 回收 orphan-running；应用停止会释放 claim，非优雅
退出则由其他实例在 lease 过期后继续。取消会传到进行中的模型请求，并以明确 `aborted` 终态持久化。
认证 Web 客户端通过 `GET /classroom-generation-runs/current` 恢复当前 owner 最近一条未发布、未取消的
Generation Run；该查询在 DAL 同时约束 Run、Draft 的 `userId`，匿名请求 fail closed。刷新后只恢复
已持久化状态和轮询，不自动触发 retry 或新的模型调用；失败任务仍由用户明确点击补生成。Draft 发布
成功后不再属于 current Run。

V2 Web 的教师 `speech` Action 始终使用浏览器原生 `SpeechSynthesis`，提供播放、暂停、恢复和取消。
浏览器语音的语言、voice URI、语速和音量，以及图片/视频的默认 Provider、模型与视频规格，都是
owner-scoped 用户能力设置，保存在 PostgreSQL；Settings 负责配置，Chat 可查看和切换默认能力。
Chalkboard 默认继承该选择，并允许从同一 Provider 目录中为当前 Generation Run 改选已经配置的
图片/视频 Provider 与模型；本次选择写入 Classroom Draft，不反向修改全局默认；
Web 创建 media run 时不提交 TTS 配置，也不生成后端音频 task。后端 media API 仍兼容显式 TTS task，
供既有调用方或后续版本评审，但它不是 V2 Web 路径、运行时依赖或完成门禁。图片/视频只从用户显式启用
能力后由大纲 `mediaGenerations` 规划，不得从 Scene 内容臆造。任务状态、attempt、稳定错误码、内容
hash、大小、Provider/模型和稳定媒体引用写 PostgreSQL，二进制写对象存储。单条完成后在同一数据库
事务中把 `mediaRef` 回写 Draft JSON。兼容 TTS task 完成时可回写 `audioRef`；图片支持同步 bytes/URL 归一化；视频保留 Provider
异步 submit/poll 边界并先持久化 `providerTaskId`，恢复时不重复 submit。失败不泄露 Provider 详情，
重试只处理未完成 task，同一 task 使用稳定对象 key。

大纲、slide/quiz/interactive content 和对应的 Scene actions 都属于一次有明确输出契约的模型 completion，因此通过
`@earendil-works/pi-ai` 的统一模型目录与 `completeSimple` 调用，不启动带 Tool loop 的 Agent。
每次 completion 的输出上限必须来自当次已选模型在统一目录中的 `maxTokens`，不得另设小于模型能力的
课堂生成固定上限；这与固定 OpenMAIC 生成链路使用所选模型 `outputWindow` 的行为一致。Pi 返回
`stopReason=length` 时不得把截断文本当作普通格式错误，Scene 必须以对应的稳定 `*_CONTENT_TRUNCATED`
错误结束并允许在同一个 run 上重试。调用策略沿用固定 OpenMAIC 阶段边界：outline 最长 300 秒；
Scene content 最长 300 秒且不做 Pi 内部重试；Scene actions 最长 60 秒且不做 Pi 内部重试。content/actions
的网络或输出错误由 Generation Run 的持久化 attempt 负责恢复，避免一次不可见调用在 adapter 内重复执行。
Scene content run 从已持久化 outline 初始化 owned Scene 行，按 order 逐个生成并立即提交；失败时
保留已完成 Scene，重试跳过 completed，只增加未完成 Scene 的 attempt。每个 Scene 分别记录 Prompt
revision 和实际 provider/model。Scene actions run 只能从已完成的 content run 创建，同样按 order
逐 Scene 生成并提交；slide 输出经过 Action 契约及元素目标校验，quiz 的可执行动作类型限制为
speech，英文 Prompt 明确要求讲解不能提前泄露答案。interactive 支持 OpenMAIC 的 simulation、diagram、
code、game 和 visualization3d 五类 widget；模型必须返回完整 HTML document、单一 `widget-config`
以及四种 widget message protocol。互动 Action 只能引用已生成 HTML 中存在的稳定 selector，不接受
模型臆造目标。旧版 `interactiveConfig` 在大纲边界按 OpenMAIC 既有规则归一化为
`widgetType/widgetOutline`。interactive 校验失败会按缺失、过大、不完整、多文档、配置缺失/重复/非法、
widget 类型不符、message protocol 不完整和稳定 selector 缺失分别持久化稳定错误码；未知内部异常才
使用通用 invalid 错误，Provider 原始输出和异常不会进入 API。失败重试只补未完成 Scene，不覆盖已经完成的
动作；不合法或空的结构化输出以稳定错误失败，不在服务端伪造兜底 Action。后续若某类 Action 需要
工具、参与 Agent、
审批或多轮上下文，再复用现有 `@earendil-works/pi-agent-core` runtime；不建立第二套 LLM Provider
或 Agent Runtime。

outline、scene content、scene actions 和 media tasks 的 `completed` 都只表示对应 Draft 阶段完成，
不会自动产生 Artifact。owner 必须显式调用 publish；服务端组装完整 Stage/Scene/Action 文档，执行
normalize、Chalkboard DSL、占位符和媒体引用完整性校验，通过后才提升 Draft 媒体并在单个事务中创建
Classroom、不可变 Artifact、媒体元数据和 Draft 发布关联。发布使用持久化 reservation/lease 和稳定
目标 ID；对象复制或数据库提交失败会删除本次目标，硬中断后的重试复用同一 namespace，防止不断
制造 orphan。重复发布返回原 Classroom/Artifact，不产生新版本。PBL content/actions
仍属于后续阶段；unsupported 类型必须以稳定错误停止，不得伪装成其他 Scene 类型。

## V3 边界

V1/V2 的完成门禁是上述可恢复分阶段生成、逐 Scene 持久化和完整 Artifact 显式发布；当前 Web
可以查看各阶段和各 Scene 的进度，但不提供以下产品体验：

- 大纲生成时通过 SSE 逐步显示已解析 Scene；
- 在 content 生成前编辑、添加、删除或重排序大纲，并配置 quiz/interactive；
- 第一幕 content/actions 完成后立即进入生成中课堂，后续 Scene 逐幕出现；
- 生成中 Draft Preview 与正式 Learning Session 的衔接。

这些能力已延后到 [Chalkboard V3 渐进式课堂生成](chalkboard-v3-generation.md)，不作为 V1/V2
人工验收或提交门禁。V3 设计不得把未完成 Draft 当作已发布 Artifact，也不能放宽现有 owner、恢复和
认证约束。

## 兼容约束

- 生成结果必须通过 Chalkboard DSL 校验和 normalize；
- V1 继续使用 Stage/Scene/Action，不引入 Beat/Checkpoint；
- OpenMAIC 来源 Prompt 按固定提交做 provenance 和字节级校验，非必要不修改英文内容；
- Prompt 按 [Prompt 管理规范](../architecture/prompts.md) 集中维护英文执行版和中文审阅版，
  Generation Run 只读取英文版；
- 生成 API 不直接把第三方 Provider SDK 类型暴露给客户端；
- Prompt、Stage 和媒体引用的 owner 归属由 API Service/DAL 强制执行。

## 非目标

本 SPEC 不定义 Chalk 的长期学习策略、知识点图谱、题型掌握度或几何生成。
