import { describe, expect, it } from 'vitest';

import {
  PROMPT_IDS,
  buildPrompt,
  promptRegistry,
  validatePromptRegistry,
} from '../../src/prompts';

describe('Prompt module interface', () => {
  it('builds only the English execution prompt and computes a stable revision', () => {
    const prompt = buildPrompt(PROMPT_IDS.CHAT_MAIN, {
      skillsPrompt: '<available_skills>geometry</available_skills>',
    });

    expect(prompt.system).toContain('You are Chalk, a patient and rigorous mathematics teacher.');
    expect(prompt.system).toContain('Call `read_skill` with an enabled Skill name');
    expect(prompt.system).toContain('do not construct absolute paths');
    expect(prompt.system).toContain('<available_skills>geometry</available_skills>');
    expect(prompt.system).not.toContain('你是 Chalk');
    expect(prompt.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(buildPrompt(PROMPT_IDS.CHAT_MAIN, {
      skillsPrompt: '<available_skills>geometry</available_skills>',
    }).revision).toBe(prompt.revision);
    expect(buildPrompt(PROMPT_IDS.CHAT_MAIN, {
      skillsPrompt: '<available_skills>algebra</available_skills>',
    }).revision).toBe(prompt.revision);
  });

  it('fails loud when required variables are missing or placeholders survive rendering', () => {
    expect(() => buildPrompt(PROMPT_IDS.CHAT_MAIN, {} as never)).toThrow(/skillsPrompt/);
  });

  it('keeps every execution template structurally paired with its Chinese review copy', () => {
    expect(validatePromptRegistry()).toEqual({
      promptCount: 18,
      snippetCount: 7,
    });
  });

  it('builds the detailed memory-consolidation zero-shot prompt in English', () => {
    const prompt = buildPrompt(PROMPT_IDS.MEMORY_CONSOLIDATION, {});

    expect(prompt.system).toContain('L1-to-L2 event pass');
    expect(prompt.system).toContain('exact discriminator key `op` (never `operation`)');
    expect(prompt.system).toContain('return exactly `[]`');
    expect(prompt.system).toContain('Do not skip a layer');
    expect(prompt.system).not.toContain('你是 Chalk');
    expect(prompt.system).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it('keeps the Subagent system prompt static and free of session identifiers', () => {
    const prompt = buildPrompt(PROMPT_IDS.CHAT_SUBAGENT, {});

    expect(prompt.system).toContain('You have no tools');
    expect(prompt.system).not.toContain('Parent session');
    expect(prompt.system).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it('preserves the OpenMAIC Director prompt and records the speech-only participant adaptation', () => {
    expect(promptRegistry[PROMPT_IDS.CLASSROOM_DISCUSSION_DIRECTOR].provenance).toEqual({
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      files: {
        'system.en.md': '3f4b581ef8f136ce1b2413a5548adb7cf852c5a9494c1b620a2e28d1e15328a0',
      },
    });
    expect(promptRegistry[PROMPT_IDS.CLASSROOM_DISCUSSION_PARTICIPANT].adaptedFrom).toMatchObject({
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      sourceFile: 'lib/prompts/templates/agent-system/system.md',
      sourceHash: '7da837b795d1d6bb6d3cbc029c3323ef2700384ddacf93ad8b1af4ab8e8ae63e',
    });

    const director = buildPrompt(PROMPT_IDS.CLASSROOM_DISCUSSION_DIRECTOR, {
      agentList: '- id: "teacher", name: "林老师", role: teacher, priority: 10',
      respondedList: 'None yet.',
      conversationSummary: '[Student (Human)]: 为什么移项要变号？',
      discussionSection: '',
      whiteboardSection: '',
      studentProfileSection: '',
      rule1: '1. The teacher speaks first.',
      turnCountPlusOne: 1,
      whiteboardOpenText: 'NOT AVAILABLE',
    });
    expect(director.system).toContain('{"next_agent":"<agent_id>"}');
    expect(director.system).toContain('[Student (Human)]: 为什么移项要变号？');
    expect(director.system).not.toMatch(/\{\{[^}]+\}\}/);

    const participant = buildPrompt(PROMPT_IDS.CLASSROOM_DISCUSSION_PARTICIPANT, {
      agentName: '林老师',
      persona: '耐心引导。',
      roleGuideline: 'teacher',
      peerContext: '',
      languageConstraint: 'Use Simplified Chinese.',
      stateContext: 'Scene: 等式像天平',
      discussionContextSection: 'Topic: 移项',
      lengthGuidelines: 'Keep it concise.',
      chalkboardState: 'Live Chalkboard is closed and empty.',
      chalkboardGuidelines: 'Use it only when it helps.',
    });
    expect(participant.system).toContain('# Live Chalkboard');
    expect(participant.system).toContain('# Output Format');
    expect(participant.system).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it('preserves the fixed OpenMAIC outline prompt provenance byte for byte', () => {
    expect(promptRegistry[PROMPT_IDS.CLASSROOM_OUTLINE].provenance).toEqual({
      sourceRepository: 'OpenMAIC',
      sourceCommit: '1466a55eef9e31e229a0e2e60a0811020d7b06e2',
      files: {
        'system.en.md': '813240c132acfe63007ddcf3dd764b47b5ad1d7b5005d47361ede3aa42614c65',
        'user.en.md': '79fe5ce9a64dc63f174bd1c99dd3e4f1feb2a00e2797edc2a11abc5ac2d6f9ff',
      },
    });

    const prompt = buildPrompt(PROMPT_IDS.CLASSROOM_OUTLINE, {
      requirement: '请为初一学生设计一堂勾股定理入门课。',
      pdfContent: 'None',
      availableImages: 'No images available',
      researchContext: 'None',
      teacherContext: '',
      userProfile: '',
      hasSourceImages: false,
      imageEnabled: false,
      videoEnabled: false,
      mediaEnabled: false,
    });

    expect(prompt.system).toContain('# Scene Outline Generator');
    expect(prompt.user).toContain('请为初一学生设计一堂勾股定理入门课。');
    expect(`${prompt.system}\n${prompt.user}`).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it('preserves fixed OpenMAIC slide and quiz content prompts and renders their scene variables', () => {
    expect(promptRegistry[PROMPT_IDS.CLASSROOM_SLIDE_CONTENT].provenance?.files).toEqual({
      'system.en.md': 'fac82e884070e71cf82ffca67fb1ee1c861e3cd90d4f9816c7085c428180aebd',
      'user.en.md': '7d7486fed0d897a85273794359cd17383d7b9f2dbca7481134a1519687368c99',
    });
    expect(promptRegistry[PROMPT_IDS.CLASSROOM_QUIZ_CONTENT].provenance?.files).toEqual({
      'system.en.md': '9f8b9d192f202e060ded6b0d9bc2164cc7baa00f079b1edbfcacb852513f96fd',
      'user.en.md': '823409f741caa49ba136711e4f5be79d505c060cf7432dc5dcde5973390c59e0',
    });

    const slide = buildPrompt(PROMPT_IDS.CLASSROOM_SLIDE_CONTENT, {
      title: '从直角三角形出发',
      description: '建立面积直观。',
      keyPoints: '1. 认识斜边',
      teacherContext: '',
      assignedImages: 'No media assigned',
      canvas_width: 1000,
      canvas_height: 562.5,
      languageDirective: 'Use Simplified Chinese.',
      mediaElementEnabled: false,
      imageElementEnabled: false,
      generatedImageEnabled: false,
      generatedVideoEnabled: false,
    });
    expect(slide.system).toContain('# Slide Content Generator');
    expect(slide.user).toContain('从直角三角形出发');
    expect(`${slide.system}\n${slide.user}`).not.toMatch(/\{\{[^}]+\}\}/);

    const quiz = buildPrompt(PROMPT_IDS.CLASSROOM_QUIZ_CONTENT, {
      title: '判断斜边',
      description: '检查斜边识别。',
      keyPoints: '1. 找直角',
      questionCount: 1,
      difficulty: 'easy',
      questionTypes: 'single',
      languageDirective: 'Use Simplified Chinese.',
    });
    expect(quiz.system).toContain('# Quiz Content Generator');
    expect(quiz.user).toContain('判断斜边');
  });

  it('preserves fixed OpenMAIC slide and quiz action prompts', () => {
    expect(promptRegistry[PROMPT_IDS.CLASSROOM_SLIDE_ACTIONS].provenance.files).toEqual({
      'system.en.md': '219e8da1eb3c854dbe6ee6fdedda1936e0092fff6c8984b9277c5c6cef2443b6',
      'user.en.md': '71a95329793ba0fae6030b6b9eb562bed62e9460bd26c2fcbd92d7c53f549512',
    });
    expect(promptRegistry[PROMPT_IDS.CLASSROOM_QUIZ_ACTIONS].provenance.files).toEqual({
      'system.en.md': '7ec6bfbe2fbc94af7b03e79462245cc7f8fd7f0aa8fb3d0100c903d890e52331',
      'user.en.md': '281146d66843b36b5d31fbaf9aaad24aa3ee0322778f9b6ddc9ff63a48b81666',
    });

    const slide = buildPrompt(PROMPT_IDS.CLASSROOM_SLIDE_ACTIONS, {
      title: '从直角三角形出发',
      keyPoints: '1. 认识斜边',
      description: '建立面积直观。',
      elements: '- id: "heading", type: "text", Content summary: "勾股定理"',
      courseContext: 'Course Outline:\n  1. 从直角三角形出发 ← current',
      agents: '',
      userProfile: '',
      languageDirective: '整堂课使用简体中文。',
    });
    expect(slide.system).toContain('# Slide Action Generator');
    expect(slide.user).toContain('id: "heading"');

    const quiz = buildPrompt(PROMPT_IDS.CLASSROOM_QUIZ_ACTIONS, {
      questions: 'Q1 (single): 哪条边是斜边？',
      title: '判断斜边',
      keyPoints: '1. 找直角',
      description: '检查斜边识别。',
      courseContext: 'Course Outline:\n  2. 判断斜边 ← current',
      agents: '',
      languageDirective: '整堂课使用简体中文。',
    });
    expect(quiz.system).toContain('# Quiz Action Generator');
    expect(quiz.user).toContain('哪条边是斜边？');
  });

  it('preserves and renders the fixed OpenMAIC simulation and interactive action prompts', () => {
    expect(promptRegistry[PROMPT_IDS.CLASSROOM_SIMULATION_CONTENT].provenance.files).toEqual({
      'system.en.md': 'b1ec88316f06da25e76e44b8a103639158a75fb28e45c3be82d8c48eba67d66c',
      'user.en.md': 'c5d30132dc28938b54cc22d6ba168943b8eb5066a347f00e9c6d6e6bd0dfef2d',
    });
    expect(promptRegistry[PROMPT_IDS.CLASSROOM_INTERACTIVE_ACTIONS].provenance.files).toEqual({
      'system.en.md': 'aac722a48c6bdd1f099f800e465d2fd2c7d214ea81f88704ec821c852b33eb7c',
      'user.en.md': '2007962e0454b51dc95be8ccbe40a87ceb711436f00bae8dbd88cba233b0ac27',
    });

    const content = buildPrompt(PROMPT_IDS.CLASSROOM_SIMULATION_CONTENT, {
      conceptName: 'pythagorean_area',
      conceptOverview: 'Explore the area relationship.',
      keyPoints: '1. Adjust the angle',
      variables: 'angle',
      designIdea: 'Use a draggable right triangle.',
      languageDirective: 'Use Simplified Chinese.',
    });
    expect(content.system).toContain('# Simulation Widget Content Generator');
    expect(content.user).toContain('pythagorean_area');

    const actions = buildPrompt(PROMPT_IDS.CLASSROOM_INTERACTIVE_ACTIONS, {
      title: '拖动三角形观察面积',
      conceptName: 'pythagorean_area',
      description: '调节角度并观察面积。',
      designIdea: 'Use a draggable right triangle.',
      keyPoints: '1. 调节角度',
      widgetType: 'simulation',
      widgetConfig: '{"type":"simulation"}',
      elementInventory: '#angle-slider <input type=range>',
      courseContext: 'Course Outline:\n  1. 拖动三角形观察面积 ← current',
      agents: '',
      languageDirective: '整堂课使用简体中文。',
    });
    expect(actions.system).toContain('# Interactive Scene Action Generator');
    expect(actions.user).toContain('#angle-slider');
    expect(`${content.system}\n${content.user}\n${actions.system}\n${actions.user}`).not.toMatch(/\{\{[^}]+\}\}/);
  });
});
