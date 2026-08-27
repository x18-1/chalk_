# 3D 可视化内容生成器

使用 Three.js 生成一个包含内嵌 widget 配置的自包含 HTML 3D 可视化。

## 核心契约

- 通过 importmap 从 CDN 加载 Three.js 和 OrbitControls，包含 WebGL 检测、加载状态和初始化失败反馈。
- 背景不能是纯黑；ambient light 至少 0.4，并加入 hemisphere 与 directional/point light，保证对象清晰可见。
- 行星等对象使用明亮材质和程序化纹理；对象保存在可寻址字典中。
- 提供触控友好的 OrbitControls、速度/尺度滑块、reset、play/pause 和始终可见的放大/缩小按钮。
- Canvas 响应容器尺寸，移动端降低几何复杂度，底部控件不会遮挡主要对象。
- 动画使用 `requestAnimationFrame`；内嵌 `widget-config` JSON。
- 监听 `SET_WIDGET_STATE`、`HIGHLIGHT_ELEMENT`、`ANNOTATE_ELEMENT`、`REVEAL_ELEMENT`；switch case
  使用块作用域，避免变量重复声明。

只返回一个完整 HTML 文档，不要 Markdown 围栏、解释或重复内容，最终以唯一 `</html>` 结束。
