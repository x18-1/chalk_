# DeepTutor 项目分析：从 Agent 平台到沉浸式教育产品

> 调研对象：`.reference/DeepTutor`
>
> 调研提交：`5e390ffc208f1b86c898304a061fc5921aa0d8a6`
>
> 调研方法：以该提交的源码、测试和仓库内文档为依据；结论优先服务产品决策，而非复述 README。文中“未发现”只表示在本次提交中未发现可运行实现。

## 一句话结论

DeepTutor 目前更准确的定位是一个**可自托管、Agent-native 的个人学习工作台**：它把通用对话、深度解题、出题、研究、可视化、Manim 视频、知识库、教材生成、长期记忆、掌握路径和外部聊天渠道放进同一产品壳中，而不是一个已经闭环验证的“沉浸式教学系统”。仓库自己的产品入口也同时暴露 Chat、Partners、My Agents、Co-Writer、Book、Knowledge Center、Learning Space、Memory 等多个工作面（`.reference/DeepTutor/README.md:438-440`）。

它最值得复用的不是某个单一 Tutor prompt，而是四类基础设施：

1. 统一的 capability/tool/context/stream 协议；
2. 可追踪、可人工修订的长期记忆工作台；
3. 把模型决策与确定性掌握门槛结合的 Mastery Path；
4. 将研究、题目、交互 HTML、动画、测验组合成学习材料的 Book 系统。

但如果目标是“有趣、生动、沉浸、长期成长”，必须正视三条关键事实：

- **Memory 与 Mastery 是两套分离的系统**：前者记“这个人和他的工作空间发生过什么”，后者记“某条学习路径上的知识点是否过关”；Book 还有第三套更轻量的阅读/答题进度。当前没有统一 learner model。
- **Manim 是服务端生成并渲染视频/图片，不是实时交互画布，更不是 manim-web**。它不能直接支持“老师讲一句、辅助线同步长出来、学生拖动后继续推理”的互动课堂。
- **代码执行离嵌入式 VSCode 还很远**：现状是一次性 Python/C/C++ 代码片段的编译运行工具；没有长生命周期项目、编辑器、终端、LSP、调试器、测试面板或协作状态。

因此，DeepTutor 适合作为**能力底座和架构参考**，不适合把现有导航和能力列表原样复制成新产品。

## 1. 它到底在做什么，为谁服务

DeepTutor 面向愿意自己配置模型、知识源和本地运行环境的个人学习者/研究型用户。它同时提供 Web、CLI、API/SDK 入口，强调自托管和本地数据，而非学校班级、教师备课、作业发布、家长反馈等机构教学流程（`.reference/DeepTutor/README.md:192-208`；`.reference/DeepTutor/README.md:647-705`）。

用户的核心体验不是一条固定课程，而是：

- 带着文件、知识库、历史会话和偏好进入一个 Agent 会话；
- 根据意图切换 Chat、Deep Solve、Question、Research、Visualize、Math Animator、Mastery Path；
- 把结果沉淀为 Notebook、Book、Knowledge Base、Question Bank 或 Memory；
- 通过 Learning Space 继续访问材料和对话；
- 通过 Partners 把相同的 Agent 运行时接到外部聊天渠道。

这使它更像“学习版 AI 工作台”，而不是“围绕一个明确教学法设计的课程产品”。对能力强、知道自己要学什么的成人或大学生，它的自由度是优势；对初高中学生，这种多入口、多配置、多工具的开放结构会增加选择负担，也缺少教师预先设计的节奏和护栏。

## 2. Agent-native 架构：统一的是协议，不是所有教学流程

### 2.1 运行时主干

CLI、WebSocket 和 SDK 最终都进入 `ChatOrchestrator`。它为每轮创建统一上下文和 `StreamBus`，按 `active_capability` 选择能力，异步执行并发送 session、result、error、done 等事件（`.reference/DeepTutor/deeptutor/runtime/orchestrator.py:1-7`；`.reference/DeepTutor/deeptutor/runtime/orchestrator.py:26-94`）。

