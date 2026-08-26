# 第三方集成边界

> 文档状态：Accepted
> 实施状态：Partial
> 适用范围：`apps/api`、`apps/web`、`packages/agent-runtime`、`packages/chalkboard`
> 最后核验：2026-08-22

## 1. 总原则

Provider 专指服务端对第三方远程 API 的接入。当前 Provider 能力包括 LLM、TTS、ASR、图片、视频、PDF 处理和 Web Search，统一放在：

```text
apps/api/src/providers/
├── llm/
├── tts/
├── asr/
├── image/
├── video/
├── pdf/
└── web-search/
```

除 LLM 外，同一能力下每个供应商的入口实现放在独立文件中；实现变复杂时可以增加该 Provider 私有的辅助文件。不同能力即使使用同一个供应商，也不合并成一个跨能力的供应商文件，因为它们的输入输出、错误和生命周期可能不同。

LLM 统一使用 `@earendil-works/pi-ai` 已提供的 Provider、模型目录和调用协议，不在 Chalk 中为各个 LLM 供应商重复实现文件。`apps/api/src/providers/llm/` 负责 Pi 与 Chalk 后端的装配，并向普通业务 Service 和 `packages/agent-runtime` 提供同一套 LLM 能力。

```text
Route → Service → Provider → 第三方 API
```

供应商 SDK 不应直接出现在 Route。Provider 只负责第三方请求、参数转换、结果归一化以及供应商相关的超时、轮询和错误；Service 负责产品业务流程、权限、配额、存储和任务状态。当前不为这些 Provider 新增 package。

MCP、S3/MinIO、JSONL、telemetry 等属于其他基础设施或运行时集成，不属于 Provider，继续放在各自的 `apps/api` 或 `packages/agent-runtime` 位置。

## 2. 当前归属

| 能力 | 实现位置 | Chalk 产品职责 |
|---|---|---|
| LLM Provider | `apps/api/src/providers/llm/` + `pi-ai` | 装配 Pi 模型目录、用户凭据、自定义 Provider 和模型选择，供 Service 与 Agent Runtime 共用 |
| Agent loop、tools、compaction | `packages/agent-runtime` | 使用 API 注入的 Pi LLM 能力，不管理 Chalk 用户凭据或 Provider 配置 |
| TTS / ASR / 图片 / 视频 / PDF / Web Search | `apps/api/src/providers/<capability>/` | 对应业务 Service 负责业务编排 |
| 浏览器原生 TTS / ASR | `apps/web` 或浏览器侧运行时 | 可出现在产品能力配置中，但不能由后端调用 |
| MCP 协议与 tool 转换 | `packages/agent-runtime` | MCP server CRUD、加密配置和 owner 校验在 `apps/api` |
| Session 接口与 JSONL adapter | `packages/agent-runtime` | session 路径选择和 conversation 映射由 `apps/api` 管理 |
| Agent telemetry | `packages/agent-runtime` | 用户/会话属性、持久化和管理员接口在 `apps/api` |
| LLM 凭据适配 | `apps/api/src/providers/llm/` | `DrizzleCredentialStore` 对接 Pi；它是 LLM 模块的内部 adapter，不是供应商 Provider |
| S3 / MinIO / OSS | `apps/api/src/storage/` | `UploadService` 负责编排，生产 S3 adapter 与测试 fake 实现同一对象存储接口 |
| Chalk 业务工具 | runtime 只提供 Tool 接口 | 工具实现和权限策略在 `apps/api` 或业务 package |
| 课件、播放、渲染 | 无 | `packages/chalkboard`，不进入 agent-runtime |

## 3. `packages/agent-runtime` 可以知道什么

允许依赖或表达：

- `@earendil-works/pi-agent-core`、`pi-ai`、`pi-telemetry`；
- Pi 模型调用所需的类型和执行接口，以及通用消息、工具和运行事件；
- MCP transport、连接、工具发现和调用；
- LLM 执行、approval、session、telemetry 等注入接口；
- 与 Chalk 业务无关的超时、取消、compaction 和错误分类。

禁止知道：

- Fastify request/reply；
- `auth_users`、`conversations` 等 Drizzle 表；
- Chalk 的角色、家长或学生权限；
- 用户 API key 的数据库列和加密密钥；
- Chalk 的模型选择、自定义 Provider 和 Provider 配置；
- S3 bucket、Web 页面或 Next.js 路由；
- Chalkboard、数学、学习证据等产品语义。

## 4. `apps/api` 负责什么

API 负责把当前用户和产品策略注入 runtime：

```text
Authenticated user
    ↓
apps/api Provider 配置、CredentialStore 和模型选择
    ↓
pi-ai Models / 已解析的模型调用能力
    ↓
普通业务 Service 或 packages/agent-runtime
```

API 必须拥有：

- 凭据的加密、解密和 owner 校验；
- Pi 模型目录、自定义 LLM Provider 和模型选择的应用级装配；
- 哪些工具启用、哪些操作需要审批；
- 哪个用户可访问哪个 conversation/session；
- 第三方配置的增删改查和安全投影；
- 选择哪个 Provider、何时调用以及调用结果如何进入产品流程；
- 外部调用的产品配额、审计和成本归属；
- 外部资源关闭、超时和进程退出清理。

