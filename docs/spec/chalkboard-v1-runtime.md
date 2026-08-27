# Chalkboard V1 课堂运行时

> 文档状态：Accepted
> 适用范围：Chalkboard V1 产品能力；实现跨 `feat/chalkboard-v1` 与 `feat/chalkboard-v2` 工程阶段

## 课堂模型

课堂消费 OpenMAIC 兼容的：

```text
Stage -> Scene -> Action
```

支持 `slide`、`interactive`、`quiz`。`pbl` 必须返回明确的 unsupported 错误，
不能显示空白页面。

## 播放行为

运行时必须支持：

- start、pause、resume；
- previous、next、jump；
- restart、complete；
- authored `wb_*` Action 使用统一白板状态入口；
- 跳转或重新开始时重建可重放的白板状态；
- 浏览器 TTS、视频、iframe 或媒体失败时保留可继续的课堂状态。

播放编排由 `packages/chalkboard/src/playback.ts` 的
`ChalkboardPlaybackController` 负责：它在 runtime cursor 之上管理异步 Action
生命周期、暂停/恢复、取消过期执行和自动推进。Web 端只注入浏览器能力；当前
课堂 fixture 已实现 `speech`、`spotlight`、`laser`、`discussion`、`play_video` 和
Interactive 的 `widget_highlight` / `widget_setState` 连续播放；前端同时兼容
`widget_annotation` / `widget_reveal`，并在 iframe reload 后重放最近一次状态。
`wb_open`、全部 `wb_draw_*`、`wb_edit_code`、`wb_clear`、`wb_delete` 和 `wb_close`
通过同一个白板 presentation reducer 执行；runtime cursor 恢复或切页时使用已消费
Action 前缀重建 discussion、widget 和白板状态，不重复朗读 speech、播放视频或重放
spotlight / laser。V1/V2 Web 只读展示这些教师白板 Action，不提供学生手写、清空或
手动打开白板的入口。未来 live Agent Action 可复用同一 reducer 契约，但它属于 V3 课堂讨论，
不是当前生产者。恢复快照的模式为 `playing` 时，Web 在场景挂载后显式 activate
controller，队列会从保存的 action cursor 继续，而不是只恢复“正在播放”标签。
一次播放默认只消费当前 Scene 的 Action，不会无条件跨过学生参与边界。开启课堂
自动播放后，完成的 `slide` 可以进入下一 Scene；`interactive` 或 `quiz` 完成自身的
播放动作后必须停住，等待学生操作或显式导航。关闭自动播放时，任意 Scene 播放到
末尾都停留在当前页；播放过程中由场景栏或上一页/下一页显式切页时，也必须取消当前
Action 并停在新页，不能把手动导航当成继续播放。再次播放会从当前页首个 Action 重新开始。
视频自动播放被浏览器策略拒绝时会以静音重试，保证动画仍可见，不把媒体错误伪装成
已播放完成。
`play_video` 只从当前 lesson viewport 解析目标，避免命中场景缩略图中的同 ID video；
切页后主画布尚未完成挂载时，执行器在有限时间内等待目标出现。
右侧 Notes 按 Action 顺序把前置的聚焦/互动工具与随后一段 `speech` 组成可播放段落；点击段落
会先跳到该段第一个 Action，再沿正常播放生命周期继续讲解，而不是只朗读孤立文本。当前段落
随 cursor 高亮并滚入视野，整行使用原生按钮，支持键盘操作。

## OpenMAIC Web 适配

Web 端通过适配层消费 OpenMAIC 的 `{ success, classroom }` 响应：先校验并解包为
`StageDocument`，再创建 Chalkboard runtime 和 scene view。当前真实课堂动作映射为：

- `speech` -> 浏览器原生 `speechSynthesis`，支持 owner-scoped 的声音、语言、语速与音量偏好，
  并支持暂停、恢复和切页/重启时取消；
- `spotlight` -> slide canvas 元素聚焦；
- `laser` -> slide canvas 元素激光标记；
- `play_video` -> 当前 slide 的 video 元素播放（含播放速率同步）；
- `widget_highlight` -> sandboxed interactive iframe 的 `postMessage`；
- `widget_setState` -> OpenMAIC 的 `SET_WIDGET_STATE` 消息；
- `widget_annotation` / `widget_reveal` -> 对应的 iframe 消息；
- `discussion` -> 教师栏中预先编排的课堂提问，展示后停在学生参与边界。

普通 `speech` 和 Interactive action 的 `content` 只属于讲义/动作元数据，不得自动伪装成学生对话。
authored `discussion` 只是 Artifact 中的预设提问，不启动 AI 老师会话，不产生 Discussion
Transcript。当前 Web 中的回答和课堂 Chat 界面不是 V1/V2 的后端持久化或 Agent 契约；
实时课堂讨论延后到 V3 候选规格。

