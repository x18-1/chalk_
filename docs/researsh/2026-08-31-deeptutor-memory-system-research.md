# DeepTutor 记忆系统调研（本地参考快照）

> 文档状态：Draft（调研结论，尚未转化为 Chalk 架构约束）
> 核验时间：2026-08-31
> 研究对象：`.reference/DeepTutor` 本地仓库，commit `3dc372f551285ea8ffd552ba01cd5dd16c59cb25`（DeepTutor `1.6.2`，见 `.reference/DeepTutor/deeptutor/__version__.py:1-9`）。

## 结论摘要

DeepTutor 的核心不是向量数据库，而是“可检查的三层记忆”：L1 原始活动/事件，L2 按产品表面提炼的事实，L3 跨表面综合。Markdown 文档中的每条事实带稳定 entry id 和来源脚注，因而可以在工作台中人工编辑、审计、去重并回溯证据（`.reference/DeepTutor/README.md:642-648`）。

建议 Chalk 采用其数据流和证据约束，但不直接复制 Python/文件存储实现：Chalk 已确定全栈 TypeScript、Postgres + Drizzle，且 DAL 必须在 SQL 层执行 owner 校验。可移植的是 L1→L2→L3 的分层语义、引用池校验、幂等增量 consolidation、审计/去重模式和只读 recall；持久化、队列和 API 应按 Chalk 既有架构重写。

## DeepTutor 当前实现

### 1. 分层与存储布局

`paths.py` 定义每个用户 memory root 下的布局：`trace/<surface>/<YYYY-MM-DD>.jsonl`（L1 追加事件）、`L2/<surface>.md`（七个表面摘要）、`L3/{recent,profile,scope,preferences}.md`（四个跨表面槽位）及迁移备份目录（`.reference/DeepTutor/deeptutor/services/memory/paths.py:1-11,47-103`）。表面包含 `chat/notebook/quiz/kb/book/partner/cowriter`（同文件:47-59）。路径通过 `PathService` 和 `ContextVar` 在调用时解析；partner turn 可临时 override owner memory scope（同文件:27-44,62-65），避免跨用户串读。

L1 有两种来源：

- Snapshot adapter 将各表面的当前实体映射成 `Entity{id,label,ts,content,metadata,fingerprint}`；`EntityStamp` 仅保留 id/label/fingerprint/ts，用于无需加载正文的 diff（`.reference/DeepTutor/deeptutor/services/memory/snapshot/entity.py:19-73`）。
- Snapshot 状态写入 `snapshot/<surface>/state.json`（fingerprints、labels、last_refresh），变化追加到 `changes.jsonl`；状态采用临时文件 + rename，变化逐行追加（`.reference/DeepTutor/deeptutor/services/memory/snapshot/store.py:1-12,27-81`）。

事件 trace 使用 `TraceEvent{id,ts,surface,kind,payload,session_id,turn_id}`，按 UTC 日期写入 JSONL；按表面 asyncio 锁串行追加，失败只记录 warning、不阻断业务（`.reference/DeepTutor/deeptutor/services/memory/trace.py:1-17,27-70`）。事件 id 是 `<surface>:<ULID>`，文档 entry id 是 `m_<ULID>`（`.reference/DeepTutor/deeptutor/services/memory/ids.py:1-18`）。

### 2. 文档数据模型与原子操作

L2/L3 是 Markdown，但通过纯函数 parser/serializer 映射到 `Document{title,sections}` 和 `Entry{id,section,text,refs}`。每个 bullet 末尾保留 `<!--m_<ULID>-->` 锚点；来源脚注按首次出现的 ref 去重并重新编号，兼容旧的 entry-keyed 格式（`.reference/DeepTutor/deeptutor/services/memory/document.py:1-33,64-75,105-182,185-220`）。

LLM 不直接改 Markdown，而输出 `AddOp`、`EditOp`、`DeleteOp`。批量操作先整体校验（文本 ≤240 字符、section ≤80、ref 合法、禁止同一 entry 同时 edit/delete），任一失败则整批不变；通过后才分配 id、修改文档（`.reference/DeepTutor/deeptutor/services/memory/ops.py:1-7,18-20,68-129,131-149`）。`MemoryStore` 是所有 API、工具和事件钩子的无状态 facade，写入按文档路径加 asyncio 锁并原子落盘（`.reference/DeepTutor/deeptutor/services/memory/store.py:1-7,68-110`）。

