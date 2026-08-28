"use client";

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  ChalkboardPlaybackController,
  projectScenePresentation,
  type AdaptedClassroom,
  type PlaybackExecutor,
  type RuntimeCommandResult,
} from "@chalk/chalkboard";
import type { ClassroomSession } from "../lib/classroom-client";
import { saveClassroomCursor } from "../lib/classroom-client";
import type { CursorSaveStatus } from "./use-classroom-workspace";

export type DiscussionContext = {
  topic: string;
  prompt?: string;
  triggerAgentId?: string;
};

type PresentationProjection = ReturnType<typeof projectScenePresentation>;

type UseClassroomRuntimeOptions = {
  classroom: AdaptedClassroom | null;
  learningSession: ClassroomSession | null;
  executor: PlaybackExecutor;
  playbackSettingsRef: MutableRefObject<{ autoPlayLecture: boolean }>;
  restorePresentation(projection: PresentationProjection): void;
  setCursorSaveStatus: Dispatch<SetStateAction<CursorSaveStatus>>;
  setDiscussionContext: Dispatch<SetStateAction<DiscussionContext | null>>;
  controllerRef: MutableRefObject<ChalkboardPlaybackController | null>;
};

/**
 * Owns the imperative Classroom runtime and exposes one command seam. Callers
 * do not construct controllers, subscribe to mutable runtime state, or decide
 * cursor conflict semantics themselves.
 */
export function useClassroomRuntime({
  classroom,
  learningSession,
  executor,
  playbackSettingsRef,
  restorePresentation,
  setCursorSaveStatus,
  setDiscussionContext,
  controllerRef,
}: UseClassroomRuntimeOptions) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unsupportedAction, setUnsupportedAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setRevision] = useState(0);
  const sync = useCallback(() => {
    if (!classroom) return;
    setActiveSceneId(classroom.runtime.getState().sceneId);
    setRevision((value) => value + 1);
  }, [classroom]);

  const persist = useCallback(async () => {
    if (!classroom || !learningSession) return;
    setCursorSaveStatus("saving");
    try {
      const result = await saveClassroomCursor(classroom, learningSession);
      if (result.status === "saved") {
        setCursorSaveStatus("saved");
        return;
      }
      const restored = classroom.runtime.restore(result.learningSession.cursor);
      if (!restored.ok) {
        setCursorSaveStatus("unsaved");
        setNotice("发现更新的学习进度，但暂时无法恢复。当前页面不会覆盖它，请重新打开课堂。");
        return;
      }
      const state = classroom.runtime.getState();
      const scene = classroom.document.scenes.find((candidate) => candidate.id === state.sceneId);
      const presentation = projectScenePresentation(scene?.actions ?? [], state.actionIndex);
      setDiscussionContext(presentation.discussion ? { topic: presentation.discussion } : null);
      restorePresentation(presentation);
      sync();
      setCursorSaveStatus("conflict");
      setNotice("检测到另一处设备保存了更新进度，已恢复最新进度。");
    } catch {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      setCursorSaveStatus(offline ? "offline" : "unsaved");
      setNotice(offline
        ? "当前离线，课堂可以继续浏览，但这次进度尚未保存。"
        : "进度暂时没有保存成功。课堂可以继续，下一次操作会自动重试。");
    }
  }, [classroom, learningSession, restorePresentation, setCursorSaveStatus, setDiscussionContext, sync]);

  useEffect(() => {
    controllerRef.current?.setExecutor(executor);
  }, [controllerRef, executor]);

  useEffect(() => {
    if (!classroom) {
      setActiveSceneId(null);
      return;
    }
    const controller = new ChalkboardPlaybackController({
      runtime: classroom.runtime,
      executor,
      persist,
      onUnsupportedAction: setUnsupportedAction,
      isAutoPlayEnabled: () => playbackSettingsRef.current.autoPlayLecture,
    });
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(sync);
    const activationFrame = window.requestAnimationFrame(() => { void controller.activate(); });
    sync();
    return () => {
      window.cancelAnimationFrame(activationFrame);
      unsubscribe();
      if (controllerRef.current === controller) controllerRef.current = null;
      void controller.dispose();
    };
  }, [classroom, controllerRef, executor, persist, playbackSettingsRef, sync]);

  const run = useCallback(async (
    operation: (controller: ChalkboardPlaybackController) => Promise<RuntimeCommandResult>,
  ) => {
    const controller = controllerRef.current;
    if (!classroom || !controller || busy) return;
    setBusy(true);
    setDiscussionContext(null);
    setUnsupportedAction(null);
    setNotice(null);
    try {
      const result = await operation(controller);
      if (!result.ok) {
        setNotice(result.error.code === "UNSUPPORTED_SCENE_TYPE"
          ? "项目式课堂场景尚未接入，已停留在当前页面。"
          : "当前播放状态不允许执行这个操作，请稍后再试。");
        return;
      }
      sync();
    } finally {
      setBusy(false);
    }
  }, [busy, classroom, controllerRef, setDiscussionContext, sync]);

  const resolvedActiveSceneId = classroom?.scenes.some((scene) => scene.id === activeSceneId)
    ? activeSceneId
    : classroom?.runtime.getState().sceneId ?? null;

  return {
    state: {
      activeSceneId: resolvedActiveSceneId,
      runtimeState: classroom?.runtime.getState() ?? null,
      busy,
      unsupportedAction,
      notice,
    },
    controllerRef,
    actions: {
      run,
      persist,
      sync,
      notify: setNotice,
      clearWarning: () => {
        setUnsupportedAction(null);
        setNotice(null);
      },
    },
  };
}
