# OpenMAIC 项目分析：它是什么，以及哪些部分值得用于长期沉浸式教育产品

> 研究对象：`.reference/OpenMAIC`  
> 基准提交：`1466a55eef9e31e229a0e2e60a0811020d7b06e2`（`main`）  
> 研究日期：2026-07-26  
> 方法：只阅读仓库内 README、源码、配置、测试与评测代码；没有把 README 中的愿景自动视为已实现，也没有做完整运行验收。

## 先给产品决策结论

OpenMAIC 不是一个“长期陪伴、持续建模学生能力的个人导师”。它更准确的定位是：

> **把主题或材料生成成一个可执行的 AI 课堂包，再由确定性的播放引擎、多个课堂角色和可打断的实时对话把它演出来。**

它同时服务两类人：

- **课堂作者/教师**：输入主题、文档和要求，审阅大纲，生成和编辑场景，最后导出课堂、PPTX 或视频。
- **学习者**：进入由幻灯片、测验、互动网页和 PBL 项目组成的课堂，听讲、看白板、插话、参与讨论并提交任务。

这个判断来自它的两段式生成流程和四类场景，而不只是 README 的宣传文案：系统先生成大纲，再逐场景生成内容、动作和语音（`.reference/OpenMAIC/lib/types/generation.ts:1-6`；`.reference/OpenMAIC/lib/hooks/use-scene-generator.ts:510-683`）；场景类型固定为 `slide | quiz | interactive | pbl`（`.reference/OpenMAIC/packages/@openmaic/dsl/src/stage.ts:19-43`）。

对拟议中的“有趣、生动、沉浸、可长期积累”的教育产品，OpenMAIC 最值得借鉴的是**课堂执行层**，而不是学习者长期模型：

| 产品问题 | OpenMAIC 能否直接回答 | 决策 |
|---|---|---|
| 如何把一节课“演”得生动 | 能：动作 DSL、语音、白板、多角色、互动 iframe、可打断播放 | 重点复用思想和部分模块 |
| 如何生成一节可编辑、可导出的课 | 基本能：大纲→场景→动作/TTS→导出 | 可作为内容生产基线 |
| 如何做项目式学习 | 能，但状态主要局限于单个 PBL 项目 | 复用事件与任务模型，重做跨课程归档 |
| 如何跨课程长期追踪一个学生 | **不能**：未发现全局知识点、掌握度证据、复习计划或课程间迁移模型 | 必须另建核心领域模型 |
| 如何提供真正的 VS Code 学习环境 | **不能**：现有实现是单页 iframe 代码 playground | 只能复用交互协议，不能当运行底座 |
| 如何做 Manim 几何讲解与视频 | **没有现成能力**：白板有线、形状、LaTeX，但没有语义几何模型或 Manim 管线 | 应作为独立的数学工具链建设 |

## 核心体验与系统闭环

OpenMAIC 的主闭环可以概括为：

```text
主题 / PDF / 学生昵称与简介
          ↓
流式生成并审阅课程大纲
          ↓
逐场景生成内容 → 教学动作 → TTS / 媒体
          ↓
保存为 Stage（场景 + 动作 + 角色 + 资源）
          ↓
播放课堂 ── 学生插话 / 讨论 / 白板 / 互动网页
          ↓
测验结果或 PBL 项目状态
          ↓
本机或可选服务端运行时存储 + 导出
```

其中，“生成课堂”和“上课”是明确分开的：生成侧将场景内容、动作和音频逐步写入 Stage（`.reference/OpenMAIC/lib/hooks/use-scene-generator.ts:510-683`）；播放侧直接消费动作序列，并在 `idle / playing / paused / live` 状态之间转换（`.reference/OpenMAIC/lib/playback/types.ts:5-18`；`.reference/OpenMAIC/lib/playback/engine.ts:1-24`）。

这带来一个很重要的架构价值：**LLM 负责创作与临场响应，课堂主时间线由可检查、可回放的结构化数据控制**。它比让一个 Agent 从头到尾自由聊天，更容易暂停、恢复、编辑、测试和导出。

