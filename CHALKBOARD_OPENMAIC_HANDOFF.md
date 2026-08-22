# Chalkboard / OpenMAIC V1 迁移 Handoff

> 文档状态：Historical
> 文档类型：Branch handoff
> 适用分支：`feat/chalkboard-openmaic-migration`
> 最后核验：2026-08-22
> 说明：本文记录特定 worktree 的暂停快照，不定义主分支当前架构、数据库或测试规范。主项目规范见 `docs/README.md`。
>
> 暂停快照：2026-08-13
>
> 当前状态：**V1 主体实现已进入收口验收阶段，但尚未达到正式完成标准。**
> 本文替代此前 geometry-first handoff。恢复工作时，应先阅读本文和
> `docs/plan-chalkboard-openmaic-v1.md`，不要按旧版几何纵向切片继续开发。

## 1. 一页摘要

Chalkboard 的版本顺序已经确认：

1. **V1：迁移 OpenMAIC 白板课堂。**
2. **V2：引入 Chalk 自己的 Beat、XState 和教学语义。**
3. **V3：加入数学/几何能力、几何 DSL、约束层和 manim-web adapter。**

V1 当前已经覆盖 `slide + interactive + quiz`、除 PBL 外的全部课堂 Action、
白板、播放控制、讨论/插话、Quiz、TTS/ASR/图像/视频 API、持久化恢复、真实
HTTP/Postgres/worker/MinIO 流程和 OpenMAIC prompt provenance 门禁。

当前不能宣布 V1 完成，主要原因是：

- 真实 Agent Runtime 尚未成功完成一次云端课堂回合；
- OpenAI TTS/ASR/Image 和 Google Veo 的真实 Provider smoke 尚未全部成功；
- 完整 OpenMAIC 原站浏览器 trace 与 Chalk 浏览器 trace 的双边对照证据仍不足；
- authored 白板的五类中间 DOM 状态和 unsupported UI 负例还应补强。

可以把当前状态理解为：

```text
功能代码：约 90%
V1 发布验收：约 75%–80%
15 条完成标准：10 条基本完成，3 条部分完成，2 条受真实凭证阻塞
```

这些百分比只是交接用的粗略表达，正式完成仍以第 11 节的 15 条标准逐项取证为准。

## 2. 固定工作区与来源

```text
Branch:
feat/chalkboard-openmaic-migration

Worktree:
/home/xcodd/code/chalk_/.worktree/chalkboard-openmaic

当前基线提交（迁移成果尚未提交）：
0706be47125c95dea1fc9da5ec8bd138f0c590d9

OpenMAIC reference repository:
/home/xcodd/code/chalk_/.reference/OpenMAIC

OpenMAIC pinned commit:
1466a55eef9e31e229a0e2e60a0811020d7b06e2
```

2026-08-13 已重新确认 reference checkout 正好位于上述完整 commit。

主要入口：

```text
V1 实施计划：
docs/plan-chalkboard-openmaic-v1.md

Chalkboard compat package：
packages/chalkboard/src/compat/openmaic/

React renderer/runtime：
packages/chalkboard/src/react/

课堂 Web 页面：
apps/web/src/app/chalkboard/

课堂 API：
apps/api/src/modules/classrooms/

课堂媒体 API/worker：
apps/api/src/modules/classroom-media/

Quiz API：
apps/api/src/modules/quiz/

固定 Stage fixture 与 compatibility tests：
packages/chalkboard/tests/fixtures/openmaic-v1/
packages/chalkboard/tests/compatibility/openmaic-v1/

浏览器 E2E：
tests/e2e/chalkboard-openmaic.spec.ts
tests/e2e/chalkboard-real-http.spec.ts
```

相关调研/证据文档：

```text
docs/researsh/openmaic-classroom-gap-report.md
docs/researsh/openmaic-golden-trace.md
docs/researsh/openmaic-quiz-interactive-gap-report.md
docs/researsh/openmaic-renderer-migration-baseline.md
docs/legal/
```

