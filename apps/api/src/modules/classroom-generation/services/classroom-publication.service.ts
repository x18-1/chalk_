import { createHash, randomUUID } from 'node:crypto';

import { normalizeClassroomDocument, parseStageDocument } from '@chalk/chalkboard';

import type { createClassroomGenerationDal } from '../../../db/dal';
import { ApiError } from '../../../http/errors';
import type { ClassroomObjectStorage } from '../../classrooms/services/classroom.service';

type GenerationDal = ReturnType<typeof createClassroomGenerationDal>;

export class ClassroomPublicationService {
  constructor(
    private readonly generation: GenerationDal,
    private readonly objectStorage: ClassroomObjectStorage,
  ) {}

  async publish(userId: string, runId: string) {
    const source = await this.generation.get(userId, runId);
    const existing = await this.generation.getPublishedClassroom(userId, source.draft.id);
    if (existing) return { created: false, classroom: projectClassroom(existing) };
    if (
      source.run.stage !== 'media_tasks'
      || source.run.status !== 'completed'
      || !['media_ready', 'publishing'].includes(source.draft.status)
    ) {
      throw new ApiError(
        409,
        'Only a completed classroom media run can be published',
        'CLASSROOM_DRAFT_NOT_READY',
      );
    }

    const scenes = await this.generation.listScenes(userId, source.draft.id);
    const tasks = await this.generation.listMediaTasks(userId, runId);
    const prepared = preparePublication(source, scenes, tasks);
    if (!this.objectStorage.copyObject) {
      throw new ApiError(
        503,
        'Classroom media promotion is temporarily unavailable',
        'CLASSROOM_MEDIA_PROMOTION_UNAVAILABLE',
      );
    }

    const reservation = await this.generation.reserveDraftPublication(userId, {
      runId,
      draftId: source.draft.id,
      publicationToken: randomUUID(),
      staleBefore: new Date(Date.now() - 5 * 60_000),
    });
    if (reservation.state === 'published') {
      const published = await this.generation.getPublishedClassroom(userId, source.draft.id);
      if (!published) throw new ApiError(409, 'Classroom publication is being finalized', 'CLASSROOM_PUBLICATION_IN_PROGRESS');
      return { created: false, classroom: projectClassroom(published) };
    }
    if (reservation.state === 'busy') {
      throw new ApiError(409, 'Classroom publication is already in progress', 'CLASSROOM_PUBLICATION_IN_PROGRESS');
    }
    const publicationToken = reservation.publicationToken;
    const classroomId = stableUuid(publicationToken, 'classroom');
    const artifactId = stableUuid(publicationToken, 'artifact');
    const copiedKeys: string[] = [];
    const media = prepared.media.map((asset) => ({
      ...asset,
      id: randomUUID(),
      objectKey: `classrooms/${userId}/${classroomId}/artifacts/${artifactId}/${asset.path}`,
    }));
    try {
      for (const asset of media) {
        await this.objectStorage.copyObject({ sourceKey: asset.sourceKey, targetKey: asset.objectKey });
        copiedKeys.push(asset.objectKey);
      }
    } catch {
      await this.deleteCopiedObjects(copiedKeys);
      await this.generation.releaseDraftPublication(userId, {
        draftId: source.draft.id,
        publicationToken,
      }).catch(() => undefined);
      throw new ApiError(
        503,
        'Classroom media promotion failed; the draft remains available',
        'CLASSROOM_MEDIA_PROMOTION_FAILED',
      );
    }

    try {
      const published = await this.generation.publishDraft(userId, {
        runId,
        draftId: source.draft.id,
        classroomId,
        artifactId,
        title: prepared.title,
        description: source.draft.requirements,
        document: prepared.document,
        contentHash: prepared.contentHash,
        publicationToken,
        media: media.map(({ sourceKey: _sourceKey, ...asset }) => asset),
      });
      return { created: published.created, classroom: projectClassroom(published) };
    } catch (error) {
      await this.deleteCopiedObjects(copiedKeys);
      await this.generation.releaseDraftPublication(userId, {
        draftId: source.draft.id,
        publicationToken,
      }).catch(() => undefined);
      throw error;
    }
  }

  private async deleteCopiedObjects(keys: string[]) {
    await Promise.all(keys.map((key) => this.objectStorage.deleteObject?.(key).catch(() => undefined)));
  }
}

