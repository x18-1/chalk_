import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type SceneType = 'slide' | 'quiz' | 'interactive';

type Scenario = {
  id: string;
  tags: string[];
  requirements: string;
  media?: {
    image?: { providerId: string; model?: string; aspectRatio?: string };
    video?: { providerId: string; model?: string; aspectRatio?: string; durationSeconds?: number; resolution?: string };
  };
  expect: {
    minScenes: number;
    maxScenes: number;
    requiredTypes: SceneType[];
  };
  discussion?: {
    message: string;
    expectTeacherFirst: boolean;
    maxAgentMessages: number;
  };
};

type GeneratedScene = {
  id: string;
  outlineId: string;
  type: SceneType;
  order: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  phase: string;
  attempt: number;
  model: { providerId: string; modelId: string } | null;
  error: { code: string } | null;
};

type GenerationRun = {
  id: string;
  draftId: string;
  classroomId: string | null;
  stage: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted';
  candidateVersion: string | null;
  outline: {
    languageDirective: string;
    courseTitle: string;
    outlines: Array<{ id: string; type: SceneType; title: string; order: number }>;
  } | null;
  context: {
    agentProfiles?: Array<{ id: string; name: string; role: 'teacher' | 'assistant' | 'student' }>;
  };
  scenes: GeneratedScene[];
  mediaTasks: Array<{
    id: string;
    kind: 'audio' | 'image' | 'video';
    status: string;
    providerId: string | null;
    modelId: string | null;
    url: string | null;
    contentType: string | null;
    error: { code: string } | null;
  }>;
  previewReady: boolean;
  publishReady: boolean;
  error: { code: string } | null;
};

type Check = {
  name: string;
  passed: boolean;
  detail: string;
};

type ScenarioResult = {
  scenarioId: string;
  runId?: string;
  classroomId?: string | null;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  outlineEvents: string[];
  checks: Check[];
  providers: Array<{ phase: string; providerId: string; modelId: string }>;
  discussionTranscript?: Array<{ sender: string; agentName: string | null; agentRole: string | null; content: string }>;
  error?: { phase: string; code?: string; message: string };
};

class EvalHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

class EvalClient {
  private cookie = '';

  constructor(private readonly baseUrl: string) {}

