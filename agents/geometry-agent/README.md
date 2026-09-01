# Geometry Agent Prototype

一个与 Chalk 业务代码隔离的几何 Agent。它沿用 Chalk Edu 的两阶段流程：第一阶段只从题目文字和图片提取结构化事实；第二阶段以这些事实为权威生成 GeoGebra 命令脚本和教学时间线。TypeScript 宿主负责脚本 schema、安全与依赖校验，并在展示页逐条执行命令；GeoGebra 原生维护几何约束、Slider 和动态依赖。

## 两阶段流程

1. `stage1.system`：只提取、不解题、不推导，输出与旧项目 Geo2Geo v1 对齐的 `problem_type`、`task_goal`、对象、关系、约束、动点、图形标注和歧义。
2. `stage2.geogebra.system`：接收原题、Stage 1 JSON 和可选配图，按旧项目 Geo2Geo v2 的依赖顺序重建核心图形，通过 `submit_geogebra_script` 提交一行一条命令的脚本，再调用 `verify_geogebra_script`；模型不直接生成 JavaScript/TypeScript。
3. 确定性层：校验命令安全性、未定义引用、重复/保留对象名和时间线引用；宿主可通过 `verifyGeoGebra` 注入真实 Classic Applet 验证回调，只有验证通过后才允许 finalize，并持久化 Stage 1、GeoGebra 脚本、诊断与教学时间线。

Prompt 集中放在 [`prompts/geometry-agent/`](prompts/geometry-agent/)；运行时只读取英文版，中文版用于审阅，来源和适配说明记录在 `registry.ts`。

## 能力边界

- 输入：题目文字，以及 PNG/JPEG/WebP/GIF 图片。
- 几何对象：自由点、中点、中心对称点、线段、直线、圆、椭圆、抛物线、多边形、直线交点、平行线、垂线和坐标轴。
- 场景行为：GeoGebra 原生 Slider、路径点和派生对象负责动态更新；有动点时由 GeoGebra 显示控制条，没有动点时不显示拖拽控件。
- 后置条件：等长、共线、平行、垂直。
- 输出：Stage 1 提取事实、Stage 2 GeoGebra 命令脚本（含坐标系、直角符号、曲线和动点约束）、教学时间线、诊断、会话日志和 artifact 文件。
- 暂不支持：3D、圆线交点、角平分线、除线段/椭圆外的非线性动点轨迹、符号证明、浏览器预渲染和业务系统接入。

模型不会直接生成可执行 TypeScript。只有经过 Zod 校验、命令安全检查和时间线对象引用检查的 GeoGebra 脚本才能进入 artifact；浏览器运行时逐条执行并显示失败命令的序号和原文。

## 运行

```bash
cd /home/xcodd/code/chalk_/agents/geometry-agent
export GEOMETRY_AGENT_API_KEY='...'
pnpm cli -- --problem '在三角形 ABC 中，D 是 BC 中点。延长 AD 到 E，使 DE=AD。' --image ./problem.png
```

默认模型和端点：

```text
GEOMETRY_AGENT_MODEL=gpt-5.6-sol
GEOMETRY_AGENT_BASE_URL=https://premium.hezubus.cc/v1
```

`pi-ai` 的 Responses adapter 会在 base URL 后请求 `/responses`。每次运行写入 `runs/<run-id>/`；评测还会按题目写入 `stage1-problem-facts.json`、`stage2-geogebra.json`、`geogebra-script.txt`、`stage2-lesson-timeline.json` 和最终 artifact。图片字节不会写进会话日志或阶段结果。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm tsx eval/run-fixtures.ts
```

没有 API key 时仍可执行全部确定性测试；真实模型调用会 fail closed。

## 可视化检查

展示页在浏览器中嵌入 GeoGebra Classic，逐条执行 artifact 中的命令，同时显示原图、题目 Markdown、Stage 1 摘要、命令源、命令级错误和教学时间线：

```bash
cd /home/xcodd/code/chalk_/agents/geometry-agent
pnpm --ignore-workspace run showcase
```

打开命令输出的 `http://127.0.0.1:4173`，选择评测题目即可直接检查图形；GeoGebra 自带 Slider/拖拽交互，重置按钮会重新创建 applet。GeoGebra 模式不播放 manim 构图动画。
