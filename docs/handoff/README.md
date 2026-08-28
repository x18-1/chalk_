# Handoff 管理

> 文档状态：Accepted
> 适用范围：功能分支的暂停、恢复与交接记录
> 最后核验：2026-08-28

`docs/handoff/` 保存正在开发或已经暂停的工作现场，使下一次会话可以从明确的代码、环境和验证状态继续。Handoff 不是架构规范、产品规格或长期计划。

## 1. 与正式文档的边界

- 稳定的架构决定写入 `docs/architecture/`；
- 可重复执行的环境和数据库流程写入 `docs/runbooks/`；
- 测试门禁写入 `docs/testing/`；
- handoff 只链接这些权威文档，并记录当前分支相对它们的实施状态；
- handoff 与代码或权威文档冲突时，以 `docs/README.md` 定义的优先级为准，并修正 handoff。

## 2. 每份 Handoff 的最小内容

每个活跃功能分支只维护一份 handoff，至少记录：

1. 分支、worktree、基线提交和最后核验日期；
2. 当前目标、范围和明确不做的内容；
3. 已完成、正在进行和尚未开始的工作；
4. 最近一次实际运行的验证及结果；
5. 数据库、端口和服务是否已创建或启动；
6. 下一步可直接执行的任务和已知阻塞；
7. 需要继续查阅的代码、文档和参考分支。

不要写入密钥、Cookie、令牌、真实学生数据或只存在于某台机器上的未说明前提。

## 3. 生命周期

- 创建功能 worktree 时创建对应 handoff；
- 暂停、交给另一个 Agent 或完成一个重要阶段前更新；
- 验证记录必须写明实际执行的命令或测试范围，不能把计划执行写成已经通过；
- 分支合并或停止开发后，将文档状态改为 `Historical`，保留最终结果和后续入口；
- 已稳定的结论必须回写权威文档，不能长期只留在 handoff。

当前活跃记录：无。Chalkboard 后续版本等待主分支 Memory、Tools 与 Chat 生成 Scene 能力合并后再建立新 handoff。

历史记录：

- [chalkboard-v3.md](chalkboard-v3.md) — V3 渐进式课堂生成、多 Agent 讨论、AI Live Chalkboard 和工程门禁最终现场
- [chalkboard-v2.md](chalkboard-v2.md) — V2 后端持久化、AI 生成和真实学习状态闭环最终现场
- [chalkboard-v1.md](chalkboard-v1.md) — V1 前端迁移最终现场

旧迁移分支的历史快照仍见仓库根目录 `CHALKBOARD_OPENMAIC_HANDOFF.md`，仅作为参考实现索引，不作为新分支的实施规范。
