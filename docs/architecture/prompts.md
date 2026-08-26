# Prompt 管理规范

> 文档状态：Accepted
> 实施状态：Documented
> 适用范围：`main`、所有功能分支和 worktree 中由 Chalk 维护并发送给 AI 的产品 Prompt
> 最后核验：2026-08-26

本文定义 Chalk 产品 Prompt 的归属、文件结构、双语维护、运行时加载、迁移保真和验证规则。
目标是让模型行为集中可审查、可追溯、可测试，同时让确实属于代码接口的短描述留在其所属
模块，避免为了目录整齐破坏局部性。

## 1. 核心规则

- 可复用且影响产品行为的 system Prompt、developer-style instructions、任务 Prompt、角色
  Prompt、输出约束和共享指令片段，统一由 `apps/api/src/prompts/` 管理；
- 每份运行时 Prompt 同时维护英文版和中文版；英文版是 AI 实际读取的执行版本，中文版只
  用于人类阅读、评审和理解，不进入模型上下文；
- 同一 Prompt 的英文版与中文版必须在同一个变更中保持语义、模板变量、条件块、snippet
  引用和输出契约一致；
- 业务 Service、Agent 装配和 Generation Run 只能按稳定 `promptId` 调用 Prompt 模块，不能
  知道模板文件路径，也不能自行选择运行语言；
- 新增或修改的产品 Prompt 不得以内联长字符串散落在 Route、Service、Provider adapter、
  Agent 装配或 Web 代码中；
- 从参考项目迁移 Prompt 时默认保留经过验证的英文内容，非必要不改写、不润色、不压缩。

本规范是全仓规则，不只适用于 Chalkboard V2。V2 合并回 `main` 后，后续 Chat、Chalkboard
及其他 AI 能力都遵循同一规范。

## 2. 目录与命名

目标结构：

```text
apps/api/src/prompts/
├── README.md
├── index.ts
├── loader.ts
├── registry.ts
├── templates/
│   └── <prompt-id>/
│       ├── system.en.md
│       ├── system.zh-CN.md
│       ├── user.en.md          # 需要静态 user template 时成对出现
│       └── user.zh-CN.md
└── snippets/
    ├── <snippet-id>.en.md
    └── <snippet-id>.zh-CN.md
```

- `prompt-id`、`snippet-id` 使用 `kebab-case`；
- 模板变量和条件名使用 `camelCase`；
- `system`、`user` 表示消息角色，不表示文件语言；
- 英文使用 `.en.md`，简体中文使用 `.zh-CN.md`，不使用含义不明的 `.md` 默认语言；
- `user` 模板是可选的，但存在任一语言版本时必须有对应的另一语言版本；
- 多个 Prompt 重复的稳定指令放入 `snippets/`，一次性短句不为复用而强行抽取。

`packages/agent-runtime` 继续只接收调用方装配好的 `systemPrompt`，不拥有 Chalk 产品 Prompt；
`packages/chalkboard` 负责确定性的课堂模型和运行时，也不从 `apps/api` 导入 Prompt 文件。

## 3. Prompt 模块的 seam

Prompt 模块对调用方提供小而稳定的 interface，例如：

```ts
type BuiltPrompt = {
  system: string;
  user?: string;
  revision: string;
};

buildPrompt(promptId, variables): BuiltPrompt
```

具体类型以实现时的测试驱动设计为准，但必须满足：

- 调用方只提供 `promptId` 和结构化变量；
- loader 固定读取英文模板，不接受来自 Route、请求或数据库的 locale 来切换为中文版；
- 文件发现、snippet 展开、条件处理、变量插值和内容 revision 计算由模块内部完成；
- 缺失 Prompt、双语配对不完整、未知 snippet 或完整渲染后仍有占位符时 fail loud；
- `revision` 由实际执行的英文模板及其 snippet 内容确定，不靠开发者手工递增；
- Generation Run、Agent Run 或关联 Trace 能记录 `promptId + revision`，但不得把含用户数据的
  完整渲染 Prompt 写入普通日志或 telemetry；
- loader 不依赖启动进程的 `cwd`。API build 必须把 Prompt 资产包含在可部署产物中，并验证
  `node dist/server.js` 从不同工作目录启动时仍能读取英文模板。

代码负责流程、选择、数据格式化和条件值；Markdown 负责模型要阅读的稳定指令。角色或场景
分支可以由 TypeScript 选择不同 `promptId`、snippet 或变量，但不应把成段指令重新写回分支
代码。这个 seam 同时作为调用方和测试的观察面。

## 4. 双语维护

英文版与中文版是一对文件，但职责不同：

- `.en.md`：唯一运行时输入，决定实际模型行为；
- `.zh-CN.md`：英文版的忠实中文镜像，帮助产品、研发和评审者理解，不参与执行。

双语同步要求：

