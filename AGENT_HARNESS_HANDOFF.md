# Agent Harness Handoff

用中文。Default mode。不要把本文件加进 git。

## Workspace

- Branch: `feat/agent-harness-hardening`
- Worktree: `/home/xcodd/code/chalk_/.worktree/agent-harness`
- HEAD: `73fe661` `feat(web): restore thinking and tool history after reload`
- 远程: `origin` = `https://github.com/x18-1/chalk_.git`
- Upstream: 已设置。`origin/feat/agent-harness-hardening` 已包含到 `73fe661` 的全部提交。
- 工作区未提交：只有无关的 `pnpm-workspace.yaml`（`allowBuilds` 提示项）。**不要提交，不要 restore。**
- `.env` 有真实 `DEEPSEEK_API_KEY`。额度有限、不用轮换。不要写入代码/文档/提交/handoff，不要说教。

本地服务：

- API: `127.0.0.1:3001`
- Web: `*:3002`
- **不要动 3000**。Baize / 其他 worktree 可能在用。

## 当前状态

第一里程碑（可靠 harness）已收口，并已 push。

已提交、已 push 的关键提交：

| Commit | 内容 |
|---|---|
| `3d42a59` | runtime owner scope + MCP/tool 契约硬化 |
| `9e358b5` | 审批持久化，重启后 fail closed |
| `ce82b96` | 工具历史恢复 + 可恢复失败态 |
| `911c242` | stdio MCP 经 chat 组合，测试 fail closed |
| `127637f` | 浏览器工具审批/拒绝 E2E |
| `2a11516` | 浏览器 abort E2E |
| `9582eba` | 浏览器 steer E2E |
| `e5a2c46` | 浏览器 skill/tool enablement E2E |
| `f2083ab` | 浏览器模型切换 E2E |
| `43daae6` | compaction 保留原始 transcript |
| `25c494b` | 浏览器 compaction E2E |
| `33ed816` | thinking / tool result 写入 transcript 的契约测试 |
| `73fe661` | 刷新后恢复 thinking 和 tool 历史；真实 reload E2E |

已完成能力：

- 审批恢复：进程重启 / runtime 重建后，过期 `pending` 自动 reject，不静默通过
- stdio MCP：发现、调用、失败/超时/abort/凭据 URL 拒绝、清理
- abort / steer / approve-reject / skill enablement / tool enablement / model switching / compaction 都有浏览器 E2E
- Thinking / tool 历史：runtime 契约测试 + 真实 reload E2E + UI 打磨
- UI 展示完整原始历史；compaction 只压缩给模型的上下文，summary 不进气泡
- `docs/plan-chat-v1.md` 已勾：`Thinking 持久化：刷新页面后，thinking blocks 仍可展开`

不要回退这些架构：

- `GET /messages` → `session.getTranscript()`（原始历史）
- Runtime → `getMessages()`（compaction 后的 LLM 上下文）
- 创建 `Agent` 必须传 pi 的 `convertToLlm`；默认会滤掉 `compactionSummary`
- Thinking: `{ type: "thinking", thinking: string }`
- Tool call: `{ type: "toolCall", id, name, ... }`
- Tool result: `{ role: "toolResult", toolCallId, toolName, content, isError }`
- UI：`ThinkingDisclosure` / `ToolActivity` 在 `apps/web/src/app/chat/page.tsx`
- **不要拆 `page.tsx`**，不要做成第二套卡片

## 明天先做什么

用户上次倾向先收清单或开 Branch，还没拍板。明天开工先问一句，再动手。候选按优先级：

1. **勾已做清单 / 补进程重启测试**
   - `docs/plan-chat-v1.md` 恢复清单里，下面几项能力已有，但没勾：
     - 进程重启后打开历史，消息完整
     - 进程重启后继续聊，agent 有上下文
     - Compaction：数字过时（写的是 100 轮总结前 80 轮；现按 token 压，E2E 已绿）
     - 工具审批：重启 pending 超时 reject（`approval-recovery.ts` + 集成测试已做完）
   - 真缺口是「真杀 API 再打开」测试，不是功能本身。

2. **Branch：编辑重新生成**
   - 这是恢复清单里唯一真缺口。
   - UI / API / runtime 都没有 edit/branch。
   - pi session 本身支持 branch；产品层还没接。

