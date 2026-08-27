import type { RuntimeSnapshot } from '@chalk/chalkboard';

import { apiJson } from './client';

export type LearningSession = {
  id: string;
  classroomId: string;
  artifactId: string;
  cursor: RuntimeSnapshot;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export const learningSessionsApi = {
  createOrResume(classroomId: string, artifactId: string, signal?: AbortSignal) {
    return apiJson<{ learningSession: LearningSession; created: boolean }>(
      `/classrooms/${encodeURIComponent(classroomId)}/artifacts/${encodeURIComponent(artifactId)}/learning-session`,
      { method: 'POST', signal },
    );
  },
  get(sessionId: string, signal?: AbortSignal) {
    return apiJson<{ learningSession: LearningSession }>(
      `/learning-sessions/${encodeURIComponent(sessionId)}`,
      { signal },
    );
  },
  saveCursor(sessionId: string, expectedRevision: number, cursor: RuntimeSnapshot) {
    return apiJson<{ learningSession: LearningSession }>(
      `/learning-sessions/${encodeURIComponent(sessionId)}/cursor`,
      {
        method: 'PUT',
        body: JSON.stringify({ expectedRevision, cursor }),
      },
    );
  },
};
