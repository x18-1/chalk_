# Chalkboard V2 Handoff

> 文档状态：Historical
> 文档类型：Final branch handoff
> 适用分支：`feat/chalkboard-v2`
> Worktree：`/home/xcodd/code/chalk_/.worktree/chalkboard-v2`
> 基线提交：`b8804dfccb93bb15d1384be64c9466001074c637`
> 基线来源：PR #5 合并后的 `origin/main`
> 最终分支提交：`36ce6982ec4b932766d4774802e0a7b40b489dd4`
> 合并结果：GitHub PR #6，merge commit `82832ee07cc43aec4f583ccc8e704756334d8f3a`
> 最后核验：2026-08-27

本文记录 Chalkboard 第二个工程迁移阶段的真实工作现场。V2 是工程阶段名，不是新的产品
版本；产品范围继续以 `docs/spec/chalkboard-v1-*.md` 为准，实施顺序以
[Chalkboard V2 工程迁移计划](../plan/plan-chalkboard-v2.md)为准。

## 1. 当前目标

从 V1 已验证的浏览器课堂运行时出发，依次交付：

1. 用户课堂持久化、对象存储与不可变 Classroom Artifact；
2. 通用 `.chalk.zip` 导入与 `.maic.zip` 兼容；
3. 可恢复的 Generation Run 和课堂 AI；
4. Learning Session 与 Playback Cursor 服务端持久化；
5. Quiz Attempt 与课堂完成状态；
6. authored `discussion` 和 `wb_*` Action 的只读播放与游标重建。

每个后端垂直切片同时交付对应前端的 loading、empty、forbidden、not found、conflict、
offline、retry 和保存反馈，不建立第二套 Agent Runtime。

Discussion Transcript、课堂 Chat 后端、学生与 AI 老师实时对话及相关会话管理已
延后到 Chalkboard V3 候选范围，不属于当前分支的完成门禁。
学生自由手写白板也不属于 V2，不建立 Whiteboard Snapshot/History；导入 Artifact 中
的 authored `wb_*` 只作为教师展示 Action 播放。
大纲 SSE 预览、生成前审阅编辑和第一幕完成后进入生成中课堂的逐 Scene 呈现也已延后到 V3；
V2 保留当前可恢复的分阶段生成、轮询进度和完整 Artifact 显式发布作为人工验收基线。

## 2. 已确认的产品与数据边界

Chalkboard 与 Chat 一样，是所有已认证账号都能使用的产品功能。`admin` 和 `user` 使用相同
的课堂创建、导入和学习能力；`admin` 的额外后台能力不改变 Chalkboard 的产品路径。

用户创建、导入、生成的 Classroom 及其媒体、生成过程和学习状态按账号归属，在 DAL 强制
owner 校验；认证异常 fail closed。两门现有课堂用于迁移和验证正式存储、导入、运行链路，
并通过与其他课堂相同的产品接口读取和学习。

## 3. 已完成的阶段初始化

- GitHub PR #5 已合并到 `main`，合并提交为 `b8804df`；
- `feat/chalkboard-v2` 从该提交创建，没有从旧 V1 worktree 复制未提交文件；
- 新 worktree 的依赖由锁文件安装，未修改 `pnpm-lock.yaml`；
- 独立 `.env` 已创建且由 `.gitignore` 排除，未复制 V1 Provider 凭据；
- 独立 PostgreSQL、MinIO、数据库、session 路径和应用端口已配置；
- 仓库已有 11 条 migration 已应用到 V2 开发数据库；这不是新的 Chalkboard V2 schema；
- API/Web 在独立端口启动成功；
- V1 Chalkboard 浏览器基线在 V2 环境 9/9 通过。

## 4. 环境与运行状态

```text
Compose project: chalk-chalkboard-v2
Web:            http://localhost:3202
Chalkboard:     http://localhost:3202/chalkboard
API:            http://127.0.0.1:3201
API health:     http://127.0.0.1:3201/health
PostgreSQL:     localhost:5532
Database:       chalk_chalkboard_v2
Test database:  chalk_chalkboard_v2_test
MinIO API:      http://localhost:9220
MinIO Console:  http://localhost:9221
```

截至最后核验：PostgreSQL 和 MinIO 均为 healthy，Web/API 开发进程正在运行。原计划使用的
`9200/9201` 与宿主已有静态服务冲突，已将 V2 的独立 MinIO 端口更正为 `9220/9221` 并重建
对应 compose 服务；volume 和已导入对象保留。V1 worktree
仍在 `3101/3102` 运行，用于短期对照；两个环境不共享 Compose project、端口、数据库、
volume 或 session 路径。

开发账号从 V2 `.env` 读取。不要把密码、Cookie、加密键、Provider token 或学生数据写入
本文、日志、测试 fixture 或提交。

## 5. 干净启动流程

在 V2 worktree 根目录执行：

```bash
pnpm install
pnpm --filter @chalk/agent-runtime build
pnpm env:check
pnpm infra:up
set -a
source .env
set +a
pnpm db:migrate
pnpm dev
```

两个已验证的启动事实：

- 全新 worktree 没有 `packages/agent-runtime/dist`；直接 `pnpm dev` 会使 API 报
  `@chalk/agent-runtime/dist/index.js` 不存在，先 build 后再启动即可；
- `drizzle-kit` 不自动加载根 `.env`；未先 `source .env` 时会报告 Postgres URL 为
  `undefined`，不能用其他 worktree 的 URL 代替。

这些事实已同步到 worktree 和数据库 runbook。

## 6. Classroom 持久化纵向切片

已完成第一个纵向切片：

- 新增 `Classroom`、不可变 `Classroom Artifact` 与 Artifact 媒体引用三组持久化模型；
- Artifact 规范化 JSON 以 PostgreSQL `jsonb` 为权威存储；PostgreSQL 同时保存 owner、版本、hash
  和 `mediaRef` 元数据，MinIO 只保存图片、音频、视频等二进制媒体，读取时 owner 校验完成后才
  生成短期签名 URL；
- `.chalk.zip`、兼容 `.maic.zip` 和独立 JSON 明确为导出/导入交换格式，正常生成和学习链路不以
  导出包为数据源；
- DAL 的所有用户业务查询都把 `userId` 放入 SQL 条件，跨账号读取返回 404，未认证返回 401；
  `admin` 与 `user` 使用完全相同的 Classroom 产品接口；
