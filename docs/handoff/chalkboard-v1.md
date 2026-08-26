# Chalkboard V1 Handoff

> 文档状态：Accepted
> 文档类型：Active branch handoff
> 适用分支：`feat/chalkboard-v1`
> Worktree：`/home/xcodd/code/chalk_/.worktree/chalkboard-v1`
> 基线提交：`c13ed26033f415bb296d96ed52c3643dd80b0056`
> 最后核验：2026-08-26

本文是 Chalkboard V1 当前工作现场的交接记录，不是新的架构规范。架构、仓库边界、数据库和开发流程以 [docs/README.md](../README.md)、仓库根目录 `AGENTS.md` 及其链接的权威文档为准。

## 1. 当前阶段结论与下一目标

OpenMAIC 课堂的前端迁移审查已经完成：两门真实课堂经过同一套 adapter、runtime、
presentation executor 和 scene renderer；播放恢复、场景状态重建、题目/白板/讨论隔离、
内容安全、窄屏布局和文件边界均有回归验证。下一阶段不应继续凭参考仓库文件数量补 UI，
而应在以下两个方向中选择一个明确切片：

1. 接 API/DAL 的 classroom artifact、cursor、Quiz attempt、discussion/Chat transcript 和白板产物持久化；
2. 继续迁移本计划中的内容生成或 scripted discussion 服务端链路。

PBL、编辑器、导出和完整 live Roundtable 仍不在本轮前端迁移范围内。

## 2. 工作环境

当前 worktree 使用以下本地服务约定：

```text
Web:        http://localhost:3102
API:        http://localhost:3101
API health: http://localhost:3101/health
```

开发账号从该 worktree 的 `.env` 读取 `DEV_USER_EMAIL` / `DEV_USER_PASSWORD`。不要把密钥、Cookie、令牌或真实学生数据写入文档、日志或测试。

启动前先检查 `/health`。Chalkboard 默认优先使用 Chalk 固化的本地 fixture；只有课堂尚未固化或显式设置远程模式时才访问 OpenMAIC。因此 OpenMAIC 不是播放固定课堂的前置条件，只用于协议比对和未迁移课堂的参考。远程地址由 `OPENMAIC_BASE_URL` 决定，不要在文档中假定固定端口。

当前工作区包含 2026-08-26 前端迁移审查新增的播放边界、测试和文档改动，尚未提交。继续开发时必须保留，不得使用 `git reset --hard`、`git checkout`、`git stash` 或 `git clean`。

## 3. 当前数据与行为事实

### 3.1 两门课堂

| 课堂 | 入口 | 真实内容 | 动作/能力差异 |
| --- | --- | --- | --- |
| 等式的性质与移项变号 | `/chalkboard?id=4DuyVUkWv3` | 5 个 scene、43 个 action；slide、interactive、quiz | `spotlight`、`speech`、`discussion`、`widget_highlight` |
| 傅里叶变换入门 | `/chalkboard?id=681PbzeDfm` 或 `id=fourier-transform-intro` | `.maic.zip` 导入的 12 个 scene、5 个 agent；含 slide、interactive、quiz、video | 额外包含 `widget_setState`、`laser`、`play_video`；最后一页含 `discussion` |

两门课使用同一条运行路径：

```text
课堂 HTTP/API
  -> openmaic classroom route
  -> adaptOpenMaicClassroomResponse
  -> StageDocument + ChalkboardRuntime
  -> Chalkboard page orchestration
  -> slide / interactive / quiz / Notes / discussion / playback components
```

因此“行为框架”应一致；看到的差异主要来自 authored scene/action 内容。例如等式课没有视频和 `widget_setState`，傅里叶课才会出现视频播放和互动状态控制。下一轮审查要区分“数据没有该能力”和“前端没有实现该能力”。

### 3.2 参与者与头像

OpenMAIC 的 agent 数据可能带 `/avatars/*`、颜色和角色字段；等式课则主要只有 `default-*` agent id。当前前端不再加载 OpenMAIC 头像资源，两门课统一使用 Chalk 自己的首字头像和暖色调色板。头像差异不应再由课堂数据决定。

### 3.3 当前已实现的课堂行为

