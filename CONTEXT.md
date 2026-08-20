# Chalk Ubiquitous Language

## Agent Run

一次由学生输入、系统控制动作或子 Agent 任务触发的 Agent 执行。它有一个明确的最终状态：completed、aborted 或 failed。

## Trace

围绕一次 Agent Run 或其前置上下文整理所记录的可观测性轨迹。它由具有父子关系的 Span 组成，不包含学生的原始内容。

## Span

Trace 中有边界、耗时和结果的一个操作，例如模型调用、工具调用、审批或上下文压缩。

## Teaching Semantic Event

表达教学过程状态的结构化事件，例如等待学生回答、进入讨论室或提示层级变化。它服务于学生体验和学习证据，不能与运行诊断的 Telemetry 混为同一类事实。
