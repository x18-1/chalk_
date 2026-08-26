"use client";

import {
  adaptOpenMaicClassroomResponse,
  loadCursorSnapshot,
  saveCursorSnapshot,
  type AdaptedClassroom,
  type CursorSnapshotStore,
} from "@chalk/chalkboard";

function cursorStore(stageId: string): CursorSnapshotStore {
  const key = `chalkboard:cursor:${stageId}`;
  const legacyKey = stageId === "681PbzeDfm" ? "chalkboard:cursor:fourier-transform-intro" : null;
  return {
    async load() {
      const value = window.localStorage.getItem(key) ?? (legacyKey ? window.localStorage.getItem(legacyKey) : null);
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
      if (legacyKey) window.localStorage.removeItem(legacyKey);
    },
    async clear() {
      window.localStorage.removeItem(key);
      if (legacyKey) window.localStorage.removeItem(legacyKey);
    },
  };
}

export async function loadClassroomSession(classroomId: string, signal: AbortSignal): Promise<AdaptedClassroom> {
  const response = await fetch(`/api/openmaic/classroom?id=${encodeURIComponent(classroomId)}`, { cache: "no-store", signal });
  const body = await response.json().catch(() => null) as { success?: boolean; error?: string } | null;
  if (!response.ok || body?.success !== true) throw new Error(body?.error ?? "课堂加载失败");
  const classroom = adaptOpenMaicClassroomResponse(body);
  const snapshot = await loadCursorSnapshot(classroom.document.stage.id, cursorStore(classroom.document.stage.id));
  if (snapshot) classroom.runtime.restore(snapshot);
  return classroom;
}

export async function saveClassroomCursor(classroom: AdaptedClassroom): Promise<void> {
  await saveCursorSnapshot(classroom.runtime.getSnapshot(), cursorStore(classroom.document.stage.id));
}
