# OpenMAIC 与 DeepTutor：横向比较及产品启示

## 研究范围

本文比较两个本地参考仓库在 2026-07-26 的源码状态：

- OpenMAIC：`1466a55eef9e31e229a0e2e60a0811020d7b06e2`
- DeepTutor：`5e390ffc208f1b86c898304a061fc5921aa0d8a6`

配套的逐项目源码研究见：

- [OpenMAIC 项目分析](openmaic-project-analysis.md)
- [DeepTutor 项目分析](deeptutor-project-analysis.md)
- 几何 Agent 讨论已迁移到当前分支的 Chat Inline Blackboard 与 Agent 平台 spec；本比较文不再引用已删除的实验快照。

本文讨论的是产品结构和能力边界，不是选型结论，也不代表已经确定新产品的目标用户。

## 一句话判断

**OpenMAIC 的核心对象是一堂可生成、可播放、可互动、可导出的 AI 课堂；DeepTutor 的核心对象是一个能持续积累资料、记忆、学习进度和 Agent 能力的个人学习工作区。**

因此，两者不是同一种教育产品的两个实现：

- OpenMAIC 更接近“课堂内容生产系统 + 课堂运行时”。
- DeepTutor 更接近“个人学习操作系统 + Agent 能力平台”。

二者都包含聊天、Agent、可视化、测验和持久化，但这些能力围绕的主对象不同。

## 核心比较

| 维度 | OpenMAIC | DeepTutor | 对新产品的含义 |
|---|---|---|---|
| 产品中心 | 课堂 `Stage`、`Scene`、`Action` | 用户工作区、会话、Book、Memory、Mastery Path | 首先要决定产品围绕“课”还是围绕“学习者”组织 |
| 主要入口 | 输入主题或材料，生成并播放课堂 | 从 Chat 调用工具或 Capability，也可进入 Book、Learning Space | 生成内容和长期陪学是两种不同主流程 |
| 单次体验 | 强舞台感：语音、白板、角色、聚光灯、互动组件 | 强任务感：对话、检索、解题、研究、生成、练习 | “生动”与“持续”目前分别由两边占优 |
| Agent 结构 | Director 选择下一位角色，角色产生文本和课堂动作 | Orchestrator 把一轮交给 Capability，Capability 内部再调用工具或多阶段流水线 | 多角色表演与深任务执行不是同一种编排 |
| 长期状态 | 已有按学习者分区的课堂运行时、测验/PBL 记录和单项目熟练度 | 有跨表面的三层 Memory，以及按 Book 保存的知识点掌握、错因和复习队列 | 两边都有基础，但都没有完成跨课程、统一知识图谱上的长期学生模型 |
| 数学呈现 | 白板公式、图表、线段和生成式 HTML 互动页面 | 生成 Manim Python，批量渲染 MP4/PNG，并有失败重试和可选视觉审查 | 都没有“可约束、可操控、与讲解实时同步”的专用几何运行时 |
| 编程学习 | iframe 内的生成式代码练习器；Python 主要依赖 Pyodide | Agent 可调用服务端代码沙箱；Book 代码块暂未接成实时运行 | 两边都不是面向学生的持久化 IDE，更不是完整 VS Code 学习环境 |
| 内容复用 | 课堂 ZIP、HTML、PPTX、MP4；DSL/renderer/storage 包 | Book、知识库、Notebook、Skill、Partner、Capability/Tool 插件 | OpenMAIC 强在可交付课堂制品，DeepTutor 强在个人知识资产 |
| 质量保障 | 除单元/E2E 测试外，还有编排、白板布局、PBL Planner、语言等 LLM eval harness | 大量单元/集成测试覆盖状态与协议，但未发现同等成熟的教学质量基准体系 | 新产品必须把“能运行”与“学得会”拆成两套评测 |

## OpenMAIC 实际在做什么

### 1. 它先生产一堂课，再运行这堂课

生成管线明确分为大纲和场景两阶段：Stage 1 生成 `SceneOutline`，Stage 2 生成场景内容与动作（`.reference/OpenMAIC/lib/generation/generation-pipeline.ts:1-39`）。

课堂不是一串聊天消息，而是结构化文档：

- 场景类型包括 `slide`、`quiz`、`interactive`、`pbl`（`.reference/OpenMAIC/packages/@openmaic/dsl/src/stage.ts:20-34`）。
- 动作包括语音、聚光灯、激光笔、白板绘制、讨论和 widget 控制（`.reference/OpenMAIC/packages/@openmaic/dsl/src/action.ts:25-248`）。
- 播放引擎在 `idle / playing / paused / live` 之间切换，把预生成讲授与实时讨论接在同一个状态机里（`.reference/OpenMAIC/lib/playback/engine.ts:1-24`）。

