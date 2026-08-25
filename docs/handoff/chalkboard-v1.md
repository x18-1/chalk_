# Chalkboard V1 Handoff

> 文档状态：Accepted
> 文档类型：Active branch handoff
> 适用分支：`feat/chalkboard-v1`
> Worktree：`/home/xcodd/code/chalk_/.worktree/chalkboard-v1`
> 基线提交：`c13ed26033f415bb296d96ed52c3643dd80b0056`
> 最后核验：2026-08-25

本文是 Chalkboard V1 当前工作现场的交接记录，不是新的架构规范。架构、仓库边界、数据库和开发流程以 [docs/README.md](../README.md)、仓库根目录 `AGENTS.md` 及其链接的权威文档为准。

## 1. 下一轮工作的目标

下一次对话继续做“前端迁移审查”，而不是重新搭建课堂。重点回答：

1. OpenMAIC 的真实课堂行为是否都被 Chalk 前端覆盖；
2. 两门真实课堂是否经过同一套数据适配、渲染和播放运行时；
3. slide、interactive、quiz、video、Notes、discussion、白板和侧栏是否仍有遗漏或行为偏差；
4. 当前文件拆分是否合理，哪些逻辑应该从页面编排层继续抽取。

本轮审查应以真实 API 返回和仓库内 `.maic.zip` 为依据，不以旧 handoff 中的“尚未开始”描述推断当前状态。

## 2. 工作环境

当前 worktree 使用以下本地服务约定：

```text
Web:        http://localhost:3102
API:        http://localhost:3101
API health: http://localhost:3101/health
```

开发账号从该 worktree 的 `.env` 读取 `DEV_USER_EMAIL` / `DEV_USER_PASSWORD`。不要把密钥、Cookie、令牌或真实学生数据写入文档、日志或测试。

启动前先检查 `/health`。Chalkboard 默认优先使用 Chalk 固化的本地 fixture；只有课堂尚未固化或显式设置远程模式时才访问 OpenMAIC。因此 OpenMAIC 不是播放固定课堂的前置条件，只用于协议比对和未迁移课堂的参考。远程地址由 `OPENMAIC_BASE_URL` 决定，不要在文档中假定固定端口。

当前工作区存在大量未提交的 API、Provider、数据库、Web 和文档改动，均属于用户工作现场。继续开发时必须保留，不得使用 `git reset --hard`、`git checkout`、`git stash` 或 `git clean`。

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
- scene rail 点击只切换 scene，不自动执行首个 action；侧栏课堂记录点击会更新 URL 并真正加载对应课堂。
- `spotlight` / `laser` 是独立的视觉动作，按 OpenMAIC 语义触发后继续队列，不等待 speech；speech 仍按浏览器 TTS 完成推进。
- Notes 按 action 类型显示工具标识；`widget_highlight` 使用聚光语义；discussion 单独显示为课堂提问。
- 课堂 Chat 只显示 authored `discussion` 和学生主动追问，不把普通 speech 或 Interactive action 文案伪装成讨论。
- Interactive 使用 sandbox iframe、HTML patch 和 postMessage；支持 highlight、widget state、annotation、reveal。
- video 只在当前 lesson viewport 查找目标，避免缩略图中的同 ID 元素被误播放；倍速会同步到后续 TTS/视频。
- slide 主画布和缩略图使用同一套固定 viewport 坐标，覆盖 text、shape、image、video、latex、table、line 等元素。
- quiz 缩略图使用统一封面，主视图支持必答校验和结果反馈。
- 白板支持 pointer capture、pointer id 校验、取消事件和清空；stroke history 目前只保存在当前页面。
- `/chat` 只显示对话历史，`/chalkboard` 只显示课堂历史，`/chats` 合并显示两类历史；两个傅里叶课堂别名归并为一个记录。

## 4. 文件组织现状

```text
apps/web/src/app/chalkboard/page.tsx
  页面编排、课堂请求、runtime 状态、播放 executor、路由 query、场景栏

apps/web/src/app/chalkboard/chalkboard.module.css
  Chalkboard 页面和课堂组件共用的视觉样式

apps/web/src/features/chalkboard/components/
  chat-panel.tsx          右侧课堂 Chat
  discussion-dock.tsx     底部课堂讨论、参与者和输入
  interactive-scene.tsx   sandbox interactive iframe
  notes-panel.tsx         Notes action ledger
  playback-controls.tsx   播放控制条
  quiz-scene.tsx          quiz 主视图
  slide-renderer.tsx      slide/缩略图 canvas 渲染
  whiteboard-surface.tsx  白板绘制

apps/web/src/features/chalkboard/lib/
  history.ts              课堂历史与别名归并
  interactive-html.ts     HTML patch 和 widget postMessage

packages/chalkboard/src/
  adapter.ts              OpenMAIC envelope -> StageDocument/runtime
  schema.ts               Stage/Scene/Action schema
  runtime.ts              scene/action cursor runtime
  playback.ts             确定性异步播放编排
  cursor.ts               cursor snapshot 接口
  import/                 .maic.zip manifest 归一化

apps/web/src/app/api/openmaic/classroom/route.ts
  本地 fixture、固定 zip 和可选远程 OpenMAIC 的课堂代理

tests/e2e/chalkboard.spec.ts
  Chalkboard 端到端回归
```

