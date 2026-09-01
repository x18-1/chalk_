# manim-web 0.3.24 使用调研（Stage 2 Prompt 依据）

> 版本：`manim-web@0.3.24`（npm 锁定版本；上游 Git tag `v0.3.24`，commit [`f687ad8`](https://github.com/maloyan/manim-web/tree/f687ad88e57293bcf40203f1bf2771dc1e45ca15)）。
>
> 资料优先级：本仓库安装包的 TypeScript 声明/源码和上游同版本源码；README/API 文档只作为补充。安装包位置：`agents/geometry-agent/node_modules/manim-web`。

## 结论摘要

- manim-web 是浏览器端 TypeScript/Three.js 动画引擎；核心编程模型是创建 `Scene`，向场景 `add` mobject，再 `play` 动画和 `wait`。
- `Scene` 没有 Python Manim 风格的 `construct()` 生命周期方法。当前版本通过 `new Scene(container, options)` 创建实例，然后显式调用 `scene.add(...)`、`await scene.play(...)`；React/Vue 集成通过 `onSceneReady`/`ready` 回调获得实例。
- 支持无 DOM 的 `Scene.createHeadless()`，但这是逻辑/测试用 NullRenderer，不产生画面；`getCanvas()`、`getThreeRenderer()` 和 `export()` 在 headless 模式会抛错。
- 2D 几何对象使用三维坐标元组 `[x, y, z]`，教学 DSL 应固定 `z = 0`。`Line` 是有限线段，不是无限直线；无限直线必须由 DSL/编译器决定有限显示范围。
- 动态几何不是自动约束系统。应使用 `ValueTracker` + `Mobject.addUpdater((m, dt) => ...)`，并由 Chalk 约束层按依赖顺序更新派生对象。
- Stage 2 模型不应直接输出任意 TypeScript；推荐输出受控语义 DSL，由确定性编译器生成以下 API 的代码。若确实需要生成代码，必须限制 import、对象构造器、动画类型、生命周期和时长。

## Scene 生命周期与运行方式

### 基础浏览器场景

上游 README 的 Quick Start 使用如下模式：

```ts
import { Scene, Circle, Create } from "manim-web";

const scene = new Scene(document.getElementById("container"), {
  width: 500,
  height: 300,
});
const circle = new Circle({ radius: 1.5 });
await scene.play(new Create(circle));
```

来源：[`README.md`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/README.md#quick-start)、[`src/core/Scene.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/core/Scene.ts)。

`Scene` 构造器签名为 `constructor(container: HTMLElement | null, options?: SceneOptions)`。非 headless 模式要求 container；可选项包括 `width`、`height`、`backgroundColor`、`frameWidth`（默认 14）、`frameHeight`（默认 8）、`targetFps`（默认 60）、`autoRender`、`backgroundOpacity`、`autoResize`。来源：[`src/core/Scene.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/core/Scene.ts#L35-L215)。安装包对应声明：`agents/geometry-agent/node_modules/manim-web/dist/core/Scene.d.ts:35-107`。

`Scene` 的公开生命周期操作：

| 操作 | 语义 |
| --- | --- |
| `scene.add(...mobjects)` | 加入一个或多个 mobject；自动渲染默认开启 |
| `scene.remove(...mobjects)` / `scene.clear()` | 移除对象/清空场景 |
| `await scene.play(...animations)` | 多个动画并行播放；未加入场景的动画对象会自动加入 |
| `await scene.playAll(...animations)` | `play()` 的别名，并行播放 |
| `await scene.wait(duration?)` | 暂停；有 updater 时仍运行逐帧循环 |
| `scene.pause()` / `resume()` / `stop()` / `seek(time)` | 播放控制 |
| `scene.render()` | 强制渲染单帧 |
| `scene.dispose()` | 释放 renderer、mobject、audio 资源 |

来源：[`src/core/Scene.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/core/Scene.ts#L360-L620)。安装包对应声明：`agents/geometry-agent/node_modules/manim-web/dist/core/Scene.d.ts:250-320,517-552`。

### Headless 限制

`Scene.createHeadless(options?)` 等价于 `new Scene(null, { ...options, headless: true })`，使用 `NullRenderer`。它可用于构造、依赖和动画逻辑测试，但 `NullRenderer.render()` 是 no-op；`getCanvas()`、`getThreeRenderer()` 会抛出 “not available in headless mode”，`scene.export()` 也会拒绝执行。来源：[`src/core/Scene.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/core/Scene.ts#L140-L215)、[`src/core/NullRenderer.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/core/NullRenderer.ts)、[`src/core/Headless.test.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/core/Headless.test.ts)。

因此，编译器预检可以在 headless 场景执行对象和动画逻辑，但不能把它当作真实渲染成功证明；正式渲染需要浏览器 DOM + WebGL。

## 2D 几何 mobject API

所有点坐标类型为 `Vector3Tuple = [number, number, number]`。以下构造器均从 `manim-web` 根入口导出（来源：[`src/index.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/index.ts)）。

### Dot

```ts
new Dot({ point?: [x, y, z], radius?: number, color?: string,
  fillOpacity?: number, strokeWidth?: number })
```

默认点 `[0,0,0]`、半径 `0.08`、白色填充。可用 `getPoint()`、`setPoint(point)`。来源：[`src/mobjects/geometry/Dot.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/mobjects/geometry/Dot.ts#L1-L80)。

### Line（有限线段）

```ts
new Line({ start?: [x, y, z], end?: [x, y, z],
  color?: string, strokeWidth?: number })
```

默认起点 `[0,0,0]`、终点 `[1,0,0]`。可用 `getStart/getEnd/getLength/getMidpoint/getDirection/getAngle/pointAlongPath` 及 `setStart/setEnd`。它的语义是 straight line **segment**；不要把 `Line` 当无限直线。来源：[`src/mobjects/geometry/Line.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/mobjects/geometry/Line.ts#L1-L110)。

### Circle

```ts
new Circle({ radius?: number, center?: [x, y, z], color?: string,
  fillOpacity?: number, strokeWidth?: number, numPoints?: number })
```

默认半径 1、中心原点、无填充（`fillOpacity = 0`）。可用 `getRadius/setRadius`、`setCircleCenter`、`pointAtAngle`、`getCircumference/getArea`。来源：[`src/mobjects/geometry/Circle.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/mobjects/geometry/Circle.ts#L1-L130)。

### Polygon

```ts
new Polygon({ vertices: [[x1,y1,z1], ...], closed?: boolean,
  color?: string, fillOpacity?: number, strokeWidth?: number })
```

`vertices` 必填，`closed` 默认 true。可用 `get/setVertices`、`getVertex/setVertex`、`getCentroid`、`getArea/getPerimeter`。来源：[`src/mobjects/geometry/Polygon.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/mobjects/geometry/Polygon.ts#L1-L150)。

### Arc

```ts
new Arc({ radius?: number, startAngle?: number, angle?: number,
  center?: [x,y,z], color?: string, strokeWidth?: number,
  numComponents?: number })
```

角度均为弧度；默认 `startAngle = 0`、`angle = π/2`、半径 1。可用 `get/setStartAngle`、`get/setAngle`、`get/setRadius`、`get/setArcCenter`、`pointFromProportion`、`getStartPoint/getEndPoint`。来源：[`src/mobjects/geometry/Arc.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/mobjects/geometry/Arc.ts#L1-L150)。

### Angle / RightAngle

`Angle` 输入可以是两条 `Line` 或三个点 `[start, vertex, end]`，顶点是中间点；可配置 `radius`、`otherAngle`、`showValue`、`unit: 'radians' | 'degrees'`、`axis`。`RightAngle` 同样支持两条线或三点输入。来源：[`src/mobjects/geometry/AngleShapes.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/mobjects/geometry/AngleShapes.ts#L1-L220)。

## 动画 API 与时间组织

基础动画都继承 `Animation`，构造器接收 mobject 和 `{ duration?, rateFunc?, shift? }`；默认时长 1 秒（`FocusOn` 默认 0.5 秒，`Indicate` 默认 1 秒）。来源：[`src/animation/Animation.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/animation/Animation.ts)、[`src/animation/indication/FocusOn.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/animation/indication/FocusOn.ts)、[`src/animation/indication/Indicate.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/animation/indication/Indicate.ts)。

| 动画 | 作用与关键参数 |
| --- | --- |
| `new Create(mobject, { duration?, lagRatio? })` | 渐进绘制线条；带填充图形先画边界再显示填充 |
| `new FadeIn(mobject, { duration?, shift? })` | 从透明度 0 渐入，可带位移 |
| `new FadeOut(mobject, { duration?, shift? })` | 渐出并在结束后从 scene 移除（`remover = true`） |
| `new Transform(source, target, { duration? })` | 形状/点集变换；`ReplacementTransform` 结束时以 target 替换 source |
| `new Indicate(mobject, { scaleFactor?, color?, duration? })` | 放大并变色后恢复；默认黄色、1.2 倍 |
| `new FocusOn(mobject, { startRadius?, endRadius?, numRings?, color?, duration? })` | 在对象中心创建收拢环；默认 5 个环、半径 2→0 |

来源：[`src/animation/creation/Create.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/animation/creation/Create.ts)、[`src/animation/fading/FadeIn.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/animation/fading/FadeIn.ts)、[`src/animation/fading/FadeOut.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/animation/fading/FadeOut.ts)、[`src/animation/transform/Transform.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/animation/transform/Transform.ts)、[`src/animation/indication/Indicate.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/animation/indication/Indicate.ts)、[`src/animation/indication/FocusOn.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/animation/indication/FocusOn.ts)。

多个动画传给一次 `scene.play(a, b)` 会并行。需要错峰/串行时使用 `AnimationGroup`（`lagRatio: 0` 并行，`lagRatio: 1` 顺序）、`LaggedStart` 或 `Succession`。来源：[`src/animation/AnimationGroup.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/animation/AnimationGroup.ts)、[`src/animation/LaggedStart.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/animation/LaggedStart.ts)、[`src/animation/Succession.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/animation/Succession.ts)。

## ValueTracker 与 updater（动态几何）

`ValueTracker` 是不可见 mobject，保存一个数字，可 `getValue()`、`setValue()`、`incrementValue()`，并通过 `animateTo(target, { duration?, rateFunc? })` 生成动画。mobject 的 `addUpdater(updater, callOnAdd?)` 接收 `(mobject, dt)`，每帧调用；可用 `removeUpdater`、`clearUpdaters`、`hasUpdaters`。来源：[`src/mobjects/value-tracker/ValueTracker.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/mobjects/value-tracker/ValueTracker.ts)、[`src/core/Mobject.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/core/Mobject.ts)。

官方示例展示了用 tracker 驱动点，并在 updater 中重建线段：

```ts
const tracker = new ValueTracker(0);
const dot = new Dot();
dot.addUpdater((d) => d.moveTo([tracker.getValue(), 0, 0]));
scene.add(tracker, dot);
await scene.play(tracker.animateTo(5, { duration: 2 }));
```

来源：[`ValueTracker.ts` 文档注释](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/mobjects/value-tracker/ValueTracker.ts#L1-L90)、[`examples/moving_dots.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/examples/moving_dots.ts)。

约束注意：manim-web 只负责逐帧更新和渲染，不推导“中点、垂足、交点”等数学约束。Chalk 应在 DSL/约束层计算派生坐标，按拓扑顺序在 updater 中更新；不要要求模型依赖 manim-web 自动保持几何关系。

## React、Vue 与 headless/导出边界

- React 入口为 `manim-web/react`，提供 `useScene`、`useMobject`、`useAnimation`、`useUpdater`、`useWait`、`usePlaybackControls` 和 `ManimScene`。`ManimScene` 的实际 props 是 `width`、`height`、背景选项、`onSceneReady(scene)`、children 等；当前源码没有 `construct` prop。来源：[`src/integrations/react.tsx`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/integrations/react.tsx#L1-L220)。
- Vue 入口为 `manim-web/vue`，提供 `useScene`、`useMobject`、`useAnimation`、`useUpdater`，以及 `ManimScene`（`ready` 事件）。来源：[`src/integrations/vue.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/integrations/vue.ts#L1-L330)。
- `scene.export(filename, options?)` 依赖浏览器 canvas/MediaRecorder；支持 `.gif`、`.webm`、`.mp4`、`.mov`，其中 MP4/MOV 编解码取决于浏览器。headless 不支持导出。来源：[`src/core/Scene.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/core/Scene.ts)、[`src/export/VideoExporter.ts`](https://github.com/maloyan/manim-web/blob/f687ad88e57293bcf40203f1bf2771dc1e45ca15/src/export/VideoExporter.ts#L1-L120)。

## Stage 2 Prompt 编写约束

Stage 2 的目标是让模型输出“可编译的教学场景计划”，而不是自由发挥的任意 TS。Prompt 应明确：

1. 先引用 Stage 1 的事实和 DSL 对象 ID；禁止创建未声明或重复 ID。
2. 坐标使用 `[x,y,0]`；角度使用弧度；`Line` 仅表示有限线段。无限直线由 DSL 的 `line` 语义和编译器显示范围实现。
3. 只允许白名单 mobject（Dot、Line、Circle、Polygon、Arc、Angle、RightAngle 及必要文本）和白名单动画（Create、FadeIn、FadeOut、Transform、Indicate、FocusOn、AnimationGroup/Succession/LaggedStart）。
4. 不输出 import、`Scene` 构造、DOM 查询、React/Vue 组件、任意 Three.js、网络请求、文件访问或原始 JS/TS；这些由确定性编译器负责。
5. 每个教学 beat 声明 `create`/`fade_in`/`fade_out`/`transform`/`indicate`/`focus_on`/`wait` 及秒数；编译器按顺序生成 `await scene.play(...)` 和 `await scene.wait(...)`。
6. 动态对象只通过受控 tracker/updater DSL 表达。派生几何必须引用依赖并按拓扑顺序更新，禁止在 updater 中引入不可验证的随机或副作用逻辑。
7. 渲染预检分两层：headless 验证对象/动画逻辑；浏览器 WebGL 才能验证真实画面和导出。不要把 headless 通过误报为渲染成功。
8. 生成代码必须在结束时调用 `scene.dispose()`（由宿主统一负责亦可，但 Prompt 要明确所有权），避免长期会话泄漏资源。

这些约束直接对应 0.3.24 的公开类型和源码行为，避免模型生成 README 中不存在或当前集成实际不接受的 `construct`/`setup` 参数。
