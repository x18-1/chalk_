# OpenMAIC v1.0.0 与本地参考快照的功能差异

> 研究日期：2026-08-28
> 对比基线：`.reference/OpenMAIC` 的 [`HEAD=1466a55e`](https://github.com/THU-MAIC/OpenMAIC/tree/1466a55eef9e31e229a0e2e60a0811020d7b06e2)（`package.json` 版本 `0.3.1`；该提交位于 `v0.3.1` 发布后，尚未包含 `v0.3.2`）
> 目标版本：官方 Git tag [`v1.0.0`](https://github.com/THU-MAIC/OpenMAIC/releases/tag/v1.0.0)，发布提交 `aa2bfb3c1d406c47100c6744d90e788abdf1f6d5`，2026-08-27

## 结论

v1.0.0 的核心变化不是增加一种场景，而是把 OpenMAIC 从“输入主题、生成课堂并播放”升级为“由 Agent 持续规划、构建、修改课程”的 Pro 工作台。最大增量包括：聊天式 Agent Workbench、可恢复的服务端 Agent 会话、工具与技能系统、材料/资产管线，以及面向生产部署的持久化和 provider-neutral 服务端能力。官方 README 将这四项概括为 workbench、durable sessions、session materials、course tools + 20 skills（[`README.md` v1.0.0](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/README.md#-openmaic-v100--build-courses-with-an-agent)）。

## 先说明中间版本：严格比较本地快照时还缺少 v0.3.2

本地快照的 `HEAD` 是 2026-07-26 的 `1466a55e`，而 `v0.3.2` 已于 2026-08-14 发布；因此从该快照到 v1.0.0，除了 1.0.0 条目，还应计入完整的 0.3.2 发布内容。0.3.2 的官方变更记录见 [`CHANGELOG.md` §0.3.2](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/CHANGELOG.md#032---2026-08-14)。

### v0.3.2（本地快照 → 0.3.2）

- 视频导出强化：确定性的 Quiz/PBL 封面、公式/字幕/聚光灯保真度、交互 HTML 自包含捕获、渲染资源配置和并行捕获。
- 服务端持久化完成：quiz 与 playback 学习数据、stage/scene/outline 文档、KV 设置迁移到 RuntimeStore/DocumentStore；提供 Postgres 后端、HTTP 契约、一键 Compose 栈、增量保存和白板 RuntimeStore。
- 资产体系升级：Asset Registry、统一媒体引用、服务端可插拔字节层；生成/导入资源有稳定 ID，支持导出清单。
- 抽出 `@openmaic/generation` 包并把交互/PBL 类型提升到 `@openmaic/dsl` SDK；新增课程文件夹、FunASR、本地/云端 provider（Claude Search、Amazon Bedrock、Atlas Cloud）及法语、西语、越南语等 locale。

以上项目均列于 0.3.2 的 Features 条目（同一 [`CHANGELOG.md` §0.3.2](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/CHANGELOG.md#032---2026-08-14)），不是 v1.0.0 才首次出现的功能。

## v1.0.0 新增能力（相对 0.3.2/本地快照）

### 1. Agent Workbench：从生成器变成课程构建工作区

主页 Pro 入口新增可折叠的文件夹/会话侧栏、聊天面板和多标签 classroom 面板。Agent 可以规划多课时课程、创建/移动课程和文件夹，并在对话中持续生成和修改页面；这是一个独立于原“一键生成”流程的 chat-first 工作台（[`README.md` Agent Workbench](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/README.md#agent-workbench-and-pro-mode-v100)；[`CHANGELOG.md` §1.0.0](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/CHANGELOG.md#100---2026-08-27)）。

### 2. Durable Agent Runtime：可恢复、可操控、可回放

课程构建会话改为数据库支持的后台运行：worker 重启后可恢复，运行中接受 follow-up steering，支持取消/状态查询，并通过 owner/session event stream 向前端提供可重放的事件历史。会话生命周期、租约、心跳和崩溃恢复都成为显式服务端契约（[`README.md` Agent Workbench](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/README.md#agent-workbench-and-pro-mode-v100)；[`CHANGELOG.md` §1.0.0 Durable agent runtime](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/CHANGELOG.md#100---2026-08-27)）。

### 3. 工具（Tools）与技能（Skills）

Agent 不再直接改写整份课程 blob，而是调用经过校验的工具：读取/搜索/原子 patch Stage DSL，生成、复制、插入、删除、重排页面，编辑旁白；读取和搜索材料、抓取受信任 URL；生成图片/视频/旁白；导入 PPTX；管理课堂角色 roster 和声音。v1.0.0 同时提供 20 个内置教学/研究/课程制作技能，并支持按 owner 保存、上传、删除和修改用户技能（[`README.md` 工具能力表](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/README.md#agent-workbench-and-pro-mode-v100)；[`CHANGELOG.md` §1.0.0 Agent tools and skills](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/CHANGELOG.md#100---2026-08-27)）。

### 4. 材料与资产字节模型

上传的文档、音频和视频先进入资产池，再由可追踪的 extraction lifecycle 生成派生文本/图片；支持提取缓存、lineage、材料全文检索（RAG 基础）、受信任网页抓取，以及可选本地 ffmpeg/ffprobe 媒体提取。生成媒体、导入媒体和导出资源统一使用 manifest/字节解析器，避免 base64 或旧 asset 引用在导出时丢失（[`CHANGELOG.md` §1.0.0 Materials and the asset byte model](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/CHANGELOG.md#100---2026-08-27)）。

### 5. 生产级服务端边界与多租户基础

新增 owner-scoped folder/stage/material 路由、每场景单调 revision、URL trust gate、按 owner 的配额预留和崩溃上传回收。模型、图片、视频、ASR/TTS、搜索 provider 由服务端解析，统一支持 capability force-off 和启动配置校验；凭据不下发浏览器，未解析的模型路由会显式失败而不会猜测供应商（[`README.md` Agent Workbench](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/README.md#agent-workbench-and-pro-mode-v100)；[`CHANGELOG.md` Provider-neutral / Pluggable persistence](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/CHANGELOG.md#100---2026-08-27)）。

### 6. 其他面向用户的新增项

- Qwen TTS 声音克隆；
- 导出 Markdown/DOCX 旁白讲稿；
- Pi Native Child 运行时及白板工具、web search；
- 有界的本地视频导出执行器；
- 德语 locale；
- OpenClaw skill 二次开发流程。

这些条目在 [`CHANGELOG.md` §1.0.0 Features](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/CHANGELOG.md#100---2026-08-27) 中逐项列出。

### 7. 入口和工作流调整

1.0.0 同时清理旧入口：移除 bookmark 概念和 saved-courses 抽屉，并移除编辑器内嵌的旧 Agent 面板；Agent 交互集中到新的 Workbench。Pro workbench 开关还会联动 MAIC Editor gate。这些是工作流迁移，不能简单当作“新增页面”（[`CHANGELOG.md` §1.0.0 Other Changes](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/CHANGELOG.md#100---2026-08-27)）。

## 没有改变的基础能力

v1.0.0 仍保留原有课堂表现层：slides、quiz、interactive HTML、PBL 场景，多 Agent 讲解/讨论、白板与 TTS，以及 PPTX/HTML/课堂资源导出；这些能力在 v0.3.1 的发布说明中已经存在（[`CHANGELOG.md` §0.3.1](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/CHANGELOG.md#031---2026-07-21)）。README 的功能概览也仍以它们为核心（[`README.md` Overview/Highlights](https://github.com/THU-MAIC/OpenMAIC/blob/v1.0.0/README.md#-overview)）。因此可以把升级理解为：**课堂 DSL 和播放引擎基本延续，新增一个能长期操作它们的 Agent 控制平面与持久化后端。**

## 对 Chalk 评估的含义

若 Chalk 只需要复用 OpenMAIC 的课堂 DSL、播放和互动渲染，0.3.2 已包含大部分基础；若要借鉴 v1.0.0，应重点评估 Agent Workbench 的会话/事件模型、工具与技能边界、材料资产 lineage，以及 owner 校验和服务端 provider 路由。v1.0.0 仍不是跨课程的长期学生能力模型：发布说明描述的是课程构建会话和单课程数据持久化，并未声明知识点图谱、跨课掌握度或间隔复习能力。
