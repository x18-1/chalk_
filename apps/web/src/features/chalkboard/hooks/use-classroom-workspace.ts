"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";
import type { AdaptedClassroom } from "@chalk/chalkboard";
import {
  ApiRequestError,
  classroomErrorMessage,
  classroomGenerationApi,
  classroomGenerationErrorMessage,
  classroomsApi,
  type ClassroomGenerationRun,
  type ClassroomSummary,
} from "../../../api";
import type { SidebarClassroom } from "../../../components/app-sidebar";
import {
  DraftClassroomSession,
  loadClassroomSession,
  restoreGrowingDraftCursor,
  type ClassroomSession,
} from "../lib/classroom-client";
import { adaptGenerationRunToDraftClassroom } from "../lib/draft-classroom";

export type CursorSaveStatus = "saved" | "saving" | "conflict" | "offline" | "unsaved";

type WorkspaceError = {
  title: string;
  message: string;
};

type UseClassroomWorkspaceOptions = {
  requestedClassroomId: string | null;
  requestedDraftRunId: string | null;
  presentationBusyRef: MutableRefObject<boolean>;
};

function toSidebarClassroom(classroom: ClassroomSummary): SidebarClassroom {
  return {
    id: classroom.id,
    title: classroom.title,
    ...(classroom.generation ? {
      generation: {
        stage: classroom.generation.stage,
        status: classroom.generation.status,
        draftStatus: classroom.generation.draftStatus,
      },
    } : {}),
  };
}

function draftDocumentSignature(run: ClassroomGenerationRun): string {
  const completedSceneIds = run.scenes
    .filter((scene) => scene.status === "completed" && scene.phase === "completed")
    .map((scene) => scene.outlineId)
    .join(":");
  const completedMedia = run.mediaTasks
    .filter((task) => task.status === "completed" && task.url)
    .map((task) => `${task.id}:${task.mediaRef}`)
    .join(":");
  return `${completedSceneIds}|${completedMedia}`;
}

/**
 * Owns the stable Classroom entry and its transition from Generation Run to
 * progressively usable Classroom Draft. Playback and discussion remain behind
 * their own seams; this module only publishes a new document when presentation
 * is idle, so a background Scene cannot restart current narration.
 */
export function useClassroomWorkspace({
  requestedClassroomId,
  requestedDraftRunId,
  presentationBusyRef,
}: UseClassroomWorkspaceOptions) {
  const router = useRouter();
  const [classroom, setClassroom] = useState<AdaptedClassroom | null>(null);
  const [learningSession, setLearningSession] = useState<ClassroomSession | null>(null);
  const [generationRun, setGenerationRun] = useState<ClassroomGenerationRun | null>(null);
  const [cursorSaveStatus, setCursorSaveStatus] = useState<CursorSaveStatus>("saved");
  const [selectedClassroomId, setSelectedClassroomId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<WorkspaceError | null>(null);
  const [classrooms, setClassrooms] = useState<SidebarClassroom[]>([]);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const classroomRef = useRef<AdaptedClassroom | null>(null);
  const draftDocumentSignatureRef = useRef("");

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

        const signature = draftDocumentSignature(nextRun);
        let documentApplied = true;
        if (draftDocumentSignatureRef.current !== signature) {
          const adapted = adaptGenerationRunToDraftClassroom(nextRun);
          const previous = classroomRef.current;
          if (previous?.runtime.getState().mode === "playing" || presentationBusyRef.current) {
            documentApplied = false;
          } else {
            const draftSession = new DraftClassroomSession(nextRun.draftId, nextRun.id, adapted.document);
            if (previous?.document.stage.id === adapted.document.stage.id) restoreGrowingDraftCursor(previous, adapted);
            else draftSession.restoreCursor(adapted);
            draftDocumentSignatureRef.current = signature;
            classroomRef.current = adapted;
            setClassroom(adapted);
            setLearningSession(draftSession);
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
        if (!selected) {
          throw new ApiRequestError(404, "没有找到这门课堂，它可能已被移除。", "CLASSROOM_NOT_FOUND");
        }
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
    };
  }, [loadAttempt, presentationBusyRef, requestedClassroomId, requestedDraftRunId]);

  const reload = useCallback(() => {
    setError(null);
    setLoadAttempt((value) => value + 1);
  }, []);

  const openClassroom = useCallback((classroomId: string) => {
    setError(null);
    setLoadAttempt((value) => value + 1);
    router.push(`/chalkboard?id=${encodeURIComponent(classroomId)}`);
  }, [router]);

  return {
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
      reload,
      openClassroom,
    },
  };
}
