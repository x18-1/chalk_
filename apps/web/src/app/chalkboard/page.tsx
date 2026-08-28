"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CircleDashed,
  LoaderCircle,
  MessagesSquare,
  Monitor,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import {
  ChalkboardPlaybackController,
  applyLiveChalkboardCommand,
  projectScenePresentation,
  type AdaptedClassroom,
  type RuntimeCommandResult,
  type RuntimeSnapshot,
} from "@chalk/chalkboard";
import type { Action } from "@chalk/chalkboard";
import { NotesPanel as MigratedNotesPanel } from "../../features/chalkboard/components/notes-panel";
import { PlaybackControls, type PlaybackSpeed } from "../../features/chalkboard/components/playback-controls";
import { LiveChalkboardSurface } from "../../features/chalkboard/components/live-chalkboard-surface";
import { QuizScene } from "../../features/chalkboard/components/quiz-scene";
import { ChatPanel } from "../../features/chalkboard/components/chat-panel";
import { InteractiveScene } from "../../features/chalkboard/components/interactive-scene";
import { ClassroomImportControl } from "../../features/chalkboard/components/classroom-import-control";
import { ClassroomGenerationControl } from "../../features/chalkboard/components/classroom-generation-control";
import { AppSidebar, type SidebarClassroom } from "../../components/app-sidebar";
import {
  ApiRequestError,
  classroomErrorMessage,
  classroomGenerationApi,
  classroomGenerationErrorMessage,
  classroomsApi,
  settingsApi,
  type BrowserSpeechSettings,
  type ClassroomGenerationRun,
  type ClassroomSummary,
} from "../../api";
import { SlideCanvas as MigratedSlideCanvas } from "../../features/chalkboard/components/slide-renderer";
import { SceneRail } from "../../features/chalkboard/components/scene-rail";
import { useClassroomPresentation } from "../../features/chalkboard/hooks/use-classroom-presentation";
import { useClassroomDiscussion } from "../../features/chalkboard/hooks/use-classroom-discussion";
import { useDiscussionSpeech } from "../../features/chalkboard/hooks/use-discussion-speech";
import {
  DraftClassroomSession,
  loadClassroomSession,
  restoreGrowingDraftCursor,
  saveClassroomCursor,
  type ClassroomSession,
} from "../../features/chalkboard/lib/classroom-client";
import {
  adaptGenerationRunToDraftClassroom,
  draftSceneSlots,
  type DraftSceneSlot,
} from "../../features/chalkboard/lib/draft-classroom";
import styles from "../../features/chalkboard/chalkboard.module.css";

type SpeechInput = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type SpeechInputConstructor = new () => SpeechInput;

type PendingSceneNavigation = {
  targetLabel: string;
  run: () => Promise<void>;
};

function actionLabel(action: Action | null, completed: boolean, sceneExhausted: boolean): string {
  if (!action) {
    if (completed) return "课程已完成";
    return sceneExhausted ? "本页讲解已完成" : "等待播放";
  }
  if (action.type === "speech") return "教师讲解";
  if (action.type === "spotlight") return "聚焦课件元素";
  if (action.type === "discussion") return "课堂提问";
  if (action.type === "widget_highlight") return "互动提示";
  return `动作：${action.type}`;
}

function toSidebarClassroom(classroom: ClassroomSummary): SidebarClassroom {
  return {
    id: classroom.id,
    title: classroom.title,
    ...(classroom.generation ? { generation: {
      stage: classroom.generation.stage,
      status: classroom.generation.status,
      draftStatus: classroom.generation.draftStatus,
    } } : {}),
  };
}

function consumeAuthoredDiscussionCursor(
  classroom: AdaptedClassroom,
  cursor: RuntimeSnapshot,
  topic: string | null,
) {
  if (!cursor.sceneId || !topic) return cursor;
  const scene = classroom.document.scenes.find((candidate) => candidate.id === cursor.sceneId);
  const action = scene?.actions?.[cursor.actionIndex];
  if (action?.type !== "discussion" || action.topic !== topic) return cursor;
  const actionCount = scene?.actions?.length ?? cursor.actionIndex + 1;
  return {
    ...cursor,
    actionIndex: Math.min(cursor.actionIndex + 1, actionCount),
    mode: "paused" as const,
    completed: false,
  };
}

function pendingSceneStatusLabel(
  status: DraftSceneSlot["status"],
  phase?: ClassroomGenerationRun["scenes"][number]["phase"],
) {
  if (status === "failed") return "生成暂停";
  if (status === "running") return phase === "actions" ? "正在生成教师讲解" : "正在生成课件内容";
  return "等待生成";
}

function GenerationSceneStatus({
  slot,
  scene,
  busy,
  onRetry,
}: {
  slot: DraftSceneSlot;
  scene: ClassroomGenerationRun["scenes"][number] | null;
  busy: boolean;
  onRetry(): void;
}) {
  const failed = slot.status === "failed";
  return <section className={styles.pendingSceneCanvas} aria-live="polite">
    <div className={styles.pendingSceneIcon} data-failed={failed || undefined}>
      {failed ? <AlertTriangle size={24} /> : <CircleDashed className={slot.status === "running" ? styles.importSpinner : ""} size={24} />}
    </div>
    <div>
      <span>SCENE {String(slot.order).padStart(2, "0")}</span>
      <h2>{failed ? "这一幕暂时没有生成完成" : slot.status === "running" ? pendingSceneStatusLabel(slot.status, scene?.phase) : "这一幕正在等待生成"}</h2>
      <p>{failed
        ? "前面已经完成的课堂内容不受影响。可以重新生成这一幕，并从当前失败阶段继续整堂课。"
        : slot.status === "running"
          ? "完成后会自动显示在这里；如果你返回已经生成的 Scene，后台任务仍会继续。"
          : "同一课堂会按照大纲顺序推进。轮到这一幕后，状态会自动更新。"}</p>
      {scene?.attempt ? <small>第 {scene.attempt} 次生成尝试{scene.error?.code ? ` · ${scene.error.code}` : ""}</small> : null}
      {failed ? <button type="button" disabled={busy} onClick={onRetry}><RotateCcw size={15} />重新生成这一幕</button> : null}
    </div>
  </section>;
}

