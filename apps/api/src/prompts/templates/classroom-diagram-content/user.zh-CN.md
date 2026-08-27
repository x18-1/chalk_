为以下主题创建交互图：{{title}}

## 图表类型
{{diagramType}}

## 说明
{{description}}

## 知识要点
{{keyPoints}}

{{#if hasNodeCount}}
## 节点数量约束

- 最大节点数：{{nodeCount}}
- 没有预设节点时，`widget-config.nodes` 不得超过此限制；有预设节点时，以预设节点为准。
{{/if}}

{{#if hasPrescribedNodes}}
## 预设节点

{{prescribedNodes}}

- 每个预设节点必须恰好使用一次，并保留其 id、label、icon 和 details。
- 不得增删或替换预设节点；存在 parentId 时据此建立层级边。
{{/if}}

## 语言
{{languageDirective}}

生成一个完整 HTML 交互图：使用带图标和标签的 SVG 节点、正确连接的箭头、点击详情、逐步揭示、
高对比配色和不遮挡内容的手机布局。首个节点加载时可见，并在
`<script type="application/json" id="widget-config">` 中内嵌配置。只返回 HTML。