因此它的技术优势不只是“多 Agent”，而是把 AI 输出编译成可播放的课堂媒介。

### 2. 它的多 Agent 首先服务于课堂角色感

Director Graph 的单次拓扑最多执行一轮 `director → agent`；多轮讨论由客户端连续请求驱动。单 Agent 时用代码直接调度，多 Agent 时 Director 可用模型选择下一位发言者（`.reference/OpenMAIC/lib/orchestration/director-graph.ts:1-21`、`:89-218`）。

这类架构适合：

- AI 教师与 AI 同学轮流参与；
- 让不同角色产生文本、白板或聚光灯动作；
- 在课堂播放过程中插入讨论。

它不等于让多个专家 Agent 在后台长期协作完成复杂学习任务。

### 3. 它已经开始保存学习者运行时，但还不是长期学情系统

新版 `RuntimeStore` 已把课堂内容与学习者运行时分离：

- 运行时按 `(stageId, learnerKey)` 分区；
- 保存 session 和 append-only records；
- 支持匿名身份合并到登录身份；
- 测验、聊天和 PBL 已接入这一层。

源码明确说明 listing 是单 stage、单 learner 分区，跨 stage 的特例主要是身份合并（`.reference/OpenMAIC/packages/@openmaic/storage/src/runtime/types.ts:1-23`、`:113-124`、`:171-189`）。

PBL v2 进一步保存任务、提交、评价、参与事件和项目内熟练度，并可根据先前测验及运行时信号调整支架（`.reference/OpenMAIC/lib/pbl/v2/types.ts:768-873`；`.reference/OpenMAIC/lib/pbl/v2/operations/proficiency.ts:1-31`）。

但当前未看到以下完整能力：

- 跨课程统一的知识点身份；
- 学科知识依赖图；
- 跨课堂聚合的掌握概率；
- 基于遗忘模型生成的全局复习队列；
- 可追溯的长期错误模型。

所以它有长期系统所需的**事件与身份基础设施**，还没有形成长期教学决策层。

### 4. “在线编程”不是 VS Code

代码互动场景本质上是模型生成的自包含 HTML：

- Python 使用 Pyodide；
- JavaScript 使用浏览器原生执行；
- TypeScript 通过 Babel 转译；
- 编辑器建议通过 CDN 加载 CodeMirror 或 Monaco；
- 整体运行在 sandboxed iframe。

证据见 `.reference/OpenMAIC/lib/prompts/templates/code-content/system.md:1-123` 与 `.reference/OpenMAIC/components/scene-renderers/InteractiveIframeHost.tsx:84-171`。

它适合短练习和即时反馈，但不具备完整 IDE 常见的项目文件系统、语言服务器、依赖环境、终端、调试器、Git、长期工程状态和安全隔离。

## DeepTutor 实际在做什么

### 1. 它把不同深度任务统一成 Capability

CLI、WebSocket 与 SDK 最终都把 `UnifiedContext` 交给 `ChatOrchestrator`。Orchestrator 选择一个 Capability，并通过统一 StreamBus 输出事件（`.reference/DeepTutor/deeptutor/runtime/orchestrator.py:1-94`）。

Tool 与 Capability 是两层不同扩展：

- Tool 是一次函数调用；
- Capability 接管整轮，运行多阶段流程；
- 内置 Capability 包括 Chat、Deep Solve、Deep Question、Deep Research、Visualize、Math Animator 和 Mastery Path（`.reference/DeepTutor/deeptutor/core/capability_protocol.py:1-60`；`.reference/DeepTutor/deeptutor/runtime/bootstrap/builtin_capabilities.py:1-11`）。

因此它更像一个学习领域的 Agent 平台，而不是固定课堂播放器。

### 2. Memory 与 Mastery 是两条不同的数据链

DeepTutor 的 Memory 用于保存“用户是谁、做过什么、偏好什么”：

- L1：按表面、按天追加的原始事件；
- L2：Chat、Notebook、Quiz、KB、Book 等各表面的摘要；
- L3：跨表面的 recent、profile、scope、preferences 文档。

路径与层级定义见 `.reference/DeepTutor/deeptutor/services/memory/paths.py:1-59`。

Mastery Path 则用于保存“哪些知识点掌握到了什么程度”：

- 知识类型、模块和知识点；
- 测验尝试和错误类型；
- 定量及定性掌握门槛；
- 间隔重复状态与复习队列；
- 费曼解释和阶段失败记录。

数据模型见 `.reference/DeepTutor/deeptutor/learning/models.py:24-213`。复习间隔会按知识类型和答题结果更新（`.reference/DeepTutor/deeptutor/learning/scheduler.py:13-98`）。

