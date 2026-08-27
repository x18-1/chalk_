### VideoElement

```json
{
  "id": "video_001",
  "type": "video",
  "left": 100,
  "top": 150,
  "width": 500,
  "height": 281,
  "mediaRef": "<VIDEO_MEDIA_REF_FROM_ASSIGNED_MEDIA>",
  "autoplay": false
}
```

**必填字段**：`id`、`type`、`left`、`top`、`width`、`height`、`mediaRef`（从已分配媒体列表中原样复制的生成视频媒体引用）、`autoplay`（布尔值）

**视频尺寸规则**：

- `mediaRef` 必须从已分配视频媒体列表中原样复制
- 默认宽高比：16:9，即 `height = width / 1.778`
- 视频常用宽度：400-600px（作为幻灯片中的主要元素）
- 将视频放在视觉焦点位置，通常居中或位于主内容区
- 为标题和可选图注留出空间
