# ADR 0003: DeepTutor 风格的可追溯学习记忆

> 状态：Accepted + Partial（核心垂直切片、后台调度和 memory 集成测试已实现；完整对象存储集成与运行审计待补）
> 日期：2026-08-31

## 背景

Chalk 需要让 Agent 跨会话理解学生，同时保留可审阅、可纠正的学习档案。DeepTutor 的三层模型（L1 原始活动、L2 按 surface 的事实、L3 跨 surface 的画像）提供了合适的产品语义。Chalk 的后端约束是全栈 TypeScript、PostgreSQL + Drizzle，并要求数据访问层强制 owner 校验。

## 决策

1. 记忆采用 DeepTutor 的三层语义，不采用向量检索作为记忆机制。
2. L1 是不可变的原始学习事件；已有会话、测验和课堂记录通过事件的 `sourceType/sourceId` 关联，不在 L1 重复保存无界的运行日志。
3. L2/L3 是可编辑的记忆条目。每条条目保存来源引用、层级范围、版本和状态；Agent 只能通过受控的 Memory port 读写，不能直接访问数据库。
4. 所有 memory 表以 `userId` 为 owner。DAL 的每个公开方法都先验证身份，并在 SQL where/复合唯一键中包含 owner 条件。
5. 首个实现提供三个持久化对象：`memory_events`、`memory_entries`、`memory_cursors`。后续 consolidation run/checkpoint 另建持久化模型，不使用进程内全局状态作为恢复权威。
6. `read_memory` 默认读取当前 owner 的活动 L3 条目；`write_memory` 仅用于明确的偏好/目标/教学要求，采用无审批的 conditional policy（输入仍受 schema 限制）。用户可在设置中控制 L3 是否自动注入每个 Chat turn 的 system prompt；关闭注入不影响记忆持久化。掌握度真值仍属于结构化学习证据和确定性判定模块。

## 数据模型

```text
memory_events   L1 append-only events (user, surface, kind, payload, source, time)
memory_entries  L2/L3 editable facts (scope, section, text, refs, version, status)
memory_cursors  per-owner/layer/key seen-ref cursor for idempotent consolidation
```

L2 条目必须有 `surface` 且没有 `slot`；L3 条目必须有 `slot` 且没有 `surface`。来源 `refs` 使用稳定的 L1 event id 或上游条目 id，具体格式由 consolidation schema 统一校验。

## 后续工作

- M1：Drizzle schema、owner-scoped DAL 和单元/集成测试（核心已完成）。
- M2：Chat 的 `read_memory`/`write_memory` 垂直切片及 API（已完成）。
- M3：L1→L2→L3 的受限 consolidation、审计、去重和 Workbench（20 分钟空闲后的批量后台 consolidation、来源 refs、去重和 Workbench 已完成；operation/model provenance 审计待后续）。

## 取舍

DeepTutor 的 Markdown 文件和 Python `ContextVar` 不直接移植；Postgres 是 Chalk 的持久化权威。保留“人可读、带引用、可回溯”的行为，避免文件锁、进程内 run manager 和跨用户路径回退等风险。