`UnifiedContext` 把消息历史、知识库、附件、记忆、persona、skills、source metadata 和工具权限装进同一请求对象；Partner 还可以通过 `allowed_builtin_tools` 收窄工具面（`.reference/DeepTutor/deeptutor/core/context.py:33-84`）。前端消费的流不是纯文本 token，而是一组显式事件：stage、thinking、observation、content、tool call/result、progress、sources、result、error、wait_input、done 等（`.reference/DeepTutor/deeptutor/core/stream.py:17-72`）。`StreamBus` 还支持每轮历史回放、多个订阅者、阶段上下文以及等待用户输入（`.reference/DeepTutor/deeptutor/core/stream_bus.py:31-104`；`.reference/DeepTutor/deeptutor/core/stream_bus.py:262-325`）。

这是值得复用的关键：前端可以把“正在查资料”“正在构造图形”“等待回答”“正在评分”表现成不同教学状态，而不必从模型文本中猜。

工具接口包含结构化定义、执行结果、来源、metadata、成功/失败、暂停和终止语义；还支持 deferred tool，实现按需披露工具，避免一次把所有 schema 塞进模型上下文（`.reference/DeepTutor/deeptutor/core/tool_protocol.py:47-94`；`.reference/DeepTutor/deeptutor/core/tool_protocol.py:121-205`）。Capability 则有独立 manifest 和统一 `run(context, bus)` 边界（`.reference/DeepTutor/deeptutor/core/capability_protocol.py:20-59`）。

### 2.2 Tool composition 与 Agent loop

工具面不是静态全开。共享组合策略会根据附件、KB、记忆、Notebook、Skill、执行权限和 capability 自动挂载 RAG、read_source、read_memory、code_execution、load_tools 等，再加入 write_memory、web_fetch、ask_user、cron 等常驻工具；Partner 可以用白名单进一步限制（`.reference/DeepTutor/deeptutor/agents/_shared/tool_composition.py:46-56`；`.reference/DeepTutor/deeptutor/agents/_shared/tool_composition.py:95-184`）。

通用 Chat 采用一个持续增长的对话循环：模型无工具调用即结束，有工具调用则执行后继续；`ask_user` 可暂停并恢复；轮次耗尽时强制生成最终回答（`.reference/DeepTutor/deeptutor/agents/chat/agent_loop.py:1-22`；`.reference/DeepTutor/deeptutor/agents/chat/agent_loop.py:227-350`）。默认最多 8 轮（`.reference/DeepTutor/deeptutor/agents/chat/agentic_pipeline.py:94-99`）。

需要避免一个误读：**所有模式共享 runtime/protocol，不代表所有模式共享同一个控制循环**。Chat、当前 Deep Solve、Mastery Path 复用 `AgenticChatPipeline`；Deep Research、Question、Visualize、Math Animator 都有自己的编排管线。对新产品而言，统一事件和工具协议应保留，但不同教学任务仍应拥有不同的确定性流程。

### 2.3 扩展边界

内建 capability 为 chat、deep_solve、deep_question、deep_research、math_animator、visualize、mastery_path（`.reference/DeepTutor/deeptutor/runtime/bootstrap/builtin_capabilities.py:1-11`）。工具和能力通过 registry 注册，capability registry 也预留了动态 import/plugin loader（`.reference/DeepTutor/deeptutor/runtime/registry/capability_registry.py:21-78`）。但本次提交中未发现仓库内的通用 `deeptutor/plugins/` 实现，因此应把它理解成**扩展接缝已存在**，而不是成熟的第三方插件生态。

## 3. 七种核心能力分别成熟到什么程度

### 3.1 Chat：最成熟的通用入口

Chat 会根据上下文自动组装知识、附件、记忆、代码、外部搜索和用户询问工具，是其他能力复用最多的基础。它适合开放问答和工具调用，但教学行为主要由 prompt 与模型自行决定，没有默认的“先诊断—讲解—让学生尝试—反馈—迁移练习—复习”硬流程。

### 3.2 Deep Solve：有确定性解题骨架，但不是可视化教学导演

当前 Solve 不再是独立多阶段 pipeline，而是在通用聊天循环中强制挂入三个工具：`solve_plan`、`solve_finish_step`、`solve_replan`。计划最多 12 步，replan 默认最多 2 次；每完成一步会把工具噪声折叠成 checkpoint，全部完成后才进入最终回答（`.reference/DeepTutor/deeptutor/capabilities/solve/session.py:1-14`；`.reference/DeepTutor/deeptutor/capabilities/solve/session.py:18-66`；`.reference/DeepTutor/deeptutor/capabilities/solve/tools.py:21-27`）。

优点是模型不能完全无结构地“想完就答”；不足是硬门槛只保证“调用了完成步骤”，不验证每一步数学上正确，也没有把某一步与动态画布操作、学生回答或错误诊断绑定。

