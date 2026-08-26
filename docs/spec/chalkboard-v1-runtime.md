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
- authored Action 和 live Action 使用同一套白板状态入口；
- 跳转或重新开始时重建可重放的白板状态；
- TTS、视频、iframe 或媒体失败时保留可继续的课堂状态。

播放编排由 `packages/chalkboard/src/playback.ts` 的
`ChalkboardPlaybackController` 负责：它在 runtime cursor 之上管理异步 Action
生命周期、暂停/恢复、取消过期执行和自动推进。Web 端只注入浏览器能力；当前
课堂 fixture 已实现 `speech`、`spotlight`、`laser`、`discussion`、`play_video` 和
Interactive 的 `widget_highlight` / `widget_setState` 连续播放；前端同时兼容
`widget_annotation` / `widget_reveal`，并在 iframe reload 后重放最近一次状态。
`wb_open`、全部 `wb_draw_*`、`wb_edit_code`、`wb_clear`、`wb_delete` 和 `wb_close`
通过同一个白板 presentation reducer 执行；runtime cursor 恢复或切页时使用已消费
Action 前缀重建 discussion、widget 和白板状态，不重复朗读 speech、播放视频或重放
spotlight / laser。恢复快照的模式为 `playing` 时，Web 在场景挂载后显式 activate
controller，队列会从保存的 action cursor 继续，而不是只恢复“正在播放”标签。
一次播放默认只消费当前 Scene 的 Action，不会无条件跨过学生参与边界。开启课堂
自动播放后，完成的 `slide` 可以进入下一 Scene；`interactive` 或 `quiz` 完成自身的
播放动作后必须停住，等待学生操作或显式导航。关闭自动播放时，任意 Scene 播放到
末尾都停留在当前页；再次播放会从当前页首个 Action 重新开始。
视频自动播放被浏览器策略拒绝时会以静音重试，保证动画仍可见，不把媒体错误伪装成
已播放完成。
`play_video` 只从当前 lesson viewport 解析目标，避免命中场景缩略图中的同 ID video；
切页后主画布尚未完成挂载时，执行器在有限时间内等待目标出现。

## OpenMAIC Web 适配

Web 端通过适配层消费 OpenMAIC 的 `{ success, classroom }` 响应：先校验并解包为
`StageDocument`，再创建 Chalkboard runtime 和 scene view。当前真实课堂动作映射为：

- `speech` -> 浏览器原生 `speechSynthesis`；
- `spotlight` -> slide canvas 元素聚焦；
- `laser` -> slide canvas 元素激光标记；
- `play_video` -> 当前 slide 的 video 元素播放（含播放速率同步）；
- `widget_highlight` -> sandboxed interactive iframe 的 `postMessage`；
- `widget_setState` -> OpenMAIC 的 `SET_WIDGET_STATE` 消息；
- `widget_annotation` / `widget_reveal` -> 对应的 iframe 消息；
- `discussion` -> 教师栏中的可继续课堂提问。

普通 `speech` 和 Interactive action 的 `content` 只属于讲义/动作元数据，不得自动写入课堂 Chat；课堂 Chat 只在 authored `discussion` 或学生主动追问时出现内容。

Web 适配层不持有 Provider 密钥；slide 富文本进入主 DOM 前使用 DOMPurify 净化。
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
继续读取原版本；系统不得把旧 cursor、答题或白板状态静默套用到新版本。跨版本继续学习
需要后续明确的迁移行为，不属于默认恢复。

持久化对象至少包括：

- Classroom、不可变的 Classroom Artifact 及版本；
- Classroom owner 和 Artifact 内容引用；
- Learning Session 与 Playback Cursor；
- scene/action cursor 和播放模式；
- 白板重建所需的状态或 Action history；
- Quiz attempt；
- 媒体 task/asset 引用；
- Generation Run 与 Classroom Draft 状态。

所有用户数据由 DAL 强制 owner 校验，认证异常 fail closed。并发保存必须有版本
检查；过期写入返回稳定冲突错误。

刷新浏览器、API 进程重启或 worker 重启后，系统必须能够读取最新有效快照，
重建运行时并继续课堂。恢复失败时必须显示明确错误，不能静默回到默认身份或
默认 cursor。

当前前端迁移阶段只把 cursor snapshot 保存在浏览器 `localStorage`，并能恢复播放模式、
action cursor 和可投影的场景视觉状态；白板手写笔迹按 scene 保存在本次 classroom
页面会话中。Quiz attempt、discussion/Chat transcript、手写白板产物和并发版本仍必须
接入服务端 persistence seam，不能把当前本地状态描述成已经满足上述最终持久化约束。
