import { createHash, randomUUID } from 'node:crypto';

import { normalizeClassroomDocument, parseStageDocument } from '@chalk/chalkboard';

import type { Database } from '../../../db/client';
import { createClassroomsDal } from '../../../db/dal';
import { ApiError } from '../../../http/errors';
import type { CreateClassroomInput } from '../schemas';
import { parseClassroomArchive } from '../classroom-archive';

export type ClassroomObjectStorage = {
  putObject(input: { fileKey: string; body: Buffer; contentType: string }): Promise<void>;
  createDownloadUrl(fileKey: string): Promise<string>;
  copyObject?(input: { sourceKey: string; targetKey: string }): Promise<void>;
  deleteObject?(fileKey: string): Promise<void>;
};

export type ImportClassroomInput = {
  sourceKey: string;
  contentFingerprint?: string;
  title: string;
  description?: string;
  document: unknown;
  media: Array<{
    path: string;
    contentType: string;
    body: Buffer;
  }>;
};

export class ClassroomService {
  private readonly classrooms;

  constructor(
    db: Database,
    private readonly objectStorage: ClassroomObjectStorage,
  ) {
    this.classrooms = createClassroomsDal(db);
  }

  async createClassroom(userId: string, input: CreateClassroomInput) {
    const normalized = normalizeClassroomDocument(input.document);
    parseStageDocument(normalized);
    const body = Buffer.from(JSON.stringify(normalized));
    const contentHash = createHash('sha256').update(body).digest('hex');
    const classroomId = randomUUID();
    const artifactId = randomUUID();
    const created = await this.classrooms.createWithArtifact(userId, {
      classroomId,
      artifactId,
      title: input.title,
      description: input.description,
      document: normalized,
      contentHash,
    });
    return projectClassroom(created);
  }

  async listClassrooms(userId: string) {
    return (await this.classrooms.list(userId)).map((row) => ({
      id: row.classroom.id,
      title: row.classroom.title,
      description: row.classroom.description,
      createdAt: row.classroom.createdAt.toISOString(),
      updatedAt: row.classroom.updatedAt.toISOString(),
      latestArtifact: row.artifact ? projectArtifact(row.artifact) : null,
      generation: row.draft && row.run && !row.draft.publishedAt ? {
        runId: row.run.id,
        draftId: row.draft.id,
        stage: row.run.stage,
        status: row.run.status,
        draftStatus: row.draft.status,
      } : null,
    }));
  }

  async getArtifact(userId: string, classroomId: string, artifactId: string) {
    const row = await this.classrooms.getArtifact(userId, classroomId, artifactId);
    const document = row.artifact.document;
    if (document === null) throw new Error(`Classroom artifact ${artifactId} has not been migrated to PostgreSQL`);
    parseStageDocument(document);
    const media = await this.classrooms.listArtifactMedia(userId, classroomId, artifactId);
    const mediaUrls = new Map(await Promise.all(media.map(async (asset) => [
      asset.path,
      await this.objectStorage.createDownloadUrl(asset.objectKey),
    ] as const)));
    return { ...projectClassroom(row), document: resolveMediaReferences(document, mediaUrls) };
  }

  async createArtifact(userId: string, classroomId: string, document: unknown) {
    await this.classrooms.getClassroom(userId, classroomId);
    const normalized = normalizeClassroomDocument(document);
    parseStageDocument(normalized);
    const body = Buffer.from(JSON.stringify(normalized));
    const contentHash = createHash('sha256').update(body).digest('hex');
    const artifactId = randomUUID();
    const created = await this.classrooms.addArtifact(userId, {
      classroomId,
      artifactId,
      document: normalized,
      contentHash,
    });
    return projectClassroom(created);
  }

  async importClassroom(userId: string, input: ImportClassroomInput) {
    const existing = await this.classrooms.getBySourceKey(userId, input.sourceKey);
    const normalized = normalizeClassroomDocument(input.document);
    parseStageDocument(normalized);
    const artifactBody = Buffer.from(JSON.stringify(normalized));
    const contentHash = input.contentFingerprint
      ?? createHash('sha256').update(artifactBody).digest('hex');
    if (existing) {
      if (existing.artifact.document === null) {
        const legacyObjectKey = existing.artifact.contentObjectKey;
        const artifact = await this.classrooms.migrateLegacyArtifact(userId, {
          classroomId: existing.classroom.id,
          artifactId: existing.artifact.id,
          document: normalized,
          contentHash,
        });
        if (legacyObjectKey) await this.objectStorage.deleteObject?.(legacyObjectKey).catch(() => undefined);
        return projectClassroom({ classroom: existing.classroom, artifact });
      }
      if (existing.artifact.contentHash === contentHash) return projectClassroom(existing);

      const artifactId = randomUUID();
      const media = prepareMedia(input.media, userId, existing.classroom.id, artifactId);
      const storedKeys = await this.storeMedia(media);
      try {
        const created = await this.classrooms.addArtifact(userId, {
          classroomId: existing.classroom.id,
          artifactId,
          document: normalized,
          contentHash,
          media: media.map(({ body: _body, ...asset }) => asset),
        });
        return projectClassroom(created);
      } catch (error) {
        await this.deleteStoredMedia(storedKeys);
        throw error;
      }
    }

    const classroomId = randomUUID();
    const artifactId = randomUUID();
    const storedKeys: string[] = [];
    const media = prepareMedia(input.media, userId, classroomId, artifactId);

    storedKeys.push(...await this.storeMedia(media));
    try {
      const created = await this.classrooms.createWithArtifact(userId, {
        classroomId,
        artifactId,
        title: input.title,
        description: input.description,
        sourceKey: input.sourceKey,
        document: normalized,
        contentHash,
        media: media.map(({ body: _body, ...asset }) => asset),
      });
      return projectClassroom(created);
    } catch (error) {
      await Promise.all(storedKeys.map((key) => this.objectStorage.deleteObject?.(key).catch(() => undefined)));
      throw error;
    }
  }

