# Agent 平台首批集成计划

> 文档状态：Historical
> 实施状态：Completed（最终能力边界以各 Accepted Spec 为准）
> 适用分支：`feat/chat-inline-blackboard`
> 最后核验：2026-09-01

## 已落地

- Context7 仅作为测试用远程 MCP，使用 `https://mcp.context7.com/mcp`，连接保持惰性；
  通过显式测试开关或本地 fixture 注册，不作为生产内置能力。
- MCP HTTP/SSE transport 支持受控 `headers`，不会把凭据写入 URL 或日志。
- 新增 `/teach` Skill，来源锁定到 `mattpocock/skills` 提交；当前通过 Chalk 的 SkillRegistry
  按需读取；首期仅通过自然语言触发，不增加 slash-command 路由。
- 从 OpenMAIC 提炼并改写了 `feynman-learning`、`learning-to-learn` 两个通用教学 Skill，
  移除了其课堂 DSL 依赖。
- `run_subagent` 已收敛为单一固定 child：只接收 `task`，默认关闭、每次审批，
  使用独立 session、60 秒 deadline、12,000 字符结果上限和空 Tool 集合。

## 使用方式

1. 测试 Context7 时显式开启测试开关或注入本地 fixture，并按需设置测试 API key。
2. 生产用户通过自己的 MCP 设置配置 Context7 URL/API key；key 加密存储并以 Authorization header 使用。
3. 通过自然语言触发后调用 `read_skill` 读取 builtin 或 owner 配置的 user Skill；首期不提供
   slash command，也不加载 project/MCP Skill。
4. 如需使用 Subagent，先在 Tools 设置中手动开启 `run_subagent`；父 Agent 只传范围明确的
   `task`，每次执行均由用户审批。

## 后续工作

- 在设置页展示用户 MCP（包括 Context7）状态、认证状态和启停开关；测试开关不作为生产设置。
- 为 MCP 远程结果增加更细的输出大小 guard、来源标记和审计事件；不引入独立 quota service。
- 将更多 OpenMAIC Skill 按“是否依赖其 Stage/Tool DSL”逐个审查后再迁移，禁止整目录复制。
- 在真实 Provider 集成测试中验证 Context7 `resolve-library-id` / `get-library-docs` 的完整链路。
