# 新电脑迁移手册

> 文档状态：Historical
> 适用快照：2026-08-13 生成的迁移包
> 最后核验：2026-08-22
> 说明：本文只用于恢复指定历史备份，不是日常 worktree 或数据库开发规范。日常流程见 [worktree-development.md](worktree-development.md) 和 [database-development.md](database-development.md)。

本文档用于把 Chalk 开发环境从旧电脑迁移到新电脑。适用于 2026-08-13 生成的 `chalk-migration-2026-08-13.tar.gz` 备份包。

迁移原则：代码从 GitHub 重新克隆；备份包只负责 Git 不会保存的密钥、数据库和本地 Agent 会话。不要迁移 `node_modules`、`.next`、`dist` 或 Turbo 缓存。

## 1. 备份包包含什么

```text
chalk-migration-2026-08-13/
├── README.md
├── MANIFEST.sha256
├── git/
│   ├── chalk.bundle
│   └── repository-state.txt
├── env/
│   ├── agent-harness.env
│   └── main-env-legacy
├── database/
│   ├── chalk.dump
│   ├── chalk_openmaic_test.dump
│   └── chalk_openmaic_e2e.dump
└── sessions/
    ├── main-api-data/
    └── agent-harness-api-data/
```

- `agent-harness.env` 是 `feat/agent-harness-hardening` 工作树实际使用的环境配置。
- `main-env-legacy` 来自旧电脑主工作树中名称末尾带空格的 `.env ` 文件。该文件通常不会被 dotenv 自动加载，仅作为历史配置保留，不要盲目覆盖新环境。
- `chalk.bundle` 是主仓库的离线 Git 备份。正常情况下优先从 GitHub 克隆，仅在远端不可用时使用 bundle。
- 数据库 dump 使用 PostgreSQL custom 格式，可用 `pg_restore` 恢复。
- `sessions/` 保存本地 Pi/Agent JSONL 会话。它们不是恢复项目运行的必要条件。
- MinIO 的 `chalk-uploads` 和 `chalk-backups` 在打包时均为空，因此没有导出对象存储数据。

备份包包含 API Key、密码、加密密钥以及可能的对话内容。它不是加密包，即使文件权限被设置为仅当前用户可读，也必须通过可信介质传输并妥善保管。

## 2. 新电脑准备

以下步骤以 Linux 或 WSL2 为例。安装：

- Git
- Docker 与 Docker Compose
- Node.js 24（旧环境为 `v24.17.0`）
- pnpm `11.20.0`

启用锁定的 pnpm 版本：

```bash
corepack enable
corepack prepare pnpm@11.20.0 --activate

node --version
pnpm --version
docker --version
docker compose version
```

重新配置 Git 用户信息和 GitHub 身份验证，不要直接复制旧电脑的凭据缓存：

```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

## 3. 解压并验证备份

先把压缩包和旁边的 `.sha256` 文件复制到新电脑，再执行：

```bash
sha256sum -c chalk-migration-2026-08-13.tar.gz.sha256
tar -xzf chalk-migration-2026-08-13.tar.gz
cd chalk-migration-2026-08-13
sha256sum -c MANIFEST.sha256
```

两次校验均应显示 `OK`。如果失败，不要继续恢复密钥或数据库，应重新复制备份包。

## 4. 克隆仓库和恢复工作树

正常情况下从 GitHub 克隆：

```bash
git clone --recurse-submodules https://github.com/x18-1/chalk_.git
cd chalk_
git fetch --all --prune
mkdir -p .worktree

git worktree add \
  -b feat/agent-harness-hardening \
  .worktree/agent-harness \
  origin/feat/agent-harness-hardening

git worktree add \
  -b feat/chalkboard-openmaic-migration \
  .worktree/chalkboard-openmaic \
  origin/feat/chalkboard-openmaic-migration

git worktree list
```

如果本地分支名已经存在，去掉 `-b <分支名>`，改为把已有分支作为最后一个参数：

```bash
git worktree add .worktree/agent-harness feat/agent-harness-hardening
git worktree add .worktree/chalkboard-openmaic feat/chalkboard-openmaic-migration
```

打包时三个关键分支的提交是：

```text
main                                0ea6c3adb2cc13647b52cad620512d2043f3fc98
feat/agent-harness-hardening        b436001d9552ac8811efa132791ae2591900945e
feat/chalkboard-openmaic-migration  0ae94d006f16079d2a915f4b55d66a4b644fbc73
```

可以用以下命令核验：

```bash
git rev-parse main
git rev-parse feat/agent-harness-hardening
git rev-parse feat/chalkboard-openmaic-migration
```

### GitHub 不可用时的离线恢复

备份包中的 `git/chalk.bundle` 可以创建主仓库：

```bash
git clone git/chalk.bundle chalk_
cd chalk_
git switch main
git remote set-url origin https://github.com/x18-1/chalk_.git
```

bundle 不包含三个参考项目 submodule 的仓库对象；网络恢复后执行：

```bash
git submodule update --init --recursive
```

## 5. 恢复环境变量

假设解压后的备份目录与 `chalk_` 在同一父目录：

```bash
cp ../chalk-migration-2026-08-13/env/agent-harness.env \
  .worktree/agent-harness/.env
