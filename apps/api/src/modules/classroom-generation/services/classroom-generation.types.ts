import type { createClassroomGenerationDal } from '../../../db/dal';
import type { TtsFormat, TtsProviderId } from '../../../providers/tts/types';
import type { ImageProviderId } from '../../../providers/image/types';
import type { VideoProviderId } from '../../../providers/video/types';

export type ClassroomGenerationDal = ReturnType<typeof createClassroomGenerationDal>;

export type ClassroomGenerationStopReason =
  | 'pending'
  | 'stop'
  | 'length'
  | 'toolUse'
  | 'error'
  | 'aborted'
  | 'deferred';

export type ClassroomGenerationModel = {
  stream?(userId: string, input: {
    system: string;
    user: string;
    signal?: AbortSignal;
    maxRetries?: number;
    timeoutMs?: number;
  }): AsyncIterable<
    | { type: 'text_delta'; delta: string }
    | {
        type: 'done';
        providerId: string;
        modelId: string;
        stopReason?: ClassroomGenerationStopReason;
      }
  >;
  generate(userId: string, input: {
    system: string;
    user: string;
    signal?: AbortSignal;
    maxRetries?: number;
    timeoutMs?: number;
  }): Promise<{
    providerId: string;
    modelId: string;
    text: string;
    stopReason?: ClassroomGenerationStopReason;
  }>;
};

export type ClassroomMediaGenerator = {
  synthesize(userId: string, input: {
    text: string;
    providerId: TtsProviderId;
    voice: string;
    model?: string;
    format?: TtsFormat;
    signal?: AbortSignal;
  }): Promise<{
    bytes: Buffer;
    contentType: string;
    format: string;
    providerId: TtsProviderId;
    modelId: string;
  }>;
  generateImage(userId: string, input: {
    prompt: string;
    providerId: ImageProviderId;
    model?: string;
    width?: number;
    height?: number;
    aspectRatio?: '16:9' | '4:3' | '1:1' | '9:16' | '3:4' | '21:9';
    negativePrompt?: string;
    signal?: AbortSignal;
  }): Promise<{
    bytes: Buffer;
    contentType: string;
    format: string;
    providerId: ImageProviderId;
    modelId: string;
  }>;
  submitVideo(userId: string, input: {
    prompt: string;
    providerId: VideoProviderId;
    model?: string;
    aspectRatio?: '16:9' | '4:3' | '1:1' | '9:16' | '3:4' | '21:9';
    durationSeconds?: number;
    resolution?: '720p' | '1080p';
    signal?: AbortSignal;
  }): Promise<{
    providerTaskId: string;
    providerId: VideoProviderId;
    modelId: string;
  }>;
  pollVideo(userId: string, input: {
    providerTaskId: string;
    providerId: VideoProviderId;
    modelId: string;
    signal?: AbortSignal;
  }): Promise<
    | { status: 'pending' }
    | { status: 'failed'; error?: unknown }
    | { status: 'done'; bytes: Buffer; contentType: string; format: string }
  >;
  cancelVideo?(userId: string, input: {
    providerTaskId: string;
    providerId: VideoProviderId;
    modelId: string;
    signal?: AbortSignal;
  }): Promise<void>;
};

export type ClassroomGenerationWorkerOptions = {
  pollIntervalMs?: number;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  concurrency?: number;
  onError?: (error: unknown) => void;
};

export type ClaimedGeneration = NonNullable<
  Awaited<ReturnType<ClassroomGenerationDal['getClaimed']>>
>;

export type GenerationClaimContext = {
  userId: string;
  runId: string;
  workerId: string;
  draft: ClaimedGeneration['draft'];
  signal: AbortSignal;
};

export function generateWithAbort(
  model: ClassroomGenerationModel,
  userId: string,
  input: {
    system: string;
    user: string;
    signal: AbortSignal;
    maxRetries?: number;
    timeoutMs?: number;
  },
) {
  const operation = model.generate(userId, input);
  if (input.signal.aborted) return Promise.reject(input.signal.reason);
  return new Promise<Awaited<typeof operation>>((resolve, reject) => {
    const abort = () => reject(input.signal.reason);
    input.signal.addEventListener('abort', abort, { once: true });
    void operation.then(resolve, reject).finally(() => input.signal.removeEventListener('abort', abort));
  });
}

export async function* streamWithAbort<T>(source: AsyncIterable<T>, signal: AbortSignal) {
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (true) {
      const result = await raceWithAbort(iterator.next(), signal);
      if (result.done) return;
      yield result.value;
    }
  } finally {
    // Do not await return(): a provider that ignored cancellation may still
    // have a pending next() call. The worker lease must be released promptly.
    void iterator.return?.();
  }
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
