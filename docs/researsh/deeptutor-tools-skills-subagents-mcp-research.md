# DeepTutor Tools / Skills / Subagent / MCP 调研

> 参考目录：`.reference/DeepTutor`（当前 main）。以下路径均相对于该目录。

## 1. Tool 与 Prompt hints 组织

- `core/tool_protocol.py` 定义统一协议：`ToolParameter`、`ToolDefinition`（可携带原始 JSON Schema）、`ToolPromptHints`、`ToolResult`、`BaseTool`。Tool 实现只需 `get_definition()` 和异步 `execute()`；`deferred=True` 表示渐进披露。
- 底层实现按工具拆分文件（`tools/rag_tool.py`、`tools/reason.py` 等）；包装类和内建工具类型集中在 `tools/builtin/__init__.py`。包装类通过 `_PromptHintsMixin` 加载提示。
- 每个工具的模型使用说明单独存放在 `tools/prompting/hints/{en,zh}/{tool}.yaml`，字段包括 `short_description`、`when_to_use`、`input_format`、`guideline`、`note`、`phase`、`aliases`。`ToolPromptComposer` 统一渲染多种格式，避免 prompt 文案散落在执行代码中。
- `ToolRegistry` 维护注册、别名、启用过滤、OpenAI schema、prompt hints 和执行；`tools/builtin/__init__.py` 中的类型清单、可切换工具清单和别名是装配事实源。

## 2. 动态工具与调度

`runtime/registry/deferred_tools.py` 将 MCP/外部工具标记为 deferred，只在系统 prompt manifest 中列出名称和已清洗描述。模型先调用 `load_tools`，loader 校验 allowed 集合并把 schema 添加到当前 turn；已加载名称按 session 持久化。`core/agentic/tool_dispatch.py` 每轮最多 8 个并行调用，支持重复调用去重、参数缺失预检、rebinding 串行阶段、pause 工具末阶段执行，以及每个调用独立 trace。

## 3. Skills 与 Prompt

`services/skill/service.py` 将 skill 组织为 `<root>/<name>/SKILL.md` 加可选 `references/`，frontmatter 支持 `requires`、`always`。builtin 与 user 两层，user 可 shadow builtin。默认仅把一行 metadata manifest 注入系统提示，正文通过 `read_skill` 按需加载；`always: true` 才全文注入。正文上限 100k，外部导入有文件扩展名、大小、数量白名单和来源锁。

`agents/chat/prompt_blocks.py` 把 system prompt 拆成命名 `PromptBlock`（general、runtime_policy、loop、capabilities、tools、skills、sources、deferred 等），具体文案位于 `agents/chat/prompts/{en,zh}/agentic_chat.yaml`。提示明确：外部内容是数据非指令；必须先 `read_skill`/`load_tools`；工具名和参数逐字复制；失败不可伪装成功。

## 4. Subagent

`capabilities/subagent` 从选中的 `type: subagent` 知识库解析连接，以 `consult_subagent` 独占工具。能力层注入 backend kind、cwd/partner、预算、配置、图片和 session key；跨 turn 复用后端 session。`services/subagent` 为每个 CLI 后端单文件，共享 `process.py` 的 stdout/stderr 流式、取消清理和子进程终止原语，统一 `ConsultResult`/`SubagentEvent`。Partner 后端则在进程内调用伙伴 Agent。

## 5. MCP 与权限

`services/mcp/manager.py` 为每个 `(owner, server)` 管理独立连接任务和 AsyncExitStack，支持 lazy connect、配置 diff reload、失败退避、owner scope 上限和空闲淘汰。MCP adapter 保留原始 schema、转发进度事件、默认 deferred。`user_config.py` 将用户配置放在 sandbox 外，仅允许远程 SSE/HTTP，禁止 stdio，服务器数量和名称受限；`oauth.py` 实现 owner 隔离的 OAuth2.1 PKCE token/client 存储，非交互重连返回 `needs_auth`。网络层阻止 SSRF/private IP。

`multi_user/tool_access.py` 与 `grants.py` 提供 `enabled_tools`、`mcp_tools`、`cli_apps`、`exec_enabled` 白名单。管理员 `None` 表示无限；普通用户 MCP/CLI 缺省拒绝。工具列表、deferred loader、执行阶段都执行过滤；grant 禁止 secret/path/token/base_url 字段。

## 6. Memory 与恢复

普通 chat 使用 `read_memory`/`write_memory`；partner 使用独立 `partner_memory.py`，共享记忆只读，自有记忆可写。记忆服务持久化 L3 文档、trace、snapshot。Session manager 持久化消息；deferred loaded names、subagent session id 也跨轮保存。`pause_for_user` 让 ask_user 在同一 loop 等待并恢复。

## 7. 对 Chalk 的设计建议

1. 采用“每个 Tool 独立目录（实现 + `prompts.ts`）”模式；代码定义 schema/execute，prompt hints 独立版本化并可生成 system prompt、设置 UI 和文档。
2. 以 capability manifest 作为单一事实源（schema、effects、auth、timeout、deferred、owner），自动生成公开清单、实际注入 schema 和审计字段。
3. MCP 使用 deferred + `load_tools` 渐进披露，保留 owner 隔离、deny-by-default、SSRF/stdio 防护、描述清洗，并补输出大小限制和状态快照。
4. Subagent 保持通用 backend contract（stream events、session_id、budget、cancellation），几何等领域通过结构化 artifact 扩展，不耦合 executor。
5. Skill 仅 manifest 进 prompt，正文按需读取；支持 trusted source、版本/hash、requires 门控，用户 skill 不能覆盖系统策略。
6. 统一纯函数工具装配（toggle、条件自动挂载、capability owned、exclusive/forced/suppressed），并在 UI、registry、loader、execute 四层 fail-closed。
7. 为 tool/MCP/subagent 调用统一事件模型和幂等键，持久化 call/event 状态，实现断线恢复且避免重试副作用。

DeepTutor 的 Python 全局 registry 与文件系统存储不应直接复制到 Chalk；Chalk 应保留 owner-scoped runtime 和 DAL/数据库租户隔离，并避免把所有包装类堆在一个超大文件。
