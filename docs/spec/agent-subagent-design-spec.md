# Agent Subagent 设计规格

> 文档状态：Accepted（v1 范围已确认）
>
> 实施状态：Implemented
>
> 适用分支：`feat/chat-inline-blackboard`
>
> 最后核验：2026-09-01

## 1. 定位

Subagent 是 Chalk 中低频、可选、前台等待的一次性分析能力，不是多 Agent 编排平台。
父 Agent 可以把一个范围明确的任务交给固定 child；child 使用独立 session、固定
system prompt、父 Agent 当前选择的模型和空 Tool 集合，最终只返回有界文本。

v1 不提供 profile registry、`agentId`、动态 Prompt、child Tool/Skill allowlist、递归 spawn、
owner 级调度、后台 Job、resume 或崩溃后重放。

## 2. 产品合同

Agent 只能调用：

```ts
type SubagentRequest = {
  task: string; // 1..8000 字符
};
```

Executor 向宿主返回：

```ts
type SubagentResult = {
  childSessionId: string;
  status: "completed" | "aborted" | "timed_out" | "failed";
  output: string; // 最多 12000 字符
  error?: "cancelled" | "timed_out" | "runtime_failed";
  durationMs: number;
};
```

Tool result 不返回 child session 的本地文件路径、原始 Provider 错误或完整 child transcript。
`focus`、`agentId` 和模型可配 timeout 不属于 v1 合同；父 Agent 必须在 `task` 中完整说明
任务和范围。

## 3. Tool 策略

`run_subagent` 是普通 Runtime Tool：

| 字段 | v1 值 |
|---|---|
| `source` | `subagent` |
| `defaultEnabled` | `false` |
| `approvalPolicy` | `required` |
| `executionMode` | `sequential` |
| `effects` | `process` / `paid` / `write` |
| timeout | 60 秒 |
| result text | 12,000 字符 |
| update text | 4,000 字符 |

Tool 出现在 `/tools` 和设置页，但默认关闭。owner 只有手动开启后父 Agent 才能看到它，
且每次调用都必须经过审批；用户设置不能关闭该审批底线。

ToolRegistry 的 60 秒 deadline 是唯一产品超时边界。超时或父 Run 取消时，同一
`AbortSignal` 传给 Executor 并调用已创建 Runtime 的 `abort()`。`timed_out`、`cancelled` 和
`execution_failed` 作为稳定 Tool error 返回，不将 child 失败伪装成成功 Tool result。

## 4. 运行链路

```text
parent ToolRegistry
  -> run_subagent({ task })
  -> ApprovalBroker
  -> ForegroundSubagentExecutor
  -> SessionRepository.create(owner)
  -> audit started
  -> createAgentRuntime(
       same selected model,
       static chat-subagent prompt,
       tools: []
     )
  -> child runtime.run(task)
  -> bounded final text
  -> audit finished
  -> parent tool_result
```

Child 不看到父 session transcript，也不会把自己的 transcript 追加到父 session。`parentSessionId`
和 `conversationId` 只用于服务端审计/telemetry 关联，不注入 child system prompt，不发送给
模型。system prompt 始终使用集中管理的英文模板，中文版只供人审阅。

## 5. 隔离、审计与错误

- Child session 通过 `SessionRepository.create({ ownerId })` 创建，并使用与父 session 不同的 ID。
- API 审计写入必须同时校验 conversation owner；不允许跨 owner 关联 child run。
- `audit.started` 失败时 child 不继续执行，返回受控失败。
- Child 达到终态后，`audit.finished` 是 best effort；存储失败不得改写、重放或丢弃
  已完成的 child 结果。
- 审计只保存稳定错误类别，不保存或向 Tool details 返回原始 Provider/Runtime
  错误文本。
- v1 保留独立 child JSONL session 用于审计和诊断，但不从它 resume，也不据此重放
  未完成任务。

`run_subagent` 串行执行已经防止单个父 Runtime 内同时启动多个 child。v1 不宣称实现
跨 conversation 的 owner 全局并发限制，也不为此引入全局 coordinator。

## 6. 测试与验收

必须覆盖：

1. 空任务和超长任务在创建 child session 前失败。
2. Child 使用独立 owner-scoped session，父 transcript 不包含 child 中间消息。
3. 返回文本不超过 12,000 字符，details 不包含本地 session path 或原始错误。
4. Runtime 失败映射为 `execution_failed`，取消映射为 `cancelled`，60 秒 deadline 映射为
   `timed_out`。
5. Tool deadline 的结构化原因传播到 child 审计，不会把超时记为普通 abort。
6. `audit.finished` 失败不改变已完成的 child 结果。
7. `/tools` 展示 `run_subagent`，且默认关闭、强制审批、可由 owner 手动开启。
8. Child prompt 不包含动态 system 变量、parent session ID 或测试专用 Profile。

## 7. Deferred

以下能力不属于 v1 待办，只在有明确产品需求时重新评估：

- 第二种领域 Subagent；
- profile/agent registry 与 `agentId` 路由；
- child Tool 或 Skill；
- 递归 spawn 与 max depth；
- user-owned profile；
- 独立模型路由、token quota 或费用账本；
- owner 级跨 conversation 调度；
- coordinator、swarm、teammate mailbox；
- 后台 Job、resume、崩溃恢复和幂等重放。

当第二种真实 Subagent 出现时，先评估注册一个语义明确的独立 Tool；只有多个实现确实
需要共享选择机制时，再引入 Registry seam。
