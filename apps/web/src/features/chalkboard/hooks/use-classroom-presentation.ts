"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyWhiteboardAction,
  type PlaybackExecutor,
  type ScenePresentationState,
  type WhiteboardPresentationState,
} from "@chalk/chalkboard";

import { postInteractiveMessage } from "../lib/interactive-html";
import type { PlaybackSpeed } from "../components/playback-controls";

export interface ClassroomPlaybackSettings {
  autoPlayLecture: boolean;
  playbackSpeed: PlaybackSpeed;
  speechEnabled: boolean;
  ttsMuted: boolean;
  ttsVolume: number;
  speechLanguage: string;
  speechVoiceUri: string | null;
  speechRate: number;
}

/** Browser presentation adapter for the Chalkboard runtime. It owns transient
 * media/effect lifecycles and exposes only render state plus one executor. */
export function useClassroomPresentation(
  settings: ClassroomPlaybackSettings,
  onDiscussion: (topic: string) => void,
) {
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
  const [laserElementId, setLaserElementId] = useState<string | null>(null);
  const [highlightTarget, setHighlightTarget] = useState<string | null>(null);
  const [widgetState, setWidgetState] = useState<Record<string, unknown> | null>(null);
  const [widgetAnnotation, setWidgetAnnotation] = useState<{ target: string; content?: string } | null>(null);
  const [widgetRevealTarget, setWidgetRevealTarget] = useState<string | null>(null);
  const [whiteboard, setWhiteboard] = useState<WhiteboardPresentationState>({ open: false, elements: [] });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lessonViewportRef = useRef<HTMLDivElement>(null);
  const speechResolveRef = useRef<(() => void) | null>(null);
  const speechTimerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoResolveRef = useRef<(() => void) | null>(null);
  const videoTimerRef = useRef<number | null>(null);
  const effectTimerRef = useRef<number | null>(null);
  const settingsRef = useRef(settings);
  const discussionRef = useRef(onDiscussion);

  useEffect(() => { discussionRef.current = onDiscussion; }, [onDiscussion]);
  useEffect(() => {
    settingsRef.current = settings;
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = settings.playbackSpeed;
    video.volume = settings.ttsMuted ? 0 : settings.ttsVolume;
    if (!settings.ttsMuted && settings.ttsVolume > 0 && video.dataset.chalkboardAutoplayMuted === "true") {
      video.muted = false;
      delete video.dataset.chalkboardAutoplayMuted;
    }
  }, [settings]);

  const executor = useMemo<PlaybackExecutor>(() => ({
    speak: (text) => {
      const current = settingsRef.current;
      if (!current.speechEnabled || current.ttsMuted || current.ttsVolume === 0 || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      return new Promise<void>((resolve) => {
        const startedAt = performance.now();
        const minimumDuration = Math.max(900, Math.min(60_000, (text.length * 220) / current.playbackSpeed));
        const finish = () => {
          if (speechTimerRef.current !== null) window.clearTimeout(speechTimerRef.current);
          speechTimerRef.current = null;
          speechResolveRef.current = null;
          resolve();
        };
        const finishAfterMinimum = () => {
          const remaining = minimumDuration - (performance.now() - startedAt);
          if (remaining > 0) speechTimerRef.current = window.setTimeout(finishAfterMinimum, remaining);
          else finish();
        };
        speechResolveRef.current = finish;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = current.speechLanguage;
        utterance.voice = window.speechSynthesis.getVoices().find((voice) => voice.voiceURI === current.speechVoiceUri) ?? null;
        utterance.rate = current.speechRate * current.playbackSpeed;
        utterance.volume = current.ttsVolume;
        utterance.onend = finishAfterMinimum;
        utterance.onerror = finishAfterMinimum;
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
      const findVideo = () => Array.from(lessonViewportRef.current?.querySelectorAll<HTMLVideoElement>("[data-video-element]") ?? [])
        .find((candidate) => candidate.dataset.elementId === elementId) ?? null;
      const video = await new Promise<HTMLVideoElement | null>((resolve) => {
        const immediate = findVideo();
        if (immediate) return resolve(immediate);
        const startedAt = performance.now();
        const check = () => {
          const mounted = findVideo();
          if (mounted || performance.now() - startedAt >= 1_000) resolve(mounted);
          else window.setTimeout(check, 16);
        };
        window.setTimeout(check, 0);
      });
      if (!video) return;
      videoRef.current = video;
      video.currentTime = 0;
      const current = settingsRef.current;
      video.playbackRate = current.playbackSpeed;
      video.volume = current.ttsMuted ? 0 : current.ttsVolume;
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
        videoTimerRef.current = window.setTimeout(finish, 60_000);
        void video.play().catch(() => {
          video.muted = true;
          video.dataset.chalkboardAutoplayMuted = "true";
          void video.play().catch(finish);
        });
      });
    },
    discussion: ({ topic }) => { discussionRef.current(topic); },
    widgetHighlight: ({ target, content }) => {
      setHighlightTarget(target);
      postInteractiveMessage(iframeRef.current, { type: "HIGHLIGHT_ELEMENT", target, content });
    },
    widgetSetState: ({ state, content }) => {
      setWidgetState(state);
      postInteractiveMessage(iframeRef.current, { type: "SET_WIDGET_STATE", state, content });
    },
    widgetAnnotation: ({ target, content }) => {
      setWidgetAnnotation({ target, ...(content ? { content } : {}) });
      postInteractiveMessage(iframeRef.current, { type: "ANNOTATE_ELEMENT", target, content });
    },
    widgetReveal: ({ target, content }) => {
      setWidgetRevealTarget(target);
      postInteractiveMessage(iframeRef.current, { type: "REVEAL_ELEMENT", target, content });
    },
    whiteboard: (action) => setWhiteboard((current) => applyWhiteboardAction(current, action)),
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

  useEffect(() => () => { void executor.cancel?.("presentation unmounted"); }, [executor]);

  const restorePresentation = useCallback((state: ScenePresentationState) => {
    if (effectTimerRef.current !== null) window.clearTimeout(effectTimerRef.current);
    effectTimerRef.current = null;
    setHighlightedElementId(null);
    setLaserElementId(null);
    setHighlightTarget(state.widget.highlightTarget);
    setWidgetState(state.widget.state);
    setWidgetAnnotation(state.widget.annotation);
    setWidgetRevealTarget(state.widget.revealTarget);
    setWhiteboard(state.whiteboard);
  }, []);

  return {
    executor,
    settingsRef,
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
  };
}