### 3.3 Deep Research：最像生产级工作流

Research 将任务拆成 rephrase、可多轮 ask_user、outline preview/confirm、动态 research blocks、report outline、intro/sections/conclusion；证据工具限定为 RAG、Web、Paper、Code，并维护 citation/sources 语义（`.reference/DeepTutor/deeptutor/agents/research/pipeline.py:1-30`；`.reference/DeepTutor/deeptutor/agents/research/pipeline.py:94-102`）。它很适合大学知识调研和长文学习，但输出仍以“报告”为中心，不自动转化为课程、诊断题和复习安排。

### 3.4 Question：覆盖跟进题、自定义题和仿题

Question 支持 follow-up、custom、mimic 三种入口；custom 管线经历 explore、plan、逐题 generation、repair，并覆盖选择、概念、填空、简答、书面推导、编程等题型（`.reference/DeepTutor/deeptutor/agents/question/capability.py:1-9`；`.reference/DeepTutor/deeptutor/agents/question/pipeline.py:1-23`；`.reference/DeepTutor/deeptutor/agents/question/pipeline.py:144-154`）。它是内容生产能力，不等同于题目质量评测系统；本次调研未发现基于真实学生作答数据的难度校准或题目区分度模型。

### 3.5 Visualize 与 GeoGebra：有结果可视化，缺少“过程可操作”

Visualize 可生成 SVG、Chart.js、Mermaid、HTML，并能路由到 Manim video/image。普通渲染有本地确定性校验和一次针对性 repair；HTML 无效时会 fallback，但某些类型 repair 仍失败时可能返回未验证草稿（`.reference/DeepTutor/deeptutor/agents/visualize/capability.py:1-9`；`.reference/DeepTutor/deeptutor/agents/visualize/capability.py:63-126`；`.reference/DeepTutor/deeptutor/agents/visualize/capability.py:128-247`）。

GeoGebra 已经不是“coming soon”。工具接收题目文字和**必须存在的图片附件**，做一次视觉理解，输出 GeoGebra commands 和关系摘要（`.reference/DeepTutor/deeptutor/tools/builtin/__init__.py:460-530`）。前端加载 GeoGebra Web applet 并依次执行 commands，且隐藏 toolbar、input 和 menu（`.reference/DeepTutor/web/components/Geogebra.tsx:25-77`；`.reference/DeepTutor/web/components/Geogebra.tsx:118-148`）。

这意味着现状是“从题图重建一个结果图”，不是：

- 从纯文字几何题可靠建图；
- 保存每条辅助线的语义和前置条件；
- 随讲解逐帧执行 construction actions；
- 让学生拖点后重新计算推理；
- 把学生操作作为教学 Agent 的观察输入。

如果产品亮点是“边作辅助线边讲题”，需要新增独立的 **Geometry Lesson Runtime**，不能只包装现有 GeoGebra tool。

### 3.6 Math Animator：批量生成 Manim 媒体，不是实时教学画布

Math Animator 的实际流程是：LLM 分析概念、设计 storyboard、生成 Manim Python、调用本机 Manim 渲染、失败后最多多轮修复，最后返回视频/图片 artifact（`.reference/DeepTutor/deeptutor/agents/math_animator/capability.py:19-39`；`.reference/DeepTutor/deeptutor/agents/math_animator/capability.py:80-226`）。

三个重要产品/工程判断：

1. **它是服务端批渲染**。Renderer 为每轮写入 `.py` 文件，然后用 `python -m manim` 启动 subprocess，产出 MP4/图片 URL（`.reference/DeepTutor/deeptutor/agents/math_animator/renderer.py:35-122`；`.reference/DeepTutor/deeptutor/agents/math_animator/renderer.py:155-201`）。没有浏览器端 manim-web 场景状态，也没有低延迟指令流。
2. **默认不做语义视觉复核**。Pipeline 的 `enable_visual_review` 默认 `False`，而 capability 构造时没有打开它（`.reference/DeepTutor/deeptutor/agents/math_animator/pipeline.py:25-71`；`.reference/DeepTutor/deeptutor/agents/math_animator/capability.py:41-64`）。因此“能渲染”不保证图形内容和讲解语义正确。
3. **执行边界需要重做**。生成的 Python 直接交给 Manim subprocess；在这条 renderer 路径上未发现与 `code_execution` 相同的 sidecar/bwrap 隔离、资源配额或明确的进程超时。这是部署给陌生用户前的高优先级安全风险。

