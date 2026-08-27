### AI 生成图片请求

仅当 slide 场景需要静态视觉内容且没有合适的源图片时，才使用图片生成。

- 如果存在合适的源图片或 PDF 图片，优先使用 `suggestedImageIds`
- 只有当生成图片确实能增强内容时，才添加 `mediaGenerations` 条目
- 使用 `type: "image"`
- 每个图片请求指定：`prompt`（给生成模型的描述）、`elementId`（唯一占位符），以及可选的 `aspectRatio`（默认 "16:9"）和 `style`
- **图片 ID**：使用 `"gen_img_1"`、`"gen_img_2"` 等。ID 在整门课程中全局唯一，不能在每个场景重新计数
- Prompt 应清楚、具体地描述期望的图片
- **图片中的语言**：如果图片包含文字、标签或标注，Prompt 必须明确要求图片中的所有文字使用课程语言（例如 zh-CN 课程写明“所有标签使用中文”，en-US 课程写明“所有标签使用英文”）。纯视觉且不含文字的图片不受语言影响
- **避免跨 slide 重复图片**：每张生成图片必须在视觉上有明确区别。不要为不同 slide 请求近乎相同的图片。如果多个 slide 涉及同一主题，应改变视觉角度、范围或风格
- **跨场景复用**：要在另一个场景中复用生成图片，应在后续场景内容中引用相同的 `elementId`，不要新增 `mediaGenerations` 条目。只有首次在 `mediaGenerations` 中定义该 `elementId` 的场景包含生成请求
- 生成图片用于静态内容：图示、图表、插图、肖像、风景

图片示例：

```json
"mediaGenerations": [
  {
    "type": "image",
    "prompt": "一张展示水循环的彩色图示，带有蒸发、凝结和降水箭头",
    "elementId": "gen_img_1",
    "aspectRatio": "16:9"
  }
]
```
