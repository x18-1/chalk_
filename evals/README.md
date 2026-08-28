# Chalk Evals

`evals/` 保存需要真实模型或人工教学判断的发布评估。它与确定性的 `unit`、`integration` 和 `e2e`
测试分开：普通测试证明状态机和契约实现，eval 评估真实 Provider 的契约通过率、课堂套路和媒体可用性。

当前套件：

- [`chalkboard-v3`](chalkboard-v3/README.md)：V3 生成、Interactive、讨论和媒体 smoke。

所有案例必须使用合成教学输入，不得包含真实学生信息。运行结果默认写入被忽略的 `evals/runs/`；评审后只
提交脱敏汇总，不提交 Cookie、凭据、完整 Prompt 或未经审阅的 Provider 原始错误。
