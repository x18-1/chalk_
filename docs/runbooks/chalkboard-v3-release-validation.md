# Chalkboard V3 发布验证

> 文档状态：Accepted
> 实施状态：Partial
> 最后核验：2026-08-28

本文定义 Chalkboard V3 合并和发布前的验证分层。浏览器门禁当前只使用 Chromium（Playwright 的
`Desktop Chrome` 配置）；Firefox/WebKit 矩阵已明确推迟，不是 V3 完成条件。

## 1. 三层门禁

### 1.1 确定性代码门禁

在仓库根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

API 集成测试必须使用符合
[数据库开发手册](database-development.md)命名规则的独立 `TEST_DATABASE_URL`。其中 Classroom
Generation 集成测试覆盖最多 10 个不同 Classroom Run 同时取得 worker claim、第 11 个排队、租约恢复、
Candidate Version、幂等确认和逐 Scene 顺序；这证明并发状态机正确，但不等同于生产吞吐压测。

### 1.2 Chromium 课堂门禁

先按 [worktree 开发手册](worktree-development.md)启动当前 worktree 的 PostgreSQL、对象存储、API 和
Web，再显式提供该实例的地址：

```bash
E2E_WEB_URL=http://127.0.0.1:3102 \
E2E_API_URL=http://127.0.0.1:3101 \
pnpm test:e2e:chalkboard
```

该命令只运行 Chromium，覆盖：

- 稳定 Classroom 入口、大纲审阅、Scene 1 提前进入课堂、后续 Scene 追加和显式发布；
- 播放、Scene 切换、Discussion 停止确认、FIFO 语音队列和刷新恢复；
- 应用 chrome 的 serious/critical axe 检查、200% 字号、`prefers-reduced-motion` 和键盘导航；
- 生成/import 内容自身的配色不属于应用 chrome 的 axe 门禁，真实内容质量由 release eval 评审。

不要在 Next.js dev server 正在写同一 `.next` 目录时并行执行 production build。应先跑浏览器测试，再停止
该 Web 进程并执行 build，或为两者使用隔离输出目录。

### 1.3 真实 Provider release eval

自动化 mock 不能证明真实模型首次通过率、课堂讨论套路或媒体 URL 可读。`evals/chalkboard-v3/` 提供
独立 release eval；它不会加入 pull request CI，也不会默认发布 Artifact 或调用付费媒体 Provider。

```bash
# 不访问 API/Provider，只验证案例结构与选择逻辑
pnpm eval:chalkboard-v3 -- --dry-run

# 用专门账号和明确预算运行一个非媒体案例
CHALK_EVAL_API_URL=http://127.0.0.1:3101 \
CHALK_EVAL_EMAIL=eval@example.com \
CHALK_EVAL_PASSWORD='...' \
pnpm eval:chalkboard-v3 -- --scenario=primary-addition-and-subtraction
```

只有发布负责人明确批准真实 Provider 成本后，才运行完整非媒体套件、`--include-media` 或 `--publish`。
凭据只通过环境变量传入；输出位于已忽略的 `evals/runs/`，不得提交 Transcript、Cookie、Provider 原始内部
错误或真实学生数据。跨域预签名媒体 URL 不携带 Chalk 登录 Cookie。

## 2. CI 行为

`.github/workflows/quality.yml` 定义三个相互独立的 job：

1. `static-and-unit`：lint、typecheck、unit、build 和 whitespace；
2. `api-integration`：独立 PostgreSQL 服务和受保护的 test database；
3. `chalkboard-browser`：独立 PostgreSQL、固定版本 MinIO、migration/seed、Chromium 和完整 Chalkboard
   E2E，失败时上传 Playwright 与 API/Web 日志。

工作流只在 pull request 和 `main` push 上运行，不读取真实 Provider secret，不执行付费 eval。当前分支已
定义和本地验证命令/YAML，但在远端首次成功执行前，实施状态保持 `Partial`；远端通过后可将本手册状态
提升为 `Enforced`。

## 3. 发布判定

合并前必须满足：

- 三个确定性层级没有本次变更引入的失败；
- Chromium Chalkboard E2E 全部通过；
- migration 能在空测试数据库顺序应用；
- `git status` 的变更范围与本次意图一致；
- 若改动 Prompt、模型 adapter、Interactive 严格契约或媒体链路，至少运行一个对应真实 Provider eval，
  并按 `evals/chalkboard-v3/rubric.md` 人工复核 Discussion；
- 真实 Provider eval 的失败不能用静默降级、删除严格校验或自动发布来掩盖。

尚未建立的门禁包括长期吞吐/资源压测、真实进程 kill 的系统级演练、formatter 和 package 依赖方向检查；
这些缺口不能被描述成已经由当前 CI 强制。
