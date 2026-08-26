# Chalkboard V2 Handoff

> 文档状态：Accepted
> 文档类型：Active branch handoff
> 适用分支：`feat/chalkboard-v2`
> Worktree：`/home/xcodd/code/chalk_/.worktree/chalkboard-v2`
> 基线提交：`b8804dfccb93bb15d1384be64c9466001074c637`
> 基线来源：PR #5 合并后的 `origin/main`
> 最后核验：2026-08-26

本文记录 Chalkboard 第二个工程迁移阶段的真实工作现场。V2 是工程阶段名，不是新的产品
版本；产品范围继续以 `docs/spec/chalkboard-v1-*.md` 为准，实施顺序以
[Chalkboard V2 工程迁移计划](../plan/plan-chalkboard-v2.md)为准。

## 1. 当前目标

从 V1 已验证的浏览器课堂运行时出发，依次交付：

1. 用户课堂持久化、对象存储与不可变 Classroom Artifact；
2. 通用 `.maic.zip` 导入；
3. 可恢复的 Generation Run 和课堂 AI；
4. Learning Session 与 Playback Cursor 服务端持久化；
5. Quiz、讨论、课堂 Chat 和白板学习状态；
6. scripted discussion 与真实课堂讨论 Agent。

每个后端垂直切片同时交付对应前端的 loading、empty、forbidden、not found、conflict、
offline、retry 和保存反馈，不建立第二套 Agent Runtime。

## 2. 已确认的产品与数据边界

Chalkboard 与 Chat 一样，是所有已认证账号都能使用的产品功能。`admin` 和 `user` 使用相同
的课堂创建、导入和学习能力；`admin` 的额外后台能力不改变 Chalkboard 的产品路径。

用户创建、导入、生成的 Classroom 及其媒体、生成过程和学习状态按账号归属，在 DAL 强制
owner 校验；认证异常 fail closed。两门现有课堂用于迁移和验证正式存储、导入、运行链路，
并通过与其他课堂相同的产品接口读取和学习。

## 3. 已完成的阶段初始化

- GitHub PR #5 已合并到 `main`，合并提交为 `b8804df`；
- `feat/chalkboard-v2` 从该提交创建，没有从旧 V1 worktree 复制未提交文件；
- 新 worktree 的依赖由锁文件安装，未修改 `pnpm-lock.yaml`；
- 独立 `.env` 已创建且由 `.gitignore` 排除，未复制 V1 Provider 凭据；
- 独立 PostgreSQL、MinIO、数据库、session 路径和应用端口已配置；
- 仓库已有 11 条 migration 已应用到 V2 开发数据库；这不是新的 Chalkboard V2 schema；
- API/Web 在独立端口启动成功；
- V1 Chalkboard 浏览器基线在 V2 环境 9/9 通过。

## 4. 环境与运行状态

```text
Compose project: chalk-chalkboard-v2
Web:            http://localhost:3202
Chalkboard:     http://localhost:3202/chalkboard
API:            http://127.0.0.1:3201
API health:     http://127.0.0.1:3201/health
PostgreSQL:     localhost:5532
Database:       chalk_chalkboard_v2
Test database:  chalk_chalkboard_v2_test（尚未创建；首次 integration test 时创建）
MinIO API:      http://localhost:9200
MinIO Console:  http://localhost:9201
```

截至最后核验：PostgreSQL 和 MinIO 均为 healthy，Web/API 开发进程正在运行。V1 worktree
仍在 `3101/3102` 运行，用于短期对照；两个环境不共享 Compose project、端口、数据库、
volume 或 session 路径。

开发账号从 V2 `.env` 读取。不要把密码、Cookie、加密键、Provider token 或学生数据写入
本文、日志、测试 fixture 或提交。

## 5. 干净启动流程

在 V2 worktree 根目录执行：

```bash
pnpm install
pnpm --filter @chalk/agent-runtime build
pnpm env:check
pnpm infra:up
set -a
source .env
set +a
pnpm db:migrate
pnpm dev
```

两个已验证的启动事实：

- 全新 worktree 没有 `packages/agent-runtime/dist`；直接 `pnpm dev` 会使 API 报
  `@chalk/agent-runtime/dist/index.js` 不存在，先 build 后再启动即可；
- `drizzle-kit` 不自动加载根 `.env`；未先 `source .env` 时会报告 Postgres URL 为
  `undefined`，不能用其他 worktree 的 URL 代替。

这些事实已同步到 worktree 和数据库 runbook。

## 6. 最近验证

实际执行并通过：

```bash
pnpm env:check
docker compose config --quiet
pnpm --filter @chalk/agent-runtime build
set -a
source .env
set +a
pnpm db:migrate
curl -fsS http://127.0.0.1:3201/health
E2E_WEB_URL=http://localhost:3202 \
E2E_API_URL=http://127.0.0.1:3201 \
  pnpm exec playwright test tests/e2e/chalkboard.spec.ts --workers=1
git diff --check
```

结果：环境校验通过；PostgreSQL/MinIO healthy；数据库 migration ledger 为 11 条；API health
返回 200；Chalkboard E2E `9 passed`，覆盖两门课堂、播放恢复、Interactive、白板、视频、
手机布局、历史作用域和课堂切换。

尚未运行：V2 尚无代码变更，因此未重复运行全仓 typecheck/unit/integration/build；这些已在
PR #5 合并前通过。真实第三方 Provider smoke 未运行，V2 `.env` 未配置 Provider 凭据。

## 7. 下一步

1. 固定第一个 TDD seam：认证用户的 Classroom 持久化与对象存储；
2. 先写 `admin`、`user` 均可使用同一课堂接口且两个账号数据相互隔离的 integration test；
3. 实现 Classroom、Classroom Artifact、媒体引用及 owner 约束；
4. 让两门现有课堂通过正式持久化/导入链路进入测试账号，不再依赖 Web 固定 fixture；
5. 接入 Web 用户课堂列表，验证新浏览器无需预置 `localStorage` 即可发现自己的课堂；
6. 完成通用 `.maic.zip` 导入后，建立集中 Prompt loader、双语配对与 provenance 门禁；
7. 迁移现有内联产品 Prompt，再接入可恢复的 Generation Run 和课堂 AI；
8. 随后迁移 Learning Session、Playback Cursor 和课堂交互状态。

## 8. 参考入口

- [V2 工程迁移计划](../plan/plan-chalkboard-v2.md)
- [Chalkboard V1 范围](../spec/chalkboard-v1-scope.md)
- [课堂运行时](../spec/chalkboard-v1-runtime.md)
- [内容生成](../spec/chalkboard-v1-generation.md)
- [课堂讨论](../spec/chalkboard-v1-discussion.md)
- [API 后端分层](../architecture/backend-layers.md)
- [Prompt 管理规范](../architecture/prompts.md)
- [仓库边界](../architecture/repository-boundaries.md)
- [worktree runbook](../runbooks/worktree-development.md)
- [数据库 runbook](../runbooks/database-development.md)
- [V1 最终 handoff](./chalkboard-v1.md)
