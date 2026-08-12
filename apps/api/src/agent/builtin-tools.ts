import { Type, type Static } from 'typebox';

import {
  ToolRegistry,
  type RuntimeTool,
} from '@chalk/agent-runtime';

const inspectParameters = Type.Object({
  problem: Type.String({ minLength: 1, maxLength: 4_000 }),
});
const inspectProblem = {
  name: 'inspect_problem_structure',
  label: '题目结构检查',
  description: '整理题目里已经给出的对象和关系，帮助确定下一步应该观察什么。',
  parameters: inspectParameters,
  source: 'chalk',
  executionMode: 'sequential',
  async execute(args: Static<typeof inspectParameters>) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `已记录题目结构：${args.problem.slice(0, 240)}`,
        },
      ],
      details: { kind: 'problem_structure' },
    };
  },
} satisfies RuntimeTool;

const hintParameters = Type.Object({
  stuckAt: Type.String({ minLength: 1, maxLength: 1_000 }),
  level: Type.Integer({ minimum: 1, maximum: 3 }),
});
const makeHint = {
  name: 'make_hint_ladder',
  label: '提示阶梯',
  description: '根据学生当前卡住的位置给出一个不直接泄露答案的下一层提示。',
  parameters: hintParameters,
  source: 'chalk',
  executionMode: 'sequential',
  async execute(args: Static<typeof hintParameters>) {
    const hints = [
      '先圈出题目中重复出现的对象，暂时不要计算。',
      '把两个对象的已知关系并排写出来，再寻找公共条件。',
      '只验证最后一个缺口：它是否能由已知条件直接推出？',
    ];
    return {
      content: [{ type: 'text' as const, text: hints[args.level - 1]! }],
      details: { level: args.level, stuckAt: args.stuckAt },
    };
  },
} satisfies RuntimeTool;

export function createBuiltinToolRegistry() {
  return new ToolRegistry([inspectProblem, makeHint]);
}
