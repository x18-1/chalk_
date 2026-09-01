# Chat Inline Chalkboard Scene Spec

> 文档状态：Draft
> 实施状态：Partial
> 适用范围：Chat 中只读展示 Chalkboard Scene 的工具与前端承载层
> 最后核验：2026-08-30

## 1. 目标

Chat 可以在讲解过程中插入一个 Chalkboard `Scene`，用于承载公式、图形、表格、代码、图表和其他教学内容。
该能力不是“数学黑板”，也不创建课堂；它复用 Chalkboard 的 Scene 内容契约，让 Chat 和完整 Chalkboard
共享同一套可呈现内容。

## 2. 范围

### 2.1 包含

- Agent 工具 `render_chalkboard`；
- `slide | quiz | interactive` 三类 Chat Scene content 输入；
- Tool 入口对模型常见别名字段的适配；
- Chat 历史消息和 SSE 流式消息中的 Scene 展示；
- Scene 在 Chat 中只读展示，不执行 Action、不创建课堂、不写入正式 Classroom Artifact。

### 2.2 不包含

- Chat 内的课堂播放控制、Action 执行或互动答题提交；
- 独立的 Chat Blackboard 数据模型；
- 数学插件、判题、知识点归类或学习证据记录；
- 为 Chat 修改 Chalkboard Workspace 的内部运行时。

## 3. 工具契约

工具名称为 `render_chalkboard`，来源为 `chalk`，副作用为 `read`，默认启用且不需要审批。

### 3.1 调用指导

`render_chalkboard` 是承载和校验工具，不负责替代教学设计。模型在生成非平凡
Scene 前应读取内置 `chalkboard-scene-design` Skill。该 Skill 与工具描述共同定义：

- **When to use**：图形、公式布局、比较、过程图、检查题、模拟或动画能明显帮助当前学习目标时；
- **When not to use**：问候、短定义、普通文字解释、装饰性画面或相同内容重复展示时；
- **Prerequisites**：先确定一个学习目标和一个视觉表达，再选择唯一的 Scene 类型；
- **Output semantics**：`content` 只返回给模型的简短确认，完整可渲染内容放在 `details.scene`；
- **Read-only boundary**：Chat 不执行 Chalkboard Action、不修改正式课堂、不提交 Quiz。

Skill 负责构图、版式、视觉层次和类型选择；Tool adapter 负责字段适配、尺寸/颜色默认值及
fail-closed 校验。两者都不能把 Chat Scene 变成独立课堂运行时。

输入的外层结构为：

```ts
{
  title?: string;
  content: {
    type: "slide" | "quiz" | "interactive";
    // type 对应的 SceneContent 字段
    ...
  };
}
```

`content` 必须符合 Chalkboard 现有 `Scene` 内容约束，并由 Tool adapter 在入口处校验：

- `slide` 必须包含 `canvas`；
- `quiz` 必须包含 `questions`；
- `interactive` 必须包含 `url` 或 `html`；
- Chat 当前不接受 `pbl`；PBL 仍属于未来独立运行时范围，不得通过 Chat Tool 伪装成已支持的互动场景。

工具返回一个只读 Scene details：

```ts
{
  type: "scene";
  scene: {
    id: string;
    title: string;
    order: 0;
    type: SceneType;
    actionCount: 0;
    content: SceneContent;
  };
}
```

返回结果不包含 Action，也不能被 Chat 当作课堂或 Learning Session 使用。

Tool result 有两个用途不同的通道：`content` 是会进入下一轮模型上下文的简短文本，`details` 是保存在
transcript 并供 Chat UI 解析的结构化 Scene 数据；当前 Provider 适配器不会把 `details` 原样发送给模型。
因此模型需要继续的信息必须写入简短的 `content`，而渲染所需的完整 Scene 放在 `details.scene`。

## 4. 输入适配边界

Chalkboard 核心只定义并校验标准 `Scene` 内容。模型输入兼容属于 Tool adapter 的职责，不能下沉到
Chalkboard 渲染器或课堂运行时。

当前 adapter 支持以下无损别名转换：

| 模型字段 | Scene 字段 |
|---|---|
| `x` / `y` | `left` / `top` |
| 文本 `text` | `content` |
| 文本 `color` | `defaultColor` |
| LaTeX `text` | `latex` |
| 图片/视频 `url` | `src` |
| 线段 `x1/y1/x2/y2` | `start/end` |
| 线段 `strokeWidth` | `width` |
| 线段 `stroke` | `color` |
| `rect` / `w` / `h` | `shape` / `width` / `height` |
| `shape: "roundedRect"` / `background` | 标准圆角路径 / `fill` |
| `shape: "circle"` | 标准圆形路径 |
| `shape: "ellipse"` / `shape: "oval"` | 标准椭圆路径 |
| `arrow` / `from` / `to` | 带箭头标记的标准 `line` |
| 画布 `background: "#…"` | 标准 `background: { color: "#…" }` |

当模型把 `viewportRatio` 写成大于 1 的宽高比时，adapter 转换为 Chalkboard 使用的“高度 / 宽度”比例。
当模型重试 slide 且遗漏 `content.type`、但仍提供 `canvas` 时，adapter 将其补为 `slide`；其他缺失或不合法
输入必须 fail closed，并由 Agent Runtime 返回工具错误。

## 5. Chat 展示行为

- 工具完成事件中的 `details.type === "scene"` 被渲染为内联 Chalkboard Scene；
- 历史消息恢复和实时 SSE 使用同一解析路径；
- `slide` Scene 复用 Chalkboard `SlideCanvas`，因此文本、LaTeX、图形、表格、图表、代码和媒体沿用同一渲染能力；
- `quiz` Scene 以只读题目与选项呈现，不提供答案提交；
- `interactive` Scene 以隔离的 `sandbox="allow-scripts"` iframe 呈现 HTML/URL 预览，允许自包含的 Canvas/SVG 动画运行；不授予 same-origin、表单、弹窗或顶层导航权限，也不向课堂运行时发送交互 Action；
- Chat 内的 Scene 不显示课堂 Action 控件，不触发播放、审批、答题提交或其他副作用；
- `pbl` 不属于当前 Chat Tool 契约；待未来定义独立 PBL 运行时后再接入。

## 6. 错误与恢复

- 参数校验失败：不执行工具，不生成部分 Scene；
- 工具执行失败：Agent Runtime 使用 `execution_failed` 或对应稳定错误码，Chat 展示失败状态；
- Chat 不会把失败结果伪装成成功 Scene；
- 模型可以在保留上下文的情况下重新调用工具，adapter 对可恢复的字段别名和遗漏 discriminator 做兼容。

## 7. 依赖边界

```text
Chat Agent
  -> render_chalkboard Tool
    -> Tool input adapter
      -> Chalkboard SceneContent contract
        -> Chat InlineChalkboard
          -> Chalkboard SlideCanvas
```

Chat 只依赖 Chalkboard 的公开 Scene/SceneContent 契约和渲染组件，不复制 Chalkboard 模型，不直接依赖课堂
播放状态。Chalkboard 后续升级时，兼容模型输入的改动应优先在 Tool adapter 中完成。

## 8. 验收标准

- `render_chalkboard` 能返回符合 `SceneContentSchema` 的 Scene details；
- 使用 `text/x/y`、`x1/y1/x2/y2` 等模型字段时可以正常展示；
- 没有元素尺寸时，文本不会被默认尺寸裁切；
- 深色画布上的默认文本具备可读对比度；
- 历史消息和流式消息的展示结果一致；
- Chat Scene 不执行 Action、不创建课堂、不修改 Chalkboard 核心运行状态。
