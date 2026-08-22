# API 后端分层规范

> 文档状态：Accepted
> 实施状态：Implemented
> 适用范围：`apps/api`
> 最后核验：2026-08-22

## 1. 默认调用方向

```text
HTTP Request
    ↓
Route
    ↓
Service（一个或多个，按业务职责组织）
    ├── DAL / Repository
    ├── 第三方 API Provider（需要时）
    └── 其他基础设施（需要时）
             ↓
      Postgres / LLM / 音频 / 图片 / 视频 / PDF / Web Search / S3
```

Route、Service、API Schema、数据库 Schema 和 DAL 必须分开。Service 不是全局单例，也不限制每个业务模块只能有一个。

## 2. 推荐目录

后端按业务模块组织，模块内部再分层：

```text
apps/api/src/
├── modules/
│   └── <feature>/
│       ├── routes.ts
│       ├── schemas.ts
│       ├── services/
│       │   ├── <capability>.service.ts
│       │   └── ...           # 按职责增加，不按 Route 机械一一对应
│       ├── types.ts          # 仅在确有共享类型时
│       └── errors.ts         # 仅在有模块错误时
├── db/
│   ├── client.ts
│   ├── schema/               # Drizzle 持久化模型
│   └── dal/                  # SQL + owner 校验
├── agent/                    # API 对 Agent runtime 的组合与 adapter
├── auth/
├── http/
├── providers/                # 服务端第三方 API Provider 实现
│   ├── llm/
│   ├── tts/
│   ├── asr/
│   ├── image/
│   ├── video/
│   ├── pdf/
│   └── web-search/
├── storage/                  # 现有基础设施位置；后续可统一为 infrastructure/
├── app.ts                    # 应用组合根
└── server.ts                 # 进程入口与关闭
```

现有文件不为满足目录外观而一次性搬迁。新模块遵守该结构，旧模块在发生相关修改时逐步收敛。当前 `modules/chat/services/chat.service.ts` 保留一个内聚的 `ChatService`，不代表“一模块一个 Service”的规范；只有依赖、事务或修改原因实际分离时才继续拆分。

## 3. Route

Route 是 HTTP adapter，负责：

- 注册 method 和 path；
- 从认证模块取得当前用户；
- 使用模块 `schemas.ts` 解析 path、query 和 body；
- 调用一个明确的 Service 用例；
- 设置 HTTP 状态码、header 和流式响应；
- 将异常交给统一错误处理器。

Route 禁止：

- 直接导入 Drizzle table、数据库 client 或拼 SQL；
- 直接读写 session 文件；
- 编排多个 DAL 或第三方调用；
- 实现业务状态机或事务；
- 从客户端 body/query 接受 `ownerId` 作为权限依据。

目标形态：

```ts
const input = createConversationInput.parse(request.body);
const user = await auth.requireUser(request);
const conversation = await chatService.createConversation(user.id, input);
return reply.code(201).send({ conversation });
```

## 4. API Schema

每个业务模块的 HTTP 输入输出 schema 放在 `modules/<feature>/schemas.ts`，默认使用 Zod。

API Schema 负责：

- 请求与响应形状；
- 格式、范围、长度和可选性；
- 将外部不可信输入转换为内部 command；
- 公开数据的白名单投影，避免返回密钥或内部字段。

API Schema 不负责：

- 定义数据库列或 migration；
- 查询数据库；
- 表达仅属于 Agent tool 的参数协议。

TypeBox 只用于 Pi `AgentTool.parameters`。工具进入 Chalk 业务逻辑时，应转换成内部 command，并由 Zod 解析结构，再由 Service 验证业务约束。

## 5. Service

Service 表达应用用例，而不是数据库表的机械包装。它负责：

- 编排 DAL、第三方 Provider 和其他基础设施；
- 事务边界；
- 跨资源状态变化；
- 幂等、恢复、超时和失败策略；
- 将持久化行转换成业务或公开结果；
- 接受明确的 `userId`/`ownerId`，但不替代 DAL 的 owner 校验。

命名优先使用业务动作：

```text
createConversation
renameConversation
prepareUpload
confirmUpload
testMcpConnection
saveProviderCredential
```

一个业务模块可以有一个或多个 Service。数量由职责、依赖和事务边界决定：

- 相关用例共享相同依赖和修改原因时，可以放在同一个 Service；
- 依赖集合、事务边界、生命周期或修改原因明显不同时，拆成多个 Service；
- 不要求一个 Route、一个 endpoint 或一个数据库表对应一个 Service；
- Service 可以是 class、工厂函数或普通函数集合，不要求继承统一基类。

例如 Chat 模块增长后可以形成：

```text
modules/chat/services/
├── conversation.service.ts
├── message.service.ts
└── tool-approval.service.ts
```

这些文件仍属于 Chat 业务模块。默认不建立全局 `apps/api/src/services/`：按技术层统一堆放会把同一业务的 Route、Schema 和 Service 分散到多个顶层目录，降低修改和审查的局部性。

避免只提供通用 `create/update/delete` 并原样转发 DAL，也避免为了文件数量把一个连贯用例拆成多个只转发调用的 Service。

Service 不应依赖 Fastify request/reply，也不应在内部读取用户 Cookie。需要的用户、配置和 adapter 由调用方显式提供。

## 6. DAL / Repository

DAL 位于 `apps/api/src/db/dal`，负责：

- SQL、join、分页和持久化；
- 将数据库约束错误转换为稳定错误；
- 对所有用户业务数据强制 owner 校验；
- 缺少用户身份时抛出 `AuthRequiredError`；
- 资源不存在或不属于当前用户时 fail closed。

