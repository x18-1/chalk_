"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CirclePlay,
  Eye,
  FileQuestion,
  ListVideo,
  MessagesSquare,
  Monitor,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import {
  adaptOpenMaicClassroomResponse,
  ChalkboardPlaybackController,
  loadCursorSnapshot,
  saveCursorSnapshot,
  type PlaybackExecutor,
  type AdaptedClassroom,
  type CursorSnapshotStore,
  type SceneView,
} from "@chalk/chalkboard";
import type { Action } from "@chalk/chalkboard";
import { DiscussionDock as MigratedDiscussionDock } from "../../features/chalkboard/components/discussion-dock";
import { NotesPanel as MigratedNotesPanel } from "../../features/chalkboard/components/notes-panel";
import { PlaybackControls, type PlaybackSpeed } from "../../features/chalkboard/components/playback-controls";
import { WhiteboardSurface } from "../../features/chalkboard/components/whiteboard-surface";
import { QuizScene } from "../../features/chalkboard/components/quiz-scene";
import { ChatPanel } from "../../features/chalkboard/components/chat-panel";
import { InteractiveScene } from "../../features/chalkboard/components/interactive-scene";
import { patchInteractiveHtml } from "../../features/chalkboard/lib/interactive-html";
import { loadChalkboardHistory, upsertChalkboardHistory, type ChalkboardHistoryItem } from "../../features/chalkboard/lib/history";
import { AppSidebar } from "../../components/app-sidebar";
import { SlideCanvas as MigratedSlideCanvas } from "../../features/chalkboard/components/slide-renderer";
import styles from "./chalkboard.module.css";

const DEFAULT_CLASSROOM_ID = "4DuyVUkWv3";

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

function makeCursorStore(stageId: string): CursorSnapshotStore {
  const key = `chalkboard:cursor:${stageId}`;
  return {
    async load() {
      if (typeof window === "undefined") return null;
      const value = window.localStorage.getItem(key);
      if (!value) return null;
      try {
        return JSON.parse(value);
      } catch {
        window.localStorage.removeItem(key);
        return null;
      }
    },
    async save(_id, snapshot) {
      window.localStorage.setItem(key, JSON.stringify(snapshot));
    },
    async clear() {
      window.localStorage.removeItem(key);
    },
  };
}

function sceneIcon(type: SceneView["type"]) {
  if (type === "interactive") return Eye;
  if (type === "quiz") return FileQuestion;
  return ListVideo;
}

function QuizThumbnail() {
  return (
    <div className={styles.sceneQuizThumbnail} aria-label="知识检查缩略图">
      <div className={styles.quizCoverGlow} aria-hidden="true" />
      <div className={styles.quizCoverIcon}><FileQuestion size={18} /></div>
      <span className={styles.quizCoverKicker}>CHECKPOINT</span>
      <strong className={styles.quizCoverTitle}>知识检查</strong>
      <span className={styles.quizCoverSubtitle}>课堂小测验</span>
    </div>
  );
}

function InteractiveThumbnail({ scene }: { scene: SceneView }) {
  const html = typeof scene.content.html === "string" ? scene.content.html : "";
  const url = typeof scene.content.url === "string" && scene.content.url ? scene.content.url : undefined;
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.18);
  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const update = () => {
      if (node.clientWidth > 0) setScale(node.clientWidth / 1000);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const patchedHtml = html ? patchInteractiveHtml(html) : undefined;
  if (!html && !url) {
    return <div className={styles.sceneInteractiveFallback}><Eye size={18} /><span>互动探索</span></div>;
  }
  return (
    <div ref={frameRef} className={styles.sceneInteractiveThumbnail} aria-label={`${scene.title} 缩略图`}>
      <div className={styles.sceneInteractiveFrame} style={{ width: 1000, height: 562.5, transform: `scale(${scale})` }}>
        <iframe
          title={`${scene.title} 缩略图`}
          src={patchedHtml ? undefined : url}
          srcDoc={patchedHtml}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>
      <div className={styles.sceneInteractiveShade} aria-hidden="true"><span>互动探索</span><Eye size={13} /></div>
    </div>
  );
}

