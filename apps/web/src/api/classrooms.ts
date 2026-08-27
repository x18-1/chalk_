import { apiJson, ApiRequestError } from './client';

export type ClassroomSummary = {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  latestArtifact: {
    id: string;
    version: number;
    contentHash: string;
    createdAt: string;
  };
};

export type ClassroomArtifact = ClassroomSummary & { document: unknown };

export const classroomsApi = {
  list(signal?: AbortSignal) {
    return apiJson<{ classrooms: ClassroomSummary[] }>('/classrooms', { signal });
  },
  artifact(classroomId: string, artifactId: string, signal?: AbortSignal) {
    return apiJson<ClassroomArtifact>(
      `/classrooms/${encodeURIComponent(classroomId)}/artifacts/${encodeURIComponent(artifactId)}`,
      { signal },
    );
  },
  importArchive(file: File, signal?: AbortSignal) {
    const body = new FormData();
    body.append('file', file);
    return apiJson<{ classroom: ClassroomSummary }>('/classrooms/import', {
      method: 'POST',
      body,
      signal,
    });
  },
};

export function classroomErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return '登录状态已失效，请重新登录后再打开课堂。';
    if (error.status === 403) return '你没有权限打开这门课堂。';
    if (error.status === 404) return error.message;
  }
  if (error instanceof TypeError && typeof navigator !== 'undefined' && !navigator.onLine) {
    return '当前处于离线状态。恢复网络连接后再试一次。';
  }
  return error instanceof Error ? error.message : '课堂加载失败，请稍后重试。';
}

export function classroomImportErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return '登录状态已失效，请重新登录后再导入。';
    if (error.code === 'CLASSROOM_ARCHIVE_TOO_LARGE') return '归档超过 32 MiB，请移除不必要的媒体后重试。';
    if (error.code === 'CLASSROOM_ARCHIVE_TYPE_UNSUPPORTED') return '请选择以 .chalk.zip 或 .maic.zip 结尾的课堂归档。';
    if (error.code === 'CLASSROOM_ARCHIVE_VERSION_UNSUPPORTED') return '这个 Chalk 归档版本暂不受支持，请使用当前版本重新导出。';
    if (error.code === 'CLASSROOM_MANIFEST_MISSING') return '归档根目录中没有 manifest.json。';
    if (error.code === 'CLASSROOM_MEDIA_MISSING') return '归档缺少 manifest.json 声明的媒体文件。';
    if (error.code === 'CLASSROOM_MEDIA_STORAGE_UNAVAILABLE') return '媒体存储暂时不可用，已撤销本次导入，请稍后重试。';
    if (error.code?.startsWith('CLASSROOM_')) return '课堂归档没有通过校验，请检查文件内容后重试。';
  }
  if (error instanceof TypeError && typeof navigator !== 'undefined' && !navigator.onLine) {
    return '当前处于离线状态。恢复网络连接后再导入。';
  }
  return error instanceof Error ? error.message : '课堂导入失败，请稍后重试。';
}