- 提供认证的 `POST /classrooms`、`GET /classrooms`、Artifact 新版本创建和指定 Artifact 读取；
- integration test 覆盖两个角色创建/列表、owner 隔离、认证 fail closed、旧 Artifact 不变、最新
  版本发现、JSON 不进入对象存储及媒体稳定引用；
- `pnpm chalkboard:seed` 通过同一个 `ClassroomService.importClassroom` 将“等式的性质与移项变号”
  JSON fixture 和“傅里叶变换入门” `.maic.zip` 导入当前开发用户，按 `sourceKey` 幂等；
- Web Chalkboard 和 Chats 侧栏改为读取真实 Classroom API；新浏览器不再依赖
  `chalkboard:history`，固定 JSON/zip/媒体 Next routes 已移除；
- 该切片完成时 Playback Cursor 仍暂存在 `localStorage`，当时不将其描述为已完成服务端学习
  状态持久化；这个临时边界现已由第 9 节的服务端 Session 切片替代。

`0013_fine_marten_broadcloak.sql` 使用 expand migration：新增可空 `document jsonb`，并以 check
约束保证迁移期每个 Artifact 至少具有 PostgreSQL document 或旧 object key。新写入只使用
`document`；本 worktree 的两条既有 fixture Artifact 已通过同一个幂等 seed 链路回填，当前数据库
统计为 `artifacts=2, documents=2, legacy_keys=0`。在所有已部署环境完成回填前暂不执行删除旧列的
contract migration；运行时不再从 MinIO 读取课堂 JSON。

## 7. 通用课堂归档导入纵向切片

已完成第二个纵向切片：

- `POST /classrooms/import` 接受唯一 `file` multipart 字段；`admin` 与 `user` 使用同一接口，认证
  发生在读取文件前，异常 fail closed；
- `.chalk.zip` 是 Chalk 原生 `Chalk Classroom Archive`，要求 `format=chalk-classroom` 与
  `formatVersion=1`；`.maic.zip` 是 `OpenMAIC Archive` 兼容输入，普通 `.zip` 不接受；
- 上传压缩包上限 32 MiB，最多 256 个 entry，单 manifest 4 MiB、单媒体 32 MiB、解压总量
  128 MiB；严格拒绝路径穿越、重复路径、加密/不可解码 entry、符号链接和其他特殊文件；
- 根目录必须存在唯一 `manifest.json`，其余文件必须由 `mediaIndex` 声明且位于 `media/`；课堂文档
  中的本地媒体引用也必须逐项由 `mediaIndex` 声明；完整
  normalize 与 Chalkboard DSL 校验通过后才开始写媒体；
- 规范化 Artifact JSON 写 PostgreSQL，图片、音频、视频等媒体写 MinIO；ZIP 和 manifest JSON
  不写对象存储，也不成为运行时数据源；
- 导入使用稳定 Classroom 身份与 Artifact 内容 fingerprint 两层键：原生归档优先使用 `classroomId`，
  兼容归档依次使用 authored stage ID，或归档名与 stage 元数据的确定性组合；Artifact fingerprint
  由规范化 JSON 与排序后的媒体内容 hash 构成，忽略 `exportedAt` 和压缩时间；
- 同账号重复导入相同内容返回原 Artifact；同一课堂的新内容创建下一版不可变 Artifact，不再创建
  第二个 Classroom；不同账号仍各自拥有独立 Classroom。媒体上传中途失败返回
  可重试 503，删除本次已经上传的媒体，不产生半成品数据库记录；
- Web Chalkboard 顶部和空/错误状态都提供课堂导入入口，支持 `.chalk.zip` 与 `.maic.zip`，覆盖
  上传中、离线、类型/版本/内容校验、超限、媒体存储失败和成功后直接打开课堂；
- integration 使用构造的 `.chalk.zip` 与仓库真实 6.8 MiB“傅里叶变换入门.maic.zip”验证完整
  HTTP、PostgreSQL、媒体和 owner 链路；Playwright 验证选择文件、multipart 请求和无整页刷新打开
  返回课堂。

本切片没有实现归档导出；未来导出从 PostgreSQL Artifact JSON 与 MinIO 媒体按需组装
`.chalk.zip`，不新增第三份权威存储。

## 8. Generation Run 异步恢复与 Scene content/actions/media 纵向切片

已完成 Prompt foundation 和 `requirements/context/media planning -> outline -> scene content -> scene actions -> media tasks`：

- `apps/api/src/prompts/` 统一管理英文执行版和中文审阅版；typed registry/loader 负责变量、条件、
  snippet、自动 revision 和 fail-loud 校验，运行时不接受 locale，也不会读取中文镜像；
- 主 Agent、子 Agent、会话标题和 Classroom outline 已移除内联长 Prompt 并接入同一个
  `buildPrompt(promptId, variables)` seam；API build 显式复制 Markdown 资产，从仓库外 cwd 启动仍
  能读取；
- OpenMAIC outline system/user Prompt 与三个媒体 snippet 固定到提交
  `1466a55eef9e31e229a0e2e60a0811020d7b06e2`，英文原文通过 SHA-256 provenance 门禁；
  revision 只由英文模板、启用的条件块和 snippet 决定，不包含用户输入；
- migration `0014_amusing_swordsman.sql` 新增 owned `classroom_drafts` 和
  `classroom_generation_runs`；`0015_last_thunderbolt.sql` 增加 queued/running lease、heartbeat 和
  cancel request；`0016_bouncy_metal_master.sql` 新增 owned `classroom_draft_scenes`，并让 content
  aggregate run 的 Prompt provenance 由各 Scene 分别记录；`0017_living_eddie_brock.sql` 为每个
  Scene 增加 actions JSONB 及独立的状态、attempt、Prompt/模型、错误和时间审计列；
- requirements/context、outline JSON、每个 Scene 的 outline/content/actions、阶段状态、attempt、稳定错误码、
  `promptId + revision` 和实际 provider/model 均写 PostgreSQL，不向 MinIO 写任何生成 JSON；
- `POST /classroom-generation-runs` 立即返回 `202 queued`；worker 使用数据库 claim、lease、heartbeat
  和 `FOR UPDATE SKIP LOCKED` 领取任务，`GET /classroom-generation-runs/:runId` 返回持久化进度；
  `GET /classroom-generation-runs/current` 返回当前 owner 最近一条未发布、未取消的 Run，Run 与 Draft
  的 owner 条件都在 DAL 强制执行；匿名请求 401，其他 owner 的任务不会泄露；
  retry、abort、`POST .../:runId/scene-content` 和 `POST .../:runId/scene-actions` 对 `admin`/`user`
  使用相同认证路径；所有业务数据
  读写在 DAL SQL 条件中携带 `userId`，跨账号访问统一 404，认证异常 401；
