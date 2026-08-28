# OpenMAIC 生成生命周期与 Interactive 内容取证

> 文档状态：Historical（固定提交的事实快照，不是 Chalk 权威设计）
>
> 调研日期：2026-08-28
>
> 研究对象：`THU-MAIC/OpenMAIC@1466a55eef9e31e229a0e2e60a0811020d7b06e2`
>
> 本地来源：`.reference/OpenMAIC` submodule；本次已核验其 `HEAD` 与固定提交完全一致
>
> 资料原则：OpenMAIC 事实只取自上述固定提交的源码和测试；“未发现”表示在该提交中按相关入口、状态字段和调用链检索未发现，不代表其他版本没有该能力。Chalk 差异只对照当前 worktree 源码。

## 结论摘要

1. OpenMAIC **没有“同一用户一次只能生成一节课”的服务端限制**。事实上这条生成链路没有 user-scoped run、锁或队列；创建页只把一个 `generationSession` 写入当前页签的 `sessionStorage`。同一页签只有一个会话槽位，新值会覆盖旧值；页面内重启会 abort 旧请求。Scene 1 之后的“后台生成”也不是持久化后台任务，而是 classroom 页面存活期间的浏览器任务。
2. outline 流和 review 阶段不会出现在首页 Recent classrooms。确认/自动继续并完成 agent 阶段后，preview 调用 `setStage`/`setOutlines`，触发 500ms debounce 保存；所以 Scene 1 较慢时，课程可能先以 `sceneCount = 0` 出现在**下次挂载/刷新**的首页列表。Scene 1 完成时另有一次进入 classroom 前的强制保存，保证此时至少以 `sceneCount = 1` 存在。其余 Scene 和最终完成只更新同一个 Stage，不另建历史记录，也没有完成态列表过滤。
3. OpenMAIC 的 game/simulation/diagram/code/visualization3d 都由专用 prompt 生成整页 HTML。四种 `postMessage` 消息、widget config 和 stable selector 主要是 **prompt 契约**；运行时只宽松抽取 HTML、可选解析 config、转换 LaTeX 并注入 KaTeX。缺少四个协议字符串**不会让生成失败或触发重试**。自动 retry 在浏览器 HTTP 调用层，而不是 HTML repair 层；每次 retry 都重新请求整份内容。
4. classroom 中只有已经 materialize 的 Scene 是正常可点击、可播放和可交互的 Scene。pending/running 只显示“下一幕”的一个可点击占位项；点击后是 loading/failure overlay，没有 `SceneRenderer`，因此不能执行 actions、interactive widget 或其他课堂交互。失败占位本体不可点击，只提供 retry。
5. 用户确认 outline 后，`previewPhase` 立即进入 `generating-content`，outline editor 随即卸载；用户先在 generation preview 的步骤卡片中跟踪 Scene 1，Scene 1 保存后自动进入 classroom，再通过已完成 Scene、下一个 skeleton、paused/failed/retrying 状态和媒体元素局部状态观察进展。首页列表没有实时 run 状态；离开 classroom 会停止该页的 Scene/媒体生成，返回后再按持久化 outlines 减 scenes 恢复。

这些是 OpenMAIC 已有行为，不应被误写成 Chalk 的目标架构。尤其不能把浏览器单键会话解释成产品级并发限制，也不能把依赖 classroom 页面存活的任务解释成可靠后台 job。Chalk 已有 owner-scoped PostgreSQL draft/run/lease，应只迁移产品阶段与交互语义。

## 1. 范围与源码地图

以下 OpenMAIC 路径均相对于 `.reference/OpenMAIC`：