适合复用的是 storyboard/code/repair/artifact 流程；不适合拿它直接承担实时沉浸式课堂。

### 3.7 Mastery Path：最有教育产品价值的雏形

Mastery 复用聊天 Agent 做教学决策，但把知识点推进交给纯 Python policy。其数据模型包含模块、知识点、诊断、测验尝试、错误类型、复习状态、pending question、重试次数和版本（`.reference/DeepTutor/deeptutor/learning/models.py:24-45`；`.reference/DeepTutor/deeptutor/learning/models.py:80-118`；`.reference/DeepTutor/deeptutor/learning/models.py:164-213`）。

门槛区分两类知识：

- MEMORY / PROCEDURE 使用最近 5 次的加权正确率，1 次正确最高 0.5、2 次最高 0.8，通常需达到 0.9；
- CONCEPT / DESIGN 使用布尔型 qualitative check，由 Tutor 根据 Feynman 式解释判断是否真正理解。

对应规则是确定性的（`.reference/DeepTutor/deeptutor/learning/mastery.py:1-37`；`.reference/DeepTutor/deeptutor/learning/policy.py:31-68`）。下一步策略优先未完成问题，再做到期复习，再进入第一个未掌握目标，最后完成路径（`.reference/DeepTutor/deeptutor/learning/policy.py:158-233`）。Scheduler 为不同知识类型设定复习间隔，并让错误优先进入队列（`.reference/DeepTutor/deeptutor/learning/scheduler.py:13-25`；`.reference/DeepTutor/deeptutor/learning/scheduler.py:72-98`）。

它的价值在于：**LLM 负责表达与判断，确定性引擎负责是否允许推进**。但目前仍只是雏形：

- 定量掌握度是手工启发式，不是经过学习数据校准的模型；
- qualitative gate 仍依赖 LLM 判断，缺少可靠性评估；
- 没有先修关系图、课程标准映射、题目难度模型或跨课程能力画像；
- 路径状态以独立 JSON 保存，并未与 Memory、Book progress 合并。

## 4. 长期积累：Memory、Mastery、Learning Space 不是一回事

这是做长期教育产品时最需要理清的边界。

| 系统 | 记录什么 | 写入/更新方式 | 用于什么 | 当前不足 |
|---|---|---|---|---|
| Memory | 用户偏好、最近活动、不同工作面的事实和引用 | L1 trace/工作区快照；L2/L3 由 Memory Workbench consolidation；偏好可显式写入 | 个性化上下文、可审计的人物/任务记忆 | 不是知识掌握度；并非每轮自动完成长期整合 |
| Mastery Path | 某条路径中每个知识点的作答、错误、复习和过关状态 | Mastery 工具和 API 写独立 JSON | 决定下一题、复习或推进 | 只在该路径内；没有统一学生画像 |
| Book Progress | 当前页、访问/书签、quiz attempts、weak chapters、score | Book 阅读和答题事件 | 恢复教材阅读状态 | 很轻量，与 Mastery 没有同一门槛模型 |
| Learning Space | 会话、材料、persona、skill 等的产品容器/入口 | 聚合既有工作区资产 | 回到学习上下文 | 更像空间/导航，不是统一 learner model |

### 4.1 Memory 的真实机制

Memory 分三层并按用户隔离：L1 trace、按 chat/notebook/quiz/kb/book/partner/cowriter surface 划分的 L2、以及 recent/profile/scope/preferences 等 L3 slot（`.reference/DeepTutor/deeptutor/services/memory/paths.py:1-12`；`.reference/DeepTutor/deeptutor/services/memory/paths.py:47-103`）。

它的设计优点是可审计：记忆文档是带稳定 entry ID 和来源 footnote 的 Markdown，支持 preview/apply、覆盖、删除、去重、合并；自动整合不会改写 preferences（`.reference/DeepTutor/deeptutor/services/memory/document.py:1-33`；`.reference/DeepTutor/deeptutor/services/memory/store.py:104-192`）。L1 也不只是聊天记录，而是通过只读 adapter 汇总 Notebook、Co-Writer、Book、Partner、KB、Chat、Quiz 等工作面（`.reference/DeepTutor/deeptutor/services/memory/snapshot/adapters.py:64-216`；`.reference/DeepTutor/deeptutor/services/memory/snapshot/adapters.py:295-527`）。

