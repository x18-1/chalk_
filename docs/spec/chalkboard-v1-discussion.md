# Chalkboard V1 课堂讨论

> 文档状态：Accepted
> 适用分支：`feat/chalkboard-v1`
> 阶段：最后迁移

## 目标

课堂讨论是主课堂时间线之外的可恢复交互。学生可以主动插话，或进入 authored
discussion；讨论结束后回到插话前的课堂位置。

## 行为

- 保存进入讨论前的 scene/action cursor；
- 讨论过程支持文本、语音输入、语音输出和白板 Action；
- 讨论事件通过认证的 SSE/HTTP 接口传递；
- 讨论可以完成、取消、失败或因断线恢复；
- 讨论状态、transcript、sequence 和 abort 状态持久化；
- 讨论结束后恢复主课堂，不重复消费已经完成的 authored Action；
- live Agent 白板 Action 必须经过同一运行时状态和冲突检查。

## 迁移顺序

先用 scripted/fake Agent 验证事件顺序、cursor 保存恢复和错误处理，再接入
`packages/agent-runtime` 与真实 Provider。课堂讨论不包含编辑器的“Edit with AI”
功能。