export default function ChalkboardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedClassroomId = searchParams.get("id");
  const requestedDraftRunId = searchParams.get("draft");
  const [classroom, setClassroom] = useState<AdaptedClassroom | null>(null);
  const [learningSession, setLearningSession] = useState<ClassroomSession | null>(null);
  const [generationRun, setGenerationRun] = useState<ClassroomGenerationRun | null>(null);
  const [cursorSaveStatus, setCursorSaveStatus] = useState<"saved" | "saving" | "conflict" | "offline" | "unsaved">("saved");
  const [selectedClassroomId, setSelectedClassroomId] = useState<string | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [selectedPendingSceneId, setSelectedPendingSceneId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [ttsVolume, setTtsVolume] = useState(1);
  const [ttsMuted, setTtsMuted] = useState(false);
  const [speechSettings, setSpeechSettings] = useState<BrowserSpeechSettings>({ adapter: "browser", language: "zh-CN", voiceUri: null, rate: 0.95, volume: 1 });
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [autoPlayLecture, setAutoPlayLecture] = useState(false);
  const [discussionContext, setDiscussionContext] = useState<{ topic: string; prompt?: string; triggerAgentId?: string } | null>(null);
  const [discussionDraft, setDiscussionDraft] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [unsupportedAction, setUnsupportedAction] = useState<string | null>(null);
  const [runtimeNotice, setRuntimeNotice] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<"notes" | "chat">("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [classrooms, setClassrooms] = useState<SidebarClassroom[]>([]);
  const [pendingSceneNavigation, setPendingSceneNavigation] = useState<PendingSceneNavigation | null>(null);
  const [sceneNavigationConfirming, setSceneNavigationConfirming] = useState(false);
  const speechInputRef = useRef<SpeechInput | null>(null);
  const sceneNavigationOriginRef = useRef<HTMLElement | null>(null);
  const sceneSwitchDialogRef = useRef<HTMLDialogElement | null>(null);
  const playbackRef = useRef<ChalkboardPlaybackController | null>(null);
  const classroomRef = useRef<AdaptedClassroom | null>(null);
  const draftDocumentSignatureRef = useRef("");
  const {
    executor: playbackExecutor,
    settingsRef: playbackSettingsRef,
    speechBusyRef,
    iframeRef,
    lessonViewportRef,
    highlightedElementId,
    laserElementId,
    highlightTarget,
    widgetState,
    widgetAnnotation,
    widgetRevealTarget,
    liveChalkboard,
    setLiveChalkboard,
    restorePresentation,
  } = useClassroomPresentation(
    { autoPlayLecture, playbackSpeed, speechEnabled, ttsMuted, ttsVolume, speechLanguage: speechSettings.language, speechVoiceUri: speechSettings.voiceUri, speechRate: speechSettings.rate },
    async ({ topic, prompt, agentId }) => {
      setDiscussionContext({
        topic,
        ...(prompt ? { prompt } : {}),
        ...(agentId ? { triggerAgentId: agentId } : {}),
      });
      setRightPanelOpen(true);
      setRightPanelTab("chat");
      await playbackRef.current?.pause();
    },
  );

  useEffect(() => {
    if (window.matchMedia("(max-width: 1180px)").matches) setRightPanelOpen(false);
    void settingsApi.capabilities().then((settings) => {
      setSpeechSettings(settings.speech);
      setTtsVolume(settings.speech.volume);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    classroomRef.current = classroom;
  }, [classroom]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setClassroom(null);
    setLearningSession(null);
    setGenerationRun(null);
    setSelectedPendingSceneId(null);
    draftDocumentSignatureRef.current = "";

    const schedule = (runId: string) => {
      if (!cancelled) timer = window.setTimeout(() => void refreshGeneration(runId), 700);
    };
    const refreshGeneration = async (runId: string) => {
      try {
        const { generationRun: nextRun } = await classroomGenerationApi.get(runId, controller.signal);
        if (cancelled) return;
        setGenerationRun(nextRun);
        if (nextRun.classroomId) setSelectedClassroomId(nextRun.classroomId);
        if (nextRun.stage === "outline") {
          const listed = await classroomsApi.list(controller.signal);
          if (!cancelled) setClassrooms(listed.classrooms.map(toSidebarClassroom));
        }
        if (!nextRun.previewReady) {
          setLoading(false);
          if (nextRun.status === "queued" || nextRun.status === "running") schedule(runId);
          return;
        }

        const completedSceneIds = nextRun.scenes
          .filter((scene) => scene.status === "completed" && scene.phase === "completed")
          .map((scene) => scene.outlineId)
          .join(":");
        const completedMedia = nextRun.mediaTasks
          .filter((task) => task.status === "completed" && task.url)
          .map((task) => `${task.id}:${task.mediaRef}`)
          .join(":");
        const draftDocumentSignature = `${completedSceneIds}|${completedMedia}`;
        let documentApplied = true;
        if (draftDocumentSignatureRef.current !== draftDocumentSignature) {
          const adapted = adaptGenerationRunToDraftClassroom(nextRun);
          const previous = classroomRef.current;
          if (previous?.runtime.getState().mode === "playing" || speechBusyRef.current) {
            documentApplied = false;
          } else {
            const draftSession = new DraftClassroomSession(nextRun.draftId, nextRun.id, adapted.document);
            if (previous?.document.stage.id === adapted.document.stage.id) restoreGrowingDraftCursor(previous, adapted);
            else draftSession.restoreCursor(adapted);
            draftDocumentSignatureRef.current = draftDocumentSignature;
            classroomRef.current = adapted;
            setClassroom(adapted);
            setLearningSession(draftSession);
            setActiveSceneId(adapted.runtime.getState().sceneId);
            setTick((value) => value + 1);
          }
        }
        setCursorSaveStatus("saved");
        setError(null);
        setLoading(false);
        if (nextRun.status === "queued" || nextRun.status === "running" || !documentApplied) schedule(runId);
      } catch (reason) {
        if (cancelled || controller.signal.aborted) return;
        if (!(reason instanceof ApiRequestError) || reason.status >= 500) {
          setLoading(classroomRef.current === null);
          schedule(runId);
          return;
        }
        setLoading(false);
        setError({
          title: "课堂草稿暂时无法打开",
          message: classroomGenerationErrorMessage(reason),
        });
      }
    };

    void (async () => {
      try {
        const listed = await classroomsApi.list(controller.signal);
        if (cancelled) return;
        setClassrooms(listed.classrooms.map(toSidebarClassroom));

        if (requestedDraftRunId) {
          await refreshGeneration(requestedDraftRunId);
          return;
        }
        if (listed.classrooms.length === 0) {
          throw new ApiRequestError(404, "还没有可学习的课堂。", "CLASSROOMS_EMPTY");
        }
        const selected = requestedClassroomId
          ? listed.classrooms.find((candidate) => candidate.id === requestedClassroomId)
          : listed.classrooms[0];
        if (!selected) throw new ApiRequestError(404, "没有找到这门课堂，它可能已被移除。", "CLASSROOM_NOT_FOUND");
        setSelectedClassroomId(selected.id);
        if (selected.generation) {
          await refreshGeneration(selected.generation.runId);
          return;
        }
        const loaded = await loadClassroomSession(selected, controller.signal);
        if (cancelled) return;
        setClassroom(loaded.classroom);
        setLearningSession(loaded.learningSession);
        setCursorSaveStatus("saved");
        setActiveSceneId(loaded.classroom.runtime.getState().sceneId);
        setTick((value) => value + 1);
        setLoading(false);
      } catch (reason) {
        if (cancelled || controller.signal.aborted) return;
        const title = reason instanceof ApiRequestError && reason.code === "CLASSROOMS_EMPTY"
          ? "还没有课堂"
          : reason instanceof ApiRequestError && reason.status === 404
            ? "课堂没有找到"
            : "课堂暂时无法打开";
        setError({ title, message: classroomErrorMessage(reason) });
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
      speechInputRef.current?.stop();
    };
  }, [loadAttempt, requestedClassroomId, requestedDraftRunId, router, speechBusyRef]);

  const activeScene = useMemo(() => classroom?.scenes.find((scene) => scene.id === activeSceneId) ?? null, [activeSceneId, classroom]);
  const activeDocumentScene = classroom?.document.scenes.find((scene) => scene.id === activeSceneId);
  const runtimeState = classroom?.runtime.getState();
  const currentAction = runtimeState?.currentAction ?? null;
  const discussionTarget = useMemo(() => learningSession?.discussionTarget() ?? null, [learningSession]);
  const discussionSpeech = useDiscussionSpeech({
    enabled: speechEnabled && !ttsMuted,
    language: speechSettings.language,
    voiceUri: speechSettings.voiceUri,
    rate: speechSettings.rate * playbackSpeed,
    volume: ttsVolume,
  });
  const classroomDiscussion = useClassroomDiscussion({
    target: discussionTarget,
    sceneId: activeSceneId,
    sceneTitle: activeScene?.title ?? "当前场景",
    topic: discussionContext,
    entryCursor: classroom?.runtime.getSnapshot() ?? null,
    onAgentStarted: discussionSpeech.onAgentStarted,
    onAgentTextDelta: discussionSpeech.onTextDelta,
    onAgentMessageCompleted: discussionSpeech.onMessageCompleted,
  });
  const discussionLocked = ["streaming", "stopping", "completing"].includes(classroomDiscussion.status) ||
    discussionSpeech.active;
  const projectedDiscussionChalkboardActions = useMemo(
    () => classroomDiscussion.messages.flatMap((message) => message.actions),
    [classroomDiscussion.messages],
  );
  const [discussionChalkboardActions, setDiscussionChalkboardActions] = useState<Action[]>([]);

  useEffect(() => {
    setDiscussionChalkboardActions((current) => {
      const currentIds = current.map((action) => action.id).join("|");
      const projectedIds = projectedDiscussionChalkboardActions.map((action) => action.id).join("|");
      return currentIds === projectedIds ? current : projectedDiscussionChalkboardActions;
    });
  }, [projectedDiscussionChalkboardActions]);

  useEffect(() => {
    if (!classroom || !activeSceneId) return;
    const scene = classroom.document.scenes.find((candidate) => candidate.id === activeSceneId);
    let state = projectScenePresentation(
      scene?.actions ?? [],
      classroom.runtime.getState().actionIndex,
    ).liveChalkboard;
    for (const action of discussionChalkboardActions) {
      const applied = applyLiveChalkboardCommand(state, action);
      if (applied.ok) state = applied.state;
    }
    setLiveChalkboard(state);
  }, [activeSceneId, classroom, discussionChalkboardActions, setLiveChalkboard]);

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
        setRuntimeNotice("发现更新的学习进度，但暂时无法恢复。当前页面不会覆盖它，请重新打开课堂。");
        return;
      }
      const state = classroom.runtime.getState();
      const scene = classroom.document.scenes.find((candidate) => candidate.id === state.sceneId);
      const presentation = projectScenePresentation(scene?.actions ?? [], state.actionIndex);
      setDiscussionContext(presentation.discussion ? { topic: presentation.discussion } : null);
      restorePresentation(presentation);
      setActiveSceneId(state.sceneId);
      setTick((value) => value + 1);
      setCursorSaveStatus("conflict");
      setRuntimeNotice("检测到另一处设备保存了更新进度，已恢复最新进度。");
    } catch {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      setCursorSaveStatus(offline ? "offline" : "unsaved");
      setRuntimeNotice(offline
        ? "当前离线，课堂可以继续浏览，但这次进度尚未保存。"
        : "进度暂时没有保存成功。课堂可以继续，下一次操作会自动重试。");
    }
  }, [classroom, learningSession, restorePresentation]);

  const completeClassroomDiscussion = useCallback(async () => {
    discussionSpeech.interrupt();
    const entryCursor = await classroomDiscussion.complete();
    if (!entryCursor || !classroom) return;
    const resumeCursor = consumeAuthoredDiscussionCursor(
      classroom,
      entryCursor,
      classroomDiscussion.discussion?.topic ?? discussionContext?.topic ?? null,
    );
    const restored = classroom.runtime.restore(resumeCursor);
    if (!restored.ok) {
      setRuntimeNotice("讨论已经结束，但原来的课堂位置已不可恢复；已保留在当前页面。");
      return;
    }
    const state = classroom.runtime.getState();
    const scene = classroom.document.scenes.find((candidate) => candidate.id === state.sceneId);
    const presentation = projectScenePresentation(scene?.actions ?? [], state.actionIndex);
    for (const action of discussionChalkboardActions) {
      const applied = applyLiveChalkboardCommand(presentation.liveChalkboard, action);
      if (applied.ok) presentation.liveChalkboard = applied.state;
    }
    setDiscussionContext(presentation.discussion ? { topic: presentation.discussion } : null);
    restorePresentation(presentation);
    setActiveSceneId(state.sceneId);
    setTick((value) => value + 1);
    setRuntimeNotice("讨论已结束，已回到发起讨论时的课堂位置。");
    await persist();
  }, [classroom, classroomDiscussion, discussionChalkboardActions, discussionContext?.topic, discussionSpeech, persist, restorePresentation]);

  useEffect(() => {
    playbackRef.current?.setExecutor(playbackExecutor);
  }, [playbackExecutor]);

  useEffect(() => {
    if (!classroom) return;
    const controller = new ChalkboardPlaybackController({
      runtime: classroom.runtime,
      executor: playbackExecutor,
      persist,
      onUnsupportedAction: (actionType) => setUnsupportedAction(actionType),
      isAutoPlayEnabled: () => playbackSettingsRef.current.autoPlayLecture,
    });
    playbackRef.current = controller;
    const unsubscribe = controller.subscribe((state) => {
      setActiveSceneId(state.sceneId);
      setTick((value) => value + 1);
    });
    const activationFrame = window.requestAnimationFrame(() => { void controller.activate(); });
    return () => {
      window.cancelAnimationFrame(activationFrame);
      unsubscribe();
      if (playbackRef.current === controller) playbackRef.current = null;
      void controller.dispose();
    };
  }, [classroom, persist, playbackExecutor, playbackSettingsRef]);

  const runCommand = useCallback(async (operation: (controller: ChalkboardPlaybackController) => Promise<RuntimeCommandResult>) => {
    const controller = playbackRef.current;
    if (!classroom || !controller || busy) return;
    setBusy(true);
    setDiscussionContext(null);
    setVoiceStatus("");
    setUnsupportedAction(null);
    setRuntimeNotice(null);
    try {
      const result = await operation(controller);
      if (!result.ok) {
        setRuntimeNotice(result.error.code === "UNSUPPORTED_SCENE_TYPE"
          ? "项目式课堂场景尚未接入，已停留在当前页面。"
          : "当前播放状态不允许执行这个操作，请稍后再试。");
        return;
      }
      setActiveSceneId(classroom.runtime.getState().sceneId);
      setTick((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }, [busy, classroom]);

  const command = useCallback(async (operation: (controller: ChalkboardPlaybackController) => Promise<RuntimeCommandResult>) => {
    if (discussionLocked) {
      setRuntimeNotice("当前回答仍在生成或朗读。可以切换 Scene，继续播放课件前请先停止这一轮讨论。");
      setRightPanelOpen(true);
      setRightPanelTab("chat");
      return;
    }
    await runCommand(operation);
  }, [discussionLocked, runCommand]);

  const restoreSceneNavigationFocus = useCallback(() => {
    const origin = sceneNavigationOriginRef.current;
    sceneNavigationOriginRef.current = null;
    window.requestAnimationFrame(() => origin?.focus());
  }, []);

  const cancelSceneNavigation = useCallback(() => {
    if (sceneNavigationConfirming) return;
    setPendingSceneNavigation(null);
    restoreSceneNavigationFocus();
  }, [restoreSceneNavigationFocus, sceneNavigationConfirming]);

  const requestSceneNavigation = useCallback(async (targetLabel: string, run: () => Promise<void>) => {
    if (busy || sceneNavigationConfirming) return;
    if (!discussionLocked) {
      await run();
      return;
    }
    sceneNavigationOriginRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingSceneNavigation({ targetLabel, run });
  }, [busy, discussionLocked, sceneNavigationConfirming]);

  const confirmSceneNavigation = useCallback(async () => {
    if (!pendingSceneNavigation || sceneNavigationConfirming) return;
    setSceneNavigationConfirming(true);
    setRuntimeNotice(null);
    try {
      discussionSpeech.interrupt();
      await classroomDiscussion.stop();
      await pendingSceneNavigation.run();
      setPendingSceneNavigation(null);
    } finally {
      setSceneNavigationConfirming(false);
      sceneNavigationOriginRef.current = null;
    }
  }, [classroomDiscussion, discussionSpeech, pendingSceneNavigation, sceneNavigationConfirming]);

  const selectScene = useCallback((sceneId: string, sceneTitle: string) => requestSceneNavigation(
    sceneTitle,
    async () => {
      setSelectedPendingSceneId(null);
      await runCommand((controller) => controller.selectScene(sceneId));
    },
  ), [requestSceneNavigation, runCommand]);

  useEffect(() => {
    const dialog = sceneSwitchDialogRef.current;
    if (pendingSceneNavigation && dialog && !dialog.open) dialog.showModal();
  }, [pendingSceneNavigation]);

  // Teaching effects are scoped to a scene. They must survive the transition
  // from spotlight/laser into the following speech action, but never leak to
  // the next page selected from the rail or by the page controls.
  useEffect(() => {
    const scene = classroom?.document.scenes.find((candidate) => candidate.id === activeSceneId);
    const restored = projectScenePresentation(scene?.actions ?? [], classroom?.runtime.getState().actionIndex ?? 0);
    setDiscussionContext(restored.discussion ? { topic: restored.discussion } : null);
    restorePresentation(restored);
    setDiscussionDraft("");
    setVoiceStatus("");
  }, [activeSceneId, classroom, restorePresentation]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || target?.closest("button, a, input, textarea, select, summary, [role=button], [role=tab], [contenteditable=true]")) return;
      if (!classroom) return;
      if (event.key === "ArrowRight") {
        const nextScene = classroom.scenes[(runtimeState?.sceneIndex ?? -1) + 1];
        if (nextScene) { event.preventDefault(); void selectScene(nextScene.id, nextScene.title); }
      }
      if (event.key === "ArrowLeft") {
        const previousScene = classroom.scenes[(runtimeState?.sceneIndex ?? 0) - 1];
        if (previousScene) { event.preventDefault(); void selectScene(previousScene.id, previousScene.title); }
      }
      if (event.key === " ") {
        event.preventDefault();
        void command((controller) => runtimeState?.mode === "playing" ? controller.pause() : runtimeState?.mode === "paused" ? controller.resume() : controller.start());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [classroom, command, runtimeState?.mode, runtimeState?.sceneIndex, selectScene]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setVoiceStatus("当前浏览器不允许进入演示模式。");
    }
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      speechInputRef.current?.stop();
      return;
    }
    const speechWindow = window as typeof window & { SpeechRecognition?: SpeechInputConstructor; webkitSpeechRecognition?: SpeechInputConstructor };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceStatus("当前浏览器不支持语音输入。");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) setDiscussionDraft((current) => `${current}${transcript}`.trim());
    };
    recognition.onerror = () => { setIsListening(false); setVoiceStatus("语音输入没有识别到内容。"); };
    recognition.onend = () => setIsListening(false);
    speechInputRef.current = recognition;
    setVoiceStatus("正在听，请说出你的想法。");
    setIsListening(true);
    recognition.start();
  };

  const submitDiscussion = async (message: string) => {
    const text = message.trim();
    if (!text) return;
    setDiscussionDraft("");
    setVoiceStatus("已发送，课堂成员正在思考。");
    if (runtimeState?.mode === "playing") {
      await playbackRef.current?.pause();
      await playbackExecutor.cancel?.("student started a classroom discussion");
    }
    await classroomDiscussion.send(text).finally(() => setVoiceStatus(""));
  };

  const stopDiscussionRound = useCallback(() => {
    discussionSpeech.interrupt();
    void classroomDiscussion.stop();
  }, [classroomDiscussion, discussionSpeech]);

  const toggleFullscreenLabel = isFullscreen ? "退出演示模式" : "演示模式";

  const openImportedClassroom = useCallback((classroomId: string) => {
    setError(null);
    setLoadAttempt((value) => value + 1);
    router.push(`/chalkboard?id=${encodeURIComponent(classroomId)}`);
  }, [router]);

  const refreshGenerationClassroom = useCallback(() => {
    setError(null);
    setLoadAttempt((value) => value + 1);
  }, []);

  const selectDraftSlot = useCallback(async (slot: DraftSceneSlot) => {
    if (slot.status === "ready") return;
    await requestSceneNavigation(slot.title, async () => {
      if (playbackRef.current) await playbackRef.current.pause();
      setSelectedPendingSceneId(slot.id);
    });
  }, [requestSceneNavigation]);

  const retryGenerationScene = useCallback(async () => {
    if (!generationRun || busy) return;
    setBusy(true);
    setRuntimeNotice(null);
    try {
      await classroomGenerationApi.retry(generationRun.id);
      refreshGenerationClassroom();
    } catch (reason) {
      setRuntimeNotice(classroomGenerationErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, [busy, generationRun, refreshGenerationClassroom]);

  useEffect(() => {
    if (!selectedPendingSceneId || !classroom?.scenes.some((scene) => scene.id === selectedPendingSceneId)) return;
    const frame = window.requestAnimationFrame(() => {
      setSelectedPendingSceneId(null);
      void playbackRef.current?.selectScene(selectedPendingSceneId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [classroom, selectedPendingSceneId]);

  const publishDraft = useCallback(async () => {
    if (!generationRun?.publishReady || busy) return;
    setBusy(true);
    setRuntimeNotice(null);
    try {
      const result = await classroomGenerationApi.publish(generationRun.id);
      openImportedClassroom(result.classroom.id);
    } catch (reason) {
      setRuntimeNotice(classroomGenerationErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, [busy, generationRun, openImportedClassroom]);

  if (loading) return <main className={styles.page}>
    <AppSidebar activeSection="chalkboard" historyMode="chalkboard" chalkboards={classrooms} selectedChalkboardId={selectedClassroomId ?? undefined} />
    <section className={styles.loadingWorkspace} aria-label="Chalkboard 正在加载">
      <header className={styles.topBar}>
        <div className={styles.courseHeading}><span>CHALKBOARD / OPENING</span><h1>Chalkboard</h1></div>
      </header>
      <div className={styles.loadingWorkspaceBody} role="status" aria-live="polite">
        <LoaderCircle className={styles.importSpinner} size={20} />
        <div><strong>正在准备课堂内容…</strong><span>正在恢复最近的课堂和学习进度。</span></div>
      </div>
    </section>
  </main>;
  if (generationRun && !generationRun.previewReady && !error) return <main className={styles.page}>
    <AppSidebar activeSection="chalkboard" historyMode="chalkboard" chalkboards={classrooms} selectedChalkboardId={selectedClassroomId ?? undefined} />
    <section className={styles.generationWorkspace} aria-label="课堂生成工作区">
      <header className={styles.topBar}>
        <div className={styles.courseHeading}><span>CHALKBOARD / GENERATING</span><h1>{generationRun.outline?.courseTitle ?? "正在准备课堂"}</h1></div>
        <div className={styles.topTools}>
          <ClassroomGenerationControl compact onCreated={openImportedClassroom} onPublished={openImportedClassroom} />
          <ClassroomImportControl compact onImported={openImportedClassroom} />
        </div>
      </header>
      <div className={styles.generationWorkspaceBody}>
        <ClassroomGenerationControl
          embedded
          resumeRunId={generationRun.id}
          onPublished={openImportedClassroom}
          onPreviewReady={refreshGenerationClassroom}
        />
      </div>
    </section>
  </main>;
  if (error || !classroom || !activeScene || !runtimeState) return <main className={styles.errorState}><AlertTriangle size={22} /><h1>{error?.title ?? "课堂暂时无法打开"}</h1><p>{error?.message ?? "没有找到可播放的课堂数据。"}</p><div className={styles.errorActions}><ClassroomGenerationControl onCreated={openImportedClassroom} onPublished={openImportedClassroom} /><ClassroomImportControl onImported={openImportedClassroom} /><button type="button" onClick={() => { setError(null); setLoading(true); setLoadAttempt((value) => value + 1); }}><RotateCcw size={15} />重试</button><Link href="/chat"><ArrowLeft size={15} />回到 Chat</Link></div></main>;

  const isDraftClassroom = Boolean(generationRun);
  const sceneSlots = generationRun ? draftSceneSlots(generationRun) : undefined;
  const selectedPendingSlot = selectedPendingSceneId
    ? sceneSlots?.find((slot) => slot.id === selectedPendingSceneId && slot.status !== "ready") ?? null
    : null;
  const selectedPendingScene = selectedPendingSlot
    ? generationRun?.scenes.find((scene) => scene.outlineId === selectedPendingSlot.id) ?? null
    : null;
  const draftWaitingForScenes = Boolean(generationRun?.progress && generationRun.progress.completed < generationRun.progress.total);
  const sceneIndex = classroom.scenes.findIndex((scene) => scene.id === activeScene.id);
  const isPlaying = runtimeState.mode === "playing";
  const isCompleted = runtimeState.completed;
  const playbackStatus = isCompleted
    ? draftWaitingForScenes ? "当前内容已讲完 · 生成中" : "课程已完成"
    : isPlaying ? "正在播放" : runtimeState.mode === "paused" ? "已暂停" : "准备就绪";
  const cursorStatus = cursorSaveStatus === "saving" ? "正在保存进度…"
    : cursorSaveStatus === "conflict" ? "已恢复较新进度"
      : cursorSaveStatus === "offline" ? "离线 · 进度未保存"
        : cursorSaveStatus === "unsaved" ? "进度未保存"
          : isDraftClassroom ? "草稿进度保存在本机" : "进度已保存";

  return (
    <main className={styles.page}>
      <AppSidebar activeSection="chalkboard" historyMode="chalkboard" chalkboards={classrooms} selectedChalkboardId={selectedClassroomId ?? undefined} />
      <div className={`${styles.chalkboardWorkspace} ${rightPanelOpen ? "" : styles.pagePanelClosed}`}>
        <SceneRail
          scenes={classroom.scenes}
          draftSlots={sceneSlots}
          activeId={selectedPendingSceneId ?? activeScene.id}
          onSelectDraftSlot={(slot) => void selectDraftSlot(slot)}
          onSelect={(scene) => void selectScene(scene.id, scene.title)}
        />
        <section className={styles.classroom}>
        <header className={styles.topBar}>
          <div className={styles.courseHeading}><span>{isDraftClassroom ? "CHALKBOARD / DRAFT CLASSROOM" : "CHALKBOARD / PLAYBACK"}</span><h1>{classroom.document.stage.name}</h1></div>
          <div className={styles.topTools}>
            <ClassroomGenerationControl compact onCreated={openImportedClassroom} onPublished={openImportedClassroom} />
            <ClassroomImportControl compact onImported={openImportedClassroom} />
            <span className={styles.languageSwitch}>中</span>
            <button className={styles.iconButton} type="button" aria-label={toggleFullscreenLabel} title={toggleFullscreenLabel} onClick={() => void toggleFullscreen()}><Monitor size={15} /></button>
            <div className={styles.settingsWrap}>
              <button className={styles.iconButton} type="button" aria-label="课堂设置" title="课堂设置" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}><Settings2 size={15} /></button>
              {settingsOpen ? <div className={styles.classroomSettings} role="dialog" aria-label="课堂设置">
                <label><input type="checkbox" checked={speechEnabled} onChange={(event) => setSpeechEnabled(event.target.checked)} />自动播放教师语音</label>
                <span>关闭后仍会显示教师讲解文字。</span>
              </div> : null}
            </div>
            <span
              className={`${styles.saveStatus} ${cursorSaveStatus === "offline" || cursorSaveStatus === "unsaved" ? styles.saveStatusWarning : ""}`}
              role="status"
              aria-live="polite"
            >{cursorStatus}</span>
            <div className={styles.topStatus} aria-live="polite"><span className={styles.statusDot} />{playbackStatus}<span className={styles.stageId}>{classroom.document.stage.id}</span></div>
          </div>
        </header>
        <div className={styles.classroomBody}>
          <section className={styles.lessonSpace}>
            {isDraftClassroom && generationRun?.progress ? <section className={styles.draftRuntimeStatus} aria-label="课堂草稿生成状态">
              <div role="status" aria-live="polite">
                {generationRun.publishReady ? <BookOpen size={15} /> : <LoaderCircle className={styles.importSpinner} size={15} />}
                <span><strong>{generationRun.progress.completed} / {generationRun.progress.total} 个场景已就绪</strong>{generationRun.publishReady ? "课堂已完整生成，可以发布为正式课堂。" : "当前场景可正常学习，其余场景继续在后台生成。"}</span>
              </div>
              {generationRun.publishReady ? <button type="button" disabled={busy} onClick={() => void publishDraft()}>{busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <BookOpen size={15} />}{busy ? "正在校验并发布…" : "校验并发布课堂"}</button> : null}
            </section> : null}
            <div className={styles.lessonMeta}><span>第 {selectedPendingSlot?.order ?? sceneIndex + 1} / {sceneSlots?.length ?? classroom.scenes.length} 节</span><strong>{selectedPendingSlot?.title ?? activeScene.title}</strong><span>{selectedPendingSlot ? pendingSceneStatusLabel(selectedPendingSlot.status, selectedPendingScene?.phase) : isCompleted && draftWaitingForScenes ? "当前已生成内容讲解完成" : actionLabel(currentAction, isCompleted, runtimeState.actionIndex >= activeScene.actionCount)}</span></div>
            <div ref={lessonViewportRef} className={styles.lessonViewport}>
              {selectedPendingSlot ? <GenerationSceneStatus
                slot={selectedPendingSlot}
                scene={selectedPendingScene}
                busy={busy}
                onRetry={() => void retryGenerationScene()}
              /> : null}
              {!selectedPendingSlot && activeScene.type === "slide" ? <MigratedSlideCanvas scene={activeScene} highlightedElementId={highlightedElementId} laserElementId={laserElementId} /> : null}
              {!selectedPendingSlot && activeScene.type === "interactive" ? <InteractiveScene scene={activeScene} iframeRef={iframeRef} highlightTarget={highlightTarget} widgetState={widgetState} widgetAnnotation={widgetAnnotation} widgetRevealTarget={widgetRevealTarget} /> : null}
              {!selectedPendingSlot && activeScene.type === "quiz" && learningSession ? <QuizScene
                key={activeScene.id}
                scene={activeScene}
                attempt={learningSession.quizAttempt(activeScene.id)}
                onSubmit={(answers) => learningSession.saveQuizAttempt(activeScene.id, answers)}
              /> : null}
              {!selectedPendingSlot && activeScene.type === "pbl" ? <div className={styles.sceneEmpty}><AlertTriangle size={22} /><strong>项目式课堂暂未接入</strong><span>当前版本不会静默跳过这类场景，请返回上一页继续学习。</span></div> : null}
              {!selectedPendingSlot && liveChalkboard.open ? <LiveChalkboardSurface elements={liveChalkboard.elements} onClose={() => setLiveChalkboard((current) => ({ ...current, open: false }))} /> : null}
            </div>
            {!selectedPendingSlot ? <PlaybackControls
              isPlaying={isPlaying}
              busy={busy || sceneNavigationConfirming}
              playbackLocked={discussionLocked}
              canPrevious={runtimeState.sceneIndex > 0}
              canNext={runtimeState.sceneIndex < classroom.scenes.length - 1}
              volume={ttsVolume}
              muted={ttsMuted}
              speed={playbackSpeed}
              autoPlay={autoPlayLecture}
              chalkboardOpen={liveChalkboard.open}
              chalkboardHasContent={liveChalkboard.elements.length > 0}
              lockMessage={discussionLocked ? "回答进行中 · 切换页面会先征求你的确认" : undefined}
              onToggleMute={() => setTtsMuted((value) => !value)}
              onVolumeChange={(value) => { setTtsVolume(value); if (value > 0) setTtsMuted(false); }}
              onCycleSpeed={() => setPlaybackSpeed((value) => value === 0.75 ? 1 : value === 1 ? 1.25 : value === 1.25 ? 1.5 : value === 1.5 ? 2 : 0.75)}
              onPrevious={() => {
                const previousScene = classroom.scenes[runtimeState.sceneIndex - 1];
                if (previousScene) void selectScene(previousScene.id, previousScene.title);
              }}
              onPlayPause={() => {
                if (isCompleted) { void command((controller) => controller.restart()); return; }
                if (isPlaying) { void command((controller) => controller.pause()); return; }
                void command((controller) => runtimeState.mode === "paused" ? controller.resume() : controller.start());
              }}
              onNext={() => {
                const nextScene = classroom.scenes[runtimeState.sceneIndex + 1];
                if (nextScene) void selectScene(nextScene.id, nextScene.title);
              }}
              onToggleAutoPlay={() => setAutoPlayLecture((value) => {
                const next = !value;
                playbackSettingsRef.current.autoPlayLecture = next;
                return next;
              })}
              onToggleChalkboard={() => setLiveChalkboard((current) => ({ ...current, open: !current.open }))}
            /> : null}
          </section>
          {unsupportedAction || runtimeNotice ? <section className={styles.warningSection}><AlertTriangle size={15} /><span>{runtimeNotice ?? `动作 “${unsupportedAction}” 暂未接入，课堂仍可继续。`}</span><button type="button" onClick={() => { setUnsupportedAction(null); setRuntimeNotice(null); }} aria-label="关闭提示"><X size={14} /></button></section> : null}
        </div>
        </section>
        <aside className={`${styles.notesRail} ${rightPanelOpen ? "" : styles.notesRailClosed}`} aria-label="课堂侧栏">
        {rightPanelOpen ? <>
          <div className={styles.notesTabs} role="tablist" aria-label="课堂侧栏标签">
            <button className={rightPanelTab === "chat" ? styles.notesTabActive : ""} type="button" role="tab" aria-selected={rightPanelTab === "chat"} onClick={() => setRightPanelTab("chat")}><MessagesSquare size={15} />讨论</button>
            <button className={rightPanelTab === "notes" ? styles.notesTabActive : ""} type="button" role="tab" aria-selected={rightPanelTab === "notes"} onClick={() => setRightPanelTab("notes")}><BookOpen size={15} />讲义</button>
            <button className={styles.panelToggle} type="button" aria-label="收起侧栏" title="收起侧栏" onClick={() => setRightPanelOpen(false)}><PanelRightClose size={15} /></button>
          </div>
          {rightPanelTab === "notes" ? <MigratedNotesPanel scene={activeScene} actions={activeDocumentScene?.actions ?? []} activeActionIndex={runtimeState.actionIndex} onPlayFrom={(actionIndex) => void command((controller) => controller.playFrom(activeScene.id, actionIndex))} /> : <ChatPanel
            sceneIndex={sceneIndex}
            actionIndex={runtimeState.actionIndex}
            actionCount={activeScene.actionCount}
            discussion={classroomDiscussion.discussion?.topic ?? discussionContext?.topic ?? ""}
            participants={classroomDiscussion.discussion?.participants ?? classroom.participants.map((participant) => ({
              ...participant,
              role: participant.role === "teacher" ? "teacher" as const : participant.role === "assistant" ? "assistant" as const : "student" as const,
              persona: participant.persona ?? "",
            }))}
            messages={classroomDiscussion.messages}
            status={classroomDiscussion.status}
            error={classroomDiscussion.error}
            canStart={Boolean(discussionContext && classroomDiscussion.ready && !classroomDiscussion.discussion && classroomDiscussion.messages.length === 0 && classroomDiscussion.status === "idle")}
            canComplete={classroomDiscussion.discussion?.status === "active"}
            draft={discussionDraft}
            voiceStatus={voiceStatus}
            speechState={discussionSpeech.state}
            isListening={isListening}
            onDraftChange={setDiscussionDraft}
            onSend={submitDiscussion}
            onToggleVoice={toggleVoiceInput}
            onStart={() => void classroomDiscussion.startAuthored()}
            onStop={stopDiscussionRound}
            onComplete={() => void completeClassroomDiscussion()}
            onRetry={classroomDiscussion.retryRestore}
            onPauseSpeech={discussionSpeech.pause}
            onResumeSpeech={discussionSpeech.resume}
          />}
        </> : <button className={styles.panelExpand} type="button" aria-label="展开侧栏" title="展开侧栏" onClick={() => setRightPanelOpen(true)}><PanelRightOpen size={17} /></button>}
        </aside>
        {pendingSceneNavigation ? <dialog
          ref={sceneSwitchDialogRef}
          className={styles.sceneSwitchDialog}
          aria-labelledby="scene-switch-title"
          aria-describedby="scene-switch-description"
          onCancel={(event) => {
            event.preventDefault();
            cancelSceneNavigation();
          }}
        >
          <div className={styles.sceneSwitchDialogIcon} aria-hidden="true"><AlertTriangle size={21} /></div>
          <div className={styles.sceneSwitchDialogCopy}>
            <h2 id="scene-switch-title">切换到“{pendingSceneNavigation.targetLabel}”？</h2>
            <p id="scene-switch-description">当前回答仍在生成或朗读。切换将停止这一轮回答和语音；已经完成的讨论记录会保留，返回后仍可继续追问。</p>
          </div>
          <div className={styles.sceneSwitchDialogActions}>
            <button type="button" autoFocus disabled={sceneNavigationConfirming} onClick={cancelSceneNavigation}>留在当前页</button>
            <button type="button" disabled={sceneNavigationConfirming} onClick={() => void confirmSceneNavigation()}>
              {sceneNavigationConfirming ? <><LoaderCircle className={styles.importSpinner} size={14} />正在停止回答…</> : "停止并切换"}
            </button>
          </div>
        </dialog> : null}
      </div>
    </main>
  );
}