## 5. Provider 与其他基础设施的实现

Provider 的接口应表达 Chalk 实际需要的能力，而不是完整复制供应商 SDK。不同 Provider 能力不共用一个 `generate` 接口：Pi LLM 的单次或流式调用、视频的异步任务、TTS 的音频结果和 PDF 的解析结果分别定义自己的输入输出。

Service 通过明确的依赖调用 Provider。供应商 Provider 不创建全局数据库客户端、不读取 Fastify request、不查询用户数据，也不保存 API key。LLM 目录中的 `DrizzleCredentialStore` 是 Pi `CredentialStore` 与 Chalk 数据库之间的内部 adapter，并不负责第三方请求。需要测试时，Service 可以注入受控的 fake Provider，Provider 自身通过 HTTP mock 或协议 fixture 验证供应商请求。

S3/MinIO、JSONL session repository、MCP client 等不是 Provider。它们仍按自己的职责放在 `apps/api/src/storage`、`packages/agent-runtime` 或对应模块中，不能因为都调用了第三方 SDK 就合并到 `providers/`。

上传模块在 `UploadService` 与对象存储之间定义窄接口；`apps/api/src/storage/s3.ts` 提供生产 adapter，HTTP 集成测试注入 fake。该接口只表达预签名上传、读取对象元数据和生成公开 URL，不暴露完整 S3 SDK。

## 6. 凭据与敏感数据

- 原始 API key 只允许在接收、加密和发起供应商调用的最短路径中出现。
- API 响应、日志、telemetry 和错误不得包含原始 key、Cookie、authorization header 或加密密钥。
- runtime package 不读取 Chalk 数据库中的加密列；API 内的凭据 adapter 负责 owner 约束并向 Pi 提供 credential 接口。
- 更新凭据后应关闭或刷新使用旧凭据的活动 runtime。
- 外部 URL、MCP env 和自定义 Provider 配置必须经过输入校验和安全投影。

## 7. MCP 特别规则

Agent Tool 的公共契约、执行限制、审批层级和错误分类见 [Agent Tools 规范](tools.md)。本节只定义 MCP 作为一种 Tool source 时的集成归属和资源生命周期。

```text
packages/agent-runtime:
  transport + connect + listTools/readResource + proxy execute + bounded reconnect + close

apps/api:
  user-owned configuration + encrypted env + enablement + approval + audit
```

MCP 连接失败必须显式失败，不能静默返回空工具集合并继续假装连接成功。stdio 子进程和网络连接必须在 runtime 关闭时释放。

stdio MCP 会启动 API 主机上的本地进程，因此只有管理员可以创建、查看、测试、修改和删除 stdio 配置；runtime 装配时也会再次校验 owner 角色，避免历史配置绕过路由限制。SSE/Streamable HTTP 配置仍按 owner 隔离。

SSE/Streamable HTTP 的 MCP URL 在 API 入口拒绝 localhost、私网、loopback、link-local 和其他保留地址；runtime 的自定义 fetch 会对每次请求再次做 DNS 解析检查，并禁用自动重定向。该策略降低 SSRF 风险，但部署环境仍应配置网络出口 ACL；DNS 解析与实际连接之间的竞态不能仅靠应用层完全消除。

MCP 的只读 tool 和 Resource 读取可以在连接失效后执行一次有限重连；写入 tool 不自动重试，避免重复副作用。MCP Resource 通过 API 的统一 `read_resource` facade 暴露，远端内容仍需 owner、媒体类型、大小和 snapshot 处理。

连接初始化会按 Server capabilities 发现 `tools/list` 和 `resources/list`，并消费 MCP 返回的 `nextCursor` 直到列表结束。MCP proxy 的 `search` 结果同时包含工具和 Resource；Resource 结果使用 `<server-id>/<resource-uri>` 作为 `read_resource` 的引用，不能直接把远端 URI 当作新的 Agent 工具。

## 8. Chalkboard 边界

`packages/chalkboard` 不直接调用 `apps/api/src/providers/`，也不持有第三方 API key。它负责产生课堂、图片、视频或语音需求，并消费后端返回的结果或媒体引用。

`packages/chalkboard` 可以在内部使用 `manim-web` 的渲染实现，但这属于渲染能力，不是第三方 API Provider；核心约束和 DSL 不得依赖渲染器对象模型。

如果 Chalkboard 需要 Agent 能力，只能依赖 `packages/agent-runtime` 的稳定公共接口；runtime 不得反向依赖 Chalkboard。

## 9. 新 Provider 检查清单

接入新的第三方 API Provider 前，必须回答：

1. 它属于哪个能力目录：`llm`、`tts`、`asr`、`image`、`video`、`pdf` 或 `web-search`？
2. 它是服务端 Provider，还是只能在浏览器运行的客户端能力？
3. 调用方真正需要的最小输入输出是什么？
4. 凭据由谁持有、加密、轮换和删除？
5. owner、角色、配额和审批在哪里强制执行？
6. 超时、取消、重试、轮询和幂等策略是什么？
7. 日志和 telemetry 如何脱敏？
8. 测试使用 fake、协议 fixture 还是真实 smoke？
9. 进程退出或配置更新时如何释放资源？
10. 供应商失败时是否 fail closed，许可证、版本和官方接口是否已核验？