- 大纲是单次结构化生成，通过 `@earendil-works/pi-ai` catalog 的 `completeSimple` 复用 Chat 的
  用户模型选择和 Provider 凭据，不启动 Agent tool loop；模型输出在写库前经过 JSON 提取、Zod
  契约、唯一 Scene ID、连续 order 和各 Scene 类型必要配置校验；
- worker 停止时中止当前模型请求并把 claim 释放为 queued；进程未优雅退出时，其他实例会在 lease
  过期后重新领取。应用重启 integration 证明同一个持久化 run 无需增加 attempt 即可恢复；用户
  abort 通过 `AbortSignal` 传入 Pi，并以明确 `aborted` 终态结束；
- slide/quiz content 复用同一个 Pi LLM catalog，但每个 Scene 单独 build Prompt、调用、校验和提交；
  Scene 失败后 aggregate run 进入 failed，已完成 Scene 不回退，retry 只将未完成 Scene 重新排队并
  仅增加它们的 attempt；
- 修复了真实 interactive/game 生成被误判为无效内容的问题：此前 Pi adapter 对所有课堂 completion
  硬编码 `maxTokens=12000`，遗漏了 OpenMAIC scene-content 使用所选模型 `outputWindow` 的行为，长
  HTML 会被截断。现在 adapter 从统一模型目录读取当前模型的实际 `maxTokens`（例如当前 DeepSeek
  V4 Flash 目录值为 384000），并把 Pi `stopReason` 传入阶段服务；`length` 会记录为稳定的
  `CLASSROOM_INTERACTIVE_CONTENT_TRUNCATED`（slide/quiz 使用各自前缀），不会再退化成无法判断的
  `CLASSROOM_INTERACTIVE_CONTENT_INVALID`。integration 覆盖首次截断、同 run 重试同一 Scene、attempt
  递增并成功完成；已完成 Scene 仍不会重复生成。调用策略也按阶段对齐固定 OpenMAIC：outline 为
  300 秒，content 为 300 秒且 Pi 内部重试 0 次，actions 为 60 秒且 Pi 内部重试 0 次；content/actions
  失败恢复统一交给可持久化、可审计的 Generation Run；
- interactive content 已迁移 OpenMAIC 的 simulation、diagram、code、game 和 visualization3d
  五类英文 Prompt，中文审阅镜像与 provenance/hash 门禁一并纳入集中 Prompt 模块。模型
  输出必须是完整单一 HTML document，内含且只含一个匹配 widget type 的 `widget-config`、稳定
  DOM selector 和完整四种 message protocol；校验、LaTeX 后处理和 DOM inventory 集中在
  `interactive-document.ts`，不散落在 worker。失败会细分为缺失、过大、不完整、多文档、配置缺失/
  重复/非法、类型不符、protocol 不完整和 selector 缺失等稳定错误码，并同时写入 Scene 与 aggregate
  Run；前端显示对应中文说明，未知异常才退回通用 invalid，Provider 原始内容不会泄露；
- 旧版 OpenMAIC `interactiveConfig` 在大纲入库边界按既有推断顺序归一化为
  `widgetType/widgetOutline`，既有未归一化 Draft 在 content/actions 边界也会得到同样处理；
- `POST .../:contentRunId/scene-actions` 只接受已完成且同 owner 的 content run，创建独立
  `scene_actions` run；slide/quiz actions 仍由 Pi 的单次结构化 completion 生成，逐 Scene 校验和
  提交，重试跳过已完成 Scene。slide 动作目标必须引用当前 Scene 的有效元素；quiz 可执行动作限制为
  speech，英文 Prompt 明确禁止在讲解中泄露答案。Prompt/模型、attempt、稳定错误码和时间戳均与
  content 分开审计；
- interactive actions 使用统一 OpenMAIC Prompt 生成 speech 与 `widget_highlight`、`widget_setState`、
  `widget_annotation`、`widget_reveal`；所有 target 必须存在于当前 Scene HTML 的 DOM inventory，
  模型臆造 selector 以 `CLASSROOM_SCENE_ACTIONS_INVALID` fail closed；
- Action 模型输出若不是结构化 JSON、没有任何合法 Action，或所有目标都在契约校验时被拒绝，当前
  Scene 与 aggregate run 以稳定 `CLASSROOM_SCENE_ACTIONS_INVALID` 失败；不会用本地通用讲解伪造
  成功，用户可在同一个 run 上重试；
- migration `0018_classroom-media-tasks.sql` 新增 owned `classroom_draft_media_tasks`，以 Run 和 Scene 的
  `(id, user_id)` 复合外键在数据库层约束 owner；`0019_classroom-media-task-order.sql` 增加显式任务
  顺序，避免同事务时间戳相同导致 Scene 顺序漂移；`0020_omniscient_photon.sql` 允许图片/视频任务
  使用 `element_id` 并持久化异步 `provider_task_id`，`0021_blushing_corsair.sql` 用数据库 check 约束
  audio 必须指向 Action、image/video 必须指向媒体 element；
- `POST /classroom-generation-runs` 接受可选、显式的 image/video provider、model 和能力参数，并随
  owner-scoped Draft context 写 PostgreSQL。只有显式启用的能力会打开 OpenMAIC outline Prompt 的
  对应条件块；默认仍不规划 AI 媒体；
- `mediaGenerations` 已从任意 record 收紧为正式契约：仅 slide 可声明，`image` 使用全课程唯一
  `gen_img_*`，`video` 使用全课程唯一 `gen_vid_*`，prompt/aspectRatio/style 均有界；模型返回未启用
  类型、错误前缀、重复 ID 或额外字段时以 `CLASSROOM_OUTLINE_INVALID` fail closed；
- Scene content Prompt 接收当前 Scene 已规划媒体清单，并允许生成内容引用大纲里的占位 ID；任务
  不会从 Scene 内容猜测或反向创造。image/video 完成后，DAL 在同一 owner-scoped 事务中把占位
  `src`/`mediaRef` 替换为稳定 `media/generated/...` 引用；
