# DeepTutor PDF 解析调研

调研对象：`/home/xcodd/code/chalk_/.reference/DeepTutor`（源码快照）。

结论先行：DeepTutor 不是只用 `pypdf`，也没有把 MinerU 随 LightRAG 一起强制安装。它有一个可插拔的 `ParseService`，支持 Text-only、MinerU、Docling、markitdown、PyMuPDF4LLM、LiteParse、Tika 七种解析引擎；新安装默认 Text-only，旧版从 `mineru.json` 迁移时会保留 MinerU。LightRAG 在索引前调用同一个 `ParseService`，所以 LightRAG 的 PDF 质量完全取决于“Settings → Document Parsing”中选择的解析引擎，而不是 LightRAG 自身。

## 1. 解析层总架构

`ParseService.parse()` 负责统一入口、引擎选择、格式检查、内容寻址缓存、就绪检查和标准 IR 返回。成功结果始终包含 Markdown，可选地包含结构化 blocks 和图片目录；消费者不需要知道底层是 MinerU 还是 PyMuPDF4LLM。

- 入口和缓存流程：[`deeptutor/services/parsing/service.py`](../../.reference/DeepTutor/deeptutor/services/parsing/service.py#L1-L153)
  - 根据显式 `engine` 或运行时配置选择 parser（约 L43-L61）。
  - 以源文件字节哈希 + parser signature 做缓存键；同一文件和配置命中缓存，不同引擎/版本/参数会重新解析（约 L74-L101）。
  - 解析前调用 `is_ready()`，模型未准备好或云端未配置时 fail-closed（约 L102-L112）。
- 标准 IR：[`deeptutor/services/parsing/types.py`](../../.reference/DeepTutor/deeptutor/services/parsing/types.py#L1-L52)
  - `markdown` 是所有引擎都必须提供的最低公分母。
  - `blocks` 是 MinerU `content_list` 形状的可选结构；没有结构时消费者退回 Markdown（约 L17-L38）。
- 引擎注册：[`deeptutor/services/parsing/engines/factory.py`](../../.reference/DeepTutor/deeptutor/services/parsing/engines/factory.py#L1-L185)
  - 引擎模块采用 lazy import，缺少可选依赖不会拖垮其他 RAG provider（约 L1-L9）。
  - UI 元数据明确把 MinerU 描述为“layout、tables、formulas”高保真多模态解析，把 PyMuPDF4LLM/LiteParse 描述为轻量 PDF→Markdown（约 L62-L132）。

### 默认值和可选依赖

运行时设置 [`services/config/runtime_settings.py`](../../.reference/DeepTutor/deeptutor/services/config/runtime_settings.py#L102-L222) 显示：

| 项目 | 事实 |
| --- | --- |
| 新安装默认 | `text_only`（L125-L128），保证无需额外包/模型即可工作 |
| 迁移旧版 `mineru.json` | 自动把 active engine 设回 `mineru`，保持旧行为（L909-L957） |
| MinerU | `mode=local/cloud`，默认公式和表格开关为 true，OCR 默认 false，禁止静默下载本地模型（L130-L155） |
| PyMuPDF4LLM | 默认提取图片，PNG、150 DPI，无模型/CUDA（L176-L184） |
| LiteParse | Markdown 输出，图片默认不落盘，整篇文档解析（L186-L195） |
| Docling | local/remote，OCR 默认 false，表格结构默认 true（L157-L168） |

`pyproject.toml` 的核心依赖包括 PyMuPDF、pypdf、pdfplumber；MinerU 不在 pip 依赖中，而是外部 CLI 或托管 API。MinerU/Docling/markitdown/PyMuPDF4LLM/LiteParse 分别通过可选 extra 或外部服务启用：[`pyproject.toml`](../../.reference/DeepTutor/pyproject.toml#L45-L70、#L180-L205、#L228-L243)。

## 2. MinerU：DeepTutor 中最强的 PDF 解析路径

### 接入边界

DeepTutor 明确不把 MinerU 作为 in-process Python 依赖，而是支持本地 CLI 和 mineru.net 云 API 两条后端；LightRAG extra 只安装 LightRAG SDK，不会自动安装 MinerU。来源：MinerU 集成设计 [`docs/plans/2026-08-30-mineru-multiformat-integration-design.md`](../../.reference/DeepTutor/docs/plans/2026-08-30-mineru-multiformat-integration-design.md#L24-L32)；项目 README 的知识库说明 [`README.md`](../../.reference/DeepTutor/README.md#L612-L616)。

MinerU parser adapter：[`services/parsing/engines/mineru/engine.py`](../../.reference/DeepTutor/deeptutor/services/parsing/engines/mineru/engine.py#L1-L72)；统一后端分派：[`.../mineru/backend.py`](../../.reference/DeepTutor/deeptutor/services/parsing/engines/mineru/backend.py#L1-L225)。支持 PDF、常见栅格图、DOCX、PPTX、XLSX：[`.../mineru/formats.py`](../../.reference/DeepTutor/deeptutor/services/parsing/engines/mineru/formats.py#L1-L39)。

### 本地 CLI 流程

1. `local_cli_probe()` 按 `mineru`、`magic-pdf` 顺序探测 PATH，也允许设置绝对 CLI 路径（`backend.py` L76-L108）。
2. `mineru_readiness()` 在运行前检查 CLI 和本地模型缓存；默认模型缺失时不会让 CLI 偷偷下载数 GB 权重，必须显式允许下载或先点设置页的下载按钮（`readiness.py` L1-L66）。
3. 执行固定命令 `mineru -p <source> -o <output>`，合并 stdout/stderr 并限频回传进度；成功后把 CLI 产物规范化为 `<output>/<source-stem>`（`local.py` L56-L77、L132-L190）。
4. 旧 `magic-pdf` 只能处理 PDF；请求其他格式会在启动子进程前返回可操作的升级提示（`local.py` L102-L110；集成设计 L41-L46）。

### 云端 API 流程

云端采用 MinerU v4 Precision API（`cloud.py` L1-L17）：

1. `POST /api/v4/file-urls/batch` 申请批次和签名上传地址。
2. 不带 Authorization/Content-Type，把原始字节 `PUT` 到签名 URL（L124-L159）。
3. 轮询 `/api/v4/extract-results/batch/{batch_id}`，直到 `done/failed`，默认轮询 4 秒、总超时 300 秒（L38-L47、L162-L180）。
4. 下载 `full_zip_url` 并解压到与本地 CLI 相同的目录布局（Markdown、`*_content_list.json`、`images/`），因此下游无需区分云/本地（L1-L12、L108-L115）。

请求体会把 `model_version`、`enable_formula`、`enable_table`、`is_ocr` 和可选 `language` 传给服务（L124-L138）。这意味着扫描试卷应在 MinerU 配置中开启 `is_ocr`；公式和表格默认开启。

### MinerU 结构化产物如何进入 LightRAG

`ParseService` 得到的 Markdown、blocks、assets 会先冻结为版本内 ingress bundle；不直接修改 parser 原始文件，并记录来源哈希和 parser signature：[`services/rag/pipelines/lightrag/ingress.py`](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/lightrag/ingress.py#L184-L287)。

MinerU blocks 会经过版本化 block policy：过滤 `footer/header/page_number` 等页面装饰，保留 `text/table/equation/image/chart/list/code` 等语义块；未知类型默认保留，避免升级后静默丢内容：[`services/rag/pipelines/lightrag/block_policy.py`](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/lightrag/block_policy.py#L1-L18、#L94-L140)。随后注册 DeepTutor parser 给 LightRAG，解析器读取已验证 bundle 并写入 LightRAG 原生 parsed docs/sidecar：[`services/rag/pipelines/lightrag/parser.py`](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/lightrag/parser.py#L15-L99)。

LightRAG pipeline 在每批文档 staging 时先调用 `ParseService.parse(path)`，所以 MinerU 是否生效由全局 Document Parsing 设置决定：[`services/rag/pipelines/lightrag/pipeline.py`](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/lightrag/pipeline.py#L113-L138)。

## 3. DeepTutor 其他 PDF 引擎

### Text-only（当前新安装默认）

聊天附件的公共文本提取器优先尝试 PyMuPDF `page.get_text()`，异常时回退 pypdf `page.extract_text()`；输出为 `--- Page N ---` 加页文本，不做版面、表格、公式或 OCR 恢复：[`utils/document_extractor.py`](../../.reference/DeepTutor/deeptutor/utils/document_extractor.py#L286-L348)。这条路径就是“能读取文字”的最低保障，遇到双栏、数学排版、扫描 PDF 时质量有限。

### PyMuPDF4LLM

`pymupdf4llm` 引擎调用 `helpers.pymupdf_rag.to_markdown`，固定走无模型的轻量转换器；可选择把嵌入图片/矢量图写入 `images/`，并修正 Markdown 图片链接：[`engines/pymupdf4llm/engine.py`](../../.reference/DeepTutor/deeptutor/services/parsing/engines/pymupdf4llm/engine.py#L1-L13、#L63-L119)。它适合希望比纯 `get_text()` 更接近 Markdown、但不想部署 GPU/模型的场景；不等同于 MinerU 的版面/公式/OCR 能力。

### LiteParse

LiteParse 是 Rust-backed、无模型的空间文本解析器；适配器强制 Markdown 输出，可选图片提取、链接保留和最大页数，并把 OCR 失败设为非 fatal 以保留已恢复文本：[`engines/liteparse/engine.py`](../../.reference/DeepTutor/deeptutor/services/parsing/engines/liteparse/engine.py#L1-L17、#L61-L111)。适合快速、低资源 PDF；需单独安装 `deeptutor[parse-liteparse]`。

### Docling

Docling 将 PDF/Office 转 Markdown，支持 `do_ocr`、`do_table_structure`；可本地运行或连接 Docling Serve 远程服务。默认本地模型下载也被 readiness gate 阻止，远程模式只需 URL：[`engines/docling/engine.py`](../../.reference/DeepTutor/deeptutor/services/parsing/engines/docling/engine.py#L1-L17、#L96-L168)。对于表格和版面结构，它是 MinerU 之外的另一条结构化方案。

### markitdown / pdf skill

markitdown 是无模型的广格式 Markdown 转换器（[`engines/markitdown/engine.py`](../../.reference/DeepTutor/deeptutor/services/parsing/engines/markitdown/engine.py#L1-L18、#L63-L94)）。内置 PDF skill 的建议是：抽取文本/表格/坐标用 `pdfplumber`，快速原始文字或页操作用 pypdf；PyMuPDF 用于渲染页面图像；扫描 PDF 在该 sandbox 没有 Tesseract OCR，不能凭空恢复文字：[`skills/builtin/pdf/SKILL.md`](../../.reference/DeepTutor/deeptutor/skills/builtin/pdf/SKILL.md#L15-L20、#L26-L70)。这说明 DeepTutor 的“办公 PDF skill”并不自动等价于高质量 RAG ingest，它只是给 Agent 的按需处理工具。

## 4. 分块与 RAG 的关系

解析器先产生 Markdown/结构化 blocks，分块由具体 RAG provider 再做，不是 PDF parser 的职责。

- LlamaIndex 默认 ingestion pipeline 使用 `SentenceSplitter(chunk_size=Settings.chunk_size, chunk_overlap=Settings.chunk_overlap)`，然后调用 embedding model：[`services/rag/pipelines/llamaindex/ingestion.py`](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/ingestion.py#L21-L37)。
- LightRAG native ingress 对有结构 blocks 的文档记录 `paragraph_semantic`（`chunk_token_size=1200`），没有 blocks 时记录 `fixed_token`；参数写入 bundle manifest：[`services/rag/pipelines/lightrag/ingress.py`](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/lightrag/ingress.py#L243-L285)。最终 chunking/embedding/检索仍由 LightRAG SDK 的 native pipeline 完成，DeepTutor 通过 parser bridge 控制输入和审计。

因此“换 MinerU”主要改善输入 IR（版面、表格、公式、图片、页码），不会自动改变 LightRAG 的 chunk size 或召回策略；两者应分开调参和评估。

## 5. 对 Chalk 当前问题的直接建议

1. 当前项目若只用 `pypdf`/简单 `page.extract_text()`，出现数学试卷错序、公式缺失、双栏串行是预期现象；这不是 embedding 或 rerank 的问题，而是解析层信息已经丢失。
2. 最小成本的质量升级顺序：先增加 PyMuPDF4LLM 作为无模型 fallback；对数学试卷、表格、扫描件使用 MinerU（优先 cloud，或单独安装本地 CLI + 模型）；需要远程自托管时可选 Docling Serve。
3. 若采用 MinerU，应保留与 DeepTutor 类似的边界：Python parser service 负责解析和标准 IR，TypeScript API 只负责 owner、上传、任务状态；LightRAG 只消费解析后的 Markdown/blocks，不把 MinerU 依赖塞进业务 API。
4. MinerU 云端 OCR/公式/表格开关应成为知识库级或文档级配置，并把 parser engine + 版本 + 参数纳入缓存/索引版本；否则切换引擎后容易误用旧 chunks。
5. 扫描 PDF 需要明确 OCR 能力和失败提示。DeepTutor 的内置 PDF skill 明确没有 OCR；MinerU `is_ocr=true` 或 Docling `do_ocr=true` 才是可行路径，不能继续依赖 pypdf fallback。

## 6. 事实核对清单

- DeepTutor 支持 MinerU：README 知识库段落 [`README.md`](../../.reference/DeepTutor/README.md#L612-L616)；具体适配器 [`services/parsing/engines/mineru/`](../../.reference/DeepTutor/deeptutor/services/parsing/engines/mineru/)。
- LightRAG extra 不安装 MinerU：`pyproject.toml` 的 `rag-lightrag` 仅含 `lightrag-hku==1.5.7rc2`，MinerU 段落明确标注 external CLI/hosted API [`pyproject.toml`](../../.reference/DeepTutor/pyproject.toml#L180-L205、#L228-L243)。
- 新安装默认 Text-only：[`runtime_settings.py`](../../.reference/DeepTutor/deeptutor/services/config/runtime_settings.py#L125-L155)。
- 解析引擎在所有 RAG pipeline 共享：LlamaIndex loader 注释和调用 [`document_loader.py`](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/llamaindex/document_loader.py#L1-L12、#L75-L109)；LightRAG staging 调用 [`pipeline.py`](../../.reference/DeepTutor/deeptutor/services/rag/pipelines/lightrag/pipeline.py#L113-L138)。
- 扫描件没有通用 OCR fallback：[`skills/builtin/pdf/SKILL.md`](../../.reference/DeepTutor/deeptutor/skills/builtin/pdf/SKILL.md#L67-L70)。