当前 `page.tsx` 仍然是编排层，下一轮优先评估是否抽取 `useClassroomLoader`、`useClassroomPlayback`、课堂 shell/scene rail，而不是先做无测试的大规模重构。CSS 也要检查是否存在重复定义和页面组件耦合。

## 5. 未完成和明确不等价的部分

- classroom artifact/playback 的服务端持久化、版本冲突和 owner 校验链路；当前 cursor 与课堂历史是浏览器 `localStorage`。
- 课堂 discussion transcript、学生回答、Chat transcript 和 quiz attempt 尚未接 API 持久化。
- 白板尚未迁移 OpenMAIC 的服务端 history。
- `.maic.zip` 目前是服务端固定包映射，尚未提供用户上传、通用包仓库和数据库媒体资产持久化。
- 完整 Roundtable agent live-session 流程尚未接入；当前讨论是前端本地交互和 authored discussion 展示。
- 内容生成、编辑器、PBL、导出和媒体实际生成入口不在本轮前端迁移范围内。
- 真实第三方 Provider smoke 尚未完成；当前环境没有 `DASHSCOPE_API_KEY`。

## 6. 下一轮前端迁移审查清单

### 数据契约

- 对比两个课堂的 API JSON、zip manifest、`normalizeClassroomDocument` 和 `parseStageDocument`，确认字段没有静默丢失。
- 检查 agent 的 `teacher`、`assistant`、`student` 角色归一化，以及缺少 id 时的稳定 id。
- 对每个 action 类型确认 schema、adapter、runtime、page executor、Notes 显示和 E2E 覆盖是一致的。

### 渲染完整性

- 逐 scene 比较主画布和缩略图的比例、位置、公式、表格、图片、视频、线条和背景。
- 检查 interactive 的初始状态、postMessage 时机、缩略图缩放和 iframe 失败恢复。
- 检查 quiz 的封面、题目、选项、提交校验和结果状态。
- 检查视频资源路径、自动播放策略、倍速和切页后的目标查找。

### 播放行为

- 验证 `spotlight/laser`、speech、video、discussion、widget actions 的真实顺序和取消/暂停/恢复行为。
- 验证 scene 切换、上一页/下一页、刷新恢复、自动播放和完成态不会重复消费 action。
- 对照 OpenMAIC `ActionEngine` 和 `CanvasToolbar`，记录每个有意差异，不凭感觉修改时序。

### 文件组织和视觉

- 评估 `page.tsx` 是否仍承担过多 loader、播放和 UI 状态。
- 清理 CSS 重复选择器，确认组件样式不会依赖无关页面状态。
- 检查 `/api/openmaic/avatar` 等已不再被课堂 UI 使用的兼容代码，先确认引用后再决定保留或移除。
- 检查两门课堂的头像、讨论、Notes、缩略图和空态是否使用 Chalk 统一视觉，而不是直接复制 OpenMAIC 资源。

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

结果：chalkboard package `9 files / 25 tests` 通过；Chalkboard E2E `8 tests` 通过；Web typecheck、定向 ESLint 和 `git diff --check` 通过。E2E 覆盖 fixture/真实课堂、panel、Interactive widget、白板、cursor 恢复、视频、历史作用域、课堂别名合并和侧栏课堂切换。

## 8. 新对话启动步骤

```text
1. 阅读本 handoff、docs/spec/chalkboard-v1-runtime.md、docs/plan/plan-chalkboard-v1.md、docs/architecture/repository-boundaries.md、docs/architecture/backend-layers.md。
2. 执行 git status，保留所有未提交改动；不要 reset、checkout、stash 或 clean。
3. 检查 http://localhost:3101/health；确认 Web 运行在 3102。
4. 先运行 Chalkboard E2E，建立当前基线，再打开两个课堂：
   /chalkboard?id=4DuyVUkWv3
   /chalkboard?id=681PbzeDfm
5. 读取真实 API/zip 数据，建立“数据字段 -> adapter -> runtime -> UI”迁移清单。
6. 每次只处理一个遗漏或组织问题：先写/补回归测试，再修改代码，再运行受影响的 typecheck、lint、test。
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