## 3. 不得偏离的产品与技术决定

### V1 范围

- 迁移 `slide`、`interactive`、`quiz` Scene。
- PBL 不迁移，必须返回明确的 `UNSUPPORTED_SCENE_TYPE`，不得静默空白。
- 尽量完整迁移固定 OpenMAIC commit 的白板课堂能力。
- 接入 authored/live TTS、学生 ASR、图像、异步视频和 Quiz grading API。
- 全栈 TypeScript。
- Postgres + Drizzle。
- owner-scoped DAL；认证异常 fail closed，禁止默认身份回退。

### V1 禁止提前加入

- Beat / Checkpoint 作为新的主课堂模型；
- XState 重写；
- manim-web；
- 几何 DSL、几何约束图或几何插件接口；
- PBL；
- 一边迁移一边重新设计 OpenMAIC 课堂语义。

### Prompt 是字节级兼容资产

以下路径不可随意编辑：

```text
apps/api/src/modules/classrooms/prompts/**
```

OpenMAIC 提示词必须从固定 commit 原样复制：

- 不翻译；
- 不润色；
- 不裁剪；
- 不重排；
- 不格式化；
- 不 `trim`；
- 不用“语义等价”的新文本重新拼接。

Chalk 自有逻辑放在 prompt 外。任何必要的 prompt 变化都必须先由用户明确确认，并作为
后续版本的显式产品决定处理，不能混入 V1 迁移。

当前 prompt 门禁记录：

```text
73/73 passed
```

## 4. 当前架构边界

```text
OpenMAIC-compatible Stage
  -> @chalk/chalkboard DSL validation / normalization
  -> classroom controller + playback cursor
  -> Action runtime
       -> slide/whiteboard state
       -> reactive spotlight/laser effects
       -> interactive widget adapter
       -> media adapter
  -> React classroom renderer
  -> apps/web /chalkboard

apps/web
  -> authenticated classroom HTTP API
  -> apps/api owner-scoped DAL
  -> Postgres / Drizzle
  -> classroom discussion runner / Agent Runtime
  -> media provider adapters
  -> Postgres-backed media worker
  -> S3-compatible object storage
```

`@chalk/chalkboard` 不直接依赖 Fastify、Drizzle、S3 或 Provider SDK。生产实现位于
`apps/api`，测试可以注入受控 adapter。

## 5. 已实现能力

### 5.1 Stage、Scene、Action 和播放

已经实现：

- Stage schema、版本、校验、normalize 和 compatibility fixture；
- `slide + interactive + quiz`；
- PBL 结构化拒绝；
- `Stage -> Scene -> Action` 顺序执行；
- play、pause、resume、previous、next、jump、restart、complete；
- Scene/Action 游标持久化；
- 中途 Action 游标精确刷新恢复；
- jump/restart 后 authored 状态重建；
- 课堂完成页和重新开始。

固定 fixture 覆盖 5 个 Scene、29 个 authored Action 和 30 个 timeline segment
（包含隐式 `wb_open`）。

### 5.2 Slide、白板和视觉效果

已迁移的 Action：

```text
spotlight
laser
speech
play_video
discussion

wb_open
wb_close
wb_clear
wb_delete
wb_draw_text
wb_draw_shape
wb_draw_chart
wb_draw_latex
wb_draw_table
wb_draw_line
wb_draw_code
wb_edit_code

widget_highlight
widget_setState
widget_annotation
widget_reveal
```

白板 authored Action 和 live Agent Action 共用同一套状态和命令入口。已覆盖：

- 文本、形状、图表、LaTeX、表格、线条和代码元素；
- 四种 code edit；
- delete、clear、close；
- 隐式打开白板；
- 无效 target 的结构化错误；
- 白板 snapshot、重建和刷新恢复；
- live Agent ledger 与冲突反馈；
- Action completion barrier。

Spotlight/Laser 已真正接入浏览器，而非只写入内存 effect：