| 主题 | 固定提交中的主要源码 |
|---|---|
| 创建生成会话 | `app/page.tsx:317-409`，`handleGenerate` |
| generation preview 会话与编排 | `app/generation-preview/page.tsx:187-325,564-746,939-1079,1175-1451` |
| Scene 1 retry 覆盖 | `app/generation-preview/foreground-retry.ts:1-4` |
| classroom 恢复与终止 | `app/classroom/[id]/page.tsx:80-170` |
| Stage 保存、完成与恢复 | `lib/store/stage.ts:62-79,288-385,487-501,606-685` |
| 首页 Stage 列表 | `app/page.tsx:194-237,763-934`；`lib/utils/stage-storage.ts:407-442` |
| 后续 Scene 调度与 retry | `lib/hooks/use-scene-generator.ts:127-180,500-710,714-847` |
| pending Scene UI | `components/stage/scene-sidebar.tsx:143-458`；`components/canvas/canvas-area.tsx:116-203` |
| Interactive 内容生成 | `lib/generation/scene-generator.ts:194-276,1022-1210` |
| Interactive 后处理 | `lib/generation/interactive-post-processor.ts:1-156` |
| Interactive runtime | `components/scene-renderers/InteractiveIframeHost.tsx:89-175`；`lib/action/engine.ts:793-834` |
| 客户端 retry 分类 | `lib/generation/generation-retry.ts:21-25,129-233` |

