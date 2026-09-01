# Agent 长期记忆系统调研：OpenClaw、Hermes、DeepTutor 与 TencentDB

> 状态：Draft（调研资料，不是 Chalk 架构约束）
> 核验时间：2026-08-27
> 方法：阅读固定版本的官方源码、官方文档和仓库内设计文档；结论均附一手来源。

## 先给结论

长期记忆不是“接一个向量数据库”这么简单，而是一个持续闭环：

```text
本轮交互
  → 捕获原始事件（L0）
  → 提炼事实/场景/画像（L1→L2→L3，通常异步）
  → 按身份和问题召回
  → 以 system、user 旁路或只读工具注入 Agent
  → 记录来源、权限、版本并允许纠正/删除
```

四个系统的侧重点不同：

- OpenClaw：workspace Markdown + SQLite 索引；用 dreaming 做后台晋升，用 memory tools 和 Active Memory 做召回。
- Hermes：有严格字符上限的 `MEMORY.md`/`USER.md` 快照，加可插拔 provider；动态召回放在当前 user 消息的 API 旁路副本中。
- DeepTutor：可读、可编辑、可审计的三层 Markdown 工作台；当前聊天注入主要是显式 `memory_references`，不是默认的每轮语义召回。
- TencentDB-Agent-Memory：独立 Gateway/Proxy 的 L0→L3 管线；自动召回把稳定内容和动态内容拆到不同注入位置，可跨 OpenClaw/Hermes 复用。

### 可复用的层级模型

| 层 | 含义 | 适合注入方式 |
|---|---|---|
| L0 | 原始对话、工具事件、练习记录 | 默认不注入；通过只读搜索/读取工具按需取回 |
| L1 | 原子事实、偏好、约束、事件、掌握证据 | 按 query 的短片段，放 user 旁路或工具结果 |
| L2 | 项目/场景/近期主题摘要 | 放 system 尾部或场景索引；正文按需读取 |
| L3 | 长期画像、稳定教学策略、能力概览 | 有预算地放 system，并保持较稳定以利用 prompt cache |
| 压缩状态 | 当前会话摘要、待办、恢复点 | 只服务上下文压缩，不等同于长期记忆 |

## 运行时注入的四种模式

1. **稳定快照**：启动会话时把短小的画像/规则放进 system prompt。
2. **动态旁路**：每轮根据用户问题检索，追加到当前 user message 的 API 副本；持久化的干净消息不被污染。
3. **按需工具**：只在模型判断需要时调用 `memory_search`、`conversation_search`、`scene_read` 等工具，结果作为 tool context 回到循环。
4. **受限记忆子 Agent**：只允许检索工具，返回短摘要或 `NONE`，不替主 Agent 作答，也不拥有写权限。

把稳定内容和动态内容分开，既控制 token，也避免每轮变化的召回结果破坏 system prompt/KV cache。

## 端到端对比

| 系统 | 捕获/沉淀 | 召回触发 | 动态注入 | 稳定注入 | 主要写入时机 |
|---|---|---|---|---|---|
| OpenClaw 原生 | memory 工具、pre-compaction flush、session transcript ingest；dreaming Light/REM/Deep | curated bootstrap/trigger；弱命中且有 recall intent 时 Active Memory | trigger lane 的 hidden block、`memory_search` 工具结果、Active Memory 摘要 | `MEMORY.md`/`USER.md` 启动快照；memory tool guidance | 工具写入、flush、dreaming、session ingestion |
| Hermes 内置/Provider | `memory` 工具或 provider `sync_turn`；可在压缩前 checkpoint | 每轮 `prefetch(query)`（跳过 trivial prompt）或模型主动搜 session | `<memory-context>` 追加到 user API sidecar | 冻结的内置文件快照、provider `system_prompt_block` | 工具立即写盘；provider 后台同步 |
| DeepTutor | 各 surface 的 L1 trace/snapshot；Workbench consolidator；`write_memory` 写偏好 | 请求显式传 `memory_references`；模型也可调用 `read_memory` | 当前实现没有默认 L1 语义自动召回 | `UnifiedContext.memory_context` → Chat system 的 `## memory` block | trace 即时追加；L2/L3 多由 Workbench Update/Audit/Dedup |
| TencentDB | `agent_end` 写 L0；Pipeline 异步 L1→L2→L3 | `before_prompt_build` / Hermes `prefetch` | L1 hybrid 结果 `prependContext` | L3 persona、L2 scene navigation、工具指南 `appendSystemContext` | agent_end 后台捕获；按阈值/idle/timer 提炼 |

