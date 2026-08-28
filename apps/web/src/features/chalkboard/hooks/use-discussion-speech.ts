"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ClassroomDiscussionMessage, ClassroomDiscussionStreamEvent } from "../../../api";

type SpeechSettings = {
  enabled: boolean;
  language: string;
  voiceUri: string | null;
  rate: number;
  volume: number;
};

type AgentStartedEvent = Extract<ClassroomDiscussionStreamEvent, { type: "agent_started" }>;
type TextDeltaEvent = Extract<ClassroomDiscussionStreamEvent, { type: "text_delta" }>;

type SpeechSegment = {
  messageId: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  text: string;
};

type StreamingMessage = Omit<SpeechSegment, "text"> & {
  received: string;
  pending: string;
};

export type DiscussionSpeechState = {
  phase: "idle" | "speaking" | "paused";
  speakerName: string | null;
  queuedSegments: number;
};

const IDLE_STATE: DiscussionSpeechState = {
  phase: "idle",
  speakerName: null,
  queuedSegments: 0,
};

function takeSealedSpeech(text: string) {
  let boundary = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (/[。！？!?；;\n]/u.test(text[index] ?? "")) boundary = index;
  }
  if (boundary < 0) return { sealed: "", pending: text };
  return {
    sealed: text.slice(0, boundary + 1).trim(),
    pending: text.slice(boundary + 1),
  };
}

function agentVoice(
  voices: readonly SpeechSynthesisVoice[],
  segment: SpeechSegment,
  settings: SpeechSettings,
) {
  const configured = voices.find((voice) => voice.voiceURI === settings.voiceUri) ?? null;
  if (segment.agentRole === "teacher") return configured;
  const language = settings.language.toLocaleLowerCase().split("-")[0];
  const candidates = voices.filter((voice) =>
    voice.voiceURI !== configured?.voiceURI && voice.lang.toLocaleLowerCase().startsWith(language ?? ""));
  if (candidates.length === 0) return configured;
  const hash = [...segment.agentId].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return candidates[hash % candidates.length] ?? configured;
}

/** Owns the browser speech lifecycle for classroom discussion. Lecture
 * playback never appends to this queue, and normal Agent hand-offs never call
 * speechSynthesis.cancel(). */
export function useDiscussionSpeech(settings: SpeechSettings) {
  const [state, setState] = useState<DiscussionSpeechState>(IDLE_STATE);
  const settingsRef = useRef(settings);
  const messagesRef = useRef(new Map<string, StreamingMessage>());
  const queueRef = useRef<SpeechSegment[]>([]);
  const speakingRef = useRef(false);
  const pausedRef = useRef(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const timerRef = useRef<number | null>(null);
  const epochRef = useRef(0);

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const publishState = useCallback((speakerName: string | null = null) => {
    setState({
      phase: pausedRef.current ? "paused" : speakingRef.current ? "speaking" : "idle",
      speakerName: speakingRef.current ? speakerName : null,
      queuedSegments: queueRef.current.length,
    });
  }, []);

  const pumpRef = useRef<() => void>(() => undefined);
  pumpRef.current = () => {
    if (speakingRef.current || pausedRef.current) return;
    const segment = queueRef.current.shift();
    if (!segment) {
      publishState();
      return;
    }
    const current = settingsRef.current;
    if (!current.enabled || current.volume === 0 || !("speechSynthesis" in window)) {
      pumpRef.current();
      return;
    }

    const epoch = epochRef.current;
    const utterance = new SpeechSynthesisUtterance(segment.text);
    utterance.lang = current.language;
    utterance.voice = agentVoice(window.speechSynthesis.getVoices(), segment, current);
    utterance.rate = current.rate;
    utterance.volume = current.volume;
    speakingRef.current = true;
    utteranceRef.current = utterance;
    publishState(segment.agentName);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      if (epoch !== epochRef.current) return;
      utteranceRef.current = null;
      speakingRef.current = false;
      publishState();
      pumpRef.current();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    timerRef.current = window.setTimeout(finish, Math.max(60_000, Math.min(180_000, segment.text.length * 650)));
    window.speechSynthesis.speak(utterance);
  };

  const enqueue = useCallback((segment: SpeechSegment) => {
    if (!segment.text.trim()) return;
    queueRef.current.push({ ...segment, text: segment.text.trim() });
    publishState(state.speakerName);
    pumpRef.current();
  }, [publishState, state.speakerName]);

  const onAgentStarted = useCallback((event: AgentStartedEvent) => {
    messagesRef.current.set(event.messageId, {
      messageId: event.messageId,
      agentId: event.agentId,
      agentName: event.agentName,
      agentRole: event.agentRole,
      received: "",
      pending: "",
    });
  }, []);

  const onTextDelta = useCallback((event: TextDeltaEvent) => {
    const message = messagesRef.current.get(event.messageId);
    if (!message) return;
    message.received += event.delta;
    message.pending += event.delta;
    const next = takeSealedSpeech(message.pending);
    message.pending = next.pending;
    if (next.sealed) enqueue({ ...message, text: next.sealed });
  }, [enqueue]);

  const onMessageCompleted = useCallback((message: ClassroomDiscussionMessage) => {
    if (message.sender !== "agent" || !message.agentId) return;
    const streaming = messagesRef.current.get(message.id);
    if (!streaming) {
      enqueue({
        messageId: message.id,
        agentId: message.agentId,
        agentName: message.agentName ?? "课堂成员",
        agentRole: message.agentRole ?? "student",
        text: message.content,
      });
      return;
    }
    if (message.content.startsWith(streaming.received)) {
      streaming.pending += message.content.slice(streaming.received.length);
    } else if (!streaming.received) {
      streaming.pending = message.content;
    }
    if (streaming.pending.trim()) enqueue({ ...streaming, text: streaming.pending });
    messagesRef.current.delete(message.id);
  }, [enqueue]);

  const interrupt = useCallback(() => {
    epochRef.current += 1;
    messagesRef.current.clear();
    queueRef.current = [];
    speakingRef.current = false;
    pausedRef.current = false;
    utteranceRef.current = null;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    window.speechSynthesis?.cancel();
    setState(IDLE_STATE);
  }, []);

  const pause = useCallback(() => {
    if (!speakingRef.current || pausedRef.current) return;
    pausedRef.current = true;
    window.speechSynthesis?.pause();
    publishState(state.speakerName);
  }, [publishState, state.speakerName]);

  const resume = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    window.speechSynthesis?.resume();
    publishState(state.speakerName);
    pumpRef.current();
  }, [publishState, state.speakerName]);

  useEffect(() => () => interrupt(), [interrupt]);

  return {
    state,
    active: state.phase !== "idle" || state.queuedSegments > 0,
    onAgentStarted,
    onTextDelta,
    onMessageCompleted,
    interrupt,
    pause,
    resume,
  };
}