### 3. 增量更新（consolidator Update）

Update 模式的算法在源码注释中明确：读取 `*.meta.json` 的已见 id 集合，按时间拼接新增输入，按段落/句子边界切 chunk，逐块调用 LLM，按 chunk 引用池过滤事实，追加到内存 Document，逐步原子写盘并更新 meta；可自动触发 dedup（`.reference/DeepTutor/deeptutor/services/memory/consolidator/modes/update.py:1-16`）。

- L2：对 snapshot entities 做 `surface:id` 集合差分；无新增输入时仍更新时间戳并可执行 merge（同文件:150-194）。有新增时，`render_traces_for_concat` 为每个实体加入唯一 marker、ref、label、ts、metadata 和完整正文；chunk 内 LLM 只能引用可见实体（`.reference/DeepTutor/deeptutor/services/memory/consolidator/references.py:169-200`；update.py:196-253）。
- LLM 返回事实后，`validate_fact_refs` 强制至少一个 ref（可配置）；非法或不在 chunk 池中的 ref 被删除或整条事实拒绝（`.reference/DeepTutor/deeptutor/services/memory/consolidator/references.py:125-163`）。每块结果通过 `AddOp` 路径写入并产生 checkpoint（update.py:262-301）。
- L3：读取各 L2 文档中新 entry 的 id 差分，按表面拼接后再 chunk，生成 `recent/profile/scope` 等综合事实；`preferences` 明确禁止自动 consolidation（update.py:363-374,376-424）。当前代码把 L3 来源设计为表面级 ref（`chat` 等）而不是单条 `m_xxx`（update.py:466-471；`ids.py` 的 shortname 白名单）。注意 `references.py:203-213` 的注释仍写“L3 facts have no refs”，与 update.py/`prompts/en/update_l3.yaml` 的表面 ref 契约不一致；迁移时应以运行时代码和测试为准，补一条明确的 provenance 契约。

增量正确性依赖 sidecar meta：L2 记录 `seen_entity_refs`，L3 记录每个表面已见的 L2 entry ids，缺失 meta 视为首次运行（`.reference/DeepTutor/deeptutor/services/memory/consolidator/meta.py:1-20,31-83`）。

### 4. Audit、Dedup、Merge 与运行控制

- Audit 将 Markdown 按行编号，并把每条 L2 entry 的完整原始实体（或 L3 entry 的 L2 证据）拼入 prompt；LLM 只能返回 replace/delete/insert，修改必须引用当前可见证据（`.reference/DeepTutor/deeptutor/services/memory/consolidator/references.py:220-280`；prompts `audit_l2.yaml`、`audit_l3.yaml`）。
- Dedup 对整个文档迭代调用 LLM，仅允许 replace/delete，按逆序应用；无编辑即提前收敛，默认最多 3 次（`.reference/DeepTutor/deeptutor/services/memory/consolidator/modes/dedup.py:1-15,90-180`）。
- Merge 不调用 LLM，仅重新序列化脚注、折叠重复 ref；L3 还把旧的 `m_<ULID>` ref 迁移成表面名（`.reference/DeepTutor/deeptutor/services/memory/consolidator/modes/merge.py:1-18,42-52`）。
- 长任务由进程内 `RunManager` 管理：同一 `(layer,key)` 最多一个 active run，事件缓冲支持按 cursor 重放，支持取消和 undo checkpoint；进程重启会丢失运行记录，但文档每步原子写入且 meta 差分保证可恢复（`.reference/DeepTutor/deeptutor/services/memory/consolidator/runs.py:1-21,46-104,117-127,156-180`）。

参数集中在 `memory` settings：L2/L3 update/audit budget、dedup 迭代次数、chunk overlap/boundary、引用强制和非法 ref 策略；读取时补默认值并 clamp 范围，前端 Settings 页面读写同一配置（`.reference/DeepTutor/deeptutor/services/memory/settings.py:1-9,21-79,82-110`）。

### 5. Agent 运行时读写与 Recall