```text
OpenMaicActionRuntime
  -> ReactiveEffectAdapter
  -> useSyncExternalStore
  -> SlideCanvas.effects
```

现有浏览器证据覆盖：效果出现、5 秒自动清理、Scene 切换清理、restart 后重现、
导航/取消后不残留。

### 5.3 Authored speech 与媒体播放

已实现：

```text
audioUrl 存在
  -> 直接播放，不请求 TTS

没有 audioUrl
  -> 优先使用 audioId 作为幂等键
  -> 否则使用 action.id
  -> 请求 TTS
```

音频生成或播放失败时：

- UI 显示真实语音不可用；
- authored Action 时间线不失败；
- 学生仍可阅读文字并继续课堂。

视频 Action 已覆盖播放、暂停、恢复和自然结束。

### 5.4 Interactive

已经实现：

- URL 与 Stage 内嵌 HTML iframe；
- 稳定 iframe pool/host；
- Scene 切换和播放层 remount 不销毁 iframe document；
- iframe 内用户状态保持；
- active-safe LRU 和 owner claim/release；
- sandbox 不包含 `allow-same-origin`；
- runtime/resource error 捕获与 replay；
- 显式 reload；
- 四种 `widget_*` Action；
- ordered postMessage、timeout、stale/dispose/failure 处理；
- widget 状态恢复。

Playwright 已证明 iframe DOM identity 和学生在 iframe 内输入的状态跨 Scene 切换保持。

### 5.5 Quiz

已经实现：

- 单选、多选、简答；
- 完整作答门禁；
- 确定性题型本地判定；
- 简答 grading API；
- 失败不伪造默认分数；
- durable attempt；
- CAS、retry lineage 和 writer ordering；
- legacy recovery journal 迁移；
- submit/review/retry；
- 刷新后恢复答题和评分结果。

真实 HTTP E2E 已覆盖 Quiz 提交、评分结果持久化和刷新恢复，但评分模型仍使用受控
E2E adapter；真实云端 grading 属于 Provider 发布门禁。

### 5.6 Discussion、插话和 Agent 课堂

已经实现：

- proactive discussion；
- 学生文本插话；
- 学生录音 + ASR；
- 插话前 lecture cursor 保存；
- 讨论结束回到正确游标；
- idle 插话不伪造 lecture cursor；
- transcript 持久化及单调 sequence；
- teacher/assistant/student role；
- 固定 OpenMAIC 的六个默认 persona；
- Pi director、终止工具和 roundtable；
- live Agent TTS；
- live Agent 白板 Action；
- SSE discussion lifecycle；
- refresh/restart/abort。

SSE 客户端顺序语义为：

```text
consume SSE event
  -> await local Action handler
  -> await OpenMaicActionRuntime.execute(...)
  -> consume next event
```

测试已证明 live whiteboard Action 最大并发为 1，前一个 Action 未完成时不会消费下一
Action 或 `discussion_finished`。

固定 OpenMAIC 和 Chalk 当前都没有 browser-to-server DOM Action acknowledgment。
`discussion_finished` 表示 server-side Agent/discussion 已完成，不是 DOM receipt；不要把
新增 ack 误认为 V1 缺失的上游能力。

### 5.7 多实例 discussion lease

活动 discussion 使用 owner-scoped Postgres durable lease：

```text
lease duration: 60 seconds
renew interval: 20 seconds
lease owner fencing
two API instances mutually exclusive
cross-instance abort through Postgres
expired lease takeover
initialization failure releases lease
SSE finishes after lease release
idle abort atomically finalizes the session
```

进程内 `Map` 只做同实例快速拒绝。跨实例正确性由 Postgres 条件更新和 owner fencing
保证。进程持有 lease 后直接崩溃时，其他实例最长需要等待 60 秒到期，这是当前明确边界。

### 5.8 课堂媒体 API

生产接口/adapter 已接入：