1. 标题层级、列表结构、模板变量、条件块和 snippet 引用保持一致；
2. JSON 字段、Tool 名、Action 名、枚举、代码、占位符和其他机器契约不得翻译；
3. 中文版不能增加英文版不存在的行为要求，也不能遗漏限制条件；
4. 修改行为语义时同一提交更新两种语言；只修正中文翻译且不改变英文时，不构成运行时
   Prompt 行为变更；
5. 调用方、测试和生产配置都不得读取 `.zh-CN.md` 作为模型输入。

结构一致由自动化测试验证；语义一致由评审负责。不要使用运行时自动翻译代替仓库中的中文
版本，也不要维护脱离英文执行版本的中文摘要。

## 5. 集中管理的边界

需要集中管理的是由 Chalk 编写、可复用且会改变模型产品行为的指令，包括：

- 主 Agent、子 Agent、Director 和课堂参与 Agent 的基础行为；
- 会话标题、查询改写、内容生成、Scene/Action 生成和结构化输出规则；
- Classroom Generation Run 各阶段的 system/user templates；
- 多处复用的教学、媒体、安全、JSON、白板和语言规则；
- 重试时仍然稳定存在的纠错或输出修复指令。

以下内容保留在其真正所属的模块，不为了形式统一搬入 Prompt 目录：

- Tool 的名称、description、参数 description 和 schema 枚举说明：它们属于 Tool interface，
  必须与实现和 schema 就近维护；
- Skill 的 frontmatter、`SKILL.md` 和按 Skill 协议加载的正文：Skill 是独立指令资源；
- 用户输入、上传文件内容、数据库中的用户资料以及根据当前状态生成的数据块：它们是运行时
  数据，不是仓库维护的 Prompt 模板；
- 将结构化状态确定性格式化为文本的短标签、分隔符和字段名；
- Provider 协议字段、用户提供的图片/视频生成描述，以及连接测试使用的最小 smoke 字符串；
- 单元测试、fixture 和 eval case 中只为构造场景使用、不会进入产品运行路径的测试文本。

例外不是放置长产品指令的通道。只要一段文字同时具备“Chalk 编写、进入产品模型上下文、
跨调用稳定、修改会改变产品行为”四个特征，就应进入集中 Prompt 目录。无法判断时先在评审
中确认，不自行扩大例外。

## 6. 从参考项目迁移

迁移 OpenMAIC 或其他已固定版本参考实现的 Prompt 时，先迁移行为，再讨论优化：

1. 在 registry 中记录来源仓库、固定提交、原始路径和本地 `promptId`；
2. 英文执行版在兼容时按规范化 LF 与文件末尾换行后保持内容一致；
3. 新增忠实的 `.zh-CN.md` 配对文件，不以翻译为由顺带改写英文版；
4. 先用 provenance/hash 测试证明迁移内容与固定来源一致，再接入变量和运行时；
5. 只有原 Prompt 与 Chalk 的真实接口、安全约束或已支持能力不兼容时才做最小修改；
6. 必要修改必须在 registry 的 provenance metadata 或邻近测试中记录原因，并让 diff 能单独
   审查；不要在同一次迁移中做风格润色、措辞偏好调整或未经 eval 证明的“优化”。

可以构成必要修改的情形包括 Tool/Action/JSON 契约不同、引用了 Chalk 没有的能力、产品名或
运行上下文错误，以及会违反 Chalk 安全与数据边界的指令。单纯觉得另一种写法更清晰、更短、
更自然，不构成迁移时修改英文 Prompt 的理由。

迁移后的优化属于独立 Prompt 变更：必须同时更新双语版本、结构/行为测试和相关 eval，并保留
可回溯到原始 Prompt 的 provenance。

## 7. 验证门禁

Prompt 模块实现后至少自动验证：

- registry 中每个 Prompt ID 的必需文件存在；
- 英文/中文模板和 snippet 一一配对；
- 双语文件的变量名、条件名和 snippet 引用集合完全相同；
- snippet 不存在、循环引用或模板文件缺失时加载失败；
- 完整构建结果不残留 `{{...}}` 占位符；
- 生产 loader 只读取英文文件；
- build 产物包含所需 Prompt 资产，且运行不依赖仓库根目录作为 `cwd`；
- 迁移且未适配的英文 Prompt 与固定参考提交通过 provenance/hash 校验；
- 关键 Prompt 通过结构化行为测试，重要语义变化通过对应 eval；
- Trace/Generation Run 能关联 `promptId + revision`，日志不泄露完整用户 Prompt 或敏感数据。

当前主分支仍有主 Agent、子 Agent 和会话标题等内联产品 Prompt，因此实施状态为
`Documented`。后续新增 Prompt 必须立即遵守本规范；既有内联 Prompt 在其所属能力被直接
修改或迁移时成对移入集中目录，不把纯目录迁移与无关行为改写混在一起。