下面分别展开实现细节。

## 1. OpenClaw（原生 memory-core 与 Active Memory）

### 存储和形成

原生 memory-core 使用 workspace 中的普通 Markdown，没有隐藏的模型状态：

- `USER.md`：稳定用户画像、偏好、沟通方式；
- `MEMORY.md`：策展后的长期事实、决定和项目知识；
- `memory/YYYY-MM-DD.md`：工作层 daily notes/观察；可被索引，但不会在每轮自动塞入 bootstrap；
- session transcript：可作为额外可搜索语料；`DREAMS.md` 是供人审阅的 dreaming 日志，不是晋升来源。

官方概念文档明确区分 curated core 与 episodic tier，并说明 daily notes 会由 dreaming 逐步提炼进 `MEMORY.md`。[Memory overview](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/docs/concepts/memory.md#L10-L60) · [Memory architecture](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/docs/concepts/memory-architecture.md#L48-L64)

写入路径包含显式 memory 工具、压缩前的 memory flush、会话转录摄取；dreaming 分 Light、REM、Deep。Deep 先用相关性、召回频次、query 多样性、时效性等确定性门槛筛选，再让有界模型合并/去重/替代；结构校验失败时回退到 append-only。写入有 hash/乐观并发检查、原子 rename、pre-image 和 `DREAMS.md` 摘要。[Dreaming](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/docs/concepts/dreaming.md#L18-L95) · [Architecture—write path](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/docs/concepts/memory-architecture.md#L127-L198)

### 检索和注入

OpenClaw 的 Lane 1 不调用模型：

- 启动/每轮预算内加载合格的 `MEMORY.md`/`USER.md`；
- `memory_search` 使用 BM25 + embedding 的 hybrid search，并结合 recency、importance、MMR 等排序；
- 写作者可在 curated entry 上附 trigger，命中强度达到阈值时最多注入三条 hidden context；daily notes/transcripts 不走这种自动注入，仍需工具或升级 lane。

[Architecture—recall lanes](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/docs/concepts/memory-architecture.md#L200-L247) · [Memory search](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/docs/concepts/memory-search.md#L67-L163)

Lane 2 是 Active Memory：当消息表达了“回忆过去”的意图且 Lane 1 没有强命中时，启动受限的 blocking recall sub-agent；它只能调用配置的 memory recall tools，返回短摘要或 `NONE`。只对合格的持久、面向用户的交互会话运行，有超时、熔断、字符预算，失败不影响主回复。[Active Memory](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/docs/concepts/active-memory.md#L128-L190) · [工具与失败降级](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/docs/concepts/active-memory.md#L457-L475)

接入链路有两部分：memory-core 注册 `memory_search`/`memory_get` 和 `promptBuilder`；promptBuilder 只生成“何时搜索、如何读取、如何引用”的静态 `## Memory Recall` 指引，不是把搜索结果预先硬编码进 system。主 Agent 后续调用工具时，结果进入 tool context。memory-core 的注册点见 [index.ts](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/extensions/memory-core/index.ts#L228-L278)，指引模板见 [memory-tool-contract.ts](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/extensions/memory-core/src/memory-tool-contract.ts#L85-L128)。

系统 prompt 组装时，内置 memory snapshot 和外部 provider 的静态 block 位于 volatile 区；context engine 会把同一段转换为 `systemPromptAddition`。[system-prompt.ts](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/src/agents/system-prompt.ts#L802-L845) · [delegate.ts](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/src/context-engine/delegate.ts#L223-L247)

### 安全和删除

索引记录 `owner`、`agent`、`untrusted`、`system` 等来源类别和 session kind；cron/heartbeat/sub-agent 产物不具备 durable promotion 资格，已经注入的 memory context 会被标记，避免“召回→再次捕获”的反馈环。 `memory forget` 可按 session/participant/hook source 清理可追踪产物，但官方也明确说明它不是所有 transcript、自由编辑和外部备份的全量擦除。[Architecture—provenance](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/docs/concepts/memory-architecture.md#L66-L125) · [Provenance and deletion](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/docs/concepts/memory-provenance.md#L152-L224)

**理解要点**：OpenClaw 不是“每轮把所有 memory 贴进 system”。它同时拥有启动快照、受信任 trigger lane、按需工具和 Active Memory 四条路径；检索成本和信任级别不同。

## 2. Hermes Agent

### 内置记忆：有界文件 + 冻结快照

Hermes 内置两个文件：`~/.hermes/memories/MEMORY.md`（默认 2,200 字符）和 `USER.md`（默认 1,375 字符）。启动时读取、清洗并渲染为 system prompt 的冻结 snapshot；本轮工具对磁盘的 add/replace/remove 会立即持久化，但 snapshot 不在 session 中刷新，以保持 prompt prefix cache 稳定。超出上限不会静默丢数据，而是返回错误要求先合并或删除。[官方 Memory 文档](https://github.com/NousResearch/hermes-agent/blob/cced6fa360a589ba50abfde687ef1bcba8ddaf2e/website/docs/user-guide/features/memory.md#L11-L67) · [MemoryStore load/snapshot](https://github.com/NousResearch/hermes-agent/blob/cced6fa360a589ba50abfde687ef1bcba8ddaf2e/tools/memory_tool.py#L227-L264)

内置 `memory` 工具支持 `add`、`replace`、`remove`；写入前扫描 prompt injection/凭证外泄等威胁，使用原子文件替换。更长的 session transcript 另存 `state.db`，通过 SQLite FTS5 的 `session_search` 按需读取，并不等同于小容量 persona memory。[工具 schema](https://github.com/NousResearch/hermes-agent/blob/cced6fa360a589ba50abfde687ef1bcba8ddaf2e/tools/memory_tool.py#L1262-L1305) · [Session search](https://github.com/NousResearch/hermes-agent/blob/cced6fa360a589ba50abfde687ef1bcba8ddaf2e/website/docs/user-guide/features/memory.md#L177-L211)

### 外部 provider 生命周期和每轮注入

`MemoryProvider` 把 provider 变成生命周期插件：`initialize`、`system_prompt_block`、`prefetch`、`sync_turn`、工具 schema/dispatch，以及可选的 `on_pre_compress`、`on_session_end` 等。 `MemoryManager` 限制最多一个 external provider，并处理工具名冲突。[provider API](https://github.com/NousResearch/hermes-agent/blob/cced6fa360a589ba50abfde687ef1bcba8ddaf2e/agent/memory_provider.py#L110-L229) · [provider registration](https://github.com/NousResearch/hermes-agent/blob/cced6fa360a589ba50abfde687ef1bcba8ddaf2e/agent/memory_manager.py#L403-L509)

每轮顺序是：`on_turn_start` → 对非 trivial prompt 执行 `prefetch_all(query)` → 把返回文本包成 `<memory-context>` → `compose_user_api_content()` 将它追加到当前 user 消息的 **API-bound sidecar**。干净的持久消息不变，但下一轮重放 sidecar 时仍能复现上轮实际发送的 bytes，避免 prompt cache 漂移。[turn_context.py](https://github.com/NousResearch/hermes-agent/blob/cced6fa360a589ba50abfde687ef1bcba8ddaf2e/agent/turn_context.py#L54-L86) · [turn start/prefetch](https://github.com/NousResearch/hermes-agent/blob/cced6fa360a589ba50abfde687ef1bcba8ddaf2e/agent/turn_context.py#L1375-L1416)

provider 的 `system_prompt_block` 仍会进入 system 的 volatile tail；prefetch 的动态内容不放那里。[system prompt assembly](https://github.com/NousResearch/hermes-agent/blob/cced6fa360a589ba50abfde687ef1bcba8ddaf2e/agent/system_prompt.py#L819-L845) `MemoryManager` 对外部 prefetch 设置超时，失败只记录并跳过；每轮 `sync_all` 在后台串行写入，`on_pre_compress` 可在压缩前再保存即将被丢弃的重要信息。[prefetch timeout/status](https://github.com/NousResearch/hermes-agent/blob/cced6fa360a589ba50abfde687ef1bcba8ddaf2e/agent/memory_manager.py#L564-L671) · [async sync](https://github.com/NousResearch/hermes-agent/blob/cced6fa360a589ba50abfde687ef1bcba8ddaf2e/agent/memory_manager.py#L714-L770) · [pre-compress hook](https://github.com/NousResearch/hermes-agent/blob/cced6fa360a589ba50abfde687ef1bcba8ddaf2e/agent/memory_provider.py#L317-L327)

**理解要点**：Hermes 把“静态人格”和“动态召回”在数据结构上分开，并把 sidecar 作为 cache 一致性边界；这比简单修改历史 user message 更稳。

## 3. DeepTutor（HKUDS/DeepTutor）

### 先说明核验版本

本节是 2026-08-27 的历史核验快照，依据官方仓库固定提交 [`3e82f130422a813cdd73c10b21a44e9325f5821a`](https://github.com/HKUDS/DeepTutor/tree/3e82f130422a813cdd73c10b21a44e9325f5821a) 的源码；当时本地参考目录尚未 checkout。当前 `.reference/DeepTutor` 已更新到 v1.6.2（commit `3dc372f551285ea8ffd552ba01cd5dd16c59cb25`），实现细节和 Chalk 集成建议以[最新专篇](2026-08-31-deeptutor-memory-system-research.md)为准。

### 三层、可审计的文件模型

官方 README 将它定义为 file-backed 三层记忆：L1 是 workspace mirror + `trace/<surface>/<date>.jsonl` append-only trace；L2 是按 surface 的 curated facts；L3 是跨 surface 的 `profile/recent/scope/preferences`。L2 引用 L1，L3 引用 L2，Memory Graph 可以沿链路回到原始事件。[README Memory](https://github.com/HKUDS/DeepTutor/blob/3e82f130422a813cdd73c10b21a44e9325f5821a/README.md#L621-L633) · [paths.py](https://github.com/HKUDS/DeepTutor/blob/3e82f130422a813cdd73c10b21a44e9325f5821a/deeptutor/services/memory/paths.py#L1-L12)

L1 `TraceEvent` 含稳定 id、UTC 时间、surface、kind、payload、session/turn id；append 失败只记录日志，不阻塞业务 surface。[trace.py](https://github.com/HKUDS/DeepTutor/blob/3e82f130422a813cdd73c10b21a44e9325f5821a/deeptutor/services/memory/trace.py#L1-L87) snapshot adapters 则把 chat、notebook、quiz、KB、book、partner、cowriter 等工作面投影成可供 consolidation 使用的实体。

### 形成、更新和聊天注入

Memory Workbench 的 `run_update` 以 `*.meta.json` 的 seen-id 做增量 diff，将输入按边界切块，逐块调用中英文 LLM prompt，校验引用后追加到 L2/L3；`audit`、`dedup`、`merge` 是独立模式，写入有 checkpoint。 `preferences.md` 明确不自动 consolidation。[update.py](https://github.com/HKUDS/DeepTutor/blob/3e82f130422a813cdd73c10b21a44e9325f5821a/deeptutor/services/memory/consolidator/modes/update.py#L1-L16) · [L2/L3 update](https://github.com/HKUDS/DeepTutor/blob/3e82f130422a813cdd73c10b21a44e9325f5821a/deeptutor/services/memory/consolidator/modes/update.py#L80-L134) · [preferences guard](https://github.com/HKUDS/DeepTutor/blob/3e82f130422a813cdd73c10b21a44e9325f5821a/deeptutor/services/memory/consolidator/modes/update.py#L360-L375)

聊天运行时从请求解析 `memory_references`；只要列表非空，就读取四份 L3 文档并形成 `memory_context`，再放入 `UnifiedContext`。 `ChatPromptAssembler` 将其渲染成 system prompt 的 `## memory` block。[turn_runtime.py](https://github.com/HKUDS/DeepTutor/blob/3e82f130422a813cdd73c10b21a44e9325f5821a/deeptutor/services/session/turn_runtime.py#L175-L191) · [读取并组装](https://github.com/HKUDS/DeepTutor/blob/3e82f130422a813cdd73c10b21a44e9325f5821a/deeptutor/services/session/turn_runtime.py#L1490-L1494) · [注入 context](https://github.com/HKUDS/DeepTutor/blob/3e82f130422a813cdd73c10b21a44e9325f5821a/deeptutor/services/session/turn_runtime.py#L1598-L1607) · [PromptBlock](https://github.com/HKUDS/DeepTutor/blob/3e82f130422a813cdd73c10b21a44e9325f5821a/deeptutor/agents/chat/prompt_blocks.py#L70-L90)

因此当前策略是**显式 opt-in 的 L3 快照**，不是每轮 query→L1 的自动语义召回。 `read_memory` 工具也只是一次读取四份 L3；`write_memory` 只接受用户明确表达的偏好，先写 `chat/preference_stated` L1 trace，再写 `L3/preferences.md` 并带 trace 引用。其他 L2/L3 文档由 Workbench 操作。[store.py](https://github.com/HKUDS/DeepTutor/blob/3e82f130422a813cdd73c10b21a44e9325f5821a/deeptutor/services/memory/store.py#L93-L102) · [read/write tools](https://github.com/HKUDS/DeepTutor/blob/3e82f130422a813cdd73c10b21a44e9325f5821a/deeptutor/tools/builtin/__init__.py#L776-L910)

**理解要点**：DeepTutor 的长期记忆更像“用户可审阅的学习档案”，而不是隐藏的通用 RAG。它的学习掌握度（Mastery）还在另一套状态模型中，不能把偏好记忆当成知识点掌握证据。

## 4. TencentDB-Agent-Memory

调研版本：本地仓库 [`5299c00aaf65481703c180fd69df066d11254eb7`](https://github.com/TencentCloud/TencentDB-Agent-Memory/tree/5299c00aaf65481703c180fd69df066d11254eb7)。

### L0→L3 和异步 Pipeline

官方 README 的层级是：L0 Conversation（原始对话）、L1 Atom（事实/偏好/约束/事件）、L2 Scenario（项目/场景知识块）、L3 Core/Persona（长期画像/稳定模式）。平时用 L2/L3 快速恢复语境，需要细节时回退 L1/L0 的 BM25、向量或 hybrid/RRF 检索。[README 技术实现](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/5299c00aaf65481703c180fd69df066d11254eb7/README_CN.md#L239-L269)

OpenClaw 的 `agent_end` hook 将新消息写入 L0，并用 checkpoint/cursor 防重复；L0 元数据/FTS 可先写，embedding 可后台完成。[auto-capture](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/5299c00aaf65481703c180fd69df066d11254eb7/MemoryCore/src/core/hooks/auto-capture.ts#L98-L159) 之后由 `MemoryPipelineManager` 按会话数阈值、idle timeout、L2 delay/min/max interval 和 L3 全局互斥，异步推进 L1→L2→L3。[pipeline-manager](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/5299c00aaf65481703c180fd69df066d11254eb7/MemoryCore/src/utils/pipeline-manager.ts#L1-L73)

### Core auto-recall：稳定/动态分流

`performAutoRecall` 在 Agent 开始处理前并行/分别执行：

- L1：keyword（FTS5 BM25）、embedding cosine 或 hybrid；
- L3：读取 persona；
- L2：读取 scene index/navigation。

结果被有意拆开：L1 命中放 `prependContext`，作为每轮变化的 user prompt 前缀；persona、scene navigation 和工具指南放 `appendSystemContext`，作为较稳定的 system 尾部。召回有总字符预算和 timeout，失败返回结构化错误而不阻塞主 Agent。[auto-recall](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/5299c00aaf65481703c180fd69df066d11254eb7/MemoryCore/src/core/hooks/auto-recall.ts#L92-L133) · [分流和格式](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/5299c00aaf65481703c180fd69df066d11254eb7/MemoryCore/src/core/hooks/auto-recall.ts#L258-L312)

### 两个框架适配器

OpenClaw client 插件在 `before_prompt_build` 读取 `event.prompt`，调用 `searchAtomic`、`readCore`、`listScenarios`，并**返回** `{prependContext, appendSystemContext}`；OpenClaw 消费 hook 返回值，而不是依赖修改 event 对象。 `agent_end` 则负责 capture；另有 `before_message_write` 清理 `<relevant-memories>`，避免召回脚手架写入会话 JSONL。[OpenClaw plugin index](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/5299c00aaf65481703c180fd69df066d11254eb7/MemoryCore/openclaw-plugin/index.ts#L167-L215) · [capture hook](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/5299c00aaf65481703c180fd69df066d11254eb7/MemoryCore/openclaw-plugin/index.ts#L217-L285)

Hermes 插件实现 `MemoryProvider`：`prefetch()` 并行请求 L1 atomic search、L3 core read、L2 scenario list，返回 `<relevant-memories>`、`<user-core>`、`<scene-navigation>`；`sync_turn()` 通过后台线程调用 `/v3/conversation/add`。[Hermes provider](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/5299c00aaf65481703c180fd69df066d11254eb7/MemoryCore/hermes-plugin/memory/memory_tencentdb/__init__.py#L533-L755)

### Proxy/Loadout 和身份边界

MemoryProxy 先把协议请求解析成 `AgentContext`，再按 `system.prefix`、`system.suffix`、`user.before` 等 injection point 执行 hooks；可用 `session_init` cache 预热稳定 block。[InjectionPipeline](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/5299c00aaf65481703c180fd69df066d11254eb7/MemoryProxy/src/injection/pipeline.ts#L1-L15) · [hook/cache 执行](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/5299c00aaf65481703c180fd69df066d11254eb7/MemoryProxy/src/injection/pipeline.ts#L149-L175)

Proxy 的 TDAI profile injector 把 L3 persona 和 L2 scene 索引放 system，正文用只读工具按需读取；memory bridge 只放行 search/query/read 子路径，禁止模型直接写 L0/L1/L2/L3。[profile injector](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/5299c00aaf65481703c180fd69df066d11254eb7/MemoryProxy/src/injection/injectors/tdai-profile-memory-injector.ts#L10-L24) · [tools injector](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/5299c00aaf65481703c180fd69df066d11254eb7/MemoryProxy/src/injection/injectors/tdai-tools-injector.ts#L1-L31) · [memory bridge](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/5299c00aaf65481703c180fd69df066d11254eb7/MemoryProxy/src/memory/memory-bridge.ts#L1-L20)

v3 调用携带 `team_id`、`agent_id`、`user_id`，可选 `session_id`；Proxy 在无法从已初始化 session 得到完整 ID 时拒绝请求，而不是让模型在 body 中自报身份。[bridge identity check](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/5299c00aaf65481703c180fd69df066d11254eb7/MemoryProxy/src/memory/memory-bridge.ts#L95-L130) 注意：当前 Hermes/OpenClaw 适配器源码仍把 `"default"` 作为某些参数的兼容默认值；多租户产品不能照搬这种 fallback，必须在 owner 身份解析失败时 fail closed。

**理解要点**：TencentDB 把记忆变成独立 sidecar/Gateway。框架适配器只负责生命周期和注入形状，昂贵的抽取、索引、场景/画像生成在后台服务完成。

## 对 Chalk（数学学习产品）的建议

这些建议是调研启发，不会自动改变 Chalk 的已确认架构约束。

### 1. 把 Learner Memory 和 Mastery 分开

- **Learner Memory**：语言/讲解偏好、动机、可用时间、近期主题、用户明确的约束。
- **Mastery/Evidence**：知识点证据、错误类型、解题步骤、提示次数、复习时间、掌握门槛。
- **L0 学习事件**：题目、作答、错误步骤、提示、教师/Agent 反馈、学生自评。

Mastery 是可计算的状态机；自由文本画像不能替代“分数是否达到过关门槛”。

### 2. 采用教育领域的 L0→L3

```text
L0 练习/对话/操作事件（append-only）
  → L1 知识点证据、错误模式、偏好（带 source_event_id）
  → L2 当前单元/题型/近期学习情境
  → L3 长期能力画像 + 教学策略
```

每条派生记忆至少带 `student_id`、`tenant_id`、`session_id`、`source_event_id`、观察时间和版本；冲突时保留旧证据并显式 supersede，而不是覆盖到无法追溯。

### 3. 运行时用三条通道

1. L3 的短画像/教学策略：预算化放 system 的稳定区。
2. 与当前题目相关的 L1/L2 证据：放独立 `memory_context` 或 user sidecar，设单条/总 token 上限。
3. 原题、完整过程、历史对话：只读 `memory_search` / `conversation_search` / `scene_read` 工具按需读取。

不要把整库向量结果无界拼接到 system，也不要让模型传入任意 `student_id` 来换取别人的记忆。

### 4. 把沉淀放到课堂主循环之外

课堂 turn 只做轻量 capture 和有界 recall；L1 抽取、去重、L2 场景合并、L3 画像更新在后台队列运行。任何 recall/capture/embedding 超时都应降级为空记忆并记录指标，不能阻塞学生得到答案。

### 5. 从第一天就做治理和可观测性

- owner 校验集中在数据访问层；身份缺失或认证异常直接拒绝（fail closed）。
- 记忆内容做 prompt-injection/凭证泄露扫描；来源不明的内容不得自动晋升为稳定画像。
- 提供“为什么召回”“来自哪道题/哪次会话”“删除后覆盖哪些派生物”的审计视图。
- 记录候选数、召回分数、注入 token、超时、降级、写入/去重/冲突结果。
- 几何/DSL/掌握门槛等确定性约束不能交给记忆模型自行决定，必须有单测和结构化校验。

## 推荐阅读顺序

1. 先读本报告的“运行时注入四种模式”和对比表。
2. 再看 OpenClaw 的 [memory-architecture](https://github.com/openclaw/openclaw/blob/0b652b009107c7c4a6516f26ba7a96a0cb168881/docs/concepts/memory-architecture.md) 与 Hermes 的 [MemoryProvider API](https://github.com/NousResearch/hermes-agent/blob/cced6fa360a589ba50abfde687ef1bcba8ddaf2e/agent/memory_provider.py)。
3. 想看可审计文档模型，读 DeepTutor 的 `paths.py`、`trace.py`、`consolidator/modes/update.py` 和 `turn_runtime.py`。
4. 想看独立服务化和跨框架接入，读 TencentDB 的 `auto-recall.ts`、`pipeline-manager.ts`、OpenClaw/Hermes adapters 和 MemoryProxy injection pipeline。
