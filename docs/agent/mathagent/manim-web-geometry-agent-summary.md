# 基于 Manim Web 的 AI 几何讲解系统讨论总结

## 核心想法

构建一个 AI 几何讲解系统：

- 大模型理解题目、规划辅助线和讲解步骤。
- 图形引擎实时绘制几何对象。
- 动作系统负责高亮、激光笔、缩放、动点和辅助线。
- 文稿或语音与画面同步。
- 支持暂停、回退和逐步播放。

## GeoGebra 的问题

GeoGebra 的 `evalCommand()` 只返回成功或失败，没有稳定的结构化错误信息。它使用的输入栏解释器比较宽松，有问题的表达式可能被解释成另一种合法对象并正常执行。

因此：

- 执行成功不代表构图符合题意。
- 对象可能创建成功但处于 `undefined` 状态。
- 很难向大模型准确反馈错误参数和错误位置。
- 不利于构建稳定的 ReAct 修复闭环。

参考：[GeoGebra Apps API](https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_API/)

## 选定方向

使用 [`manim-web`](https://github.com/maloyan/manim-web) 作为浏览器渲染和动画引擎，而不是重新开发完整的 ManimTS。

`manim-web` 已经支持：

- 浏览器实时 WebGL 渲染。
- 2D 图形、公式、坐标系和动画。
- `ValueTracker` 和逐帧 `addUpdater`。
- 动点、轨迹和动态 Polygon。
- `Create`、`Transform`、`Fade`、`Indicate` 等效果。
- 播放、暂停和时间线拖动。
- React/Vue 集成与视频导出。

## 需要补充的部分

`manim-web` 是动画引擎，不会像 GeoGebra 一样自动管理几何约束。系统需要增加一个语义几何层：

```text
自由点和参数
    ↓
几何约束与依赖图
    ↓
中点、交点、圆上点等派生对象
    ↓
线段、角、多边形和面积
    ↓
manim-web 对象和 updater
```

当动点变化时，运行时按照依赖顺序更新所有派生对象，从而保持数学一致性。

## 大模型接口

不让模型直接生成 `manim-web` TypeScript，而是生成受限的结构化 DSL：

```json
{
  "op": "create_midpoint",
  "id": "D",
  "points": ["B", "C"]
}
```

再由确定性的编译器生成并执行经过测试的 `manim-web` 代码。

建议的处理流程：

```text
模型生成几何与讲解脚本
    ↓
JSON Schema 校验
    ↓
对象类型和依赖检查
    ↓
隐藏画布预渲染
    ↓
错误以结构化 JSON 返回模型
    ↓
模型修复
    ↓
正式播放
```

结构化错误可以包括：

- `OBJECT_NOT_FOUND`
- `TYPE_MISMATCH`
- `DUPLICATE_ID`
- `CYCLIC_DEPENDENCY`
- `DEGENERATE_CONSTRUCTION`
- `POSTCONDITION_FAILED`
- `RENDER_FAILED`

## 数学正确性

预渲染可以保证代码能运行、对象依赖正确、坐标有效和画面基本正常，但不能自动证明自然语言结论。

后续可以分层验证：

1. 类型与依赖检查。
2. 当前图形的数值检查。
3. 多组参数和随机实例检查。
4. 使用 GCLC 或符号系统验证关键命题。
5. 验证完整证明链。

## 模型能力风险

近期 Manim 生成研究表明，渲染器反馈、API 文档检索和多轮修复能显著提升生成成功率，但渲染成功不等于数学与教学正确。

参考：[Training and Agentic Inference Strategies for LLM-based Manim Animation Generation](https://arxiv.org/abs/2604.18364)

因此真正需要验证的是：

> 大模型能否稳定生成高质量的几何计划和讲解时间线，而不是能否直接编写复杂动画代码。

底层代码质量应由经过测试的编译器和运行时保证。

## 最小原型范围

初期只实现 2D，支持：

- 点、线段、直线、圆、角和多边形。
- 中点、交点、垂线、平行线、角平分线和圆上点。
- `Create`、`Fade`、`Transform`、`Highlight`、`Indicate`、`Focus` 和 `Laser`。
- 旁白与动作时间线。
- 每一步执行后的结构化检查。
- 任意时间点的暂停、回退和重放。

暂时不做：

- 3D。
- 完整的形式化证明系统。
- Python Manim 兼容。
- 通用视频编辑器。

## 下一步验证任务

1. 跑通 `ValueTracker + addUpdater + Polygon` 官方示例。
2. 实现动点 `D`、辅助线 `AD` 和动态面积同步更新。
3. 传入不存在的对象和错误类型，验证异常能否包装成结构化 JSON。
4. 暂时不接入大模型，先确认渲染、依赖和错误反馈闭环。
5. 闭环稳定后，准备 30 至 50 道代表性题目，对比直接生成代码、一次生成 DSL、DSL 加 ReAct 修复三种方案。