这一区分值得复用：**自然语言记忆不能替代可计算的学习状态。**

不过 Mastery 当前按 `book_id` 保存为独立 JSON（`.reference/DeepTutor/deeptutor/learning/storage.py:16-52`）。它比 OpenMAIC 更接近长期教学系统，但仍未形成跨 Book 统一的知识本体或全学段能力图。

### 3. Manim 是制品生成，不是实时教学画布

Math Animator 按以下顺序运行：

```text
概念分析 → 教学设计 → Python 代码生成 → Manim 渲染/修复 → 总结
```

流水线会生成 Python 源码，调用本地 Manim 子进程，输出 MP4 或 PNG；失败时最多进行多轮代码修复，并可选取渲染结果做视觉审查（`.reference/DeepTutor/deeptutor/agents/math_animator/pipeline.py:1-218`；`.reference/DeepTutor/deeptutor/agents/math_animator/renderer.py:1-183`）。

这解决的是“如何较稳定地生成数学动画制品”，没有解决：

- 学生拖动点后几何约束实时更新；
- Agent 在学生当前状态上逐步加辅助线；
- 讲解、提问与图形操作形成可暂停的双向闭环；
- 每一步构图接受数学后置条件校验。

### 4. 代码执行也不是学习者 IDE

DeepTutor 有 `exec` / `code_execution` 沙箱，可让 Agent 运行代码并返回产物；但 Book 的代码块源码明确写着，实时运行连接“可以后续接入”（`.reference/DeepTutor/deeptutor/book/blocks/code.py:1-8`）。

现状更适合“Agent 帮用户算、画或生成文件”，不等于学生在持久化工程环境中自己编写、调试和提交项目。

## 两者之间真正空缺的产品层

把两者相加仍不会自然得到目标产品。中间缺少一个把学习证据持续转成下一次沉浸式活动的教学决策层：

```text
学习者行为与作答证据
          ↓
长期学习者模型
  掌握度 / 错误模型 / 兴趣 / 支架需求
          ↓
教学策略
  追问 / 提示 / 演示 / 练习 / 复习 / 项目
          ↓
领域运行时
  几何画布 / 编程环境 / 实验 / 游戏 / 阅读
          ↓
舞台与叙事呈现
  角色 / 语音 / 白板 / 动作 / 场景
          ↓
新的可验证学习证据
```

OpenMAIC 主要覆盖后两层；DeepTutor 主要覆盖前两层及通用 Agent 工具；领域运行时和跨领域教学策略仍需单独设计。

## 对“有趣、生动、沉浸式”的约束

### 沉浸不应只等于媒介丰富

至少要区分三种沉浸：

1. **感官沉浸**：动画、声音、角色、舞台动作。
2. **行动沉浸**：学生可以操控对象、试错并看到因果反馈。
3. **认知沉浸**：任务难度贴近学生当前水平，系统记得其思路，下一步始终有意义。

OpenMAIC 在第一类最强，并已覆盖部分第二类；DeepTutor 在第三类更接近目标。新产品若只复制第一类，很容易变成“自动生成的教育短视频”；若只复制第三类，又容易成为另一个带进度条的聊天机器人。

### 多 Agent 不天然有趣

角色数量、讨论轮次和拟人化只能制造热闹。只有当不同角色承担明确教学功能时才有价值，例如：

- 教师控制教学策略；
- 同伴暴露典型误区；
- 领域运行时执行可验证操作；
- 评估器只记录证据，不抢走学习者的思考。

### 视频不是几何互动的核心

Manim 视频适合复盘、分享和总结。实时解题需要的是可回放的结构化构图与讲解轨迹；视频应由这条轨迹派生，而不是反过来成为系统的主数据。

### IDE 不能只是“看起来像 VS Code”

编程学习真正需要保留的是：

- 项目与文件状态；
- 可复现运行环境；
- 测试、调试与错误历史；
- 学生自己的操作轨迹；
- Agent 的分级介入；
- 能用于掌握度判断的过程证据。

视觉上嵌入 Monaco 只是最表层的一步。

## 当前最有价值的组合假设

在尚未确定目标用户前，最合理的产品假设不是“复制两边的全部功能”，而是：

> 以长期学习者模型为产品主轴，把 OpenMAIC 式舞台和互动场景作为教学表达层，把几何、代码等可验证环境作为领域运行时；每次互动都产生证据，证据决定下一次教学活动。

这仍只是待验证假设。下一步首先要确定产品的主对象究竟是“教师生成的一堂课”，还是“学习者长期回来的个人学习世界”。两者会导向完全不同的信息架构、数据模型、获客方式和最小可行产品。