chmod 600 .worktree/agent-harness/.env
```

重点检查 `.env` 中带旧电脑绝对路径的值。当前已知 `SESSIONS_ROOT=./data/sessions` 和 `SKILLS_DIRS=./skills` 是相对路径，不需要修改；如果后续出现绝对路径，应换成新电脑路径。

不要提交 `.env`。`CREDENTIAL_ENCRYPTION_KEY` 必须保持原值，否则数据库中已加密的模型凭据可能无法解密。

`env/main-env-legacy` 只作为历史参考。如果主工作树或 OpenMAIC 工作树确实需要环境文件，应先从各自的 `.env.example` 生成 `.env`，再逐项复制需要的值：

```bash
cp .env.example .env
cp .worktree/chalkboard-openmaic/.env.example \
  .worktree/chalkboard-openmaic/.env
```

不要直接把 `main-env-legacy` 覆盖到这些位置，因为它来自旧电脑上一个文件名异常、用途未完全确认的文件。

## 6. 安装依赖

在三个工作树分别安装。仓库锁定了 pnpm 版本和 lockfile：

```bash
pnpm install --frozen-lockfile

(cd .worktree/agent-harness && pnpm install --frozen-lockfile)
(cd .worktree/chalkboard-openmaic && pnpm install --frozen-lockfile)
```

不需要迁移旧电脑的 `node_modules`。

## 7. 启动基础服务并恢复数据库

在主仓库根目录启动 PostgreSQL 和 MinIO：

```bash
docker compose up -d
docker compose ps
```

以下命令假设备份目录与 `chalk_` 在同一父目录。恢复开发数据库：

```bash
docker compose exec -T postgres \
  pg_restore -U chalk -d chalk --clean --if-exists \
  < ../chalk-migration-2026-08-13/database/chalk.dump
```

恢复测试数据库：

```bash
docker compose exec -T postgres \
  dropdb -U chalk --if-exists chalk_openmaic_test
docker compose exec -T postgres \
  createdb -U chalk chalk_openmaic_test
docker compose exec -T postgres \
  pg_restore -U chalk -d chalk_openmaic_test \
  < ../chalk-migration-2026-08-13/database/chalk_openmaic_test.dump

docker compose exec -T postgres \
  dropdb -U chalk --if-exists chalk_openmaic_e2e
docker compose exec -T postgres \
  createdb -U chalk chalk_openmaic_e2e
docker compose exec -T postgres \
  pg_restore -U chalk -d chalk_openmaic_e2e \
  < ../chalk-migration-2026-08-13/database/chalk_openmaic_e2e.dump
```

首次用 `--clean --if-exists` 恢复 `chalk` 时，`pg_restore` 可能输出部分“对象不存在”的清理提示。恢复完成后应以应用能否读取数据为准。也可以列出数据库进行确认：

```bash
docker compose exec -T postgres \
  psql -U chalk -d postgres -c '\l'
```

## 8. 可选：恢复本地 Agent 会话

这些 JSONL 文件不是应用启动所必需。如果希望保留历史记录：

```bash
mkdir -p apps/api/data
cp -a ../chalk-migration-2026-08-13/sessions/main-api-data/. \
  apps/api/data/

mkdir -p .worktree/agent-harness/apps/api/data
cp -a ../chalk-migration-2026-08-13/sessions/agent-harness-api-data/. \
  .worktree/agent-harness/apps/api/data/
```

旧会话目录名可能编码了旧电脑的绝对工作路径，因此应用未必会自动把它们显示为新工作区会话；即使如此，JSONL 原始记录仍被完整保留。

## 9. 可选参考仓库

以下两个目录在旧电脑上是独立、被主仓库忽略的 Git 仓库。它们都无本地修改且已同步远端，因此未放入备份包：

```bash
git clone --branch chalk-geometry-solver \
  https://github.com/x18-1/math_manim.git \
  .reference/math_manim

git clone https://github.com/earendil-works/pi.git \
  .reference/pi
```

第一阶段的 OpenMAIC 白板课堂迁移不依赖它们，可以暂时不克隆。

## 10. 新电脑验收

检查 Git 状态和基础服务：

```bash
git status --short --branch
git worktree list
docker compose ps
```

分别构建：

```bash
pnpm build
(cd .worktree/agent-harness && pnpm build)
(cd .worktree/chalkboard-openmaic && pnpm build)
```

再实际启动当前要开发的工作树：

```bash
cd .worktree/chalkboard-openmaic
pnpm dev
```

至少确认：

1. Web 与 API 可以启动。
2. 数据库中的原有数据可以读取。
3. 模型 API Key 可用。
4. 原有加密凭据可以解密。
5. OpenMAIC 迁移分支的课堂界面可以打开。
6. `git status` 没有出现意外修改。

新电脑完成以上验收后，再删除旧电脑项目。建议至少保留一份备份包副本，直到新电脑连续使用一周且关键功能均正常。确认不再需要后，应安全删除含有密钥的备份，而不是长期散落在普通下载目录。
