# Chalkboard V3 课堂讨论（候选）

> 文档状态：Draft
> 适用范围：Chalkboard V3 候选产品能力；不属于 Chalkboard V1/V2 实施范围
> 前置条件：先完成前端交互、会话管理和返回课堂行为的产品设计

## 当前边界

Chalkboard V1/V2 只生成和播放 authored `discussion` Action：它是 Classroom Artifact
中预先编排的教师提问与播放暂停点，不是学生与 AI 老师的实时会话。

V1/V2 不实现：

- Discussion Transcript；
- 课堂 Chat 的真实后端会话；
- 学生主动插话或与 AI 老师多轮对话；
- Director、参与 Agent 或 Roundtable 运行时；
- 讨论 Agent 产生的 ASR、TTS 和 live whiteboard Action；
- 讨论流的 SSE、sequence、abort 与断线恢复。

现有 Web 中的 Discussion Dock、课堂 Chat 和学生输入只是尚未接入真实后端的
界面原型，不定义 V3 的最终交互、会话模型或持久化契约。

## 候选目标

如果 V3 确认引入课堂实时讨论，它可以是主课堂时间线之外的可恢复交互：
学生主动进入，或由 authored `discussion` Action 发起，讨论结束后回到原课堂位置。

候选能力包括：

- 保存进入讨论前的 Scene/Action cursor；
- 持久化讨论状态、Discussion Transcript、事件顺序与终止状态；
- 可选的文本、语音输入、语音输出和 AI/参与 Agent 白板 Action；
- 完成、取消、失败与断线恢复；
- 结束后恢复主课堂，不重复消费已完成的 authored Action。

这些只是候选方向，不是已接受的实现契约。
学生自由手写白板不在本候选范围中；它不应与 Agent 驱动的教师白板混为同一产品概念。

## V3 设计前必须确认

1. 课堂讨论的前端入口和布局；
2. 课堂讨论、课堂 Chat 与 Chalk 通用 Chat 之间的关系；
3. Conversation、Thread、Run 和 Learning Session 的生命周期及基数；
4. 学生离开、刷新、换设备、取消或重新进入时的恢复语义；
5. AI 老师、其他角色、工具结果和白板事件的消息模型；
6. 讨论如何结束，以及如何安全回到主课堂时间线。

以上产品决定完成、本文档经评审转为 `Accepted` 之前，不建立
Discussion Transcript schema、课堂讨论 Agent API 或新的实时传输协议。