- `POST .../:actionsRunId/media-tasks` 只接受已完成且同 owner 的 actions run；Web V2 固定提交空的
  TTS 配置，只执行大纲规划的图片/视频，教师 `speech` Action 由浏览器 `SpeechSynthesis` 朗读。
  后端仍兼容显式 TTS provider/voice/model/format；该兼容路径可派生音频 task，但不属于 V2 Web
  路径或完成门禁。状态、attempt、输入、
  Provider/模型、稳定错误码、content hash、size、`mediaRef` 与对象 key 写 PostgreSQL，音频二进制写
  MinIO；Action JSON 仅在任务完成事务中回写稳定 `audioRef`，不保存 base64；
- media worker 复用 Generation Run 的 claim/lease/heartbeat/cancel/recovery。单 task 失败后已完成
  媒体保持不变，retry 只重置未完成 task；同一 task 使用稳定对象 key，数据库提交失败会尽力删除
  已上传对象，进程硬中断后恢复则覆盖同一个 key。图片 provider 的 bytes/远程 URL 统一归一化为
  最大 32 MiB 的受限二进制后写 MinIO，远程 URL 在生产环境拒绝 loopback/private IPv4；Provider
  原始异常不会进入 API；
- 视频保持 provider 原生异步边界：首次 submit 后立即把 `providerTaskId + provider/model` 写
  PostgreSQL，再循环 poll；poll 失败、lease 回收或应用重启后只继续 poll 已有任务，不重复 submit。
  用户明确 abort 时尽力调用 provider cancel；worker shutdown 不取消远端任务，以便新实例恢复；
- `POST .../:mediaRunId/publish` 只接受同 owner 且 completed 的 media run。独立
  `classroom-publication.service.ts` 按 Scene order 组装 Stage/Scene/Action，规范化图片 `src` 为稳定
  `mediaRef`，并在任何对象复制前执行 Chalkboard normalize/DSL、生成占位符、未知/未引用媒体与完整性
  校验；未完成阶段返回 409，非法 Draft 返回稳定 422，不产生 Classroom 或 Artifact；
- migration `0022_silky_flatman.sql` 为 Draft 增加 owner-scoped Classroom/Artifact 发布关联、三态一致性
  check 与 Artifact 唯一约束；`0023_peaceful_the_watchers.sql` 增加 publication reservation token/time
  一致性门禁。发布先在 PostgreSQL 原子预留 token，Classroom/Artifact ID 和对象 namespace 从 token
  稳定派生；并发请求不能同时提升媒体，硬中断后的过期 reservation 复用原 namespace，成功事务一次
  写 Classroom、不可变 Artifact、媒体元数据和 Draft `published` 状态；
- Draft 媒体通过 MinIO server-side CopyObject 提升到
  `classrooms/<owner>/<classroom>/artifacts/<artifact>/media/...`，不经 API 进程重新下载。复制或数据库提交
  失败会删除本次已复制目标并释放 reservation，源 Draft 对象保持不变；同一 run 可重试。重复 publish
  返回原 Classroom/Artifact，不创建第二个版本；真实 MinIO Put/Copy/Get 与清理已验证；
- Generation 后端按排障职责拆分：`classroom-generation.service.ts` 只暴露应用用例，
  `classroom-generation.worker.ts` 负责 claim/lease/heartbeat/recovery/cancel，outline 与 Scene 的
  Prompt 构造、模型结果校验和阶段落库分别集中在 `outline-generation.service.ts` 与
  `scene-content-generation.service.ts`、`scene-actions-generation.service.ts` 和
  `media-tasks-generation.service.ts`；HTTP 接口、DAL owner
  seam 和持久化状态机未改变；
- OpenMAIC slide/quiz 与 simulation/diagram/code/game/visualization3d interactive content system/user Prompt，
  以及四个 snippet 固定到同一参考提交，英文原文通过 SHA-256
  provenance 门禁；中文版是结构一致的人类审阅镜像，不进入模型；
- OpenMAIC slide/quiz/interactive actions system/user Prompt 同样固定到该提交并通过 SHA-256 provenance 门禁；
  英文执行版保持原文，中文只供审阅，不进入模型；
- Chalkboard Web 轮询真实 run，关闭面板后任务继续；生成弹窗具备焦点圈闭、Escape 关闭和触发按钮
  焦点恢复，不向学生暴露数据库、对象存储、JSON 或 Run 等内部术语。大纲完成后可启动逐 Scene content，显示
  completed/working/failed/pending、部分进度、停止和只补生成未完成 Scene 的入口；content 完成后
  可继续启动 actions run，并使用相同的后台轮询、逐 Scene 进度和恢复入口；大纲表单可从已
  配置 provider 中显式启用图片/视频规划（默认关闭），并只选择后端生成契约支持的 720p/1080p
  视频分辨率；媒体阶段统一展示图片和视频进度、停止
  与只补未完成媒体入口；媒体完成后显示“校验并发布课堂”，提交期间防重复，失败保留面板与 Draft，
  成功后用服务端返回的 Classroom ID 打开正式 Artifact 学习页面。页面刷新会从 current 接口恢复
  持久化 Run，并显示“继续课堂生成”；恢复本身不会重试或产生新的模型调用，用户仍需明确点击补生成；

当前边界：content/actions 已迁移 slide、quiz 与 interactive；PBL 会以稳定 unsupported 错误停在对应 Scene，
已完成 Scene 仍保留。V2 Web 的教师讲解由浏览器 `SpeechSynthesis` 朗读；后端 TTS task 只保留
兼容接口，不属于 V2 生成路径或完成门禁。媒体阶段已迁移图片同步生成和视频异步 submit/poll，
但仅执行大纲显式规划的 image/video，不会从内容中猜测。最终 normalize/DSL
校验、不可变 Artifact 发布、媒体提升和 Web 打开学习课堂已经完成；但任何 Generation Run 的
`completed` 仍不等于发布，必须以显式 publish 成功返回的 Artifact 为准。生成侧 PBL
content/actions 尚未迁移，遇到该类大纲仍 fail closed。

## 9. Learning Session 与 Playback Cursor 纵向切片

已完成服务端学习进度持久化：

- migration `0024_jittery_the_spike.sql` 新增 `classroom_learning_sessions`，每个 Session 通过复合外键绑定确定的
  `artifact_id + classroom_id + user_id`；同一用户对同一不可变 Artifact 只创建一个 Session，
  新 Artifact 始终创建独立 Session，不静默套用旧版本进度；
