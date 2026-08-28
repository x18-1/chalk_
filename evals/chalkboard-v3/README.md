# Chalkboard V3 Release Eval

这个套件验证自动化 mock 无法回答的四个问题：

1. 真实 LLM 的大纲流是否能被完整消费并通过 Candidate/Revision 契约；
2. slide、quiz、interactive 的 content/actions 首次生成通过率；
3. 多 Agent 讨论是否遵守教师优先、最多三名 Agent、身份可信和适时结束；
4. 真实图片/视频任务完成后，浏览器可用的媒体 URL 是否真的返回对应内容。

## 运行

先启动目标 API，并使用专门的测试账号和预算：

```bash
CHALK_EVAL_API_URL=http://127.0.0.1:3101 \
CHALK_EVAL_EMAIL=eval@example.com \
CHALK_EVAL_PASSWORD='...' \
pnpm eval:chalkboard-v3
```

默认只运行不含付费媒体的合成案例，并且不发布最终 Artifact。额外开关：

```bash
# 包含明确标记为 media 的图片/视频案例
pnpm eval:chalkboard-v3 -- --include-media

# 通过全部发布门禁后发布 Artifact
pnpm eval:chalkboard-v3 -- --publish

# 只检查案例结构和选择参数，不调用 API/Provider
pnpm eval:chalkboard-v3 -- --dry-run

# 只运行一个案例，适合发布前控制真实 Provider 成本
pnpm eval:chalkboard-v3 -- --scenario=primary-addition-and-subtraction
```

`--scenario` 可以与 `--include-media`、`--publish` 组合。媒体案例中的 Provider ID 必须与目标测试账号
已经配置的 Provider 一致。runner 只对同源 Chalk API 携带登录 Cookie；访问跨域预签名媒体 URL 时不会
转发会话。

输出写入 `evals/runs/chalkboard-v3/<timestamp>/`：

- `result.json`：机器可读的阶段、耗时、Provider/model 和确定性检查；
- `report.md`：供发布评审阅读的汇总；
- 讨论 Transcript 仅来自本目录的合成学生输入，仍不得直接提交。

## 发布判定

- 确定性检查必须全部通过；
- 每个非媒体案例至少成功生成一次完整课堂；
- Interactive 首次严格契约通过率单独报告，不能用静默降级掩盖；
- Discussion 必须再按 [`rubric.md`](rubric.md) 人工评分；
- media smoke 必须验证实际响应状态和 `Content-Type`，不能只看任务状态为 `completed`；
- 失败时保留稳定公开错误和阶段信息，报告不得包含密钥或 Provider 原始内部错误。