## 1. 生成管线：内容生产很完整，个性化仍很浅

### 已实现的机制

1. **大纲阶段**会组合用户要求、昵称/简介、PDF 文本与图片、可选的网络研究上下文，再流式输出课程标题和场景大纲；失败最多重试两次（即总计三次尝试）（`.reference/OpenMAIC/app/api/generate/scene-outlines-stream/route.ts:285-383`、`:393-447`、`:449-607`）。
2. **场景阶段**按类型路由到幻灯片、测验、互动组件或 PBL 生成器（`.reference/OpenMAIC/lib/generation/scene-generator.ts:194-276`）。
3. 内容生成后，再串行生成动作和 TTS；内容本身可通过配置做有限并行，但动作与 TTS 保持串行以维持前文连续性（`.reference/OpenMAIC/lib/hooks/use-scene-generator.ts:455-508`；`.reference/OpenMAIC/.env.example:266-269`）。
4. 生成失败时会保存已完成场景并允许暂停/重试，而不是整课报废（`.reference/OpenMAIC/lib/hooks/use-scene-generator.ts:510-683`）。

### 对产品的含义

这是一个可用的**课程编译管线**，但不是自适应教学闭环。当前用于个性化大纲的长期信息只是一个自由文本要求、昵称和简介等轻量字段（`.reference/OpenMAIC/lib/types/generation.ts:71-82`），并没有读取“知识点掌握证据→选择下一教学策略→再次测量”的跨课策略。

建议保留它的两阶段创作方式，但在前面增加一个独立的 `LearningPlan` 决策层：

```text
长期 LearnerModel → 本次学习目标与先修缺口 → 课程大纲 → OpenMAIC 式场景生成
```

否则每次都能生成一节很热闹的课，却无法回答“这个学生为什么此刻应该学这一节”。

## 2. Stage 与 Action DSL：真正有复用价值的“课堂中间表示”

`Stage` 保存元数据、场景、角色、白板、视频清单和功能标志；场景包含内容、动作、白板和多 Agent 配置（`.reference/OpenMAIC/packages/@openmaic/dsl/src/stage.ts:59-121`、`:180-233`）。

动作 DSL 同时服务在线播放和离线导出，包含：

- 聚光、激光笔、语音、视频；
- 白板开关、文字、形状、图表、LaTeX、表格、线条、代码和代码编辑；
- 讨论；
- 互动组件的高亮、状态变更、标注和逐步揭示。

动作全集和同步/非阻塞分类见 `.reference/OpenMAIC/packages/@openmaic/dsl/src/action.ts:20-52`、`:54-177`、`:179-277`。

这个 DSL 的价值在于它是**教学演出的控制协议**：可以把“老师说什么、指哪里、画什么、何时等待”变成可记录动作。但它不是教育领域模型：其中没有知识点、先修关系、误解类型、证据强度、教学策略或间隔复习等概念。

因此可以直接借鉴：

- `LessonArtifact / Scene / Action / PlaybackCursor` 这一层；
- 同一动作同时驱动在线课堂和导出的思想；
- 内容与动作分离，让教师修改内容后重新编排动作。

不应把它扩充成无所不包的长期学习数据库。课堂编排与学生认知状态应是两个深模块，通过稳定接口连接。

## 3. 播放与实时交互：沉浸感来自“可打断的编排”

播放引擎维护场景和动作游标，支持快照、恢复、跳转以及白板状态重建（`.reference/OpenMAIC/lib/playback/engine.ts:131-217`）。正常上课时动作顺序执行；视觉效果可非阻塞执行，视频、白板和组件动作则可同步等待（同文件 `:540-611`、`:655-737`）。

实时交互不是另开一条完全无关的聊天：

- 主讲过程中出现主动讨论卡，用户可加入或跳过；讨论结束后恢复原课堂位置（`.reference/OpenMAIC/lib/playback/engine.ts:341-413`）。
- 学生发言会保存当前游标，将引擎切换到 `live`，随后可以返回原讲授时间线（同文件 `:438-467`）。