function preparePublication(
  source: Awaited<ReturnType<GenerationDal['get']>>,
  scenes: Awaited<ReturnType<GenerationDal['listScenes']>>,
  tasks: Awaited<ReturnType<GenerationDal['listMediaTasks']>>,
) {
  try {
    if (!source.draft.outline || !isRecord(source.draft.outline)) throw new Error('Draft outline is missing');
    const title = source.draft.outline.courseTitle;
    if (typeof title !== 'string' || !title.trim()) throw new Error('Draft title is missing');
    if (scenes.length === 0) throw new Error('Draft scenes are missing');

    const media = tasks.map((task) => {
      if (
        task.status !== 'completed'
        || !task.mediaRef
        || !task.objectKey
        || !task.contentType
        || task.size === null
        || !task.contentHash
      ) throw new Error('Draft media is incomplete');
      if (
        !mediaReferenceMatchesKind(task.mediaRef, task.kind)
        || task.objectKey !== `classroom-drafts/${source.draft.userId}/${source.draft.id}/${task.mediaRef}`
        || task.size < 1
        || !/^[a-f0-9]{64}$/.test(task.contentHash)
        || !task.contentType.startsWith(`${task.kind}/`)
      ) throw new Error('Draft media metadata is invalid');
      return {
        path: task.mediaRef,
        sourceKey: task.objectKey,
        contentType: task.contentType,
        size: task.size,
        contentHash: task.contentHash,
      };
    });
    const mediaRefs = new Set(media.map((asset) => asset.path));
    if (mediaRefs.size !== media.length) throw new Error('Draft media references are duplicated');

    const stageId = source.draft.id;
    const document = normalizeClassroomDocument({
      stage: {
        id: stageId,
        name: title.trim(),
        description: source.draft.requirements,
        createdAt: source.draft.createdAt.getTime(),
        updatedAt: (source.run.finishedAt ?? source.draft.updatedAt).getTime(),
      },
      scenes: scenes.slice().sort((left, right) => left.order - right.order).map((scene) => {
        if (
          scene.status !== 'completed'
          || scene.actionStatus !== 'completed'
          || !scene.content
          || !scene.actions
          || !isRecord(scene.outline)
        ) throw new Error('Draft scene is incomplete');
        const sceneTitle = scene.outline.title;
        if (typeof sceneTitle !== 'string') throw new Error('Draft scene title is missing');
        return {
          id: scene.outlineId,
          stageId,
          type: scene.type,
          title: sceneTitle,
          order: scene.order,
          content: canonicalizeMediaReferences(scene.content, mediaRefs),
          actions: scene.actions,
        };
      }),
    }, stageId);
    const parsed = parseStageDocument(document);
    validatePublishedMediaReferences(parsed, mediaRefs);
    const body = Buffer.from(JSON.stringify(parsed));
    return {
      title: title.trim(),
      document: parsed,
      contentHash: createHash('sha256').update(body).digest('hex'),
      media,
    };
  } catch {
    throw new ApiError(
      422,
      'The classroom draft did not pass final validation',
      'CLASSROOM_DRAFT_INVALID',
    );
  }
}

function canonicalizeMediaReferences(content: unknown, mediaRefs: ReadonlySet<string>) {
  if (!isRecord(content)) return content;
  const copy = structuredClone(content);
  if (!isRecord(copy.canvas) || !Array.isArray(copy.canvas.elements)) return copy;
  copy.canvas.elements = copy.canvas.elements.map((value) => {
    if (!isRecord(value) || value.type !== 'image' || typeof value.src !== 'string' || !mediaRefs.has(value.src)) return value;
    const { src, ...element } = value;
    return { ...element, mediaRef: src };
  });
  return copy;
}

function validatePublishedMediaReferences(document: unknown, expectedRefs: ReadonlySet<string>) {
  if (!isRecord(document) || !Array.isArray(document.scenes)) throw new Error('Classroom scenes are missing');
  const referenced = new Set<string>();
  walk(document, (key, value) => {
    if (typeof value === 'string' && /^(gen_img_|gen_vid_)/.test(value)) {
      throw new Error('Generated media placeholder remains');
    }
    if ((key === 'mediaRef' || key === 'audioRef') && typeof value === 'string') {
      if (!expectedRefs.has(value)) throw new Error('Classroom contains an unknown media reference');
      referenced.add(value);
    }
  });
  if (referenced.size !== expectedRefs.size || [...expectedRefs].some((reference) => !referenced.has(reference))) {
    throw new Error('Generated media is not referenced by the classroom');
  }
}

function walk(value: unknown, visit: (key: string, value: unknown) => void) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    visit(key, child);
    walk(child, visit);
  }
}

function projectClassroom(row: {
  classroom: { id: string; title: string; description: string | null; createdAt: Date; updatedAt: Date };
  artifact: { id: string; version: number; contentHash: string; createdAt: Date };
}) {
  return {
    id: row.classroom.id,
    title: row.classroom.title,
    description: row.classroom.description,
    createdAt: row.classroom.createdAt.toISOString(),
    updatedAt: row.classroom.updatedAt.toISOString(),
    latestArtifact: {
      id: row.artifact.id,
      version: row.artifact.version,
      contentHash: row.artifact.contentHash,
      createdAt: row.artifact.createdAt.toISOString(),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mediaReferenceMatchesKind(reference: string, kind: string) {
  const extensions = kind === 'audio'
    ? 'mp3|opus|wav|aac|flac|pcm'
    : kind === 'image' ? 'png|jpe?g|webp|gif' : kind === 'video' ? 'mp4|webm|mov' : '(?!)';
  return new RegExp(`^media/generated/[0-9a-f-]+\\.(${extensions})$`, 'i').test(reference);
}

function stableUuid(publicationToken: string, purpose: string) {
  const bytes = createHash('sha256').update(`${purpose}:${publicationToken}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
