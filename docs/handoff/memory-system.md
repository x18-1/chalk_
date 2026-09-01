# Memory System Handoff

> 交接状态：Ready for review / merge
> 文档类型：Active branch handoff
> 适用分支：`feat/memory-system`
> Worktree：`/home/xcodd/code/chalk_/.worktree/memory-system`
> 基线提交：`8ff6f3c`（当前 `origin/main`，已同步 main 的 Agent platform/Skills/MCP/Chalkboard 更新）
> 最后核验：2026-09-01

本文记录 Memory 第一版已经落地的代码、数据库和验证现场。它是分支交接记录，不替代
[DeepTutor 风格记忆 ADR](../adr/0003-deeptutor-style-memory.md)、数据库开发手册或其他权威架构文档。

## 1. 交接结论

DeepTutor 风格的三层学习记忆核心垂直切片已经完成：L1 原始事件、L2 按学习 surface 整理的事实、
L3 跨 surface 的长期画像；Agent 通过 `read_memory` / `write_memory` 访问，Chat 和 Quiz 会将结构化
学习事件写入 L1，后台 worker 负责受限的 L1→L2→L3 consolidation，Web 提供记忆 Workbench。

本版本不使用 RAG、Embedding、向量数据库或相似度检索。`read_memory` 只读取当前用户已整理的活动
L3，记忆内容不是知识库，也不是真实掌握度判定。

当前 worktree 尚未创建 commit 或推送远程。工作区中的未提交改动均属于本分支 Memory 实现；接手前先
查看 `git status`，不要 reset、stash、clean 或覆盖这些变更。

## 2. 范围与明确不做

已纳入本分支：

- owner-scoped PostgreSQL/Drizzle memory DAL，认证失败时 fail closed；
- L1 `memory_events`、L2/L3 `memory_entries`、幂等 cursor 和 consolidation run 持久化；
- `read_memory` 简单读取格式化后的 L3；`write_memory` 支持显式偏好/目标的 add 和 edit；
- write memory 不弹审批提示，但仍通过参数 schema 和“仅保存明确陈述”的工具契约约束；
- Chat 消息和 Quiz attempt 产生 L1 事件，写入或排队失败不阻塞主业务流程；
- 有界分块、来源 refs 校验、L1→L2→L3 两阶段 consolidation，同一用户并发运行保护；普通活动在用户空闲 20 分钟后由后台批量整理，也可在记忆页面点击 `立即 Update` 手动触发；
- queued/running/completed/failed run、后台 worker、归档/恢复和记忆来源数量展示；
- `/memory` Workbench 以及 memory API。
- 设置中的“自动注入记忆”开关控制 active L3 是否在每个 Chat turn 注入 system prompt；关闭只停止注入，不删除或停止保存记忆。

明确不做：

- 不把记忆改造成 RAG/向量检索系统，不引入 Embedding 或向量数据库；
- 不让记忆推断或覆盖结构化学习证据中的 mastery 真值；
- 不直接移植 DeepTutor 的 Markdown 文件、Python `ContextVar` 或进程内持久化作为权威；
- 不开放客户端伪造 L1 的 `POST /memory/events`；事件只能由受控服务路径写入；
- 本分支不做跨用户共享记忆、知识库/Web 记忆 adapter、复杂冲突解决或过度优化。

## 3. 当前实现地图

```text
apps/api/src/db/schema/memory.ts                         # 四张 memory 表
apps/api/src/db/dal/memory.ts                            # 所有 owner 条件和认证门禁
apps/api/src/modules/memory/services/memory.service.ts   # read/write 与引用校验
apps/api/src/modules/memory/services/memory-consolidation.service.ts
                                                          # 两阶段、有界 consolidation
apps/api/src/modules/memory/services/memory-consolidation.worker.ts
                                                          # queued run 后台 drain
apps/api/src/agent/tools/read-memory.ts                   # read_memory
apps/api/src/agent/tools/write-memory.ts                  # write_memory
apps/api/src/modules/memory/routes.ts                     # memory HTTP API
apps/api/src/providers/llm/memory-consolidation-model.ts  # pi-ai 模型适配
apps/web/src/app/memory/page.tsx                          # Memory Workbench
```

数据流为：Chat/Quiz → L1 event → 用户空闲 20 分钟后的批量 consolidation run → L2 facts → L3 profile → `read_memory`；开启自动注入后，Chat 每个 turn 还会读取 active L3 并追加到 system prompt。记忆页面的 `立即 Update` 可跳过等待手动运行同一流程。
L2 条目必须有 `surface` 且没有 `slot`；L3 条目必须有 `slot` 且没有 `surface`。每次条目保存来源
refs，L2 refs 指向 L1 event，L3 refs 指向 L2 entry；DAL 和 service 会再次校验 owner 与层级。

