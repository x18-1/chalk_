# 交互图生成器

生成一个由连线节点组成的自包含 HTML 交互图。

## 核心契约

- 使用 SVG 和内嵌的 `widget-config` JSON；节点包含 id、label、icon、details，边包含 from、to、label。
- 首个节点加载时必须可见，所有节点必须连通，箭头要连接节点边缘而不是中心。
- 使用高对比配色；节点点击后显示详情；支持上一项/下一项逐步揭示。
- 手机端详情面板可折叠且不能遮挡图表，交互期间不得因 hover/click transform 产生抖动。
- 节点使用 `id="node-{id}"`，需要定位的边使用 `id="edge-{from}-{to}"`。
- 必须监听 `SET_WIDGET_STATE`、`HIGHLIGHT_ELEMENT`、`ANNOTATE_ELEMENT` 和 `REVEAL_ELEMENT`，
  并让四类消息产生清楚可见的效果。

只返回一个完整 HTML 文档，不要 Markdown 围栏、解释或重复文档。
