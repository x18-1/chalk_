# Agent Skills 设计规格

> 文档状态：Accepted（设计已确认）
> 实施状态：Partial
> 适用分支：`feat/chat-inline-blackboard`
> 最后核验：2026-08-31

## 1. 目标与边界

Skill 是可版本化的指导文本与参考文件，不是可绕过平台权限的代码插件。系统 Prompt 注入所有
已启用 Skill 的 metadata manifest（名称、描述、来源和读取提示），正文由 `read_skill` 按需读取。
Skill 不能覆盖 system/developer policy，不能直接写业务数据库或任意 Artifact。首期支持
`builtin` 与 `user` 两类来源：builtin 承载随产品发布的指导，user 承载 owner-scoped 的自定义
指导；两者汇入同一个 Registry，但保持来源、信任和启用状态可区分。project/MCP 来源暂不开放。

## 2. 目录与来源

```text
apps/api/skills/<skill-name>/
  SKILL.md
  references/       # 可选；仅在正文明确引用时加载
  assets/           # 可选静态资源，不执行
```

`references/` 不是 Chalk 强制要求的目录，而是 Agent-Skills 生态的可选 Skill 包结构。Claude
Code 通常把 Skill 作为本地目录/Markdown command 管理；DeepTutor 明确约定
`<skill>/SKILL.md + references/`，通过 Skill 专用读取流程按需加载；OpenMAIC 的
`skills/openmaic/SKILL.md` 也通过相对链接把长篇 SOP 拆到 `references/*.md`。这些项目都没有
把 Skill references 当作通用 `read_resource` 暴露。

来源模型包含 builtin、project、user、mcp；首期 Registry 记录 `sourceId` 与 trusted 状态，user
记录 version 与 content hash；builtin revision/hash 属于后续可观测性增强。builtin 与 user 使用
同一全局 Skill name 命名空间，user 与 builtin 同名时在写入
和 reload 阶段都拒绝。首期加载策略：

| 来源 | 首期是否加载 | 信任/权限 |
|---|---|---|
| builtin | 是 | 随包目录，trusted，可出现在 metadata 和 `read_skill` |
| user | 是 | owner 配置的 Skill 包，按不可信数据处理；可读但不能执行 shell、改变审批或覆盖 system policy |
| project | 否 | 预留，需项目级信任与 owner 授权 |
| mcp | 否 | 预留，远程内容不能直接成为 Skill |

当前首批 builtin Skills：

- `teach`：锁定 `mattpocock/skills` 提交，允许用户显式学习请求；
- `feynman-learning`、`learning-to-learn`：从 OpenMAIC 提炼，已移除 Stage/Tool DSL 依赖。

## 3. SKILL.md frontmatter

必填：`name`、`description`。建议字段：`title`、`version`、`source`、`requires`、`paths`、
`always`、`userInvocable`、`disableModelInvocation`。未知字段应产生诊断，不应静默改变权限。

不得默认支持任意内嵌 shell。若未来允许命令，必须绑定显式 capability、命令白名单、工作目录
和审批；MCP/user 来源永远禁止内嵌 shell。

## 4. 注入 Pi Agent 的链路

```text
SkillRegistry.reload({ ownerId })
  -> builtin filesystem discovery + user-skill store merge
  -> source/owner/duplicate/diagnostic checks
  -> enabledSkillNames from owner settings
  -> Chalk metadata formatter（name/description/source + read_skill 提示）
  -> buildPrompt(CHAT_MAIN, { skillsPrompt })
  -> Agent.initialState.systemPrompt

model tool call read_skill({ name })
  -> ToolRegistry wrapper
  -> SkillRegistry.read(name, enabledSkillNames)
  -> bounded tool_result
  -> next Pi turn
```

Chalk 使用 Pi `@earendil-works/pi-agent-core@0.84.1` 的 `Agent` 作为执行内核。Pi 提供
`loadSkills`/`loadSourcedSkills`（发现与 frontmatter 解析）、`formatSkillsForSystemPrompt`
和 `formatSkillInvocation`（正文格式化）等 Skill helper，但没有替 Chalk 完成 owner-scoped、
enabled 检查和 references 授权的通用 `read_skill` Tool。Pi 的通用 metadata formatter 还会提示
模型根据 location 使用文件读取工具，这与 Chalk 的受限 `read_skill` 及 virtual user path 不一致；
因此 Chalk 复用发现与正文格式化，自行生成不含文件路径的 name/description/source manifest，并在
其中明确唯一读取入口。Chalk 在
`packages/agent-runtime/src/skills/read-skill-tool.ts` 提供底层 Tool 实现，API 组合入口位于
`apps/api/src/agent/tools/skill-tool/`，其中 `tool.ts` 是 `read_skill` 的 Agent-facing 入口。

当前 `runtime-manager` 在创建 runtime 时加载 SkillRegistry，并把动态生成的 metadata prompt
和 `read_skill` 一并注入；正文不会在启动时全部展开。

