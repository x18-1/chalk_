# 测试与交付验证策略

> 文档状态：Accepted
> 实施状态：Partial
> 适用范围：主 workspace；不含 `agents/`
> 最后核验：2026-08-22

## 1. 原则

- 测试层级由依赖和风险决定，不由目录名称猜测。
- 单元测试不依赖网络、共享数据库、真实时钟或开发者 `.env`。
- 集成测试使用隔离数据库和协议 fixture。
- E2E 使用独立 Web、API、数据库、session 和必要的对象存储。
- 真实 Provider smoke 与普通 CI 分开，不因缺少密钥静默伪装成已验证。
- 修改或新增测试后必须实际运行该测试。
- 几何约束和 DSL 校验必须有确定性单测。

## 2. 测试层级

| 层级 | 测试对象 | 允许依赖 | 默认门禁 |
|---|---|---|---|
| Static | 类型、lint、格式和依赖边界 | 无运行服务 | 必须 |
| Unit | 纯函数、Service 和单个模块接口 | 内存 fake、固定 fixture | 必须 |
| Integration | DAL、migration、API、session、MCP 协议 | 隔离 Postgres、临时目录、本地 fixture server | 必须 |
| E2E | 浏览器中的关键用户流程 | 隔离完整应用栈 | 关键流程必须 |
| Eval | Agent/教学/视觉产出质量 | 固定样例、可选真实模型 | 确定性项门禁；模型评分跟踪 |
| Provider smoke | 真实第三方互操作 | 显式密钥和网络 | 手动/定时，不阻塞普通 PR |

## 3. 命令契约

目标根级命令：

```text
pnpm check:static       # typecheck + lint + format/check + dependency boundary
pnpm test:unit          # 不启动数据库
pnpm test:integration   # 自动准备专用测试数据库并 migrate
pnpm test:e2e           # 自动或明确要求独立完整栈
pnpm eval               # 确定性 eval；真实模型项显式开启
pnpm verify             # 交付前组合门禁
```

其中 `check:static`、`eval` 和组合式 `verify` 尚未实现。当前可用命令和限制：

| 命令 | 当前状态 |
|---|---|
| `pnpm build` | 构建全部 workspace；当前主分支通过 |
| `pnpm typecheck` | Web 先运行 `next typegen`，支持干净 clone 冷启动 |
| `pnpm lint` | 统一 ESLint 门禁；排除 `agents/`、构建物和生成物 |
| `pnpm test:unit` | 仅运行各 workspace 的 unit tests，不需要数据库 |
| `pnpm test:integration` | 校验、创建并 migrate `TEST_DATABASE_URL` 后运行 API integration tests |
| `pnpm test` | 依次运行 `test:unit` 和受保护的 `test:integration` |
| `pnpm test:e2e` | 要求开发者预先启动匹配的 Web/API |

在目标命令落地前，交付说明必须列出实际运行的定向命令和未运行项，不能只写“测试通过”。

## 4. Static Checks

Static 门禁应包含：

- TypeScript strict typecheck；
- ESLint；
- formatter check；
- package 依赖方向检查；
- migration journal 基础一致性检查；
- 不允许 package 导入 `apps/*`；
- 不允许 Web 导入服务端数据库和凭据实现。

Web typecheck 必须能在干净 clone 中运行，不能隐含依赖开发者曾经执行 `next build`。

## 5. Unit Tests

单元测试必须：

- 不读取根 `.env`；
- 不要求 `DATABASE_URL`；
- 不监听固定端口；
- 使用临时目录并在结束后清理；
- 时间逻辑注入 clock 或使用相对当前时间；
- 通过模块公开接口测试，不穿透实现细节。

适合单元测试的对象：Agent tool registry、model selection、Service 业务规则、schema parser、错误映射和确定性编译器。

## 6. Integration Tests

集成测试覆盖：

- migration 与 Drizzle schema；
- DAL owner 隔离；
- Fastify route 到数据库的真实链路；
- JSONL session 持久化和恢复；
- MCP 本地协议 fixture；
- 第三方 adapter 的协议层行为。

每个 worktree 的测试运行应使用独立测试数据库。当前测试 bootstrap 负责：

```text
验证数据库名匹配 chalk_<worktree>_test 且不同于 DATABASE_URL
→ 数据库不存在时创建
→ 应用全部 migration
→ 运行测试
```

测试文件负责清理自己创建的数据。当前 runner 不重建或删除已有测试数据库，因此 migration 可重复执行和 fixture 隔离仍是测试设计的一部分。

测试不得在模块加载期间连接数据库后再临时修改 `process.env`，也不得依赖文件名异常的 `.env `。

## 7. E2E

E2E 默认串行执行会修改全局设置的场景，且必须使用：

- `_e2e` 数据库；
- 独立 `SESSIONS_ROOT`；
- 独立 API/Web 端口；
- 确定性本地 LLM fixture 或显式真实模型开关；
- Playwright trace 和失败截图。

测试启动前应 fail closed 检查 URL、数据库名和进程身份。进程重启类测试必须只操作由 fixture 自己启动并记录 PID 的 API，不能终止来源不明的进程。

## 8. Eval 与测试的区别

```text
Assessment: 判断学生是否掌握
Test:       判断确定性代码行为是否符合 contract
Eval:       判断系统生成内容质量是否退化
```

确定性 eval，例如 DSL 合法性、后置条件和结构 lint，可以作为 CI 门禁。依赖模型或视觉评分的 eval 默认记录趋势，不在没有稳定阈值和低方差前阻塞所有提交。

每个 eval 结果应记录 prompt、model、scorer 和 fixture 版本，并可关联到运行 trace，但不得记录不必要的学生原文。

## 9. 第三方测试

第三方集成分三层：

1. fake：验证业务分支和错误处理；
2. protocol fixture：验证真实 HTTP/SSE/MCP 编解码；
3. real smoke：验证供应商当前接口和凭据配置。

普通 CI 不调用付费或不稳定的真实 Provider。real smoke 必须通过显式环境开关运行，并在报告中区分“未运行”“通过”“失败”，不能把缺少密钥记为通过。

## 10. 已知测试缺口

当前审计确认的剩余缺口：

- API package 的默认 `test` 和根 `pnpm test` 已使用 unit/integration 分离入口，但 integration 仍依赖本机可访问的 Postgres；
- integration runner 不为每次运行重建数据库，也不支持并发运行共享同一 `TEST_DATABASE_URL`；
- approval recovery 测试已改用相对当前时间，但生产代码尚无统一可注入 clock；
- 根级 Turbo 不覆盖 `agents/`，这是有意的范围约束；
- E2E 不负责自动启动 Web/API；
- 仓库尚无 CI workflow、formatter 门禁、自动依赖方向检查和 coverage threshold。

基础设施治理应先解决可重复运行和隔离，再讨论覆盖率数字。覆盖率不能替代 owner 隔离、migration、恢复和关键用户流程测试。

## 11. 交付报告

每次代码交付至少说明：

```text
Changed behavior:
Static checks run:
Tests run:
Integration/E2E environment:
Tests not run and why:
Known residual risk:
```

“受影响测试通过”必须对应实际命令；Turbo cache 回放、跳过和真实执行要在结果中区分。
