"use client";

import Link from "next/link";
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
  projectScenePresentation,
  type RuntimeCommandResult,
} from "@chalk/chalkboard";
import type { Action } from "@chalk/chalkboard";
import { NotesPanel as MigratedNotesPanel } from "./notes-panel";
import { PlaybackControls, type PlaybackSpeed } from "./playback-controls";
import { LiveChalkboardSurface } from "./live-chalkboard-surface";
import { QuizScene } from "./quiz-scene";
import { ChatPanel } from "./chat-panel";
import { InteractiveScene } from "./interactive-scene";
import { ClassroomImportControl } from "./classroom-import-control";
import { ClassroomGenerationControl } from "./classroom-generation-control";
import { AppSidebar } from "../../../components/app-sidebar";
import {
  classroomGenerationApi,
  classroomGenerationErrorMessage,
  settingsApi,
  type BrowserSpeechSettings,
  type ClassroomGenerationRun,
} from "../../../api";
import { SlideCanvas as MigratedSlideCanvas } from "./slide-renderer";
import { SceneRail } from "./scene-rail";
import { useClassroomPresentation } from "../hooks/use-classroom-presentation";
import { useClassroomWorkspace } from "../hooks/use-classroom-workspace";
import { useClassroomRuntime, type DiscussionContext } from "../hooks/use-classroom-runtime";
import { useClassroomDiscussionBridge } from "../hooks/use-classroom-discussion-bridge";
import { useSceneNavigation } from "../hooks/use-scene-navigation";
import { draftSceneSlots, type DraftSceneSlot } from "../lib/draft-classroom";
import styles from "../chalkboard.module.css";

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