`read_memory` 工具只拼接四个 L3 文档，作为个性化上下文，不要求每轮调用；`write_memory` 仅接受用户明确表达的偏好，先写一条 `preference_stated` L1 事件，再写入 L3 `preferences.md`，重复偏好幂等去重（`.reference/DeepTutor/deeptutor/tools/builtin/__init__.py:784-811,814-829,878-908`）。

`recall.recent` 只读取 snapshot stamps（标签、时间、表面），默认最近 7 天/最多 20 条，清理标签、按表面+标签去重；正文不会进入交互路径。`recent_queries` 另读 `kb:query` trace 以保留用户原话（`.reference/DeepTutor/deeptutor/services/memory/recall.py:1-21,35-42,120-136,142-186,189-220`）。

## 依赖、许可与可直接复用边界

- DeepTutor 仓库声明 Apache License 2.0，版权行是 “Copyright 2025 Data Intelligence Lab, The University of Hong Kong”；再分发需保留许可证、版权/归属和修改声明（`.reference/DeepTutor/LICENSE:190-202`）。
- 记忆实现是 Python，依赖 DeepTutor 的 FastAPI、PyYAML/ConfigManager、LLM provider 及文件型 PathService；`pyproject.toml` 将项目标记为 Apache-2.0（`.reference/DeepTutor/pyproject.toml:1-20`）。直接复制代码到 Chalk 会违反“后端全 TypeScript”约束，也会把文件路径、多用户 ContextVar 和 Python 依赖带入主请求路径。
- 可以借鉴/重写：分层语义、Entity/Stamp + fingerprint diff、ULID 引用、Document/Entry 结构、原子 op 校验、chunk + ref-pool、audit/dedup/merge 工作流、recall 的无正文快速路径。若复制具体代码或 prompt，应在 Chalk 中保留 Apache-2.0 NOTICE/provenance，并逐项核对 DeepTutor 版本及第三方依赖许可证；英文 prompt 需按 Chalk `docs/architecture/prompts.md` 管理中英文配对。

## Chalk 应用蓝图（建议）

### 目标边界

1. **L1 学习证据账本（Postgres append-only）**：在现有 `learning_sessions`、`quiz_attempts`、课堂讨论 transcript、agent telemetry 等写路径产生 `memory_events`；每行带 `user_id`、surface、kind、payload JSONB、occurred_at、stable source id/fingerprint。事件写入失败策略按证据账本要求 fail closed/告警，不静默制造默认身份。
2. **L2 领域摘要（Postgres JSONB/表）**：按 `chat`、`classroom`、`quiz`、`geometry` 等 Chalk surface 保存 `memory_entries`（entry id、section、text、refs、status、version）。Refs 指向 L1 event ids；每次 consolidation 以 sidecar 等价的 `memory_cursors`（surface + last seen event id/fingerprint）做幂等集合差分。
3. **L3 学习者画像/掌握度（受控字段）**：不要照搬 DeepTutor 的泛化 profile。优先存 Chalk 可解释的 `misconceptions`、`mastery hypotheses`、`practice queue`，每条结论必须 refs 到 L2；掌握度的最终判定仍由确定性评分/IRT/BKT 组件决定，LLM 仅生成教学表达。

### 分层与模块落点

建议新增 `apps/api/src/modules/memory/`：`routes.ts`（仅 HTTP adapter）、`schemas.ts`（Zod）、`services/memory-consolidation.service.ts`（编排 update/audit/dedup）、`services/memory-recall.service.ts`（无正文 recent/个性化读取），以及 `apps/api/src/db/schema/memory.ts` + `apps/api/src/db/dal/memory.ts`。DAL 每个方法第一个参数必须是 `userId` 并在 SQL 中附加 owner 条件，遵守 `docs/architecture/backend-layers.md:64-83` 的 owner 校验规则。

现有 Agent 接缝可直接复用：`packages/agent-runtime/src/tools/tool-registry.ts` 定义 `RuntimeTool`/权限与结果限制，`packages/agent-runtime/src/runtime/agent-runtime.ts` 承载通用循环，`apps/api/src/agent/builtin-tools.ts` 是业务工具注册入口，`apps/api/src/agent/runtime-manager.ts` 负责按用户装配 runtime、DAL 和 telemetry。记忆工具应在 `builtin-tools.ts` 注入一个薄 adapter，显式接收 `userId`/`conversationId`，再调用 memory Service；不要在 `packages/agent-runtime` 内访问 Drizzle 或隐式读取身份。