这是 OpenMAIC 对“沉浸式”最值得复用的回答：**沉浸不是堆 3D，而是系统知道自己正在讲到哪里，允许用户介入，并能自然返回。**

不过当前恢复游标是设备范围的可变状态，已消费讨论还被刻意设计为易失状态（`.reference/OpenMAIC/lib/playback/cursor.ts:1-7`、`:96-100`）。它解决的是“继续播放”，不是可审计的长期学习经历。

## 4. 多 Agent：课堂角色系统，而非多个自治教师

默认角色包括主讲教师、助教、搞笑学生、好奇学生、笔记员和思考者。各角色有不同人格、优先级与白板/幻灯片权限（`.reference/OpenMAIC/lib/orchestration/registry/store.ts:28-70`、`:72-166`）。

当前主聊天路径是无状态 SSE：浏览器把完整消息、Stage 状态和 Agent 配置发给服务端（`.reference/OpenMAIC/app/api/chat/route.ts:1-13`、`:44-195`）。LangGraph 图每次由 Director 选出一个 Agent 或结束，再由客户端发起下一轮；它不是服务端持续运行的自治 Agent 群（`.reference/OpenMAIC/lib/orchestration/director-graph.ts:1-21`、`:91-221`、`:470-547`）。

仓库另有 Pi 服务端循环，但它被明确标记为实验功能且默认关闭（`.reference/OpenMAIC/.env.example:209-212`；`.reference/OpenMAIC/app/api/chat/pi/route.ts:1-31`）。

产品上应把这些角色理解为**节奏与视角的戏剧机制**：

- 好奇学生可以替真实用户问出“不敢问的问题”；
- 笔记员可以阶段总结；
- 反方或思考者可以制造认知冲突；
- 助教可以换一种表征方式解释。

但角色数量不等于教学质量。若没有一层 `PedagogyPolicy` 决定“何时需要举例、诊断、追问、反例、总结”，多个 Agent 很容易增加延迟、成本和噪音。建议 Director 首先选择**教学动作**，然后才决定由哪个角色表达。

## 5. 白板、语音与深度互动

### 白板

白板协议已经能表达文字、形状、线段、图表、表格、LaTeX 和代码，并允许编辑或删除已有对象（`.reference/OpenMAIC/packages/@openmaic/dsl/src/action.ts:54-177`）。这足以承载公式推导、草图和分步讲解。

但它仍是通用绘图动作，不是语义数学系统。仓库内未发现 Manim 适配器、几何定理/约束模型或“辅助线→证明步骤→动画时间线”的专门管线。对于几何产品，应另建：

```text
GeometryProblem
  → SemanticConstruction（点、线、圆、约束、辅助线）
  → ProofStep（依据、目标、可见对象）
  → ClassroomAction（边讲边画）
  → ManimScene（最终高质量视频）
```

OpenMAIC 的动作引擎可以成为实时讲解出口，但不应承担几何求解与 Manim 编译。

### 语音

系统支持多种 TTS/ASR 供应商，并允许按生成阶段选择模型（`.reference/OpenMAIC/.env.example:95-130`、`:221-260`）。语音作为 `speech` 动作参与播放，因而能和指示、白板及场景变化对齐，而不是简单给整页文本朗读。

这对沉浸感有帮助，但教育产品还需要额外处理低龄隐私、口音与识别置信度、打断检测、字幕可访问性和语音失败降级；源码中的供应商接入本身不能回答这些产品问题。

### 深度互动

互动场景由一个持久化 iframe 承载。iframe 使用不含 `allow-same-origin` 的 sandbox，并通过 `postMessage` 接受高亮、状态设置、标注和逐步揭示等动作（`.reference/OpenMAIC/components/scene-renderers/InteractiveIframeHost.tsx:13-30`、`:83-175`；`.reference/OpenMAIC/lib/prompts/templates/interactive-actions/system.md:54-116`）。

这种“生成网页 + 受控消息协议”的方案适合：