Agent 工具当前契约：

- `read_memory`：无参数、`read` effect、免审批、顺序执行，最多返回 8,000 字符；只在持久偏好、目标
  或近期学习上下文有助于教学时调用，不必每轮调用。
- `write_memory`：`op=add|edit`、文本上限 240 字符；`write` effect、顺序执行，声明为 conditional
  但 `requiresApproval` 固定返回 `false`，因此明确学习者陈述会直接持久化并去重。

HTTP 路由：

```text
GET    /memory
GET    /memory/context
POST   /memory/entries
GET    /memory/entries/:id
PATCH  /memory/entries/:id
DELETE /memory/entries/:id       # 软归档
GET    /memory/events
POST   /memory/consolidation
GET    /memory/consolidation/runs
```

## 4. 数据库与本地环境

新增迁移（在当前 main 的 0033/0034 之后按顺序执行）：

```text
apps/api/drizzle/0035_third_liz_osborn.sql
```

main 已占用的 migration 为 `0033_nappy_lady_vermin.sql`（`user_skills`）和
`0034_heavy_elektra.sql`（MCP headers）；Memory migration 已按合并后的完整 schema 重新生成，
其中 `memory_entries.version` 直接使用 integer。

本 worktree 的 `.env` 已创建但被 `.gitignore` 忽略，不要把内容复制到文档或日志。当前隔离环境为：

| 资源 | 当前值 |
|---|---|
| Compose project | `chalk-memory-system` |
| PostgreSQL host port | `5653` |
| MinIO API / console | `9210` / `9211` |
| API / Web port | `3011` / `3012` |
| 测试数据库 | `chalk_memory_system_test` |

PostgreSQL 和 MinIO 容器在最后核验时仍在运行。启动、迁移和 worktree 隔离规则以
[数据库开发手册](../runbooks/database-development.md)和[worktree 开发手册](../runbooks/worktree-development.md)
为准。

## 5. 已运行验证

最后一次实际验证结果：

```text
pnpm --filter @chalk/api typecheck       通过
pnpm --filter @chalk/api test:unit       通过（18 个测试文件，93 个断言）
pnpm --filter @chalk/api db:generate     通过
pnpm --filter @chalk/web typecheck       通过
git diff --check                          通过
pnpm --filter @chalk/api exec vitest run tests/integration/memory.test.ts
                                          通过（1 个测试文件）
curl /auth/session                         通过（200，未登录）
开发账号登录 + GET /memory                 通过（200，返回空 entries）
```

完整 API integration suite 已执行：数据库 migration 通过，其余 memory 相关检查通过；既有
`read-resource-storage.test.ts` 的两个 MinIO 测试失败，失败响应来自当前环境映射的 MinIO `9210`，
不是 Memory 代码路径。不要把这两个既有对象存储失败误判为本分支记忆回归；若要重新验证，先按
Tools 测试手册检查 MinIO 健康状态。

## 6. 已知边界与后续任务

接手后可以直接安排的收尾任务：

1. 在目标 CI/部署环境重新跑完整 integration 和必要的 API/Web smoke，确认 MinIO 映射问题是否只限本机。
2. 如需要生产级可恢复性，补 run lease/heartbeat、worker ownership（当前 `workerId` 仅用于 claim 接口，
   数据库更新尚未绑定 worker）以及进程崩溃后的更细粒度恢复测试。
3. 若需要审计合规，增加 consolidation operation/model provenance 的持久化审计记录；当前 run 只保存
   状态和错误，entry refs 保留来源链路。
4. 评估 consolidation 的事务边界和重复 add 的幂等策略；现有 cursor 能避免已见来源重复处理，但
   entry 写入和 cursor 保存不是同一个数据库事务。
5. 将 memory 行为纳入后续 Agent eval/产品 smoke；本分支已有单元和 API ownership/lifecycle 测试，尚无完整
   浏览器 E2E 与真实付费模型端到端验证。

不要在这些收尾任务中顺手引入 RAG、Embedding 或新的记忆检索范式；如需改变三层语义，先更新 ADR 和规格。

## 7. 继续查阅

- [DeepTutor 风格学习记忆 ADR](../adr/0003-deeptutor-style-memory.md)
- [Agent 记忆系统调研](../researsh/agent-memory-systems-research.md)
- [DeepTutor 项目分析](../researsh/deeptutor-project-analysis.md)
- [数据库开发手册](../runbooks/database-development.md)
- [worktree 开发手册](../runbooks/worktree-development.md)
- Agent 工具参考实现：`/home/xcodd/code/chalk_/.worktree/chat-inline-blackboard/apps/api/src/agent/tools`
