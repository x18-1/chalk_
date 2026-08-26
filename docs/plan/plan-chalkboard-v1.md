# Chalkboard V1 OpenMAIC 迁移计划

> 文档状态：Historical
> 适用分支：`feat/chalkboard-v1`
> 分支基线：`c13ed26033f415bb296d96ed52c3643dd80b0056`
> 前端迁移实现提交：`7af0613`
> 参考提交：OpenMAIC `1466a55eef9e31e229a0e2e60a0811020d7b06e2`
> 最后核验：2026-08-26

本计划记录 `feat/chalkboard-v1` 工程阶段的原始迁移边界和最终结果。产品范围仍以
[Chalkboard V1 范围](../spec/chalkboard-v1-scope.md)为准；尚未完成的后端、AI 和真实数据
闭环转入 [Chalkboard V2 工程迁移计划](./plan-chalkboard-v2.md)。这里的 V2 是第二个工程
迁移阶段，不代表新的产品规格版本。

## 1. 阶段规则

- 旧迁移 worktree 只读参考，不整体合并、rebase 或批量 cherry-pick；
- 先确认固定 OpenMAIC 行为，再编写 Chalk 的最小接口；
- 每个垂直切片遵循 red -> green -> review；
- 测试通过公开 seam 验证行为，不测试私有实现；
- 数据库 migration 只从当前 Chalk 的 Drizzle 历史继续生成；
- Provider、Service、DAL、Route 和 Web client 保持仓库既有架构边界。

## 2. 最终结果

### 2.1 已完成

- 两门真实课堂经过同一套 OpenMAIC adapter、Stage/Scene/Action runtime、播放控制器和
  presentation executor；
- `slide`、`interactive`、`quiz`、TTS、视频、聚光、激光、讨论、widget 和 authored
  whiteboard Action 具备浏览器运行路径；
- 播放、暂停、跳页、自动播放边界、playing snapshot 恢复和可重放视觉状态重建已有
  package 测试；
- DOM authored HTML 净化、interactive iframe sandbox、精确消息来源、响应式布局、
  键盘和触控可访问性完成；
- 页面装配、浏览器 executor、课堂 transport、scene rail 和 feature 样式完成目录收口；
- Chalkboard package、Web typecheck/build、定向 lint 和 9 条真实浏览器 E2E 通过。

### 2.2 作为过渡实现保留

- 两门课堂仍由 Web route 从固定 fixture 和 `.maic.zip` 读取；
- Playback Cursor 和课堂历史保存在浏览器 `localStorage`；
- Quiz、讨论、课堂 Chat 和手写白板仍是浏览器状态；
- 已有 Provider adapter 作为后续生成链路的基础，但真实凭证 smoke 尚未完成。

### 2.3 转入下一工程阶段

- Classroom、不可变 Classroom Artifact、Learning Session 和 Playback Cursor 的正式
  API/DAL 持久化；
- owner 隔离、稳定冲突错误和跨进程恢复；
- `.maic.zip` 通用导入、对象存储媒体和用户课堂列表；
- Generation Run、Classroom Draft、outline/content/action/media 分段生成和失败恢复；
- scripted discussion、SSE 恢复和真实 Agent Runtime 课堂讨论；
- 前端真实目录、保存状态、生成进度、冲突、失败与恢复体验。

## 3. 历史 TDD seams

本阶段确认并继续沿用以下公开 seam：

1. Provider adapter：能力输入、第三方 HTTP 请求、归一化结果和错误映射；
2. Media service：owner、幂等、asset/task 生命周期和 worker lease；
3. Chalkboard core：Stage validation、navigation、Action execution、snapshot；
4. Classroom persistence：save/load、版本冲突、恢复和 owner 隔离；
5. Web adapter：HTTP response 到 runtime 的转换和媒体失败降级；
6. Discussion SSE：事件顺序、断线、abort、sequence 和恢复。

前端阶段主要完成第 3、5 项的浏览器闭环；其余 seam 由 V2 工程计划按纵向切片继续。

## 4. 阶段关闭

`feat/chalkboard-v1` 不再新增后端或 AI 功能。合并前只允许修正文档、验证或阻断合并的
缺陷；新实现从合并后的集成分支创建 `feat/chalkboard-v2` 和独立 worktree。

最终工作现场、验证证据和文件索引见
[Chalkboard V1 Handoff](../handoff/chalkboard-v1.md)。
