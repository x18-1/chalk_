# Chalkboard V1 Handoff

> 文档状态：Draft
> 文档类型：Active branch handoff
> 适用分支：`feat/chalkboard-v1`
> Worktree：`/home/xcodd/code/chalk_/.worktree/chalkboard-v1`
> 基线提交：`c13ed26033f415bb296d96ed52c3643dd80b0056`
> 最后核验：2026-08-22

本文记录 Chalkboard 新课堂分支的当前工作现场，不定义新的架构规则。长期约束以 [文档索引](../README.md)列出的权威文档和仓库根目录 `AGENTS.md` 为准。

## 1. 当前目标

从当前 `main` 开始实现 Chalkboard 课堂功能。旧分支 `feat/chalkboard-openmaic-migration` 仅作为实现素材和测试资产的参考来源，不合并、不 rebase，也不批量 cherry-pick 到本分支。

当前阶段只建立干净基线、隔离开发环境和可恢复的交接记录；尚未迁移课堂功能代码。数学纵向闭环不在当前阶段范围内。

## 2. 已确认边界

- `packages/chalkboard` 不导入 `apps/api`，通过能力接口接受后端注入；
- 第三方 LLM、TTS、ASR、图片、视频、PDF 和 Web Search Provider 位于 `apps/api/src/providers/`；
- LLM Provider 使用 `@earendil-works/pi-ai`，Agent Runtime 继续直接依赖 Pi 的运行时能力；
- 后端按 Route、Schema、多个 Service 和 DAL/数据库模型分工，不引入 `domain/` 层；
- owner 校验必须在数据访问层强制执行，认证异常 fail closed；
- 数据库 migration 只基于当前 `main` 的 Drizzle 历史继续生成，不复用旧迁移分支的 migration 文件。

详细规则见：

- [backend-layers.md](../architecture/backend-layers.md)
- [repository-boundaries.md](../architecture/repository-boundaries.md)
- [third-party-integrations.md](../architecture/third-party-integrations.md)
- [worktree-development.md](../runbooks/worktree-development.md)
- [database-development.md](../runbooks/database-development.md)
- [verification-strategy.md](../testing/verification-strategy.md)

## 3. 隔离环境

本 worktree 的本地 `.env` 已准备但不提交：

```text
COMPOSE_PROJECT_NAME=chalk-chalkboard-v1
Postgres host port=5433
MinIO host ports=9010/9011
Web/API ports=3010/3011
Development database=chalk_chalkboard_v1
Integration database=chalk_chalkboard_v1_test
E2E database=chalk_chalkboard_v1_e2e
```

当前服务尚未启动，数据库和 volume 尚未创建。不得复用 `main` 或旧迁移 worktree 的数据库、session 目录和 MinIO volume。

## 4. 当前状态

已完成：

- 从最新 `origin/main` 创建 `feat/chalkboard-v1`；
- 保留旧迁移 worktree 为只读参考；
- 规划独立 Compose、数据库、对象存储、session 和端口；
- 建立 `docs/handoff/` 管理入口。

尚未开始：

- 确认本轮课堂 V1 的功能范围与验收标准；
- 按当前架构盘点旧分支中可迁移的纯逻辑、UI 和后端能力；
- 迁移代码、数据库 schema、Provider 和课堂页面；
- 建立本分支的单元、集成与 E2E 验证基线。

## 5. 验证记录

创建时已确认：

```text
main == origin/main == c13ed26033f415bb296d96ed52c3643dd80b0056
feat/chalkboard-v1 从该提交创建
3010、3011、5433、9010、9011 创建时未被监听
pnpm env:check：通过
pnpm infra:config：通过
```

服务启动、migration 和测试尚未执行；完成后必须在这里记录实际结果。

## 6. 下一步

1. 以当前产品规格和旧分支审查结果确定课堂 V1 的首批范围与完成标准；
2. 建立旧资产到当前模块边界的迁移清单，区分可直接迁移、需重构和舍弃；
3. 选择第一个保持行为可验证的迁移切片，先补测试再迁移；
4. 启动隔离基础设施并验证空数据库能够应用当前全部 migration。

## 7. 参考来源

```text
旧分支：feat/chalkboard-openmaic-migration
旧 worktree：/home/xcodd/code/chalk_/.worktree/chalkboard-openmaic-migration
旧 handoff：/home/xcodd/code/chalk_/CHALKBOARD_OPENMAIC_HANDOFF.md
OpenMAIC reference：/home/xcodd/code/chalk_/.reference/OpenMAIC
```