- DAL 的创建、读取和 Cursor 更新都强制把 `userId` 放入 SQL 条件；未认证返回 401，跨 owner
  的创建、读取和写入统一返回 404，`admin` 不获得读取其他用户课堂进度的额外权限；
- 提供认证的 create/resume、Session 读取和 Cursor 更新 API；Cursor 保存 scene/action 位置、
  播放模式与完成状态，`expectedRevision` 成功后原子递增，过期写入稳定返回
  `409 PLAYBACK_CURSOR_CONFLICT`；
- Service 使用绑定 Artifact 的 PostgreSQL JSON 重建 Chalkboard Runtime，对 stage、scene、
  sceneIndex、actionIndex、mode 和 completed 做语义校验；其他 Artifact 或无效位置返回
  `422 PLAYBACK_CURSOR_INVALID`，不污染已保存进度；
- Web 加载 Artifact 时同时 create/resume Session，以服务端快照为权威重建 Runtime；旧
  `localStorage` Cursor 只在服务端仍为初始快照时尝试一次迁移，成功或判定冲突后删除；
- 浏览器保存请求按顺序执行。409 时重新读取并恢复较新服务端快照，冲突前已经排队的旧快照
  不会在取得新 revision 后反向覆盖；离线或网络失败保留当前页面状态并明确显示“进度未保存”，
  下一次操作自动重试；顶部使用 `aria-live` 展示保存中、已保存、冲突恢复和离线状态；
- ChalkboardPlaybackController 现在也持久化 start、pause、resume 三个显式模式转换，避免只保存
  Cursor 位置而遗漏播放模式；
- integration 覆盖匿名、owner 隔离、同 Artifact 幂等恢复、新 Artifact 隔离、无效 Cursor、
  revision 冲突和新 API 实例从 PostgreSQL 恢复；E2E 覆盖刷新、全新浏览器 context、并发冲突、
  离线重试，并将作者视频定位测试从旧 `localStorage` 写入改为正式 Session API。

本切片只持久化 Learning Session 与 Playback Cursor。Quiz Attempt 已在第 10 节完成。
课堂完成状态已由 Cursor 的 `mode=completed` 与 `completed` 字段持久化，不另建重复对象。
Whiteboard Snapshot/History、Discussion Transcript 和课堂 Chat 后端不属于 V2，当前浏览器
临时界面不得描述成持久化或 AI 对话能力。

## 10. Quiz Attempt 纵向切片

已完成 Quiz 答题、服务端评分和恢复：

- migration `0025_strange_kid_colt.sql` 新增 `classroom_quiz_attempts`；每条 Attempt 同时保存
  `learning_session_id + artifact_id + classroom_id + user_id + scene_id`，并通过复合外键绑定现有
  Learning Session 的确定 Artifact 和 owner；同一 Session/Scene 保留一个可重提 Attempt；
- DAL 的 Session context、列表、首次提交和 revision 更新都强制携带 `userId`；匿名请求返回
  401，跨 owner 读取和重提返回 404，`admin` 不获得其他账号 Quiz Attempt 的访问权；
- 提供认证的 `GET /learning-sessions/:sessionId/quiz-attempts` 与
  `PUT /learning-sessions/:sessionId/quiz-attempts/:sceneId`；首次提交使用 `expectedRevision: 0`
  幂等创建，后续重提原子递增 revision，过期写入稳定返回 `409 QUIZ_ATTEMPT_CONFLICT`；
- Service 只从 Session 绑定的 PostgreSQL Artifact JSON 查找 Quiz Scene，逐题验证 question ID、
  完整性、单选/多选约束和 authored option；客户端不能提交 score 或 correct。服务端根据 authored
  answer/points 计算逐题结果、score 和 maxScore，非法 Scene/答案返回稳定 422 且不改变旧 Attempt；
- Web 打开课堂时读取全部 Attempt，进入 Quiz Scene 后恢复答案、逐题结果和服务端得分；只有
  服务端确认后才显示讲解和得分，浏览器不再充当权威评分器；
- QuizScene 覆盖首次提交、重提、保存中禁用、已保存、离线和普通失败；填写内容在网络失败后
  保留。409 时重新读取 Attempt 并恢复其他设备的较新答案，不覆盖新 revision；
- integration 覆盖首次提交/读取、独立服务端评分、revision 重提、冲突、非法选项、匿名、跨
  owner 及新 API 实例恢复；E2E 覆盖刷新、全新浏览器 context、离线失败/联网重试和跨设备冲突。

本切片没有修改 Prompt 或调用真实模型。Whiteboard Snapshot/History、Discussion Transcript
和课堂 Chat 后端不是本切片遗留的 V2 未完成项；课堂完成状态已由 Learning Session
的 Playback Cursor 正式持久化。

## 11. 学生手写白板移除与教师白板边界

- OpenMAIC 白板契约是教师/参与 Agent 生成的 `wb_open`、`wb_draw_*`、`wb_edit_code`、
  `wb_delete`、`wb_clear` 和 `wb_close` Action，不是学生手写协议；
- V2 保留 `@chalk/chalkboard` 的白板 Action DSL、adapter、presentation reducer 和游标投影，
  用于只读播放导入 Artifact 中已经 authored 的教师白板；
- Web 已删除学生笔迹状态、pointer 绘制、“清空手写内容”和手动“打开白板”入口；
  authored Action 打开的教师白板仍可关闭，但学生不能创建或删除其中内容；
- 不建立 Whiteboard Snapshot/History schema、DAL 或 API。未来课堂讨论的 live Agent `wb_*`
  Action 属于 V3 候选范围；学生自由手写白板不会自动进入 V3；
- Chalkboard E2E 通过公开浏览器 seam 验证了播放控制和 Interactive widget 仍可用，
  同时页面不再暴露学生手写或手动打开白板入口。

## 12. 最近验证

实际执行并通过：

```bash
pnpm env:check
docker compose config --quiet
pnpm --filter @chalk/agent-runtime build
set -a
source .env
set +a
pnpm db:migrate
pnpm chalkboard:seed
pnpm --filter @chalk/api test:integration
pnpm test:unit
pnpm --filter @chalk/chalkboard test
pnpm typecheck
pnpm --filter @chalk/api build
pnpm --filter @chalk/web build
pnpm --filter @chalk/api smoke:classroom-outline
pnpm --filter @chalk/api smoke:classroom-ark-media
curl -fsS http://127.0.0.1:3201/health
E2E_WEB_URL=http://localhost:3202 \
E2E_API_URL=http://localhost:3201 \
  pnpm exec playwright test tests/e2e/chalkboard.spec.ts --workers=1
git diff --check
```

