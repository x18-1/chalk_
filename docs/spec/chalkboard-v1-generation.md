# Chalkboard V1 内容生成

> 文档状态：Accepted
> 适用范围：Chalkboard V1 产品能力；实现跨 `feat/chalkboard-v1` 与 `feat/chalkboard-v2` 工程阶段

## 生成链路

后端生成采用可恢复的分段流程：

```text
requirements / context
  -> Classroom Draft
  -> scene outlines
  -> scene content
  -> scene actions
  -> TTS / image / video assets
  -> validate
  -> Classroom Artifact
```

每一段完成后都可以持久化。单个 Scene 或媒体失败时，已完成部分不能丢失，
必须能重试或明确结束为失败。

一次可追踪的生成尝试称为 `Generation Run`。Generation Run 只更新自己的
Classroom Draft；重试必须幂等，完成校验前不能产生或覆盖 Classroom Artifact。校验完成后
产生新的、不可变的 Classroom Artifact，既有 Learning Session 继续绑定原 Artifact，
不静默迁移。

## 兼容约束

- 生成结果必须通过 Chalkboard DSL 校验和 normalize；
- V1 继续使用 Stage/Scene/Action，不引入 Beat/Checkpoint；
- OpenMAIC 来源 Prompt 按固定提交做 provenance 和字节级校验，非必要不修改英文内容；
- Prompt 按 [Prompt 管理规范](../architecture/prompts.md) 集中维护英文执行版和中文审阅版，
  Generation Run 只读取英文版；
- 生成 API 不直接把第三方 Provider SDK 类型暴露给客户端；
- Prompt、Stage 和媒体引用的 owner 归属由 API Service/DAL 强制执行。

## 非目标

本 SPEC 不定义 Chalk 的长期学习策略、知识点图谱、题型掌握度或几何生成。