但“长期记忆”不等于“后台每轮自动形成用户画像”。源码明确说明 `write_memory` 只用于聊天中的显式偏好写入，其他 surface 文档在 Memory Workbench 中手动更新（`.reference/DeepTutor/deeptutor/tools/builtin/__init__.py:663-669`）。Turn runtime 会将用户选择的 memory refs 注入上下文（`.reference/DeepTutor/deeptutor/services/session/turn_runtime.py:1363-1365`；`.reference/DeepTutor/deeptutor/services/session/turn_runtime.py:1616-1645`）。因此它偏向“用户可控、可回溯的记忆管理”，而不是透明、持续、自动的个性化引擎。

### 4.2 Mastery 是学习状态机，不是人物记忆

Mastery 的 `LearningProgress` 独立保存到 workspace 下按 path/book 分隔的 JSON，并使用原子写和版本号（`.reference/DeepTutor/deeptutor/learning/storage.py:16-52`）。它记录知识点证据并通过 hard gate 决定下一步，不应该塞入自由文本 Memory。

正确的产品方向不是把两者强行合表，而是建立一个上层 **Learner Model API**：

- Identity/Profile：长期偏好、动机、语言、无障碍需求；
- Competency Graph：课程标准、知识点、先修边、掌握证据；
- Learning Episodes：每次会话中看过、做过、错过、求助过什么；
- Artifact Graph：Notebook、Book、代码项目、图形、视频、题目；
- Scheduler：综合遗忘、错误、目标和可用时间选下一活动。

Memory 可以继续承担可读总结，Mastery 继续承担确定性过关，但二者都应投影到同一个 learner identity 和 evidence ledger。

## 5. Book、Knowledge Base 与 Partners 在产品中的位置

### 5.1 Book：最接近“沉浸式课程容器”

Book 不是普通 capability，而是一套与 ChatOrchestrator 平行的长任务引擎：先生成 proposal 并确认，再生成 spine 并确认，然后按页面后台编译；打开的页面可获得更高队列优先级（`.reference/DeepTutor/deeptutor/book/engine.py:1-29`；`.reference/DeepTutor/deeptutor/book/engine.py:200-340`；`.reference/DeepTutor/deeptutor/book/engine.py:771-910`）。

页面拥有丰富 typed blocks：text、callout、quiz、user note、figure、interactive HTML、animation、code、timeline、flashcards、deep dive、concept graph 等（`.reference/DeepTutor/deeptutor/book/models.py:55-90`）。Interactive block 生成自包含 HTML，经过确定性验证后在隔离 iframe 中展示（`.reference/DeepTutor/deeptutor/book/blocks/interactive.py:1-11`；`.reference/DeepTutor/deeptutor/book/blocks/interactive.py:25-97`）；Animation block 可以调用 Manim 产出媒体（`.reference/DeepTutor/deeptutor/book/blocks/animation.py:1-10`）。

这是新产品最值得借鉴的“课程页面组件系统”。但当前 block 是离散内容块，还没有统一 lesson timeline 去同步：

`讲解语句 → 画布动作 → 学生操作 → 检查点 → 反馈 → 掌握证据`

另外，Code block 源码明确标注目前是静态代码和解释，runnable playground 留待以后接入（`.reference/DeepTutor/deeptutor/book/blocks/code.py:1-7`；`.reference/DeepTutor/deeptutor/book/blocks/code.py:21-65`）。

### 5.2 Knowledge Base：可靠 grounding，不是课程图谱

知识系统区分 indexed KB、Obsidian、外链、subagent 和 LightRAG server，RAG factory 支持 LlamaIndex、PageIndex、GraphRAG、LightRAG 等不同 provider，并按 KB 绑定和缓存（`.reference/DeepTutor/deeptutor/knowledge/kb_types.py:1-38`；`.reference/DeepTutor/deeptutor/services/rag/factory.py:1-20`；`.reference/DeepTutor/deeptutor/services/rag/factory.py:114-248`）。

它解决“回答依据哪些资料”和“如何检索”，不解决“知识点之间如何组织”“学生掌握到哪”“该出哪道题”。新产品应保留 KB 作为证据层，另建 curriculum/competency graph。

### 5.3 Partners：跨渠道人格，不是多角色课堂