- 轻量仿真；
- 交互图表和 3D 可视化；
- 小游戏；
- 单页代码实验；
- 为某个概念定制的交互操作。

风险是生成结果依赖 HTML/JavaScript 和外部 CDN，质量、安全边界、可访问性与移动端性能都需要运行时验证。它更像可生成的微应用容器，而不是稳定的学科工具 API。

## 6. 在线编程：像 IDE 的单页 Playground，离 VS Code 还有两层

类型定义声称代码组件可覆盖 Python、JavaScript、TypeScript、Java 和 C++（`.reference/OpenMAIC/lib/types/widgets.ts:64-82`），但实际生成提示只定义了：

- Python：浏览器中的 Pyodide；
- JavaScript：浏览器原生执行；
- TypeScript：浏览器中的 Babel 转译；
- 编辑器 UI：CodeMirror 或 Monaco CDN。

证据见 `.reference/OpenMAIC/lib/prompts/templates/code-content/system.md:1-10`、`:110-117`、`:126-217`。iframe 的 `localStorage` 还是为了适应 unique-origin sandbox 而注入的内存 shim，不是持久工作区（`.reference/OpenMAIC/lib/utils/iframe.ts:1-45`、`:101-145`）。

因此它距“嵌入 VS Code 的在线编程学习环境”并非换一个编辑器组件那么简单：

| 层 | OpenMAIC 当前状态 | 真正教学 IDE 仍需要 |
|---|---|---|
| 界面层 | 可用 Monaco/CodeMirror 做单页编辑器 | 文件树、多文件 diff、断点、终端、教学提示与代码定位 |
| 语言工具层 | 浏览器执行 Python/JS/TS | LSP、编译器、依赖管理、单测、静态分析、调试协议 |
| 执行层 | unique-origin iframe | 每用户隔离容器/微 VM、CPU/内存/时限、网络与密钥策略 |
| 学习状态层 | iframe 内临时状态 | 项目快照、提交历史、错误轨迹、测试证据与能力模型联动 |

最合理的复用边界是保留 `widget action + postMessage` 作为“AI 教师操作 IDE”的前端协议；真正的工作区、语言服务和执行沙箱应由独立 Coding Runtime 提供。Java/C++ 在类型层与当前实际生成执行能力之间的差异，也说明不能把配置枚举当成已交付能力。

## 7. PBL：单项目内的学习闭环很强，不能冒充长期 Learner Model

PBL v2 已经不只是静态任务板。它提供：

- `Hero → Workspace → Completion` 的项目流程；
- 里程碑、微任务、提交物、结构化评价和交接门；
- 参与事件；
- 初始与项目内持续更新的熟练度分数、层级、置信度和历史；
- Instructor 对话线程。

模型声明和顶层项目结构见 `.reference/OpenMAIC/lib/pbl/v2/types.ts:1-70`、`:93-179`、`:541-700`、`:744-840`。运行时还可以抽取并重新应用任务、提交、评价、线程、参与度和熟练度状态（`.reference/OpenMAIC/lib/pbl/v2/runtime/learner-state.ts:20-56`、`:67-215`），并通过事件记录进行水合与修复（`.reference/OpenMAIC/lib/pbl/v2/runtime/hydration.ts:28-43`、`:94-152`、`:231-320`）。

这是值得借鉴的“做中学”模型，但边界非常明确：

- PBL 模型明确“位于 `scene.content.projectV2`”（`.reference/OpenMAIC/lib/pbl/v2/types.ts:748-750`）。
- RuntimeStore 按 `(stageId, learnerKey)` 分区（`.reference/OpenMAIC/packages/@openmaic/storage/README.md:54-72`）。
- 熟练度驱动的是该 PBL 内 Instructor 的分层指导（`.reference/OpenMAIC/lib/pbl/v2/types.ts:791-799`）。

所以，**当前学习进度是单课堂/单 Stage 下的 quiz、chat、PBL 运行状态；PBL 的适应性也主要是单项目范围。它不是跨课程长期 Learner Model。**

