# Chalk

面向小学、初中学生的交互式学习产品。目标不是回答问题，而是教会学生解一类题目、学会一个知识点，并长期跟踪其成长。

目标是：企业级项目。

本文件只定义所有开发 Agent 共享的仓库规则。产品设计、技术调研和运行手册放在 `docs/`。
注意：`docs/` 下的文档是初步版本，不合理的你可以提出，随着我们进行对话可以对起内容进行更新！！

- 功能定义：`docs/functional-spec.md`
- 技术栈：`docs/tech-stack.md`
- 参考项目调研：`docs/researsh/`

## 项目约束

以下决定已确认，不要在未询问的情况下偏离：

- 全栈 TypeScript。后端（认证、CRUD、业务逻辑、数据访问）同样在 TS，不引入 Python。
- Agent 运行时使用 `@earendil-works/pi-agent-core`，版本锁定，不用 `^`。
- 几何渲染使用 `manim-web`，版本锁定。几何约束层自建，不绑渲染器的对象模型。
- 数据库 Postgres + Drizzle。
- 第一批学科只做数学。
- `packages/` 只放两个深模块：通用 `agent-runtime` 和承接 OpenMAIC 迁移的 `chalkboard`。数据库、认证、学习领域和具体 adapter 属于后端，先放在 `apps/api/src`；新增 workspace package 前必须先确认存在稳定的独立 seam。
- `apps/web` 是独立的 Next.js 前端，只包含页面、组件、浏览器状态和 HTTP/SSE client；它不能导入 Drizzle、Postgres、Pi runtime、认证实现或对象存储 SDK。`apps/api` 是独立的 Fastify 后端，负责认证、业务流程、数据访问、Agent 装配和外部资源访问。
- 默认依赖方向是 `apps/web` 通过 HTTP/SSE 调用 `apps/api`，`apps/api` 组合 `agent-runtime` 与 `chalkboard`。两个 package 不依赖任何 app；`agent-runtime` 保持通用，不依赖 `chalkboard`，而 `chalkboard` 可按需单向依赖 `agent-runtime` 的稳定公共接口，但不得形成循环依赖。

### 不可违反的设计约束

- **数据访问层强制 owner 校验**，不在各端点里分散实现。认证异常时 fail closed，不静默回退到默认身份。


## 开发流程

- 先回答问题；只有用户要求修改、实现或修复时才编辑文件。
- 修改前阅读直接相关的代码、配置和测试，确认影响范围。
- 保持改动聚焦于当前任务，不顺带重构、格式化无关文件或升级依赖。
- 不删除用途不明确的代码或功能；无法确认时先询问用户。
- 不猜测第三方 API、依赖类型或许可证，优先检查实际版本的源码、类型和官方文档。
- 不在代码、文档、日志或提交中写入密钥、Cookie、令牌或其他机密信息。
- 前端使用 impeccable skills
- 后端相关开发 使用Matt Pocock 风格的工程 skill 集。

## 验证

- 修改代码后，运行受影响的格式化、静态检查和测试命令。
- 修改或新增测试时，必须运行该测试并修复由本次改动引入的问题。
- 仓库尚未定义命令时，执行可行的定向验证，并在交付时说明已运行和未运行的验证。
- 几何约束层和 DSL 校验的改动必须有对应单测，这两处的正确性不靠人工检查。

## Git

- 提交前运行 `git status`，确认工作区和暂存区的改动范围。
- 只暂存本次任务自行修改的明确路径：使用 `git add <path>`，不要使用 `git add .` 或 `git add -A`。
- 除非用户明确要求，不创建提交、不推送、不创建 PR，也不修改远程仓库状态。
- 禁止使用可能覆盖他人改动的命令：`git reset --hard`、`git checkout .`、`git clean -fd`、`git stash`、`git commit --no-verify`。
- 遇到不属于本次任务的冲突或未预期改动，不要覆盖或回退它们；保留并询问用户。
- 一个提交只包含一个可审查的意图，不混入无关文件。

### 提交信息

使用 Conventional Commits 格式：

```text
<type>(<scope>): <summary>
```

- `type` 使用：`feat`、`fix`、`docs`、`test`、`refactor`、`chore`。
- `scope` 可选，使用稳定的模块名；尚未形成模块时省略。
- `summary` 简洁描述结果，使用英文或中文均可，不使用表情符号，不以句号结尾。
