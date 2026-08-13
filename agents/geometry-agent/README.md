# Geometry Agent Prototype

一个与 Chalk 业务代码隔离的二维几何 Agent。它使用 `pi-agent-core` 的工具循环理解题目文字和图片，提交结构化事实、语义几何 DSL 和教学时间线，再由确定性 TypeScript 代码校验约束并编译为 `manim-web` 场景源码。

## 能力边界

- 输入：题目文字，以及 PNG/JPEG/WebP/GIF 图片。
- 几何对象：自由点、中点、中心对称点、线段、直线、圆、多边形、直线交点、平行线和垂线。
- 后置条件：等长、共线、平行、垂直。
- 输出：提取事实、几何 DSL、教学时间线、诊断、会话日志和 `manim-web` TypeScript。
- 暂不支持：3D、圆线交点、角平分线、符号证明、浏览器预渲染和业务系统接入。

模型不会直接生成可执行 TypeScript。只有经过 Zod 校验、依赖检查、数值求值和后置条件验证的 DSL 才能被编译。

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

`pi-ai` 的 Responses adapter 会在 base URL 后请求 `/responses`。每次运行写入 `runs/<run-id>/`；图片字节不会写进会话日志。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm tsx eval/run-fixtures.ts
```

没有 API key 时仍可执行全部确定性测试；真实模型调用会 fail closed。