export function ChalkboardWorkspace({
  requestedClassroomId,
  requestedDraftRunId,
}: {
  requestedClassroomId: string | null;
  requestedDraftRunId: string | null;
}) {
  const [generationBusy, setGenerationBusy] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [ttsVolume, setTtsVolume] = useState(1);
  const [ttsMuted, setTtsMuted] = useState(false);
  const [speechSettings, setSpeechSettings] = useState<BrowserSpeechSettings>({ adapter: "browser", language: "zh-CN", voiceUri: null, rate: 0.95, volume: 1 });
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [autoPlayLecture, setAutoPlayLecture] = useState(false);
  const [discussionContext, setDiscussionContext] = useState<DiscussionContext | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<"notes" | "chat">("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const playbackRef = useRef<ChalkboardPlaybackController | null>(null);
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
  const {
    state: {
      classroom,
      learningSession,
      generationRun,
      cursorSaveStatus,
      selectedClassroomId,
      loading,
      error,
      classrooms,
    },
    actions: {
      setCursorSaveStatus,
      reload: reloadWorkspace,
      openClassroom,
    },
  } = useClassroomWorkspace({
    requestedClassroomId,
    requestedDraftRunId,
    presentationBusyRef: speechBusyRef,
  });
  const {
    state: {
      activeSceneId,
      runtimeState,
      busy: runtimeBusy,
      unsupportedAction,
      notice: runtimeNotice,
    },
    actions: {
      run: runCommand,
      persist,
      sync: syncRuntime,
      notify: setRuntimeNotice,
      clearWarning,
    },
  } = useClassroomRuntime({
    classroom,
    learningSession,
    executor: playbackExecutor,
    playbackSettingsRef,
    restorePresentation,
    setCursorSaveStatus,
    setDiscussionContext,
    controllerRef: playbackRef,
  });
  const busy = runtimeBusy || generationBusy;

  useEffect(() => {
    if (window.matchMedia("(max-width: 1180px)").matches) setRightPanelOpen(false);
    void settingsApi.capabilities().then((settings) => {
      setSpeechSettings(settings.speech);
      setTtsVolume(settings.speech.volume);
    }).catch(() => undefined);
  }, []);

  const activeScene = useMemo(
    () => classroom?.scenes.find((scene) => scene.id === activeSceneId) ?? null,
    [activeSceneId, classroom],
  );
  const activeDocumentScene = classroom?.document.scenes.find((scene) => scene.id === activeSceneId);
  const currentAction = runtimeState?.currentAction ?? null;
  const discussionBridge = useClassroomDiscussionBridge({
    classroom,
    learningSession,
    activeScene,
    activeSceneId,
    context: discussionContext,
    setContext: setDiscussionContext,
    speechEnabled,
    ttsMuted,
    ttsVolume,
    speechSettings,
    playbackSpeed,
    playbackMode: runtimeState?.mode ?? null,
    controllerRef: playbackRef,
    playbackExecutor,
    setLiveChalkboard,
    restorePresentation,
    syncRuntime,
    persist,
    notify: setRuntimeNotice,
  });
  const classroomDiscussion = discussionBridge.discussion;
  const discussionSpeech = discussionBridge.speech;
  const discussionLocked = discussionBridge.state.locked;
  const discussionDraft = discussionBridge.state.draft;
  const voiceStatus = discussionBridge.state.voiceStatus;
  const isListening = discussionBridge.state.isListening;
  const {
    state: {
      selectedPendingSceneId,
      pendingNavigation: pendingSceneNavigation,
      confirming: sceneNavigationConfirming,
    },
    dialogRef: sceneSwitchDialogRef,
    actions: {
      selectScene,
      selectDraftSlot,
      cancel: cancelSceneNavigation,
      confirm: confirmSceneNavigation,
    },
  } = useSceneNavigation({
    classroom,
    busy,
    discussionLocked,
    controllerRef: playbackRef,
    runCommand,
    stopDiscussion: classroomDiscussion.stop,
    interruptDiscussionSpeech: discussionSpeech.interrupt,
    notify: setRuntimeNotice,
  });
  const command = useCallback(async (operation: (controller: ChalkboardPlaybackController) => Promise<RuntimeCommandResult>) => {
    if (discussionLocked) {
      setRuntimeNotice("当前回答仍在生成或朗读。可以切换 Scene，继续播放课件前请先停止这一轮讨论。");
      setRightPanelOpen(true);
      setRightPanelTab("chat");
      return;
    }
    await runCommand(operation);
  }, [discussionLocked, runCommand, setRuntimeNotice]);

  // Teaching effects are scoped to a scene. They must survive the transition
  // from spotlight/laser into the following speech action, but never leak to
  // the next page selected from the rail or by the page controls.
  useEffect(() => {
    const scene = classroom?.document.scenes.find((candidate) => candidate.id === activeSceneId);
    const restored = projectScenePresentation(scene?.actions ?? [], classroom?.runtime.getState().actionIndex ?? 0);
    setDiscussionContext(restored.discussion ? { topic: restored.discussion } : null);
    restorePresentation(restored);
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
      discussionBridge.actions.setVoiceStatus("当前浏览器不允许进入演示模式。");
    }
  };

  const toggleFullscreenLabel = isFullscreen ? "退出演示模式" : "演示模式";

  const retryGenerationScene = useCallback(async () => {
    if (!generationRun || busy) return;
    setGenerationBusy(true);
    setRuntimeNotice(null);
    try {
      await classroomGenerationApi.retry(generationRun.id);
      reloadWorkspace();
    } catch (reason) {
      setRuntimeNotice(classroomGenerationErrorMessage(reason));
    } finally {
      setGenerationBusy(false);
    }
  }, [busy, generationRun, reloadWorkspace, setRuntimeNotice]);

  const publishDraft = useCallback(async () => {
    if (!generationRun?.publishReady || busy) return;
    setGenerationBusy(true);
    setRuntimeNotice(null);
    try {
      const result = await classroomGenerationApi.publish(generationRun.id);
      openClassroom(result.classroom.id);
    } catch (reason) {
      setRuntimeNotice(classroomGenerationErrorMessage(reason));
    } finally {
      setGenerationBusy(false);
    }
  }, [busy, generationRun, openClassroom, setRuntimeNotice]);

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
          <ClassroomGenerationControl compact onCreated={openClassroom} onPublished={openClassroom} />
          <ClassroomImportControl compact onImported={openClassroom} />
        </div>
      </header>
      <div className={styles.generationWorkspaceBody}>
        <ClassroomGenerationControl
          embedded
          resumeRunId={generationRun.id}
          onPublished={openClassroom}
          onPreviewReady={reloadWorkspace}
        />
      </div>
    </section>
  </main>;
  if (error || !classroom || !activeScene || !runtimeState) return <main className={styles.errorState}><AlertTriangle size={22} /><h1>{error?.title ?? "课堂暂时无法打开"}</h1><p>{error?.message ?? "没有找到可播放的课堂数据。"}</p><div className={styles.errorActions}><ClassroomGenerationControl onCreated={openClassroom} onPublished={openClassroom} /><ClassroomImportControl onImported={openClassroom} /><button type="button" onClick={reloadWorkspace}><RotateCcw size={15} />重试</button><Link href="/chat"><ArrowLeft size={15} />回到 Chat</Link></div></main>;

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
            <ClassroomGenerationControl compact onCreated={openClassroom} onPublished={openClassroom} />
            <ClassroomImportControl compact onImported={openClassroom} />
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
          {unsupportedAction || runtimeNotice ? <section className={styles.warningSection}><AlertTriangle size={15} /><span>{runtimeNotice ?? `动作 “${unsupportedAction}” 暂未接入，课堂仍可继续。`}</span><button type="button" onClick={clearWarning} aria-label="关闭提示"><X size={14} /></button></section> : null}
        </div>
        </section>
        <aside className={`${styles.notesRail} ${rightPanelOpen ? "" : styles.notesRailClosed}`} aria-label="课堂侧栏">
        {rightPanelOpen ? <>
          <div className={styles.notesTabs}>
            <div className={styles.notesTabList} role="tablist" aria-label="课堂侧栏标签">
              <button className={rightPanelTab === "chat" ? styles.notesTabActive : ""} type="button" role="tab" aria-selected={rightPanelTab === "chat"} onClick={() => setRightPanelTab("chat")}><MessagesSquare size={15} />讨论</button>
              <button className={rightPanelTab === "notes" ? styles.notesTabActive : ""} type="button" role="tab" aria-selected={rightPanelTab === "notes"} onClick={() => setRightPanelTab("notes")}><BookOpen size={15} />讲义</button>
            </div>
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
            onDraftChange={discussionBridge.actions.setDraft}
            onSend={discussionBridge.actions.submit}
            onToggleVoice={discussionBridge.actions.toggleVoice}
            onStart={() => void classroomDiscussion.startAuthored()}
            onStop={discussionBridge.actions.stop}
            onComplete={() => void discussionBridge.actions.complete()}
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