- authored TTS；
- live Agent TTS；
- ASR；
- OpenAI image generation；
- Google Veo async video；
- media task status、retry、cancel、restore；
- Postgres-backed worker；
- S3-compatible object storage；
- owner-scoped media task/asset DAL；
- 幂等任务和重启恢复；
- 远程资源安全抓取；
- provider capability 描述。

`/media/capabilities` 只陈述配置事实：

```text
not_configured = 没有凭证
unverified     = 有凭证，但没有通过该请求进行外网连通探测
```

不能把 `configured` 或 `unverified` 写成 Provider 已真实可用。

视频 poster 合同：

```text
生成中：pending
Veo 未返回 poster：unavailable / provider_did_not_return_poster
失败或取消：unavailable / task_not_completed
```

不创建虚假 poster asset；Stage authored poster 仅作为 fallback。

固定 OpenMAIC 的 Veo 能力矩阵只支持 8 秒。Chalk 已在 API 持久化前和 worker 提交前
将缺失或不受支持的时长规范化为 8 秒，历史 6 秒任务也按 8 秒提交；authored prompt
字节保持不变。

### 5.9 数据、认证和恢复

已经接入：

- Postgres + Drizzle；
- owner-scoped classroom、discussion、media、Quiz DAL；
- 认证异常 fail closed；
- 真实登录 Cookie；
- classroom cursor/snapshot；
- discussion/transcript；
- media tasks/assets；
- Quiz attempt；
- worker queue 状态；
- S3/MinIO 对象存储。

真实 HTTP E2E 已经走过浏览器、登录 Cookie、Fastify、owner-scoped DAL、Postgres、
media worker、MinIO、Interactive、Quiz、ASR、discussion SSE、live TTS、live 白板和刷新恢复。
外部 Provider 在该 E2E 中是受控 adapter，因此不能据此声称真实云端 Provider 已通过。

## 6. 最近一次完整验证记录

以下是暂停前的最近一次完整执行记录，不是本次 handoff 编辑后重新运行的结果：

```text
DATABASE_URL='postgresql://chalk:chalk@127.0.0.1:5432/chalk_openmaic_test' pnpm test

@chalk/agent-runtime: 13 passed
@chalk/chalkboard:     276 passed
@chalk/api:            173 passed, 5 skipped
```

5 个 skip 是需要显式环境变量/真实凭证的 Agent/Provider smoke，不是普通测试失败。

其他最近记录：

```text
pnpm typecheck
passed

pnpm build
passed

Prompt provenance
73/73 passed

Fixture/golden verifier
verified 5 scenes, 29 actions, 30 timeline segments

生产构建上的 mock Playwright classroom E2E
1 passed (39.2s)

真实 HTTP/Postgres/worker/MinIO classroom E2E
1 passed (36.2s)
```

根级 `pnpm test` 已在 `turbo.json` 中配置 `passThroughEnv` 和 `cache: false`，数据库
集成测试会收到 `DATABASE_URL`，不会回放旧 Turbo 测试日志。

## 7. 真实 Agent / Provider 状态

截至 2026-08-13：

### Real Agent Runtime

测试入口：

```text
apps/api/tests/integration/classroom-agent-real.test.ts
CLASSROOM_REAL_AGENT_SMOKE=1
```

测试能够到达配置的 Provider，但当前 Provider/凭证不可用，测试明确 skip。不能声称真实
Agent 已完成课堂回合。

### OpenAI TTS

已通过生产 adapter 发出真实请求，当前凭证收到上游 `401`，并映射为：

```text
PROVIDER_AUTH_FAILED
```

这不是成功证明。

### OpenAI ASR / Image

生产 adapter 和显式 smoke 均已存在，但受当前 OpenAI 凭证状态影响，尚无成功的真实
Provider 证据。

### Google Veo

```text
GOOGLE_API_KEY 未配置
```

真实 Veo smoke 尚未运行。

恢复发布验收时，必须记录 Provider、模型、区域、配额/用量边界和真实结果，且不得输出
或提交密钥。

## 8. 已知未完成项

### 8.1 补 authored 白板五类 DOM 中间态