3. 更大缺口，先别自动开做：
   - M10 可观测性页
   - 第二里程碑工具（Web Search / PDF / 计算）
   - 教学 eval

**不要做第二里程碑工具，除非用户明确说做。**

## plan 恢复清单对照

来源：`docs/plan-chat-v1.md`

| 项 | 实际状态 |
|---|---|
| 进程重启后打开历史，消息完整 | 已实现，没勾。缺「真杀 API 再打开」测试 |
| 进程重启后继续聊，agent 有上下文 | 同上 |
| Branch：编辑重新生成 | **唯一真缺口**。UI/API/runtime 都没有 edit/branch |
| Compaction：100 轮总结前 80 轮 | 能力有，数字过时。现按 token 压。E2E 已绿 |
| Thinking 持久化：刷新后 thinking 可展开 | 已实现，已勾 |
| 工具审批：重启 pending 超时 reject | 已做完，没勾 |

## 关键约束

- 全栈 TypeScript。Agent 运行时锁定 `@earendil-works/pi-agent-core`，不用 `^`。
- 数据访问层强制 owner 校验，认证异常 fail closed。
- 前端用 impeccable；后端用 Matt Pocock 风格工程 skill 集。
- 保持改动聚焦。不顺带重构、不升级依赖、不修无关 bug。
- 集成测试 dotenv 路径有空格 bug：`../../.env `，**不要顺手修**。
- `pnpm --filter ...` 会因 ignored builds 失败。包内测试直接跑 vitest。
- API 走 `@chalk/agent-runtime` 的 `dist/`。改 runtime 后必须：

```bash
cd packages/agent-runtime && npm run build
```

然后再重启 3001。

- 拉服务用 `setsid -f`，不要动 3000。
- 一个提交一个意图。不要 `git add .`。
- 不要提交 `pnpm-workspace.yaml`、`.env`。
- 不要把本 handoff 加进仓库。
- 提交信息用 Conventional Commits。
- 用户没要求时不要 push、不要开 PR。本次已经 push 过了。

## Playwright / 共享 DEV 用户

```bash
E2E_WEB_URL=http://localhost:3002 E2E_API_URL=http://localhost:3001 ./node_modules/.bin/playwright test tests/e2e/<spec> --workers=1
```

规则：

- `fullyParallel: false`，单 worker
- 共享 DEV 用户
- 结束必须 restore `defaultModel` / 删 fixture provider / 删自己的对话 / 恢复工具 approval
- 侧栏可能有别人的对话（`浏览器拒绝审批`、`新的数学问题` 等），只清自己 prefix 的残留
- 不要跑全量测试，除非用户要求

## 模块边界

- 可复用 Agent 能力放 `packages/agent-runtime`
- App adapter / composition root 放 `apps/api/src/agent`、`apps/api/src/modules`
- 浏览器只通过 HTTP/SSE 说话
- 不要为了这个分支再开一个 workspace package
- 不要预判最终 Agent / Chalkboard 依赖结构

## 第二里程碑（先不要做）

第一里程碑绿了之后才加：

- Web Search（引用 + 结果体积上限）
- 文件 / PDF 文本提取（MIME / size / page 限制）
- 确定性计算或验算
- Chalk 适配器：题目解析、提示规划

每个工具需要 TypeBox 参数、abort/timeout、审批分类、结果限长、密钥/PII 脱敏、单测 + 至少一条真实 Agent 路径测试。

## Observability / Eval（先不要做）

扩展现有 telemetry，不要另起一套 logger。默认不记录 prompt、工具参数、凭证、cookie、上传内容、学生标识。

Eval 先做确定性门禁，再做模型打分。软件正确性测试和教学质量 eval 分开。

## 完成标准（第一里程碑已基本满足）

```text
login -> configure/select model -> create conversation -> multi-turn stream
      -> use Skill -> call built-in tool -> call MCP tool
      -> require and resolve approval -> steer -> abort
      -> reload page/process -> recover durable history and fail closed
```

页面刷新恢复已有真实 E2E。进程重启恢复能力已有，但还缺「真杀 API 再打开」测试。

## 明天开场建议

先问用户选哪条：

1. 勾清单 + 补进程重启测试
2. 做 Branch（编辑重新生成）
3. 其他（M10 / 第二里程碑工具 / eval）

问完再改代码。
