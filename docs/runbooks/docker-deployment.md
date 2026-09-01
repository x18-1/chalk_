# Docker 部署运行手册

> 状态：Accepted + Documented
> 实施状态：Partial（镜像和 Compose 已提供；HTTPS、备份和外部对象存储仍需按部署环境补齐）

这套 Compose 启动完整的单机 Chalk：Next.js Web、TypeScript API、Python
LightRAG sidecar、Postgres 和 MinIO。API 是唯一面向业务客户端的授权入口；RAG
sidecar 只加入 Compose 私有网络，不发布到宿主机。

## 1. 准备环境变量

复制模板并填写部署配置：

```bash
cp .env.example .env
```

至少需要设置：

```dotenv
RAG_SIDECAR_TOKEN=生成一个随机长字符串
RAG_LLM_API_KEY=...
RAG_LLM_BASE_URL=https://api.deepseek.com
RAG_LLM_MODEL=deepseek-chat
RAG_EMBEDDING_API_KEY=...
RAG_EMBEDDING_BASE_URL=https://你的 embedding endpoint
RAG_EMBEDDING_MODEL=qwen3.7-text-embedding
RAG_RERANK_API_KEY=...
RAG_RERANK_URL=https://你的 rerank endpoint
RAG_RERANK_MODEL=qwen3.7-text-rerank
CREDENTIAL_ENCRYPTION_KEY=64位十六进制随机值
```

生产环境还必须设置：

```dotenv
SESSION_COOKIE_SECURE=true
DEPLOY_WEB_ORIGIN=https://chalk.example.com
PUBLIC_API_URL=https://api.example.com
```

`PUBLIC_API_URL` 会在 Web 镜像构建时写入前端 bundle；修改它后需要重新执行
`up -d --build`。

不要把 `.env` 提交到 Git。`RAG_SIDECAR_TOKEN` 必须只在 API 和 sidecar 之间共享。

## 2. 启动

在仓库根目录执行：

```bash
docker compose -f docker-compose.deploy.yml up -d --build
```

API 容器启动时会先执行 Drizzle migration，再监听 `3001`。默认访问地址：

- Web：`http://localhost:3000`
- API：`http://localhost:3001/health`
- MinIO 控制台：`http://localhost:9001`

sidecar 仅在 Docker 私有网络内通过 `http://rag-sidecar:8010` 访问。

检查状态：

```bash
docker compose -f docker-compose.deploy.yml ps
curl -fsS http://localhost:3001/health
```

首次使用在 Web 登录后进入“知识库”创建资料。文档索引和 LightRAG workspace 持久化在
`rag_data` volume，数据库、MinIO 和会话分别持久化在对应 volume。

## 3. MinIO 上传地址说明

Compose 中 API 使用 `http://minio:9000` 访问 MinIO；浏览器上传需要宿主机可访问的签名
地址，因此 API 使用 `S3_PRESIGN_ENDPOINT` 生成上传 URL。默认值是
`http://localhost:9000`，适合本机检查。如果通过域名或反向代理访问 MinIO，请将它设置为
浏览器可访问的 HTTPS 地址，并确保该地址能到达同一个 MinIO 实例：

```dotenv
S3_PRESIGN_ENDPOINT=https://storage.example.com
```

生产环境也可以直接使用阿里云 OSS：将 `S3_ENDPOINT`、凭据和 bucket 配置为 OSS 参数，
并将 `S3_PRESIGN_ENDPOINT` 设为浏览器可访问的 OSS/CDN endpoint；此时可以移除 Compose
中的 MinIO 服务。

## 4. 停止、更新和备份

```bash
# 停止容器但保留 volume
docker compose -f docker-compose.deploy.yml down

# 拉取代码后重新构建并滚动替换
docker compose -f docker-compose.deploy.yml up -d --build

# 查看 API / sidecar 日志
docker compose -f docker-compose.deploy.yml logs -f api rag-sidecar
```

不要在不确认数据备份的情况下使用 `down -v`。Postgres、MinIO、RAG workspace 和会话
volume 应纳入主机级或云盘级备份；当前仓库没有自动备份策略。

## 5. 部署边界

- 这是单机 Docker 部署，不包含 Kubernetes、Redis/Kafka、分布式索引或多副本调度。
- API 进程内异步索引 worker 重启后仍为 `pending` 的文档需要在界面重试。
- 生产环境应在 Web/API 前置 HTTPS 反向代理，并限制 API、MinIO 控制台和数据库的公网暴露。
- RAG 检索质量评估（Recall/MRR、citation correctness、faithfulness）仍是后续工作。