  async login(email: string, password: string) {
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    await this.expectOk(response);
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) throw new Error('Login succeeded without a session cookie');
    this.cookie = setCookie.split(';', 1)[0] ?? '';
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(this.url(path), {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Cookie: this.cookie,
        ...init.headers,
      },
    });
    await this.expectOk(response);
    return response.json() as Promise<T>;
  }

  async stream(path: string, init: RequestInit, onEvent: (type: string, data: unknown) => void) {
    const response = await fetch(this.url(path), {
      ...init,
      headers: {
        Accept: 'text/event-stream',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Cookie: this.cookie,
        ...init.headers,
      },
    });
    await this.expectOk(response);
    if (!response.body) throw new Error('SSE response did not include a body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) consumeSseFrame(frame, onEvent);
      if (done) break;
    }
    if (buffer.trim()) consumeSseFrame(buffer, onEvent);
  }

  async verifyMedia(path: string) {
    const url = this.url(path);
    const sameOrigin = new URL(url).origin === new URL(this.baseUrl).origin;
    const response = await fetch(url, {
      headers: sameOrigin ? { Cookie: this.cookie } : {},
      signal: AbortSignal.timeout(30_000),
    });
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      size: Number(response.headers.get('content-length') ?? 0),
    };
  }

  private url(path: string) {
    if (/^https?:\/\//.test(path)) return path;
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private async expectOk(response: Response) {
    if (response.ok) return;
    const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
    throw new EvalHttpError(response.status, body.code, body.error ?? `HTTP ${response.status}`);
  }
}

function consumeSseFrame(frame: string, onEvent: (type: string, data: unknown) => void) {
  const event = frame.match(/^event: ([^\n]+)$/m)?.[1];
  const data = frame.match(/^data: (.+)$/m)?.[1];
  if (!data) return;
  const parsed = JSON.parse(data) as { type?: string };
  onEvent(event ?? parsed.type ?? 'message', parsed);
}

function parseArgs() {
  const raw = process.argv.slice(2);
  const scenarioArgument = raw.find((argument) => argument.startsWith('--scenario='));
  const known = new Set(['--', '--dry-run', '--include-media', '--publish']);
  const unknown = raw.filter((argument) => !known.has(argument) && !argument.startsWith('--scenario='));
  if (unknown.length > 0) throw new Error(`Unknown eval argument(s): ${unknown.join(', ')}`);
  return {
    dryRun: raw.includes('--dry-run'),
    includeMedia: raw.includes('--include-media'),
    publish: raw.includes('--publish'),
    scenarioId: scenarioArgument?.slice('--scenario='.length) || undefined,
  };
}

async function waitForRun(
  client: EvalClient,
  runId: string,
  predicate: (run: GenerationRun) => boolean,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  let latest: GenerationRun | null = null;
  while (Date.now() < deadline) {
    latest = (await client.json<{ generationRun: GenerationRun }>(`/classroom-generation-runs/${runId}`)).generationRun;
    if (predicate(latest)) return latest;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  throw new Error(`Timed out waiting for Generation Run ${runId}; last status=${latest?.status ?? 'unknown'} stage=${latest?.stage ?? 'unknown'}`);
}

function recordCheck(checks: Check[], name: string, passed: boolean, detail: string) {
  checks.push({ name, passed, detail });
}

async function evaluateDiscussion(
  client: EvalClient,
  scenario: Scenario,
  run: GenerationRun,
  checks: Check[],
) {
  if (!scenario.discussion) return undefined;
  const firstScene = run.scenes
    .filter((scene) => scene.status === 'completed')
    .sort((left, right) => left.order - right.order)[0];
  if (!firstScene) throw new Error('Discussion eval requires one completed Scene');
  const created = await client.json<{ discussion: { id: string } }>('/classroom-discussions', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'generation_run',
      id: run.id,
      sceneId: firstScene.outlineId,
      topic: firstScene.type === 'interactive' ? '互动场景追问' : '当前场景追问',
      entryCursor: {
        version: 1,
        stageId: run.draftId,
        sceneId: firstScene.outlineId,
        sceneIndex: Math.max(0, firstScene.order - 1),
        actionIndex: 0,
        mode: 'paused',
        completed: false,
      },
    }),
  });
  const eventTypes: string[] = [];
  await client.stream(`/classroom-discussions/${created.discussion.id}/rounds/stream`, {
    method: 'POST',
    body: JSON.stringify({ message: scenario.discussion.message }),
  }, (type) => eventTypes.push(type));
  const restored = await client.json<{
    discussion: {
      messages: Array<{
        sender: string;
        agentName: string | null;
        agentRole: string | null;
        content: string;
      }>;
    };
  }>(`/classroom-discussions/${created.discussion.id}`);
  const agents = restored.discussion.messages.filter((message) => message.sender === 'agent');
  recordCheck(checks, 'discussion emits a completed round', eventTypes.includes('round_completed'), eventTypes.join(' -> '));
  recordCheck(
    checks,
    'discussion agent count is bounded',
    agents.length > 0 && agents.length <= scenario.discussion.maxAgentMessages,
    `${agents.length}/${scenario.discussion.maxAgentMessages} Agent messages`,
  );
  recordCheck(
    checks,
    'teacher answers first',
    !scenario.discussion.expectTeacherFirst || agents[0]?.agentRole === 'teacher',
    agents[0] ? `${agents[0].agentName ?? 'unnamed'} (${agents[0].agentRole ?? 'unknown'})` : 'no Agent message',
  );
  recordCheck(
    checks,
    'Agent messages are non-empty and identified',
    agents.every((message) => Boolean(message.content.trim() && message.agentName && message.agentRole)),
    agents.map((message) => `${message.agentName ?? 'unnamed'}:${message.content.length}`).join(', '),
  );
  const completed = await client.json<{
    entryCursor: { stageId: string; sceneId: string };
  }>(`/classroom-discussions/${created.discussion.id}/complete`, { method: 'POST' });
  recordCheck(
    checks,
    'discussion restores its Draft classroom cursor',
    completed.entryCursor.stageId === run.draftId && completed.entryCursor.sceneId === firstScene.outlineId,
    `stage=${completed.entryCursor.stageId}; scene=${completed.entryCursor.sceneId}`,
  );
  return restored.discussion.messages;
}

