"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CirclePlay,
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
  type AdaptedClassroom,
  type RuntimeCommandResult,
} from "@chalk/chalkboard";
import type { Action } from "@chalk/chalkboard";
import { DiscussionDock as MigratedDiscussionDock } from "../../features/chalkboard/components/discussion-dock";
import { NotesPanel as MigratedNotesPanel } from "../../features/chalkboard/components/notes-panel";
import { PlaybackControls, type PlaybackSpeed } from "../../features/chalkboard/components/playback-controls";
import { WhiteboardSurface } from "../../features/chalkboard/components/whiteboard-surface";
import { QuizScene } from "../../features/chalkboard/components/quiz-scene";
import { ChatPanel } from "../../features/chalkboard/components/chat-panel";
import { InteractiveScene } from "../../features/chalkboard/components/interactive-scene";
import { ClassroomImportControl } from "../../features/chalkboard/components/classroom-import-control";
import { ClassroomGenerationControl } from "../../features/chalkboard/components/classroom-generation-control";
import { AppSidebar, type SidebarClassroom } from "../../components/app-sidebar";
import { ApiRequestError, classroomErrorMessage, settingsApi, type BrowserSpeechSettings } from "../../api";
import { SlideCanvas as MigratedSlideCanvas } from "../../features/chalkboard/components/slide-renderer";
import { SceneRail } from "../../features/chalkboard/components/scene-rail";
import { useClassroomPresentation } from "../../features/chalkboard/hooks/use-classroom-presentation";
import {
  loadClassroomSession,
  saveClassroomCursor,
  type ServerClassroomSession,
} from "../../features/chalkboard/lib/classroom-client";
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