- 播放控制顺序：音量、倍速、上一页、播放、下一页、自动播放、白板；音量为 0–100 竖向滑杆。
- 默认播放只消费当前 scene；打开自动播放后，完成的 slide 才会进入下一 scene，interactive / quiz 完成自身动作后停住，不再无条件贯穿整门课。
- scene rail 点击只切换 scene，不自动执行首个 action；侧栏课堂记录点击会更新 URL 并真正加载对应课堂。
- `spotlight` / `laser` 是独立的视觉动作，按 OpenMAIC 语义触发后继续队列，不等待 speech；speech 仍按浏览器 TTS 完成推进。
- Notes 按 action 类型显示工具标识；`widget_highlight` 使用聚光语义；discussion 单独显示为课堂提问。
- 课堂 Chat 只显示 authored `discussion` 和学生主动追问，不把普通 speech 或 Interactive action 文案伪装成讨论。
- Interactive 使用不含 `allow-same-origin` 的 sandbox iframe、HTML patch 和按 origin 的 postMessage；支持 highlight、widget state、annotation、reveal；缩略图不再执行第二份互动 HTML。
- video 只在当前 lesson viewport 查找目标，避免缩略图中的同 ID 元素被误播放；倍速会同步到后续 TTS/视频。
- slide 主画布和缩略图使用同一套固定 viewport 坐标，覆盖 text、shape、image、video、latex、table、line 等元素。
- quiz 缩略图使用统一封面，主视图支持必答校验和结果反馈；attempt 按 scene 隔离，短答修改会撤销旧提交结果。
- 白板支持 pointer capture、pointer id 校验、取消事件和清空；全部 authored `wb_*` Action 通过统一 reducer 执行。手写 stroke 按 scene 保存在当前课堂页面会话中，关闭重开不丢，切换课堂会清空。
- 恢复 `playing` snapshot 会在场景挂载后继续队列；恢复/切页会从已消费 Action 前缀重建 discussion、widget 和白板视觉状态，不重放 speech/video/瞬时指示器。
- slide 主 DOM 富文本经 DOMPurify 净化；全局快捷键避开按钮、链接、表单和 tab；PBL 导航和渲染均给出明确 unsupported 状态。
- 桌面保留完整工作区；平板使用可收起侧层；手机使用横向 scene strip 和纵向课堂布局，粗指针交互目标至少 44px。
- `/chat` 只显示对话历史，`/chalkboard` 只显示课堂历史，`/chats` 合并显示两类历史；两个傅里叶课堂别名归并为一个记录。

## 4. 文件组织现状

```text
apps/web/src/app/chalkboard/page.tsx
  路由 query、课堂 shell、runtime controller 装配和用户命令（413 行）

apps/web/src/features/chalkboard/chalkboard.module.css
  Chalkboard feature 内页面与组件共用的响应式样式

apps/web/src/features/chalkboard/components/
  chat-panel.tsx          右侧课堂 Chat
  discussion-dock.tsx     底部课堂讨论、参与者和输入
  interactive-scene.tsx   sandbox interactive iframe
  notes-panel.tsx         Notes action ledger
  playback-controls.tsx   播放控制条
  quiz-scene.tsx          quiz 主视图
  scene-rail.tsx          场景导航与轻量缩略图
  slide-renderer.tsx      slide/缩略图 canvas 渲染
  whiteboard-surface.tsx  白板绘制

apps/web/src/features/chalkboard/lib/
  classroom-client.ts     HTTP classroom 加载与浏览器 cursor adapter
  history.ts              课堂历史与别名归并
  interactive-html.ts     HTML patch 和 widget postMessage
  safe-html.ts            主 DOM authored markup 净化

apps/web/src/features/chalkboard/hooks/
  use-classroom-presentation.ts
                          speech/video/effect/widget/whiteboard 浏览器 executor

packages/chalkboard/src/
  adapter.ts              OpenMAIC envelope -> StageDocument/runtime
  schema.ts               Stage/Scene/Action schema
  runtime.ts              scene/action cursor runtime
  playback.ts             确定性异步播放编排
  presentation-state.ts   可恢复的 discussion/widget/whiteboard 投影
  cursor.ts               cursor snapshot 接口
  import/                 .maic.zip manifest 归一化

apps/web/src/app/api/openmaic/classroom/route.ts
  本地 fixture、固定 zip 和可选远程 OpenMAIC 的课堂代理

tests/e2e/chalkboard.spec.ts
  Chalkboard 端到端回归
```

`page.tsx` 只保留页面装配；远程/本地 classroom transport 与 cursor 在
`classroom-client.ts`，浏览器媒体生命周期在 presentation hook，scene rail 和样式均在
feature 内。不要再为减少行数拆出只转发 props 的薄组件。

## 5. 未完成和明确不等价的部分