现有 E2E 已证明文字、代码、四种 code edit、delete/clear/close，但应在
`tests/e2e/chalkboard-openmaic.spec.ts` 的白板断言附近直接证明以下节点曾进入浏览器 DOM：

```text
wb_draw_shape  -> #slide-element-wb-rule-box
wb_draw_latex  -> #slide-element-wb-equation
wb_draw_line   -> #slide-element-wb-arrow
wb_draw_table  -> #slide-element-wb-operation-table
wb_draw_chart  -> #slide-element-wb-balance-chart
```

Action 会自动继续执行，应在 `wb_delete/wb_clear` 前用一次并发 `expect.poll` 或等效策略
捕获五个节点同时存在，随后再断言 clear/close 后全部消失。不要通过测试专用 renderer
属性伪造证据。

### 8.2 补 unsupported 的浏览器 UI 负例

PBL、unknown Scene、unknown Action、空 widget target 和无效白板 target 已有 fixture/unit
结构化错误证据，但 PBL/unknown 的正式 UI 错误呈现证据仍弱。应增加 Playwright 负例，证明：

- 明确显示结构化错误；
- 不出现静默空白；
- 不把 unsupported Scene 当作完成；
- 不破坏其他可用 Scene 的导航。

### 8.3 修正过时的 golden trace 文档

`docs/researsh/openmaic-golden-trace.md` 的“尚未取证的课堂事件”仍把部分已经由 Chalk
Playwright/真实 HTTP E2E 证明的能力列为完全未取证。更新时要区分：

- Chalk 单边浏览器证据已经存在；
- 固定 OpenMAIC 原站与 Chalk 的双边浏览器 trace 仍不完整；
- golden timeline 只能证明 Action/时序，不能单独证明 DOM/Provider 行为。

同时在 gap report/golden trace 中补齐或确认：

- `audioUrl` 语义；
- narration failure 不阻断 timeline；
- spotlight/laser 浏览器接线；
- iframe identity 和完整 widget Action；
- durable discussion lease；
- `discussion_finished` 不是 DOM receipt；
- capability `not_configured/unverified`；
- poster degradation；
- Veo 8 秒规范化；
- 最新测试数字和 Provider 失败边界。

### 8.4 完整双边浏览器 trace

当前有固定 OpenMAIC golden Action trace 和 Chalk 浏览器 E2E，但还没有完整做到：

```text
同一 Stage
  -> 固定 OpenMAIC 原站浏览器运行并采集 trace
  -> Chalk 浏览器运行并采集 trace
  -> 归一化随机 ID、时间戳、动画帧和 Provider 输出
  -> 对比事件顺序、Scene/Action、iframe identity、白板 state hash、cursor 和恢复锚点
```

这是第 10 条完成标准仍只能算“部分完成”的主要原因。

### 8.5 真实 Agent 与媒体 Provider 发布门禁

需要有效凭证后执行并成功记录：

```text
CLASSROOM_REAL_AGENT_SMOKE=1
CLASSROOM_MEDIA_SMOKE_OPENAI_TTS=1
CLASSROOM_MEDIA_SMOKE_OPENAI_ASR=1
CLASSROOM_MEDIA_SMOKE_OPENAI_IMAGE=1
CLASSROOM_MEDIA_SMOKE_GOOGLE_VEO=1
```

在这些 smoke 通过前，不得将 V1 标记为正式完成。

## 9. 恢复工作时的推荐顺序

1. 先运行 `git status --short`，确认没有新的外部改动。
2. 阅读本 handoff、V1 plan 和四份 OpenMAIC 调研/证据文档。
3. 重新运行 prompt provenance 和 fixture/golden verifier，确认来源没有漂移。
4. 补五类 authored 白板 DOM 断言。
5. 补 PBL/unknown Scene/Action 的 UI 负例。
6. 更新 golden trace、gap report 和逐条 V1 验收矩阵。
7. 跑定向 unit/E2E，再跑根级 test/typecheck/build。
8. 在隔离、有有效凭证的环境运行真实 Agent/Provider smoke。
9. 最后决定是否投入完整 OpenMAIC 原站与 Chalk 双边浏览器 trace。
10. 只有 15 条完成标准都有强证据时，才宣布 V1 完成并开始 V2。

