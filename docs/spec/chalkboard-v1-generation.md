# Chalkboard V1 内容生成

> 文档状态：Accepted
> 适用分支：`feat/chalkboard-v1`

## 生成链路

后端生成采用可恢复的分段流程：

```text
requirements / context
  -> scene outlines
  -> scene content
  -> scene actions
  -> TTS / image / video assets
  -> validated Stage
```

每一段完成后都可以持久化。单个 Scene 或媒体失败时，已完成部分不能丢失，
必须能重试或明确结束为失败。

## 兼容约束

- 生成结果必须通过 Chalkboard DSL 校验和 normalize；
- V1 继续使用 Stage/Scene/Action，不引入 Beat/Checkpoint；
- OpenMAIC 来源 prompt 按固定提交做 provenance 和字节级校验；
- 生成 API 不直接把第三方 Provider SDK 类型暴露给客户端；
- Prompt、Stage 和媒体引用的 owner 归属由 API Service/DAL 强制执行。

## 非目标

本 SPEC 不定义 Chalk 的长期学习策略、知识点图谱、题型掌握度或几何生成。