结果：环境校验通过；PostgreSQL/MinIO healthy；数据库 migration ledger 为 27 条；全新临时
数据库从 0000 到最新 migration 一次通过，临时库随后删除；两门课堂 seed 首次导入和重复幂等
运行均通过；API integration `9 files / 82 tests passed`，包括用户默认生成/浏览器语音能力设置、
凭据删除时原子清理默认选择、认证 fail closed 和 admin/user owner 隔离，以及 Quiz Attempt 的服务端评分、owner/
Artifact/Session 绑定、revision 冲突、非法答案拒绝和应用重启恢复，Learning Session 的 owner/Artifact
绑定、乐观并发、无效 Cursor 拒绝、应用重启恢复，以及异步 outline/content/actions/media Generation Run
的持久化、owner 隔离、认证 fail closed、取消、失败脱敏、应用重启恢复、逐 Scene/媒体提交及只补生成
未完成项；Interactive 覆盖五类 widget content/actions、旧版配置归一化、HTML/message 契约、
selector fail closed、失败恢复和不可变 Artifact 发布；图片任务验证对象写入和占位引用替换，视频任务验证
provider task 持久化以及 poll 失败后
不重复 submit；归档链路还覆盖构造的
`.chalk.zip`、仓库真实 6.8 MiB `.maic.zip`、owner 隔离、安全解包、语义幂等、失败补偿和真实
MinIO 读写；根级 unit task 通过（Agent Runtime `7 files / 44 tests`、API `8 files / 57 tests`），
`packages/chalkboard` `10 files / 34 tests passed`；全仓 typecheck `5 tasks successful`；API build
与 Web production build 通过，且 API 构建产物从 `/tmp` 启动后 health 返回 200；Chalkboard/Settings E2E `20 passed`，覆盖无
`localStorage` 历史的课堂发现、
两门课堂、请求重试、播放恢复、Interactive、不暴露学生手写/手动白板入口、MinIO 视频、
手机布局、服务端记录作用域、
课堂切换、归档导入、刷新/新浏览器服务端进度恢复、并发冲突恢复、离线未保存与联网重试、
Quiz Attempt 的刷新/新浏览器恢复、离线重试和跨设备冲突，以及异步大纲轮询、后台继续、逐 Scene content/actions progress、
浏览器语音播放/暂停/恢复/取消、生成弹窗焦点圈闭与焦点恢复、无后端 TTS 配置、Seedance 只提交受支持的
720p 分辨率、图片/视频默认不规划、逐项媒体进度、恢复入口、显式发布和打开新 Artifact。
生成 E2E 现包含 interactive Scene，打开 Artifact 后播放 `widget_setState`，iframe 内部状态按作者契约真实改变。

真实 DeepSeek smoke 通过完整的登录、HTTP、DAL、Pi、Provider、JSON 校验和 PostgreSQL 链路：
`deepseek/deepseek-v4-flash` 首次 attempt 成功生成“勾股定理入门”3 个 Scene，并继续完成 slide、
quiz 与 simulation interactive 三次独立 content generation 及 actions generation；三个 Scene 分别持久化
12、1 和 9 个 Action，interactive 包含至少一个通过实际 DOM inventory 校验的 widget Action。
脚本只输出安全摘要，不输出密钥、完整 Prompt、
生成 JSON 或用户材料，并在结束时删除临时账号及级联业务数据。

本切片已运行受影响的 API/Web production build 和真实 Ark 图片/视频 Provider smoke；真实
DeepSeek outline + Scene content/actions smoke 在同一个 Ark 课堂链路中实际执行。全仓
`pnpm lint` 已通过；收尾时一并修正了门禁发现的 OpenAI TTS 未使用 catch 变量、VoxCPM
control-character regex 和 Seedance 未使用 import，不改变 Provider 行为。

最终 Standards 与 V2 Spec 双轴审查已关闭所有 High/Medium 阻断项：运行时 Prompt telemetry 记录
`promptId + revision`；slide Action 的无效媒体目标 fail closed；归档校验覆盖文档中的全部媒体引用；
同一原生 Classroom 的修订导入创建下一版不可变 Artifact；生成弹窗具备完整键盘焦点边界；学生界面
不暴露数据库、对象存储、JSON、Provider 或 Run 等实现术语。生成控制组件仍较大，后续可在不改变
行为的独立重构中继续拆分，但不构成 V2 发布阻断，也不在收尾阶段引入高风险结构改动。

## 13. V2 权威数据路径审计与真实 Ark 媒体 E2E

本轮已对课堂发现、导入、生成、媒体、学习进度和答题状态做收尾审计：

- Web 的课堂列表、Artifact 读取与运行时加载全部经过认证 Classroom API，以 PostgreSQL Artifact
  JSONB 为权威；两门既有课堂的 fixture 只由幂等 seed 脚本做一次性正式导入，浏览器不直接读取
  fixture；
- `.chalk.zip` 与兼容 `.maic.zip` 是导入/导出交换格式，不是生成或学习运行时来源。导入后的规范化
  JSON 写 PostgreSQL，媒体二进制写 MinIO；生成阶段的 outline/content/actions JSON 同样只写
  PostgreSQL Draft JSONB；
- 生产代码中的 `localStorage` 仅保留旧 Playback Cursor 向服务端 Learning Session 的一次性迁移，
  服务端初始快照以外不会覆盖 PostgreSQL 进度；课堂发现、Quiz Attempt 和新学习状态均不以
  `localStorage` 为权威；
- Artifact `contentObjectKey` 仅是已记录的旧数据回填兼容读取分支，运行时新数据不把课堂 JSON 写入
  MinIO。删除该列仍等待所有部署环境完成 JSONB 回填后的独立 contract migration；
- Classroom、Artifact、媒体元数据、Generation Run、Learning Session 和 Quiz Attempt 的业务读写
  均在 DAL SQL 条件或 owner 复合外键中携带 `userId`；`admin` 与 `user` 使用同一 owner 边界，认证
  异常 fail closed。