export default function ChalkboardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedClassroomId = searchParams.get("id");
  const [classroom, setClassroom] = useState<AdaptedClassroom | null>(null);
  const [learningSession, setLearningSession] = useState<ServerClassroomSession | null>(null);
  const [cursorSaveStatus, setCursorSaveStatus] = useState<"saved" | "saving" | "conflict" | "offline" | "unsaved">("saved");
  const [selectedClassroomId, setSelectedClassroomId] = useState<string | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
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
  const [discussion, setDiscussion] = useState("");
  const [discussionDraft, setDiscussionDraft] = useState("");
  const [discussionReply, setDiscussionReply] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [unsupportedAction, setUnsupportedAction] = useState<string | null>(null);
  const [runtimeNotice, setRuntimeNotice] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<"notes" | "chat">("notes");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [classrooms, setClassrooms] = useState<SidebarClassroom[]>([]);
  const speechInputRef = useRef<SpeechInput | null>(null);
  const playbackRef = useRef<ChalkboardPlaybackController | null>(null);
  const {
    executor: playbackExecutor,
    settingsRef: playbackSettingsRef,
    iframeRef,
    lessonViewportRef,
    highlightedElementId,
    laserElementId,
    highlightTarget,
    widgetState,
    widgetAnnotation,
    widgetRevealTarget,
    whiteboard,
    setWhiteboard,
    restorePresentation,
  } = useClassroomPresentation(
    { autoPlayLecture, playbackSpeed, speechEnabled, ttsMuted, ttsVolume, speechLanguage: speechSettings.language, speechVoiceUri: speechSettings.voiceUri, speechRate: speechSettings.rate },
    setDiscussion,
  );

  useEffect(() => {
    if (window.matchMedia("(max-width: 1180px)").matches) setRightPanelOpen(false);
    void settingsApi.capabilities().then((settings) => {
      setSpeechSettings(settings.speech);
      setTtsVolume(settings.speech.volume);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setError(null);
    setClassroom(null);
    setLearningSession(null);
    loadClassroomSession(requestedClassroomId, controller.signal)
      .then(async ({ classroom: adapted, learningSession: restoredSession, selected, classrooms: availableClassrooms }) => {
        if (cancelled) return;
        if (!requestedClassroomId) {
          router.replace(`/chalkboard?id=${encodeURIComponent(selected.id)}`);
          return;
        }
        setClassroom(adapted);
        setLearningSession(restoredSession);
        setCursorSaveStatus("saved");
        setSelectedClassroomId(selected.id);
        setClassrooms(availableClassrooms.map(({ id, title }) => ({ id, title })));
        setActiveSceneId(adapted.runtime.getState().sceneId);
        setTick((value) => value + 1);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const title = reason instanceof ApiRequestError && reason.code === "CLASSROOMS_EMPTY"
          ? "还没有课堂"
          : reason instanceof ApiRequestError && reason.status === 404
            ? "课堂没有找到"
            : reason instanceof ApiRequestError && reason.status === 403
              ? "无法打开课堂"
              : "课堂暂时无法打开";
        setError({
          title,
          message: reason instanceof DOMException && reason.name === "AbortError"
            ? "课堂服务响应超时，请重试。"
            : classroomErrorMessage(reason),
        });
        setLoading(false);
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
      speechInputRef.current?.stop();
    };
  }, [loadAttempt, requestedClassroomId, router]);

  const activeScene = useMemo(() => classroom?.scenes.find((scene) => scene.id === activeSceneId) ?? null, [activeSceneId, classroom]);
  const activeDocumentScene = classroom?.document.scenes.find((scene) => scene.id === activeSceneId);
  const runtimeState = classroom?.runtime.getState();
  const currentAction = runtimeState?.currentAction ?? null;

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
      setDiscussion(presentation.discussion);
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

  const command = useCallback(async (operation: (controller: ChalkboardPlaybackController) => Promise<RuntimeCommandResult>) => {
    const controller = playbackRef.current;
    if (!classroom || !controller || busy) return;
    setBusy(true);
    setDiscussion("");
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

  // Teaching effects are scoped to a scene. They must survive the transition
  // from spotlight/laser into the following speech action, but never leak to
  // the next page selected from the rail or by the page controls.
  useEffect(() => {
    const scene = classroom?.document.scenes.find((candidate) => candidate.id === activeSceneId);
    const restored = projectScenePresentation(scene?.actions ?? [], classroom?.runtime.getState().actionIndex ?? 0);
    setDiscussion(restored.discussion);
    restorePresentation(restored);
    setDiscussionDraft("");
    setDiscussionReply("");
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
      if (event.key === "ArrowRight") { event.preventDefault(); void command((controller) => controller.nextScene()); }
      if (event.key === "ArrowLeft") { event.preventDefault(); void command((controller) => controller.previousScene()); }
      if (event.key === " ") {
        event.preventDefault();
        void command((controller) => runtimeState?.mode === "playing" ? controller.pause() : runtimeState?.mode === "paused" ? controller.resume() : controller.start());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [classroom, command, runtimeState?.mode]);

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

  const submitDiscussion = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = discussionDraft.trim();
    if (!text) return;
    setDiscussionReply(text);
    setDiscussionDraft("");
    setVoiceStatus("已记录在本次课堂页面。");
  };

  const toggleFullscreenLabel = isFullscreen ? "退出演示模式" : "演示模式";

  const openImportedClassroom = useCallback((classroomId: string) => {
    setError(null);
    setLoadAttempt((value) => value + 1);
    router.push(`/chalkboard?id=${encodeURIComponent(classroomId)}`);
  }, [router]);

  if (loading) return <main className={styles.loadingState}><CirclePlay size={22} /><span>正在准备课堂内容…</span></main>;
  if (error || !classroom || !activeScene || !runtimeState) return <main className={styles.errorState}><AlertTriangle size={22} /><h1>{error?.title ?? "课堂暂时无法打开"}</h1><p>{error?.message ?? "没有找到可播放的课堂数据。"}</p><div className={styles.errorActions}><ClassroomGenerationControl onPublished={openImportedClassroom} /><ClassroomImportControl onImported={openImportedClassroom} /><button type="button" onClick={() => { setError(null); setLoading(true); setLoadAttempt((value) => value + 1); }}><RotateCcw size={15} />重试</button><Link href="/chat"><ArrowLeft size={15} />回到 Chat</Link></div></main>;

  const sceneIndex = classroom.scenes.findIndex((scene) => scene.id === activeScene.id);
  const isPlaying = runtimeState.mode === "playing";
  const isCompleted = runtimeState.completed;
  const playbackStatus = isCompleted ? "课程已完成" : isPlaying ? "正在播放" : runtimeState.mode === "paused" ? "已暂停" : "准备就绪";
  const cursorStatus = cursorSaveStatus === "saving" ? "正在保存进度…"
    : cursorSaveStatus === "conflict" ? "已恢复较新进度"
      : cursorSaveStatus === "offline" ? "离线 · 进度未保存"
        : cursorSaveStatus === "unsaved" ? "进度未保存"
          : "进度已保存";

  return (
    <main className={styles.page}>
      <AppSidebar activeSection="chalkboard" historyMode="chalkboard" chalkboards={classrooms} selectedChalkboardId={selectedClassroomId ?? undefined} />
      <div className={`${styles.chalkboardWorkspace} ${rightPanelOpen ? "" : styles.pagePanelClosed}`}>
        <SceneRail scenes={classroom.scenes} activeId={activeScene.id} onSelect={(scene) => void command((controller) => controller.selectScene(scene.id))} />
        <section className={styles.classroom}>
        <header className={styles.topBar}>
          <div className={styles.courseHeading}><span>CHALKBOARD / PLAYBACK</span><h1>{classroom.document.stage.name}</h1></div>
          <div className={styles.topTools}>
            <ClassroomGenerationControl compact onPublished={openImportedClassroom} />
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
            <div className={styles.lessonMeta}><span>第 {sceneIndex + 1} / {classroom.scenes.length} 节</span><strong>{activeScene.title}</strong><span>{actionLabel(currentAction, isCompleted, runtimeState.actionIndex >= activeScene.actionCount)}</span></div>
            <div ref={lessonViewportRef} className={styles.lessonViewport}>
              {activeScene.type === "slide" ? <MigratedSlideCanvas scene={activeScene} highlightedElementId={highlightedElementId} laserElementId={laserElementId} /> : null}
              {activeScene.type === "interactive" ? <InteractiveScene scene={activeScene} iframeRef={iframeRef} highlightTarget={highlightTarget} widgetState={widgetState} widgetAnnotation={widgetAnnotation} widgetRevealTarget={widgetRevealTarget} /> : null}
              {activeScene.type === "quiz" && learningSession ? <QuizScene
                key={activeScene.id}
                scene={activeScene}
                attempt={learningSession.quizAttempt(activeScene.id)}
                onSubmit={(answers) => learningSession.saveQuizAttempt(activeScene.id, answers)}
              /> : null}
              {activeScene.type === "pbl" ? <div className={styles.sceneEmpty}><AlertTriangle size={22} /><strong>项目式课堂暂未接入</strong><span>当前版本不会静默跳过这类场景，请返回上一页继续学习。</span></div> : null}
              {whiteboard.open ? <WhiteboardSurface elements={whiteboard.elements} onClose={() => setWhiteboard((current) => ({ ...current, open: false }))} /> : null}
            </div>
            <PlaybackControls
              isPlaying={isPlaying}
              busy={busy}
              canPrevious={runtimeState.sceneIndex > 0}
              canNext={runtimeState.sceneIndex < classroom.scenes.length - 1}
              volume={ttsVolume}
              muted={ttsMuted}
              speed={playbackSpeed}
              autoPlay={autoPlayLecture}
              onToggleMute={() => setTtsMuted((value) => !value)}
              onVolumeChange={(value) => { setTtsVolume(value); if (value > 0) setTtsMuted(false); }}
              onCycleSpeed={() => setPlaybackSpeed((value) => value === 0.75 ? 1 : value === 1 ? 1.25 : value === 1.25 ? 1.5 : value === 1.5 ? 2 : 0.75)}
              onPrevious={() => void command((controller) => controller.previousScene())}
              onPlayPause={() => {
                if (isCompleted) { void command((controller) => controller.restart()); return; }
                if (isPlaying) { void command((controller) => controller.pause()); return; }
                void command((controller) => runtimeState.mode === "paused" ? controller.resume() : controller.start());
              }}
              onNext={() => void command((controller) => controller.nextScene())}
              onToggleAutoPlay={() => setAutoPlayLecture((value) => {
                const next = !value;
                playbackSettingsRef.current.autoPlayLecture = next;
                return next;
              })}
            />
          </section>
          <MigratedDiscussionDock
            sceneIndex={sceneIndex}
            actionIndex={runtimeState.actionIndex}
            actionCount={activeScene.actionCount}
            discussion={discussion}
            draft={discussionDraft}
            reply={discussionReply}
            voiceStatus={voiceStatus}
            isListening={isListening}
            participants={[
              ...classroom.participants,
              { id: "user", name: "我", role: "user" as const },
            ]}
            onDraftChange={setDiscussionDraft}
            onSubmit={submitDiscussion}
            onToggleVoice={toggleVoiceInput}
            onOpenChat={() => { setRightPanelOpen(true); setRightPanelTab("chat"); }}
          />
          {unsupportedAction || runtimeNotice ? <section className={styles.warningSection}><AlertTriangle size={15} /><span>{runtimeNotice ?? `动作 “${unsupportedAction}” 暂未接入，课堂仍可继续。`}</span><button type="button" onClick={() => { setUnsupportedAction(null); setRuntimeNotice(null); }} aria-label="关闭提示"><X size={14} /></button></section> : null}
        </div>
        </section>
        <aside className={`${styles.notesRail} ${rightPanelOpen ? "" : styles.notesRailClosed}`} aria-label="课堂侧栏">
        {rightPanelOpen ? <>
          <div className={styles.notesTabs} role="tablist" aria-label="课堂侧栏标签">
            <button className={rightPanelTab === "notes" ? styles.notesTabActive : ""} type="button" role="tab" aria-selected={rightPanelTab === "notes"} onClick={() => setRightPanelTab("notes")}><BookOpen size={15} />Notes</button>
            <button className={rightPanelTab === "chat" ? styles.notesTabActive : ""} type="button" role="tab" aria-selected={rightPanelTab === "chat"} onClick={() => setRightPanelTab("chat")}><MessagesSquare size={15} />Chat</button>
            <button className={styles.panelToggle} type="button" aria-label="收起侧栏" title="收起侧栏" onClick={() => setRightPanelOpen(false)}><PanelRightClose size={15} /></button>
          </div>
          {rightPanelTab === "notes" ? <MigratedNotesPanel scene={activeScene} actions={activeDocumentScene?.actions ?? []} activeActionIndex={runtimeState.actionIndex} onPlayFrom={(actionIndex) => void command((controller) => controller.playFrom(activeScene.id, actionIndex))} /> : <ChatPanel key={classroom.document.stage.id} discussion={discussion} />}
        </> : <button className={styles.panelExpand} type="button" aria-label="展开侧栏" title="展开侧栏" onClick={() => setRightPanelOpen(true)}><PanelRightOpen size={17} /></button>}
        </aside>
      </div>
    </main>
  );
}