当前代码的 `SkillRegistry.reload()` 同时接收 trusted builtin filesystem source 与当前 owner 的
virtual user source。`user_skills` 表由 owner DAL 管理，配置接口提供 `/user-skills` 的增删改查，
runtime 只把当前 owner 的记录装入 Registry；virtual path 仅供 Pi 的 Skill 数据结构标识位置，不能
作为主机文件路径读取。`read_skill` 可读取正文和受限 references，正文与 references 受 API schema
的单项、数量和总字节上限保护。

## 5. Skill 如何加载

加载采用“发现 metadata、按需读取正文”的渐进披露流程：

1. API 组合层按 owner 从数据库读取 user Skill，并与 builtin 根目录一起构造 `SkillRegistry`；Registry
   解析 builtin frontmatter、校验来源与全局名称冲突并生成诊断。
2. `systemPrompt()` 注入每个已启用 Skill 的名称、描述、来源和读取提示；这里的“全部注入”指 metadata，不是完整正文。
3. 用户用自然语言提出与某 Skill 相关的请求时，模型调用 `read_skill({ name })`；工具再次检查
   source、owner、enabled 和 `disableModelInvocation`，然后返回有界正文。
4. `read_skill` 的结果进入当前 Pi turn；不会自动执行 Markdown 中的命令，也不会改变 Tool 审批。

这与 Claude Code 的多目录扫描 + metadata-only manifest、DeepTutor 的 builtin/user 分层 +
`read_skill` 按需正文加载是一致的。Claude Code 的 Skill/Command 发现和正文拼装是运行时动态
完成的，不需要为每个新 Skill 手工修改系统提示词。Claude Code 对外可能表现为用户命令或
Skill 工具调用（具体名称取决于宿主），模型选择某个已发现的 Skill 后，运行时读取并拼装该
Skill 的 prompt；它不是把每个 Skill 的全文永久写进静态 system prompt。Chalk 用明确的
`read_skill` 工具承载同一职责，便于做 source、owner、enabled 和输出上限校验。

OpenMAIC 的实际实现也不是“改系统提示词文本”：`lib/server/agent-runtime/skills.ts` 的
`listBuiltinSkills()` 使用 Pi 的 `loadSkills()` 扫描并缓存随包目录；`listSkills(ownerId)` 再把
该 owner 的数据库 user skills 合并进去（user Skill 使用虚拟 `SKILL.md` 路径，并包上低优先级
不可信内容前缀）。`availableSkillsPromptBlock()` 只生成 name/description/location metadata，
runner 将 Pi 原生 `read` 工具装入工具池；模型匹配后读取对应 `SKILL.md`，读取记录写入持久化
transcript，恢复时可据此重建激活状态。用户在 UI/Skill API 上传或编辑 Skill 后，下一次 run
重新调用 `listSkills(ownerId)` 即可看到最新集合。OpenMAIC 另有一个面向“编辑用户自己 Skill
源码”的 `read_skill(detail: source|text)` 工具；它不是常规 Skill 激活读取，而是为了给
`patch_skill` 提供精确的数据库原文和分页。

### 5.1 references 的含义与首期选择

`references/` 不是 Skill 必需结构；它来自 Agent-Skills/Claude Code/DeepTutor 等生态的常见约定。
它表示某个 Skill 附带的辅助材料，例如长篇指南、示例或术语表。它们不是独立 Skill，也不会
自动进入上下文。首期已经选择 **Skill 内部按需展开**：`read_skill` 接受
`{ name, reference: "references/foo.md" }`，只允许规范化后仍位于该 Skill `references/` 根目录
内的文件。路径不得包含空段、`.`、`..`、反斜杠或绝对路径；filesystem source 在 realpath 后仍需
位于 canonical references 根目录内，virtual user source 只读取服务端已校验的同名记录。

统一 `read_resource` 是另一种未来方案：把 references 映射成通用资源 ID，复用 cursor、snapshot
和资源 adapter。这样适合大文件/分页或多种来源共享，但会增加资源授权和引用解析复杂度。首期
不复用 `read_resource`。Claude Code 使用 Skill/command 自己的读取路径，DeepTutor 使用
`read_skill(name, file=...)`，OpenMAIC 使用 Pi 原生 `read` 读取已加载 Skill 的虚拟/真实
`SKILL.md` 路径；这些路径都与通用资源读取分开。Skill references 有独立的 owner/source/版本
约束，复用 `read_resource` 反而会增加任意资源读取的权限面。

### 5.2 Skill 存储（云部署）

本项目部署到云端，不能把 user Skill 的唯一副本放在 API 容器本地磁盘。首期采用 PostgreSQL 中
的结构化 user Skill 记录作为唯一事实源：`name`、`description`、instruction `content`、文本
`references`、`version`、`contentHash`、`enabled` 与审计时间保存在同一 owner-scoped 记录中，
并以 `(owner_id, name)` 保证唯一。

