"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  applyLiveChalkboardCommand,
  projectScenePresentation,
  type Action,
  type AdaptedClassroom,
  type ChalkboardPlaybackController,
  type LiveChalkboardPresentationState,
  type PlaybackExecutor,
  type RuntimeMode,
  type RuntimeSnapshot,
  type ScenePresentationState,
  type SceneView,
} from "@chalk/chalkboard";
import type { BrowserSpeechSettings } from "../../../api";
import type { ClassroomSession } from "../lib/classroom-client";
import { useClassroomDiscussion } from "./use-classroom-discussion";
import { useDiscussionSpeech } from "./use-discussion-speech";
import type { DiscussionContext } from "./use-classroom-runtime";
import type { PlaybackSpeed } from "../components/playback-controls";

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

type UseClassroomDiscussionBridgeOptions = {
  classroom: AdaptedClassroom | null;
  learningSession: ClassroomSession | null;
  activeScene: SceneView | null;
  activeSceneId: string | null;
  context: DiscussionContext | null;
  setContext: Dispatch<SetStateAction<DiscussionContext | null>>;
  speechEnabled: boolean;
  ttsMuted: boolean;
  ttsVolume: number;
  speechSettings: BrowserSpeechSettings;
  playbackSpeed: PlaybackSpeed;
  playbackMode: RuntimeMode | null;
  controllerRef: MutableRefObject<ChalkboardPlaybackController | null>;
  playbackExecutor: PlaybackExecutor;
  setLiveChalkboard: Dispatch<SetStateAction<LiveChalkboardPresentationState>>;
  restorePresentation(projection: ScenePresentationState): void;
  syncRuntime(): void;
  persist(): Promise<void>;
  notify: Dispatch<SetStateAction<string | null>>;
};

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

/**
 * Bridges a recoverable Discussion Session to playback, FIFO speech, and the
 * current Live Chalkboard projection. The page renders the result but does not
 * coordinate Round lifecycle or mutate the classroom cursor itself.
 */
export function useClassroomDiscussionBridge({
  classroom,
  learningSession,
  activeScene,
  activeSceneId,
  context,
  setContext,
  speechEnabled,
  ttsMuted,
  ttsVolume,
  speechSettings,
  playbackSpeed,
  playbackMode,
  controllerRef,
  playbackExecutor,
  setLiveChalkboard,
  restorePresentation,
  syncRuntime,
  persist,
  notify,
}: UseClassroomDiscussionBridgeOptions) {
  const [draft, setDraft] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [chalkboardActions, setChalkboardActions] = useState<Action[]>([]);
  const speechInputRef = useRef<SpeechInput | null>(null);
  const target = useMemo(() => learningSession?.discussionTarget() ?? null, [learningSession]);
  const speech = useDiscussionSpeech({
    enabled: speechEnabled && !ttsMuted,
    language: speechSettings.language,
    voiceUri: speechSettings.voiceUri,
    rate: speechSettings.rate * playbackSpeed,
    volume: ttsVolume,
  });
  const discussion = useClassroomDiscussion({
    target,
    sceneId: activeSceneId,
    sceneTitle: activeScene?.title ?? "当前场景",
    topic: context,
    entryCursor: classroom?.runtime.getSnapshot() ?? null,
    onAgentStarted: speech.onAgentStarted,
    onAgentTextDelta: speech.onTextDelta,
    onAgentMessageCompleted: speech.onMessageCompleted,
  });
  const locked = ["streaming", "stopping", "completing"].includes(discussion.status) || speech.active;
  const projectedActions = useMemo(
    () => discussion.messages.flatMap((message) => message.actions),
    [discussion.messages],
  );

  useEffect(() => () => speechInputRef.current?.stop(), []);

  useEffect(() => {
    setDraft("");
    setVoiceStatus("");
  }, [activeSceneId]);

  useEffect(() => {
    setChalkboardActions((current) => {
      const currentIds = current.map((action) => action.id).join("|");
      const projectedIds = projectedActions.map((action) => action.id).join("|");
      return currentIds === projectedIds ? current : projectedActions;
    });
  }, [projectedActions]);

  useEffect(() => {
    if (!classroom || !activeSceneId) return;
    const scene = classroom.document.scenes.find((candidate) => candidate.id === activeSceneId);
    let state = projectScenePresentation(
      scene?.actions ?? [],
      classroom.runtime.getState().actionIndex,
    ).liveChalkboard;
    for (const action of chalkboardActions) {
      const applied = applyLiveChalkboardCommand(state, action);
      if (applied.ok) state = applied.state;
    }
    setLiveChalkboard(state);
  }, [activeSceneId, chalkboardActions, classroom, setLiveChalkboard]);

  const complete = useCallback(async () => {
    speech.interrupt();
    const entryCursor = await discussion.complete();
    if (!entryCursor || !classroom) return;
    const resumeCursor = consumeAuthoredDiscussionCursor(
      classroom,
      entryCursor,
      discussion.discussion?.topic ?? context?.topic ?? null,
    );
    const restored = classroom.runtime.restore(resumeCursor);
    if (!restored.ok) {
      notify("讨论已经结束，但原来的课堂位置已不可恢复；已保留在当前页面。");
      return;
    }
    const state = classroom.runtime.getState();
    const scene = classroom.document.scenes.find((candidate) => candidate.id === state.sceneId);
    const presentation = projectScenePresentation(scene?.actions ?? [], state.actionIndex);
    for (const action of chalkboardActions) {
      const applied = applyLiveChalkboardCommand(presentation.liveChalkboard, action);
      if (applied.ok) presentation.liveChalkboard = applied.state;
    }
    setContext(presentation.discussion ? { topic: presentation.discussion } : null);
    restorePresentation(presentation);
    syncRuntime();
    notify("讨论已结束，已回到发起讨论时的课堂位置。");
    await persist();
  }, [chalkboardActions, classroom, context?.topic, discussion, notify, persist, restorePresentation, setContext, speech, syncRuntime]);

  const submit = useCallback(async (message: string) => {
    const text = message.trim();
    if (!text) return;
    setDraft("");
    setVoiceStatus("已发送，课堂成员正在思考。");
    if (playbackMode === "playing") {
      await controllerRef.current?.pause();
      await playbackExecutor.cancel?.("student started a classroom discussion");
    }
    await discussion.send(text).finally(() => setVoiceStatus(""));
  }, [controllerRef, discussion, playbackExecutor, playbackMode]);

  const stop = useCallback(() => {
    speech.interrupt();
    void discussion.stop();
  }, [discussion, speech]);

  const toggleVoice = useCallback(() => {
    if (isListening) {
      speechInputRef.current?.stop();
      return;
    }
    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechInputConstructor;
      webkitSpeechRecognition?: SpeechInputConstructor;
    };
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
      if (transcript) setDraft((current) => `${current}${transcript}`.trim());
    };
    recognition.onerror = () => {
      setIsListening(false);
      setVoiceStatus("语音输入没有识别到内容。");
    };
    recognition.onend = () => setIsListening(false);
    speechInputRef.current = recognition;
    setVoiceStatus("正在听，请说出你的想法。");
    setIsListening(true);
    recognition.start();
  }, [isListening]);

  return {
    discussion,
    speech,
    state: {
      locked,
      draft,
      voiceStatus,
      isListening,
    },
    actions: {
      setDraft,
      setVoiceStatus,
      submit,
      stop,
      complete,
      toggleVoice,
    },
  };
}