## 10. 验证命令

所有命令从以下目录运行：

```bash
cd /home/xcodd/code/chalk_/.worktree/chalkboard-openmaic
```

### Prompt 和固定 fixture

```bash
pnpm --filter @chalk/api exec vitest run \
  tests/unit/classrooms/prompt-provenance.test.ts --reporter=verbose

node packages/chalkboard/tests/compatibility/openmaic-v1/verify-fixture-and-trace.mjs
```

### 定向 package 验证

```bash
pnpm --filter @chalk/chalkboard test
pnpm --filter @chalk/chalkboard typecheck
pnpm --filter @chalk/chalkboard build

pnpm --filter @chalk/api exec vitest run \
  tests/unit/classrooms/discussion-route.test.ts --reporter=verbose

DATABASE_URL='postgresql://chalk:chalk@127.0.0.1:5432/chalk_openmaic_test' \
pnpm --filter @chalk/api exec vitest run \
  tests/integration/classroom-discussion-lease.test.ts --reporter=verbose
```

### 根级门禁

```bash
DATABASE_URL='postgresql://chalk:chalk@127.0.0.1:5432/chalk_openmaic_test' \
pnpm test

pnpm typecheck
pnpm build
```

### Mock classroom Playwright

先在未占用端口启动 Web；该测试在浏览器层为课堂 API 提供确定性 route adapter：

```bash
pnpm --filter @chalk/chalkboard build
NEXT_PUBLIC_API_URL='http://127.0.0.1:3121' \
pnpm --filter @chalk/web exec next dev --hostname 127.0.0.1 --port 3120
```

另一个终端运行：

```bash
E2E_WEB_URL='http://127.0.0.1:3120' \
pnpm exec playwright test tests/e2e/chalkboard-openmaic.spec.ts --reporter=line
```

端口占用时换未使用端口，不要停止无关进程。

### 真实 HTTP/Postgres/worker/MinIO E2E

要求：

- 独立数据库名必须以 `_e2e` 结尾；
- Postgres 已运行并已应用 migrations；
- MinIO/S3-compatible endpoint 已运行；
- 不指向共享或生产数据库。

```bash
DATABASE_URL='postgresql://chalk:chalk@127.0.0.1:5432/chalk_openmaic_e2e' \
E2E_REAL_CLASSROOM=1 \
E2E_WEB_URL='http://127.0.0.1:3120' \
pnpm exec playwright test tests/e2e/chalkboard-real-http.spec.ts --reporter=line
```

### 真实 Agent/Provider smoke

以下命令会访问外网，并可能产生真实用量。用环境注入密钥，不要把密钥写进命令历史、
文档、日志或仓库：

```bash
CLASSROOM_REAL_AGENT_SMOKE=1 \
pnpm --filter @chalk/api exec vitest run \
  tests/integration/classroom-agent-real.test.ts --reporter=verbose

CLASSROOM_MEDIA_SMOKE_OPENAI_TTS=1 \
CLASSROOM_MEDIA_SMOKE_OPENAI_ASR=1 \
CLASSROOM_MEDIA_SMOKE_OPENAI_IMAGE=1 \
CLASSROOM_MEDIA_SMOKE_GOOGLE_VEO=1 \
pnpm --filter @chalk/api exec vitest run \
  tests/unit/classroom-media/real-provider-smoke.test.ts --reporter=verbose
```

## 11. V1 完成标准审计

