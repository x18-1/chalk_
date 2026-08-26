# 数据库开发与迁移手册

> 文档状态：Accepted
> 实施状态：Partial
> 适用范围：`apps/api/src/db`、`apps/api/drizzle`
> 最后核验：2026-08-26

## 1. 文件分别做什么

- `apps/api/src/db/schema/*.ts`：当前代码需要的数据库结构。
- `apps/api/drizzle/*.sql`：按顺序执行的 schema migration。
- `apps/api/drizzle/meta/`：Drizzle 记录的 migration 元数据。
- `TEST_DATABASE_URL`：集成测试专用数据库。

## 2. 修改数据库结构

修改表、列、索引、约束或 enum 时：

1. 修改 `apps/api/src/db/schema`。
2. 在 worktree 根目录把当前 `.env` 导出到本 shell：

   ```bash
   set -a
   source .env
   set +a
   ```

3. 执行 `pnpm db:generate`。
4. 阅读生成的 SQL，确认没有误删表、列或数据。
5. 在当前 worktree 的开发数据库执行 `pnpm db:migrate`。
6. 运行受影响的类型检查和测试。

`db:generate` 只负责生成候选 SQL，不能代替人工检查。

Drizzle CLI 从 `apps/api` 启动，不会自动读取 worktree 根目录 `.env`。如果没有先执行上面的
导出步骤，`drizzle-kit` 会把 `DATABASE_URL` 读取为 `undefined`；此时应停止并加载当前
worktree 的配置，不得临时指向其他 worktree 的数据库。

已经在共享分支或共享数据库应用过的 migration 不要修改、重命名或删除。修正问题时新增 migration，不要手工修改 `drizzle` migration ledger。

## 3. 测试数据库

集成测试使用独立数据库，命名为：

```text
chalk_<worktree>_test
```

运行：

```bash
pnpm test:integration
```

测试 runner 会检查数据库名、确认它和 `DATABASE_URL` 不同；数据库不存在时创建并执行全部 migration。测试数据库通常只是 PostgreSQL 容器里的另一个 database，不需要额外创建 Docker 容器。

单元测试不需要数据库。日常开发数据库不能作为 `TEST_DATABASE_URL`。

E2E 使用独立 `_e2e` 数据库目前还没有统一的创建和 migration 流程，不要自行假设它已经可用。

## 4. 不要做的事

- 不使用 `drizzle-kit push` 代替可审查的 migration。
- 不修改已经应用的旧 migration。
- 不手工修改 `drizzle.__drizzle_migrations`。
- 不在 API 启动或 route 请求中隐式执行 migration。
- 不把破坏性数据修改混进普通 schema migration；需要回填时先说明范围和恢复方式。
- 不删除开发数据库或测试数据库，除非用户明确要求。

## 5. 提交前最少检查

数据库变更至少说明：

```text
改了什么表/列：
生成了哪些 migration：
是否需要已有数据回填：
运行了哪些命令：
```

不同 migration 历史的分支不要共用数据库。合并前如果分支之间都新增了 migration，先基于最新主分支重新生成或协调 migration，再运行测试。
