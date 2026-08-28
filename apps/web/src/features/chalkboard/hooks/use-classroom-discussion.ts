"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeSnapshot } from "@chalk/chalkboard";

import {
  classroomDiscussionErrorMessage,
  classroomDiscussionsApi,
  type ClassroomDiscussion,
  type ClassroomDiscussionMessage,
  type ClassroomDiscussionStreamEvent,
  type ClassroomDiscussionTarget,
} from "../../../api";

type DiscussionTopic = {
  topic: string;
  prompt?: string;
  triggerAgentId?: string;
};

type UseClassroomDiscussionInput = {
  target: ClassroomDiscussionTarget | null;
  sceneId: string | null;
  sceneTitle: string;
  topic: DiscussionTopic | null;
  entryCursor: RuntimeSnapshot | null;
  onAgentStarted?: (event: Extract<ClassroomDiscussionStreamEvent, { type: "agent_started" }>) => void;
  onAgentTextDelta?: (event: Extract<ClassroomDiscussionStreamEvent, { type: "text_delta" }>) => void;
  onAgentMessageCompleted?: (message: ClassroomDiscussionMessage) => void;
};

export type ClassroomDiscussionUiStatus = "idle" | "restoring" | "streaming" | "stopping" | "completing";

function sortMessages(messages: ClassroomDiscussionMessage[]) {
  return [...messages].sort((left, right) => left.sequence - right.sequence);
}