用户作用域方法的第一个参数必须是 `userId`：

```ts
conversations.getById(userId, conversationId)
attachments.confirm(userId, attachmentId)
```

owner 条件必须进入 SQL，不能只在 Route 或 Service 预检查：

```text
resource.id = requestedId
AND resource.user_id = userId
```

管理员查询必须使用明确命名的 admin 方法，并在 Route 和数据访问 seam 都有角色约束；不能通过省略 `userId` 获得全局查询。

## 7. Database Schema / Persistence Model

Drizzle table 定义位于 `apps/api/src/db/schema`，只描述：

- 表、列和数据库类型；
- 主键、外键和删除策略；
- 唯一约束和索引；
- 数据库级默认值。

它不承担 Service 或 API Schema 的职责。不要把 Drizzle row 当作长期公开接口；复杂模块应在 Service 或 mapper 中投影为稳定结果，避免表结构变化扩散到 Web 和 package。

为避免 `model` 一词歧义，文档和评审中使用：

- `API Schema`：Zod HTTP 契约；
- `Database Schema` 或 `Persistence Model`：Drizzle 表定义；
- `LLM Model`：模型供应商及模型标识。

## 8. 第三方 API Provider

Provider 只表示服务端对第三方远程 API 的接入。当前包括 LLM、TTS、ASR、图片、视频、PDF 处理和 Web Search：

```text
providers/
├── llm/
├── tts/
├── asr/
├── image/
├── video/
├── pdf/
└── web-search/
```

除 LLM 外，同一能力下每个供应商的入口实现放在独立文件中。例如，OpenAI TTS 和 OpenAI Image 分别属于 `tts/` 和 `image/`，不合并成一个跨能力的 `openai` 文件。实现变复杂时可以增加该 Provider 私有的辅助文件，但不能把多个供应商的实现混在同一个入口文件中。当前不为 Provider 新增 package。

LLM 是明确例外：统一使用 `@earendil-works/pi-ai` 已提供的 Provider、模型目录和调用协议，不在 Chalk 中为 OpenAI、Anthropic、DeepSeek 等供应商重复实现文件。`apps/api/src/providers/llm/` 负责把 Pi 的 LLM 能力与 Chalk 后端装配，包括用户凭据、自定义 Provider、模型选择和连接测试，并向普通业务 Service 与 `packages/agent-runtime` 提供同一套能力。

Provider 只负责第三方请求、参数转换、结果归一化以及供应商相关的超时、轮询和错误。课堂媒体生成、文件存储、任务状态、配额等业务编排仍放在对应 `modules/<feature>/services/` 中。Provider 不读取 Fastify request，不决定当前用户，也不绕过 DAL 读取用户数据。

用户凭据的保存、owner 校验和产品配置属于后端配置与数据访问逻辑，Service 取得经过授权的配置后再调用 Provider。原始密钥不得进入响应、日志或 telemetry。

浏览器原生 TTS/ASR 使用浏览器的 Web Speech API，不属于 `apps/api/src/providers/` 的后端 Provider。它可以作为产品配置中的客户端能力，但实际实现放在 Web 或浏览器侧运行时；后端接口必须拒绝把它当作服务端 Provider 调用。

`packages/agent-runtime` 负责 Agent loop、tools、compaction 等执行机制，并使用 API 注入的 Pi LLM 能力；它不拥有 Chalk 的用户凭据、模型选择、自定义 Provider 或 Provider 配置。普通业务 Service 的单次、结构化或流式 LLM 调用也复用同一套 Pi 能力，不另建第二套 LLM Provider。

`packages/chalkboard` 只产生课堂或媒体需求并消费结果，不直接持有后端凭据，也不依赖 `apps/api` 的源码路径。

`app.ts` 和 `server.ts` 只负责注册这些模块、连接依赖和管理生命周期，不直接实现第三方 API 调用。

## 9. 事务和错误

- 一个业务用例跨多次数据库写入且要求共同成功时，Service 定义事务边界，DAL 方法接受同一事务 client。
- Route 不捕获并重写所有异常；稳定业务错误由统一 HTTP error handler 映射。
- 外部供应商错误不得将密钥、原始请求或学生敏感内容直接返回前端。
- 解析、认证或 owner 校验失败时禁止提供默认身份、默认分数或猜测结果。

## 10. 当前迁移状态

已经完成：

- `configuration`：HTTP Schema 独立，模型/Provider 配置与 runtime 配置分别由两个 Service 负责；
- `mcp`：HTTP Schema、连接与生命周期编排、DAL 已分离；
- `auth`：登录和 session 持久化在 `AuthService`，Cookie/request 认证在 `AuthModule` adapter，Route 和 Schema 独立；
- `admin`、`telemetry`：Route 通过查询 Service 访问 DAL，telemetry 管理员校验同时在 Route 与 DAL 强制执行；
- `chat`：HTTP Schema 已独立，现有 `ChatService` 统一位于 `services/`；
- `uploads`：HTTP Schema、上传编排和对象存储 adapter 已分离；`UploadService` 编排 DAL 与对象存储，生产 S3 adapter 和集成测试 fake 实现同一接口。

当前没有已知 Route 仍直接编排 DAL 与第三方 API 或对象存储。后续按职责增长继续演进：

- Chat 后续只有在会话、消息运行或工具审批形成不同依赖和事务边界时才拆分多个 Service。

后续迁移继续保持行为和 HTTP contract 不变，先建立对应 seam 的测试，再移动职责；不把目录迁移与新功能或数据库 migration 混在同一个提交中。