- classroom artifact/playback 的服务端持久化、版本冲突和 owner 校验链路；当前 cursor 与课堂历史是浏览器 `localStorage`。
- 课堂 discussion transcript、学生回答、Chat transcript 和 quiz attempt 尚未接 API 持久化。
- 手写白板和 authored 白板投影尚未接 Chalk 的服务端 history/artifact。
- `.maic.zip` 目前是服务端固定包映射，尚未提供用户上传、通用包仓库和数据库媒体资产持久化。
- 完整 Roundtable agent live-session 流程尚未接入；当前讨论是前端本地交互和 authored discussion 展示。
- 内容生成、编辑器、PBL、导出和媒体实际生成入口不在本轮前端迁移范围内；PBL 当前显示明确 unsupported 状态。
- 真实第三方 Provider smoke 尚未完成；当前环境没有 `DASHSCOPE_API_KEY`。

## 6. 已完成的前端迁移门禁

- core schema/adapter/runtime 使用真实 fixture 和 `.maic.zip` compatibility tests；
- authored action、自动播放边界、playing snapshot activate 和 presentation projection 有 package tests；
- desktop 与 390×844 phone E2E 均经过真实浏览器；
- Interactive sandbox、白板重开、视频目标、cursor refresh、课堂别名和 history scope 有 E2E；
- Web typecheck、production build、定向 ESLint、CSS 引用清点和 `git diff --check` 为交付门禁。

兼容 route `/api/openmaic/avatar` 当前课堂 UI 已不引用，但用途可能属于其他迁移调用方，
因此本轮未擅自删除。`apps/web/src/app/api/openmaic/*` 仍是过渡性的 server route；正式
artifact/media/owner 链路应迁入 API 分层，而不是继续扩展 Web route。

## 7. 最近验证

以下命令已在 Web `3102`、API `3101` 运行期间实际执行：

```bash
pnpm --filter @chalk/chalkboard test
pnpm --filter @chalk/web typecheck
pnpm exec eslint apps/web/src/app/chalkboard/page.tsx \
  apps/web/src/features/chalkboard/components/discussion-dock.tsx \
  tests/e2e/chalkboard.spec.ts
E2E_WEB_URL=http://localhost:3102 \
  pnpm exec playwright test tests/e2e/chalkboard.spec.ts --workers=1
git diff --check
```

2026-08-26 最终验证：Chalkboard package `10 files / 31 tests` 通过；Chalkboard E2E
`9 tests` 通过；Web typecheck 和 production build 通过。E2E 实际运行于 Web `3102`、
API `3101`，覆盖 fixture/真实课堂、panel、播放、失败重试与 cursor refresh、Interactive
widget、白板关闭重开、视频、手机布局、历史作用域、课堂别名合并和侧栏课堂切换。

`impeccable detect` 对静态源码报告的主要是 `DESIGN.md` frontmatter 未登记既有 9–11px
metadata、数学画布色阶和 4–10px 内部半径；没有把这些机械改成错误的统一尺寸。白板点阵
属于实际书写画布，不是装饰网格。URL detector 因仓库未安装 Puppeteer 未运行，但相同
390×844 页面已由 Playwright E2E 验证无横向溢出。

## 8. 新对话启动步骤

```text
1. 阅读本 handoff、docs/spec/chalkboard-v1-runtime.md、docs/plan/plan-chalkboard-v1.md、docs/architecture/repository-boundaries.md、docs/architecture/backend-layers.md。
2. 执行 git status，保留所有未提交改动；不要 reset、checkout、stash 或 clean。
3. 检查 http://localhost:3101/health；确认 Web 运行在 3102。
4. 先运行 Chalkboard E2E，确认 9 tests 基线，再打开两个课堂：
   /chalkboard?id=4DuyVUkWv3
   /chalkboard?id=681PbzeDfm
5. 不再重复前端迁移清单；从服务端 persistence、generation 或 scripted discussion 选择一个 seam。
6. 每次只处理一个服务端垂直切片：先写/补回归测试，再修改代码，再运行受影响的 typecheck、lint、test。
7. 完成一轮后更新本 handoff 的“当前状态、未完成项、验证记录和下一步”。
```

## 9. 参考来源

```text
旧迁移分支：feat/chalkboard-openmaic-migration
旧 worktree：/home/xcodd/code/chalk_/.worktree/chalkboard-openmaic-migration
旧 handoff：/home/xcodd/code/chalk_/CHALKBOARD_OPENMAIC_HANDOFF.md
OpenMAIC reference：/home/xcodd/code/chalk_/.reference/OpenMAIC
傅里叶课堂包：packages/chalkboard/傅里叶变换入门.maic.zip
```
