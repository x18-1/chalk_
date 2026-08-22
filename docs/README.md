# Chalk 文档索引与治理规则

> 文档状态：Accepted
> 适用范围：主仓库（不含 `agents/` 实验目录）
> 最后核验：2026-08-22

本文定义 Chalk 文档的分类、权威顺序和维护方式。文档描述与代码不一致时，不能静默选择其中一份：先确认代码的真实行为，再更新相应的权威文档或明确记录偏差。

## 1. 文档状态

每篇长期文档应在标题后标明以下状态之一：

| 状态 | 含义 |
|---|---|
| `Draft` | 正在讨论，不能作为实现约束 |
| `Accepted` | 已确认的当前约束，新代码必须遵守 |
| `Historical` | 历史计划、迁移快照或交接记录，仅用于追溯 |
| `Deprecated` | 已废弃，保留用于解释历史，不得作为新实现依据 |

架构和运行手册还应标明实施状态：

| 实施状态 | 含义 |
|---|---|
| `Documented` | 规则已记录，但尚未由脚本或 CI 验证 |
| `Partial` | 部分代码或工具已经遵守，仍有已知缺口 |
| `Enforced` | 已由类型、测试、脚本或 CI 强制执行 |

`Accepted` 不等于 `Enforced`。规则已确认但工具尚未落地时，必须明确写成 `Accepted + Documented/Partial`。

## 2. 权威文档

| 主题 | 权威来源 | 当前状态 |
|---|---|---|
| 产品功能 | [functional-spec.md](functional-spec.md) | Draft |
| 技术选型 | [tech-stack.md](tech-stack.md) | Draft；其中 `AGENTS.md` 已确认的约束优先 |
| 仓库与 package 边界 | [architecture/repository-boundaries.md](architecture/repository-boundaries.md) | Accepted |
| API 后端分层 | [architecture/backend-layers.md](architecture/backend-layers.md) | Accepted |
| 第三方集成边界 | [architecture/third-party-integrations.md](architecture/third-party-integrations.md) | Accepted |
| worktree 开发 | [runbooks/worktree-development.md](runbooks/worktree-development.md) | Accepted |
| 数据库变更 | [runbooks/database-development.md](runbooks/database-development.md) | Accepted |
| 测试与交付验证 | [testing/verification-strategy.md](testing/verification-strategy.md) | Accepted |
| 新电脑恢复 | [runbooks/new-computer-migration.md](runbooks/new-computer-migration.md) | Historical |

当规则冲突时，优先级为：

```text
AGENTS.md 中已确认的项目约束
    > Accepted 架构决策
    > Accepted runbook
    > Draft 技术设计
    > Historical 计划和交接记录
```

## 3. 文档目录

```text
docs/
├── README.md                 # 本索引
├── architecture/            # 已接受的长期模块与依赖规则
├── handoff/                 # 功能分支的工作现场与交接记录
├── runbooks/                # 可执行的开发、迁移和恢复流程
├── testing/                 # 测试分层、门禁和评估方法
├── researsh/                # 既有调研资料；保留历史拼写，暂不迁移路径
├── functional-spec.md       # 产品功能草案
├── tech-stack.md            # 技术栈草案
└── plan-*.md                # 阶段性计划，完成后转为 Historical
```

新的分支交接记录统一放在 [handoff/](handoff/README.md)，它们不是主分支架构规范。仓库根目录的 `CHALKBOARD_OPENMAIC_HANDOFF.md` 是旧迁移分支的历史快照；`CONTEXT.md` 是产品与运行术语表，二者都不替代架构或运行手册。

## 4. 更新规则

1. 新增长期约束时，更新对应的权威文档，不在多个计划文件中复制同一规则。
2. 行为变化和文档变化应在同一变更中完成；无法同时完成时，在文档中记录明确缺口。
3. runbook 中的命令必须在当前仓库验证。尚未实现的命令只能放在“目标状态”，不能写成可直接执行。
4. 阶段计划完成后改为 `Historical`，并链接到最终架构或 runbook。
5. 第三方版本、许可证和接口事实必须注明核验时间；升级时重新验证。
6. 不在文档中记录密钥、Cookie、令牌、真实学生数据或可恢复这些数据的信息。
7. 修改数据库、worktree、测试或发布流程时，同时检查本索引中的权威链接是否仍然有效。

## 5. 当前已知缺口

以下规则已经接受，但尚未全部由工具强制：

- 尚无 CI workflow、formatter 门禁和自动 package 依赖方向检查。
- worktree 配置已经参数化，但尚无跨 worktree 端口/路径占用检测和完整应用栈编排。
- 集成测试会校验、创建并 migrate 专用数据库，但尚不自动重建或销毁测试数据库。
- E2E 尚不自动启动隔离的 Web/API、数据库、session 和对象存储。
- 既有 API route 中仍有 schema、业务编排和 adapter 调用混在同一文件的情况。

这些缺口按 [testing/verification-strategy.md](testing/verification-strategy.md) 和各 runbook 的目标状态逐步收敛。