Web 适配层不持有 Provider 密钥；slide 富文本进入主 DOM 前使用 DOMPurify 净化。
Slide 中仅含 `latex` 源码的公式由本地 KaTeX 渲染；已有受信边界内生成的 KaTeX `html`
继续经过 DOMPurify 后展示。`chart` 元素由 Web 的只读 SVG renderer 消费 Artifact 中的
labels、legends、series、chartType 和主题色，不静默丢弃生成阶段允许模型输出的图表。
只读 Slide renderer 覆盖当前集中生成 Prompt 可产出的 `text`、`shape`、`line`、`chart`、
`latex`、`table`、`image` 和 `video`；兼容导入还渲染 OpenMAIC 播放器已有的 `code` 元素。
导入遇到未知类型时在原坐标显示明确的“不支持”占位，不能再以 `null` 静默形成空白。
OpenMAIC 虽声明了 `audio` 元素类型，但其播放器本身仍标记为 TODO，且当前 Chalk 生成 Prompt
不产出该类型，因此不把它冒充为已迁移能力。
interactive HTML 只在不含 `allow-same-origin` 的 sandbox iframe 中执行，远程 iframe
消息使用精确 origin；内联 `srcDoc` 因不透明 sandbox origin 只向直接 frame 引用发送。
场景缩略图不执行第二份 interactive iframe。动作没有对应浏览器能力时显示明确的
可继续状态，不阻塞 cursor 导航。

## 持久化与恢复

长期持久化模型区分以下对象：

- `Classroom` 是跨内容修订保持稳定的课堂身份；
- `Classroom Artifact` 是校验完成且不可变的课堂版本；内容变化必须产生新 Artifact；
- `Learning Session` 是一名学生针对某个确定 Artifact 的可恢复学习过程；
- `Playback Cursor` 是 Learning Session 中最近一次持久化的播放位置和播放模式；
- `Classroom Draft` 是尚未完成生成与校验的中间结果，不能被学习流程当作 Artifact 消费。

Learning Session 必须绑定明确的 Artifact 版本。产生新 Artifact 后，已有 Learning Session
继续读取原版本；系统不得把旧 cursor 或答题状态静默套用到新版本。跨版本继续学习
需要后续明确的迁移行为，不属于默认恢复。

持久化对象至少包括：

- Classroom、不可变的 Classroom Artifact JSON 及版本，权威数据存于 PostgreSQL；
- Classroom owner、Artifact 内容 hash 和稳定媒体引用；
- 图片、音频、视频等二进制媒体存于对象存储，读取 URL 只在 owner 校验后短期签发；
- Learning Session 与 Playback Cursor；
- scene/action cursor 和播放模式；
- Quiz attempt；
- 媒体 task/asset 引用；
- Generation Run 与 Classroom Draft 状态。
- 用户默认 LLM、图片/视频生成能力和浏览器语音偏好；这些设置按 owner 隔离，Chat 与 Chalkboard
  消费同一份默认选择。

Chalk 原生 `.chalk.zip`、兼容 `.maic.zip` 和独立 JSON 是按需生成的导出/导入交换格式，不是
运行时权威存储。浏览器 IndexedDB 或 `localStorage` 只能作为缓存或迁移期状态，不能代替
服务端持久化和 owner 校验。

所有用户数据由 DAL 强制 owner 校验，认证异常 fail closed。并发保存必须有版本
检查；过期写入返回稳定冲突错误。

刷新浏览器、API 进程重启或 worker 重启后，系统必须能够读取最新有效快照，
重建运行时并继续课堂。恢复失败时必须显示明确错误，不能静默回到默认身份或
默认 cursor。

当前 Classroom Artifact 的 Learning Session 与 Playback Cursor 已由 PostgreSQL 持久化，Web
使用服务端快照恢复播放模式、scene/action cursor 和可投影的场景视觉状态；写入使用乐观并发
revision，冲突时恢复较新的服务端快照。旧 `localStorage` cursor 只在服务端 Session 仍为初始
快照时允许一次迁移读取，迁移后删除，不再是权威来源。authored 教师白板不是独立学习数据；
它由当前 Artifact 的 `wb_*` Action 和已持久化 Playback Cursor 确定性重建。

Quiz Attempt 已按 Learning Session、Artifact 和 Quiz Scene 持久化到 PostgreSQL；选择题答案
合法性、标准答案和分值只由绑定 Artifact 在服务端校验与计算，浏览器不提供权威评分。每个
Session/Scene 保留一个可重提 Attempt，使用独立 revision 防止旧答案覆盖；刷新、API 重启和
换浏览器后恢复服务端答案及逐题结果。V1/V2 不包含学生手写白板或其 persistence seam。
Discussion Transcript、课堂 Chat 后端和 AI 老师对话属于 V3 候选能力，不是 V1/V2 未完成项。
