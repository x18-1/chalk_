# Chalkboard V1 Provider

> 文档状态：Accepted
> 适用分支：`feat/chalkboard-v1`
> 参考来源：OpenMAIC 固定提交 `1466a55eef9e31e229a0e2e60a0811020d7b06e2`

## 能力

第一阶段迁移以下服务端第三方能力：

- TTS：文本转音频；
- ASR：课堂录音转文本；
- Image：根据 prompt 生成图片；
- Video：提交、轮询、取消和读取异步视频任务。

Provider 位于 `apps/api/src/providers/<capability>/`，具体采用注册表加 adapter 结构，
详见 [chalkboard-v1-provider-architecture.md](./chalkboard-v1-provider-architecture.md)。
Provider 不读取用户、Cookie、Fastify request、Drizzle 表或对象存储。

## 归一化结果

Provider 返回 Chalk 内部结果，不把上游 SDK 类型暴露给 Web：

- TTS 返回音频字节、格式和可选时长；
- ASR 返回文本和可选语言/置信度；
- Image 返回可保存的媒体结果或上游任务结果；
- Video 返回任务状态、Provider task id 和最终媒体结果。

媒体保存、任务状态、幂等、配额和 owner 校验由 API Service 与 DAL 负责。

## 安全与失败

- 用户凭据只由 API 的 credential/configuration 逻辑取得；
- 客户端不能覆盖受管 Provider 的凭据；
- 自定义 base URL 必须经过 SSRF 校验；
- Provider 错误转换为稳定的 Chalk 错误，不泄露密钥或原始请求；
- 超时、取消、可重试和不可重试必须显式区分；
- 所有媒体任务按 owner、classroom 和幂等键隔离。

浏览器原生 TTS/ASR 属于 Web 能力，不作为服务端 Provider 迁移。

## 当前实现矩阵

已接入 Chalk registry、adapter、HTTP Service 和 Web 配置界面的能力：

| 能力 | 已实现 Provider |
|---|---|
| TTS | OpenAI、Qwen、Azure、MiniMax、ElevenLabs、GLM（OpenAI-compatible）、Lemonade（OpenAI-compatible）、Doubao、VoxCPM（vLLM-Omni/Python API/Nano-vLLM） |
| ASR | OpenAI、Qwen、Azure、Lemonade（OpenAI-compatible） |
| Image | OpenAI、Qwen、Seedream、MiniMax、Grok、Nano Banana、ComfyUI、Lemonade |
| Video | HappyHorse、Grok、MiniMax、Seedance、Kling、Veo、Sora |

OpenMAIC 没有 VoxCPM ASR adapter；因此 ASR 不虚构 VoxCPM provider，浏览器原生能力也不列入服务端矩阵。

ComfyUI 的 workflow 文件由 API 从 `apps/api/workflows/comfyui/` 的安全文件名集合发现；
VoxCPM 的 backend 和 ComfyUI 的 workflowId 作为非敏感 settings 持久化，API key 仍单独加密。

当前矩阵表示 adapter、registry、HTTP Service、模型/能力配置和设置页内的媒体试用控件已接入，不表示媒体任务
持久化、对象存储资产或课堂黑板运行时已经完成。

模型选择由 API registry 的 `models` 和 `defaultModel` 驱动，设置页保存的 `settings.modelId` 会在请求未显式指定模型时生效。
目前已同步 OpenMAIC 中的版本化选择（例如 Seedream、Qwen Image、Seedance 的版本/别名）；Azure、Doubao、ComfyUI
等由区域、账号或 workflow 动态决定的 Provider 保持空模型目录，避免显示不可用的伪造选项。视频 Provider 同时公开
`aspectRatios`、`durations` 和 `resolutions`，API 会按所选 Provider 校验请求。

阿里云真实 smoke：

```bash
pnpm --filter @chalk/api smoke:media
```

命令需要 `DASHSCOPE_API_KEY`；ASR 还需要 `MEDIA_SMOKE_AUDIO_BASE64`，视频需要显式设置
`MEDIA_SMOKE_VIDEO=true`。没有凭据时命令以明确错误退出，不产生伪造的成功记录。