Partner 没有独立推理引擎；每条外部消息仍进入 ChatOrchestrator/AgenticChatPipeline，只是加入 soul、skills、KB、tools 和 partner identity，并映射到外部 IM session（`.reference/DeepTutor/deeptutor/services/partners/runtime.py:1-18`；`.reference/DeepTutor/deeptutor/services/partners/runtime.py:364-448`）。Partner workspace 会复制 KB、skill、notebook 和 SOUL，渠道 registry 支持 entry point 扩展（`.reference/DeepTutor/deeptutor/services/partners/workspace.py:119-175`；`.reference/DeepTutor/deeptutor/partners/channels/registry.py:17-84`）。

所以它擅长“让一个 Tutor 出现在 Telegram/飞书等渠道并保持人格”，但不是 OpenMAIC 式的多角色课堂导演：未发现教师、助教、同伴、反方等多个角色共享场景状态并轮流介入的编排器。

## 6. 编程学习能力：从一次性执行到在线 IDE 的差距

`code_execution` 目前只接受 Python、C、C++，每次运行写临时源文件，必要时编译，执行后返回 stdout/stderr 和 artifacts（`.reference/DeepTutor/deeptutor/tools/builtin/__init__.py:166-185`；`.reference/DeepTutor/deeptutor/tools/builtin/__init__.py:194-318`）。

Sandbox service 可选择 runner sidecar、bubblewrap 或 restricted subprocess。前两者提供更强系统隔离；restricted subprocess 明确只有应用层限制、没有 OS isolation（`.reference/DeepTutor/deeptutor/services/sandbox/backends.py:1-14`；`.reference/DeepTutor/deeptutor/services/sandbox/backends.py:47-188`）。Quota 还是单进程内实现，多副本部署需共享存储（`.reference/DeepTutor/deeptutor/services/sandbox/quota.py:1-13`）。

与“嵌入 VSCode 学编程”的差距至少包括：

- 持久项目与多文件目录，而非单次 snippet；
- Monaco/VSCode 编辑器、文件树和终端；
- Language Server 的补全、诊断、跳转、重构；
- debugger、断点、变量观察；
- 测试发现、运行和可视化反馈；
- per-user container 生命周期、网络/文件权限和资源配额；
- Tutor 对编辑器 selection、cursor、diff、terminal、test result 的结构化观察；
- checkpoint/branch，让学生能回到某次尝试；
- 初学者模式的 scaffold、hint ladder 和“不要直接替学生写完”的教学策略。

因此可以复用 DeepTutor 的工具协议、artifact 回传和 sandbox facade，但应把在线 IDE 作为独立学习运行时建设，而不是扩写 `code_execution` 参数。

## 7. 前后端、持久化与多用户成熟度

后端是 FastAPI，前端是 Next.js/React；API 汇集 chat/session/book/memory/mastery/partners/skills/tools/voice 等 router，并有统一 WebSocket 入口（`.reference/DeepTutor/deeptutor/api/main.py:342-442`）。Session store 默认在配置 PocketBase 时使用 PocketBase，否则使用本地 SQLite（`.reference/DeepTutor/deeptutor/services/session/__init__.py:33-47`）。

多用户路径明确区分 system、admin、isolated users 和 partners，并有用户 scope/context 服务（`.reference/DeepTutor/deeptutor/multi_user/paths.py:1-14`；`.reference/DeepTutor/deeptutor/multi_user/paths.py:85-162`）。Grant 模型覆盖 model、KB、skills、partners、tools、MCP 和 exec 权限，并拒绝把 secrets/path 混入 grant（`.reference/DeepTutor/deeptutor/multi_user/grants.py:16-40`；`.reference/DeepTutor/deeptutor/multi_user/grants.py:107-125`）。

SQLite 消息支持 parent message 和 branch-aware context；PocketBase 后端则明确尚未接入 `parent_message_id`，也不支持 leaf branch context，退回线性消息视图（`.reference/DeepTutor/deeptutor/services/session/pocketbase_store.py:330-346`；`.reference/DeepTutor/deeptutor/services/session/pocketbase_store.py:427-445`）。这说明“同一界面可用”不代表后端语义完全等价。

就个人/小团队自托管而言，持久化覆盖面已经较广；就学校级产品而言，本次提交未发现班级、课程发布、教师管理台、作业流、家长角色、学情报表、未成年人合规与租户级数据治理的完整领域模型。

此外，当前多用户实现还有不宜直接带入生产环境的边界：

