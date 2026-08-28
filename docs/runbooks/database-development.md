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

## 6. Chalkboard V3 数据回填审计

`0030_wide_the_professor.sql` 只处理同时满足以下条件的历史 Draft：

- `classroom_id IS NULL`；
- `artifact_id IS NULL`；
- `published_at IS NULL`。

它先以 Draft 自身 `id` 创建稳定的 Classroom 入口，再把同一批 Draft 的 `classroom_id` 指向该
Classroom。`INSERT ... ON CONFLICT (id) DO NOTHING` 和带相同谓词的 `UPDATE` 使迁移可重复检查；它
不会改动已经发布的 Draft，也不会接管已有 `classroom_id` 的记录。

应用到含历史数据的环境前，应在维护窗口记录受影响 ID 和数量，并保留数据库快照：

```sql
SELECT id, user_id
FROM classroom_drafts
WHERE classroom_id IS NULL AND artifact_id IS NULL AND published_at IS NULL
ORDER BY id;
```

应用后应确认上述查询返回 0，并确认记录的每个 Draft 都存在同 owner、同 ID 的 Classroom。若迁移
中断或核验失败，优先从迁移前快照恢复；不要在已有后续课堂写入后批量反向删除。只有能够证明对应
Classroom 仍未产生 Artifact、Learning Session 或其他引用时，才可按迁移前记录的精确 ID 设计新的
修复 migration，先清除 Draft 引用，再删除这些迁移创建且未被使用的 Classroom。

`0032_abnormal_leo.sql` 只为 Discussion Round 增加实例租约、心跳和停止请求列，不回写业务内容。
历史 Round 的 `heartbeat_at` 使用迁移时默认值，因此不会在部署瞬间被恢复任务误判为陈旧；仍处于
`running` 的孤儿 Round 会在心跳宽限期后由恢复任务收口。