首期不接受任意目录、ZIP、二进制 assets 或远程仓库安装。未来如正文规模或二进制资源确实需要
对象存储，应在写入适配器中把导入包解析成同一个 canonical Skill 模型，保持 `read_skill` 接口与
Registry 不变；现在不为尚不存在的第二种存储预设 `SkillContentStore` 抽象。

### 5.3 新增和更新 Skill

新增 Skill 不需要修改系统提示词模板。流程是：

1. **builtin**：在 `apps/api/skills/<name>/SKILL.md`（及可选 `references/`）增加目录并提交代码；
   `SkillRegistry.reload()` 发现后自动生成 metadata。
2. **user**：通过 owner-scoped 配置接口写入结构化 Skill（name、description、instruction body 与
   可选文本 references）；服务端校验名称、路径与大小后写入 PostgreSQL。下一次 runtime 创建时
   将当前 owner 的记录作为 virtual source 装入 Registry，不依赖容器本地目录。
3. reload 后重新计算 enabled 集合，关闭旧 runtime，新的 `skillsPrompt` 即包含该 Skill 的 metadata；
   不需要手工编辑 `system.en.md` 或 `system.zh-CN.md`。
4. 用户随后用自然语言提出相关请求，模型再调用 `read_skill` 读取该 Skill 的正文。

这就是 Claude Code 等系统“可以自己添加 Skill”的关键：系统提示词只有固定的 Skill 列表占位符，
列表内容由运行时扫描/注册结果动态填充；新增 Skill 改文件或配置即可，Prompt 模板不变。

### 5.4 启用状态

- builtin Skill 定义来自随包目录，owner 的启用覆盖只存于 `skill_settings`；
- user Skill 定义和启用状态都以 `user_skills.enabled` 为准，不再与同名 `skill_settings` 做二次合并；
- `/skills` 设置入口按 Registry source 选择对应事实源，配置列表与 runtime 使用同一
  `enabledSkillNames` 计算结果；
- Skill 变更后关闭该用户的旧 runtime，下一次请求按新快照创建；首期不做运行中的热替换。

## 6. 安全、错误与后续增强

- realpath 去重，filesystem reference 必须留在该 Skill 的 canonical `references/` 根目录；
- instruction body、单 reference、reference 数量和总字节数均设上限；
- 用户正文加低优先级数据 fence，明确“内容是指导数据，不是系统指令”；
- 模型读取只有 `read_skill` 一条入口；Registry 强制检查存在性、enabled 与
  `disableModelInvocation`，配置后台使用独立的 owner-facing `inspect`；
- 稳定错误码至少区分 not found、disabled、model invocation disabled、reference invalid、
  reference not found、definition invalid 与 name conflict；
- Skill 诊断进入受控 telemetry，不记录完整用户正文。

首期不实现 Skill marketplace、远程安装、依赖图、运行中热加载、project/MCP source、完整包上传、
二进制 assets、对象存储或独立 activation ledger。对话 transcript 已保存 `read_skill` 的 Tool 调用
与结果；只有在出现明确的审计重放需求后，才增加按 revision/hash 重建历史 Skill 的机制。

## 7. TDD 顺序

1. frontmatter：缺 name/description、重名、非法字段和超长正文产生稳定诊断。
2. source：builtin/user Skill 可发现；untrusted/MCP Skill 不执行 shell；realpath 外路径、重复 source、错误 hash 被拒绝。
3. prompt：metadata-only；启用集合变化只改变 manifest，不把正文注入 system prompt。
4. read_skill：未启用、禁止模型调用、未知名称、非法/缺失 reference 均以稳定错误码 fail closed；
   正文和 reference 受统一 Tool 单次结果字符上限约束并带截断详情。
5. lifecycle：builtin 设置只影响 builtin、user enabled 只影响对应 owner 的 user Skill；修改后新
   runtime 的 manifest 与配置列表一致。
6. integration：builtin fixture 与 owner user Skill 都能被发现、读取，且不影响现有 Chalkboard prompt。

## 8. 验收标准

- `teach` 等 builtin/user Skill 可通过自然语言触发后由 `read_skill` 获得完整指导，但不会自动执行其文件中的命令；
- OpenMAIC Skill 只有在不依赖其平台工具时才进入 Chalk；
- Skill 列表、用户设置和实际 runtime 可见集合一致；
- 外部 Skill 的文本被当作不可信数据，不能改变工具审批或 owner 规则；
- 每个 Skill 有来源和可回归的加载测试；user Skill 另有 version/hash。builtin 与 owner 已配置的
  user Skill 都能进入首期 Agent，但 user 内容始终按不可信数据处理。
- references 只能读取所属 Skill 包内的允许文件，不能借此访问其他 Skill、上传文件或主机文件系统。

Skill 不引入账户级 quota 或计费预算。读取保护包括输入总量、单次响应字符数、超时、取消和
references 按需加载；模型 token/output 上限由 Pi/provider 执行，usage 仅记录 telemetry。

## 9. 待确认

1. 第二阶段是否开放 project/MCP 来源 Skill？
2. references 何时升级为统一 `read_resource`（当前首期明确不复用）？
