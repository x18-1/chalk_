# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Chalk 第一阶段面向使用桌面 Web 自学数学的小学、初中学生。学生带着题目、概念疑问或作业进入 Chat，自主发起学习；家长端、教师端和管理端不属于当前前端范围。

## Product Purpose

Chalk 是交互式学习产品。它不以快速给出答案为目标，而是帮助学生理解解题思路、掌握一类题或一个知识点，并把学习过程沉淀为可长期使用的记录。

## Positioning

Chalk 将开放式 Chat 与结构化 Chalkboard 课程连接到同一套视觉展示和学习记录中。Chat 根据学生当下的问题讲解并使用提示阶梯，必要时建议进入有教学顺序、检查点和变式验证的 Chalkboard，而不是把每次问答当成彼此无关的一次性答案。

## Operating Context

第一阶段首先实现学生端 Chat。学生从会话列表进入或创建对话，输入文字、题目图片或作业文件，查看 AI 讲解、工具活动和学习上下文。完整 Chalkboard、家长学情报告和长期学习界面在后续阶段实现。

## Capabilities and Constraints

- 第一阶段只做数学，但 Chat 的提问范围不受课程章节限制。
- 第一屏是学生 Chat 工作区，不制作营销首页。
- 当前开发只适配桌面 Web，暂不实现移动端布局。
- Chat 需要容纳多轮对话、模型选择、附件、Agent 工具状态、human-in-loop 审批和错误恢复。
- 讲解必须说明思路来源；学生表示不会时使用逐级提示，不直接泄露答案。
- 当前前端可以先使用明确标注的演示数据建立真实交互结构，后续接入 Agent Runtime API。
- 前端使用 Next.js App Router、React 和 TypeScript。

## Brand Commitments

- 产品名使用 Chalk。
- 视觉风格以 `/home/xcodd/code/creatorflow` main 分支的正式设计系统为参考，继承其暖纸、炭黑、克制陶土强调色和少量衬线标题的设计语言。
- 不新增深墨绿等参考系统中不存在的品牌主色。
- 产品语气应平静、清楚、尊重学生，不幼稚化，也不使用制造焦虑或羞耻感的表达。

## Evidence on Hand

- `docs/spec/functional-spec.md`：产品定位、Chat、Chalkboard、提示阶梯和学习记录定义。
- `docs/plan/plan-chat-v1.md`：第一阶段 Chat 与 Agent Harness 的功能范围。
- `/home/xcodd/code/creatorflow/DESIGN.md`：用户指定的视觉系统参考。
- `/home/xcodd/code/creatorflow/frontend/src/styles/`：参考系统已经实现的 tokens 与基础控件样式。

当前没有学生头像、品牌插画、客户案例或可对外使用的学习效果数据，界面不得虚构这些内容。

## Product Principles

- 先教思路，再给步骤。
- 学生始终知道系统正在读取什么、调用什么以及等待什么。
- Chat 是学习入口，不是答案搜索框。
- 学习上下文服务于当下理解，不用无关指标占据界面。
- 当前先把桌面端核心学习流程做深，再扩展终端和角色。

## Accessibility & Inclusion

核心 Chat 流程支持键盘操作、清晰的焦点状态、非颜色唯一的状态表达和可读的数学内容。文案不以年龄、成绩或错误羞辱学生。