Agent 侧提供两个 TypeBox 工具 adapter：

- `read_memory`：默认读取压缩后的 L3 教学上下文，按 token 预算和课堂/会话 scope 过滤；需要证据时再显式 `read_memory_evidence`，避免每轮加载原始正文。
- `write_memory`：仅允许学生明确表达的偏好、学习目标或纠错信号；参数先 TypeBox，再转 Zod command，由 Memory Service + DAL 写入并记录 L1 ref。禁止 Agent 直接写掌握度或删除证据。

Consolidation 作为 pg-boss/Graphile Worker 任务（而非请求内长 asyncio task）：任务 key `(user_id, layer, key)` 保证单活跃；每块 LLM 调用后写版本化 checkpoint，失败可重试，审计/去重结果需经 deterministic validator 后提交。前端 Memory Workbench 通过 SSE/轮询读取持久化 run events；服务重启后可从 DB 恢复。

### 迁移顺序与验证

1. 先实现 `memory_events` + owner-scoped DAL 和事件 schema；将 chat、课堂学习、quiz、判题结果接入 L1。
2. 实现纯 TS 的 ref/entry 操作和单测（对应 DeepTutor `document.py`、`ops.py` 的不变量），再接入 L2 update worker。
3. 增加 L3 仅证据支持的综合；明确采用“表面级 ref”或“entry 级 ref”之一，修正文档/prompt/validator 一致性。
4. 增加 recall 工具和 token 预算；随后再做 audit/dedup/merge UI。
5. 为每层建立确定性测试：owner 隔离、幂等 cursor、非法 ref 拒绝、批量原子性、并发单活跃、证据链完整性；LLM eval 只评估表达质量，不决定掌握度真值。

## 已知风险与取舍

- 文件 Markdown 对单用户工作台很直观，但在 Chalk 多实例部署下会产生共享卷、锁和备份问题；Postgres JSONB/关系表更符合现有部署与 owner DAL 约束。
- DeepTutor 的 L3 provenance 在当前源码和旧注释/prompt 之间存在不一致（见上文）；Chalk 不应复制这一歧义。
- DeepTutor `RunManager` 是进程内、重启即失；Chalk 的 consolidation 需要持久化 job/run 状态和幂等写版本，以满足企业级恢复要求。
- 记忆内容包含学生敏感学习数据。必须沿用 Chalk 的认证 fail-closed、owner 校验、最小化工具暴露和审计日志；禁止把原始答案/PII 无界复制到 L3。

## 主要一手来源

- `.reference/DeepTutor/README.md:642-648` — 三层记忆产品定义与可追溯性。
- `.reference/DeepTutor/deeptutor/services/memory/paths.py:1-11,27-65` — 用户隔离路径与层布局。
- `.reference/DeepTutor/deeptutor/services/memory/trace.py:1-17,27-70` — L1 事件模型和追加语义。
- `.reference/DeepTutor/deeptutor/services/memory/snapshot/{entity.py,store.py}` — Entity/Stamp、fingerprint diff 持久化。
- `.reference/DeepTutor/deeptutor/services/memory/document.py:1-33,64-75,105-220` — Markdown 文档模型、脚注和序列化。
- `.reference/DeepTutor/deeptutor/services/memory/ops.py:1-7,68-149` — 原子 add/edit/delete 校验。
- `.reference/DeepTutor/deeptutor/services/memory/consolidator/modes/update.py:1-16,150-337,363-530` — L2/L3 增量更新。
- `.reference/DeepTutor/deeptutor/services/memory/consolidator/references.py:125-213` — 引用池与证据渲染。
- `.reference/DeepTutor/deeptutor/services/memory/consolidator/runs.py:1-21,46-104,117-180` — 运行、取消、事件重放和 undo。
- `.reference/DeepTutor/deeptutor/services/memory/recall.py:1-21,142-220` — 无正文 recent/recent_queries。
- `.reference/DeepTutor/deeptutor/tools/builtin/__init__.py:784-915` — Agent read/write memory 工具契约。
- `.reference/DeepTutor/LICENSE:190-202`、`.reference/DeepTutor/pyproject.toml:1-20` — Apache-2.0 许可和项目元数据。