真实媒体 smoke 使用开发用户通过认证 API 保存各 capability 独立的加密 Provider 凭据，然后执行
`outline -> scene content -> scene actions -> media tasks -> publish -> Artifact media read -> Learning Session`
完整链路。使用 `doubao-seedream-4-5-251128` 生成 16:9 JPEG，使用
`doubao-seedance-1-5-pro-251215` 生成 5 秒、16:9、720p MP4。首次调用暴露 Seedream 适配器旧
`1664x936` 尺寸低于 4.5 的最小像素门槛；现已通过单测把已公开比例映射到有效 2K 尺寸，其中
16:9 为 `2560x1440`。随后从原失败 media run 的正式 retry 入口恢复，attempt 从 1 增至 2，未重新
生成大纲/content/actions；最终图片为 621,229 bytes、视频为 4,400,205 bytes。两项媒体均完成
Provider/模型审计、写入 MinIO、提升到不可变 Artifact namespace，并通过发布后的签名 URL Range
读取与 content type 校验；Learning Session 成功绑定发布 Artifact。凭据只存在于 gitignored `.env`
和当前用户的加密 credential 行，smoke 输出不包含密钥、完整 Prompt 或生成 JSON；生成课堂保留在
开发用户账号下供浏览器人工检查。

## 14. 下一步

在人工验收前补齐了统一的用户能力配置：

- `agent_settings` 现在持久化默认生图/视频 Provider 与模型、默认视频时长/清晰度，以及浏览器
  `SpeechSynthesis` 的语言、voice URI、语速和音量；`GET/PUT /settings/capabilities` 使用认证身份，
  DAL 的 `userId` 条件强制 owner 隔离，未配置凭据、未知模型或不受支持规格均 fail closed；
- Settings 的生图/视频页在保存凭据和模型时同步保存默认能力，视频页可选择默认时长和清晰度；
  语音页将无需 API Key 的“本机语音”和“本机语音识别”收入与第三方能力相同的
  Provider rail/detail，不再在 rail 上方显示独立卡块；TTS 支持选择操作系统声音、试听并保存
  语言/语速/音量，浏览器 ASR 复用同一语言偏好。
  后端 TTS Provider 仍只是兼容配置，不进入 V2 课堂生成；
- Chat 的媒体选择器展示本机语音和已配置的第三方媒体能力；每个 Provider 只占一行，模型收进
  Provider 自己的下拉框，不再把同一 Provider 的全部模型铺成多张卡片。生图/视频以独立单选控件
  选择 Provider，以右侧下拉选择该 Provider 的模型；两者都会立即乐观更新并保存共享默认配置，
  保存失败则回退。弹层不重复展示配置来源、模型数量或与 Chalkboard 共用的说明。ASR/TTS 第三方行
  当前只表示能力已配置，不冒充尚未接入聊天录音或播放链路的“当前默认”。
  Chalkboard 不维护另一份 Provider 定义：生成弹窗直接读取同一个 `/media/providers` 目录，只显示
  当前用户已配置的图片/视频 Provider。弹窗默认继承全局选择，也允许为本次 Generation Run 改选
  Provider 与模型；选择随 Classroom Draft 持久化和恢复，但不反向修改 Settings/Chat 的全局默认。
  课堂级复选框仍决定本次大纲是否规划图片或视频；
- 课堂播放读取相同的本机语音偏好。删除当前默认媒体凭据时，DAL 会同时清空对应默认选择，避免
  生成阶段继续引用已失效能力。Settings 的视频页在默认选择为 `null` 或 Provider 目录暂时为空时
  保持可用，不会因两个可选值同时为 `undefined` 而误入视频规格分支。
- 对真实生成课堂 `dc53ccef-f1fb-5da4-badb-f40d1bf3317d` 的 Artifact 诊断确认：第 2 页没有图片
  媒体引用，而是两个此前被 renderer 静默忽略的 `chart` 元素；第 7 页保存的是合法原始 LaTeX，
  但此前未调用 KaTeX。Web 现已渲染生成 Prompt 支持的 chart 数据和原始 LaTeX。播放过程中手动
  切页在自动播放关闭时会取消当前 Action 并停在新页，只有显式开启自动播放才延续播放。
- 媒体凭据现在与 Pi LLM 认证链保持同一优先级：PostgreSQL 中当前用户凭据优先，`.env`
  作为部署级 fallback。`ARK_API_KEY` 可同时使 Seedream/Seedance 可用，无需每个用户重复粘贴；
  专用 `IMAGE_SEEDREAM_API_KEY` / `VIDEO_SEEDANCE_API_KEY` 可分别覆盖。API 只暴露“用户配置/
  环境配置”状态，不返回密钥；Settings 的 API Key 小眼睛仅切换当前新输入的文本，无法反查已保存或
  环境密钥。Chat 中可直接选择这些环境已配置的生图/视频模型。

迁移 `0026_brainy_selene.sql` 已执行；API integration 为 `9 files / 83 tests passed`，新增覆盖
匿名拒绝、未配置 Provider 拒绝、设置 round-trip、凭据删除原子清理和 admin/user owner 隔离。
全仓 typecheck `5/5`、lint、API/Web production build 已通过；Chalkboard 与 Settings E2E
`20 passed`，包括本机语音设置与 Chat 可见性、媒体 Provider 模型下拉、课堂生成从统一目录继承并
改选已配置 Provider、课堂级显式启用以及播放时
voice/language/rate/volume 适配。

针对本轮设置空值回归、Chat ASR 入口恢复、部署级媒体凭据和 Provider 模型下拉框，定向 Settings
E2E `3 passed`，Web typecheck 和定向 ESLint 通过，`git diff --check` 通过。

针对真实生成课堂暴露的 chart、raw LaTeX 和手动切页续播回归，新增 renderer E2E 与 playback
controller 单测；完整 Chalkboard E2E `18 passed`，`packages/chalkboard` `10 files / 35 tests passed`，
全仓 typecheck `5/5`、定向 ESLint 和 `git diff --check` 通过。此修复不改变数据库结构，无需 migration。

随后完成了以 OpenMAIC `ScreenElement` 注册表、集中 Scene content Prompt、真实 `.maic.zip` 和
PostgreSQL Artifact 为四个来源的只读播放审计：

- 集中 Slide Prompt 允许的八类元素为 `text/shape/line/chart/latex/table/image/video`，Web 均有
  正式 renderer；生成结果 schema 现在用同一八类 allow-list fail closed，模型不能再提交前端会
  静默丢失的新类型；