没有发现以下全局能力：

- 统一知识点/能力图谱；
- 不同课程证据归并；
- 掌握度随时间衰减；
- 间隔复习与召回计划；
- 误解模式和先修缺口；
- 跨课堂作品集、目标和教师观察；
- 由长期证据驱动的下一课选择。

拟议产品需要把 PBL 产生的 `submission / evaluation / engagement / proficiency signal` 视为证据输入，归一化写入独立的长期模型，而不是直接保存整个 PBL 项目充当学生档案。

## 8. 持久化与多用户：数据接口已铺路，身份与隔离尚未产品化

存储包把浏览器、HTTP 和 PostgreSQL 后端抽象成文档、资源和运行时存储；运行时记录支持追加和合并（`.reference/OpenMAIC/packages/@openmaic/storage/README.md:1-11`、`:23-72`）。目前运行时类别包括 PBL、聊天和测验，默认实现仍是浏览器存储（`.reference/OpenMAIC/lib/runtime/store.ts:1-43`；`.reference/OpenMAIC/lib/document-store/store.ts:22-61`）。

服务端持久化需要显式启用；未登录时使用每设备匿名 learner key（`.reference/OpenMAIC/lib/persistence/bootstrap.ts:12-60`；`.reference/OpenMAIC/lib/runtime/learner-key.ts:1-8`、`:31-65`）。更关键的是，仓库自己把当前服务端认证标为**仅开发用途**：公开 bearer token 不能提供机密性或用户隔离，调用方还可以自行提交 learner key（`.reference/OpenMAIC/lib/persistence/server-auth.ts:1-12`、`:29-37`）。

因此不能把“有 PostgreSQL backend”误判为“已经支持学校多用户”：

- 没有完成的账号、组织、班级、教师/学生/家长角色；
- 没有生产级租户隔离和授权策略；
- 匿名设备身份无法自然实现跨设备长期档案；
- 用户 profile 只把昵称、头像和简介保存在 localStorage（`.reference/OpenMAIC/lib/store/user-profile.ts:1-43`）。

可复用的是 Store 契约和 append-only runtime record 思路；不可直接复用的是认证、租户和长期学生档案方案。

## 9. 测验与反馈

选择题在本地按答案集合精确匹配；简答题调用 LLM 评分（`.reference/OpenMAIC/lib/quiz/grading.ts:23-51`；`.reference/OpenMAIC/app/api/quiz-grade/route.ts:1-6`、`:46-105`）。当 LLM 输出无法解析时，系统会默认给 50% 分和通用评语（`.reference/OpenMAIC/app/api/quiz-grade/route.ts:82-103`）。

这足以支撑课堂即时反馈，但不适合作为高风险的正式评量。尤其默认半分会污染长期能力证据。若进入长期 Learner Model，应保存评分来源、rubric、模型版本、置信度和人工复核状态，并区分“练习反馈”和“掌握证据”。

## 10. 导出能力：课堂包最完整，视频不是所有互动的真实录屏

当前有三类重要导出：

1. **课堂包 `.maic.zip`**：包含 Stage、角色、音频、媒体和交互 HTML，偏向可移植的课程制品（`.reference/OpenMAIC/lib/export/use-export-classroom.ts:49-63`、`:65-216`）。
2. **PPTX / 资源包**：PPTX 只处理 slide 场景；资源包可额外带互动页面（`.reference/OpenMAIC/lib/export/use-export-pptx.ts:1185-1197`、`:1216-1269`）。
3. **MP4**：先编译确定性时间线，再交给可选 Chromium + FFmpeg 服务；未配置服务时退化为下载本地渲染 ZIP（`.reference/OpenMAIC/lib/video-export/compile.ts:1-19`；`.reference/OpenMAIC/app/api/export-video/capability/route.ts:6-15`；`.reference/OpenMAIC/render-service/README.md:1-30`）。

视频编译器明确把 quiz、interactive 和 PBL 作为不支持场景并生成占位信息（`.reference/OpenMAIC/lib/video-export/compile.ts:50-95`）。所以 MP4 更接近“幻灯片 + 教学动作 + 音频的确定性视频”，不是完整捕捉所有互动体验。