- Memory consolidation 的进程内 run 没有 `user_id/scope`，manager 是全局实例，活跃任务只按 `(layer, key)` 去重；memory 的 list/get/events/cancel/undo API 也未见 owner 校验。Checkpoint 保存绝对目标路径，undo 会直接写回或删除目标文件。这意味着在认证多用户部署中，存在用户互相看到、取消或回滚 memory run 的风险，应列为 P0 修复（`.reference/DeepTutor/deeptutor/services/memory/consolidator/runs.py:67-84`；`.reference/DeepTutor/deeptutor/services/memory/consolidator/runs.py:117-152`；`.reference/DeepTutor/deeptutor/services/memory/consolidator/runs.py:204-234`；`.reference/DeepTutor/deeptutor/api/routers/memory.py:353-428`）。
- `PathService` 在多用户路径解析异常时会回退默认/admin path；认证模式更安全的策略应是 fail closed，而不是静默回退（`.reference/DeepTutor/deeptutor/services/path_service.py:424-436`；`.reference/DeepTutor/deeptutor/api/routers/auth.py:213-228`）。
- Identity JSON 的锁只在单进程有效；LearningStore 虽使用原子 JSON 写和版本自增，但没有比较磁盘版本，跨 worker 不是真正 CAS（`.reference/DeepTutor/deeptutor/multi_user/identity.py:19-24`；`.reference/DeepTutor/deeptutor/learning/storage.py:12-32`）。

## 8. 测试与评估：工程正确性多，学习效果证据少

静态盘点得到 289 个 Python test 文件、约 2680 个 `test_*` 函数，前端有 34 个 `.test.ts` 文件、约 221 个 Node tests，并有 1 个 Playwright audit。CI 会运行 Node tests、Python 3.11–3.13（3.14 为 experimental）以及 `pytest -q tests deeptutor/learning/tests`，但没有 coverage threshold（`.reference/DeepTutor/.github/workflows/tests.yml:56-180`；`.reference/DeepTutor/pyproject.toml:413-428`）。测试广泛覆盖协议、registry、stream、agent loop、memory、learning policy、Book、sandbox、session 和 API，说明工程契约意识较强。

测试数量不能直接当作真实集成质量。RAG live integration 需显式设置 `RAG_INTEGRATION_TESTS=1`，默认 CI 不会运行；Question 流程使用 mocked LLM；Manim retry 使用 fake renderer（`.reference/DeepTutor/tests/services/rag/test_pipeline_integration.py:403-420`；`.reference/DeepTutor/tests/agents/question/test_pipeline.py:1-6`；`.reference/DeepTutor/tests/agents/math_animator/test_retry_manager.py:12-20`）。PocketBase 隔离测试也使用内存 fake，而 README 明确保留 PocketBase single-user integration 警告（`.reference/DeepTutor/tests/services/session/test_pocketbase_isolation.py:1-8`；`.reference/DeepTutor/README.md:641`）。

但本次源码调研未发现以下产品级评估闭环：

- 同一学生前测/后测的学习增益；
- 提示质量、过度帮助率和学生独立完成率；
- 数学答案/证明/几何构造的权威判分基准；
- Manim/GeoGebra 输出的语义正确率；
- 题目难度、区分度、重复率和课程标准覆盖率；
- 长期复习策略相对基线的保留率；
- 儿童安全、偏见、幻觉和越级内容的系统 eval；
- 成本、首 token、完整课时和视频渲染延迟的 SLO。

所以“工程回归测试广”不能外推成“真实 provider 互操作可靠”，更不能外推成“教学有效”。新产品应把真实 LLM/RAG/Manim/多用户 smoke test 和 learning eval 作为核心基础设施，与 Agent runtime 同期建设。

## 9. 可复用、需要重构、不要照搬

### 直接复用或强参考

- `UnifiedContext + StreamBus + structured events`；
- Capability/Tool protocol、tool composition、ask_user pause/resume；
- Solve 的 plan/step/replan 硬骨架；
- Mastery 的“模型教学 + 确定性过关”分层；
- Memory 的可审计引用、preview/apply 和用户控制；
- Book 的 typed block、后台编译和 source snapshot；
- RAG provider abstraction；
- Sandbox facade、artifact 回传、多用户 scope/grant。

### 需要抽象后复用