function SceneThumbnail({ scene }: { scene: SceneView }) {
  if (scene.type === "slide") return <MigratedSlideCanvas scene={scene} highlightedElementId={null} thumbnail />;
  if (scene.type === "interactive") return <InteractiveThumbnail scene={scene} />;
  if (scene.type === "quiz") return <QuizThumbnail />;
  const Icon = sceneIcon(scene.type);
  return <div className={styles.sceneInteractiveFallback}><Icon size={18} /><span>{scene.title}</span></div>;
}

function actionLabel(action: Action | null): string {
  if (!action) return "课程已完成";
  if (action.type === "speech") return "教师讲解";
  if (action.type === "spotlight") return "聚焦课件元素";
  if (action.type === "discussion") return "课堂提问";
  if (action.type === "widget_highlight") return "互动提示";
  return `动作：${action.type}`;
}

function SceneRail({
  scenes,
  activeId,
  onSelect,
}: {
  scenes: readonly SceneView[];
  activeId: string | null;
  onSelect: (scene: SceneView) => void;
}) {
  return (
    <aside className={styles.sceneRail} aria-label="课程场景">
      <div className={styles.sceneRailBrand}>
        <span className={styles.sceneRailContext}>本课堂</span>
        <button className={styles.iconButton} type="button" aria-label="回到 Chat" title="回到 Chat" onClick={() => { window.location.href = "/chat" }}>
          <ArrowLeft size={15} />
        </button>
      </div>
      <div className={styles.sceneRailHeader}>
        <span>课程场景</span>
        <strong>{scenes.length} 页</strong>
      </div>
      <div className={styles.sceneList}>
        {scenes.map((scene, index) => {
          return (
            <button
              className={`${styles.sceneItem} ${scene.id === activeId ? styles.sceneItemActive : ""}`}
              key={scene.id}
              onClick={() => onSelect(scene)}
              type="button"
              aria-current={scene.id === activeId ? "page" : undefined}
            >
              <div className={styles.sceneThumbnail}>
                <SceneThumbnail scene={scene} />
                <span className={styles.sceneThumbnailNumber}>{index + 1}</span>
              </div>
              <div className={styles.sceneItemTopline}>
                <span className={styles.sceneNumber}>{String(index + 1).padStart(2, "0")}</span>
                <span>{scene.actionCount} 个动作</span>
              </div>
              <span className={styles.sceneItemTitle}>{scene.title}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export default function ChalkboardPage() {
  const searchParams = useSearchParams();
  const classroomId = searchParams.get("id") ?? DEFAULT_CLASSROOM_ID;
  const [classroom, setClassroom] = useState<AdaptedClassroom | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [ttsVolume, setTtsVolume] = useState(1);
  const [ttsMuted, setTtsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [autoPlayLecture, setAutoPlayLecture] = useState(false);
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [discussion, setDiscussion] = useState("");
  const [discussionDraft, setDiscussionDraft] = useState("");
  const [discussionReply, setDiscussionReply] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
  const [laserElementId, setLaserElementId] = useState<string | null>(null);
  const [highlightTarget, setHighlightTarget] = useState<string | null>(null);
  const [widgetState, setWidgetState] = useState<Record<string, unknown> | null>(null);
  const [widgetAnnotation, setWidgetAnnotation] = useState<{ target: string; content?: string } | null>(null);
  const [widgetRevealTarget, setWidgetRevealTarget] = useState<string | null>(null);
  const [unsupportedAction, setUnsupportedAction] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<"notes" | "chat">("notes");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chalkboardHistory, setChalkboardHistory] = useState<ChalkboardHistoryItem[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechResolveRef = useRef<(() => void) | null>(null);
  const speechTimerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lessonViewportRef = useRef<HTMLDivElement>(null);
  const videoResolveRef = useRef<(() => void) | null>(null);
  const videoTimerRef = useRef<number | null>(null);
  const effectTimerRef = useRef<number | null>(null);
  const playbackSettingsRef = useRef({ playbackSpeed, speechEnabled, ttsMuted, ttsVolume });
  const speechInputRef = useRef<SpeechInput | null>(null);
  const playbackRef = useRef<ChalkboardPlaybackController | null>(null);

  useEffect(() => {
    playbackSettingsRef.current = { playbackSpeed, speechEnabled, ttsMuted, ttsVolume };
    const video = videoRef.current;
    if (video) {
      video.playbackRate = playbackSpeed;
      video.volume = ttsMuted ? 0 : ttsVolume;
      if (!ttsMuted && ttsVolume > 0 && video.dataset.chalkboardAutoplayMuted === "true") {
        video.muted = false;
        delete video.dataset.chalkboardAutoplayMuted;
      }
    }
  }, [playbackSpeed, speechEnabled, ttsMuted, ttsVolume]);

  useEffect(() => {
    setChalkboardHistory(loadChalkboardHistory());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setError(null);
    setClassroom(null);
    fetch(`/api/openmaic/classroom?id=${encodeURIComponent(classroomId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { success?: boolean; error?: string } | null;
        if (!response.ok || body?.success !== true) throw new Error(body?.error ?? "课堂加载失败");
        return adaptOpenMaicClassroomResponse(body);
      })
      .then(async (adapted) => {
        if (cancelled) return;
        setClassroom(adapted);
        const snapshot = await loadCursorSnapshot(adapted.document.stage.id, makeCursorStore(adapted.document.stage.id));
        if (snapshot) adapted.runtime.restore(snapshot);
        setChalkboardHistory(upsertChalkboardHistory({
          id: adapted.document.stage.id,
          title: adapted.document.stage.name,
          sceneId: adapted.runtime.getState().sceneId ?? undefined,
          lastOpenedAt: Date.now(),
        }));
        setActiveSceneId(adapted.runtime.getState().sceneId);
        setTick((value) => value + 1);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof DOMException && reason.name === "AbortError" ? "课堂服务响应超时，请重试。" : reason instanceof Error ? reason.message : "课堂加载失败");
        setLoading(false);
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
      if (speechRef.current) window.speechSynthesis?.cancel();
      speechInputRef.current?.stop();
    };
  }, [classroomId, loadAttempt]);

  const activeScene = useMemo(() => classroom?.scenes.find((scene) => scene.id === activeSceneId) ?? null, [activeSceneId, classroom]);
  const activeDocumentScene = classroom?.document.scenes.find((scene) => scene.id === activeSceneId);
  const runtimeState = classroom?.runtime.getState();
  const currentAction = runtimeState?.currentAction ?? null;

  const persist = useCallback(async () => {
    if (!classroom) return;
    await saveCursorSnapshot(classroom.runtime.getSnapshot(), makeCursorStore(classroom.document.stage.id));
  }, [classroom]);

  const playbackExecutor = useMemo<PlaybackExecutor>(() => ({
    speak: (text) => {
      const settings = playbackSettingsRef.current;
      if (!settings.speechEnabled || settings.ttsMuted || settings.ttsVolume === 0 || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      return new Promise<void>((resolve) => {
        const startedAt = performance.now();
        // Chrome can report `onend` immediately when its selected voice is
        // unavailable (and headless Chromium does this consistently). Do not
        // let that browser quirk advance the authored action queue halfway
        // through a sentence. The lower bound follows a calm Chinese lecture
        // pace; a real `onend` still finishes earlier when it is trustworthy.
        const minimumDuration = Math.max(900, Math.min(60_000, (text.length * 220) / settings.playbackSpeed));
        const finish = () => {
          if (speechTimerRef.current !== null) window.clearTimeout(speechTimerRef.current);
          speechTimerRef.current = null;
          speechResolveRef.current = null;
          resolve();
        };
        const finishAfterMinimum = () => {
          const remaining = minimumDuration - (performance.now() - startedAt);
          if (remaining > 0) {
            speechTimerRef.current = window.setTimeout(finishAfterMinimum, remaining);
          } else {
            finish();
          }
        };
        speechResolveRef.current = finish;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "zh-CN";
        utterance.rate = 0.95 * settings.playbackSpeed;
        utterance.volume = settings.ttsVolume;
        utterance.onend = finishAfterMinimum;
        utterance.onerror = finishAfterMinimum;
        speechRef.current = utterance;
        // Headless browsers and some system voices do not dispatch onend.
        // Browser voices do not always dispatch `onend`. Keep a generous
        // fallback so a long authored speech cannot be cut into the next
        // action; normal voices finish through `onend` first.
        speechTimerRef.current = window.setTimeout(finish, minimumDuration + 3_000);
        window.speechSynthesis.speak(utterance);
      });
    },
    spotlight: (elementId) => {
      if (effectTimerRef.current !== null) window.clearTimeout(effectTimerRef.current);
      setHighlightedElementId(elementId);
      setLaserElementId(null);
      setHighlightTarget(null);
      effectTimerRef.current = window.setTimeout(() => {
        setHighlightedElementId(null);
        effectTimerRef.current = null;
      }, 5_000);
    },
    laser: (elementId) => {
      if (effectTimerRef.current !== null) window.clearTimeout(effectTimerRef.current);
      setLaserElementId(elementId);
      setHighlightedElementId(null);
      setHighlightTarget(null);
      effectTimerRef.current = window.setTimeout(() => {
        setLaserElementId(null);
        effectTimerRef.current = null;
      }, 5_000);
    },
    playVideo: async (elementId) => {
      setHighlightedElementId(elementId);
      // Scene thumbnails also render authored videos. Resolve the action only
      // against the active lesson viewport so the hidden rail copy cannot be
      // played instead of the video the student is looking at.
      const findVideo = () => Array.from(lessonViewportRef.current?.querySelectorAll<HTMLVideoElement>("[data-video-element]") ?? [])
        .find((candidate) => candidate.dataset.elementId === elementId) ?? null;
      const video = await new Promise<HTMLVideoElement | null>((resolve) => {
        const immediate = findVideo();
        if (immediate) {
          resolve(immediate);
          return;
        }
        const startedAt = performance.now();
        const check = () => {
          const mounted = findVideo();
          if (mounted || performance.now() - startedAt >= 1_000) {
            resolve(mounted);
            return;
          }
          window.setTimeout(check, 16);
        };
        window.setTimeout(check, 0);
      });
      if (!video) return;
      videoRef.current = video;
      video.currentTime = 0;
      const settings = playbackSettingsRef.current;
      video.playbackRate = settings.playbackSpeed;
      video.volume = settings.ttsMuted ? 0 : settings.ttsVolume;
      return new Promise<void>((resolve) => {
        const finish = () => {
          video.removeEventListener("ended", finish);
          video.removeEventListener("error", finish);
          if (videoTimerRef.current !== null) window.clearTimeout(videoTimerRef.current);
          videoTimerRef.current = null;
          videoResolveRef.current = null;
          videoRef.current = null;
          resolve();
        };
        videoResolveRef.current = finish;
        video.addEventListener("ended", finish, { once: true });
        video.addEventListener("error", finish, { once: true });
        // A broken or metadata-less media asset must not wedge the lecture.
        videoTimerRef.current = window.setTimeout(finish, 60_000);
        void video.play().catch(() => {
          // The authored action runs after speech, so it is commonly outside
          // the browser's user-activation window. Retry muted so the visual
          // lesson still plays; a later volume change can restore sound.
          video.muted = true;
          video.dataset.chalkboardAutoplayMuted = "true";
          void video.play().catch(finish);
        });
      });
    },
    discussion: ({ topic }) => { setDiscussion(topic); },
    widgetHighlight: ({ target, content }) => {
      setHighlightTarget(target);
      iframeRef.current?.contentWindow?.postMessage({ type: "HIGHLIGHT_ELEMENT", target, content }, "*");
    },
    widgetSetState: ({ state, content }) => {
      setWidgetState(state);
      iframeRef.current?.contentWindow?.postMessage({ type: "SET_WIDGET_STATE", state, content }, "*");
    },
    widgetAnnotation: ({ target, content }) => {
      setWidgetAnnotation({ target, ...(content ? { content } : {}) });
      iframeRef.current?.contentWindow?.postMessage({ type: "ANNOTATE_ELEMENT", target, content }, "*");
    },
    widgetReveal: ({ target, content }) => {
      setWidgetRevealTarget(target);
      iframeRef.current?.contentWindow?.postMessage({ type: "REVEAL_ELEMENT", target, content }, "*");
    },
    cancel: () => {
      speechResolveRef.current?.();
      window.speechSynthesis?.cancel();
      videoResolveRef.current?.();
      videoRef.current?.pause();
      if (effectTimerRef.current !== null) window.clearTimeout(effectTimerRef.current);
      effectTimerRef.current = null;
    },
    pause: () => { window.speechSynthesis?.pause(); videoRef.current?.pause(); },
    resume: () => {
      window.speechSynthesis?.resume();
      const video = videoRef.current;
      if (!video) return;
      void video.play().catch(() => {
        video.muted = true;
        video.dataset.chalkboardAutoplayMuted = "true";
        void video.play().catch(() => undefined);
      });
    },
  }), []);

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
    });
    playbackRef.current = controller;
    const unsubscribe = controller.subscribe((state) => {
      setActiveSceneId(state.sceneId);
      setTick((value) => value + 1);
    });
    return () => {
      unsubscribe();
      if (playbackRef.current === controller) playbackRef.current = null;
      void controller.dispose();
    };
  }, [classroom, persist, playbackExecutor]);

  const command = useCallback(async (operation: (controller: ChalkboardPlaybackController) => Promise<{ ok: boolean }>) => {
    const controller = playbackRef.current;
    if (!classroom || !controller || busy) return;
    setBusy(true);
    setDiscussion("");
    setVoiceStatus("");
    setUnsupportedAction(null);
    try {
      const result = await operation(controller);
      if (!result.ok) return;
      setActiveSceneId(classroom.runtime.getState().sceneId);
      setTick((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }, [busy, classroom]);

  useEffect(() => {
    if (!autoPlayLecture || !classroom || !runtimeState || runtimeState.mode !== "completed") return;
    const sceneIndex = runtimeState.sceneIndex;
    if (sceneIndex >= classroom.scenes.length - 1) return;
    const timer = window.setTimeout(() => {
      void command((controller) => controller.jump(classroom.scenes[sceneIndex + 1]!.id));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [autoPlayLecture, classroom, command, runtimeState]);

  // Teaching effects are scoped to a scene. They must survive the transition
  // from spotlight/laser into the following speech action, but never leak to
  // the next page selected from the rail or by the page controls.
  useEffect(() => {
    setDiscussion("");
    if (effectTimerRef.current !== null) window.clearTimeout(effectTimerRef.current);
    effectTimerRef.current = null;
    setHighlightedElementId(null);
    setLaserElementId(null);
    setHighlightTarget(null);
    setWidgetState(null);
    setWidgetAnnotation(null);
    setWidgetRevealTarget(null);
    if (classroom && activeSceneId) {
      setChalkboardHistory(upsertChalkboardHistory({
        id: classroom.document.stage.id,
        title: classroom.document.stage.name,
        sceneId: activeSceneId,
        lastOpenedAt: Date.now(),
      }));
    }
  }, [activeSceneId, classroom]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
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

  if (loading) return <main className={styles.loadingState}><CirclePlay size={22} /><span>正在准备课堂内容…</span></main>;
  if (error || !classroom || !activeScene || !runtimeState) return <main className={styles.errorState}><AlertTriangle size={22} /><h1>课堂暂时无法打开</h1><p>{error ?? "没有找到可播放的课堂数据。"}</p><div className={styles.errorActions}><button type="button" onClick={() => { setError(null); setLoading(true); setLoadAttempt((value) => value + 1); }}><RotateCcw size={15} />重试</button><Link href="/chat"><ArrowLeft size={15} />回到 Chat</Link></div></main>;

  const sceneIndex = classroom.scenes.findIndex((scene) => scene.id === activeScene.id);
  const isPlaying = runtimeState.mode === "playing";
  const isCompleted = runtimeState.completed;
  const playbackStatus = isCompleted ? "课程已完成" : isPlaying ? "正在播放" : runtimeState.mode === "paused" ? "已暂停" : "准备就绪";

  return (
    <main className={styles.page}>
      <AppSidebar activeSection="chalkboard" historyMode="chalkboard" chalkboards={chalkboardHistory} selectedChalkboardId={classroom.document.stage.id} />
      <div className={`${styles.chalkboardWorkspace} ${rightPanelOpen ? "" : styles.pagePanelClosed}`}>
        <SceneRail scenes={classroom.scenes} activeId={activeScene.id} onSelect={(scene) => void command((controller) => controller.selectScene(scene.id))} />
        <section className={styles.classroom}>
        <header className={styles.topBar}>
          <div className={styles.courseHeading}><span>CHALKBOARD / PLAYBACK</span><h1>{classroom.document.stage.name}</h1></div>
          <div className={styles.topTools}>
            <span className={styles.languageSwitch}>中</span>
            <button className={styles.iconButton} type="button" aria-label={toggleFullscreenLabel} title={toggleFullscreenLabel} onClick={() => void toggleFullscreen()}><Monitor size={15} /></button>
            <div className={styles.settingsWrap}>
              <button className={styles.iconButton} type="button" aria-label="课堂设置" title="课堂设置" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}><Settings2 size={15} /></button>
              {settingsOpen ? <div className={styles.classroomSettings} role="dialog" aria-label="课堂设置">
                <label><input type="checkbox" checked={speechEnabled} onChange={(event) => setSpeechEnabled(event.target.checked)} />自动播放教师语音</label>
                <span>关闭后仍会显示教师讲解文字。</span>
              </div> : null}
            </div>
            <div className={styles.topStatus} aria-live="polite"><span className={styles.statusDot} />{playbackStatus}<span className={styles.stageId}>{classroom.document.stage.id}</span></div>
          </div>
        </header>
        <div className={styles.classroomBody}>
          <section className={styles.lessonSpace}>
            <div className={styles.lessonMeta}><span>第 {sceneIndex + 1} / {classroom.scenes.length} 节</span><strong>{activeScene.title}</strong><span>{actionLabel(currentAction)}</span></div>
            <div ref={lessonViewportRef} className={styles.lessonViewport}>
              {activeScene.type === "slide" ? <MigratedSlideCanvas scene={activeScene} highlightedElementId={highlightedElementId} laserElementId={laserElementId} /> : null}
              {activeScene.type === "interactive" ? <InteractiveScene scene={activeScene} iframeRef={iframeRef} highlightTarget={highlightTarget} widgetState={widgetState} widgetAnnotation={widgetAnnotation} widgetRevealTarget={widgetRevealTarget} /> : null}
              {activeScene.type === "quiz" ? <QuizScene scene={activeScene} /> : null}
              {whiteboardOpen ? <WhiteboardSurface onClose={() => setWhiteboardOpen(false)} /> : null}
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
              whiteboardOpen={whiteboardOpen}
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
              onToggleAutoPlay={() => setAutoPlayLecture((value) => !value)}
              onToggleWhiteboard={() => setWhiteboardOpen((value) => !value)}
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
          {unsupportedAction ? <section className={styles.warningSection}><AlertTriangle size={15} /><span>动作 “{unsupportedAction}” 暂未接入，课堂仍可继续。</span><button type="button" onClick={() => setUnsupportedAction(null)} aria-label="关闭提示"><X size={14} /></button></section> : null}
        </div>
        </section>
        <aside className={`${styles.notesRail} ${rightPanelOpen ? "" : styles.notesRailClosed}`} aria-label="课堂侧栏">
        {rightPanelOpen ? <>
          <div className={styles.notesTabs} role="tablist" aria-label="课堂侧栏标签">
            <button className={rightPanelTab === "notes" ? styles.notesTabActive : ""} type="button" role="tab" aria-selected={rightPanelTab === "notes"} onClick={() => setRightPanelTab("notes")}><BookOpen size={15} />Notes</button>
            <button className={rightPanelTab === "chat" ? styles.notesTabActive : ""} type="button" role="tab" aria-selected={rightPanelTab === "chat"} onClick={() => setRightPanelTab("chat")}><MessagesSquare size={15} />Chat</button>
            <button className={styles.panelToggle} type="button" aria-label="收起侧栏" title="收起侧栏" onClick={() => setRightPanelOpen(false)}><PanelRightClose size={15} /></button>
          </div>
          {rightPanelTab === "notes" ? <MigratedNotesPanel scene={activeScene} actions={activeDocumentScene?.actions ?? []} activeActionIndex={runtimeState.actionIndex} /> : <ChatPanel discussion={discussion} />}
        </> : <button className={styles.panelExpand} type="button" aria-label="展开侧栏" title="展开侧栏" onClick={() => setRightPanelOpen(true)}><PanelRightOpen size={17} /></button>}
        </aside>
      </div>
    </main>
  );
}