async function runScenario(client: EvalClient, scenario: Scenario, publish: boolean): Promise<ScenarioResult> {
  const startedAt = Date.now();
  const checks: Check[] = [];
  const outlineEvents: string[] = [];
  const providers: ScenarioResult['providers'] = [];
  let runId: string | undefined;
  let phase = 'create';
  try {
    const created = await client.json<{ generationRun: GenerationRun }>('/classroom-generation-runs', {
      method: 'POST',
      body: JSON.stringify({
        requirements: scenario.requirements,
        ...(scenario.media ? { media: scenario.media } : {}),
      }),
    });
    runId = created.generationRun.id;
    phase = 'outline-stream';
    await client.stream(`/classroom-generation-runs/${runId}/outline-events`, { method: 'GET' }, (type) => {
      outlineEvents.push(type);
    });
    const outlined = await waitForRun(
      client,
      runId,
      (run) => Boolean(run.outline && run.candidateVersion) || run.status === 'failed',
      5 * 60_000,
    );
    if (!outlined.outline || !outlined.candidateVersion) {
      throw new EvalHttpError(422, outlined.error?.code, 'Outline did not produce a confirmable Candidate');
    }
    const types = new Set(outlined.outline.outlines.map((outline) => outline.type));
    recordCheck(
      checks,
      'outline Scene count is in range',
      outlined.outline.outlines.length >= scenario.expect.minScenes && outlined.outline.outlines.length <= scenario.expect.maxScenes,
      `${outlined.outline.outlines.length} Scenes; expected ${scenario.expect.minScenes}-${scenario.expect.maxScenes}`,
    );
    for (const requiredType of scenario.expect.requiredTypes) {
      recordCheck(checks, `outline contains ${requiredType}`, types.has(requiredType), [...types].join(', '));
    }
    recordCheck(
      checks,
      'outline SSE reaches done without raw partial objects',
      outlineEvents.includes('done') && outlineEvents.every((type) => ['languageDirective', 'courseTitle', 'outline', 'retry', 'done', 'error'].includes(type)),
      outlineEvents.join(' -> '),
    );

    phase = 'confirm-outline';
    await client.json(`/classroom-generation-runs/${runId}/outline-revisions`, {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: randomUUID(),
        candidateVersion: outlined.candidateVersion,
        outline: outlined.outline,
      }),
    });
    phase = 'progressive-generation';
    const preview = await waitForRun(
      client,
      runId,
      (run) => run.previewReady || run.status === 'failed',
      10 * 60_000,
    );
    if (!preview.previewReady) {
      throw new EvalHttpError(422, preview.error?.code, 'Scene 1 did not become preview-ready');
    }
    const transcript = await evaluateDiscussion(client, scenario, preview, checks);
    const completed = await waitForRun(
      client,
      runId,
      (run) => ['completed', 'failed', 'aborted'].includes(run.status),
      20 * 60_000,
    );
    for (const scene of completed.scenes) {
      if (scene.model) providers.push({ phase: `scene-${scene.order}`, ...scene.model });
    }
    recordCheck(
      checks,
      'all generated Scenes completed',
      completed.status === 'completed' && completed.scenes.every((scene) => scene.status === 'completed' && scene.phase === 'completed'),
      `run=${completed.status}; scenes=${completed.scenes.map((scene) => `${scene.order}:${scene.status}/${scene.phase}`).join(', ')}`,
    );
    const profiles = completed.context.agentProfiles ?? [];
    recordCheck(
      checks,
      'Agent Profiles satisfy classroom roles',
      profiles.length >= 3 && profiles.length <= 5 && profiles.filter((profile) => profile.role === 'teacher').length === 1,
      `${profiles.length} profiles; teachers=${profiles.filter((profile) => profile.role === 'teacher').length}`,
    );
    const interactiveScenes = completed.scenes.filter((scene) => scene.type === 'interactive');
    if (scenario.expect.requiredTypes.includes('interactive')) {
      recordCheck(
        checks,
        'Interactive Scenes pass strict generation contract',
        interactiveScenes.length > 0 && interactiveScenes.every((scene) => scene.status === 'completed'),
        interactiveScenes.map((scene) => `${scene.order}:${scene.status}${scene.error ? `/${scene.error.code}` : ''}`).join(', '),
      );
    }
    for (const task of completed.mediaTasks.filter((candidate) => candidate.kind === 'image' || candidate.kind === 'video')) {
      if (task.providerId && task.modelId) providers.push({ phase: `media-${task.kind}`, providerId: task.providerId, modelId: task.modelId });
      const response = task.url ? await client.verifyMedia(task.url) : null;
      recordCheck(
        checks,
        `${task.kind} media is fetchable`,
        task.status === 'completed' && Boolean(response?.ok && response.contentType.startsWith(`${task.kind}/`)),
        `task=${task.status}; HTTP=${response?.status ?? 'n/a'}; content-type=${response?.contentType ?? 'n/a'}`,
      );
    }
    if (publish) {
      phase = 'publish';
      await client.json(`/classroom-generation-runs/${runId}/publish`, { method: 'POST' });
    }
    return {
      scenarioId: scenario.id,
      runId,
      classroomId: completed.classroomId,
      status: checks.every((check) => check.passed) ? 'passed' : 'failed',
      durationMs: Date.now() - startedAt,
      outlineEvents,
      checks,
      providers,
      ...(transcript ? { discussionTranscript: transcript } : {}),
    };
  } catch (error) {
    return {
      scenarioId: scenario.id,
      ...(runId ? { runId } : {}),
      status: 'failed',
      durationMs: Date.now() - startedAt,
      outlineEvents,
      checks,
      providers,
      error: {
        phase,
        ...(error instanceof EvalHttpError && error.code ? { code: error.code } : {}),
        message: error instanceof Error ? error.message : 'Unknown eval failure',
      },
    };
  }
}