渲染服务目前还把任务放在内存、产物放在本地磁盘；Redis、对象存储和分布式渲染属于后续扩展（`.reference/OpenMAIC/render-service/README.md:119-134`）。

## 11. 模型、外部服务与部署负担

OpenMAIC 支持多家 LLM、TTS、ASR、图片、视频、PDF 和网络搜索服务，也能接本地模型（`.reference/OpenMAIC/.env.example:1-5`、`:8-207`）。模型解析顺序是“阶段路由 > 客户端模型 > 默认模型”，且没有静默的硬编码供应商兜底（`.reference/OpenMAIC/lib/server/resolve-model.ts:40-68`；`.reference/OpenMAIC/.env.example:221-260`）。

这使不同任务可用不同成本/能力的模型，但也意味着产品需要：

- 供应商故障降级；
- 每节课的生成、实时对话、TTS 和媒体成本预算；
- 延迟分级；
- 内容安全和数据驻留策略；
- 生成 HTML 依赖 CDN 时的离线与供应链策略。

它是一个“可配很多服务”的工程，而不是开箱即用、单模型即可稳定工作的教育 SaaS。

## 12. 测试与评测：工程行为覆盖广，学习效果证据缺失

仓库脚本覆盖 Vitest、Playwright，以及白板布局、编排、大纲语言和 PBL Planner 等评测（`.reference/OpenMAIC/package.json:19-27`）。例如：

- 白板评测会真实运行 Agent、截图，再由视觉模型按可读性、遮挡、渲染正确性、完整性和布局逻辑打分（`.reference/OpenMAIC/eval/whiteboard-layout/runner.ts:14-54`、`:94-139`、`:260-278`；`.reference/OpenMAIC/eval/whiteboard-layout/scorer.ts:17-59`）。
- PBL Planner 评测比较 Agent loop 与单次生成，并用多个质量维度评价可完成性和产物质量（`.reference/OpenMAIC/eval/pbl-v2-planner/runner.ts:1-34`、`:64-107`）。
- 编排评测关注 Director 是否过早结束对话（`.reference/OpenMAIC/eval/orchestration/runner.ts:106-187`）。

这些评测证明团队在测试“生成和演出是否像样”，但仓库内未发现以下证据：

- 学习增益或迁移效果；
- 延迟测验和长期记忆保持；
- 不同教学策略的 A/B 研究；
- 数学证明、科学事实或代码反馈的学科正确率基准；
- 儿童/青少年真实用户的可用性与安全研究。

所以它可以证明软件和 Agent 行为趋于稳定，不能证明学习效果优于普通视频、题库或真人课堂。

## 13. 扩展边界

仓库已经有相对清晰的可复用包边界：

- `@openmaic/dsl`：零依赖的课堂契约、JSON Schema、校验和迁移（`.reference/OpenMAIC/packages/@openmaic/dsl/README.md:1-21`、`:40-157`）。
- `@openmaic/renderer`：以 props 驱动的只读渲染和效果层（`.reference/OpenMAIC/packages/@openmaic/renderer/README.md:72-167`）。
- `@openmaic/importer`：将 PPTX 转为 OpenMAIC Slide，但仍有格式限制和运行时构建产物要求（`.reference/OpenMAIC/packages/@openmaic/importer/README.md:84-101`、`:209-258`）。
- `@openmaic/storage`：浏览器与服务端存储契约。

边界也不是完全收敛：

- DSL 原生拥有 slide 和 quiz，interactive 与 PBL 仍通过泛型由应用层扩展（`.reference/OpenMAIC/packages/@openmaic/dsl/src/stage.ts:124-173`；`.reference/OpenMAIC/packages/@openmaic/dsl/README.md:248-272`）。
- 新增一种场景类型通常需要同时修改类型/schema、生成提示、渲染路由、动作生成、导出和测试，并非安装一个插件即可。
- DSL 文档仍把 exporter 标成后续项（`.reference/OpenMAIC/packages/@openmaic/dsl/README.md:212-246`）。
- Renderer README 称编辑能力属于 v2 计划，但当前包 manifest 已导出 `./editing`，说明文档与实现状态存在漂移（`.reference/OpenMAIC/packages/@openmaic/renderer/README.md:206-213`；`.reference/OpenMAIC/packages/@openmaic/renderer/package.json:9-30`）。

