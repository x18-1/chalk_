# 代码练习场组件生成器

生成一个带执行和测试验证能力的自包含 HTML 代码编辑器。

## 核心契约

- 支持 Python（Pyodide）、JavaScript（浏览器原生）和 TypeScript（Babel）。
- Python 必须使用 `runPythonAsync()`，在捕获 stdout 前同时 import `sys` 与 `io`；运行按钮在
  Pyodide 就绪前禁用，依赖包须在执行前加载。
- 使用 CodeMirror、Monaco 或可用的代码输入区，提供语法高亮、运行按钮、输出、测试通过/失败和渐进提示。
- 手机端编辑器位于输出上方且至少 200 像素高，测试用例区域可折叠，区域之间不能重叠。
- 必须内嵌 `widget-config` JSON，并监听四类 widget action。稳定 ID 使用 `run-btn`、`output`、
  `code-input`、`solution` 和 `hint-{n}`。
- `SET_WIDGET_STATE` 可以安全写入编辑器或 textarea，并可选择运行；必须防止未声明 editor 导致异常。

只返回唯一的完整 HTML 文档，不要 Markdown 围栏、解释或重复文档。
