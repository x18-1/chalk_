import type { CanvasElement } from '../schema';

export interface ClassroomPackageManifest {
  formatVersion?: number;
  exportedAt?: string;
  appVersion?: string;
  stage?: Record<string, unknown>;
  agents?: unknown[];
  scenes?: unknown[];
  mediaIndex?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ClassroomPackageOptions {
  stageId?: string;
  mediaUrl?: (path: string) => string;
}

/**
 * Converts an OpenMAIC `.maic.zip` manifest into the same loose classroom
 * envelope used by the HTTP adapter. ZIP bytes stay outside the core package;
 * the web route owns extraction and supplies a media URL resolver here.
 */
export function normalizeClassroomPackageManifest(
  manifest: ClassroomPackageManifest,
  options: ClassroomPackageOptions = {},
): Record<string, unknown> {
  const stage = manifest.stage ?? {};
  const stageId = options.stageId ?? `package-${slug(String(stage.name ?? 'classroom'))}`;
  const now = Date.now();
  const scenes = (Array.isArray(manifest.scenes) ? manifest.scenes : []).map((rawScene, sceneIndex) => {
    const scene = record(rawScene);
    const sceneId = typeof scene.id === 'string' && scene.id.trim() ? scene.id : `${stageId}-scene-${sceneIndex + 1}`;
    const actions = Array.isArray(scene.actions)
      ? scene.actions.map((rawAction, actionIndex) => ({
        ...record(rawAction),
        id: typeof record(rawAction).id === 'string' ? record(rawAction).id : `${sceneId}-action-${actionIndex + 1}`,
      }))
      : undefined;
    const content = rewriteCanvasMedia(record(scene.content), options.mediaUrl, manifest.mediaIndex);
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
  mediaIndex?: Record<string, unknown>,
): Record<string, unknown> {
  if (!mediaUrl) return content;
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
      return path ? { ...element, src: mediaUrl(path), mediaRef: undefined } : element;
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

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || 'classroom';
}
