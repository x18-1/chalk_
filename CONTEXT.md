# Chalk 产品与运行术语

> 文档状态：Accepted
> 适用范围：跨模块产品与运行术语
> 最后核验：2026-08-26

## Agent Run

一次由学生输入、系统控制动作或子 Agent 任务触发的 Agent 执行。它有一个明确的最终状态：completed、aborted 或 failed。

## Trace

围绕一次 Agent Run 或其前置上下文整理所记录的可观测性轨迹。它由具有父子关系的 Span 组成，不包含学生的原始内容。

## Span

Trace 中有边界、耗时和结果的一个操作，例如模型调用、工具调用、审批或上下文压缩。

## Teaching Semantic Event

表达教学过程状态的结构化事件，例如等待学生回答、进入讨论室或提示层级变化。它服务于学生体验和学习证据，不能与运行诊断的 Telemetry 混为同一类事实。

## Account

已经通过认证并使用 Chalk 的账号。`user` 和 `admin` 都使用 Chat、Chalkboard 等产品功能；`admin` 还可以使用明确的后台功能。

## Classroom

由 Account 创建、导入或生成，并可进入持续学习的一项教学内容。它归属于该 Account，身份在内容修订后保持稳定。

## Classroom Artifact

某个 Classroom 校验完成且不可变的版本，包含完成课堂所需的教学内容和媒体引用。
_避免使用_：`Stage`、课堂包、课程制品。

## Chalk Classroom Archive

Chalk 导入或导出 Classroom Artifact 与媒体时使用的可移植归档，文件名以 `.chalk.zip` 结尾；它不是学习运行时的数据源。
_避免使用_：Classroom Artifact、课堂包。

## OpenMAIC Archive

从 OpenMAIC 导入的兼容归档，文件名以 `.maic.zip` 结尾；进入 Chalk 后转换为 Classroom Artifact。
_避免使用_：Chalk Classroom Archive、Classroom Artifact。

## Learning Session

一名学生针对某个确定 Classroom Artifact 开展的一次可恢复学习过程，承载进度、回答和课堂交互状态。
_避免使用_：Classroom Session、播放会话。

## Playback Cursor

Learning Session 在 Classroom Artifact 中最近一次持久化的播放位置和播放模式。
_避免使用_：进度条、页面索引。

## Quiz Attempt

一名学生在确定 Learning Session 与 Classroom Artifact 的某个 Quiz Scene 上最近一次提交并由
服务端评分的答案记录。允许使用乐观并发 revision 重提，但不能跨 Artifact 套用。
_避免使用_：Quiz 本身、浏览器答案状态、课堂完成状态。

## Discussion Action

Classroom Artifact 中预先编排的教师提问与播放暂停点；它不是实时对话，也不产生 Discussion Transcript。
_避免使用_：课堂对话、Discussion Transcript、课堂 Chat。

## Discussion Transcript

未来课堂实时讨论中按顺序产生的多轮发言与事件记录；它是 Chalkboard V3 候选概念，不属于 V1/V2。
_避免使用_：Discussion Action、学生的单次课堂回答、课堂 Chat。

## Whiteboard Action

由课堂脚本中的教师角色或未来实时讨论 Agent 产生、用于改变教师白板展示的 `wb_*` Action。
_避免使用_：学生手写白板、Whiteboard Snapshot、学生笔记。

## Generation Run

Account 从教学要求生成 Classroom Artifact 的一次可追踪尝试，具有 `completed`、`aborted` 或 `failed` 终态。
_避免使用_：生成任务、Agent Session。

## Progressive Classroom Generation

大纲经用户审阅确认后，以 Scene 为单位依次生成，并在每个完整 Scene 可用时逐步呈现的课堂生成体验。
它属于 Chalkboard V3，不表示未完成的 Classroom Draft 已经成为 Classroom Artifact。
_避免使用_：流式 Artifact、边生成边发布、实时课堂讨论。

## Classroom Draft

生成过程中持续补全的课堂候选内容；校验完成后形成 Classroom Artifact。
_避免使用_：临时 Stage、未完成课堂。