export function useClassroomDiscussion({
  target,
  sceneId,
  sceneTitle,
  topic,
  entryCursor,
  onAgentStarted,
  onAgentTextDelta,
  onAgentMessageCompleted,
}: UseClassroomDiscussionInput) {
  const [discussion, setDiscussion] = useState<ClassroomDiscussion | null>(null);
  const [messages, setMessages] = useState<ClassroomDiscussionMessage[]>([]);
  const [status, setStatus] = useState<ClassroomDiscussionUiStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const streamControllerRef = useRef<AbortController | null>(null);
  const startedRef = useRef(onAgentStarted);
  const deltaRef = useRef(onAgentTextDelta);
  const completionRef = useRef(onAgentMessageCompleted);
  const targetKind = target?.kind ?? null;
  const targetId = target?.id ?? null;
  const stableTarget = useMemo<ClassroomDiscussionTarget | null>(
    () => targetKind && targetId ? { kind: targetKind, id: targetId } : null,
    [targetId, targetKind],
  );
  const targetKey = stableTarget && sceneId ? `${stableTarget.kind}:${stableTarget.id}:${sceneId}` : null;

  useEffect(() => { startedRef.current = onAgentStarted; }, [onAgentStarted]);
  useEffect(() => { deltaRef.current = onAgentTextDelta; }, [onAgentTextDelta]);
  useEffect(() => { completionRef.current = onAgentMessageCompleted; }, [onAgentMessageCompleted]);

  const restore = useCallback(async (signal?: AbortSignal) => {
    if (!stableTarget || !sceneId) return;
    setStatus("restoring");
    try {
      const result = await classroomDiscussionsApi.current(stableTarget, sceneId, signal);
      if (signal?.aborted) return;
      setDiscussion(result.discussion);
      setMessages(sortMessages(result.discussion?.messages ?? []));
      setError(null);
      setRestoredKey(targetKey);
    } catch (reason) {
      if (signal?.aborted) return;
      setError(classroomDiscussionErrorMessage(reason));
    } finally {
      if (!signal?.aborted) setStatus("idle");
    }
  }, [sceneId, stableTarget, targetKey]);

  useEffect(() => {
    const controller = new AbortController();
    streamControllerRef.current?.abort();
    setRestoredKey(null);
    setDiscussion(null);
    setMessages([]);
    setError(null);
    void restore(controller.signal);
    return () => controller.abort();
  }, [restore]);

  const applyEvent = useCallback((event: ClassroomDiscussionStreamEvent) => {
    if (event.type === "agent_started") {
      startedRef.current?.(event);
      setMessages((current) => sortMessages([
        ...current.filter((message) => message.id !== event.messageId),
        {
          id: event.messageId,
          roundId: event.roundId,
          sequence: event.sequence,
          sender: "agent",
          agentId: event.agentId,
          agentName: event.agentName,
          agentRole: event.agentRole,
          content: "",
          actions: [],
          status: "streaming",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]));
      return;
    }
    if (event.type === "text_delta") {
      deltaRef.current?.(event);
      setMessages((current) => current.map((message) => message.id === event.messageId
        ? { ...message, content: `${message.content}${event.delta}`, updatedAt: new Date().toISOString() }
        : message));
      return;
    }
    if (event.type === "action") {
      setMessages((current) => current.map((message) => message.id === event.messageId
        ? { ...message, actions: [...message.actions, event.action], updatedAt: new Date().toISOString() }
        : message));
      return;
    }
    if (event.type === "message_completed") {
      setMessages((current) => sortMessages([
        ...current.filter((message) => message.id !== event.message.id),
        event.message,
      ]));
      completionRef.current?.(event.message);
      return;
    }
    if (event.type === "error") setError(classroomDiscussionErrorMessage(new Error(event.error)));
  }, []);

  const runRound = useCallback(async (message?: string) => {
    const text = message?.trim();
    if ((message !== undefined && !text) || !stableTarget || !sceneId || !entryCursor || status !== "idle") return;
    setStatus("streaming");
    setError(null);
    const controller = new AbortController();
    streamControllerRef.current = controller;
    let active = discussion?.status === "active" ? discussion : null;
    const temporaryId = text ? `local-${Date.now()}` : null;
    if (temporaryId && text) {
      setMessages((current) => [...current, {
        id: temporaryId,
        roundId: temporaryId,
        sequence: (current.at(-1)?.sequence ?? 0) + 1,
        sender: "student",
        agentId: null,
        agentName: null,
        agentRole: null,
        content: text,
        actions: [],
        status: "completed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);
    }
    try {
      if (!active) {
        const created = await classroomDiscussionsApi.createOrResume({
          target: stableTarget,
          sceneId,
          topic: topic?.topic ?? `关于“${sceneTitle}”的课堂追问`,
          ...(topic?.prompt ? { prompt: topic.prompt } : {}),
          ...(topic?.triggerAgentId ? { triggerAgentId: topic.triggerAgentId } : {}),
          ...(stableTarget.kind === "generation_run" ? { entryCursor } : {}),
        }, controller.signal);
        active = created.discussion;
        setDiscussion(created.discussion);
        setMessages((current) => sortMessages([
          ...created.discussion.messages,
          ...current.filter((candidate) => temporaryId !== null && candidate.id === temporaryId),
        ]));
      }
      await classroomDiscussionsApi.streamRound(
        active.id,
        text ? { message: text } : {},
        applyEvent,
        controller.signal,
      );
      const restored = await classroomDiscussionsApi.get(active.id);
      setDiscussion(restored.discussion);
      setMessages(sortMessages(restored.discussion.messages));
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(classroomDiscussionErrorMessage(reason));
      }
      if (active) {
        const restored = await classroomDiscussionsApi.get(active.id).catch(() => null);
        if (restored) {
          setDiscussion(restored.discussion);
          setMessages(sortMessages(restored.discussion.messages));
        }
      } else if (temporaryId) {
        setMessages((current) => current.filter((candidate) => candidate.id !== temporaryId));
      }
    } finally {
      if (streamControllerRef.current === controller) streamControllerRef.current = null;
      setStatus("idle");
    }
  }, [applyEvent, discussion, entryCursor, sceneId, sceneTitle, stableTarget, status, topic]);

  const send = useCallback((message: string) => runRound(message), [runRound]);
  const startAuthored = useCallback(() => runRound(), [runRound]);

  const stop = useCallback(async () => {
    if (!discussion || status !== "streaming") return;
    setStatus("stopping");
    try {
      await classroomDiscussionsApi.abort(discussion.id);
    } catch {
      streamControllerRef.current?.abort();
    }
  }, [discussion, status]);

  const complete = useCallback(async () => {
    if (!discussion || discussion.status !== "active" || status !== "idle") return null;
    setStatus("completing");
    setError(null);
    try {
      const result = await classroomDiscussionsApi.complete(discussion.id);
      setDiscussion(result.discussion);
      setMessages(sortMessages(result.discussion.messages));
      return result.entryCursor;
    } catch (reason) {
      setError(classroomDiscussionErrorMessage(reason));
      return null;
    } finally {
      setStatus("idle");
    }
  }, [discussion, status]);

  const latestAgentMessage = useMemo(
    () => messages.filter((message) => message.sender === "agent").at(-1) ?? null,
    [messages],
  );

  return {
    discussion,
    messages,
    latestAgentMessage,
    status,
    error,
    ready: targetKey !== null && restoredKey === targetKey,
    send,
    startAuthored,
    stop,
    complete,
    retryRestore: () => restore(),
  };
}
