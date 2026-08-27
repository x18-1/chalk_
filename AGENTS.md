# Chalk

面向小学、初中学生的交互式学习产品。目标不是回答问题，而是教会学生解一类题目、学会一个知识点，并长期跟踪其成长。

目标是：企业级项目。

本文件只定义所有开发 Agent 共享的仓库规则。产品设计、架构、技术调研和运行手册放在 `docs/`。
注意：`docs/` 下的文档是持续维护的项目资料；发现内容、分类或规则不合理时，应在讨论确认后同步更新对应文档。

- 文档索引与权威顺序：`docs/README.md`
- 功能定义：`docs/spec/functional-spec.md`
- 技术栈：`docs/architecture/tech-stack.md`
- 仓库与 package 边界：`docs/architecture/repository-boundaries.md`
- API 后端分层：`docs/architecture/backend-layers.md`
- Prompt 管理：`docs/architecture/prompts.md`
- Worktree 开发：`docs/runbooks/worktree-development.md`
- 数据库开发：`docs/runbooks/database-development.md`
- 参考项目调研：`docs/researsh/`

## 项目约束

以下决定已确认，不要在未询问的情况下偏离：

- 全栈 TypeScript。后端（认证、CRUD、业务逻辑、数据访问）同样在 TS，不引入 Python。
- Agent 运行时使用 `@earendil-works/pi-agent-core`，版本锁定，不用 `^`。
- 几何渲染使用 `manim-web`，版本锁定。几何约束层自建，不绑渲染器的对象模型。
- 数据库 Postgres + Drizzle。
- 第一批学科只做数学。

### 不可违反的设计约束

- **数据访问层强制 owner 校验**，不在各端点里分散实现。认证异常时 fail closed，不静默回退到默认身份。
- **产品 Prompt 集中管理并维护英文/中文配对版本**：运行时只读取英文版，中文版供人审阅；
  Tool/参数描述、Skill、运行时用户数据和测试文本按 `docs/architecture/prompts.md` 的边界就近
  维护。从固定参考实现迁移 Prompt 时非必要不改动英文内容，并保留 provenance。


## 开发流程

- 先回答问题；只有用户要求修改、实现或修复时才编辑文件。
- 修改前阅读直接相关的代码、配置和测试，确认影响范围。
- 保持改动聚焦于当前任务，不顺带重构、格式化无关文件或升级依赖。
- 不删除用途不明确的代码或功能；无法确认时先询问用户。
- 不猜测第三方 API、依赖类型或许可证，优先检查实际版本的源码、类型和官方文档。
- 不在代码、文档、日志或提交中写入密钥、Cookie、令牌或其他机密信息。
- 前端使用 impeccable skills
- 后端相关开发 使用Matt Pocock 风格的工程 skill 集。

### 文档同步

- `docs/README.md` 是文档分类、状态和权威顺序的索引；文档路径或分类发生变化时，必须同步更新该索引。
- 移动、重命名或新增权威文档时，必须同步检查 `AGENTS.md`、`apps/`、`packages/` 和 `docs/` 中的交叉引用。
- 行为、架构或开发流程发生变化时，在同一变更中更新对应的权威文档；阶段计划完成后移动到正确分类并标记为 `Historical`。
- `docs/runbooks/` 中的命令和流程必须以当前仓库实际可验证的状态为准；目标状态要明确标注，不能写成已经可执行的流程。

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
