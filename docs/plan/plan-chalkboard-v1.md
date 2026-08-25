# Chalkboard V1 OpenMAIC 迁移计划

> 文档状态：Accepted
> 适用分支：`feat/chalkboard-v1`
> 参考提交：OpenMAIC `1466a55eef9e31e229a0e2e60a0811020d7b06e2`

## 规则

- 旧迁移 worktree 只读参考，不整体合并、rebase 或批量 cherry-pick；
- 先确认固定 OpenMAIC 行为，再编写当前 Chalk 的最小接口；
- 每个垂直切片遵循 red -> green -> review；
- 测试通过公开 seam 验证行为，不测试私有实现；
- 数据库 migration 只从当前分支的 Drizzle 历史继续生成；
- Provider、Service、DAL、Route 和 Web client 保持当前架构边界。

## 阶段

### 1. Provider

按 [Provider 适配结构](../spec/chalkboard-v1-provider-architecture.md) 分能力迁移：

1. 从 OpenMAIC registry 提取 `providers.ts` 和 `types.ts`；
2. 建立能力 dispatcher，按 `providerId` 选择 adapter；
3. 按 OpenMAIC 的真实 provider matrix 逐个迁移 `adapters/`，先图片/视频已有 adapter，
   再拆分 TTS/ASR 集中实现中的 provider 函数；
4. 为每个 adapter 补 fake HTTP 协议测试、错误/超时/取消测试和必要的真实 smoke；
5. Provider 层稳定后，再接入 classroom media Service、asset storage、任务幂等和 worker。

### 2. 课堂运行时与持久化

先迁移 DSL、Stage fixture、cursor、Action runtime、白板和 renderer；再接 Chalk
API 的 classroom/document/runtime 持久化。用固定 Stage 验证加载、播放、恢复、
版本冲突、媒体失败降级和浏览器刷新。

### 3. 内容生成

按 outline -> content -> actions -> media 的顺序迁移生成服务。每个阶段独立持久化，
支持失败恢复、幂等重试和 DSL 校验。Prompt provenance 单独门禁。

### 4. 课堂讨论

先完成 scripted/fake discussion 的 SSE、cursor 保存恢复和 transcript 持久化；再
接入 Agent Runtime、Pi Director、ASR、讨论 TTS 和 live whiteboard Action。

## TDD seams

1. Provider adapter seam：能力输入、第三方 HTTP 请求、归一化结果和错误映射；
2. Media service：owner、幂等、asset/task 生命周期和 worker lease；
3. Chalkboard core：Stage validation、navigation、Action execution、snapshot；
4. Classroom persistence：save/load、版本冲突、恢复和 owner 隔离；
5. Web adapter：API response 到 runtime 的转换和媒体失败降级；
6. Discussion SSE：事件顺序、断线、abort、sequence 和恢复。

每个 seam 都按“一个失败行为测试 -> 最小实现 -> 通过 -> 下一行为”推进。没有经过
确认的公开 seam，不先写测试。

## 阶段完成门禁

- Provider：fake protocol tests 通过，密钥不进入响应/日志，真实 smoke 有记录；
- Runtime：固定 Stage 可播放，unsupported 场景明确失败；
- Persistence：刷新、API 重启、worker 重启后可恢复，owner 和版本冲突有测试；
- Generation：中途失败可恢复，输出通过 DSL 和 provenance 门禁；
- Discussion：scripted 和真实 Agent 都能保存/恢复 cursor，取消与失败可观察；
- 每阶段运行受影响的 typecheck、test、build，并记录未运行的真实凭证验证。

## 不在本计划

编辑器、Edit with AI、PBL、课堂导出、Beat/Checkpoint、几何 DSL、约束层和
`manim-web`。
