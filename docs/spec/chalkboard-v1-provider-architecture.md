# Chalkboard V1 Provider 适配结构

> 文档状态：Accepted
> 适用范围：Chalkboard V1 产品能力；实现跨 `feat/chalkboard-v1` 与 `feat/chalkboard-v2` 工程阶段
> 参考来源：OpenMAIC 固定提交 `1466a55eef9e31e229a0e2e60a0811020d7b06e2`

## 目标

第一阶段按 OpenMAIC 已验证的 Provider 注册与适配模式迁移 TTS、ASR、图片和视频。
配置、第三方协议和 Chalk 业务编排分开，避免把不同供应商或不同能力混在同一个文件中。

## 目录结构

```text
apps/api/src/providers/
├── llm/
├── tts/
│   ├── types.ts
│   ├── providers.ts       # Provider 配置、模型、默认值、能力声明
│   └── adapters/
│       ├── openai.ts      # 第三方协议适配
│       ├── qwen.ts
│       └── ...
├── asr/
│   ├── types.ts
│   ├── providers.ts
│   └── adapters/
├── image/
│   ├── types.ts
│   ├── providers.ts
│   └── adapters/
└── video/
    ├── types.ts
    ├── providers.ts
    └── adapters/
```

这里的 `providers.ts` 是能力级注册表，不保存用户密钥，也不发起请求。
`adapters/<provider>.ts` 是供应商协议实现；例如 `tts/adapters/qwen.ts` 只处理
Qwen TTS 的请求、响应、下载、轮询和供应商错误映射。

## 调用方向

```text
Route
  -> classroom media Service
    -> capability dispatcher
      -> selected adapter
        -> third-party API
```

Dispatcher 通过 `providerId` 选择注册表中的 adapter。Service 负责用户凭据、owner
校验、任务状态、幂等、媒体存储、配额和公开响应。Provider adapter 不读取 Fastify、DAL、
Drizzle 或对象存储。

## OpenMAIC 迁移对应关系

| Chalk 位置 | OpenMAIC 来源 | 迁移方式 |
|---|---|---|
| `tts/providers.ts` | `lib/audio/constants.ts` 中的 TTS registry | 提取配置，去掉浏览器和 UI 专属字段 |
| `tts/adapters/*` | `lib/audio/tts-providers.ts` 中各 provider 函数 | 按供应商拆分，保留协议行为，重写 Chalk 错误和输入输出 |
| `asr/providers.ts` | `lib/audio/constants.ts` 中的 ASR registry | 提取服务端能力和模型信息 |
| `asr/adapters/*` | `lib/audio/asr-providers.ts` 中各 provider 函数 | 按供应商拆分，保留 multipart/base64/polling 协议 |
| `image/providers.ts` | `lib/media/image-providers.ts` 中的 registry | 保留模型和尺寸能力 |

### 模型目录契约

每个媒体 Provider 配置包含 `models: Array<{ id: string; name: string }>` 和兼容保留的 `defaultModel` 字段。`defaultModel` 必须为空或存在于 `models` 中；前端设置保存的 `settings.modelId` 作为媒体请求未显式传入 `model` 时的回退值。Azure、Doubao、ComfyUI 等模型由区域、账号或 workflow 动态决定的 Provider 返回空 `models`，不伪造静态选项。
| `image/adapters/*` | `lib/media/adapters/*` | 优先逐文件迁移并补协议测试 |
| `video/providers.ts` | `lib/media/video-providers.ts` 中的 registry | 保留异步任务能力 |
| `video/adapters/*` | `lib/media/adapters/*` | 保留 submit/poll/download/cancel 差异 |

OpenMAIC 的 TTS/ASR 部分目前把多个 provider 函数集中在一个文件中；Chalk 会保留
其协议行为，但按当前后端架构拆到 `adapters/`，这是目录层面的适配，不是重新发明协议。

## 迁移限制

- 不复制 OpenMAIC 的 Next.js route、客户端 API key、usage storage 或 base64 HTTP 响应。
- 不把所有供应商统一成一个无差别的 `generate` 接口；视频的异步生命周期必须保留。
- 不把四种能力合并到 `providers/media/` 或跨能力的 `contracts.ts`。
- `types.ts` 只定义该能力真正需要的 Chalk 输入输出；API 请求 schema 仍位于对应
  `modules/<feature>/schemas.ts`，Drizzle 表仍位于 `db/schema/`。
- 供应商凭据由 API configuration/credential service 提供给 adapter，adapter 不保存密钥。
- Provider credential 可以同时保存加密 API key、可验证的 base URL 和非敏感 settings；
  settings 只能描述协议选择（例如 VoxCPM backend、ComfyUI workflowId），不能保存密钥。
