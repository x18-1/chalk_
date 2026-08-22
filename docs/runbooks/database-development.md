# 数据库开发与迁移手册

> 文档状态：Accepted
> 实施状态：Partial
> 适用范围：`apps/api/src/db`、`apps/api/drizzle`
> 最后核验：2026-08-22

## 1. 权威关系

```text
Drizzle Database Schema
    ↓ generate + review
Schema Migration SQL
    ↓ migrate
Postgres Schema

Data Migration / Backfill
    ↓
Existing Business Data
```

- `apps/api/src/db/schema/*.ts`：当前应用期望的数据库结构；
- `apps/api/drizzle/*.sql` 和 `meta/`：从空数据库演进到当前结构的不可变历史；
- `drizzle.__drizzle_migrations`：某个具体数据库已经应用的历史；
- 业务数据迁移：独立、可测试的步骤，不等同于 Drizzle schema generate。

任何一项都不能单独代表完整真相。Schema、migration history 和实际数据库 ledger 必须一致。

## 2. 当前冻结基线

截至 2026-08-22，主分支 migration 文件从 `0000_lethal_shatterstar` 到 `0008_young_fabian_cortez`。

`feat/chalkboard-openmaic-migration` worktree 存在从 `0005` 开始的另一套 migration history。该分支不得直接把同编号文件和修改后的 snapshot 合入主分支；必须先基于最新主分支重新协调迁移序列，并在独立空数据库和升级数据库上验证。

在分叉处理完成前：

- 不修改主分支已经提交或已经应用的 migration；
- 不让两个分支对同一数据库运行 migration；
- 不继续依赖同编号 migration 的文件顺序来判断兼容性；
- 合并相关分支前必须单独审查 schema 和数据升级路径。

## 3. 三类数据库变更

### Schema Migration

用于建表、加列、索引、约束和 enum。由 Drizzle schema 变更生成 SQL，再人工审查。

### Data Migration

用于有限、可预测的已有数据转换，例如为新列回填派生值。应有独立 SQL 或 TypeScript runner、前置条件、验证查询和失败策略。

### Backfill Job

用于数据量大、需分批、可重试、可暂停或需要外部调用的迁移。作为应用任务实现，记录进度和版本，不放进会长时间锁表的启动 migration。

三者不得混成一个难以恢复的 migration 文件。

## 4. 修改 Schema 的流程

1. 从最新目标分支创建 worktree，并使用独立数据库。
2. 记录变更目的、兼容策略和是否需要数据迁移。
3. 修改 `apps/api/src/db/schema`。
4. 运行 `pnpm db:generate` 生成 migration。
5. 人工审查 SQL 和 `meta/_journal.json`，确认没有意外删除、重命名或重建。
6. 在全新空数据库执行全部 migration。
7. 在包含上一版本 schema 和代表性数据的升级数据库执行新增 migration。
8. 运行受影响的 DAL、API integration 和 owner-isolation 测试。
9. 记录数据回填、部署顺序和兼容窗口。
10. 合并前基于最新主分支再次检查 migration 序列。

`db:generate` 只是生成候选 SQL，不代表 migration 已正确设计。

## 5. Migration 不可变性

已经进入共享分支或在共享环境应用的 migration 不得修改、重命名或删除。修正错误必须新增前向 migration。

唯一可以重生成未合并 migration 的情况：它仍只存在于当前 feature 分支、从未应用于共享环境，并且重生成能消除与最新主分支的序列冲突。重生成时必须同时处理 SQL、snapshot 和 journal，不能只改文件名。

禁止：

- 手工改变 `drizzle.__drizzle_migrations` 伪造已应用状态；
- 用 `drizzle-kit push` 替代可审查 migration；
- 在生产或共享数据库试跑未经审查的 migration；
- 为解决编号冲突修改主分支旧 migration；
- 在 Route 或应用启动过程中隐式修改 schema。

## 6. 向后兼容变更

破坏性修改默认采用 expand/migrate/contract：

```text
Expand:   新增列/表，旧应用仍可运行
Migrate:  双写或回填，验证新旧数据一致
Switch:   新应用切换读取来源
Contract: 确认无旧调用后删除旧结构
```

重命名字段、改变语义、收紧 `NOT NULL`、修改 enum、删除列或大表索引都必须评估锁表、旧版本应用和回滚影响。

## 7. 测试数据库

命名规则：

```text
chalk_<worktree>_test
chalk_<worktree>_e2e
```

测试数据库必须满足：

- 明确不是生产数据库；
- 不与手工开发数据库共用业务数据；
- 测试开始前从 migration 创建或校验 schema；
- 测试数据使用唯一标识并在测试后清理；
- 并行测试不能依赖共享全局行；
- 时间相关逻辑使用注入时钟或相对时间，不能依赖固定历史日期与真实当前时间的偶然关系。

根级 `pnpm test:integration` 和 API 包内同名命令使用受保护的 runner。runner 会读取 `TEST_DATABASE_URL`，并执行以下检查和准备：

- 数据库名必须匹配 `chalk_<worktree>_test`；
- 默认只接受本机 Postgres，远程测试数据库必须显式设置 `ALLOW_REMOTE_TEST_DATABASE=true`；
- `TEST_DATABASE_URL` 不得与 `DATABASE_URL` 相同；
- 数据库不存在时自动创建，随后应用全部 Drizzle migration；
- 只收集 `apps/api/tests/integration`。

runner 不会删除或重建已有测试数据库；测试必须继续使用唯一 fixture 并清理自己创建的数据。日常开发数据库不能作为 `TEST_DATABASE_URL`。

## 8. 验证清单

每个数据库变更至少验证：

- 空数据库可以从 `0000` 完整 migrate；
- 上一版本数据库可以前向升级；
- Drizzle schema 与迁移后的数据库一致；
- owner 校验仍在 SQL seam 强制；
- 外键、唯一约束和删除策略符合预期；
- data migration 可重复判断是否已经完成；
- 大表操作的锁和耗时可接受；
- 新旧应用的兼容窗口明确；
- 备份和恢复方式已记录。

## 9. 数据备份与恢复

Postgres、JSONL session 和对象存储是三个不同的数据集合，必须一致考虑：

```text
Postgres:       用户、conversation 元数据、配置和业务记录
JSONL session:  Agent 对话状态
Object storage: 上传和生成产物
```

备份成功必须包含可验证的恢复演练，而不只是生成文件。恢复后至少检查：

- migration ledger；
- conversation 到 session 文件映射；
- session 文件 owner metadata；
- attachment 到对象 key 的一致性；
- API 健康检查和一个只读业务 smoke test。

旧电脑迁移的具体快照见 [new-computer-migration.md](new-computer-migration.md)，它不是日常数据库开发流程。

## 10. 合并审查

包含 migration 的 PR/提交必须单独可审查，不混入无关格式化或大规模业务重构。评审说明应包含：

```text
Schema change:
Data migration:
Compatibility window:
Rollback/forward-fix:
Databases tested:
Commands run:
```
