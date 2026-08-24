# Tools 基础能力实施计划

> 文档状态：Draft
> 计划状态：实现中；Tools 基础层、统一 Read facade、上传文本 adapter 和 MinIO 集成验证已完成；MCP Resource adapter 已在后续 MCP 阶段接入，知识库/Web adapter 待收口
> 关联 Spec：[Tools 基础能力 Spec](../spec/tools-foundation-spec.md)
> 关联规范：[Agent Tools 规范](../architecture/tools.md)
> 工作区：`.worktree/tools-foundation`
> 分支：`feat/tools-foundation`
> 最后核验：2026-08-24

## 1. 实施原则

- 先在 `packages/agent-runtime` 形成深模块，再由 `apps/api` 注入业务策略。
- 先写行为测试，再修改执行实现。
- 不在本阶段顺手实现 Skills 或 MCP 新能力。
- 不把参数原文、完整结果或凭据加入默认 telemetry。
- 每个阶段完成后运行受影响的单测、类型检查和必要的 API 集成测试。

## 2. 阶段拆分

### Phase A：契约与策略模型

- [x] 确认 Tool effects 分类。
- [x] 确认默认/最大 timeout 和 result budget。
- [x] 设计结构化 Tool error/status 类型。
- [x] 扩展 `RuntimeTool` 和 `ToolSummary` 的最小公共契约。
- [x] 明确用户审批设置只能增加审批，不能降低平台底线。

产物：更新 `docs/architecture/tools.md` 和 `docs/spec/tools-foundation-spec.md`，形成实现前的稳定接口。

### Phase B：Runtime 执行保护

- [x] 在 ToolRegistry 注册阶段执行定义校验。
- [x] 集中实现策略合并和强制审批。
- [x] 集中实现超时、取消和资源清理。
- [x] 集中实现文本结果预算和截断标记。
- [x] 用结构化错误替代错误文案正则分类。
- [x] 为 wrapper 行为补充单元测试。

### Phase C：API 工具装配一致性

- [x] 让公开工具清单和 runtime 注入共用同一个 registry 装配路径。
- [x] 明确 Subagent 是内部能力：默认关闭且不进入公开设置清单。
- [x] 重新检查默认启用策略，避免新工具无配置即自动开放。
- [x] API service 拒绝违反平台底线的工具设置。
- [ ] 保持所有业务 Tool 的 owner 校验位于 DAL/Service，不下沉到通用 runtime。

### Phase D：现有内置工具功能正确性

- [x] 移除没有真实 Provider 时的静态假搜索结果。
- [x] 明确搜索工具不可用时的清单和 UI 表现。
- [ ] 检查重命名工具的 owner、conversation context 和审批行为。
- [ ] 为当前内置工具补充边界测试。
- [x] 增加统一 `read_resource` 工具、上传文本 adapter、签名 continuation cursor 和 snapshot 变化检测。
- [x] 增加真实 MinIO Range 分页、续读和 snapshot 变化集成测试，并记录隔离运行手册。
- [x] 增加 MCP resource 的独立 Read adapter（后续 MCP 阶段完成，不计入本计划的 Tools 基础层完成定义）。
- [ ] 增加知识库文档和 Web 正文的独立 Read adapter。

### Phase E：验证与文档收口

- [x] 运行 `pnpm --filter @chalk/agent-runtime test:unit`。
- [x] 运行 `pnpm --filter @chalk/agent-runtime typecheck`。
- [x] 运行 `pnpm --filter @chalk/api test:unit`。
- [x] 运行 `pnpm --filter @chalk/api typecheck`。
- [x] 运行 Tools 相关 API 集成测试（需要 `TEST_DATABASE_URL`）。
- [ ] 根据实际行为把本计划改为 `Historical`，并把最终约束更新到 Accepted 架构文档。

## 3. 风险与控制

| 风险 | 控制 |
|---|---|
| 结果限制误伤图片或结构化内容 | 第一阶段只限制模型可见文本；二进制单独设计 |
| 超时后底层资源仍未释放 | 强制传递 `AbortSignal`，并要求工具测试资源关闭 |
| 用户设置兼容性破坏 | 先定义策略迁移和 API 规范化行为，再改数据库写入 |
| 清单与 runtime 继续分叉 | 只保留一个 registry 装配入口 |
| 平台审批底线被配置绕过 | 在 runtime wrapper 和 API schema 两层都验证 |

## 4. 完成定义

Tools 第一阶段只有在以下条件同时满足时才算完成：

- Spec 的“必须通过”验收项全部有自动化证据；
- runtime 和 API 的类型检查通过；
- 现有 Tools、审批和 Chat 回归测试通过；
- 文档中的实际状态、默认值和未完成项与代码一致；
- 未引入 Skills/MCP 范围外的行为变化。
