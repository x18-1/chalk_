# Chalkboard V3–V6 路线

> 文档状态：Accepted
> 文档类型：阶段路线
> 最后核验：2026-08-28

本文只固定 Chalkboard 后续版本的产品结果、依赖顺序和边界，不是 V4、V5 或 V6 的可执行实施计划。每个版本开始前仍需从当时的 `main` 创建独立规格、计划和 handoff。

## 1. 当前基线：V3 课堂运行时

V3 已打通从大纲生成、审阅确认到逐 Scene 生成、Draft Classroom 提前上课、播放、多 Agent 讨论、AI Live Chalkboard、状态恢复与显式发布的基本链路。V3 之后只修复严重回归，不再继续扩大产品范围。

## 2. 先决工作：主分支 Agent 平台能力

V4 不立即从 V3 分支开始。先在主分支完成通用能力：

- 学生与 Agent 记忆；
- Tool 安装、发现、授权与调用；
- 将 Chalkboard 能力暴露为 Agent Tools；
- 允许 Agent 在 Chat 中按当前对话上下文生成一个可持久 Chalkboard Scene。

这些能力会改变调用链路、权限边界、Scene 来源和记忆接口。V4–V6 都必须基于它们合并后的最新 `main`，不在 V3 worktree 预先猜测接口。

## 3. V4：可观测性、安全与非功能加固

V4 的产品结果是一个可追踪、可诊断、可审计和可控制的课堂与 Tool 运行时。至少需要覆盖：

- 从 Chat / Agent Run / Tool Call 到 Draft、Generation Run、Scene、媒体、播放和 Discussion Round 的端到端关联；
- 结构化日志、Trace/Span、耗时、错误阶段、Prompt/模型版本与成本边界；
- 对停滞生成、严格校验失败、媒体失败、讨论中断和恢复问题的可行动诊断；
- Tool 权限与审计、owner 边界、凭据隔离、Prompt Injection 风险、SSRF/媒体安全、资源与并发上限；
- 日志、Telemetry 和 eval 不泄露密钥、Token、原始学生内容或不必要的个人数据；
- 将 V3 仍为 Partial 的发布门禁和非功能项按 V4 规格明确收口。

V4 开始前必须单独评审可观测数据边界和威胁模型；本路线不预先选定具体平台或实现库。

## 4. V5：插件协议与首个数学插件

V5 的产品结果是 Teaching Kernel 可以安全加载一个真实数学 Domain Plugin。范围是：

- 最小插件身份、版本、能力声明与活动配置契约；
- 插件在 Scene 或 Action 中的挂载边界；
- 加载、暂停、恢复、切页、销毁、错误降级与状态持久化；
- 插件将学生的回答或操作结果返回 Teaching Kernel；
- 一个范围小、可确定校验、能覆盖核心协议的数学参考插件。

首个数学插件的具体选题在 V5 规格阶段确定。几何约束与几何 DSL 是数学插件方向，不是 Chalkboard 产品本体。V5 不同时建设插件市场、任意第三方代码安装或完整几何产品。

## 5. V6：单节课程学习闭环

V6 的产品结果是 Chalkboard 能够观察学生表现、调整当前教学并沉淀一节课的学习结果。闭环至少包含：

```text
读取学生记忆与本课目标
  -> 讲解与演示
  -> Quiz 或 Plugin Learning Activity
  -> 产生 Learning Evidence
  -> 判断已掌握 / 部分掌握 / 未掌握
  -> 继续 / 补讲 / 换例子 / 再练习
  -> 本课总结
  -> 将可追溯结果写入记忆
```

Discussion 解决学生与课堂成员如何交流，不自动等于学习判定。V6 先以 Quiz 和 V5 插件活动的真实结果验证共性，再决定是否需要一个统一的运行时协议。本路线不引入 Beat，也不把 Checkpoint 预设为独立 Action。

## 6. 固定依赖顺序

```text
主分支 Memory / Tools / Chat -> Scene
  -> V4 可观测性与安全
  -> V5 数学插件
  -> V6 单课学习闭环
```

- V4、V5、V6 不并行从 V3 分支发展；
- 每个版本从前置工作已合并的最新 `main` 创建；
- PBL 仍不是已确认的 V4–V6 范围；
- Beat 暂不引入；Discussion Action 继续是可跳过的开放讨论邀请；
- Tool 与 Domain Plugin 保持分离，只通过明确契约协作。
