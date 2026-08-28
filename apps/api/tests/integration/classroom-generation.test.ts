import { randomUUID } from 'node:crypto';

import { hash } from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApi } from '../../src/app';
import { loadConfig } from '../../src/config';
import { closeDb, getDb } from '../../src/db/client';
import { authUsers } from '../../src/db/schema';

describe('Classroom outline Generation Run HTTP interface', () => {
  const suffix = randomUUID();
  const password = `password-${suffix}`;
  const users = [
    { email: `generation-user-${suffix}@chalk.local`, role: 'user' as const, name: '大纲学生' },
    { email: `generation-admin-${suffix}@chalk.local`, role: 'admin' as const, name: '大纲管理员' },
  ];
  const cookies = new Map<'user' | 'admin', string>();
  const userIds: string[] = [];
  let app: Awaited<ReturnType<typeof buildApi>>;
  let recoverableAttempts = 0;
  let recoverableQuizAttempts = 0;
  let recoverableActionAttempts = 0;
  let recoverableInteractiveAttempts = 0;
  let truncatedInteractiveAttempts = 0;
  let recoverableMediaAttempts = 0;
  let recoverableVideoPollAttempts = 0;
  let restartAttempts = 0;
  const sceneCalls = new Map<string, number>();
  const actionCalls = new Map<string, number>();
  const mediaCalls = new Map<string, number>();
  const videoSubmitCalls = new Map<string, number>();
  const progressiveCallOrder: string[] = [];
  let nextQuizContentGate: Promise<void> | null = null;
  let concurrentOutlineGate: Promise<void> | null = null;
  let concurrentOutlineStarts = 0;
  const storedMedia = new Map<string, { body: Buffer; contentType: string }>();
  let promotionCopyAttempts = 0;
  let failPromotionCopyAt: number | null = null;
  let agentProfileGenerationCalls = 0;

  beforeEach(() => {
    recoverableAttempts = 0;
    recoverableQuizAttempts = 0;
    recoverableActionAttempts = 0;
    recoverableInteractiveAttempts = 0;
    truncatedInteractiveAttempts = 0;
    recoverableMediaAttempts = 0;
    recoverableVideoPollAttempts = 0;
    restartAttempts = 0;
    promotionCopyAttempts = 0;
    failPromotionCopyAt = null;
    agentProfileGenerationCalls = 0;
    nextQuizContentGate = null;
    concurrentOutlineGate = null;
    concurrentOutlineStarts = 0;
    sceneCalls.clear();
    actionCalls.clear();
    mediaCalls.clear();
    videoSubmitCalls.clear();
    progressiveCallOrder.length = 0;
    storedMedia.clear();
  });

  async function waitForRun(cookie: string, runId: string, status: string) {
    const deadline = Date.now() + 3_000;
    let latest: unknown;
    while (Date.now() < deadline) {
      const response = await app.inject({
        method: 'GET',
        url: `/classroom-generation-runs/${runId}`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      latest = response.json().generationRun;
      if ((latest as { status?: string }).status === status) return response;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Generation Run ${runId} did not reach ${status}: ${JSON.stringify(latest)}`);
  }

  const classroomOutlineModel = {
    async *stream(userId: string, input: { system: string; user: string; signal?: AbortSignal }) {
      const result = await classroomOutlineModel.generate(userId, input);
      for (let offset = 0; offset < result.text.length; offset += 13) {
        input.signal?.throwIfAborted();
        yield { type: 'text_delta' as const, delta: result.text.slice(offset, offset + 13) };
      }
      yield {
        type: 'done' as const,
        providerId: result.providerId,
        modelId: result.modelId,
        stopReason: result.stopReason,
      };
    },
    async generate(_userId: string, input: { system: string; user: string; signal?: AbortSignal }) {
      if (input.system.includes('# Classroom Agent Profile Generator')) {
        agentProfileGenerationCalls += 1;
        return {
          providerId: 'fixture-provider',
          modelId: 'fixture-agent-profile-model',
          text: JSON.stringify({
            agents: [
              { name: '林老师', role: 'teacher', persona: '负责准确讲解并诊断学生的理解。', priority: 10 },
              { name: '小助教', role: 'assistant', persona: '负责用生活化类比补充关键步骤。', priority: 7 },
              { name: '好奇同学', role: 'student', persona: '负责提出同龄学生容易遇到的追问。', priority: 5 },
            ],
          }),
        };
      }
      if (input.system.includes('# Interactive Scene Action Generator')) {
        const title = input.user.match(/Title:\s*(.+)/)?.[1]?.trim() ?? 'unknown-interactive-actions';
        const highlightTarget = title.includes('无效选择器')
          ? '#model-invented-target'
          : input.user.includes('#angle-slider') ? '#angle-slider' : '#main-control';
        const annotationTarget = input.user.includes('#result-display') ? '#result-display' : highlightTarget;
        const revealTarget = input.user.includes('#formula') ? '#formula' : highlightTarget;
        actionCalls.set(title, (actionCalls.get(title) ?? 0) + 1);
        return {
          providerId: 'fixture-provider',
          modelId: 'fixture-action-model',
          text: JSON.stringify([
            { type: 'text', content: '拖动角度滑块，观察直角三角形面积关系怎样变化。' },
            { type: 'action', name: 'widget_highlight', params: { target: highlightTarget, content: '先关注主要控件。' } },
            { type: 'action', name: 'widget_setState', params: { state: { angle: 60 }, content: '切换到六十度。' } },
            { type: 'action', name: 'widget_annotation', params: { target: annotationTarget, content: '观察这里的变化。' } },
            { type: 'action', name: 'widget_reveal', params: { target: revealTarget, content: '现在揭示下一步。' } },
          ]),
        };
      }
      if (input.system.includes('# Slide Action Generator')) {
        const title = input.user.match(/Title:\s*(.+)/)?.[1]?.trim() ?? 'unknown-slide-actions';
        progressiveCallOrder.push(`actions:${title}`);
        actionCalls.set(title, (actionCalls.get(title) ?? 0) + 1);
        if (title.includes('无效动作场景')) {
          return {
            providerId: 'fixture-provider',
            modelId: 'fixture-action-model',
            text: 'this is not structured action JSON',
          };
        }
        if (title.includes('无效目标场景')) {
          return {
            providerId: 'fixture-provider',
            modelId: 'fixture-action-model',
            text: JSON.stringify([
              { type: 'action', name: 'spotlight', params: { elementId: 'model-invented-element' } },
              { type: 'text', content: '这条讲解不能掩盖无效的元素目标。' },
            ]),
          };
        }
        return {
          providerId: 'fixture-provider',
          modelId: 'fixture-action-model',
          text: JSON.stringify([
            { type: 'action', name: 'spotlight', params: { elementId: 'heading' } },
            { type: 'text', content: `请看${title}。` },
          ]),
        };
      }
      if (input.system.includes('# Quiz Action Generator')) {
        const title = input.user.match(/Title:\s*(.+)/)?.[1]?.trim() ?? 'unknown-quiz-actions';
        progressiveCallOrder.push(`actions:${title}`);
        actionCalls.set(title, (actionCalls.get(title) ?? 0) + 1);
        if (title.includes('可恢复动作小测')) {
          recoverableActionAttempts += 1;
          if (recoverableActionAttempts === 1) throw new Error('Secret action provider failure');
        }
        return {
          providerId: 'fixture-provider',
          modelId: 'fixture-action-model',
          text: JSON.stringify([{ type: 'text', content: title.includes('可恢复媒体小测')
            ? '这条媒体语音会先失败再恢复。'
            : '现在请独立完成小测，提交后我们再一起复盘。' }]),
        };
      }
      if (input.system.includes('# Slide Content Generator')) {
        const title = input.user.match(/(?:Scene Title|\*\*Title\*\*|Title):\s*(.+)/)?.[1]?.trim() ?? 'unknown-slide';
        progressiveCallOrder.push(`content:${title}`);
        sceneCalls.set(title, (sceneCalls.get(title) ?? 0) + 1);
        const usesGeneratedImage = input.user.includes('gen_img_1');
        const usesGeneratedVideo = input.user.includes('gen_vid_1');
        return {
          providerId: 'fixture-provider',
          modelId: 'fixture-scene-model',
          text: JSON.stringify({
            background: '#fffdf7',
            elements: [{
              id: 'heading',
              type: 'text',
              x: 80,
              y: 70,
              width: 840,
              height: 100,
              content: title,
            }, ...(usesGeneratedImage ? [{
              id: 'planned-image',
              type: 'image',
              src: 'gen_img_1',
              x: 520,
              y: 180,
              width: 400,
              height: 225,
            }] : []), ...(usesGeneratedVideo ? [{
              id: 'planned-video',
              type: 'video',
              mediaRef: 'gen_vid_1',
              x: 520,
              y: 180,
              width: 400,
              height: 225,
            }] : [])],
          }),
        };
      }
      if (input.system.includes('# Quiz Content Generator')) {
        const title = input.user.match(/(?:Scene Title|Title):\s*(.+)/)?.[1]?.trim() ?? 'unknown-quiz';
        progressiveCallOrder.push(`content:${title}`);
        sceneCalls.set(title, (sceneCalls.get(title) ?? 0) + 1);
        const gate = nextQuizContentGate;
        nextQuizContentGate = null;
        if (gate) await gate;
        if (title.includes('可恢复小测')) {
          recoverableQuizAttempts += 1;
          if (recoverableQuizAttempts === 1) throw new Error('Transient quiz provider failure');
        }
        return {
          providerId: 'fixture-provider',
          modelId: 'fixture-scene-model',
          text: JSON.stringify([{
            id: 'question_1',
            type: 'single',
            question: '直角所对的边叫什么？',
            options: [
              { id: 'a', text: '斜边' },
              { id: 'b', text: '直角边' },
            ],
            answer: ['a'],
            explanation: '直角所对的边是斜边。',
          }]),
        };
      }
      if (input.system.includes('# Simulation Widget Content Generator')) {
        const title = input.user.match(/Create a simulation widget for:\s*(.+)/)?.[1]?.trim() ?? 'unknown-interactive';
        sceneCalls.set(title, (sceneCalls.get(title) ?? 0) + 1);
        if (title.includes('recoverable_interactive')) {
          recoverableInteractiveAttempts += 1;
          if (recoverableInteractiveAttempts === 1) {
            return {
              providerId: 'fixture-provider',
              modelId: 'fixture-scene-model',
              text: '<html><body><button id="incomplete">missing widget protocol</button></body></html>',
            };
          }
        }
        return {
          providerId: 'fixture-provider',
          modelId: 'fixture-scene-model',
          text: `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>${title}</title></head>
<body>
  <label for="angle-slider">角度</label>
  <input id="angle-slider" type="range" min="15" max="75" value="45">
  <output id="result-display">a² + b² = c²</output>
  <p id="formula" hidden>\\(a^2+b^2=c^2\\)</p>
  <button id="reset-btn" type="button">重置</button>
  <script type="application/json" id="widget-config">{"type":"simulation","concept":"pythagorean_area","variables":[{"name":"angle","default":45}]}</script>
  <script>
    window.addEventListener('message', function (event) {
      const { type } = event.data || {};
      if (type === 'SET_WIDGET_STATE') document.getElementById('result-display').textContent = 'state updated';
      if (type === 'HIGHLIGHT_ELEMENT') document.getElementById('angle-slider').focus();
      if (type === 'ANNOTATE_ELEMENT') document.getElementById('result-display').dataset.annotated = 'true';
      if (type === 'REVEAL_ELEMENT') document.getElementById('formula').hidden = false;
    });
  </script>
</body>
</html>`,
        };
      }
      const widgetType = input.system.includes('# Interactive Diagram Generator') ? 'diagram'
        : input.system.includes('# Code Playground Widget Generator') ? 'code'
          : input.system.includes('# Educational Game Widget Generator') ? 'game'
            : input.system.includes('# 3D Visualization Content Generator') ? 'visualization3d'
              : null;
      if (widgetType) {
        sceneCalls.set(widgetType, (sceneCalls.get(widgetType) ?? 0) + 1);
        const title = input.user.match(/Create an educational GAME widget for:\s*(.+)/)?.[1]?.trim();
        if (widgetType === 'game' && title === '可恢复截断互动游戏') {
          truncatedInteractiveAttempts += 1;
          if (truncatedInteractiveAttempts === 1) {
            return {
              providerId: 'fixture-provider',
              modelId: 'fixture-scene-model',
              stopReason: 'length' as const,
              text: '<!DOCTYPE html><html><body><button id="main-control">开始',
            };
          }
        }
        return {
          providerId: 'fixture-provider',
          modelId: 'fixture-scene-model',
          stopReason: 'stop' as const,
          text: `<!DOCTYPE html><html lang="zh-CN"><head><title>${widgetType}</title></head><body>
<button id="main-control" type="button">开始互动</button>
<script type="application/json" id="widget-config">{"type":"${widgetType}","description":"fixture ${widgetType}"}</script>
<script>window.addEventListener('message',function(event){const type=event.data&&event.data.type;if(type==='SET_WIDGET_STATE'||type==='HIGHLIGHT_ELEMENT'||type==='ANNOTATE_ELEMENT'||type==='REVEAL_ELEMENT'){document.getElementById('main-control').dataset.message=type;}});</script>
</body></html>`,
        };
      }
      if (input.user.includes('等待取消')) {
        await new Promise<void>((_resolve, reject) => {
          input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
        });
      }
      if (input.user.includes('重启恢复')) {
        restartAttempts += 1;
        if (restartAttempts === 1) {
          // Model adapters may perform asynchronous setup before observing the
          // signal. Shutdown must still release the database claim promptly.
          await new Promise((resolve) => setTimeout(resolve, 50));
          await new Promise<void>((_resolve, reject) => {
            input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
          });
        }
      }
      if (input.user.includes('一堂可恢复失败测试课')) {
        recoverableAttempts += 1;
        if (recoverableAttempts <= 3) throw new Error('Secret provider detail must not escape');
      }
      if (input.user.includes('并发课堂')) {
        concurrentOutlineStarts += 1;
        if (concurrentOutlineGate) await concurrentOutlineGate;
      }
      return {
        providerId: 'fixture-provider',
        modelId: 'fixture-outline-model',
        text: JSON.stringify({
          languageDirective: '整堂课使用简体中文，术语在首次出现时补充英文。',
          courseTitle: '勾股定理入门',
          outlines: input.user.includes('PBL') ? [
            {
              id: 'scene_pbl',
              type: 'pbl',
              title: '不应进入 V3 的项目式学习',
              description: '验证 V3 边界。',
              keyPoints: ['PBL 不在范围内'],
              order: 1,
              pblConfig: { project: 'build a model' },
            },
          ] : input.user.includes('互动截断恢复') ? [
            {
              id: 'scene_truncated_game',
              type: 'interactive',
              title: '可恢复截断互动游戏',
              description: '通过互动游戏练习加法。',
              keyPoints: ['完成加法挑战', '观察即时反馈'],
              order: 1,
              widgetType: 'game',
              widgetOutline: { gameType: 'action', challenge: '完成加法挑战' },
            },
          ] : input.user.includes('旧版互动配置') ? [
            {
              id: 'scene_legacy_interactive',
              type: 'interactive',
              title: '调整参数观察函数图像',
              description: '拖动滑块观察一次函数图像的变化。',
              keyPoints: ['调整斜率', '观察图像', '归纳变化规律'],
              order: 1,
              interactiveConfig: {
                subject: 'math',
                conceptName: 'linear graph slope',
                conceptOverview: '一次函数图像与斜率的关系',
                designIdea: 'adjust a slope slider and observe the graph',
              },
            },
          ] : input.user.includes('互动类型契约') ? [
            ['simulation', { concept: 'function_graph', keyVariables: ['slope'] }],
            ['diagram', { diagramType: 'flowchart', nodeCount: 4 }],
            ['code', { language: 'javascript', challengeType: 'function' }],
            ['game', { gameType: 'puzzle', challenge: '拼出等式', playerControls: ['drag'] }],
            ['visualization3d', { visualizationType: 'geometry', objects: ['cube'], interactions: ['orbit'] }],
          ].map(([widgetType, widgetOutline], index) => ({
            id: `scene_widget_${index + 1}`,
            type: 'interactive',
            title: `${widgetType} 互动`,
            description: `验证 ${widgetType} 互动内容生成。`,
            keyPoints: [`操作 ${widgetType}`, '观察反馈'],
            order: index + 1,
            widgetType,
            widgetOutline,
          })) : input.user.includes('互动生成') ? [
            {
              id: 'scene_interactive',
              type: 'interactive',
              title: input.user.includes('可恢复')
                ? '可恢复互动模拟'
                : input.user.includes('无效选择器') ? '无效选择器互动' : '拖动三角形观察面积',
              description: '调节角度并观察三个正方形面积之间的关系。',
              keyPoints: ['调节三角形角度', '观察面积变化', '归纳勾股关系'],
              order: 1,
              widgetType: 'simulation',
              widgetOutline: {
                concept: input.user.includes('可恢复') ? 'recoverable_interactive' : 'pythagorean_area',
                keyVariables: ['angle'],
              },
            },
          ] : [
            {
              id: 'scene_1',
              type: 'slide',
              title: input.user.includes('动作契约失败')
                ? '无效动作场景'
                : input.user.includes('动作目标失败') ? '无效目标场景' : '从直角三角形出发',
              description: '通过面积关系建立勾股定理的直观认识。',
              keyPoints: ['认识斜边与直角边', '观察三个正方形的面积关系', '写出 a²+b²=c²'],
              order: 1,
              ...(input.user.includes('媒体规划') ? {
                mediaGenerations: input.user.includes('无效媒体规划') ? [{
                  type: 'video',
                  prompt: '展示三个正方形面积变化的动画',
                  elementId: 'gen_img_1',
                  aspectRatio: '16:9',
                }] : [
                  ...(input.system.includes('### AI-Generated Image Requests') ? [{
                    type: 'image',
                    prompt: 'A clean geometric diagram of a right triangle with three squares, all labels in Chinese',
                    elementId: 'gen_img_1',
                    aspectRatio: '16:9',
                  }] : []),
                  ...(input.system.includes('### AI-Generated Video Requests') ? [{
                    type: 'video',
                    prompt: 'An animation rearranging the two smaller squares into the largest square',
                    elementId: 'gen_vid_1',
                    aspectRatio: '16:9',
                  }] : []),
                ],
              } : {}),
            },
            {
              id: 'scene_2',
              type: 'quiz',
              title: input.user.includes('逐场景可恢复失败')
                ? '可恢复小测'
                : input.user.includes('媒体可恢复失败') ? '可恢复媒体小测'
                : input.user.includes('动作可恢复失败') ? '可恢复动作小测' : '判断边长关系',
              description: '用一道选择题检查学生能否识别斜边。',
              keyPoints: ['先找直角', '直角所对的边是斜边'],
              order: 2,
              quizConfig: { questionCount: 1, difficulty: 'easy', questionTypes: ['single'] },
            },
          ],
        }),
      };
    },
  };

  function responseCookie(value: string | string[] | undefined) {
    const first = Array.isArray(value) ? value[0] : value;
    return first?.split(';', 1)[0] ?? '';
  }

  function parseOutlineEvents(body: string) {
    return body.split('\n\n').flatMap((frame) => {
      const id = frame.match(/^id: (\d+)$/m)?.[1];
      const data = frame.match(/^data: (.+)$/m)?.[1];
      return id && data ? [{ id, data: JSON.parse(data) as Record<string, unknown> }] : [];
    });
  }

  function expectAcceptedRunStatus(status: unknown) {
    expect(['queued', 'running', 'completed', 'failed']).toContain(status);
  }

  function buildTestApi() {
    const options = {
      config: loadConfig({
        NODE_ENV: 'test',
        SESSION_COOKIE_NAME: `generation_${suffix}`,
        SESSION_COOKIE_SECURE: 'false',
      }),
      classroomOutlineModel,
      classroomMediaGenerator: {
        async synthesize(_userId: string, input: { text: string; providerId: string; voice: string; model?: string; format?: string }) {
          mediaCalls.set(input.text, (mediaCalls.get(input.text) ?? 0) + 1);
          if (input.text.includes('媒体语音会先失败')) {
            recoverableMediaAttempts += 1;
            if (recoverableMediaAttempts === 1) throw new Error('Secret media provider failure');
          }
          return {
            bytes: Buffer.from(`fixture-audio:${input.text}`),
            contentType: 'audio/mpeg',
            format: 'mp3',
            providerId: input.providerId,
            modelId: input.model ?? 'fixture-tts-model',
          };
        },
        async generateImage(_userId: string, input: { prompt: string; providerId: string; model?: string }) {
          mediaCalls.set(input.prompt, (mediaCalls.get(input.prompt) ?? 0) + 1);
          return {
            bytes: Buffer.from(`fixture-image:${input.prompt}`),
            contentType: 'image/png',
            format: 'png',
            providerId: input.providerId,
            modelId: input.model ?? 'fixture-image-model',
          };
        },
        async submitVideo(_userId: string, input: { prompt: string; providerId: string; model?: string }) {
          videoSubmitCalls.set(input.prompt, (videoSubmitCalls.get(input.prompt) ?? 0) + 1);
          return {
            providerTaskId: `fixture-video-task-${videoSubmitCalls.get(input.prompt)}`,
            providerId: input.providerId,
            modelId: input.model ?? 'fixture-video-model',
          };
        },
        async pollVideo(_userId: string, input: { providerTaskId: string; providerId: string; modelId: string }) {
          recoverableVideoPollAttempts += 1;
          if (recoverableVideoPollAttempts === 1) throw new Error('Secret asynchronous video poll failure');
          return {
            status: 'done' as const,
            bytes: Buffer.from(`fixture-video:${input.providerTaskId}`),
            contentType: 'video/mp4',
            format: 'mp4',
          };
        },
      },
      classroomObjectStorage: {
        async putObject(input: { fileKey: string; body: Buffer; contentType: string }) {
          storedMedia.set(input.fileKey, { body: input.body, contentType: input.contentType });
        },
        async createDownloadUrl(fileKey: string) { return `https://storage.test/${fileKey}`; },
        async copyObject(input: { sourceKey: string; targetKey: string }) {
          promotionCopyAttempts += 1;
          if (promotionCopyAttempts === failPromotionCopyAt) throw new Error('Fixture artifact media copy failure');
          const source = storedMedia.get(input.sourceKey);
          if (!source) throw new Error(`Missing fixture object: ${input.sourceKey}`);
          storedMedia.set(input.targetKey, source);
        },
        async deleteObject(fileKey: string) { storedMedia.delete(fileKey); },
      },
      classroomGenerationWorker: { pollIntervalMs: 5, leaseDurationMs: 10_000, heartbeatIntervalMs: 1_000 },
    };
    return buildApi(options as Parameters<typeof buildApi>[0]);
  }

  beforeAll(async () => {
    const insertedUsers = await getDb()
      .insert(authUsers)
      .values(await Promise.all(users.map(async (user) => ({
        ...user,
        passwordHash: await hash(password, 4),
      }))))
      .returning({ id: authUsers.id });
    userIds.push(...insertedUsers.map((user) => user.id));

    app = await buildTestApi();

    for (const user of users) {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password },
      });
      expect(login.statusCode).toBe(200);
      cookies.set(user.role, responseCookie(login.headers['set-cookie']));
    }
  });

  afterAll(async () => {
    await app?.close();
    if (userIds.length > 0) await getDb().delete(authUsers).where(inArray(authUsers.id, userIds));
    await closeDb();
  });

  it('creates a persisted outline draft that only its owner can retrieve', async () => {
    const anonymous = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      payload: { requirements: '请为初一学生设计一堂勾股定理入门课。' },
    });
    expect(anonymous.statusCode).toBe(401);

    const created = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: {
        requirements: '请为初一学生设计一堂勾股定理入门课。',
        context: { sourceText: '学生已经认识直角三角形，但还没有学习平方。' },
      },
    });

    expect(created.statusCode).toBe(202);
    expect(created.json().generationRun).toMatchObject({
      classroomId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      stage: 'outline',
      attempt: 1,
    });
    expectAcceptedRunStatus(created.json().generationRun.status);

    const classroomId = created.json().generationRun.classroomId as string;
    const generatingList = await app.inject({
      method: 'GET',
      url: '/classrooms',
      headers: { cookie: cookies.get('user') },
    });
    expect(generatingList.statusCode).toBe(200);
    expect(generatingList.json().classrooms).toContainEqual(expect.objectContaining({
      id: classroomId,
      latestArtifact: null,
      generation: expect.objectContaining({
        runId: created.json().generationRun.id,
        draftId: created.json().generationRun.draftId,
        stage: 'outline',
      }),
    }));

    const completed = await waitForRun(cookies.get('user')!, created.json().generationRun.id, 'completed');
    expect(completed.json().generationRun).toMatchObject({
      stage: 'outline',
      status: 'completed',
      attempt: 1,
      requirements: '请为初一学生设计一堂勾股定理入门课。',
      context: { sourceText: '学生已经认识直角三角形，但还没有学习平方。' },
      prompt: { id: 'classroom-outline', revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
      model: { providerId: 'fixture-provider', modelId: 'fixture-outline-model' },
      outline: {
        courseTitle: '勾股定理入门',
        outlines: [
          expect.objectContaining({ id: 'scene_1', order: 1, type: 'slide' }),
          expect.objectContaining({ id: 'scene_2', order: 2, type: 'quiz' }),
        ],
      },
    });

    const outlinedList = await app.inject({
      method: 'GET',
      url: '/classrooms',
      headers: { cookie: cookies.get('user') },
    });
    expect(outlinedList.json().classrooms).toContainEqual(expect.objectContaining({
      id: classroomId,
      title: '勾股定理入门',
      latestArtifact: null,
      generation: expect.objectContaining({ runId: created.json().generationRun.id }),
    }));

    const runId = completed.json().generationRun.id as string;
    const retrieved = await app.inject({
      method: 'GET',
      url: `/classroom-generation-runs/${runId}`,
      headers: { cookie: cookies.get('user') },
    });
    expect(retrieved.statusCode).toBe(200);
    expect(retrieved.json()).toEqual(completed.json());

    const foreignRead = await app.inject({
      method: 'GET',
      url: `/classroom-generation-runs/${runId}`,
      headers: { cookie: cookies.get('admin') },
    });
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignRead.json()).toEqual({ error: 'Resource not found', code: 'NOT_FOUND' });
  });

  it('claims up to ten different classroom runs concurrently and queues the eleventh', async () => {
    let releaseConcurrentOutlines!: () => void;
    concurrentOutlineGate = new Promise<void>((resolve) => { releaseConcurrentOutlines = resolve; });
    const createdRuns: string[] = [];
    try {
      for (let index = 1; index <= 11; index += 1) {
        const created = await app.inject({
          method: 'POST',
          url: '/classroom-generation-runs',
          headers: { cookie: cookies.get('user') },
          payload: { requirements: `并发课堂 ${index}` },
        });
        expect(created.statusCode).toBe(202);
        createdRuns.push(created.json().generationRun.id as string);
      }

      const startDeadline = Date.now() + 3_000;
      while (concurrentOutlineStarts < 10 && Date.now() < startDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(concurrentOutlineStarts).toBe(10);

      const states = await Promise.all(createdRuns.map(async (runId) => {
        const response = await app.inject({
          method: 'GET',
          url: `/classroom-generation-runs/${runId}`,
          headers: { cookie: cookies.get('user') },
        });
        return response.json().generationRun.status as string;
      }));
      expect(states.filter((status) => status === 'running')).toHaveLength(10);
      expect(states.filter((status) => status === 'queued')).toHaveLength(1);
    } finally {
      releaseConcurrentOutlines();
      concurrentOutlineGate = null;
    }

    await Promise.all(createdRuns.map((runId) => waitForRun(cookies.get('user')!, runId, 'completed')));
    expect(concurrentOutlineStarts).toBe(11);
  });

  it('confirms an owned V3 outline as one immutable revision and rejects PBL', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: { requirements: '请生成一堂渐进式大纲确认测试课。' },
    });
    const completed = await waitForRun(cookies.get('user')!, created.json().generationRun.id, 'completed');
    const outlineRun = completed.json().generationRun as {
      id: string;
      candidateVersion: string;
      outline: {
        languageDirective: string;
        courseTitle: string;
        outlines: Array<Record<string, unknown>>;
      };
    };
    const idempotencyKey = randomUUID();

    const foreignConfirm = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.id}/outline-revisions`,
      headers: { cookie: cookies.get('admin') },
      payload: { idempotencyKey, candidateVersion: outlineRun.candidateVersion, outline: outlineRun.outline },
    });
    expect(foreignConfirm.statusCode).toBe(404);

    const pblConfirm = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.id}/outline-revisions`,
      headers: { cookie: cookies.get('user') },
      payload: {
        idempotencyKey,
        candidateVersion: outlineRun.candidateVersion,
        outline: {
          ...outlineRun.outline,
          outlines: [{
            id: 'project_1',
            type: 'pbl',
            title: '项目学习',
            description: 'V3 不应接受这个场景。',
            keyPoints: ['验证范围边界'],
            order: 1,
            pblConfig: { goal: 'build' },
          }],
        },
      },
    });
    expect(pblConfirm.statusCode).toBe(422);
    expect(pblConfirm.json()).toMatchObject({ code: 'CLASSROOM_OUTLINE_TYPE_UNSUPPORTED' });

    const staleConfirm = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.id}/outline-revisions`,
      headers: { cookie: cookies.get('user') },
      payload: {
        idempotencyKey,
        candidateVersion: '0'.repeat(64),
        outline: outlineRun.outline,
      },
    });
    expect(staleConfirm.statusCode).toBe(409);
    expect(staleConfirm.json()).toMatchObject({ code: 'CLASSROOM_OUTLINE_CANDIDATE_STALE' });

    const editedOutline = {
      ...outlineRun.outline,
      courseTitle: '确认后的勾股定理课堂',
      outlines: outlineRun.outline.outlines.map((scene, index) => ({
        ...scene,
        order: index + 1,
      })),
    };
    const confirmationRequest = () => app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.id}/outline-revisions`,
      headers: { cookie: cookies.get('user') },
      payload: { idempotencyKey, candidateVersion: outlineRun.candidateVersion, outline: editedOutline },
    });
    const confirmationResponses = await Promise.all([confirmationRequest(), confirmationRequest()]);
    const confirmed = confirmationResponses.find((response) => response.json().created === true)!;
    const repeated = confirmationResponses.find((response) => response.json().created === false)!;
    expect(confirmed.statusCode).toBe(202);
    expect(repeated.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      created: true,
      outlineRevision: {
        number: 1,
        outline: { courseTitle: '确认后的勾股定理课堂' },
      },
      generationRun: {
        draftId: completed.json().generationRun.draftId,
        stage: 'progressive',
      },
    });
    expectAcceptedRunStatus(confirmed.json().generationRun.status);
    expect(confirmed.json().outlineRevision.id).toMatch(/^[0-9a-f-]{36}$/);

    const classroomList = await app.inject({
      method: 'GET',
      url: '/classrooms',
      headers: { cookie: cookies.get('user') },
    });
    expect(classroomList.json().classrooms).toContainEqual(expect.objectContaining({
      id: completed.json().generationRun.classroomId,
      title: '确认后的勾股定理课堂',
      latestArtifact: null,
      generation: expect.objectContaining({
        runId: confirmed.json().generationRun.id,
        stage: 'progressive',
      }),
    }));

    expect(repeated.json()).toMatchObject({
      created: false,
      outlineRevision: {
        id: confirmed.json().outlineRevision.id,
        contentHash: confirmed.json().outlineRevision.contentHash,
      },
      generationRun: { id: confirmed.json().generationRun.id },
    });
    await waitForRun(cookies.get('user')!, confirmed.json().generationRun.id, 'completed');
    expect(agentProfileGenerationCalls).toBe(1);

    const conflicting = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.id}/outline-revisions`,
      headers: { cookie: cookies.get('user') },
      payload: {
        idempotencyKey,
        candidateVersion: outlineRun.candidateVersion,
        outline: { ...editedOutline, courseTitle: '不能复用幂等键修改 revision' },
      },
    });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json()).toMatchObject({ code: 'CLASSROOM_OUTLINE_REVISION_CONFLICT' });
    const afterConflictList = await app.inject({
      method: 'GET',
      url: '/classrooms',
      headers: { cookie: cookies.get('user') },
    });
    expect(afterConflictList.json().classrooms).toContainEqual(expect.objectContaining({
      id: completed.json().generationRun.classroomId,
      title: '确认后的勾股定理课堂',
    }));
  });

  it('streams only persisted complete outline objects and resumes after Last-Event-ID', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: { requirements: '用两个场景流式讲解勾股定理', context: {} },
    });
    expect(created.statusCode).toBe(202);
    const runId = created.json().generationRun.id as string;

    await waitForRun(cookies.get('user')!, runId, 'completed');
    const streamed = await app.inject({
      method: 'GET',
      url: `/classroom-generation-runs/${runId}/outline-events`,
      headers: { cookie: cookies.get('user'), accept: 'text/event-stream' },
    });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    const events = parseOutlineEvents(streamed.body);
    expect(events.map((event) => event.data.type)).toEqual([
      'languageDirective',
      'courseTitle',
      'outline',
      'outline',
      'done',
    ]);
    expect(events.filter((event) => event.data.type === 'outline').map((event) => event.data.data)).toMatchObject([
      { id: 'scene_1', order: 1, type: 'slide', title: '从直角三角形出发' },
      { id: 'scene_2', order: 2, type: 'quiz', title: '判断边长关系' },
    ]);

    const firstOutline = events.find((event) => event.data.type === 'outline')!;
    const resumed = await app.inject({
      method: 'GET',
      url: `/classroom-generation-runs/${runId}/outline-events`,
      headers: {
        cookie: cookies.get('user'),
        accept: 'text/event-stream',
        'last-event-id': firstOutline.id,
      },
    });
    expect(resumed.statusCode).toBe(200);
    expect(parseOutlineEvents(resumed.body).map((event) => event.data.type)).toEqual(['outline', 'done']);

    const foreign = await app.inject({
      method: 'GET',
      url: `/classroom-generation-runs/${runId}/outline-events`,
      headers: { cookie: cookies.get('admin'), accept: 'text/event-stream' },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('never emits or persists a PBL outline in the V3 stream', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: { requirements: '请生成一堂 PBL 课程', context: {} },
    });
    const runId = created.json().generationRun.id as string;
    const failed = await waitForRun(cookies.get('user')!, runId, 'failed');
    expect(failed.json().generationRun).toMatchObject({
      outline: null,
      error: { code: 'CLASSROOM_OUTLINE_TYPE_UNSUPPORTED' },
    });

    const streamed = await app.inject({
      method: 'GET',
      url: `/classroom-generation-runs/${runId}/outline-events`,
      headers: { cookie: cookies.get('user'), accept: 'text/event-stream' },
    });
    const events = parseOutlineEvents(streamed.body);
    expect(events.some((event) => event.data.type === 'outline')).toBe(false);
    expect(events.at(-1)?.data).toEqual({
      type: 'error',
      error: 'Unable to generate a valid classroom outline',
    });
  });

  it('progresses from one confirmed revision through Scene preview, remaining Scenes, and idempotent publication', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: { requirements: '请生成一堂 V3 完整渐进链路测试课。' },
    });
    const outlineRun = await waitForRun(cookies.get('user')!, created.json().generationRun.id, 'completed');
    const outline = outlineRun.json().generationRun.outline as {
      languageDirective: string;
      courseTitle: string;
      outlines: Array<Record<string, unknown>>;
    };
    const editedOutline = {
      ...outline,
      courseTitle: 'V3 完整渐进链路',
      outlines: outline.outlines.map((scene, index) => ({
        ...scene,
        title: index === 0 ? '链路第一幕' : '链路第二幕',
      })),
    };
    progressiveCallOrder.length = 0;
    let releaseQuizContent!: () => void;
    nextQuizContentGate = new Promise<void>((resolve) => { releaseQuizContent = resolve; });
    const confirmed = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/outline-revisions`,
      headers: { cookie: cookies.get('user') },
      payload: {
        idempotencyKey: randomUUID(),
        candidateVersion: outlineRun.json().generationRun.candidateVersion,
        outline: editedOutline,
      },
    });
    expect(confirmed.statusCode).toBe(202);
    const progressiveRunId = confirmed.json().generationRun.id as string;

    const previewDeadline = Date.now() + 3_000;
    let previewRun: Record<string, any> | null = null;
    while (Date.now() < previewDeadline) {
      const response = await app.inject({
        method: 'GET',
        url: `/classroom-generation-runs/${progressiveRunId}`,
        headers: { cookie: cookies.get('user') },
      });
      if (response.json().generationRun.previewReady) {
        previewRun = response.json().generationRun;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(previewRun).toMatchObject({
      stage: 'progressive',
      status: 'running',
      previewReady: true,
      publishReady: false,
      context: {
        agentProfiles: [
          { id: expect.stringMatching(/^agent-/), name: '林老师', role: 'teacher', priority: 10 },
          { id: expect.stringMatching(/^agent-/), name: '小助教', role: 'assistant', priority: 7 },
          { id: expect.stringMatching(/^agent-/), name: '好奇同学', role: 'student', priority: 5 },
        ],
        agentProfileGeneration: {
          source: 'model',
          promptId: 'classroom-agent-profiles',
          promptRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
          providerId: 'fixture-provider',
          modelId: 'fixture-agent-profile-model',
        },
      },
      scenes: [
        { outlineId: 'scene_1', phase: 'completed', status: 'completed' },
        { outlineId: 'scene_2', phase: 'content', status: expect.stringMatching(/^(pending|running)$/) },
      ],
    });

    releaseQuizContent();
    const completed = await waitForRun(cookies.get('user')!, progressiveRunId, 'completed');
    expect(completed.json().generationRun).toMatchObject({
      stage: 'progressive',
      status: 'completed',
      previewReady: true,
      publishReady: true,
      progress: { total: 2, completed: 2, failed: 0 },
      scenes: [
        { outlineId: 'scene_1', phase: 'completed', status: 'completed' },
        { outlineId: 'scene_2', phase: 'completed', status: 'completed' },
      ],
    });
    expect(progressiveCallOrder.filter((entry) => entry.includes('链路'))).toEqual([
      'content:链路第一幕',
      'actions:链路第一幕',
      'content:链路第二幕',
      'actions:链路第二幕',
    ]);

    const published = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${progressiveRunId}/publish`,
      headers: { cookie: cookies.get('user') },
    });
    expect(published.statusCode).toBe(201);
    const classroom = published.json().classroom;
    expect(classroom.id).toBe(outlineRun.json().generationRun.classroomId);
    const artifact = await app.inject({
      method: 'GET',
      url: `/classrooms/${classroom.id}/artifacts/${classroom.latestArtifact.id}`,
      headers: { cookie: cookies.get('user') },
    });
    expect(artifact.statusCode).toBe(200);
    expect(artifact.json().document.stage.agentProfiles).toMatchObject([
      { name: '林老师', role: 'teacher' },
      { name: '小助教', role: 'assistant' },
      { name: '好奇同学', role: 'student' },
    ]);
    const repeated = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${progressiveRunId}/publish`,
      headers: { cookie: cookies.get('user') },
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().classroom.id).toBe(published.json().classroom.id);
  });

  it('runs planned media beside the remaining progressive Scene lane and gates publication', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: {
        requirements: '请生成一堂 V3 媒体规划并行链路测试课。',
        media: { image: { providerId: 'openai', model: 'gpt-image-1', aspectRatio: '16:9' } },
      },
    });
    const outlineRun = await waitForRun(cookies.get('user')!, created.json().generationRun.id, 'completed');
    let releaseQuizContent!: () => void;
    nextQuizContentGate = new Promise<void>((resolve) => { releaseQuizContent = resolve; });
    const confirmed = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/outline-revisions`,
      headers: { cookie: cookies.get('user') },
      payload: {
        idempotencyKey: randomUUID(),
        candidateVersion: outlineRun.json().generationRun.candidateVersion,
        outline: outlineRun.json().generationRun.outline,
      },
    });
    const runId = confirmed.json().generationRun.id as string;

    const mediaDeadline = Date.now() + 3_000;
    let concurrentState: Record<string, any> | null = null;
    while (Date.now() < mediaDeadline) {
      const response = await app.inject({
        method: 'GET',
        url: `/classroom-generation-runs/${runId}`,
        headers: { cookie: cookies.get('user') },
      });
      const generationRun = response.json().generationRun;
      if (generationRun.previewReady && generationRun.progress?.media?.completed === 1) {
        concurrentState = generationRun;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(concurrentState).toMatchObject({
      status: 'running',
      previewReady: true,
      publishReady: false,
      progress: {
        completed: 1,
        media: { total: 1, completed: 1, failed: 0 },
      },
      mediaTasks: [{ kind: 'image', status: 'completed', mediaRef: expect.stringMatching(/^media\/generated\//) }],
    });

    const earlyPublish = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${runId}/publish`,
      headers: { cookie: cookies.get('user') },
    });
    expect(earlyPublish.statusCode).toBe(409);
    expect(earlyPublish.json()).toMatchObject({ code: 'CLASSROOM_DRAFT_NOT_READY' });

    releaseQuizContent();
    const completed = await waitForRun(cookies.get('user')!, runId, 'completed');
    expect(completed.json().generationRun).toMatchObject({
      publishReady: true,
      progress: { completed: 2, media: { total: 1, completed: 1, failed: 0 } },
    });
    const published = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${runId}/publish`,
      headers: { cookie: cookies.get('user') },
    });
    expect(published.statusCode).toBe(201);
  });

  it('keeps completed progressive Scenes and restarts a failed Scene from content', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: { requirements: '请生成一堂 V3 动作可恢复失败测试课。' },
    });
    const outlineRun = await waitForRun(cookies.get('user')!, created.json().generationRun.id, 'completed');
    const confirmed = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/outline-revisions`,
      headers: { cookie: cookies.get('user') },
      payload: {
        idempotencyKey: randomUUID(),
        candidateVersion: outlineRun.json().generationRun.candidateVersion,
        outline: outlineRun.json().generationRun.outline,
      },
    });
    const runId = confirmed.json().generationRun.id as string;
    const failed = await waitForRun(cookies.get('user')!, runId, 'failed');
    expect(failed.json().generationRun).toMatchObject({
      previewReady: true,
      progress: { total: 2, completed: 1, failed: 1 },
      scenes: [
        { outlineId: 'scene_1', phase: 'completed', status: 'completed', attempt: 1 },
        { outlineId: 'scene_2', phase: 'actions', status: 'failed', attempt: 1 },
      ],
      error: { code: 'CLASSROOM_SCENE_ACTIONS_GENERATION_FAILED' },
    });
    const firstContentCalls = sceneCalls.get('从直角三角形出发');
    const failedSceneContentCalls = sceneCalls.get('可恢复动作小测');

    const retried = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${runId}/retry`,
      headers: { cookie: cookies.get('user') },
    });
    expect(retried.statusCode).toBe(202);
    const completed = await waitForRun(cookies.get('user')!, runId, 'completed');
    expect(completed.json().generationRun).toMatchObject({
      attempt: 2,
      progress: { total: 2, completed: 2, failed: 0 },
      scenes: [
        { outlineId: 'scene_1', phase: 'completed', status: 'completed', attempt: 1 },
        { outlineId: 'scene_2', phase: 'completed', status: 'completed', attempt: 2 },
      ],
    });
    expect(sceneCalls.get('从直角三角形出发')).toBe(firstContentCalls);
    expect(sceneCalls.get('可恢复动作小测')).toBe((failedSceneContentCalls ?? 0) + 1);
  });

  it('restores the latest unpublished Generation Run only for its owner', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: { requirements: '请生成一堂刷新恢复入口测试课。' },
    });
    expect(created.statusCode).toBe(202);
    const runId = created.json().generationRun.id as string;

    const restored = await app.inject({
      method: 'GET',
      url: '/classroom-generation-runs/current',
      headers: { cookie: cookies.get('user') },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().generationRun).toMatchObject({ id: runId });

    const foreign = await app.inject({
      method: 'GET',
      url: '/classroom-generation-runs/current',
      headers: { cookie: cookies.get('admin') },
    });
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json().generationRun?.id).not.toBe(runId);

    const anonymous = await app.inject({ method: 'GET', url: '/classroom-generation-runs/current' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('persists explicit media planning inputs and enables only those outline capabilities', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: {
        requirements: '请生成一堂媒体规划测试课。',
        media: {
          image: { providerId: 'openai', model: 'gpt-image-1', aspectRatio: '16:9' },
          video: { providerId: 'kling', model: 'kling-v2-1', aspectRatio: '16:9', durationSeconds: 5, resolution: '720p' },
        },
      },
    });

    expect(created.statusCode).toBe(202);
    const completed = await waitForRun(cookies.get('user')!, created.json().generationRun.id, 'completed');
    expect(completed.json().generationRun).toMatchObject({
      context: {
        media: {
          image: { providerId: 'openai', model: 'gpt-image-1', aspectRatio: '16:9' },
          video: { providerId: 'kling', model: 'kling-v2-1', aspectRatio: '16:9', durationSeconds: 5, resolution: '720p' },
        },
      },
      outline: {
        outlines: [
          expect.objectContaining({
            id: 'scene_1',
            mediaGenerations: [
              expect.objectContaining({ type: 'image', elementId: 'gen_img_1' }),
              expect.objectContaining({ type: 'video', elementId: 'gen_vid_1' }),
            ],
          }),
          expect.objectContaining({ id: 'scene_2' }),
        ],
      },
    });
  });

  it('fails closed when an outline media request violates the enabled media contract', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('admin') },
      payload: {
        requirements: '请生成一堂无效媒体规划测试课。',
        media: { video: { providerId: 'kling' } },
      },
    });

    expect(created.statusCode).toBe(202);
    const failed = await waitForRun(cookies.get('admin')!, created.json().generationRun.id, 'failed');
    expect(failed.json().generationRun).toMatchObject({
      status: 'failed',
      outline: null,
      error: { code: 'CLASSROOM_OUTLINE_INVALID' },
    });
  });

  it('persists a failed run and retries the same draft without exposing provider details', async () => {
    const failed = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('admin') },
      payload: { requirements: '请生成一堂可恢复失败测试课。' },
    });

    expect(failed.statusCode).toBe(202);
    expect(failed.json().generationRun).toMatchObject({ attempt: 1 });
    expectAcceptedRunStatus(failed.json().generationRun.status);
    const failedRunResponse = await waitForRun(cookies.get('admin')!, failed.json().generationRun.id, 'failed');
    expect(failedRunResponse.json().generationRun).toMatchObject({
      status: 'failed',
      attempt: 1,
      outline: null,
      error: { code: 'CLASSROOM_OUTLINE_GENERATION_FAILED' },
    });
    expect(JSON.stringify(failedRunResponse.json())).not.toContain('Secret provider detail');

    const failedRun = failedRunResponse.json().generationRun as { id: string; draftId: string };
    const retried = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${failedRun.id}/retry`,
      headers: { cookie: cookies.get('admin') },
    });

    expect(retried.statusCode).toBe(202);
    expect(retried.json().generationRun).toMatchObject({ attempt: 2 });
    expectAcceptedRunStatus(retried.json().generationRun.status);
    const completedRetry = await waitForRun(cookies.get('admin')!, failedRun.id, 'completed');
    expect(completedRetry.json().generationRun).toMatchObject({
      id: failedRun.id,
      draftId: failedRun.draftId,
      status: 'completed',
      attempt: 2,
      error: null,
      outline: { courseTitle: '勾股定理入门' },
    });

    const foreignRetry = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${failedRun.id}/retry`,
      headers: { cookie: cookies.get('user') },
    });
    expect(foreignRetry.statusCode).toBe(404);
  });

  it('aborts a running model call and keeps cancellation owner scoped', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: { requirements: '请生成一堂等待取消的课堂。' },
    });
    expect(created.statusCode).toBe(202);
    const runId = created.json().generationRun.id as string;
    await waitForRun(cookies.get('user')!, runId, 'running');

    const foreignAbort = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${runId}/abort`,
      headers: { cookie: cookies.get('admin') },
    });
    expect(foreignAbort.statusCode).toBe(404);

    const aborted = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${runId}/abort`,
      headers: { cookie: cookies.get('user') },
    });
    expect(aborted.statusCode).toBe(202);
    expect(aborted.json().generationRun).toMatchObject({
      status: expect.stringMatching(/^(running|aborted)$/),
      cancelRequested: true,
    });
    const terminal = await waitForRun(cookies.get('user')!, runId, 'aborted');
    expect(terminal.json().generationRun).toMatchObject({
      status: 'aborted',
      error: null,
      cancelRequested: true,
    });
  });

  it('generates and persists scene content one scene at a time with owner-scoped progress', async () => {
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: { requirements: '请生成一堂逐场景内容测试课。' },
    });
    const outlineRun = await waitForRun(cookies.get('user')!, outline.json().generationRun.id, 'completed');

    const foreignStart = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie: cookies.get('admin') },
    });
    expect(foreignStart.statusCode).toBe(404);

    const started = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie: cookies.get('user') },
    });
    expect(started.statusCode).toBe(202);
    expect(started.json().generationRun).toMatchObject({
      stage: 'scene_content',
      attempt: 1,
      progress: { total: 2 },
    });
    expectAcceptedRunStatus(started.json().generationRun.status);
    const duplicateStart = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie: cookies.get('user') },
    });
    expect(duplicateStart.statusCode).toBe(409);
    expect(duplicateStart.json()).toMatchObject({ code: 'CLASSROOM_SCENE_CONTENT_EXISTS' });

    const completed = await waitForRun(cookies.get('user')!, started.json().generationRun.id, 'completed');
    expect(completed.json().generationRun).toMatchObject({
      stage: 'scene_content',
      status: 'completed',
      progress: { total: 2, completed: 2, failed: 0 },
      scenes: [
        {
          outlineId: 'scene_1',
          type: 'slide',
          status: 'completed',
          attempt: 1,
          prompt: { id: 'classroom-slide-content', revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
          model: { providerId: 'fixture-provider', modelId: 'fixture-scene-model' },
          content: { type: 'slide', canvas: { background: '#fffdf7', elements: [expect.objectContaining({ id: 'heading' })] } },
        },
        {
          outlineId: 'scene_2',
          type: 'quiz',
          status: 'completed',
          attempt: 1,
          prompt: { id: 'classroom-quiz-content', revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
          content: { type: 'quiz', questions: [expect.objectContaining({ id: 'question_1', answer: ['a'] })] },
        },
      ],
    });
  });

  it('keeps completed scenes and retries only unfinished scene content', async () => {
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('admin') },
      payload: { requirements: '请生成一堂逐场景可恢复失败测试课。' },
    });
    const outlineRun = await waitForRun(cookies.get('admin')!, outline.json().generationRun.id, 'completed');
    const started = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie: cookies.get('admin') },
    });
    const failed = await waitForRun(cookies.get('admin')!, started.json().generationRun.id, 'failed');
    expect(failed.json().generationRun).toMatchObject({
      progress: { total: 2, completed: 1, failed: 1 },
      scenes: [
        { outlineId: 'scene_1', status: 'completed', attempt: 1, content: expect.any(Object) },
        { outlineId: 'scene_2', status: 'failed', attempt: 1, content: null },
      ],
      error: { code: 'CLASSROOM_SCENE_CONTENT_GENERATION_FAILED' },
    });
    const slideCallsBeforeRetry = sceneCalls.get('从直角三角形出发');

    const retried = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${started.json().generationRun.id}/retry`,
      headers: { cookie: cookies.get('admin') },
    });
    expect(retried.statusCode).toBe(202);
    expect(retried.json().generationRun).toMatchObject({ attempt: 2 });
    expectAcceptedRunStatus(retried.json().generationRun.status);
    const completed = await waitForRun(cookies.get('admin')!, started.json().generationRun.id, 'completed');
    expect(completed.json().generationRun).toMatchObject({
      progress: { total: 2, completed: 2, failed: 0 },
      scenes: [
        { outlineId: 'scene_1', status: 'completed', attempt: 1 },
        { outlineId: 'scene_2', status: 'completed', attempt: 2 },
      ],
    });
    expect(sceneCalls.get('从直角三角形出发')).toBe(slideCallsBeforeRetry);
  });

  it('generates and persists owner-scoped actions after scene content completes', async () => {
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: { requirements: '请生成一堂逐场景教师动作测试课。' },
    });
    const outlineRun = await waitForRun(cookies.get('user')!, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie: cookies.get('user') },
    });
    const contentRun = await waitForRun(cookies.get('user')!, content.json().generationRun.id, 'completed');

    const anonymous = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`,
    });
    expect(anonymous.statusCode).toBe(401);
    const foreignStart = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`,
      headers: { cookie: cookies.get('admin') },
    });
    expect(foreignStart.statusCode).toBe(404);

    const started = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`,
      headers: { cookie: cookies.get('user') },
    });
    expect(started.statusCode).toBe(202);
    expect(started.json().generationRun).toMatchObject({
      stage: 'scene_actions',
      attempt: 1,
      progress: { total: 2 },
    });
    expectAcceptedRunStatus(started.json().generationRun.status);

    const completed = await waitForRun(cookies.get('user')!, started.json().generationRun.id, 'completed');
    expect(completed.json().generationRun).toMatchObject({
      stage: 'scene_actions',
      status: 'completed',
      progress: { total: 2, completed: 2, failed: 0 },
      scenes: [
        {
          outlineId: 'scene_1',
          status: 'completed',
          attempt: 1,
          prompt: { id: 'classroom-slide-actions', revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
          model: { providerId: 'fixture-provider', modelId: 'fixture-action-model' },
          actions: [
            { id: expect.stringMatching(/^action_/), type: 'spotlight', elementId: 'heading' },
            { id: expect.stringMatching(/^action_/), type: 'speech', text: '请看从直角三角形出发。' },
          ],
        },
        {
          outlineId: 'scene_2',
          status: 'completed',
          attempt: 1,
          prompt: { id: 'classroom-quiz-actions', revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
          actions: [
            { id: expect.stringMatching(/^action_/), type: 'speech', text: '现在请独立完成小测，提交后我们再一起复盘。' },
          ],
        },
      ],
    });
    expect(actionCalls.get('从直角三角形出发')).toBe(1);
    expect(actionCalls.get('判断边长关系')).toBe(1);
  });

  it('generates an operable interactive scene and publishes it through the immutable Artifact interface', async () => {
    const cookie = cookies.get('user')!;
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie },
      payload: { requirements: '请生成一堂互动生成测试课，用模拟器探索勾股定理。' },
    });
    const outlineRun = await waitForRun(cookie, outline.json().generationRun.id, 'completed');

    const content = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie },
    });
    const contentRun = await waitForRun(cookie, content.json().generationRun.id, 'completed');
    expect(contentRun.json().generationRun.scenes).toEqual([
      expect.objectContaining({
        outlineId: 'scene_interactive',
        type: 'interactive',
        status: 'completed',
        prompt: { id: 'classroom-simulation-content', revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
        content: expect.objectContaining({
          type: 'interactive',
          url: '',
          widgetType: 'simulation',
          widgetConfig: expect.objectContaining({ type: 'simulation', concept: 'pythagorean_area' }),
          html: expect.stringContaining('id="angle-slider"'),
        }),
      }),
    ]);

    const actions = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`,
      headers: { cookie },
    });
    const actionsRun = await waitForRun(cookie, actions.json().generationRun.id, 'completed');
    expect(actionsRun.json().generationRun.scenes[0]).toMatchObject({
      status: 'completed',
      prompt: { id: 'classroom-interactive-actions', revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
      actions: [
        { id: expect.stringMatching(/^action_/), type: 'speech', text: expect.stringContaining('角度滑块') },
        { id: expect.stringMatching(/^action_/), type: 'widget_highlight', target: '#angle-slider' },
        { id: expect.stringMatching(/^action_/), type: 'widget_setState', state: { angle: 60 } },
        { id: expect.stringMatching(/^action_/), type: 'widget_annotation', target: '#result-display' },
        { id: expect.stringMatching(/^action_/), type: 'widget_reveal', target: '#formula' },
      ],
    });

    const media = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${actionsRun.json().generationRun.id}/media-tasks`,
      headers: { cookie },
      payload: { tts: { providerId: 'openai', voice: 'alloy' } },
    });
    const mediaRun = await waitForRun(cookie, media.json().generationRun.id, 'completed');
    const published = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${mediaRun.json().generationRun.id}/publish`,
      headers: { cookie },
    });
    expect(published.statusCode).toBe(201);

    const classroom = published.json().classroom;
    const artifact = await app.inject({
      method: 'GET',
      url: `/classrooms/${classroom.id}/artifacts/${classroom.latestArtifact.id}`,
      headers: { cookie },
    });
    expect(artifact.statusCode).toBe(200);
    expect(artifact.json().document.scenes).toEqual([
      expect.objectContaining({
        id: 'scene_interactive',
        type: 'interactive',
        content: expect.objectContaining({
          type: 'interactive',
          url: '',
          widgetType: 'simulation',
          html: expect.stringContaining('SET_WIDGET_STATE'),
        }),
        actions: expect.arrayContaining([
          expect.objectContaining({ type: 'widget_highlight', target: '#angle-slider' }),
          expect.objectContaining({ type: 'widget_setState', state: { angle: 60 } }),
        ]),
      }),
    ]);
  });

  it('generates content and actions for all five supported OpenMAIC interactive widget types', async () => {
    const cookie = cookies.get('admin')!;
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie },
      payload: { requirements: '请生成一堂互动类型契约测试课。' },
    });
    const outlineRun = await waitForRun(cookie, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie },
    });
    const contentRun = await waitForRun(cookie, content.json().generationRun.id, 'completed');
    const expected = [
      ['simulation', 'classroom-simulation-content'],
      ['diagram', 'classroom-diagram-content'],
      ['code', 'classroom-code-content'],
      ['game', 'classroom-game-content'],
      ['visualization3d', 'classroom-visualization3d-content'],
    ];
    expect(contentRun.json().generationRun.scenes).toEqual(expected.map(([widgetType, promptId], index) => (
      expect.objectContaining({
        outlineId: `scene_widget_${index + 1}`,
        type: 'interactive',
        status: 'completed',
        prompt: { id: promptId, revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
        content: expect.objectContaining({
          type: 'interactive',
          url: '',
          widgetType,
          widgetConfig: expect.objectContaining({ type: widgetType }),
        }),
      })
    )));

    const actions = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`,
      headers: { cookie },
    });
    const actionsRun = await waitForRun(cookie, actions.json().generationRun.id, 'completed');
    expect(actionsRun.json().generationRun.scenes).toHaveLength(5);
    for (const scene of actionsRun.json().generationRun.scenes) {
      expect(scene).toMatchObject({
        status: 'completed',
        prompt: { id: 'classroom-interactive-actions', revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
        actions: expect.arrayContaining([
          expect.objectContaining({ type: 'speech' }),
          expect.objectContaining({ type: 'widget_highlight' }),
          expect.objectContaining({ type: 'widget_setState' }),
        ]),
      });
    }
  });

  it('normalizes a legacy OpenMAIC interactiveConfig before generating content', async () => {
    const cookie = cookies.get('user')!;
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie },
      payload: { requirements: '请生成一堂旧版互动配置兼容测试课。' },
    });
    const outlineRun = await waitForRun(cookie, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie },
    });
    const contentRun = await waitForRun(cookie, content.json().generationRun.id, 'completed');
    expect(contentRun.json().generationRun.scenes).toEqual([
      expect.objectContaining({
        outlineId: 'scene_legacy_interactive',
        type: 'interactive',
        status: 'completed',
        prompt: { id: 'classroom-simulation-content', revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
        content: expect.objectContaining({
          type: 'interactive',
          widgetType: 'simulation',
          widgetConfig: expect.objectContaining({ type: 'simulation' }),
        }),
      }),
    ]);
  });

  it('persists an invalid interactive document failure and resumes that scene on retry', async () => {
    const cookie = cookies.get('admin')!;
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie },
      payload: { requirements: '请生成一堂互动生成可恢复测试课。' },
    });
    const outlineRun = await waitForRun(cookie, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie },
    });
    const failed = await waitForRun(cookie, content.json().generationRun.id, 'failed');
    expect(failed.json().generationRun).toMatchObject({
      progress: { total: 1, completed: 0, failed: 1 },
      scenes: [{
        outlineId: 'scene_interactive',
        status: 'failed',
        attempt: 1,
        content: null,
        error: { code: 'CLASSROOM_INTERACTIVE_CONTENT_CONFIG_MISSING' },
      }],
      error: { code: 'CLASSROOM_INTERACTIVE_CONTENT_CONFIG_MISSING' },
    });

    const retried = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${content.json().generationRun.id}/retry`,
      headers: { cookie },
    });
    expect(retried.statusCode).toBe(202);
    const completed = await waitForRun(cookie, content.json().generationRun.id, 'completed');
    expect(completed.json().generationRun.scenes).toEqual([
      expect.objectContaining({
        outlineId: 'scene_interactive',
        status: 'completed',
        attempt: 2,
        content: expect.objectContaining({ widgetType: 'simulation' }),
      }),
    ]);
  });

  it('reports a truncated interactive game and resumes the same Scene on retry', async () => {
    const cookie = cookies.get('admin')!;
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie },
      payload: { requirements: '请生成一堂互动截断恢复测试课。' },
    });
    const outlineRun = await waitForRun(cookie, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie },
    });
    const failed = await waitForRun(cookie, content.json().generationRun.id, 'failed');
    expect(failed.json().generationRun).toMatchObject({
      progress: { total: 1, completed: 0, failed: 1 },
      scenes: [{
        outlineId: 'scene_truncated_game',
        status: 'failed',
        attempt: 1,
        content: null,
        error: { code: 'CLASSROOM_INTERACTIVE_CONTENT_TRUNCATED' },
      }],
      error: { code: 'CLASSROOM_INTERACTIVE_CONTENT_TRUNCATED' },
    });

    const retried = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${content.json().generationRun.id}/retry`,
      headers: { cookie },
    });
    expect(retried.statusCode).toBe(202);
    const completed = await waitForRun(cookie, content.json().generationRun.id, 'completed');
    expect(completed.json().generationRun.scenes).toEqual([
      expect.objectContaining({
        outlineId: 'scene_truncated_game',
        status: 'completed',
        attempt: 2,
        content: expect.objectContaining({ widgetType: 'game' }),
      }),
    ]);
  });

  it('fails closed when interactive actions reference a selector absent from generated HTML', async () => {
    const cookie = cookies.get('user')!;
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie },
      payload: { requirements: '请生成一堂互动生成无效选择器测试课。' },
    });
    const outlineRun = await waitForRun(cookie, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie },
    });
    const contentRun = await waitForRun(cookie, content.json().generationRun.id, 'completed');
    const actions = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`,
      headers: { cookie },
    });
    const failed = await waitForRun(cookie, actions.json().generationRun.id, 'failed');
    expect(failed.json().generationRun).toMatchObject({
      progress: { total: 1, completed: 0, failed: 1 },
      scenes: [{
        outlineId: 'scene_interactive',
        status: 'failed',
        attempt: 1,
        actions: null,
        error: { code: 'CLASSROOM_SCENE_ACTIONS_INVALID' },
      }],
      error: { code: 'CLASSROOM_SCENE_ACTIONS_INVALID' },
    });
  });

  it('keeps completed actions and retries only unfinished scene actions', async () => {
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('admin') },
      payload: { requirements: '请生成一堂动作可恢复失败测试课。' },
    });
    const outlineRun = await waitForRun(cookies.get('admin')!, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie: cookies.get('admin') },
    });
    const contentRun = await waitForRun(cookies.get('admin')!, content.json().generationRun.id, 'completed');
    const started = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`,
      headers: { cookie: cookies.get('admin') },
    });
    const failed = await waitForRun(cookies.get('admin')!, started.json().generationRun.id, 'failed');
    expect(failed.json().generationRun).toMatchObject({
      stage: 'scene_actions',
      progress: { total: 2, completed: 1, failed: 1 },
      scenes: [
        { outlineId: 'scene_1', status: 'completed', attempt: 1, actions: expect.any(Array) },
        { outlineId: 'scene_2', status: 'failed', attempt: 1, actions: null },
      ],
      error: { code: 'CLASSROOM_SCENE_ACTIONS_GENERATION_FAILED' },
    });
    expect(JSON.stringify(failed.json())).not.toContain('Secret action provider failure');
    const slideCallsBeforeRetry = actionCalls.get('从直角三角形出发');

    const retried = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${started.json().generationRun.id}/retry`,
      headers: { cookie: cookies.get('admin') },
    });
    expect(retried.statusCode).toBe(202);
    expect(retried.json().generationRun).toMatchObject({ stage: 'scene_actions', attempt: 2 });
    expectAcceptedRunStatus(retried.json().generationRun.status);
    const completed = await waitForRun(cookies.get('admin')!, started.json().generationRun.id, 'completed');
    expect(completed.json().generationRun).toMatchObject({
      progress: { total: 2, completed: 2, failed: 0 },
      scenes: [
        { outlineId: 'scene_1', status: 'completed', attempt: 1 },
        { outlineId: 'scene_2', status: 'completed', attempt: 2 },
      ],
    });
    expect(actionCalls.get('从直角三角形出发')).toBe(slideCallsBeforeRetry);
  });

  it('fails closed when the action model does not return the structured JSON contract', async () => {
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: { requirements: '请生成一堂动作契约失败测试课。' },
    });
    const outlineRun = await waitForRun(cookies.get('user')!, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie: cookies.get('user') },
    });
    const contentRun = await waitForRun(cookies.get('user')!, content.json().generationRun.id, 'completed');
    const started = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`,
      headers: { cookie: cookies.get('user') },
    });

    const failed = await waitForRun(cookies.get('user')!, started.json().generationRun.id, 'failed');
    expect(failed.json().generationRun).toMatchObject({
      stage: 'scene_actions',
      progress: { total: 2, completed: 0, failed: 1 },
      scenes: [
        {
          outlineId: 'scene_1',
          status: 'failed',
          attempt: 1,
          actions: null,
          error: { code: 'CLASSROOM_SCENE_ACTIONS_INVALID' },
        },
        { outlineId: 'scene_2', status: 'pending', attempt: 0, actions: null },
      ],
      error: { code: 'CLASSROOM_SCENE_ACTIONS_INVALID' },
    });
  });

  it('fails closed when slide actions target an element absent from the generated canvas', async () => {
    const cookie = cookies.get('user')!;
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie },
      payload: { requirements: '请生成一堂动作目标失败测试课。' },
    });
    const outlineRun = await waitForRun(cookie, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie },
    });
    const contentRun = await waitForRun(cookie, content.json().generationRun.id, 'completed');
    const started = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`,
      headers: { cookie },
    });
    const failed = await waitForRun(cookie, started.json().generationRun.id, 'failed');

    expect(failed.json().generationRun).toMatchObject({
      stage: 'scene_actions',
      progress: { total: 2, completed: 0, failed: 1 },
      scenes: [{
        outlineId: 'scene_1',
        status: 'failed',
        actions: null,
        error: { code: 'CLASSROOM_SCENE_ACTIONS_INVALID' },
      }, {
        outlineId: 'scene_2',
        status: 'pending',
        actions: null,
      }],
      error: { code: 'CLASSROOM_SCENE_ACTIONS_INVALID' },
    });
  });

  it('persists owner-scoped TTS tasks and stores generated audio outside PostgreSQL', async () => {
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: { requirements: '请生成一堂媒体任务测试课。' },
    });
    const outlineRun = await waitForRun(cookies.get('user')!, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie: cookies.get('user') },
    });
    const contentRun = await waitForRun(cookies.get('user')!, content.json().generationRun.id, 'completed');
    const actions = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`,
      headers: { cookie: cookies.get('user') },
    });
    const actionsRun = await waitForRun(cookies.get('user')!, actions.json().generationRun.id, 'completed');
    const endpoint = `/classroom-generation-runs/${actionsRun.json().generationRun.id}/media-tasks`;
    const payload = { tts: { providerId: 'openai', voice: 'alloy', model: 'gpt-4o-mini-tts', format: 'mp3' } };

    expect((await app.inject({ method: 'POST', url: endpoint, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: endpoint, headers: { cookie: cookies.get('admin') }, payload })).statusCode).toBe(404);

    const started = await app.inject({
      method: 'POST',
      url: endpoint,
      headers: { cookie: cookies.get('user') },
      payload,
    });
    expect(started.statusCode).toBe(202);
    expect(started.json().generationRun).toMatchObject({
      stage: 'media_tasks',
      progress: { total: 2 },
      mediaTasks: [
        { kind: 'audio', sceneId: expect.any(String), actionId: expect.any(String) },
        { kind: 'audio', sceneId: expect.any(String), actionId: expect.any(String) },
      ],
    });
    expectAcceptedRunStatus(started.json().generationRun.status);

    const completed = await waitForRun(cookies.get('user')!, started.json().generationRun.id, 'completed');
    expect(completed.json().generationRun).toMatchObject({
      stage: 'media_tasks',
      status: 'completed',
      progress: { total: 2, completed: 2, failed: 0 },
      mediaTasks: [
        {
          kind: 'audio',
          status: 'completed',
          attempt: 1,
          providerId: 'openai',
          modelId: 'gpt-4o-mini-tts',
          contentType: 'audio/mpeg',
          mediaRef: expect.stringMatching(/^media\/generated\/.+\.mp3$/),
        },
        {
          kind: 'audio',
          status: 'completed',
          attempt: 1,
          providerId: 'openai',
          modelId: 'gpt-4o-mini-tts',
          contentType: 'audio/mpeg',
          mediaRef: expect.stringMatching(/^media\/generated\/.+\.mp3$/),
        },
      ],
      scenes: [
        { actions: expect.arrayContaining([expect.objectContaining({ type: 'speech', audioRef: expect.stringMatching(/^media\/generated\/.+\.mp3$/) })]) },
        { actions: expect.arrayContaining([expect.objectContaining({ type: 'speech', audioRef: expect.stringMatching(/^media\/generated\/.+\.mp3$/) })]) },
      ],
    });
    expect(storedMedia.size).toBeGreaterThanOrEqual(2);
    expect([...storedMedia.values()]).toEqual(expect.arrayContaining([
      { body: Buffer.from('fixture-audio:请看从直角三角形出发。'), contentType: 'audio/mpeg' },
      { body: Buffer.from('fixture-audio:现在请独立完成小测，提交后我们再一起复盘。'), contentType: 'audio/mpeg' },
    ]));
    expect(mediaCalls.get('请看从直角三角形出发。')).toBe(1);
    expect(mediaCalls.get('现在请独立完成小测，提交后我们再一起复盘。')).toBe(1);

    const foreignRead = await app.inject({
      method: 'GET',
      url: `/classroom-generation-runs/${started.json().generationRun.id}`,
      headers: { cookie: cookies.get('admin') },
    });
    expect(foreignRead.statusCode).toBe(404);
  });

  it('executes planned image requests and replaces scene placeholders with stable MinIO references', async () => {
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: {
        requirements: '请生成一堂图片媒体规划测试课。',
        media: { image: { providerId: 'openai', model: 'gpt-image-1', aspectRatio: '16:9' } },
      },
    });
    const outlineRun = await waitForRun(cookies.get('user')!, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie: cookies.get('user') },
    });
    const contentRun = await waitForRun(cookies.get('user')!, content.json().generationRun.id, 'completed');
    expect(contentRun.json().generationRun.scenes[0].content).toMatchObject({
      canvas: { elements: expect.arrayContaining([expect.objectContaining({ src: 'gen_img_1' })]) },
    });
    const actions = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`,
      headers: { cookie: cookies.get('user') },
    });
    const actionsRun = await waitForRun(cookies.get('user')!, actions.json().generationRun.id, 'completed');
    const media = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${actionsRun.json().generationRun.id}/media-tasks`,
      headers: { cookie: cookies.get('user') },
      payload: {},
    });
    expect(media.statusCode).toBe(202);
    expect(media.json().generationRun.mediaTasks).toEqual([
      expect.objectContaining({ kind: 'image', elementId: 'gen_img_1', status: 'pending' }),
    ]);

    const completed = await waitForRun(cookies.get('user')!, media.json().generationRun.id, 'completed');
    const imageTask = completed.json().generationRun.mediaTasks.find((task: { kind: string }) => task.kind === 'image');
    expect(imageTask).toMatchObject({
      kind: 'image',
      elementId: 'gen_img_1',
      status: 'completed',
      providerId: 'openai',
      modelId: 'gpt-image-1',
      contentType: 'image/png',
      mediaRef: expect.stringMatching(/^media\/generated\/.+\.png$/),
      url: expect.stringMatching(/^https:\/\/storage\.test\/classroom-drafts\//),
    });
    expect(completed.json().generationRun.scenes[0].content).toMatchObject({
      canvas: { elements: expect.arrayContaining([expect.objectContaining({ src: imageTask.mediaRef })]) },
    });
    const prompt = 'A clean geometric diagram of a right triangle with three squares, all labels in Chinese';
    expect(mediaCalls.get(prompt)).toBe(1);
    expect([...storedMedia.values()]).toContainEqual({
      body: Buffer.from(`fixture-image:${prompt}`),
      contentType: 'image/png',
    });
  });

  it('publishes a completed owned draft as one immutable classroom artifact and returns it idempotently', async () => {
    const cookie = cookies.get('user')!;
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie },
      payload: {
        requirements: '请生成一堂可发布的媒体规划测试课。',
        media: { image: { providerId: 'openai', model: 'gpt-image-1', aspectRatio: '16:9' } },
      },
    });
    const outlineRun = await waitForRun(cookie, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST', url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`, headers: { cookie },
    });
    const contentRun = await waitForRun(cookie, content.json().generationRun.id, 'completed');
    const actions = await app.inject({
      method: 'POST', url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`, headers: { cookie },
    });
    const actionsRun = await waitForRun(cookie, actions.json().generationRun.id, 'completed');
    const media = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${actionsRun.json().generationRun.id}/media-tasks`,
      headers: { cookie },
      payload: { tts: { providerId: 'openai', voice: 'alloy' } },
    });
    const mediaRun = await waitForRun(cookie, media.json().generationRun.id, 'completed');
    const endpoint = `/classroom-generation-runs/${mediaRun.json().generationRun.id}/publish`;

    expect((await app.inject({ method: 'POST', url: endpoint })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: endpoint, headers: { cookie: cookies.get('admin') } })).statusCode).toBe(404);

    const published = await app.inject({ method: 'POST', url: endpoint, headers: { cookie } });
    expect(published.statusCode).toBe(201);
    expect(published.json()).toMatchObject({
      created: true,
      classroom: {
        id: expect.any(String),
        title: '勾股定理入门',
        latestArtifact: { id: expect.any(String), version: 1, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      },
    });

    const classroom = published.json().classroom;
    const artifact = await app.inject({
      method: 'GET',
      url: `/classrooms/${classroom.id}/artifacts/${classroom.latestArtifact.id}`,
      headers: { cookie },
    });
    expect(artifact.statusCode).toBe(200);
    expect(artifact.json().document).toMatchObject({
      stage: { name: '勾股定理入门' },
      scenes: [
        {
          id: 'scene_1', stageId: expect.any(String), type: 'slide', title: '从直角三角形出发', order: 1,
          content: {
            type: 'slide',
            canvas: { elements: expect.arrayContaining([expect.objectContaining({
              id: 'planned-image',
              mediaRef: expect.stringMatching(/^media\/generated\/.+\.png$/),
              src: expect.stringMatching(/^https:\/\/storage\.test\/classrooms\/.+\/artifacts\/.+\/media\/generated\/.+\.png$/),
            })]) },
          },
          actions: expect.arrayContaining([expect.objectContaining({ type: 'speech', audioRef: expect.stringMatching(/^media\/generated\/.+\.mp3$/) })]),
        },
        { id: 'scene_2', type: 'quiz', title: '判断边长关系', order: 2 },
      ],
    });
    const artifactPrefix = `classrooms/${userIds[0]}/${classroom.id}/artifacts/${classroom.latestArtifact.id}/media/generated/`;
    expect([...storedMedia.keys()].filter((key) => key.startsWith(artifactPrefix))).toHaveLength(3);

    const repeated = await app.inject({ method: 'POST', url: endpoint, headers: { cookie } });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toEqual({ created: false, classroom });
    expect([...storedMedia.keys()].filter((key) => key.startsWith(artifactPrefix))).toHaveLength(3);
  });

  it('removes copied artifact media after promotion failure and lets the same draft publish on retry', async () => {
    const cookie = cookies.get('admin')!;
    const outline = await app.inject({
      method: 'POST', url: '/classroom-generation-runs', headers: { cookie },
      payload: { requirements: '请生成一堂媒体提升失败后可重试的课堂。' },
    });
    const outlineRun = await waitForRun(cookie, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST', url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`, headers: { cookie },
    });
    const contentRun = await waitForRun(cookie, content.json().generationRun.id, 'completed');
    const actions = await app.inject({
      method: 'POST', url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`, headers: { cookie },
    });
    const actionsRun = await waitForRun(cookie, actions.json().generationRun.id, 'completed');
    const earlyPublish = await app.inject({
      method: 'POST', url: `/classroom-generation-runs/${actionsRun.json().generationRun.id}/publish`, headers: { cookie },
    });
    expect(earlyPublish.statusCode).toBe(409);
    expect(earlyPublish.json()).toMatchObject({ code: 'CLASSROOM_DRAFT_NOT_READY' });

    const media = await app.inject({
      method: 'POST',
      url: `/classroom-generation-runs/${actionsRun.json().generationRun.id}/media-tasks`,
      headers: { cookie },
      payload: { tts: { providerId: 'openai', voice: 'alloy' } },
    });
    const mediaRun = await waitForRun(cookie, media.json().generationRun.id, 'completed');
    const endpoint = `/classroom-generation-runs/${mediaRun.json().generationRun.id}/publish`;
    const artifactObjectsBefore = [...storedMedia.keys()].filter((key) => key.startsWith(`classrooms/${userIds[1]}/`));

    promotionCopyAttempts = 0;
    failPromotionCopyAt = 2;
    const failed = await app.inject({ method: 'POST', url: endpoint, headers: { cookie } });
    failPromotionCopyAt = null;
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toMatchObject({ code: 'CLASSROOM_MEDIA_PROMOTION_FAILED' });
    expect([...storedMedia.keys()].filter((key) => key.startsWith(`classrooms/${userIds[1]}/`))).toEqual(artifactObjectsBefore);

    promotionCopyAttempts = 0;
    const retried = await app.inject({ method: 'POST', url: endpoint, headers: { cookie } });
    expect(retried.statusCode).toBe(201);
    expect(retried.json()).toMatchObject({ created: true, classroom: { title: '勾股定理入门' } });
  });

  it('resumes asynchronous video polling from the persisted provider task without submitting twice', async () => {
    const outline = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('admin') },
      payload: {
        requirements: '请生成一堂视频媒体规划测试课。',
        media: {
          video: { providerId: 'kling', model: 'kling-v2-1', aspectRatio: '16:9', durationSeconds: 5, resolution: '720p' },
        },
      },
    });
    const outlineRun = await waitForRun(cookies.get('admin')!, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST', url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie: cookies.get('admin') },
    });
    const contentRun = await waitForRun(cookies.get('admin')!, content.json().generationRun.id, 'completed');
    expect(contentRun.json().generationRun.scenes[0].content).toMatchObject({
      canvas: { elements: expect.arrayContaining([expect.objectContaining({ mediaRef: 'gen_vid_1' })]) },
    });
    const actions = await app.inject({
      method: 'POST', url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`,
      headers: { cookie: cookies.get('admin') },
    });
    const actionsRun = await waitForRun(cookies.get('admin')!, actions.json().generationRun.id, 'completed');
    const media = await app.inject({
      method: 'POST', url: `/classroom-generation-runs/${actionsRun.json().generationRun.id}/media-tasks`,
      headers: { cookie: cookies.get('admin') },
      payload: { tts: { providerId: 'openai', voice: 'alloy' } },
    });
    const failed = await waitForRun(cookies.get('admin')!, media.json().generationRun.id, 'failed');
    const failedVideo = failed.json().generationRun.mediaTasks.find((task: { kind: string }) => task.kind === 'video');
    expect(failedVideo).toMatchObject({
      elementId: 'gen_vid_1',
      status: 'failed',
      attempt: 1,
      providerId: 'kling',
      modelId: 'kling-v2-1',
      providerTaskId: 'fixture-video-task-1',
      mediaRef: null,
      error: { code: 'CLASSROOM_MEDIA_GENERATION_FAILED' },
    });
    expect(JSON.stringify(failed.json())).not.toContain('Secret asynchronous video poll failure');

    const retried = await app.inject({
      method: 'POST', url: `/classroom-generation-runs/${media.json().generationRun.id}/retry`,
      headers: { cookie: cookies.get('admin') },
    });
    expect(retried.statusCode).toBe(202);
    const completed = await waitForRun(cookies.get('admin')!, media.json().generationRun.id, 'completed');
    const completedVideo = completed.json().generationRun.mediaTasks.find((task: { kind: string }) => task.kind === 'video');
    expect(completedVideo).toMatchObject({
      status: 'completed',
      attempt: 2,
      providerTaskId: 'fixture-video-task-1',
      mediaRef: expect.stringMatching(/^media\/generated\/.+\.mp4$/),
      contentType: 'video/mp4',
    });
    expect(completed.json().generationRun.scenes[0].content).toMatchObject({
      canvas: { elements: expect.arrayContaining([expect.objectContaining({ mediaRef: completedVideo.mediaRef })]) },
    });
    const prompt = 'An animation rearranging the two smaller squares into the largest square';
    expect(videoSubmitCalls.get(prompt)).toBe(1);
    expect(recoverableVideoPollAttempts).toBe(2);
  });

  it('retries only unfinished media tasks without exposing provider failures', async () => {
    const outline = await app.inject({
      method: 'POST', url: '/classroom-generation-runs', headers: { cookie: cookies.get('admin') },
      payload: { requirements: '请生成一堂媒体可恢复失败测试课。' },
    });
    const outlineRun = await waitForRun(cookies.get('admin')!, outline.json().generationRun.id, 'completed');
    const content = await app.inject({
      method: 'POST', url: `/classroom-generation-runs/${outlineRun.json().generationRun.id}/scene-content`,
      headers: { cookie: cookies.get('admin') },
    });
    const contentRun = await waitForRun(cookies.get('admin')!, content.json().generationRun.id, 'completed');
    const actions = await app.inject({
      method: 'POST', url: `/classroom-generation-runs/${contentRun.json().generationRun.id}/scene-actions`,
      headers: { cookie: cookies.get('admin') },
    });
    const actionsRun = await waitForRun(cookies.get('admin')!, actions.json().generationRun.id, 'completed');
    const media = await app.inject({
      method: 'POST', url: `/classroom-generation-runs/${actionsRun.json().generationRun.id}/media-tasks`,
      headers: { cookie: cookies.get('admin') },
      payload: { tts: { providerId: 'openai', voice: 'alloy' } },
    });
    const failed = await waitForRun(cookies.get('admin')!, media.json().generationRun.id, 'failed');
    expect(failed.json().generationRun).toMatchObject({
      stage: 'media_tasks',
      progress: { total: 2, completed: 1, failed: 1 },
      mediaTasks: [
        { status: 'completed', attempt: 1, mediaRef: expect.any(String) },
        { status: 'failed', attempt: 1, mediaRef: null, error: { code: 'CLASSROOM_MEDIA_GENERATION_FAILED' } },
      ],
      error: { code: 'CLASSROOM_MEDIA_GENERATION_FAILED' },
    });
    expect(JSON.stringify(failed.json())).not.toContain('Secret media provider failure');
    const completedSpeech = '请看从直角三角形出发。';
    const completedCallsBeforeRetry = mediaCalls.get(completedSpeech);

    const retried = await app.inject({
      method: 'POST', url: `/classroom-generation-runs/${media.json().generationRun.id}/retry`,
      headers: { cookie: cookies.get('admin') },
    });
    expect(retried.statusCode).toBe(202);
    expect(retried.json().generationRun).toMatchObject({ stage: 'media_tasks', attempt: 2 });
    expectAcceptedRunStatus(retried.json().generationRun.status);
    const completed = await waitForRun(cookies.get('admin')!, media.json().generationRun.id, 'completed');
    expect(completed.json().generationRun).toMatchObject({
      progress: { total: 2, completed: 2, failed: 0 },
      mediaTasks: [
        { status: 'completed', attempt: 1 },
        { status: 'completed', attempt: 2, error: null },
      ],
    });
    expect(mediaCalls.get(completedSpeech)).toBe(completedCallsBeforeRetry);
    expect(mediaCalls.get('这条媒体语音会先失败再恢复。')).toBe(2);
  });

  it('releases in-flight work on shutdown so a new app instance resumes the persisted run', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/classroom-generation-runs',
      headers: { cookie: cookies.get('user') },
      payload: { requirements: '请生成一堂应用重启恢复测试课。' },
    });
    const runId = created.json().generationRun.id as string;
    await waitForRun(cookies.get('user')!, runId, 'running');

    await app.close();
    app = await buildTestApi();

    const completed = await waitForRun(cookies.get('user')!, runId, 'completed');
    expect(completed.json().generationRun).toMatchObject({
      id: runId,
      status: 'completed',
      attempt: 1,
      outline: { courseTitle: '勾股定理入门' },
    });
    expect(restartAttempts).toBe(2);
  });
});
