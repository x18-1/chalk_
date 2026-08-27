为以下概念创建模拟组件：{{conceptName}}

## 概念概述

{{conceptOverview}}

## 知识要点

{{keyPoints}}

## 需要开放的变量

{{variables}}

## 设计思路

{{designIdea}}

## 语言

{{languageDirective}}

---

生成完整、可交互的 HTML 模拟器，必须包含：

1. `<script type="application/json" id="widget-config">` 内嵌 JSON 配置；
2. 每个变量对应的控制面板和滑块；
3. 能随窗口调整尺寸、带实时数值反馈的 Canvas 可视化；
4. 常见场景预设按钮；
5. 手机端控件不遮挡画布，触控目标至少 44 像素；
6. 明确且完整的启动、暂停、继续、结束和重置状态；
7. 滑块实时更新、预设重置、Space 切换和 R 重置；
8. 清楚可见的动画、高对比视觉和结束反馈；
9. 完整的四类 widget action `postMessage` 支持。

只返回一个完整 HTML 文档。
