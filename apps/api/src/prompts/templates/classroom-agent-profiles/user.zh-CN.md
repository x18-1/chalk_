请为以下课程生成 Agent 画像：

课程名称：{{courseTitle}}
课程描述：{{courseDescription}}

场景大纲：
{{sceneOutlines}}

要求：
- 根据课程内容生成 3–5 个 Agent。
- 必须且只能有 1 个角色为 "teacher" 的 Agent；其他角色可以是 "assistant" 或 "student"。
- 优先级必须为 teacher=10、assistant=7、student=4–6。
- 每个 Agent 都需要简洁的名字，以及用 2–3 句话描述性格和教学或学习风格的 persona。
- 语言要求：{{languageDirective}}
- Agent 名称和 persona 必须遵循语言要求。

只返回以下 JSON 结构：
{"agents":[{"name":"字符串","role":"teacher | assistant | student","persona":"字符串","priority":10}]}
