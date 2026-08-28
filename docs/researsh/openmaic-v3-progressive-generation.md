# OpenMAIC 渐进式课堂生成迁移取证

> 文档状态：Historical（固定提交的事实快照，不是 Chalk 权威设计）
>
> 调研日期：2026-08-27
>
> 研究对象：`THU-MAIC/OpenMAIC@1466a55eef9e31e229a0e2e60a0811020d7b06e2`
>
> 本地来源：`.reference/OpenMAIC` submodule；本次已核验其 `HEAD` 与固定提交完全一致
>
> 资料原则：只使用该提交的源码和测试。文中的“未发现测试”只表示在该提交内按相关路径、符号和行为检索后未发现直接覆盖，不表示上游从未在其他提交或外部环境验证。

## 结论摘要

Chalkboard V3 要迁移的两部分在 OpenMAIC 中已经形成一条明确产品链路，不需要重新设计：

1. 服务端从 LLM 的局部 JSON 文本中提取**语法完整、可 `JSON.parse` 的单个 outline 对象**，再用 SSE 逐条发给浏览器；用户可以在流尚未结束时展开审阅，但此时编辑和确认均被禁用。流完成后，用户可以编辑、增删、重排、改类型并确认；默认设置下若用户不介入，2.5 秒后自动继续。
2. generation preview 只同步完成 Scene 1 的 `content -> actions -> optional TTS`，将完整 Scene 保存后立即进入 classroom；classroom 再启动剩余 Scene。默认逐幕串行，只有显式配置并发值大于 1 时才预取各幕 content，结果仍按 outline 顺序消费；actions 和 TTS 维持逐幕顺序。媒体工作相对 Scene 主循环异步启动，但媒体队列自身在该提交中是串行处理。

必须同时保留一个边界：OpenMAIC 的恢复权威状态主要在浏览器 `sessionStorage`、Zustand 和 IndexedDB，认证/owner 隔离也不是 Chalk 的企业级边界。Chalk 应迁移上游的**产品阶段、输入依赖、提交点和失败语义**，把其浏览器状态替换成 owner-scoped PostgreSQL Outline Revision、Classroom Draft 和 Generation Run；不能照搬易失状态或把正式 Classroom Artifact 提前暴露。

本次取证还发现几项需要在实现/测试中明确锁定的细节：

- OpenMAIC 所谓“完整 outline”是 JSON 语法完整，不代表已经做运行时 schema 校验；Chalk 必须在发出事件和持久化前执行自己的契约校验。
- 上游 `done.outlines` 会统一重写媒体 placeholder ID，而先前逐条 `outline.data` 没有经过这一步，因此 `done` 可能不是逐条事件的逐字节复本。Chalk 不能据此建立两个互相漂移的权威版本。
- outline retry 会撤销客户端已展示的本次尝试结果并从空列表重新开始；断线则直接中止上游 LLM 请求。OpenMAIC 不持久化半途的 outline 流，刷新会重新发起整个 SSE。
- Scene 失败时已加入 Stage 的前序 Scene 会保留；单幕 retry 从 `content` 重新开始。但 OpenMAIC 的 `failedOutlines` 是瞬时状态，刷新后的自动恢复是用“已持久化 outlines 减已持久化 scenes”重新计算 pending，不能直接等价为一套持久化失败状态机。

## 1. 权威源码地图

以下路径均相对于 `.reference/OpenMAIC`，内容固定在上述 commit：

| 主题 | 路径与主要符号 |
|---|---|
| outline SSE route 与增量 parser | `app/api/generate/scene-outlines-stream/route.ts`：`extractLanguageDirective`、`extractCourseTitle`、`extractNewOutlines`、`POST` |
| generation preview 总编排 | `app/generation-preview/page.tsx`：`waitForOutlineReviewChoice`、`startGeneration`、`handleExpandStreamingOutline`、`handleCollapseEditor`、`handleConfirmOutlines` |
| 审阅状态 | `app/generation-preview/types.ts`：`GenerationSessionState.previewPhase` |
| outline 编辑器 | `components/generation/outlines-editor.tsx`：`OutlinesEditor`、`normalizeOrder`、`SceneRow` |
| outline 类型编辑 | `lib/generation/outline-type.ts`：`changeOutlineType` |
| Scene 客户端 API 与后续调度 | `lib/hooks/use-scene-generator.ts`：`fetchSceneContent`、`fetchSceneActions`、`generateTTSForScene`、`useSceneGenerator.generateRemaining`、`retrySingleOutline` |
| Scene content route | `app/api/generate/scene-content/route.ts`：`POST` |
| Scene actions route | `app/api/generate/scene-actions/route.ts`：`POST` |
| content/actions 生成器 | `lib/generation/scene-generator.ts`：`generateSceneContent`、`extractInteractiveElements`、`generateSceneActions` |
| 跨幕 speech 上下文 | `lib/generation/prompt-formatters.ts`：`buildCourseContext` |
| Scene 组装与 outline 关联 | `lib/generation/scene-builder.ts`：`buildCompleteScene` |
| Scene 1 之后的课堂接手 | `app/classroom/[id]/page.tsx`：pending 检测及 `generateRemaining` 调用 |
| Stage 增量保存与恢复 | `lib/store/stage.ts`：`addScene`、`setOutlines`、`saveToStorage`、`loadFromStorage`、`flushStageSave` |
| 媒体调度 | `lib/media/media-orchestrator.ts`：`generateMediaForOutlines`、`retryMediaTask` |
| 重试分类 | `lib/generation/generation-retry.ts`：`withGenerationRetry`、`isRetryableGenerationError` |