| # | 完成标准 | 当前判断 | 现有证据 / 缺口 |
| --- | --- | --- | --- |
| 1 | 固定 Stage 可校验、加载、播放 | 基本完成 | fixture、DSL/unit、golden verifier、E2E |
| 2 | slide/quiz/interactive、全部非 PBL Action、完整白板和 completion 有真实 UI | 部分完成 | 主体已覆盖；尚缺五类 authored 白板 DOM 中间态直接断言 |
| 3 | play/pause/resume/jump/restart 通过 unit/E2E | 基本完成 | controller/action tests + Playwright |
| 4 | 主动讨论和学生插话恢复正确游标 | 基本完成 | controller regression + mock/real HTTP E2E |
| 5 | scripted discussion 可离线完成课堂 | 基本完成 | 受控 runner 和 E2E adapter |
| 6 | Agent Runtime 完成至少一轮真实课堂讨论 | 未完成 | real smoke 存在，但当前 Provider/凭证不可用而 skip |
| 7 | 所有媒体/Quiz grading 模态至少一个真实 Provider smoke | 未完成 | OpenAI 401；Veo 未配置；受控 E2E 不等于真实 smoke |
| 8 | 媒体经认证、owner DAL、worker、对象存储且幂等恢复 | 基本完成 | API integration + real HTTP/Postgres/MinIO E2E |
| 9 | 刷新恢复课堂/iframe/媒体/Quiz/discussion | 基本完成 | mock E2E + real HTTP E2E；iframe identity 已直接验证 |
| 10 | 关键 trace 与固定 OpenMAIC 基准一致 | 部分完成 | golden timeline 已有；完整双边浏览器 trace 不足 |
| 11 | unsupported 明确报错，不静默空白 | 部分完成 | fixture/unit 强；正式 UI 负例仍应补 |
| 12 | 来源、许可证、依赖、Provider 矩阵和差异有记录 | 基本完成 | plan、research、legal、provenance |
| 13 | 根级 typecheck/test/build/E2E 全通过 | 基本完成 | 暂停前最新门禁为绿；恢复后需重新跑 |
| 14 | V1 无 XState/manim-web/几何实现 | 基本完成 | 当前 runtime 未加入这些能力 |
| 15 | 所有迁移 prompt 通过字节来源和 SHA-256 门禁 | 基本完成 | 73/73 passed；恢复后先复验 |

正式状态：

```text
基本完成：10 / 15
部分完成：3 / 15
未完成且受真实凭证阻塞：2 / 15
```

## 12. 工作树安全

当前工作树非常脏，而且迁移成果大多尚未提交。不要把未跟踪文件当作临时垃圾。

2026-08-13 的 `git status --short` 包含：

- `apps/api` schema、DAL、课堂 API、媒体 worker、Quiz、migrations 0005–0010；
- `apps/web` classroom client、media runtime 和 API clients；
- `packages/chalkboard` OpenMAIC compat/runtime/renderers/tests；
- Playwright E2E 和 support harness；
- plan/research/legal 文档；
- `.impeccable/` 和 `CONTEXT.md`。

禁止：

```text
git reset --hard
git checkout .
git clean -fd
git stash
git add .
git add -A
```

不要删除 `.impeccable/` 或 `CONTEXT.md`。不要覆盖不属于当前任务的改动。提交前必须先
运行 `git status`，只用 `git add <明确路径>` 暂存本次意图。除非用户明确要求，不创建
commit、不 push、不建 PR。

尤其不要用 formatter 或批量重写触碰：

```text
apps/api/src/modules/classrooms/prompts/**
```

## 13. 暂停点

暂停前原计划是：

```text
1. 检查现有 Playwright fixture、白板 Action 时序和 unsupported UI 行为
2. 补五类 authored 白板 DOM 断言
3. 补 unsupported UI 负例
4. 更新 golden trace、gap report 和 V1 验收矩阵
5. 重跑定向与全量门禁
6. 用有效凭证跑真实 Agent/Provider smoke
```

第 1 步只完成了现状核对；尚未修改测试来补五类 DOM 断言，也尚未补 UI 负例。不要把
这两项误写为已完成。

本次暂停只更新了这份 handoff，没有继续改功能代码，也没有重新运行长时间测试门禁。