  private async storeMedia(media: ReturnType<typeof prepareMedia>) {
    const storedKeys: string[] = [];
    try {
      for (const asset of media) {
        await this.objectStorage.putObject({
          fileKey: asset.objectKey,
          body: asset.body,
          contentType: asset.contentType,
        });
        storedKeys.push(asset.objectKey);
      }
      return storedKeys;
    } catch {
      await this.deleteStoredMedia(storedKeys);
      throw new ApiError(
        503,
        'Classroom media storage is temporarily unavailable',
        'CLASSROOM_MEDIA_STORAGE_UNAVAILABLE',
      );
    }
  }

  private async deleteStoredMedia(keys: string[]) {
    await Promise.all(keys.map((key) => this.objectStorage.deleteObject?.(key).catch(() => undefined)));
  }

  async importArchive(userId: string, input: {
    filename: string;
    contentType: string;
    body: Buffer;
  }) {
    const parsed = await parseClassroomArchive(input);
    const existing = await this.classrooms.getBySourceKey(userId, parsed.sourceKey);
    return {
      classroom: await this.importClassroom(userId, parsed),
      created: existing === null,
    };
  }
}

function prepareMedia(
  media: ImportClassroomInput['media'],
  userId: string,
  classroomId: string,
  artifactId: string,
) {
  return media.map((asset) => {
    const path = normalizeMediaPath(asset.path);
    return {
      id: randomUUID(),
      path,
      objectKey: `classrooms/${userId}/${classroomId}/artifacts/${artifactId}/${path}`,
      contentType: asset.contentType,
      size: asset.body.byteLength,
      contentHash: createHash('sha256').update(asset.body).digest('hex'),
      body: asset.body,
    };
  });
}

function projectClassroom(row: Awaited<ReturnType<ReturnType<typeof createClassroomsDal>['createWithArtifact']>>) {
  return {
    id: row.classroom.id,
    title: row.classroom.title,
    description: row.classroom.description,
    createdAt: row.classroom.createdAt.toISOString(),
    updatedAt: row.classroom.updatedAt.toISOString(),
    latestArtifact: projectArtifact(row.artifact),
  };
}

function projectArtifact(artifact: {
  id: string;
  version: number;
  contentHash: string;
  createdAt: Date;
}) {
  return {
    id: artifact.id,
    version: artifact.version,
    contentHash: artifact.contentHash,
    createdAt: artifact.createdAt.toISOString(),
  };
}

function normalizeMediaPath(path: string) {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe classroom media path: ${path}`);
  }
  return normalized;
}

function resolveMediaReferences(document: unknown, mediaUrls: ReadonlyMap<string, string>) {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return document;
  const classroom = document as Record<string, unknown>;
  if (!Array.isArray(classroom.scenes)) return document;
  for (const rawScene of classroom.scenes) {
    if (typeof rawScene !== 'object' || rawScene === null || Array.isArray(rawScene)) continue;
    const content = (rawScene as Record<string, unknown>).content;
    if (typeof content !== 'object' || content === null || Array.isArray(content)) continue;
    const canvas = (content as Record<string, unknown>).canvas;
    if (typeof canvas !== 'object' || canvas === null || Array.isArray(canvas)) continue;
    const elements = (canvas as Record<string, unknown>).elements;
    if (!Array.isArray(elements)) continue;
    for (const rawElement of elements) {
      if (typeof rawElement !== 'object' || rawElement === null || Array.isArray(rawElement)) continue;
      const element = rawElement as Record<string, unknown>;
      if (typeof element.mediaRef !== 'string') continue;
      const url = mediaUrls.get(normalizeMediaPath(element.mediaRef));
      if (url) element.src = url;
    }
  }
  return classroom;
}
