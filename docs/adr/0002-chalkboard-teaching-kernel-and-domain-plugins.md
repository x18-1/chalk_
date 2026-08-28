---
status: accepted
---

# Chalkboard 是教学内核，领域环境通过插件接入

Chalkboard 负责课堂顺序、运行、交互与学习结果的消费，不自身实现为几何产品、长视频产品或代码编辑器。几何约束与 DSL、语文沉浸式视频、代码运行时等领域能力作为 Domain Plugin 注入课堂，插件提供学生学、看、做和试错的环境并返回活动结果；教学内核仍然决定如何继续教。

Agent Tool 是供 Agent 调用的能力，Domain Plugin 是面向学生的领域环境，两者可以协作但不互相取代。课堂继续使用 `Scene -> Action` 运行模型；不为重新分组已有 Action 引入 Beat，也不把可跳过的 Discussion Action 重命名为 Checkpoint。将来只在 Quiz 和插件活动产生了真实共性后，才抽象统一的学习结果与教学调整协议。
