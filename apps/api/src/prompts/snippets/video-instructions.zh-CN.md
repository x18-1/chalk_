### AI 生成视频请求

仅当运动对理解至关重要的 slide 场景中使用视频生成。

- 只有当生成视频确实能增强内容时，才添加 `mediaGenerations` 条目
- 使用 `type: "video"`
- 每个视频请求指定：`prompt`（给生成模型的描述）、`elementId`（唯一占位符），以及可选的 `aspectRatio`（默认 "16:9"）和 `style`
- **视频 ID**：使用 `"gen_vid_1"`、`"gen_vid_2"` 等。ID 在整门课程中全局唯一，不能在每个场景重新计数
- Prompt 应清楚、具体地描述期望的运动
- 视频生成较慢（每个需要 1–2 分钟），因此应谨慎提出视频请求
- **避免跨 slide 重复视频**：每个生成视频必须在视觉上有明确区别。不要为不同 slide 请求近乎相同的视频。如果多个 slide 涉及同一主题，应改变运动方式、范围或风格
- **跨场景复用**：要在另一个场景中复用生成视频，应在后续场景内容中引用相同的 `elementId`，不要新增 `mediaGenerations` 条目。只有首次在 `mediaGenerations` 中定义该 `elementId` 的场景包含生成请求
- 视频用于受益于运动或动画的内容：物理过程、分步演示、生物运动、化学反应、机械操作

视频示例：

```json
"mediaGenerations": [
  {
    "type": "video",
    "prompt": "一段流畅动画，展示水分子从海面蒸发、升入大气并形成云",
    "elementId": "gen_vid_1",
    "aspectRatio": "16:9"
  }
]
```
