# Chalkboard V1 范围

> 文档状态：Accepted
> 适用范围：Chalkboard V1 产品能力；实现跨 `feat/chalkboard-v1` 与 `feat/chalkboard-v2` 工程阶段
> 参考来源：OpenMAIC `1466a55eef9e31e229a0e2e60a0811020d7b06e2`

## 目标

在 Chalk 中交付一个可恢复的 OpenMAIC 兼容课堂运行时：学生能够打开一份
`Stage`，按顺序观看 `Scene` 和 `Action`，完成课堂互动，并在刷新或服务重启后
从最近一次持久化位置继续。

## 本轮包含

- `slide`、`interactive`、`quiz` 三种 Scene；
- `Stage -> Scene -> Action` 课堂数据形状；
- slide renderer、白板、聚光/激光效果和 interactive iframe；
- 播放、暂停、恢复、前后移动、跳转、重新开始和完成；
- TTS、ASR、图片、视频 Provider 及课堂媒体资产；
- Stage/Scene/Action 生成和生成失败恢复；
- Classroom Artifact、Learning Session、Quiz Attempt 和媒体任务的持久化；
- 最后一阶段迁移课堂讨论和学生插话。

## 明确不包含

- PBL；
- 编辑器和“Edit with AI”编辑 Agent；
- PPTX、MP4 和课堂 ZIP 导出；
- Beat、Checkpoint、XState 和 Chalk 最终教学语义；
- 数学几何 DSL、约束层和 `manim-web`。

## 完成定义

完成不是“页面能显示”，而是固定 Stage 能在 Chalk 中完成加载、播放、持久化、
恢复和错误降级，并且关键行为有 package、API 集成和浏览器证据。