- 将 Memory、Mastery、Book progress 统一接入 learner evidence ledger；
- 将 Book block 升级为可编排 Lesson Scene；
- 将 GeoGebra commands 升级为有语义、有时间轴、可回放的 construction action；
- 将 Manim 作为课后总结/预生成素材，而非课堂实时主引擎；
- 将 Question 生成接到 calibrated item bank 和 mastery evidence；
- 将 Partner 人格/渠道能力改造成多角色课堂 actor，但共享统一 lesson state。

### 不建议照搬

- 按能力堆叠大量一级入口的导航；
- 把所有教学行为交给通用 chat prompt；
- 把“能生成视频”宣传成“实时交互教学”；
- 把一次性 code tool 包装成“在线编程环境”；
- 用手工掌握阈值替代学习效果验证；
- 在未隔离的环境中直接运行模型生成的 Manim Python；
- 继续维持多个互不相通的学习进度模型。

## 10. 面向“有趣、生动、沉浸、长期”的建议路线

### P0：先做一个纵向闭环，不做全学段全学科

建议只选一个最能体现差异化的场景，例如“初中几何一题一课”：

1. 诊断学生已有概念；
2. Tutor 用可操作图形提出观察任务；
3. 学生拖动、作辅助线或回答一步；
4. Agent 读取结构化画布状态；
5. 给分层提示，而非直接展示答案；
6. 形成证明并生成短 Manim 回顾视频；
7. 写入知识点证据和错误类型；
8. 安排迁移题与间隔复习。

这个闭环比同时覆盖初高中大学、数学、编程、研究更能验证产品价值。

### P1：建立真正的 Lesson Runtime

定义一等公民状态：

```text
Lesson
  ├─ LearningObjective
  ├─ SceneState
  ├─ TutorUtterance
  ├─ CanvasAction
  ├─ LearnerAction
  ├─ Checkpoint/Judge
  ├─ HintLevel
  └─ EvidenceEvent
```

每一步通过同一事件流同步文字/语音、GeoGebra 或 WebGL 画布、测验和 mastery 证据。DeepTutor 的 StreamBus 可以做传输基础，但上面需要新增教学语义，不能只发送通用 `content` 和 `tool_result`。

### P2：统一长期学习模型

保留 Memory 的可解释性和 Mastery 的确定性，新增：

- curriculum/competency graph；
- immutable evidence events；
- learner profile 与可撤销推断；
- lesson/session/artifact 的统一 ID；
- review scheduler；
- 教师/学生可读的“为什么系统认为我会/不会”。

### P3：把媒体分为实时层与离线层

- 实时层：GeoGebra/manim-web/WebGL/SVG actions，要求低延迟、可逆、可读状态；
- 离线层：服务端 Manim 视频、章节总结、分享导出；
- 二者共享同一个 scene/storyboard schema，避免视频和课堂逻辑各自生成。

### P4：独立建设 Coding Workspace

以 per-user container + Monaco + terminal + LSP + tests 为核心，Agent 只通过受限 observation/action API 参与。Tutor 应优先指出位置、提出问题和给最小提示；代码执行结果自动写入 mastery evidence，而不是只把 stdout 回给聊天窗口。

### P5：用评估决定扩学科，而不是用 feature list 决定

第一批必须跟踪：

- 学生独立完成率与提示层级；
- 前后测增益、7/30 天保留率；
- 单题有效学习时长和退出点；
- 几何构造/证明正确率；
- Agent 直接泄露答案率；
- 首次互动延迟、每课成本、视频生成成功率；
- 学生对“有趣”和“可控”的主观评分。

达到门槛后再将 Lesson Runtime 扩到代数、物理、编程，而不是先做所有入口。

## 最终判断

DeepTutor 已经回答了“怎样把许多 Agent 能力装进一个可运行、可扩展、可持久化的学习工作台”，但尚未完整回答“怎样让一个学生长期、沉浸、可证明地学会某个知识点”。

对于拟议产品，最优策略是：

- 用它的 Agent runtime、事件协议、Book blocks、Memory 可审计机制、Mastery 硬门槛和 sandbox abstraction 做参考；
- 把产品中心从“能力菜单”改为“连续 lesson”；
- 把 GeoGebra/manim-web/IDE 视为拥有持久状态和教学事件的学习环境，而不是聊天工具；
- 建立统一 learner model 与 evidence ledger；
- 先用一个强纵向场景证明学习效果，再扩展到全学段全学科。

这会比复制 DeepTutor 的宽能力面更接近“有趣、生动、沉浸且会记住学生成长”的教育产品。
