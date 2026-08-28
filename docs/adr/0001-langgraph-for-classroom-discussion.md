# ADR 0001：课堂多 Agent 讨论使用 LangGraph

> 状态：Accepted
> 决策日期：2026-08-27
> 适用范围：Chalkboard 课堂 Discussion Session

## 背景

OpenMAIC 的课堂讨论以 Director 在多个参与 Agent、等待用户和结束之间持续路由。这个问题本身是带条件
分支、循环、轮次上限和中断点的状态图；把它塞进一个通用单 Agent 循环，会让路由状态、终止条件和
可测试边界隐含在业务回调里。

Chalk 已决定通用 Agent、Tools 与 Skills 使用锁定版本的 `@earendil-works/pi-agent-core`，模型目录、
凭据和供应商调用由 `@earendil-works/pi-ai` 统一管理。课堂讨论不能借迁移之名另建 Provider 体系，
也不能让浏览器或图运行时成为 Transcript 权威。

## 决策

Chalkboard 课堂讨论的 Director、参与 Agent 路由、讨论轮次与结束条件使用锁定版本的 TypeScript
LangGraph 编排。该例外只覆盖 `classroom-discussions` 模块；通用 Chat、Tools、Skills、审批与子 Agent
仍由 `pi-agent-core` 承担。

LangGraph 节点通过薄 adapter 调用现有 `@earendil-works/pi-ai`，不引入 LangChain 的 OpenAI、
Anthropic 等模型 Provider 包。owner-scoped PostgreSQL Discussion Session、Round 与 Transcript 是
恢复权威；LangGraph state 只存活于一轮执行中，SSE 和浏览器状态都是可重建投影。

首个实现锁定 `@langchain/core` `1.1.31` 与 `@langchain/langgraph` `1.2.2`。由于该 LangGraph 版本的
宽依赖会解析到与 core exports 不兼容的 checkpoint 新版本，workspace override 锁定其实际验证过的
`@langchain/langgraph-checkpoint` `1.0.0` 和 `@langchain/langgraph-sdk` `1.7.1`；升级必须重新执行
discussion import、typecheck、integration 与 E2E 验证。

## 结果

- Director/Participant/终止条件成为可读、可测的显式图，并能强制三次 Agent 发言上限；
- Chalk 继续只有一套模型配置、凭据和计费入口；
- Session 恢复、owner 隔离和部分文本保存留在 DAL/Service，不依赖 LangGraph checkpoint；
- 新依赖和版本兼容面被限制在课堂讨论模块，未来升级需要按本 ADR 的验证门禁处理。
