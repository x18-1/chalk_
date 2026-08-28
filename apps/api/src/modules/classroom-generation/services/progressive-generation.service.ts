import { classroomOutlineSchema } from '../schemas';
import type {
  ClassroomGenerationDal,
  GenerationClaimContext,
} from './classroom-generation.types';
import { normalizeInteractiveOutlines } from './interactive-outline';
import { MediaTasksGenerationService } from './media-tasks-generation.service';
import { SceneActionsGenerationService } from './scene-actions-generation.service';
import { SceneContentGenerationService } from './scene-content-generation.service';
import { AgentProfilesGenerationService } from './agent-profiles-generation.service';

export class ProgressiveGenerationService {
  constructor(
    private readonly generation: ClassroomGenerationDal,
    private readonly content: SceneContentGenerationService,
    private readonly actions: SceneActionsGenerationService,
    private readonly media: MediaTasksGenerationService,
    private readonly agentProfiles: AgentProfilesGenerationService,
  ) {}

  async processClaim(context: GenerationClaimContext) {
    const course = normalizeInteractiveOutlines(classroomOutlineSchema.parse(context.draft.outline));
    const profileContext = await this.ensureAgentProfiles(context, course);
    let scenes = await this.generation.listScenes(profileContext.userId, profileContext.draft.id);
    const first = scenes[0];
    if (!first) throw new Error('Progressive generation requires at least one Scene');

    await this.processScene(profileContext, course, first, []);
    await this.generation.markProgressivePreviewReady(profileContext.userId, {
      runId: profileContext.runId,
      draftId: profileContext.draft.id,
      sceneId: first.id,
      workerId: profileContext.workerId,
    });

    let sceneFailure: unknown;
    const sceneLane = (async () => {
      try {
        scenes = await this.generation.listScenes(profileContext.userId, profileContext.draft.id);
        const previousSpeeches = speechTexts(scenes[0]?.actions);
        for (const scene of scenes.slice(1)) {
          await this.processScene(profileContext, course, scene, previousSpeeches);
          const refreshed = (await this.generation.listScenes(profileContext.userId, profileContext.draft.id))
            .find((candidate) => candidate.id === scene.id);
          previousSpeeches.push(...speechTexts(refreshed?.actions));
        }
      } catch (error) {
        sceneFailure = error;
        throw error;
      }
    })();
    const mediaLane = this.media.processTasks(profileContext, {
      waitUntilSceneContentReady: async (sceneId) => {
        while (true) {
          profileContext.signal.throwIfAborted();
          if (sceneFailure) throw sceneFailure;
          const current = (await this.generation.listScenes(profileContext.userId, profileContext.draft.id))
            .find((scene) => scene.id === sceneId);
          if (current?.status === 'completed') return;
          await delay(25, profileContext.signal);
        }
      },
    });
    const [scenesResult, mediaResult] = await Promise.allSettled([sceneLane, mediaLane]);
    if (scenesResult.status === 'rejected') throw scenesResult.reason;
    if (mediaResult.status === 'rejected') throw mediaResult.reason;

    return this.generation.completeProgressiveRun(profileContext.userId, {
      runId: profileContext.runId,
      draftId: profileContext.draft.id,
      workerId: profileContext.workerId,
    });
  }

  private async ensureAgentProfiles(
    context: GenerationClaimContext,
    course: ReturnType<typeof normalizeInteractiveOutlines>,
  ): Promise<GenerationClaimContext> {
    const draftContext = asDraftContext(context.draft.context);
    if (draftContext.agentProfiles?.length) return context;
    const generated = await this.agentProfiles.generate(
      context.userId,
      course,
      context.draft.requirements,
      context.signal,
    );
    const nextContext = {
      ...draftContext,
      agentProfiles: generated.agentProfiles,
      agentProfileGeneration: generated.metadata,
    };
    const draft = await this.generation.updateDraftContextForClaim(context.userId, {
      runId: context.runId,
      draftId: context.draft.id,
      workerId: context.workerId,
      context: nextContext,
    });
    if (!draft) throw new Error('Progressive generation lease was lost while saving Agent profiles');
    return { ...context, draft };
  }

  private async processScene(
    context: GenerationClaimContext,
    course: ReturnType<typeof normalizeInteractiveOutlines>,
    scene: Awaited<ReturnType<ClassroomGenerationDal['listScenes']>>[number],
    previousSpeeches: string[],
  ) {
    if (scene.actionStatus === 'completed') return;
    if (scene.status !== 'completed') await this.content.processScene(context, course, scene);
    const refreshed = (await this.generation.listScenes(context.userId, context.draft.id))
      .find((candidate) => candidate.id === scene.id);
    if (!refreshed) throw new Error('Progressive Scene disappeared during generation');
    await this.actions.processScene(context, course, refreshed, previousSpeeches);
  }
}

function asDraftContext(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> & { agentProfiles?: unknown[] }
    : {};
}

function speechTexts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((action): string[] => {
    if (!action || typeof action !== 'object' || Array.isArray(action)) return [];
    const record = action as Record<string, unknown>;
    return record.type === 'speech' && typeof record.text === 'string' ? [record.text] : [];
  });
}

function delay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', aborted, { once: true });
  });
}