固定提交入口：[`THU-MAIC/OpenMAIC@1466a55`](https://github.com/THU-MAIC/OpenMAIC/tree/1466a55eef9e31e229a0e2e60a0811020d7b06e2)。

## 2. 问题一：是否限制同一用户一次只能生成一节课

### 2.1 没有 user-scoped 限制；只有页签内的单槽位

首页 `handleGenerate` 在校验需求和准备材料后创建随机 `sessionId`，把整个状态写到固定键 `sessionStorage['generationSession']`，然后跳到 `/generation-preview`（`app/page.tsx:317-409`，特别是 `:386-404`）。这一入口没有读取 user ID，没有向服务端申请 run/lease，也没有查询“当前是否已有生成中课程”。在固定提交的生成入口、preview、classroom 调度和 Stage storage 中也未发现按用户建立的并发唯一约束。

因此精确结论是：

- **OpenMAIC 已有行为**：当前页签只有一个 `generationSession` 键和一个 preview 流程；在同一页签写入新会话会覆盖旧会话。
- **不是 OpenMAIC 行为**：不存在“一名登录用户只能有一个 active generation”的服务端产品规则。
- **从代码结构可得的推论**：不同浏览器页签的 `sessionStorage` 各自隔离，而且每次 preview 创建随机 Stage ID，所以可以分别启动生成；它们不是由账户级锁互斥。这里是对代码所用 Web Storage 作用域的推论，不是上游显式声明的产品保证。

preview 的 `startGeneration` 每次启动前会 abort 该组件此前保存的 controller，再创建新 controller（`app/generation-preview/page.tsx:317-325`）；组件卸载也会 abort（`:256-262`）。这只保证**一个 preview 页面实例内**不会继续跑旧请求，不能提升为跨页签或跨设备的同用户限制。

### 2.2 各阶段如何恢复，以及恢复边界

| 中断点 | 固定提交中的恢复行为 | 证据 |
|---|---|---|
| outline 流中刷新 | session 仍在，但半途 `streamingOutlines` 没有持久化；若 phase 仍需 outline，mount 后重新启动完整 SSE | `app/generation-preview/page.tsx:187-254,297-314` |
| outline 已完成、等待审阅时刷新 | 最终 `sceneOutlines` 和 `previewPhase` 已写入 session；可恢复 review；若是流中提前打开 editor 而尚无最终 outlines，则保留 review intent 并重跑 SSE | 同文件 `:230-253,709-735` |
| Scene 1 正在生成时刷新 | `previewPhase = generating-content` 会触发 `startGeneration`；Stage ID 是函数内重新 `nanoid(10)`，所以它不是恢复原服务端 run，而是用已存 outlines 重启前景链路 | 同文件 `:297-325,564-575,729-735` |
| Scene 1 失败 | catch 删除 `generationSession` 并展示错误；没有同一生成会话的持久化 resume | 同文件 `:1080-1089` |
| 已进入 classroom，后续 Scene 中断 | 每个 materialized Scene 会增量保存；重新打开 classroom 后，用持久化 outlines 减已保存 scenes 重建 `generatingOutlines`，再调用 `generateRemaining` | `lib/store/stage.ts:361-385,606-685`；`app/classroom/[id]/page.tsx:109-148` |
| 离开 classroom | cleanup 调用 `stop()`；它 abort Scene fetch 和 media controller，并增加 generation epoch | `app/classroom/[id]/page.tsx:80-107`；`lib/hooks/use-scene-generator.ts:705-710` |

所以 OpenMAIC 的“后台继续”只在 classroom 页面挂载期间成立。离开页面会停止，之后重进才恢复；它没有 durable worker、跨设备 run claim 或服务端 job lease。

还有一个不能照搬的恢复风险：Scene 1 完成时把 PDF、agents、user profile 和 language directive 写入另一个固定的 `sessionStorage['generationParams']`（`app/generation-preview/page.tsx:1066-1075`），classroom 再从同一个无 Stage 命名空间的键读取（`app/classroom/[id]/page.tsx:126-148`）；固定提交中未发现清理该键的路径。因而同页签生成第二门课后再打开较早的部分课程，可能读取最近一门课的 params；关闭页签后这些参数又会丢失。这进一步说明它不是可靠的多课程恢复模型。

固定提交另有一套未见主 preview 调用的 `/api/generate-classroom` job API；它每次 POST 都以新 job ID 创建任务，没有 user ID、已有 job 查询或同用户互斥（`app/api/generate-classroom/route.ts:14-59`）。runner 只按 job ID 去重（`lib/server/classroom-job-runner.ts:10-49`）。所以即使把这条独立 API 纳入问题范围，答案仍不是“每用户一次只能一节”；并且它不能替代上述 preview/classroom 生命周期证据。

### 2.3 Chalk 的必要适配边界

OpenMAIC 的单 `sessionStorage` 键是 UI 实现细节，不应迁移成 Chalk 的账户级唯一规则。若 Chalk 要限制并发，必须另有明确产品决定和数据库约束；不能从上游行为推导。反过来，Chalk 已有 owner-scoped draft、generation run、worker claim/lease 与持久化状态，也不应退化成依赖页面存活的生成任务。

## 3. 问题二：outline、Scene 1、完成分别何时进入课程/历史列表

### 3.1 outline 流与 review：不出现；确认后存在 0-Scene autosave 窗口

generation preview 在请求 outline 前创建 Stage 对象（`app/generation-preview/page.tsx:564-575`）。outline 流和 review 期间，它只存在于组件状态/`generationSession`，还没有调用 Stage store 的 `setStage`/`setOutlines`，所以不会出现在首页列表。

但确认/自动继续后，主流程还会完成 agent 阶段，然后在 Scene 1 content 前调用 `store.setStage(stage)` 和 `store.setOutlines(outlines)`（同文件 `:939-943`）。`setStage` 标记 structure/stage dirty，`setOutlines` 标记 outline dirty（`lib/store/stage.ts:288-340,487-490`）；普通 dirty change 会在 500ms 后 flush（`:62-80`）。因此“Scene 1 前绝不持久化”并不成立：若 Scene 1 生成超过 debounce 窗口，DocumentStore 可以先出现一条 `sceneCount = 0` 的 Stage；若 Scene 1 很快，首次写入也可能已经包含 Scene 1。这是上游真实的时间竞态。

首页 Recent classrooms 在 mount 时调用 `listStages()`（`app/page.tsx:194-237`），而 `listStages()` 只读取 DocumentStore 已持久化文档摘要和 legacy 存储（`lib/utils/stage-storage.ts:407-442`）。所以判断边界是“Stage row 是否已由 debounce/显式保存提交”，不是笼统的“outline”或“Scene 1”阶段名。

### 3.2 Scene 1 完成：保证已经出现，但未必首次出现

Scene 1 的 content、actions 和启用时的 TTS 全部成功后，preview 才执行：

1. `addScene(firstScene)` 并设为 current；
2. 把其余 outline 放入 skeleton 列表；
3. 删除 `generationSession`；
4. `await store.saveToStorage()`；
5. 跳转 `/classroom/${stage.id}`。

证据是 `app/generation-preview/page.tsx:1035-1079`。所以 Scene 1 的显式持久化是**进入课堂前的强持久化屏障**，不是首次进入 Recent classrooms 的唯一提交点。无论前面的 debounce 是否已创建 0-Scene 文档，这一步都保证路由发生时 Stage、outlines 和 Scene 1 已提交；之后返回首页，摘要至少会有 `sceneCount = 1`。

一个可见性细节是：首页只在自身 mount 和导入回调时调用 `loadClassrooms()`（`app/page.tsx:194-237`），没有订阅另一个页签的实时生成状态。因此“持久化后可列出”不等于一个已经打开的首页会自动实时刷新。

### 3.3 后续 Scene 与整课完成：更新同一项，不另建记录

`addScene` 把 Scene 加到 Stage 并标记 structure 待保存，保存采用 500ms 调度（`lib/store/stage.ts:62-79,361-385`）。全部 outline materialize 后，`setGenerationComplete(true)` 将最后 scenes 与完成屏障写入同一聚合文档（`:492-501`）。`listStages()` 不按 `generationComplete` 过滤（`lib/utils/stage-storage.ts:410-437`）。

因此列表生命周期是：

| 阶段 | Recent classrooms |
|---|---|
| outline 流、review | 不出现 |
| confirm/自动继续后、Stage store 尚未 flush | 不出现 |
| agent 阶段后 `setStage/setOutlines` 的 debounce 已 flush，Scene 1 尚未完成 | 可能已出现为 `sceneCount = 0` |
| Scene 1 保存并进入 classroom | 保证已出现且至少 `sceneCount = 1`；不保证这是首次出现 |
| Scene 2…N 追加 | 同一个列表项的 sceneCount/updatedAt 随保存更新 |
| generationComplete | 同一个列表项更新；不会再创建“完成历史”项，也不会把此前部分项从隐藏改为显示 |

## 4. 问题三：Interactive content 的生成、协议、解析、retry 与失败

### 4.1 支持类型与内容生成顺序

`generateSceneContent` 对 `outline.type === 'interactive'` 路由到 `generateWidgetContent`；旧 `interactiveConfig` 可转换到新结构，仍缺 `widgetType` 时会降级为 simulation（`lib/generation/scene-generator.ts:194-276`）。普通模式支持五类 widget：

- `simulation`
- `diagram`
- `code`
- `game`
- `visualization3d`

`generateWidgetContent` 按 widgetType 选择专用 system/user prompt，调用一次 `aiCall` 获取整份文本，再抽取 HTML（同文件 `:1060-1195`）。Scene 组装时把结果保存为 `{ type: 'interactive', url: '', html, widgetType, widgetConfig, actions }`（`lib/generation/scene-builder.ts:212-230`）。actions 是下一步单独生成，并拿到真实 HTML 的元素 inventory，以降低凭空生成 selector 的概率（`lib/generation/scene-generator.ts:1213-1320` 及 interactive actions 组装路径）。

### 4.2 Prompt 要求的协议

五类 prompt 都要求输出完整、自包含 HTML，并要求 iframe 监听宿主通过 `postMessage` 发送的四类动作：

| 消息 | 宿主执行位置 | 预期用途 |
|---|---|---|
| `SET_WIDGET_STATE` | `lib/action/engine.ts:814-819` | 更新 widget 状态 |
| `HIGHLIGHT_ELEMENT` | 同文件 `:804-812` | 高亮 selector |
| `ANNOTATE_ELEMENT` | 同文件 `:821-828` | 在 selector 附近注解 |
| `REVEAL_ELEMENT` | 同文件 `:830-834` | 展示隐藏元素 |

例如 simulation prompt 在 `lib/prompts/templates/simulation-content/system.md:3-15,32-101` 给出完整 listener，diagram 在 `diagram-content/system.md:53-116`，code 在 `code-content/system.md:126-190`，game 在 `game-content/system.md:178-245`，visualization3d 在 `visualization3d-content/system.md:3-15,569-654`。prompt 还要求 `<script type="application/json" id="widget-config">` 和稳定 ID/selector。

materialized Scene 渲染时使用不含 `allow-same-origin` 的 sandbox iframe，宿主通过 `targetOrigin='*'` 向其发送消息（`components/scene-renderers/InteractiveIframeHost.tsx:89-113,167-175`）。因此协议对教师 actions 实际生效很重要。

### 4.3 实际 parser/validator 比 prompt 宽松

OpenMAIC 的运行时并没有验证上述完整契约：

1. `extractHtml` 优先取从 doctype/html 到最后一个 `</html>`；否则接受含 html 的 Markdown code fence；最后甚至接受任何 trim 后以 doctype/html 开头的全文，不要求显式闭合（`lib/generation/scene-generator.ts:1022-1052`）。
2. `extractWidgetConfig` 只用固定 regex 找 config script 并 `JSON.parse`；找不到或 JSON 无效都返回 `undefined`，不会让内容失败（同文件 `:1197-1210`）。
3. 没有检查 HTML 大小、唯一文档、唯一 config、config.type 与 outline.widgetType 一致、四个消息字符串齐全或至少一个 stable selector。
4. `postProcessInteractiveHtml` 只保护 script 后转换 `$...$`/`$$...$$`，并在没有 KaTeX 时注入 CDN CSS/JS、auto-render 与 MutationObserver（`lib/generation/interactive-post-processor.ts:1-156`）。这是后处理，不是 validator 或 repair。

所以对问题“缺少四个 `postMessage` 字符串是否失败”的答案是：**不会**。只要文本被 `extractHtml` 接受，缺协议的 HTML 仍会作为成功内容返回，随后生成 actions；播放时宿主仍发送消息，但 iframe 没 listener 时动作只会无效果，不会回溯为生成失败。

上游还会在 iframe 中注入 runtime error 捕获，并把错误回传给编辑器诊断（`lib/utils/iframe.ts:41-104`；`components/scene-renderers/InteractiveIframeHost.tsx:115-145`），但这也不会自动 repair 已生成 HTML。

### 4.4 自动 retry 的层级和失败语义

Scene content API 内部调用模型时显式 `maxRetries: 0`（`app/api/generate/scene-content/route.ts:98-137`）。若 `generateSceneContent` 返回 null，route 返回 HTTP 500 `GENERATION_FAILED`（同文件 `:171-203`）。

真正的自动 retry 在浏览器 `fetchSceneContent` 外层：它用 `withGenerationRetry` 包住整个 `/api/generate/scene-content` 请求，并把 `!success || !content` 视为空结果重试（`lib/hooks/use-scene-generator.ts:127-180`）。默认策略是：

- `maxRetries = 5`，即首次加 5 次 retry，最多 6 次请求；
- 重试 HTTP 408/409/425/429、所有 `>= 500`、timeout/network 类错误；
- 不重试 AbortError 和永久 4xx；
- 1s 起的指数退避，封顶 16s，并加 jitter。

证据是 `lib/generation/generation-retry.ts:21-25,129-233`。Scene 1 为保持前景响应，覆盖 `maxRetries = 2`，即最多 3 次（`app/generation-preview/foreground-retry.ts:1-4`）。后续 Scene 没有覆盖，使用最多 6 次。

这里没有 repair prompt、HTML patch 或“只补 config/listener”。每次 retry 都重新执行完整 content HTTP 请求。并且，缺协议字符串不会使 `generateWidgetContent` 返回 null，因此不会进入这条 retry。

retry 耗尽后的行为：

- Scene 1 content/actions/TTS 任一最终失败，preview catch 删除 `generationSession`，不进入 classroom（`app/generation-preview/page.tsx:1035-1089`）。
- 后续 Scene 的串行 content 失败会标记失败并暂停批次；启用并行 content 预取时，某一 content 失败会从 generating 列表移除并继续消费其他已在途内容，最后整体进入 paused；actions 或 TTS 失败始终暂停（`lib/hooks/use-scene-generator.ts:500-685`）。
- 单 Scene retry 从 `content -> actions -> TTS` 整条重新开始，成功后继续剩余 Scene（同文件 `:714-847`）。

### 4.5 与 Chalk 当前实现的关键差异

Chalk 当前保留相同五类 widget 和相应迁移 prompt 路由（`apps/api/src/modules/classroom-generation/services/scene-content-generation.service.ts:156-264`），但 parser/failure 边界已经更严格：

| 维度 | OpenMAIC 固定提交 | Chalk 当前 worktree |
|---|---|---|
| HTML 完整性 | 宽松抽取，开头像 HTML 即可 | 必须是闭合的单一 HTML 文档；拒绝多个文档 |
| 大小限制 | 未发现 | 2 MiB 上限 |
| widget config | 可缺失、可无效，结果仍成功 | 必须唯一、JSON 合法且 `type` 与 outline 一致 |
| 四种消息 | prompt 要求，不验证 | 缺任一个即 `CLASSROOM_INTERACTIVE_CONTENT_PROTOCOL_INCOMPLETE` |
| stable selector | actions inventory 尽量使用，但 content 不强制至少一个 | content 必须至少有一个；actions target 也会校验 |
| 自动内容 retry | 浏览器整请求自动重跑：Scene 1 最多 3 次，后续最多 6 次 | service 模型调用 `maxRetries: 0`；解析/协议失败持久化为 Scene/run failure，未实现等价自动 retry |
| repair | 无定向 repair | 当前也无定向 repair |
| 失败状态 | browser/Zustand 的 failed outline 与暂停状态；刷新会按 outline-scenes 重算 pending | DB 中持久化具体 error code；失败 run 由显式 retry 接口恢复 |

Chalk 严格契约见 `apps/api/src/modules/classroom-generation/services/interactive-document.ts:1-93`；Scene content 调用、解析和失败持久化见 `scene-content-generation.service.ts:66-139,275-318`；action target 校验见 `scene-actions-generation.service.ts:302-360`；显式 run retry 见 `classroom-generation.service.ts:206-224`。

这意味着迁移约束不是“把 Chalk 放宽到上游行为”。四消息和 config 已经成为 Chalk 的 fail-closed 内容边界，应保留。若要补齐 OpenMAIC 的自动 transport retry，应作为 Chalk worker/run 的幂等、可观测策略实现，并明确区分 provider/网络瞬态错误与确定性契约错误；不能简单反复重试同一个已知不合法 HTML，也不能引入未经 spec 确认的 repair 语义。

## 5. 问题四：pending/running Scene 在课堂侧是否可点击及交互

### 5.1 已完成 Scene

sidebar 对 `scenes` 中已 materialize 的 Scene 渲染正常卡片并允许选中；interactive Scene 有 HTML 时缩略图直接渲染 live iframe preview（`components/stage/scene-sidebar.tsx:143-336`）。选中后 canvas 找到 `currentScene`，通过 `SceneRenderer` 渲染真实内容（`components/canvas/canvas-area.tsx:116-123`）。这类 Scene 可以正常播放 actions、接受教师控制、运行 widget 与课堂交互；它不需要等待整课生成完成。

### 5.2 pending/running Scene

sidebar 只为 `generatingOutlines[0]` 渲染**一个**“下一幕”占位项，而不是一次列出全部未完成 outlines（`components/stage/scene-sidebar.tsx:338-458`）。未失败时它可点击，点击把 `currentSceneId` 设为 `PENDING_SCENE_ID`（`:347-357`）。

但这只是状态页：此 ID 没有对应 `currentScene`，canvas 不渲染 `SceneRenderer`，而显示 generating spinner 或 failure/retry overlay（`components/canvas/canvas-area.tsx:125-195`）。因此：

- 可以“点击查看正在生成状态”；
- 不可以播放该 Scene 的教师 actions；
- 不存在可操作 game/simulation iframe；
- 讨论或其他依赖当前真实 Scene 内容/动作的课堂能力不能以该 pending 占位项作为完整 Scene 工作。

这里还要区分 Scene 内交互与课堂外围聊天。`Roundtable`/`ChatArea` 仍挂在 playback chrome，消息发送入口没有按 pending 或 `generationStatus` 禁用（`components/edit/PlaybackChromeRoot.tsx:1408-1418,1446-1488,1557-1570`），所以用户技术上仍可聊天或发起 roundtable。但 agent 取 current Scene context 时只按真实 Scene ID 查找；虚拟 `__pending__` 不会命中（`lib/orchestration/summarizers/state-context.ts:156-164`）。因此外围聊天“可发起”，不等于可以围绕尚未生成的 Scene 内容或 actions 互动。

当 `addScene` 收到同 order 的真实 Scene 时，它从 generating outlines 删除该项；如果用户正停留在 pending 页，则自动切换到新 Scene（`lib/store/stage.ts:361-385`）。失败项本体 `onClick` 直接 return，只允许点 retry 按钮（`components/stage/scene-sidebar.tsx:350-357,407-430`）。

“running Scene 可点击”与“running Scene 可交互”必须分开表述：前者仅指可打开进度占位页，后者为否。已经完成的较早 Scene 始终可以继续使用，不受后续 Scene pending 限制。

## 6. 问题五：outline 确认后面板何时消失，如何跟踪后台生成

### 6.1 outline editor 的消失时点

页面只在 `session.previewPhase === 'review'` 时渲染 `OutlinesEditor`（`app/generation-preview/page.tsx:154-157,1254-1330`）。确认按钮执行 `handleConfirmOutlines`：若主生成 promise 正停在 review，就 resolve 该 promise；随后主链把 phase 持久化为 `generating-content`。刷新恢复没有 parked promise 时，fallback 也会直接写该 phase 并重启生成（同文件 `:709-735,1188-1216`）。

因此，确认后 editor 在 phase 更新的下一次渲染立即消失，不会作为侧栏一直伴随剩余课程生成。若关闭“总是审阅”，outline 完成后只展示 2.5 秒 `outline-ready` 状态便自动继续；常量和 timer 分别在同文件 `:61,199-227`。

### 6.2 Scene 1 前景阶段的跟踪

不处于 review 时，generation preview 渲染居中的生成卡片：顶部 step dots、当前 step 的 visualizer、标题/描述、状态和错误（`app/generation-preview/page.tsx:1332-1451`）。这覆盖 outline 确认后到 Scene 1 完成前的前景阶段。

Scene 1 完成、保存后页面自动跳到 `/classroom/[id]`（同文件 `:1058-1079`）。用户没有“留在生成中心”的选择，也没有全局后台任务抽屉。

### 6.3 classroom 内的后续跟踪与限制

进入 classroom 后，用户通过以下 UI 信号观察进度：

- 已完成 Scene 会逐个出现在 sidebar；
- sidebar 只显示下一个 generating/paused/failed/retrying skeleton（`components/stage/scene-sidebar.tsx:338-458`）；
- 点击 skeleton 可打开 canvas 的 generating/failure overlay（`components/canvas/canvas-area.tsx:125-195`）；
- 新 Scene 保存后，如果用户在 pending 页会自动切入（`lib/store/stage.ts:361-385`）；
- 媒体以各元素的 skeleton/失败/retry 状态呈现，而不是一个课程级精确百分比。

首页 Recent classrooms 只有名称、sceneCount、时间等 DocumentStore 摘要，不提供 active run、当前 phase 或失败进度（`lib/utils/stage-storage.ts:410-437`；`app/page.tsx:763-934`）。并且离开 classroom 会调用 `stop()`，所以不能依赖首页或其他页面继续观察一个仍在服务端运行的 job——固定提交中没有这种 job。

## 7. 可直接用于 Chalk 决策的边界清单

### OpenMAIC 已有、可以忠实迁移的产品行为

- outline 确认后退出 editor，进入 Scene 1 明确的生成进度页。
- Scene 1 完整保存后立即进入正常 classroom；后续 Scene 逐个 materialize。
- 已完成 Scene 可立即正常使用；pending Scene 是可打开的状态占位页，不是假 Scene。
- 后续 Scene failure 可见并允许单 Scene 从 content 开始 retry。
- Interactive 使用五类专用 prompt、真实 HTML selector inventory 和四消息宿主协议。
- 瞬态 HTTP/网络/空结果可以做有限的整请求 retry；不存在定向 HTML repair。

### Chalk 必须保留或补足的适配

- 并发与恢复以 owner-scoped DB run/lease 为准，不照搬 `sessionStorage` 单键，也不依赖 classroom 页面存活。
- 课程/历史列表的可见时点必须服从 Chalk 的 Draft/Artifact/发布语义；OpenMAIC 在 Scene 1 后暴露部分 Stage 只是参考行为，不等于自动发布正式 Artifact。
- 保留 Chalk 对 Interactive HTML、config、四消息和 selectors 的 fail-closed 校验；不能因为 OpenMAIC 没验证而放宽。
- 若增加自动 retry，按错误类别、attempt 和幂等边界持久化；确定性协议错误是否 retry/repair 需要独立 spec，不从 OpenMAIC 推断。
- 跟踪后台生成应来自持久 run 状态和可恢复事件，而不是把 OpenMAIC sidebar skeleton 当成可靠后台监控机制。

## 8. 取证验证

- 已执行 `git -C .reference/OpenMAIC rev-parse HEAD`，结果为 `1466a55eef9e31e229a0e2e60a0811020d7b06e2`。
- 已对生成入口、`generationSession`、Stage list/storage、preview phase、pending Scene、Interactive prompts/parser/runtime、retry 和当前 Chalk Interactive 服务做符号与调用链检索。
- 本文只新增调研记录，没有修改 generation spec、handoff、索引或代码。
