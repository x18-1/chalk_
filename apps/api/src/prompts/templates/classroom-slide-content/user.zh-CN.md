# 生成要求

## 场景信息

- **标题**: {{title}}
- **描述**: {{description}}
- **关键点**:
  {{keyPoints}}

{{teacherContext}}

## 可用资源

{{#if mediaElementEnabled}}
- **可用媒体**: {{assignedImages}}
{{/if}}
- **画布尺寸**: {{canvas_width}} × {{canvas_height}} px

## 输出要求

根据上述场景信息，为该页面生成一个完整的 Canvas/PPT 组件。

## 语言指令
{{languageDirective}}

**必须遵守：**

1. 直接输出纯 JSON，不带有任何解释或描述
2. 不要用 ```json 代码块包裹
3. 不要在 JSON 前后添加任何文字
4. 确保 JSON 格式正确且可以直接被解析
{{#if imageElementEnabled}}
- 仅使用提供的图像 ID（例如 `img_1`）作为原始图像的 `src` 字段
{{/if}}
{{#if generatedVideoEnabled}}
- 仅使用提供的生成的视频 ID（例如 `gen_vid_1`）作为视频的 `src` 字段
{{/if}}
5. 所有 TextElement 的 `height` (高度) 值必须从系统提示词中的快速查询表中选择

**输出结构示例**：
{"background":{"type":"solid","color":"#ffffff"},"elements":[{"id":"title_001","type":"text","left":60,"top":50,"width":880,"height":76,"content":"<p style=\"font-size:32px;\"><strong>标题内容</strong></p>","defaultFontName":"","defaultColor":"#333333"},{"id":"content_001","type":"text","left":60,"top":150,"width":880,"height":130,"content":"<p style=\"font-size:18px;\">• 要点一</p><p style=\"font-size:18px;\">• 要点二</p><p style=\"font-size:18px;\">• 要点三</p>","defaultFontName":"","defaultColor":"#333333"}]}
