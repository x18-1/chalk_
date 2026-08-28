import { adaptOpenMaicClassroomResponse, type AdaptedClassroom } from "@chalk/chalkboard";

import type { ClassroomGenerationRun } from "../../../api";

export type DraftSceneSlot = {
  id: string;
  title: string;
  order: number;
  status: "ready" | "running" | "pending" | "failed";
};

export function adaptGenerationRunToDraftClassroom(run: ClassroomGenerationRun): AdaptedClassroom {
  if (!run.outline || !run.previewReady) throw new Error("The classroom draft is not ready to preview");
  const scenes = run.scenes
    .filter((scene) => scene.status === "completed" && scene.phase === "completed" && scene.content && scene.actions)
    .sort((left, right) => left.order - right.order)
    .map((scene) => ({
      id: scene.outlineId,
      stageId: run.draftId,
      type: scene.type,
      title: scene.outline.title,
      order: scene.order,
      content: resolveDraftMedia(scene.content!, run.mediaTasks),
      actions: scene.actions,
    }));
  if (scenes.length === 0) throw new Error("The classroom draft has no completed scenes");
  const createdAt = timestamp(run.startedAt);
  const updatedAt = timestamp(run.finishedAt ?? run.startedAt);
  return adaptOpenMaicClassroomResponse({
    success: true,
    classroom: {
      stage: {
        id: run.draftId,
        name: run.outline.courseTitle,
        description: run.requirements,
        createdAt,
        updatedAt,
        ...(agentProfiles(run.context).length > 0 ? { agentProfiles: agentProfiles(run.context) } : {}),
      },
      scenes,
    },
  });
}

function resolveDraftMedia(
  content: Record<string, unknown>,
  mediaTasks: ClassroomGenerationRun["mediaTasks"],
) {
  const mediaUrls = new Map(mediaTasks.flatMap((task) => task.mediaRef && task.url
    ? [[task.mediaRef, task.url] as const]
    : []));
  const canvas = record(content.canvas);
  if (!Array.isArray(canvas.elements) || mediaUrls.size === 0) return content;
  return {
    ...content,
    canvas: {
      ...canvas,
      elements: canvas.elements.map((element) => {
        const value = record(element);
        const imageUrl = typeof value.src === "string" ? mediaUrls.get(value.src) : undefined;
        const videoUrl = typeof value.mediaRef === "string" ? mediaUrls.get(value.mediaRef) : undefined;
        if (imageUrl) return { ...value, mediaRef: value.src, src: imageUrl };
        if (videoUrl) return { ...value, src: videoUrl };
        return element;
      }),
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function agentProfiles(context: unknown) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return [];
  const profiles = (context as Record<string, unknown>).agentProfiles;
  return Array.isArray(profiles) ? profiles : [];
}

export function draftSceneSlots(run: ClassroomGenerationRun): DraftSceneSlot[] {
  if (!run.outline) return [];
  return run.outline.outlines
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((outline) => {
      const scene = run.scenes.find((candidate) => candidate.outlineId === outline.id);
      return {
        id: outline.id,
        title: outline.title,
        order: outline.order,
        status: scene?.status === "completed" && scene.phase === "completed"
          ? "ready"
          : scene?.status === "failed"
            ? "failed"
            : scene?.status === "running"
              ? "running"
              : "pending",
      };
    });
}

function timestamp(value: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
