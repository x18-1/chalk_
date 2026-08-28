"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  type AdaptedClassroom,
  type ChalkboardPlaybackController,
  type RuntimeCommandResult,
} from "@chalk/chalkboard";
import type { DraftSceneSlot } from "../lib/draft-classroom";

type PendingSceneNavigation = {
  targetLabel: string;
  run: () => Promise<void>;
};

type UseSceneNavigationOptions = {
  classroom: AdaptedClassroom | null;
  busy: boolean;
  discussionLocked: boolean;
  controllerRef: MutableRefObject<ChalkboardPlaybackController | null>;
  runCommand(operation: (controller: ChalkboardPlaybackController) => Promise<RuntimeCommandResult>): Promise<void>;
  stopDiscussion(): Promise<unknown>;
  interruptDiscussionSpeech(): void;
  notify: Dispatch<SetStateAction<string | null>>;
};

/**
 * Owns every route-independent Scene transition, including the consequential
 * stop-and-switch confirmation. The caller only asks to select a ready Scene or
 * a Draft slot; focus restoration and Discussion Round cancellation stay local.
 */
export function useSceneNavigation({
  classroom,
  busy,
  discussionLocked,
  controllerRef,
  runCommand,
  stopDiscussion,
  interruptDiscussionSpeech,
  notify,
}: UseSceneNavigationOptions) {
  const [selectedPendingSceneId, setSelectedPendingSceneId] = useState<string | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<PendingSceneNavigation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const originRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const restoreFocus = useCallback(() => {
    const origin = originRef.current;
    originRef.current = null;
    window.requestAnimationFrame(() => origin?.focus());
  }, []);

  const cancel = useCallback(() => {
    if (confirming) return;
    setPendingNavigation(null);
    restoreFocus();
  }, [confirming, restoreFocus]);

  const request = useCallback(async (targetLabel: string, run: () => Promise<void>) => {
    if (busy || confirming) return;
    if (!discussionLocked) {
      await run();
      return;
    }
    originRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingNavigation({ targetLabel, run });
  }, [busy, confirming, discussionLocked]);

  const confirm = useCallback(async () => {
    if (!pendingNavigation || confirming) return;
    setConfirming(true);
    notify(null);
    try {
      interruptDiscussionSpeech();
      await stopDiscussion();
      await pendingNavigation.run();
      setPendingNavigation(null);
    } finally {
      setConfirming(false);
      originRef.current = null;
    }
  }, [confirming, interruptDiscussionSpeech, notify, pendingNavigation, stopDiscussion]);

  const selectScene = useCallback((sceneId: string, sceneTitle: string) => request(
    sceneTitle,
    async () => {
      setSelectedPendingSceneId(null);
      await runCommand((controller) => controller.selectScene(sceneId));
    },
  ), [request, runCommand]);

  const selectDraftSlot = useCallback(async (slot: DraftSceneSlot) => {
    if (slot.status === "ready") return;
    await request(slot.title, async () => {
      await controllerRef.current?.pause();
      setSelectedPendingSceneId(slot.id);
    });
  }, [controllerRef, request]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (pendingNavigation && dialog && !dialog.open) dialog.showModal();
  }, [pendingNavigation]);

  useEffect(() => {
    if (!selectedPendingSceneId || !classroom?.scenes.some((scene) => scene.id === selectedPendingSceneId)) return;
    const frame = window.requestAnimationFrame(() => {
      setSelectedPendingSceneId(null);
      void controllerRef.current?.selectScene(selectedPendingSceneId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [classroom, controllerRef, selectedPendingSceneId]);

  return {
    state: {
      selectedPendingSceneId,
      pendingNavigation,
      confirming,
    },
    dialogRef,
    actions: {
      selectScene,
      selectDraftSlot,
      cancel,
      confirm,
    },
  };
}