- OpenMAIC 播放器在这八类之外还正式注册 `code`，现已迁移为带文件名、语言、可选行号和可滚动
  代码区的只读 renderer；OpenMAIC 的 `audio` 仅存在于类型定义，播放器仍是 TODO，当前 Prompt、
  仓库真实归档和数据库 Artifact 都不产出它；
- 当前数据库 Artifact 的元素分布为 text 109、shape 69、latex 11、line 9、image 7、video 3、
  chart 2、table 2，18 个 Slide 背景均为 solid；仓库真实“傅里叶变换入门”归档包含
  slide/interactive/quiz，元素与 Action 均落在上述已迁移契约内；
- interactive 的 simulation/diagram/code/game/visualization3d 共用受 sandbox 约束的 HTML renderer
  和四类 widget message protocol，不是五个遗漏的 React renderer；Quiz 的 single/multiple/
  short_answer 已接正式 Attempt API。PBL 仍按范围明确 unsupported；authored `wb_*` 只读白板保留
  游标重建，但 live 白板和实时课堂讨论仍属于 V3；
- 未知导入元素不再 `return null`，会在原布局位置显示可理解的 unsupported 占位，便于定位兼容
  问题。右侧 Notes 的每个段落现可点击：从该段前置 Action 开始并继续播放，当前段随 cursor 高亮、
  自动滚动，且具备键盘焦点与 screen-reader 名称。

本轮使用 TDD 增加 generation schema、playback controller 和浏览器回归；API unit
`9 files / 58 tests passed`、Chalkboard package `10 files / 37 tests passed`、API integration
`9 files / 83 tests passed`、完整 Chalkboard E2E `19 passed`，全仓 typecheck `5/5`、定向 ESLint
和 `git diff --check` 通过。本轮没有数据库结构变更，无需新增或执行 migration。

随后修复了 Generation Run 刷新恢复和 Notes React key 回归。Web 通过新的 owner-scoped current
接口恢复最近一条未发布 Run，失败任务刷新后仍显示“继续课堂生成”和显式补生成按钮，不会自动重试；
interactive HTML 校验现在持久化可诊断的细分稳定错误码。Notes 的动态按钮 children 均使用稳定 key，
React 19 不再报告 list-key warning。没有修改 Prompt 或数据库结构；migration 由 integration runner
重新执行并通过。API unit `11 files / 70 tests passed`、API integration `9 files / 85 tests passed`、
完整 Chalkboard E2E `21 passed`、全仓 typecheck `5/5`。

长课堂的生成卡片现在将当前阶段操作区固定在内部滚动视口底部；大纲、Scene content、Actions 和
media 共用同一行为，关键的继续、补生成或发布操作不再要求触控板恰好滚到长 Scene 列表末尾。内部
滚动容器同时限制 overscroll chaining，避免快速惯性滚动转移到 backdrop。浏览器回归使用 12 个 Scene、
`1365 × 640` 视口验证“校验并发布课堂”始终在视口内；该修复只涉及 Web 布局，不改变生成或发布状态机。

真实“加减法入门”Artifact 的错位来自模型提交的重叠、越界坐标。Chalk 的 Slide Content 英文 Prompt
与当前 OpenMAIC 原文一致，已包含画布边距、间距和无意重叠自检；OpenMAIC 的初始课件生成链路也不做
整页几何冲突检测或据此自动重试（其几何冲突检测器属于后续讨论白板）。因此 V2 不新增空间门禁，
保持 OpenMAIC 链路；布局质量波动留给用户选择更擅长指令遵循与空间规划的已配置 LLM。

课堂 Artifact 的私有媒体仍在 owner 校验通过后签发临时 MinIO 下载 URL，但只读 URL 有效期从 10 分钟
调整为 4 小时，避免长课堂后段的视频在签名到期后无法继续 Range 读取音频、导致浏览器原生音量按钮
变灰。上传签名继续保持 10 分钟；没有公开 Bucket，也没有改变 DAL owner 边界。真实“加减法入门”
Artifact 的两个视频均确认包含 `AAC-LC / 44.1 kHz / stereo` 音轨，Windows 与 Linux Chromium 均可
解码；刷新课堂后返回的两个视频 URL 均为 `X-Amz-Expires=14400`。对应的 S3 TTL 单测按 TDD 先红后绿，
最终 API unit `12 files / 71 tests passed`、API integration `9 files / 85 tests passed`、API/Web typecheck、
定向 ESLint、Chalkboard 视频 E2E 与 `git diff --check` 均通过。

1. 由产品方在当前 worktree 做最后人工验收，重点检查真实 DeepSeek + Ark 生成、浏览器语音和课堂学习体验；
2. 人工验收通过后再执行第 6 步：审阅改动范围并创建提交；当前 Agent 不自行提交或推送；
3. 所有已部署环境完成 Artifact JSONB 回填后，另起独立 contract migration 删除
   `content_object_key`，不与 V2 功能提交混合。

Discussion Transcript、课堂 Chat 后端、AI 老师实时对话、Director/参与 Agent、
讨论 ASR/TTS 和 live whiteboard Action 均不在上述顺序中；它们等待 V3 前端与会话管理设计。
PBL 和学生自由手写白板同样不属于 V2，不作为当前分支遗留实现项。
大纲 SSE 增量预览、大纲审阅编辑和逐 Scene 进入生成中课堂也不属于 V2；这些能力等待
[V3 渐进式课堂生成规格](../spec/chalkboard-v3-generation.md)按 OpenMAIC 固定提交的原始链路实施：
第一幕完成后进入 owner-scoped Draft Preview，全部完成后才发布 Artifact；不引入增量 Artifact revision。

## 15. 参考入口

- [V2 工程迁移计划](../plan/plan-chalkboard-v2.md)
- [Chalkboard V1 范围](../spec/chalkboard-v1-scope.md)
- [课堂运行时](../spec/chalkboard-v1-runtime.md)
- [内容生成](../spec/chalkboard-v1-generation.md)
- [V3 渐进式课堂生成规格](../spec/chalkboard-v3-generation.md)
- [V3 课堂讨论候选规格](../spec/chalkboard-v3-discussion.md)
- [API 后端分层](../architecture/backend-layers.md)
- [Prompt 管理规范](../architecture/prompts.md)
- [仓库边界](../architecture/repository-boundaries.md)
- [worktree runbook](../runbooks/worktree-development.md)
- [数据库 runbook](../runbooks/database-development.md)
- [V1 最终 handoff](./chalkboard-v1.md)