固定提交的 GitHub 源码入口：[`THU-MAIC/OpenMAIC@1466a55`](https://github.com/THU-MAIC/OpenMAIC/tree/1466a55eef9e31e229a0e2e60a0811020d7b06e2)。

## 2. Outline 流式生成、parser 与 SSE

### 2.1 实际 SSE 契约

route 文件头声明并由实现发出的数据事件如下（`.reference/OpenMAIC/app/api/generate/scene-outlines-stream/route.ts:1-14`、`:485-533`、`:548-617`）：

| `type` | payload | 何时发出 |
|---|---|---|
| `languageDirective` | `{ data: string }` | 首次从累计文本头部解析出完整 JSON string 时 |
| `courseTitle` | `{ data: string }` | 首次从累计文本头部解析出非空标题时；trim 后最多 120 字符 |
| `outline` | `{ data: SceneOutline, index: number }` | 一个顶层对象的大括号闭合且 `JSON.parse` 成功后 |
| `retry` | `{ attempt, maxAttempts }` | 当前尝试没有任何 outline，或流抛错，且仍有重试预算 |
| `done` | `{ outlines, languageDirective, courseTitle?, taskEngineMode }` | 至少成功解析一个 outline 后 |
| `error` | `{ error: string }` | 三次尝试均无 outline，或外层流处理异常 |

此外，route 每 15 秒发送一次 SSE comment `:heartbeat`，不是业务事件；响应是 `text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive`（同文件 `:393-421`、`:637-643`）。

因此迁移时可以忠实保留六种业务事件，但不应把 heartbeat 当作可持久化 Run 事件，也不应为 Scene content/actions 发明同类 SSE。

### 2.2 增量 parser 的精确行为

`extractNewOutlines(buffer, scanFrom)` 的行为是（同文件 `:105-176`）：

1. 首次扫描优先查找 `"outlines"` 后面的 `[`；没有 wrapper key 时退化到首个 `[`，所以同时接受 wrapper object、裸数组和外层 Markdown fence。
2. parser 跟踪字符串、反斜线转义和大括号深度，只在顶层对象的 `}` 完整闭合后截取子串。
3. 对截取子串调用 `JSON.parse`；解析失败就跳过该对象，不发原始文本、不发半截对象。
4. `scanFrom` 记录上一个完整对象末尾，下一个 chunk 从该处继续，总扫描复杂度保持 O(n)，而不是每个 chunk 重扫全缓冲区。
5. route 为对象重写连续的 `order = parsedOutlines.length + 1`，为空或重复的 outline ID 生成唯一 ID，然后才发 `outline` 事件（同文件 `:270-283`、`:509-533`）。

这保证的是**完整 JSON 对象边界**，不是 `SceneOutline` 的运行时 schema 完整性。实现将 `JSON.parse` 的结果直接压入 `SceneOutline[]`，没有检查 `type/title/description/keyPoints` 等必填字段（同文件 `:115-175`）。部分模式会做类型归一化或降级，但那不是通用 schema validator（同文件 `:178-268`）。

Chalk 的迁移约束因此是：复用“只公布完整对象”的流式体验和 O(n) 解析策略，但每条事件必须在服务端通过 Chalk 的输入/领域 schema；验证失败应进入受控 retry/failure，而不是以 TypeScript assertion 代替验证。

### 2.3 wrapper 字段、资源上限和最终集合

- `languageDirective` 和流中 `courseTitle` 只扫描累计文本前 8 KiB；标题在流结束后若仍缺失会额外全缓冲区扫描一次，language directive 没有对称的全量 fallback（同文件 `:45-103`、`:537-544`）。
- 累计输出上限是 512 KiB；超过后停止继续读取，以此前已经解析出的 outline 决定 `done` 或失败（同文件 `:417-421`、`:476-483`）。
- route 最多重试两次，即总共三次尝试；每次都清空 `parsedOutlines`、directive、title、ID 集和 parser 游标（同文件 `:449-466`）。retry 是立即重新调用流，没有该 route 自己的退避。
- `done` 前调用 `uniquifyMediaElementIds(parsedOutlines)`，把各 outline 内顺序式媒体 placeholder 改为全局唯一 ID（同文件 `:596-607`；实现位于 `lib/generation/scene-builder.ts`）。此前已经发出的单条 `outline` 事件没有经过这次最终重写。

最后一点是上游真实的不对称行为。Chalk 应在以下两种忠实迁移方案中选择不会产生双重权威的一种：要么在逐条发布前完成稳定 ID 归一化；要么把 `done` 中确认的完整集合固化为唯一 Outline Revision，并明确逐条事件只是预览。不要假定逐条事件拼接后一定与 `done.outlines` 深相等。

### 2.4 客户端如何消费 SSE

`startGeneration` 使用普通 `fetch` + `ReadableStreamDefaultReader` 逐行解析 `data: `，而不是浏览器 `EventSource`；所有业务事件都编码在 JSON 的 `type` 字段中（`.reference/OpenMAIC/app/generation-preview/page.tsx:577-701`）。

- `outline` 追加到 `collected` 并立即更新预览。
- `retry` 清空 `collected`、directive、title 和可见列表；也就是说前一尝试曾展示的 Scene 会被撤销。
- `done` 优先采用 `evt.outlines`，没有才采用 `collected`。
- 如果底层流自然结束但没有 `done`，只要已收集至少一个 outline，客户端仍把它当成功；否则报空响应错误。
- 客户端对单行 JSON 解析失败只记录日志并继续。

OpenMAIC route 将 `req.signal` 传给 LLM；客户端断开后停止 heartbeat 和生成，且不会消耗余下 retry（route `:426-447`、`:468-474`、`:568-574`）。它没有 SSE event ID、Last-Event-ID 或服务端 run checkpoint，所以这不是可续传流。

## 3. Outline review、edit 与 confirm

### 3.1 状态机与默认路径

`GenerationSessionState.previewPhase` 只有四个值（`.reference/OpenMAIC/app/generation-preview/types.ts:11-43`）：

```text
preparing
  -> outline-ready   # 流结束，默认不强制审阅
  -> review          # 用户提前展开，或“总是审阅”偏好开启
  -> generating-content
```

完整流结束后，`reviewOutlineEnabled || userOpenedReviewEarly` 决定进入 `review` 还是 `outline-ready`。若不审阅，`waitForOutlineReviewChoice` 在 2500 ms 后自动用原 outlines resolve；若审阅，promise 一直停住，直到确认或折叠后重新启动 2500 ms 定时器（`.reference/OpenMAIC/app/generation-preview/page.tsx:61`、`:199-228`、`:709-735`、`:1121-1172`）。

因此，“OpenMAIC 要求每次必须显式确认”不是源码事实。准确行为是：

- 默认给用户一个 2.5 秒可介入窗口，然后自动继续；
- 用户可以保存“以后总是审阅”的偏好，使后续每次停在 review；
- 用户在流中提前展开也会让本次生成停在 review；
- 最终进入 Scene content 代表用户显式确认，或默认计时器已自动接受。

如果 Chalk 产品已经确认“必须显式确认才能固化 revision”，这是有意的 Chalk 产品/审计适配，应在 spec 标注为适配，而不能写成 OpenMAIC 原行为。

### 3.2 流中展开：可看，不可改

用户在 SSE 期间点击 outline 卡片时，`handleExpandStreamingOutline` 只记录 sticky review intent 并把界面切到 `review`；SSE 不停止（page `:1108-1119`）。编辑器收到 `isStreaming=true` 后令 `editingDisabled = isLoading || isStreaming`，禁用增删、重排、字段修改和确认按钮（`.reference/OpenMAIC/components/generation/outlines-editor.tsx:111-138`、`:401-420`）。

所以准确迁移语义是：**SSE 未完成时可以展开完整审阅表面并继续看到新增 Scene，但只能阅读；编辑从最终 outline 集合完成后开始。**

### 3.3 流结束后的可编辑能力与确认门禁

`OutlinesEditor` 支持：

- 新增、插入、删除 Scene；
- 拖拽或键盘上下重排；每次操作用 `normalizeOrder` 重写为 1-based 连续顺序；
- 修改 title、description、key points；
- 在 `slide | quiz | interactive | pbl` 间改类型，并为目标类型补对应默认配置、清除异类配置（editor `:87-92`、`:156-220`、`:429-709`；`lib/generation/outline-type.ts:12-95`）。

确认门禁是：不在 loading、SSE 已结束、至少一条 outline，且没有空标题。`validateOutline` 唯一的 blocking issue 是 `emptyTitle`；description/key points 为空并不阻止确认（`.reference/OpenMAIC/lib/edit/content-validation.ts:25-28`、`:61-73`；editor `:385-420`）。

`handleConfirmOutlines` resolve 等待中的 promise；刷新后若 promise 不存在，则直接把已持久化 session phase 改为 `generating-content` 并重新调用 `startGeneration`（page `:1175-1216`）。确认本身在 OpenMAIC 没有不可变 revision ID，只是把最终 outlines 写回 `sessionStorage` 后继续。

### 3.4 刷新和返回的上游语义

- 最终 outlines 和 review phase 已写入 `sessionStorage` 时，刷新可重新显示编辑器并确认；E2E 对此有直接覆盖（`.reference/OpenMAIC/e2e/tests/generation-flow.spec.ts:126-143`）。
- 若用户在 SSE 期间展开后刷新，由于 streaming outlines 没写进 session，应用保留 review intent 但从头重启 SSE（page `:230-254`、`:297-314`）。
- 返回 requirements 会 abort 当前请求、清理 timer 和 `generationSession`；原 requirements draft 直到确认或自动接受 outline 后才被删除（page `:737-745`、`:1100-1105`）。

Chalk 应保留这些用户可感知结果，但把恢复源换成数据库：刷新后读取 Outline Run/Revision，而不是信任 tab-local session；取消必须写入 Run 状态；认证缺失 fail closed；跨 owner 不得根据可猜 ID 恢复任何 outline。

## 4. Scene content/actions、Scene 1 切换与后续调度

### 4.0 必须取证渐进式浏览器路径，而不是整课 batch 路径

OpenMAIC 同一仓库另有 `lib/server/classroom-generation.ts`、`app/api/generate-classroom/route.ts` 和 `lib/server/classroom-job-runner.ts` 组成的服务端整课 job：它非流式生成 outline，在服务端循环生成全部 Scene，之后处理媒体/TTS，最后整体持久化。那条路径没有“Scene 1 完成后先进入课堂、其余 Scene 在课堂中继续”的切换点（`.reference/OpenMAIC/lib/server/classroom-generation.ts:333-352`、`:416-572`）。

V3 的参考实现只能是 `app/generation-preview/page.tsx -> app/classroom/[id]/page.tsx -> lib/hooks/use-scene-generator.ts` 这条 progressive browser path。Chalk 可以把执行位置迁到数据库 worker，但不能因此把上游 batch 路径的“全课完成再保存/展示”顺序混进产品链路。

### 4.1 两段式 HTTP 边界

OpenMAIC 将 Scene 拆成两个普通 POST：

1. `/api/generate/scene-content` 接收当前 `outline`、`allOutlines`、stage/material/agent/language 等上下文，调用 `generateSceneContent`，返回 `{ content, effectiveOutline }`（`.reference/OpenMAIC/app/api/generate/scene-content/route.ts:34-80`、`:139-197`）。
2. `/api/generate/scene-actions` 接收当前 outline、完整 outline 列表和**刚生成的真实 content**，创建 course context，生成 actions，再 `buildCompleteScene`，返回 `{ scene, previousSpeeches }`（`.reference/OpenMAIC/app/api/generate/scene-actions/route.ts:35-80`、`:136-176`）。

客户端包装器 `fetchSceneContent` 和 `fetchSceneActions` 都是普通 `fetch`，`UseSceneGeneratorOptions.onPhaseChange` 仅是本地 callback，未新增 Scene SSE（`.reference/OpenMAIC/lib/hooks/use-scene-generator.ts:127-229`、`:398-403`）。

### 4.2 Content 的依赖和并发边界

`generateSceneContent` 只根据**当前 outline**及材料、媒体 mapping、agent/persona、language 等选项按类型路由，不接受 previous Scene content/actions（`.reference/OpenMAIC/lib/generation/scene-generator.ts:194-276`）。客户端虽然也传 `allOutlines` 给 route，但 route 的 content generator 调用没有将前序 Scene 结果注入进去。

后续调度默认串行。只有 `parallelSceneConcurrency > 1` 且 pending Scene 多于一幕时，才用 `lazyBoundedMap` 预启动 content；`.env.example` 明确默认 `0/unset` 为关闭、上限在配置层限制为 10（`.reference/OpenMAIC/.env.example:266-269`；`lib/hooks/use-scene-generator.ts:488-551`）。

即使预取开启，也不存在“所有 content 完成后再统一生成 actions”的 barrier。主循环仍按 outline order `await` 对应 content promise，然后立即完成该 Scene 的 actions/TTS/commit；后面的 content 只是在后台提前跑（hook `:500-576`）。

### 4.3 Actions 必须依赖真实 content/inventory

Actions 不是从 outline 单独生成：

- slide actions prompt 注入生成后 `content.elements` 的 ID/type/摘要；返回动作还要对真实 element ID 做处理和校验（`.reference/OpenMAIC/lib/generation/scene-generator.ts:1519-1547`、`:1668-1720`）。
- quiz actions prompt 注入真实 questions（同文件 `:1549-1575`）。
- interactive actions 每次从**当前生成 HTML**重新抽取 ID、稳定 data attributes 和语义 class inventory，再注入 prompt，避免模型猜不存在的 selector（同文件 `:1213-1320`、`:1577-1615`；`lib/prompts/templates/interactive-actions/system.md:88`）。
- PBL 是上游例外：真实 content 用于确认进入 `projectConfig` 分支，但 actions prompt 的项目字段主要取自 outline 的 `pblConfig`，没有像 slide/quiz/interactive 那样把完整 current content/inventory 格式化进 prompt（同文件 `:1618-1643`）。

PBL 不属于 Chalk V3；对于 V3 迁移的 slide/quiz/interactive 子集，不能把 content 和 actions 当成互不相关的两个模型任务，也不能只凭 outline 预生成 actions。Actions Run 必须读取当前 revision 下已校验并持久化的 Scene Content 及实际元素 inventory。本文保留 PBL 源码事实只是为了界定 OpenMAIC 行为，不能把它转化为 V3 实施项。

### 4.4 跨 Scene 依赖仅在 actions speech 过渡

Actions route 从完整 outline 得到课程标题序列和当前页位置，并接收上一幕 speech 文本。`buildCourseContext` 只注入上一页 speech 数组的**最后一条 speech 的末尾 150 字符**，用于自然过渡（`.reference/OpenMAIC/app/api/generate/scene-actions/route.ts:136-153`；`lib/generation/prompt-formatters.ts:8-49`）。

成功生成一幕后，客户端把这幕的所有 speech 文本作为下一幕 `previousSpeeches`；下一次 prompt 实际只取数组最后一条（actions route `:167-176`；hook `:604-660`）。

因此不要为迁移自行引入“上一幕 content 摘要”“全课逐幕 transcript”“上一幕 actions JSON”之类新依赖。忠实依赖是：content 无跨幕依赖；actions 严格按幕消费，并获得上一幕最后一句 speech 的末 150 字符。

### 4.5 Scene 1 是 preview 到 classroom 的提交门槛

generation preview 在 outline（及可选 agent profile）完成后只取 `outlines[0]`：

```text
first content
  -> first actions / assemble Scene
  -> optional non-browser TTS
  -> addScene + setCurrentSceneId
  -> remaining outlines become skeletons
  -> saveToStorage
  -> router.push(/classroom/:stageId)
```

源码见 `.reference/OpenMAIC/app/generation-preview/page.tsx:939-1079`。

TTS 仅在 enabled、provider 不是 `browser-native-tts` 且 provider 可用时阻塞 Scene 1；浏览器原生 TTS 分支不创建服务端音频。对其他 provider，任一 speech TTS 失败会令 Scene 1 失败并阻止跳转（page `:1011-1056`；`lib/hooks/use-scene-generator.ts:239-328`）。

所以 Chalk 使用浏览器原生 TTS 时，正确门槛是 Scene 1 content + actions 校验和持久化，而不是等待后端 TTS task。进入的应是 owner-scoped Draft Preview；不能因为复用 OpenMAIC 的 URL 切换时机，就提前创建正式 Learning Session 或可发布 Artifact。

### 4.6 Classroom 如何继续剩余 Scene

classroom 加载后比较持久化 outlines 与 scenes 的 `order`；只要 deck 未标记 complete 且有未 materialize 的 outline，就调用 `generateRemaining`（`.reference/OpenMAIC/app/classroom/[id]/page.tsx:109-148`）。

`generateRemaining`：

1. 用现有 Scene order 集过滤 pending 并排序；
2. 异步启动整套 outlines 的媒体调度；
3. 从最后一个已完成 Scene 提取 speech 数组；
4. 逐幕执行或按配置预取 content；
5. 对当前幕串行执行 actions、可选 TTS；
6. 成功才 `addScene`，更新 `previousSpeeches`，再提交下一幕；
7. 全部完成后设置 `generationComplete`（`.reference/OpenMAIC/lib/hooks/use-scene-generator.ts:429-685`）。

`addScene` 会保留已有 scenes、追加新 Scene、移除对应 skeleton，并通过 500 ms debounce 标记结构增量保存（`.reference/OpenMAIC/lib/store/stage.ts:62-80`、`:361-385`）。最终 completion flag 另有测试保证不先于 scenes 持久化（`.reference/OpenMAIC/tests/store/stage-generation-complete.test.ts:200-229`）。

Chalk 迁移时应把每幕的 content/actions/Scene commit 做成数据库原子边界，并将 Run phase 与 Scene 结果绑定同一个 outline revision；不能依赖 debounce 后最终一致的浏览器保存。

### 4.7 OpenMAIC 的 actions 空结果会本地兜底

上游 `generateSceneActions` 并非对 action LLM 输出一律 fail closed。对 slide、quiz、interactive、PBL，若 prompt template 缺失或解析后 actions 数组为空，会返回对应的本地默认 actions；slide 的无效 spotlight target 还可能被改绑到第一个真实元素（`.reference/OpenMAIC/lib/generation/scene-generator.ts:1519-1643`、`:1652-1660`、`:1705-1732`、`:1755-1811`）。因此 route 仍可能成功 assemble 一个没有有效模型 actions 输出、但带本地兜底 actions 的 Scene。

如果 Chalk 的 Actions schema/DSL 校验不通过就禁止 Scene 进入预览，并禁止服务端伪造教学内容兜底，这是合理的企业级契约收紧，但必须明确标为 **Chalk 安全适配**，不能声称 OpenMAIC 原本就是该行为。忠实迁移的是 `content -> actions -> complete Scene` 的阶段和依赖；是否接受本地默认教学 actions 是安全/质量边界上的有意差异。

## 5. 媒体“并行”的准确含义

`generateRemaining` 调用 `generateMediaForOutlines(...)` 后只挂 `.catch`，不 `await`，所以它相对 content/actions 主循环并行且不阻断 Scene 生成（hook `:472-476`）。

但 `generateMediaForOutlines` 收集所有 image/video request 后，用 `for ... of` + `await generateSingleMedia` **串行处理媒体任务**（`.reference/OpenMAIC/lib/media/media-orchestrator.ts:27-64`）。所以该提交的真实语义是：

- media lane 与 Scene lane 并行；
- media lane 内部默认串行；
- 媒体成功/失败写独立 media task/store，不决定 Scene content/actions 主循环成功；
- 完成 deck 后刷新，classroom 会对 materialized outlines 再调用媒体生成，已完成或已永久失败的任务会跳过（classroom page `:149-168`；media orchestrator `:39-63`）。

不要把“media generation in parallel”误写为所有媒体请求无限并发。Chalk 可以在自己的 task worker 中使用受控并发，但那属于基础设施适配；产品语义仍是媒体不阻塞逐幕生成和 Scene 1 预览。

## 6. 失败、重试、停止与恢复

### 6.1 请求级 retry

通用 `withGenerationRetry` 默认最多 5 次 retry（6 次 attempt），指数退避从 1 秒到 16 秒并加最多 20% jitter；408/409/425/429、5xx 和典型网络/超时错误可重试，400/401/403/404/422 等永久 4xx 不重试；AbortError 永不重试（`.reference/OpenMAIC/lib/generation/generation-retry.ts:21-25`、`:129-156`、`:166-233`）。

Scene content/actions route 内部把 AI SDK `maxRetries` 设为 0，避免与客户端外层 retry 相乘（`.reference/OpenMAIC/app/api/generate/scene-content/route.ts:98-136`；`scene-actions/route.ts:95-133`；测试 `tests/generation/scene-api-retry-boundary.test.ts:53-105`）。

Scene 1 为了前台响应性把 retry 缩为 2 次（共 3 attempt），见 `app/generation-preview/foreground-retry.ts:1-4` 和 `tests/generation/foreground-retry.test.ts:1-9`。后续 `generateRemaining` 没传覆盖值，使用通用默认预算。

### 6.2 批次失败语义

默认串行模式中：

- content 失败：加入 `failedOutlines`、回调 `onSceneFailed`、把 generation status 置 `paused`、停止后续 Scene；
- actions 失败：同样 pause 并停止；
- 非 browser-native 的 TTS 任一 clip 最终失败：整幕视为失败并 pause；
- 前面已经 `addScene` 的 Scene 不删除（`.reference/OpenMAIC/lib/hooks/use-scene-generator.ts:553-671`）。

若显式开启 parallel content：某一幕 content 失败会记录失败、移除其 skeleton 并继续消费其他已经在途的 Scene content；循环结束后整体仍是 `paused` 而不是 completed。Actions 或 TTS 失败仍立即 pause（同文件 `:578-595`、`:620-685`）。

所以“失败后一律从第一幕失败点停止”只适用于默认串行配置；如果 Chalk 首版不迁移 content 预取，应明确采用 OpenMAIC 默认的串行行为，而不是无意迁入 opt-in 分支。

### 6.3 单幕 retry 从头重跑

`retrySingleOutline(outlineId)` 从失败列表取 outline，然后执行：

```text
content -> actions (重建 previousSpeeches) -> optional TTS -> addScene
```

它不复用上一次失败尝试的 content，即使原失败发生在 actions/TTS；成功后若仍有 pending，调用 `generateRemaining` 继续，否则检查完成态（`.reference/OpenMAIC/lib/hooks/use-scene-generator.ts:714-843`）。这支持 Chalk 已提出的“失败 Scene 从 content -> actions 重试、保留前序完成结果”。

但上游 retry 时的 `previousSpeeches` 是按当前所有 completed scenes 排序后取**最后一个 Scene**，并未专门查找“被重试 Scene 的直接前驱”（同文件 `:776-795`）。当 parallel content 模式跳过中间失败 Scene、后续 Scene 已完成后再重试中间幕时，这可能引用后序 Scene speech。Chalk 不应把这个边缘实现细节提升为领域规则；应按已确认的顺序语义为重试幕读取其实际前序已完成 Scene，或在不支持跨洞继续时消除该情形。

### 6.4 stop 和刷新恢复不是同一机制

`stop()`：设置 abort flag、递增 generation epoch、abort Scene fetch 和 media lane；主循环检测 abort/epoch 后丢弃迟到结果并置 paused（hook `:441-459`、`:598-655`、`:686-710`）。

刷新恢复依赖另一套状态：

- `outlines`、scenes 和 `generationComplete` 持久化；
- `generatingOutlines`、`generationStatus`、`currentGeneratingOrder`、`failedOutlines` 明确是 transient（`.reference/OpenMAIC/lib/store/stage.ts:158-172`）；
- `loadFromStorage` 用持久化 outlines 减已保存 Scene orders 重新构建 skeleton/pending（同文件 `:606-685`）；
- classroom mount 再调用 `generateRemaining`（classroom page `:109-148`）。

这意味着刷新后不会精确恢复到“actions 运行中”或保留失败原因；未 materialize 的 Scene 会从 content 重新开始。若刚生成 Scene 已进入 debounce、尚未落盘就刷新，也存在上游浏览器实现特有的 durability 窗口。

Chalk 的必要适配是用 PostgreSQL Generation Run 显式保存 claim/lease、attempt、phase、failure、revision binding 和已提交 Scene。刷新/进程重启从数据库判定：已成功提交的 Scene 保留；没有完成整幕提交的 Scene 从 content 重跑；不能把客户端 `failedOutlines` 当权威。

### 6.5 Scene 1 耗尽 retry 后没有同等级恢复

Scene 1 若在 generation preview 的 content/actions/非浏览器 TTS 阶段耗尽 foreground retry，会进入页面总 `catch`：清除 `generationSession` 并显示错误；此时尚未执行末尾的 `store.saveToStorage()` 和 classroom 跳转（`.reference/OpenMAIC/app/generation-preview/page.tsx:961-1079`、`:1080-1089`）。它没有课堂内 `failedOutlines -> retrySingleOutline` 同等级的持久化恢复 UX。

因此 Chalk 的“Scene 1 失败也能从数据库 Run 恢复”属于必要的可靠性适配。迁移上游的 foreground retry 预算和用户错误反馈，并不意味着要复制它清掉 generation session、使首幕失败不可恢复的缺口。

## 7. OpenMAIC 已有行为与 Chalk 必要适配

| 关注点 | OpenMAIC 固定提交已有行为 | Chalk 必要适配；不是重新设计生成链路 |
|---|---|---|
| outline 增量展示 | 只在对象 JSON 闭合并解析后发 `outline` | 加 Chalk runtime/domain schema 校验；无效对象不能发出或固化 |
| SSE 事件 | 六种 `type` 事件 + heartbeat comment | 保留业务事件语义；Run checkpoint/owner 校验由 Chalk API/DAL 实现 |
| retry | route 最多 3 次 attempt；客户端收到 retry 清空本次尝试预览 | 持久化 attempt；新 attempt 不与旧 attempt 的 partial outlines 混合 |
| 断线 | abort LLM；无续传、无 partial outline 持久化 | PostgreSQL Run 决定重连/重试；SSE 仍只是传输层 |
| outline 审阅 | 流中可展开但只读；结束后可编辑；默认 2.5 秒自动接受 | 若产品要求显式确认，把这一差异标成审计/Revision 适配；确认后固化确定 revision |
| 编辑内容 | 增删、重排、类型、标题/描述/key points；仅空标题阻塞 | 用 Chalk 数学首批支持的 Scene 类型/schema 收窄；不照搬 PBL/通用 widget 范围 |
| revision | 只有 session 中最终 outlines，没有 revision identity | owner-scoped immutable Outline Revision；content/actions 都绑定 revision |
| Scene 协议 | content/actions 是两个普通 POST + phase callback | 保持普通请求/任务 API；不要增加 Scene SSE |
| Scene 依赖 | content 无前序 Scene 依赖；slide/quiz/interactive actions 读取当前真实 content/inventory，PBL prompt 是例外 | V3 数据库保证 actions 只能读取同 revision 的已验证 content；PBL 不属于 V3 |
| 跨幕连续性 | 下一幕 actions 注入上一幕最后一句 speech 的末 150 字符 | 保持该精确上下文，不新增自创 Scene summary |
| Scene 1 | content/actions/可选 TTS 完成并保存后进入 classroom | browser-native TTS 不阻塞；进入 owner-scoped Draft Preview，不进入正式 Learning Session |
| 后续 Scene | 按 order 消费；默认串行；content 并发是 opt-in | 首版可以迁移默认串行；若以后开启预取，也必须保持 order、revision 与失败语义 |
| media | 与 Scene lane 并行、不阻塞；media lane 内部串行 | MinIO 保存二进制、Postgres 保存任务/引用；允许受控 worker 并发但不改变产品门槛 |
| Scene 提交 | `addScene` 后浏览器增量保存；前序 Scene 保留 | 一幕 content/actions/Scene 使用明确数据库提交边界，DAL owner check |
| failure/retry | batch pause；单幕从 content 重跑；失败列表 transient | Generation Run 持久化 failure/attempt；刷新/进程恢复不依赖浏览器状态 |
| Scene 1 最终失败 | preview 清除 generation session；没有课堂内同等级恢复 | 保留 Draft/Revision/Run，允许 owner 从 Scene 1 content 重新恢复 |
| actions 空/非法输出 | 部分类型会生成本地默认 actions，并可能修复无效元素 target | 若 Chalk 决定 fail closed，明确记录为契约/教学质量收紧，并用测试锁定 |
| 完成态 | outlines 全有对应 Scene 且无失败才 complete | Draft 全部生成后再进入发布流程；发布 Artifact 不可变 |
| 安全边界 | 客户端传 provider 凭据/状态，本地存储为主 | 认证 fail closed、跨 owner 404、Provider 配置沿用 Chalk 已有 owner-scoped 体系 |

## 8. 测试证据与覆盖缺口

### 8.1 该提交已有直接证据

- `e2e/tests/generation-flow.spec.ts:48-123` 覆盖完整 generation preview 跳转、从 review opportunity 打开编辑器并确认、持久化 always-review 偏好、偏好开启时自动打开编辑器。
- `e2e/tests/generation-flow.spec.ts:126-143` 覆盖从已持久化 `previewPhase: review` 刷新恢复并确认。
- `e2e/fixtures/mock-api.ts:13-32` 固定了测试用 `outline` 逐条事件和最终 `done` 事件的基本格式。
- `tests/generation/task-engine-outline-route.test.ts:179-265`、`:385-497` 等通过真实 route 测试确认 outline/done 事件中的归一化字段、PBL subtype 和唯一 outline ID。
- `tests/generation/outline-type.test.ts:15-130` 覆盖编辑器改类型时补配置、清理异类字段和保持共享字段。
- `tests/hooks/use-scene-generator-retry.test.ts:104-263` 覆盖 transient content retry、永久 actions 401 不重试、AbortError 和 TTS retry。
- `tests/generation/scene-api-retry-boundary.test.ts:53-190` 覆盖 route 禁用内层 LLM retry及保留 401/503 错误边界。
- `tests/store/stage-generation-complete.test.ts:152-436` 覆盖 completion 的 scenes-before-flag 持久化顺序、完整/未完整 deck 刷新恢复和 pending skeleton 重建。
- `tests/store/stage-incremental-persistence.test.ts:66-137` 覆盖 addScene 的结构保存及失败 dirt 的显式重试。

### 8.2 未发现直接覆盖、Chalk 应补的迁移测试

在该固定提交中未发现以下行为的直接自动化测试：

- parser 真正跨多个 chunk、字符串内大括号/转义、Markdown fence、512 KiB 上限；
- `languageDirective`、`courseTitle`、`retry`、`error` 六种 SSE event 的完整契约测试；
- retry 前已显示 partial outlines 后，客户端撤销旧 attempt 并重新开始；
- 用户在 SSE 尚未结束时展开 review，SSE 继续而编辑/确认禁用；现有 E2E mock 一次性返回完整 body，不能证明真实中途交互；
- Scene 1 严格按 `content -> actions -> save -> route`，以及 browser-native TTS 不产生服务端 TTS 请求；
- Scene 1 retry 耗尽后的可恢复行为；上游本身没有可靠持久化恢复，Chalk 必须补齐；
- `generateRemaining` 对多幕的 order、previous speech 150 字符、已完成 Scene 保留、actions failure pause、single retry 从 content 重跑；
- opt-in parallel content 的“并发预取、顺序消费、无全量 barrier”和失败后继续行为；
- media lane 与 Scene lane 不互相阻塞，以及媒体 lane 内串行；
- action LLM 空结果触发本地默认 actions，以及 Chalk 禁用此 fallback 后的 fail-closed 行为；
- 进程级恢复（OpenMAIC 本身主要是浏览器恢复，不具备 Chalk 所需数据库 worker 语义）。

Chalk 的迁移测试应优先覆盖这些产品不变量，而不是只复制上游现有测试文件。尤其要增加 owner-scoped 401/404、revision binding、lease/claim、数据库断线恢复与进程重启，因为这些是 Chalk 的必要企业级适配，OpenMAIC 测试不能替代。

## 9. 对 V3 spec 评审的约束清单

主 spec 的评审与实现应逐项确保表述和代码与本次源码事实一致：

1. “完整 SceneOutline”应解释为 Chalk 校验后的完整领域对象；不要误称 OpenMAIC 已有通用 schema validation。
2. `languageDirective`、`courseTitle`、`outline`、`retry`、`done`、`error` 是 outline SSE 的业务事件全集；heartbeat 是传输保活。
3. 流中展开 review 必须继续接收 SSE，但只读；编辑和确认发生在最终集合后。
4. 若 Chalk 要求每次显式确认，应标为从 OpenMAIC 默认 2.5 秒 auto-continue 做的 Revision/审计适配。
5. 最终确认集合必须只产生一个权威 Outline Revision；解决逐条 outline 与 `done` 媒体 ID 归一化不一致。
6. Scene content/actions 继续使用普通 HTTP/任务调用；phase callback 不升级为 SSE 协议。
7. Content 无前序 Scene 依赖；Actions 绑定当前真实 content/inventory，并仅使用上一幕最后一句 speech 的末 150 字符做过渡。
8. Scene 1 完整提交后进入 Draft Preview；browser-native TTS 不阻塞，也不建后端 TTS task。
9. 后续 Scene 默认按顺序生成；content parallelism 是上游 opt-in 优化，不是基本产品语义。
10. Media 与 Scene 主 lane 并行且不阻塞；不要误写为上游媒体任务彼此并发。
11. 失败保留已完成 Scene；单幕 retry 从 content 重跑。Chalk 用持久化 Run 表达 pause/failure/recovery，不复制 transient `failedOutlines`。
12. OpenMAIC 的 Scene 1 最终失败没有同等级持久化恢复；Chalk 必须用 Draft/Revision/Run 补齐，但不改变从 content 重跑的阶段语义。
13. 所有 Draft、Revision、Run、Scene、media metadata 经过 DAL owner check；正式 Artifact/Session 边界继续遵守 Chalk 已接受架构。
14. 说明 OpenMAIC actions 空结果的本地默认 fallback；若 Chalk 禁止该 fallback，标为安全/教学质量适配而非上游原行为。
15. 只以 progressive browser path 锁定 V3 顺序；不要把 `lib/server/classroom-generation.ts` 的整课 batch 顺序混入 Scene 1 preview 链路。
16. PBL 只作为 OpenMAIC 来源事实记录，不属于 Chalk V3 的编辑、生成、运行或持久化范围。
17. Chalk 的首个 V3 切片应贯通 outline 到全部 Scene、必要媒体与显式发布；Scene 1 是提前预览门槛，不是切片终点。

## 10. Scene 1 进入 classroom 后是否已经是正常课堂 Scene

### 10.1 结论：在 OpenMAIC 中是，且不是受限的静态预览

OpenMAIC 在 Scene 1 的 content、actions 和所需的非浏览器 TTS 完成后，先把该 Scene 设为 current scene、保存 Stage，再跳转 `/classroom/:stageId`（`.reference/OpenMAIC/app/generation-preview/page.tsx:961-1079`）。classroom 加载完成后直接渲染正常的 `Stage`；恢复剩余 Scene 和媒体的 effect 与 `Stage` 渲染并行，没有 `generationComplete` 门禁（`.reference/OpenMAIC/app/classroom/[id]/page.tsx:109-170`、`:172-203`）。`Stage` 在非编辑模式挂载完整的 `PlaybackChromeRoot` 和 interactive iframe host（`.reference/OpenMAIC/components/stage.tsx:121-165`）。

因此，**OpenMAIC 的 Scene 1 一经保存并进入 classroom，就已经是可播放、可互动、可发起讨论的正常课堂 Scene**。本文第 7 节所写“进入 Draft Preview，不进入正式 Learning Session”是 Chalk 的发布/审计边界适配，不是 OpenMAIC 上游页面能力的描述；迁移时不能据此把 OpenMAIC Scene 1 误降级成只读截图或无 agent 的预览页。

### 10.2 已经可用：当前 Scene 的课堂运行能力

| 能力 | 固定提交的实际行为与源码证据 |
|---|---|
| Scene 渲染与交互 | `CanvasArea` 只要有 `currentScene` 就调用 `SceneRenderer`，不检查整课完成态；slide、quiz、interactive、PBL 都走各自正常 renderer（`.reference/OpenMAIC/components/canvas/canvas-area.tsx:88-123`；`components/stage/scene-renderer.tsx:20-47`）。Interactive iframe 在 Scene mount 时立即注册并激活（`components/scene-renderers/interactive-renderer.tsx:38-49`）。 |
| 教师 actions 与播放 | `PlaybackChromeRoot` 针对**当前一幕**创建 `ActionEngine` 和 `PlaybackEngine([currentScene], ...)`；speech、spotlight/laser、whiteboard、widget、discussion、video 等动作均由正常播放引擎消费（`.reference/OpenMAIC/components/edit/PlaybackChromeRoot.tsx:635-676`、`:698-753`；`lib/playback/engine.ts:551-744`）。点击播放会立刻为当前 Scene 创建/恢复 lecture chat session 并启动引擎，不读 `generationComplete`（`PlaybackChromeRoot.tsx:1041-1077`）。 |
| 教师讲解 | Scene 1 的非浏览器 TTS 是跳转前的 blocking step，所以课堂内可直接使用已生成音频；若没有预生成音频，播放引擎会在启用 browser-native TTS 时使用浏览器语音，否则按文本阅读时长推进，不因缺少音频卡死（`.reference/OpenMAIC/app/generation-preview/page.tsx:1011-1056`；`lib/playback/engine.ts:582-651`）。这里的课堂讲解主体是**预生成 actions 的回放**，不是每句都在课堂内重新调用 LLM。 |
| Roundtable 与参与 agents | `PlaybackChromeRoot` 总是从当前选中的 agent IDs 生成 participants，并在 playback 模式渲染 `Roundtable` 和 `ChatArea`；没有全课完成条件（`.reference/OpenMAIC/components/edit/PlaybackChromeRoot.tsx:164-212`、`:1408-1446`、`:1557-1574`）。agent profile/选择在 Scene 1 content 之前已经生成或确定（`app/generation-preview/page.tsx:766-930`）；重新加载 classroom 时也会在 `loading=false` 前恢复 generated agents 与 selection（`lib/classroom/load-classroom.ts:123-165`）。 |
| Q&A、主动讨论与多 agent 参与 | 用户消息可就当前 Scene 创建 `qa` session，并用当前 selected agent IDs 启动 agent loop；discussion action 可创建 `discussion` session、确保 trigger agent 在参与列表中并启动同一 agent loop（`.reference/OpenMAIC/components/chat/use-chat-sessions.ts:1619-1789`、`:1828-1924`）。播放引擎在 discussion action 上显示主动讨论卡并等待加入/跳过（`lib/playback/engine.ts:677-711`）。这些路径只要求当前 Scene、可用 agent 和已配置 model/provider，不要求剩余 Scene 完成；model/API 未配置会在 chat 层单独报设置错误（`use-chat-sessions.ts:1663-1674`、`:1835-1846`）。 |
| Scene 级学习运行态 | 固定提交内没有名为 `LearningSession` 的整课对象或“整课生成完成后才创建 session”的门。实际状态是按需、按 Scene 建立：第一次播放创建 `lecture` chat session（`use-chat-sessions.ts:1961-2044`），首次 Q&A/discussion 创建对应 chat session，Quiz renderer 一 mount 就按 `stageId + sceneId + learnerKey` 加载/创建 attempt identity（`components/scene-renderers/quiz-view.tsx:699-747`；`lib/quiz/runtime.ts:248-258`、`:367-415`）。chat、quiz attempt、PBL 等 runtime 共用浏览器 RuntimeStore（`lib/runtime/store.ts:3-12`）。 |
| 恢复位置 | 播放位置按 Stage 保存 device-scoped `{ sceneId, actionIndex, updatedAt }` cursor；它是可变 resume UX，不等待或代表整课完成（`.reference/OpenMAIC/lib/playback/cursor.ts:1-15`、`:138-162`；`PlaybackChromeRoot.tsx:680-693`）。 |

两个必要限定：如果 Scene 1 是没有 timeline actions 的 quiz/interactive/PBL，OpenMAIC 不为它创建 lecture engine，但该 Scene 自身 renderer/答题/互动仍正常可用；slide 即使 actions 为空也会有一个 dwell beat（`.reference/OpenMAIC/components/edit/PlaybackChromeRoot.tsx:635-650`）。另外，实时 Q&A/discussion 的可用性仍受 model/provider 配置和网络/API 成功影响，这是 chat 自身前置条件，不是“剩余 Scene 尚未完成”的限制。

### 10.3 需要全课完成：完成态、编辑与导出，而非 Scene 1 教学

- 课程完成页只在 `generationComplete`，或 outlines 已全部 materialize 且没有 generating outlines 时出现；未完成时最后一个已生成 Scene 的“下一页”是 pending 页面（`.reference/OpenMAIC/components/edit/PlaybackChromeRoot.tsx:1079-1125`；`components/canvas/canvas-area.tsx:125-155`）。
- Pro 编辑入口在 `generatingOutlineCount > 0` 时明确禁用，`Stage` 也会从 edit 自动退回 playback；测试直接锁定了“真实 Scene 1 已存在但仍有两个 outlines 在生成时不可编辑”（`.reference/OpenMAIC/lib/edit/stage-mode.ts:15-26`；`components/stage.tsx:41-50`、`:91-97`；`tests/edit/stage-mode.test.ts:68-76`）。这不会禁用 playback/roundtable/chat。
- 导出要求没有 generating/failed outlines，并且所有媒体 task 已到 `done` 或 `failed` 终态（`.reference/OpenMAIC/components/stage/header-controls.tsx:73-98`）。所以 Scene 1 可以上课，不等于此时可以导出完整课堂。

### 10.4 可能受未完成 Scene 或媒体影响，但不会把 Scene 1 变回不可用

1. **后续 Scene 尚未 materialize**：用户只能访问当前已生成 Scene；自动播放到最后一幕时，若还有 pending outlines，会切到 pending slot 等待下一幕（`.reference/OpenMAIC/components/edit/PlaybackChromeRoot.tsx:786-835`）。后台 `addScene` 只在用户当前停在 pending slot 时自动切到新 Scene；若用户仍在 Scene 1，追加 Scene 不会抢走 current scene（`.reference/OpenMAIC/lib/store/stage.ts:361-385`）。
2. **后续 Scene 失败**：默认生成循环会 pause，但已经 `addScene` 的 Scene 1 不被删除，仍能继续播放、讨论和使用其运行态；失败只阻止全课完成/导出并使 pending 页面提供 retry（`.reference/OpenMAIC/lib/hooks/use-scene-generator.ts:553-671`；`components/canvas/canvas-area.tsx:139-155`）。
3. **图片尚未完成**：Scene 本身照常渲染，placeholder 位置显示 skeleton；失败后显示局部 retry，不阻断 speech、roundtable 或其他 actions（`.reference/OpenMAIC/components/slide-renderer/components/element/ImageElement/BaseImageElement.tsx:29-40`、`:66-117`）。
4. **视频尚未完成**：`play_video` 是局部阻塞动作，会等对应 media task 到 `done` 或 `failed`；成功后播放，失败则跳过该视频并继续后续 action（`.reference/OpenMAIC/lib/action/engine.ts:265-348`）。这意味着包含尚未生成视频的 Scene 1 可以进入课堂和开始讲解，但播放时间线走到该视频时可能等待媒体任务。
5. **媒体与后续 Scene 的调度关系**：classroom 的 `generateRemaining` 先启动整组媒体 lane，再继续 Scene content/actions；两者互不等待，但媒体 lane 内按请求串行（`.reference/OpenMAIC/lib/hooks/use-scene-generator.ts:470-476`；`lib/media/media-orchestrator.ts:27-64`）。媒体失败只把局部 task 标为 failed，不会撤销已经保存的 Scene（`media-orchestrator.ts:104-183`）。

迁移约束是：若 Chalk 仍把这一路由称为 Draft Preview，可以限制发布、编辑或整课导出，但不能把“OpenMAIC 原行为”写成 Scene 1 只可观看。上游事实是当前已提交 Scene 立即获得完整课堂 playback/chat/runtime 能力；未完成的后续 Scene 和媒体只产生上述局部、可枚举的限制。