如果基于它继续开发，应先定义自己的稳定领域接口，再选择性吸收包；不要直接把整个应用状态当平台 API。

## 14. 当前、条件启用与未发现能力

| 状态 | 能力 |
|---|---|
| **当前主路径** | 两段式生成、四类场景、动作 DSL、白板/TTS、多角色课堂、可打断播放、互动 iframe、测验、PBL v2、课堂包/PPTX 导出 |
| **条件启用** | 服务端 PostgreSQL 持久化、并行内容生成、MP4 渲染服务 |
| **实验** | Pi 服务端 Agent loop，默认关闭 |
| **已铺接口但未产品化** | 生产账号与多租户、跨设备身份合并、更多 PBL 角色、分布式视频渲染 |
| **本次源码研究未发现** | 跨课程长期 Learner Model、知识图谱与间隔复习、正式 LMS/学校管理、Manim/语义几何、真正 VS Code/容器式编程环境、学习成效研究 |

README 的功能表适合发现入口，但应以上述源码和配置中的主路径/feature flag 为准。例如 README 把很多能力并列展示，而 Pi runtime、服务端存储和 MP4 服务实际上具有不同成熟度。

## 15. 面向拟议教育产品的复用清单

### 建议优先复用

1. **Lesson Artifact + Action DSL**：作为可编辑、可回放、可导出的课堂中间表示。
2. **可打断 Playback State Machine**：让学生提问后自然返回原教学时间线。
3. **互动 iframe 的消息协议**：让教师 Agent 能指向、标注和改变互动组件状态。
4. **PBL 的微任务、提交、评价和 append-only 事件**：作为项目式学习的一次学习经历。
5. **生成管线的阶段化与可恢复性**：大纲审阅、逐场景生成、失败续跑。
6. **同一课堂制品支持在线与离线导出**的思路。

### 仅应借鉴思想，需重做产品底座

1. **长期学习档案**：另建跨课程 `Learner / KnowledgeComponent / Evidence / MasteryEstimate / Misconception / ReviewPlan / Artifact` 模型。
2. **编程环境**：另建持久工作区、语言服务和隔离执行服务；iframe 只做显示与控制。
3. **数学能力**：另建语义几何、求解/证明、课堂动作和 Manim 编译四层。
4. **身份与多用户**：使用生产级认证、租户、班级关系、未成年人授权和审计。
5. **教学决策层**：Director 选择的首先应是教学策略，不只是发言角色。
6. **评测体系**：把事实/学科正确性、学习增益、长期保持和安全性加入现有“表现质量”评测。

## 最终判断

OpenMAIC 已经很好地回答了：

> “AI 如何生成一节课，并把它像现场课堂一样演出来？”

它尚未回答：

> “系统如何在数月或数年里认识一个学习者，知道他真正掌握了什么，并持续选择最合适的下一次学习经历？”

因此，对一个“有趣、生动、沉浸且能长期积累”的产品，合适的组合不是直接在 OpenMAIC 上不断加功能，而是：

```text
长期学习操作系统（你的核心）
  ├─ Learner Model / Curriculum Graph / Evidence / Review
  ├─ 教学策略与下一步决策
  └─ Learning Experience Runtime
       ├─ OpenMAIC 式课堂编排
       ├─ 语义数学 + Manim 工具链
       ├─ Coding Workspace + 隔离执行
       └─ PBL / 游戏 / 仿真
```

OpenMAIC 最适合成为最下方的“课堂编排参考实现”。真正形成产品护城河的部分，将是上方的长期学习模型、教学决策，以及数学与编程两个学科运行时。
