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
- slide renderer、authored `wb_*` 教师白板、聚光/激光效果和 interactive iframe；
- 播放、暂停、恢复、前后移动、跳转、重新开始和完成；
- 浏览器原生 TTS，以及后端图片、视频 Provider 与课堂媒体资产；
- Stage/Scene/Action 生成和生成失败恢复；
- Classroom Artifact、Learning Session、Quiz Attempt 和媒体任务的持久化；
- authored `discussion` Action 的生成、播放与学生参与边界暂停。
- 导入课堂中 authored `wb_*` Action 的只读播放与游标重建。

## 明确不包含

- PBL；
- 编辑器和“Edit with AI”编辑 Agent；
- PPTX、MP4 和课堂 ZIP 导出；
- 课堂实时讨论、Discussion Transcript、学生插话、课堂 Chat 后端和 AI 老师对话；
- Director、参与 Agent、Roundtable 以及讨论中的 live whiteboard Action；
- 学生自由手写白板及 Whiteboard Snapshot/History 持久化；
- 大纲 SSE 预览与生成前审阅编辑，以及第一幕完成后进入生成中课堂的逐 Scene 呈现；
- Beat、Checkpoint、XState 和 Chalk 最终教学语义；
- 数学几何 DSL、约束层和 `manim-web`。

实时课堂讨论和相关会话管理延后到
[Chalkboard V3 候选规格](chalkboard-v3-discussion.md)，不作为 V1/V2 完成门禁。
大纲审阅、SSE 预览和逐 Scene 呈现延后到
[Chalkboard V3 渐进式课堂生成](chalkboard-v3-generation.md)，同样不作为 V1/V2 完成门禁。

## 完成定义

完成不是“页面能显示”，而是固定 Stage 能在 Chalk 中完成加载、播放、持久化、
恢复和错误降级，并且关键行为有 package、API 集成和浏览器证据。
