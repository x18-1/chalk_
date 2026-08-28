import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { PROMPT_IDS, buildPrompt } from '../../../prompts';
import {
  classroomAgentProfilesSchema,
  type ClassroomAgentProfile,
  type ClassroomOutline,
} from '../schemas';
import { generateWithAbort, type ClassroomGenerationModel } from './classroom-generation.types';
import { parseGeneratedJson } from './generated-json';

const generatedAgentProfilesSchema = z.object({
  agents: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    role: z.enum(['teacher', 'assistant', 'student']),
    persona: z.string().trim().min(1).max(2_000),
    priority: z.number().int().min(1).max(10),
  }).passthrough()).min(3).max(5),
}).passthrough().superRefine((value, context) => {
  if (value.agents.filter((agent) => agent.role === 'teacher').length !== 1) {
    context.addIssue({ code: 'custom', path: ['agents'], message: 'Exactly one teacher is required' });
  }
});

export class AgentProfilesGenerationService {
  constructor(private readonly model: ClassroomGenerationModel) {}

  async generate(
    userId: string,
    outline: ClassroomOutline,
    courseDescription: string,
    signal?: AbortSignal,
  ) {
    const prompt = agentProfilesPrompt(outline, courseDescription);
    try {
      const operationSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000);
      const generated = await generateWithAbort(this.model, userId, {
        system: prompt.system,
        user: prompt.user!,
        signal: operationSignal,
        maxRetries: 1,
        timeoutMs: 120_000,
      });
      const parsed = generatedAgentProfilesSchema.parse(parseGeneratedJson(generated.text, 'object'));
      const agentProfiles = classroomAgentProfilesSchema.parse(parsed.agents.map((agent) => ({
        id: `agent-${randomUUID()}`,
        name: agent.name,
        role: agent.role,
        persona: agent.persona,
        priority: agent.role === 'teacher' ? 10 : agent.role === 'assistant' ? 7 : Math.min(6, Math.max(4, agent.priority)),
      })));
      return {
        agentProfiles,
        metadata: {
          source: 'model' as const,
          promptId: PROMPT_IDS.CLASSROOM_AGENT_PROFILES,
          promptRevision: prompt.revision,
          providerId: generated.providerId,
          modelId: generated.modelId,
        },
      };
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      return {
        agentProfiles: fallbackProfiles(outline.languageDirective),
        metadata: {
          source: 'fallback' as const,
          promptId: PROMPT_IDS.CLASSROOM_AGENT_PROFILES,
          promptRevision: prompt.revision,
        },
      };
    }
  }
}

function agentProfilesPrompt(outline: ClassroomOutline, courseDescription: string) {
  return buildPrompt(PROMPT_IDS.CLASSROOM_AGENT_PROFILES, {
    courseTitle: outline.courseTitle,
    courseDescription,
    sceneOutlines: outline.outlines
      .map((scene, index) => `${index + 1}. ${scene.title} — ${scene.description}`)
      .join('\n'),
    languageDirective: outline.languageDirective,
  });
}

function fallbackProfiles(languageDirective: string): ClassroomAgentProfile[] {
  const chinese = /(?:Chinese|中文|汉语|zh(?:-|_)?CN)/i.test(languageDirective);
  const profiles: ClassroomAgentProfile[] = chinese ? [
    {
      id: `agent-${randomUUID()}`,
      name: '林老师',
      role: 'teacher',
      persona: '耐心、准确，先判断学生真正卡住的位置，再用循序渐进的问题帮助学生掌握方法。讲解时会优先使用适合本节数学课的例子。',
      priority: 10,
    },
    {
      id: `agent-${randomUUID()}`,
      name: '小助教',
      role: 'assistant',
      persona: '擅长把抽象概念换成生活化类比，并用简短例子补充老师的讲解。不会重复已经说清楚的内容。',
      priority: 7,
    },
    {
      id: `agent-${randomUUID()}`,
      name: '好奇同学',
      role: 'student',
      persona: '会从同龄学生的角度提出自然、简短的追问，也会指出容易混淆的边界情况。发言以推动理解为目的。',
      priority: 5,
    },
  ] : [
    {
      id: `agent-${randomUUID()}`,
      name: 'Ms. Lin',
      role: 'teacher',
      persona: 'Patient and precise. Diagnoses the learner’s actual gap before guiding them through the reusable method with focused questions.',
      priority: 10,
    },
    {
      id: `agent-${randomUUID()}`,
      name: 'Learning Coach',
      role: 'assistant',
      persona: 'Turns abstract ideas into one practical analogy or example. Adds a distinct perspective without repeating the teacher.',
      priority: 7,
    },
    {
      id: `agent-${randomUUID()}`,
      name: 'Curious Classmate',
      role: 'student',
      persona: 'Asks concise peer-level follow-up questions and notices common edge cases. Speaks only when it advances understanding.',
      priority: 5,
    },
  ];
  return classroomAgentProfilesSchema.parse(profiles);
}
