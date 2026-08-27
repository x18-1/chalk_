请根据以下课程要求生成场景大纲。

---

## 用户要求

{{requirement}}

---

{{userProfile}}

## 语言上下文

应用 system Prompt 中的决策规则来推断课程语言指令。重点提醒：
- 要求所用语言 = 教学语言（除非明确提出其他语言要求，或学习者上下文要求不同）
- 外语学习 → 使用用户的母语教学，而不是目标语言
- PDF 的语言不能覆盖教学语言——应翻译或解释文档内容

---

## 参考资料

### PDF 内容摘要

{{pdfContent}}

### 可用图片

{{availableImages}}

### 网络搜索结果

{{researchContext}}

{{teacherContext}}

---

## 输出要求

请根据用户要求自动推断以下信息：

- 课程主题与核心内容
- 目标受众与难度
- 课程时长（未指定时默认为 15–30 分钟）
- 教学风格（正式／轻松／互动／学术）
- 视觉风格（简约／多彩／专业／活泼）

然后将响应输出为单个 JSON 对象。

**顶层结构——必须严格按此返回：**

```json
{
  "languageDirective": "描述课程语言行为的 2–5 句指令",
  "courseTitle": "简洁课程名称，≤30 个字符，使用教学语言",
  "outlines": [ /* 场景对象数组，schema 见下文 */ ]
}
```

绝不能返回裸数组。绝不能省略 `languageDirective` 或 `courseTitle`。三个键都必需存在。

**`outlines` 数组中的每个场景至少具有以下结构：**

```json
{
  "id": "scene_1",
  "type": "slide" | "quiz" | "interactive" | "pbl",
  "title": "场景标题",
  "description": "教学目的描述",
  "keyPoints": ["要点 1", "要点 2", "要点 3"],
  "order": 1
}
```

### 特别说明

- **quiz 场景必须包含 quizConfig**：
   ```json
   "quizConfig": {
     "questionCount": 2,
     "difficulty": "easy" | "medium" | "hard",
     "questionTypes": ["single", "multiple"]
   }
   ```
{{#if hasSourceImages}}
- **如果存在源图片**，请为相关 slide 场景添加 `suggestedImageIds`。只能使用“可用图片”中列出的图片 ID。
{{/if}}
- **Interactive 场景**：如果某个概念适合动手模拟或可视化，使用 `"type": "interactive"`，并包含 `widgetType` 和 `widgetOutline` 字段。每门课程限制为 1–2 个。
   - 根据概念选择 widgetType：simulation（物理／化学）、diagram（流程）、code（编程）、game（练习）、visualization3d（3D 模型）
   - 提供与 widget 类型相符的 widgetOutline
- **场景数量**：根据推断出的时长决定，通常每分钟 1–2 个场景
- **测验位置**：建议每 3–5 个 slide 插入一个 quiz 进行评估
- **语言**：从用户要求文本和上下文中推断，并使用推断出的语言输出全部内容
- **如果提供网络搜索结果**，请在场景描述和 keyPoints 中引用具体发现和来源。搜索结果提供最新信息——应将其用于提升课程内容的时效性和准确性。

**最后提醒**：整个响应必须是单个 JSON **对象**，并且顶层恰好具有三个键：`languageDirective`（字符串）、`courseTitle`（字符串，≤30 个字符，使用教学语言）以及 `outlines`（数组）。不要返回裸数组。不要包裹说明文字或代码围栏。
