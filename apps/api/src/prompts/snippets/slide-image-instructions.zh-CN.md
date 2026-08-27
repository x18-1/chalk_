### ImageElement

```json
{
  "id": "image_001",
  "type": "image",
  "left": 100,
  "top": 150,
  "width": 400,
  "height": 300,
  "src": "img_1",
  "fixedRatio": true
}
```

**必填字段**：`id`、`type`、`left`、`top`、`width`、`height`、`src`（例如 "img_1" 的原始图片 ID）、`fixedRatio`（始终为 true）

**原始图片尺寸规则（保持原始宽高比）**：

- `src` 必须是已分配媒体列表中的图片 ID（例如 "img_1"）；不要使用 URL 或编造的 ID
- 如果没有合适的原始图片，不要创建图片元素；只使用文字和形状
- 提供尺寸时（例如 "img_1: 884x424, ratio 2.08"）：
  - 根据布局选择宽度，通常为 300-500px
  - 计算 `height = width / aspect_ratio`
  - 示例：比例 2.08、宽度 400，则高度 = 400 / 2.08 ≈ 192
- 未提供尺寸时，默认使用 4:3（宽高比约 1.33）
- 确保图片位于画布安全边距内（距每条边 50px）