function reportMarkdown(results: ScenarioResult[], metadata: { startedAt: string; baseUrl: string }) {
  const lines = [
    '# Chalkboard V3 Eval Report',
    '',
    `- Started: ${metadata.startedAt}`,
    `- API: ${metadata.baseUrl}`,
    `- Passed: ${results.filter((result) => result.status === 'passed').length}/${results.length}`,
    '',
  ];
  for (const result of results) {
    lines.push(`## ${result.scenarioId}`, '');
    lines.push(`- Status: **${result.status}**`);
    lines.push(`- Duration: ${(result.durationMs / 1_000).toFixed(1)}s`);
    if (result.runId) lines.push(`- Generation Run: \`${result.runId}\``);
    if (result.error) lines.push(`- Error: \`${result.error.phase}${result.error.code ? `/${result.error.code}` : ''}\` ${result.error.message}`);
    lines.push('', '| Check | Result | Detail |', '|---|---|---|');
    for (const check of result.checks) {
      lines.push(`| ${check.name} | ${check.passed ? 'PASS' : 'FAIL'} | ${check.detail.replaceAll('|', '\\|')} |`);
    }
    if (result.discussionTranscript) {
      lines.push('', '### Synthetic Discussion Transcript', '');
      for (const message of result.discussionTranscript) {
        lines.push(`- **${message.agentName ?? message.sender}** (${message.agentRole ?? message.sender}): ${message.content}`);
      }
      lines.push('', '> Apply `rubric.md` manually before release approval.');
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs();
  const suiteDir = dirname(fileURLToPath(import.meta.url));
  const scenarios = JSON.parse(await readFile(resolve(suiteDir, 'scenarios/generation.json'), 'utf8')) as Scenario[];
  validateScenarios(scenarios);
  const selected = scenarios.filter((scenario) =>
    (args.includeMedia || !scenario.tags.includes('media'))
    && (!args.scenarioId || scenario.id === args.scenarioId));
  if (selected.length === 0) {
    throw new Error(`No eval scenario matched${args.scenarioId ? ` --scenario=${args.scenarioId}` : ''}`);
  }
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify({ valid: true, scenarios: selected.map((scenario) => scenario.id) }, null, 2)}\n`);
    return;
  }
  const baseUrl = (process.env.CHALK_EVAL_API_URL ?? '').replace(/\/$/, '');
  const email = process.env.CHALK_EVAL_EMAIL;
  const password = process.env.CHALK_EVAL_PASSWORD;
  if (!baseUrl || !email || !password) {
    throw new Error('CHALK_EVAL_API_URL, CHALK_EVAL_EMAIL and CHALK_EVAL_PASSWORD are required');
  }
  const client = new EvalClient(baseUrl);
  await client.login(email, password);
  const startedAt = new Date().toISOString();
  const results: ScenarioResult[] = [];
  for (const scenario of selected) {
    process.stdout.write(`Running ${scenario.id}...\n`);
    results.push(await runScenario(client, scenario, args.publish));
  }
  const stamp = startedAt.replaceAll(':', '-').replaceAll('.', '-');
  const outputDir = resolve(suiteDir, `../runs/chalkboard-v3/${stamp}`);
  await mkdir(outputDir, { recursive: true });
  const metadata = {
    startedAt,
    baseUrl,
    publish: args.publish,
    includeMedia: args.includeMedia,
    scenarioId: args.scenarioId ?? null,
  };
  await writeFile(resolve(outputDir, 'result.json'), `${JSON.stringify({ metadata, results }, null, 2)}\n`, 'utf8');
  await writeFile(resolve(outputDir, 'report.md'), reportMarkdown(results, metadata), 'utf8');
  process.stdout.write(`Report: ${outputDir}/report.md\n`);
  if (results.some((result) => result.status !== 'passed')) process.exitCode = 1;
}

function validateScenarios(scenarios: Scenario[]) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) throw new Error('Eval scenarios must be a non-empty array');
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (!scenario || typeof scenario !== 'object') throw new Error('Every eval scenario must be an object');
    if (!scenario.id?.trim() || ids.has(scenario.id)) throw new Error(`Eval scenario id is missing or duplicated: ${scenario.id ?? 'missing'}`);
    ids.add(scenario.id);
    if (!scenario.requirements?.trim()) throw new Error(`Eval scenario ${scenario.id} has no requirements`);
    if (!Array.isArray(scenario.tags)) throw new Error(`Eval scenario ${scenario.id} must define tags`);
    if (!Number.isInteger(scenario.expect?.minScenes)
      || !Number.isInteger(scenario.expect?.maxScenes)
      || scenario.expect.minScenes < 1
      || scenario.expect.maxScenes < scenario.expect.minScenes) {
      throw new Error(`Eval scenario ${scenario.id} has an invalid Scene range`);
    }
    if (!Array.isArray(scenario.expect.requiredTypes)
      || scenario.expect.requiredTypes.some((type) => !['slide', 'quiz', 'interactive'].includes(type))) {
      throw new Error(`Eval scenario ${scenario.id} has invalid required Scene types`);
    }
    if (scenario.discussion
      && (!scenario.discussion.message.trim()
        || scenario.discussion.maxAgentMessages < 1
        || scenario.discussion.maxAgentMessages > 3)) {
      throw new Error(`Eval scenario ${scenario.id} has an invalid Discussion contract`);
    }
  }
}

await main();
