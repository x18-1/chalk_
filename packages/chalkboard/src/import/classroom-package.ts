import type { CanvasElement } from '../schema';

export interface ClassroomPackageManifest {
  format?: string;
  formatVersion?: number;
  classroomId?: string;
  exportedAt?: string;
  appVersion?: string;
  stage?: Record<string, unknown>;
  agents?: unknown[];
  scenes?: unknown[];
  mediaIndex?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Returns every packaged media path referenced by classroom canvas elements. */
export function classroomPackageMediaReferences(manifest: ClassroomPackageManifest): string[] {
  const references = new Set<string>();
  for (const rawScene of Array.isArray(manifest.scenes) ? manifest.scenes : []) {
    collectNamedMediaReferences(rawScene, manifest.mediaIndex, references);
    const content = record(record(rawScene).content);
    const elements = record(content.canvas).elements;
    if (!Array.isArray(elements)) continue;
    for (const rawElement of elements) {
      const element = record(rawElement);
      const reference = typeof element.mediaRef === 'string' && element.mediaRef.trim()
        ? element.mediaRef.trim()
        : typeof element.src === 'string' && isPackagedMediaReference(element.src)
          ? element.src.trim()
          : null;
      if (!reference) continue;
      references.add(resolveMediaPath(reference, manifest.mediaIndex) ?? reference);
    }
  }
  return [...references];
}

function collectNamedMediaReferences(
  value: unknown,
  mediaIndex: Record<string, unknown> | undefined,
  references: Set<string>,
) {
  if (Array.isArray(value)) {
    for (const item of value) collectNamedMediaReferences(item, mediaIndex, references);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'mediaRef' || key === 'audioRef') && typeof child === 'string' && child.trim()) {
      const reference = child.trim();
      references.add(resolveMediaPath(reference, mediaIndex) ?? reference);
      continue;
    }
    collectNamedMediaReferences(child, mediaIndex, references);
  }
}

export interface ClassroomPackageOptions {
  stageId?: string;
  now?: number;
  mediaUrl?: (path: string) => string;
  mediaReference?: (path: string) => string;
}

/**
 * Converts a Chalk Classroom Archive or OpenMAIC Archive manifest into the
 * normalized classroom envelope. ZIP bytes stay outside the core package;
 * the API archive adapter owns extraction and supplies either stable media
 * references for persistence or resolved URLs for legacy callers.
 */
export function normalizeClassroomPackageManifest(
  manifest: ClassroomPackageManifest,
  options: ClassroomPackageOptions = {},
): Record<string, unknown> {
  const stage = manifest.stage ?? {};
  const stageId = options.stageId ?? `package-${slug(String(stage.name ?? 'classroom'))}`;
  const now = options.now ?? Date.now();
  const scenes = (Array.isArray(manifest.scenes) ? manifest.scenes : []).map((rawScene, sceneIndex) => {
    const scene = record(rawScene);
    const sceneId = typeof scene.id === 'string' && scene.id.trim() ? scene.id : `${stageId}-scene-${sceneIndex + 1}`;
    const actions = Array.isArray(scene.actions)
      ? scene.actions.map((rawAction, actionIndex) => ({
        ...record(rawAction),
        id: typeof record(rawAction).id === 'string' ? record(rawAction).id : `${sceneId}-action-${actionIndex + 1}`,
      }))
      : undefined;
    const content = rewriteCanvasMedia(
      record(scene.content),
      options.mediaUrl,
      options.mediaReference,
      manifest.mediaIndex,
    );
    return {
      ...scene,
      id: sceneId,
      stageId,
      order: typeof scene.order === 'number' ? scene.order : sceneIndex,
      title: typeof scene.title === 'string' ? scene.title : `Scene ${sceneIndex + 1}`,
      content,
      actions,
      createdAt: typeof scene.createdAt === 'number' ? scene.createdAt : now,
      updatedAt: typeof scene.updatedAt === 'number' ? scene.updatedAt : now,
    };
  });
  return {
    ...manifest,
    id: stageId,
    agents: Array.isArray(manifest.agents) ? manifest.agents : [],
    stage: {
      ...stage,
      id: stageId,
      name: typeof stage.name === 'string' && stage.name.trim() ? stage.name : 'Imported Classroom',
      createdAt: typeof stage.createdAt === 'number' ? stage.createdAt : now,
      updatedAt: typeof stage.updatedAt === 'number' ? stage.updatedAt : now,
    },
    scenes,
  };
}

function rewriteCanvasMedia(
  content: Record<string, unknown>,
  mediaUrl?: (path: string) => string,
  mediaReference?: (path: string) => string,
  mediaIndex?: Record<string, unknown>,
): Record<string, unknown> {
  if (!mediaUrl && !mediaReference) return content;
  const canvas = record(content.canvas);
  const elements = Array.isArray(canvas.elements)
    ? canvas.elements.map((rawElement) => {
      const element = record(rawElement) as CanvasElement;
      const reference = typeof element.mediaRef === 'string' && element.mediaRef.trim()
        ? element.mediaRef
        : typeof element.src === 'string' && element.src.trim() && !element.src.includes('/') && !element.src.startsWith('http')
          ? element.src
          : null;
      if (!reference) return element;
      const path = resolveMediaPath(reference, mediaIndex);
      if (!path) return element;
      if (mediaUrl) return { ...element, src: mediaUrl(path), mediaRef: undefined };
      return { ...element, src: undefined, mediaRef: mediaReference!(path) };
    })
    : canvas.elements;
  return { ...content, canvas: { ...canvas, elements } };
}

function resolveMediaPath(reference: string, mediaIndex?: Record<string, unknown>): string | null {
  if (reference.includes('/') || reference.includes('.')) return reference;
  const match = Object.keys(mediaIndex ?? {}).find((path) => {
    const filename = path.split('/').pop() ?? '';
    return filename.replace(/\.[^.]+$/, '') === reference;
  });
  return match ?? null;
}

function isPackagedMediaReference(value: string) {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized)
    && !normalized.startsWith('http://')
    && !normalized.startsWith('https://')
    && !normalized.startsWith('/')
    && !normalized.startsWith('data:')
    && !normalized.startsWith('blob:');
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || 'classroom';
}
